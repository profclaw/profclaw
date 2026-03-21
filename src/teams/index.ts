/**
 * Team Management System
 *
 * Multi-user teams with shared cost budgets, role-based access,
 * and per-member usage tracking.
 *
 * No other OSS AI tool has this - enterprise unlock for profClaw.
 *
 * Roles:
 *   owner  - full control, billing, can delete team
 *   admin  - manage members, budgets, settings
 *   member - use AI, view costs, manage own preferences
 *   viewer - read-only access to dashboards and history
 */

import { randomUUID } from 'node:crypto';
import { createContextualLogger } from '../utils/logger.js';
import { getClient } from '../storage/index.js';

const log = createContextualLogger('Teams');

// Types

export type TeamRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface Team {
  id: string;
  name: string;
  slug: string;
  description?: string;
  avatarUrl?: string;
  ownerId: string;
  // Budget
  monthlyBudgetUsd: number;
  dailyBudgetUsd: number;
  budgetAlertThresholds: number[]; // e.g., [50, 80, 100]
  // Settings
  defaultModel?: string;
  preferredProviders: string[];
  smartRoutingEnabled: boolean;
  // Metadata
  memberCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  role: TeamRole;
  // Per-member settings
  personalBudgetUsd?: number; // optional per-member limit
  preferredModel?: string;
  // Usage tracking
  totalSpentUsd: number;
  requestCount: number;
  lastActiveAt?: number;
  // Metadata
  joinedAt: number;
  invitedBy?: string;
}

export interface TeamInvite {
  id: string;
  teamId: string;
  email: string;
  role: TeamRole;
  invitedBy: string;
  expiresAt: number;
  acceptedAt?: number;
}

export interface TeamUsageSummary {
  teamId: string;
  period: 'daily' | 'weekly' | 'monthly';
  totalSpentUsd: number;
  budgetUsd: number;
  budgetUsedPercent: number;
  memberBreakdown: Array<{
    userId: string;
    name?: string;
    spentUsd: number;
    requestCount: number;
    topModel?: string;
  }>;
  alertsTriggered: number[];
}

// DB Initialization

export async function initTeamsTables(): Promise<void> {
  const db = getClient();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      avatar_url TEXT,
      owner_id TEXT NOT NULL,
      monthly_budget_usd REAL NOT NULL DEFAULT 100.0,
      daily_budget_usd REAL NOT NULL DEFAULT 10.0,
      budget_alert_thresholds TEXT NOT NULL DEFAULT '[50, 80, 100]',
      default_model TEXT,
      preferred_providers TEXT NOT NULL DEFAULT '[]',
      smart_routing_enabled INTEGER NOT NULL DEFAULT 1,
      member_count INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      personal_budget_usd REAL,
      preferred_model TEXT,
      total_spent_usd REAL NOT NULL DEFAULT 0.0,
      request_count INTEGER NOT NULL DEFAULT 0,
      last_active_at INTEGER,
      joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
      invited_by TEXT,
      UNIQUE(team_id, user_id)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS team_invites (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      invited_by TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      accepted_at INTEGER
    )
  `);

  await db.execute(`CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_team_invites_email ON team_invites(email)`);
}

// Team CRUD

export async function createTeam(params: {
  name: string;
  slug?: string;
  description?: string;
  ownerId: string;
  monthlyBudget?: number;
  dailyBudget?: number;
}): Promise<Team> {
  const db = getClient();
  const id = randomUUID();
  const slug = params.slug ?? params.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const now = Math.floor(Date.now() / 1000);

  await db.execute({
    sql: `INSERT INTO teams (id, name, slug, description, owner_id, monthly_budget_usd, daily_budget_usd, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, params.name, slug, params.description ?? null, params.ownerId,
           params.monthlyBudget ?? 100.0, params.dailyBudget ?? 10.0, now, now],
  });

  // Add owner as member
  await db.execute({
    sql: `INSERT INTO team_members (id, team_id, user_id, role, joined_at)
          VALUES (?, ?, ?, 'owner', ?)`,
    args: [randomUUID(), id, params.ownerId, now],
  });

  log.info('Team created', { teamId: id, name: params.name, owner: params.ownerId });

  return getTeam(id) as Promise<Team>;
}

export async function getTeam(teamId: string): Promise<Team | null> {
  const db = getClient();
  const result = await db.execute({ sql: 'SELECT * FROM teams WHERE id = ?', args: [teamId] });
  if (result.rows.length === 0) return null;
  return rowToTeam(result.rows[0] as unknown as TeamRow);
}

export async function getTeamBySlug(slug: string): Promise<Team | null> {
  const db = getClient();
  const result = await db.execute({ sql: 'SELECT * FROM teams WHERE slug = ?', args: [slug] });
  if (result.rows.length === 0) return null;
  return rowToTeam(result.rows[0] as unknown as TeamRow);
}

export async function listUserTeams(userId: string): Promise<Team[]> {
  const db = getClient();
  const result = await db.execute({
    sql: `SELECT t.* FROM teams t
          INNER JOIN team_members tm ON tm.team_id = t.id
          WHERE tm.user_id = ?
          ORDER BY t.name`,
    args: [userId],
  });
  return result.rows.map(r => rowToTeam(r as unknown as TeamRow));
}

export async function updateTeam(teamId: string, updates: Partial<{
  name: string;
  description: string;
  monthlyBudgetUsd: number;
  dailyBudgetUsd: number;
  budgetAlertThresholds: number[];
  defaultModel: string;
  preferredProviders: string[];
  smartRoutingEnabled: boolean;
}>): Promise<Team | null> {
  const db = getClient();
  const sets: string[] = [];
  const args: Array<string | number | null> = [];

  if (updates.name !== undefined) { sets.push('name = ?'); args.push(updates.name); }
  if (updates.description !== undefined) { sets.push('description = ?'); args.push(updates.description); }
  if (updates.monthlyBudgetUsd !== undefined) { sets.push('monthly_budget_usd = ?'); args.push(updates.monthlyBudgetUsd); }
  if (updates.dailyBudgetUsd !== undefined) { sets.push('daily_budget_usd = ?'); args.push(updates.dailyBudgetUsd); }
  if (updates.budgetAlertThresholds !== undefined) { sets.push('budget_alert_thresholds = ?'); args.push(JSON.stringify(updates.budgetAlertThresholds)); }
  if (updates.defaultModel !== undefined) { sets.push('default_model = ?'); args.push(updates.defaultModel); }
  if (updates.preferredProviders !== undefined) { sets.push('preferred_providers = ?'); args.push(JSON.stringify(updates.preferredProviders)); }
  if (updates.smartRoutingEnabled !== undefined) { sets.push('smart_routing_enabled = ?'); args.push(updates.smartRoutingEnabled ? 1 : 0); }

  if (sets.length === 0) return getTeam(teamId);

  sets.push('updated_at = ?');
  args.push(Math.floor(Date.now() / 1000));
  args.push(teamId);

  await db.execute({ sql: `UPDATE teams SET ${sets.join(', ')} WHERE id = ?`, args });
  return getTeam(teamId);
}

export async function deleteTeam(teamId: string): Promise<boolean> {
  const db = getClient();
  await db.execute({ sql: 'DELETE FROM teams WHERE id = ?', args: [teamId] });
  log.info('Team deleted', { teamId });
  return true;
}

// Member Management

export async function addMember(teamId: string, userId: string, role: TeamRole = 'member', invitedBy?: string): Promise<TeamMember> {
  const db = getClient();
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await db.execute({
    sql: `INSERT INTO team_members (id, team_id, user_id, role, joined_at, invited_by)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, teamId, userId, role, now, invitedBy ?? null],
  });

  // Update member count
  await db.execute({
    sql: `UPDATE teams SET member_count = (SELECT COUNT(*) FROM team_members WHERE team_id = ?) WHERE id = ?`,
    args: [teamId, teamId],
  });

  log.info('Member added', { teamId, userId, role });
  return getMember(teamId, userId) as Promise<TeamMember>;
}

export async function removeMember(teamId: string, userId: string): Promise<boolean> {
  const db = getClient();
  await db.execute({
    sql: 'DELETE FROM team_members WHERE team_id = ? AND user_id = ? AND role != ?',
    args: [teamId, userId, 'owner'], // can't remove owner
  });
  await db.execute({
    sql: `UPDATE teams SET member_count = (SELECT COUNT(*) FROM team_members WHERE team_id = ?) WHERE id = ?`,
    args: [teamId, teamId],
  });
  return true;
}

export async function getMember(teamId: string, userId: string): Promise<TeamMember | null> {
  const db = getClient();
  const result = await db.execute({
    sql: 'SELECT * FROM team_members WHERE team_id = ? AND user_id = ?',
    args: [teamId, userId],
  });
  if (result.rows.length === 0) return null;
  return rowToMember(result.rows[0] as unknown as MemberRow);
}

export async function listMembers(teamId: string): Promise<TeamMember[]> {
  const db = getClient();
  const result = await db.execute({
    sql: 'SELECT * FROM team_members WHERE team_id = ? ORDER BY role, joined_at',
    args: [teamId],
  });
  return result.rows.map(r => rowToMember(r as unknown as MemberRow));
}

export async function updateMemberRole(teamId: string, userId: string, newRole: TeamRole): Promise<boolean> {
  const db = getClient();
  await db.execute({
    sql: 'UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?',
    args: [newRole, teamId, userId],
  });
  return true;
}

// Usage Tracking

export async function recordMemberUsage(teamId: string, userId: string, costUsd: number): Promise<void> {
  const db = getClient();
  const now = Math.floor(Date.now() / 1000);

  await db.execute({
    sql: `UPDATE team_members
          SET total_spent_usd = total_spent_usd + ?,
              request_count = request_count + 1,
              last_active_at = ?
          WHERE team_id = ? AND user_id = ?`,
    args: [costUsd, now, teamId, userId],
  });
}

export async function getTeamUsage(teamId: string): Promise<TeamUsageSummary> {
  const team = await getTeam(teamId);
  if (!team) throw new Error('Team not found');

  const members = await listMembers(teamId);

  const totalSpent = members.reduce((sum, m) => sum + m.totalSpentUsd, 0);
  const budgetPercent = team.monthlyBudgetUsd > 0
    ? Math.round((totalSpent / team.monthlyBudgetUsd) * 100)
    : 0;

  const alertsTriggered = team.budgetAlertThresholds.filter(t => budgetPercent >= t);

  return {
    teamId,
    period: 'monthly',
    totalSpentUsd: totalSpent,
    budgetUsd: team.monthlyBudgetUsd,
    budgetUsedPercent: budgetPercent,
    memberBreakdown: members.map(m => ({
      userId: m.userId,
      spentUsd: m.totalSpentUsd,
      requestCount: m.requestCount,
    })),
    alertsTriggered,
  };
}

/**
 * Check if a member can make a request (budget check).
 */
export async function canMemberSpend(teamId: string, userId: string, estimatedCostUsd: number): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  const team = await getTeam(teamId);
  if (!team) return { allowed: false, reason: 'Team not found' };

  const member = await getMember(teamId, userId);
  if (!member) return { allowed: false, reason: 'Not a team member' };

  // Check personal budget
  if (member.personalBudgetUsd && member.totalSpentUsd + estimatedCostUsd > member.personalBudgetUsd) {
    return { allowed: false, reason: `Personal budget exceeded ($${member.totalSpentUsd.toFixed(2)} / $${member.personalBudgetUsd.toFixed(2)})` };
  }

  // Check team budget
  const usage = await getTeamUsage(teamId);
  if (usage.totalSpentUsd + estimatedCostUsd > team.monthlyBudgetUsd) {
    return { allowed: false, reason: `Team monthly budget exceeded ($${usage.totalSpentUsd.toFixed(2)} / $${team.monthlyBudgetUsd.toFixed(2)})` };
  }

  return { allowed: true };
}

// Invites

export async function createInvite(teamId: string, email: string, role: TeamRole, invitedBy: string): Promise<TeamInvite> {
  const db = getClient();
  const id = randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 3600; // 7 days

  await db.execute({
    sql: `INSERT INTO team_invites (id, team_id, email, role, invited_by, expires_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, teamId, email, role, invitedBy, expiresAt],
  });

  return { id, teamId, email, role, invitedBy, expiresAt };
}

export async function acceptInvite(inviteId: string, userId: string): Promise<TeamMember | null> {
  const db = getClient();
  const now = Math.floor(Date.now() / 1000);

  const result = await db.execute({
    sql: 'SELECT * FROM team_invites WHERE id = ? AND accepted_at IS NULL AND expires_at > ?',
    args: [inviteId, now],
  });

  if (result.rows.length === 0) return null;

  const invite = result.rows[0] as unknown as { team_id: string; role: string; invited_by: string };

  // Mark invite as accepted
  await db.execute({
    sql: 'UPDATE team_invites SET accepted_at = ? WHERE id = ?',
    args: [now, inviteId],
  });

  // Add member
  return addMember(invite.team_id, userId, invite.role as TeamRole, invite.invited_by);
}

export async function listTeamInvites(teamId: string): Promise<TeamInvite[]> {
  const db = getClient();
  const result = await db.execute({
    sql: 'SELECT * FROM team_invites WHERE team_id = ? AND accepted_at IS NULL ORDER BY expires_at DESC',
    args: [teamId],
  });
  return result.rows.map(r => {
    const row = r as unknown as Record<string, unknown>;
    return {
      id: String(row['id']),
      teamId: String(row['team_id']),
      email: String(row['email']),
      role: String(row['role']) as TeamRole,
      invitedBy: String(row['invited_by']),
      expiresAt: Number(row['expires_at']),
      acceptedAt: row['accepted_at'] ? Number(row['accepted_at']) : undefined,
    };
  });
}

// Row Mappers

interface TeamRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  avatar_url: string | null;
  owner_id: string;
  monthly_budget_usd: number;
  daily_budget_usd: number;
  budget_alert_thresholds: string;
  default_model: string | null;
  preferred_providers: string;
  smart_routing_enabled: number;
  member_count: number;
  created_at: number;
  updated_at: number;
}

interface MemberRow {
  id: string;
  team_id: string;
  user_id: string;
  role: string;
  personal_budget_usd: number | null;
  preferred_model: string | null;
  total_spent_usd: number;
  request_count: number;
  last_active_at: number | null;
  joined_at: number;
  invited_by: string | null;
}

function rowToTeam(row: TeamRow): Team {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
    ownerId: row.owner_id,
    monthlyBudgetUsd: row.monthly_budget_usd,
    dailyBudgetUsd: row.daily_budget_usd,
    budgetAlertThresholds: JSON.parse(row.budget_alert_thresholds) as number[],
    defaultModel: row.default_model ?? undefined,
    preferredProviders: JSON.parse(row.preferred_providers) as string[],
    smartRoutingEnabled: row.smart_routing_enabled === 1,
    memberCount: row.member_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMember(row: MemberRow): TeamMember {
  return {
    id: row.id,
    teamId: row.team_id,
    userId: row.user_id,
    role: row.role as TeamRole,
    personalBudgetUsd: row.personal_budget_usd ?? undefined,
    preferredModel: row.preferred_model ?? undefined,
    totalSpentUsd: row.total_spent_usd,
    requestCount: row.request_count,
    lastActiveAt: row.last_active_at ?? undefined,
    joinedAt: row.joined_at,
    invitedBy: row.invited_by ?? undefined,
  };
}
