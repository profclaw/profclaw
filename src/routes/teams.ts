/**
 * Teams API Routes
 *
 * Multi-user team management with shared cost budgets.
 * No other OSS AI tool has this.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  initTeamsTables,
  createTeam,
  getTeam,
  getTeamBySlug,
  listUserTeams,
  updateTeam,
  deleteTeam,
  addMember,
  removeMember,
  listMembers,
  updateMemberRole,
  getTeamUsage,
  canMemberSpend,
  createInvite,
  acceptInvite,
  listTeamInvites,
  type TeamRole,
} from '../teams/index.js';
import { createContextualLogger } from '../utils/logger.js';

const log = createContextualLogger('TeamsRoutes');
const app = new Hono();

// Lazy init
let initialized = false;
app.use('*', async (_c, next) => {
  if (!initialized) {
    initialized = true;
    try { await initTeamsTables(); } catch (e) {
      initialized = false;
      log.warn('Failed to init teams tables', { error: (e as Error).message });
    }
  }
  await next();
});

// Schemas

const createTeamSchema = z.object({
  name: z.string().min(1).max(50),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().max(200).optional(),
  ownerId: z.string(),
  monthlyBudget: z.number().min(0).optional(),
  dailyBudget: z.number().min(0).optional(),
});

const updateTeamSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  description: z.string().max(200).optional(),
  monthlyBudgetUsd: z.number().min(0).optional(),
  dailyBudgetUsd: z.number().min(0).optional(),
  budgetAlertThresholds: z.array(z.number().min(0).max(100)).optional(),
  defaultModel: z.string().optional(),
  preferredProviders: z.array(z.string()).optional(),
  smartRoutingEnabled: z.boolean().optional(),
});

const addMemberSchema = z.object({
  userId: z.string(),
  role: z.enum(['admin', 'member', 'viewer']).optional().default('member'),
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'viewer']).optional().default('member'),
  invitedBy: z.string(),
});

// Routes

/**
 * GET /api/teams - List teams for a user
 */
app.get('/', async (c) => {
  const userId = c.req.query('userId');
  if (!userId) return c.json({ error: 'userId query param required' }, 400);

  const teams = await listUserTeams(userId);
  return c.json({ success: true, teams, total: teams.length });
});

/**
 * POST /api/teams - Create a team
 */
app.post('/', zValidator('json', createTeamSchema), async (c) => {
  try {
    const body = c.req.valid('json');
    const team = await createTeam(body);
    return c.json({ success: true, team }, 201);
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

/**
 * GET /api/teams/:id - Get team details
 */
app.get('/:id', async (c) => {
  const { id } = c.req.param();
  const team = id.includes('-') ? await getTeam(id) : await getTeamBySlug(id);
  if (!team) return c.json({ success: false, error: 'Team not found' }, 404);
  return c.json({ success: true, team });
});

/**
 * PATCH /api/teams/:id - Update team settings
 */
app.patch('/:id', zValidator('json', updateTeamSchema), async (c) => {
  const { id } = c.req.param();
  const body = c.req.valid('json');
  const team = await updateTeam(id, body);
  if (!team) return c.json({ success: false, error: 'Team not found' }, 404);
  return c.json({ success: true, team });
});

/**
 * DELETE /api/teams/:id - Delete a team
 */
app.delete('/:id', async (c) => {
  const { id } = c.req.param();
  await deleteTeam(id);
  return c.json({ success: true, deleted: true });
});

// Members

/**
 * GET /api/teams/:id/members - List team members
 */
app.get('/:id/members', async (c) => {
  const { id } = c.req.param();
  const members = await listMembers(id);
  return c.json({ success: true, members, total: members.length });
});

/**
 * POST /api/teams/:id/members - Add a member
 */
app.post('/:id/members', zValidator('json', addMemberSchema), async (c) => {
  const { id } = c.req.param();
  const body = c.req.valid('json');
  try {
    const member = await addMember(id, body.userId, body.role as TeamRole);
    return c.json({ success: true, member }, 201);
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

/**
 * DELETE /api/teams/:id/members/:userId - Remove a member
 */
app.delete('/:id/members/:userId', async (c) => {
  const { id, userId } = c.req.param();
  await removeMember(id, userId);
  return c.json({ success: true, removed: true });
});

/**
 * PATCH /api/teams/:id/members/:userId/role - Change member role
 */
app.patch('/:id/members/:userId/role', zValidator('json', z.object({
  role: z.enum(['admin', 'member', 'viewer']),
})), async (c) => {
  const { id, userId } = c.req.param();
  const { role } = c.req.valid('json');
  await updateMemberRole(id, userId, role as TeamRole);
  return c.json({ success: true, role });
});

// Budget & Usage

/**
 * GET /api/teams/:id/usage - Get team usage summary
 */
app.get('/:id/usage', async (c) => {
  const { id } = c.req.param();
  try {
    const usage = await getTeamUsage(id);
    return c.json({ success: true, usage });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 404);
  }
});

/**
 * GET /api/teams/:id/budget/check - Check if a member can spend
 */
app.get('/:id/budget/check', async (c) => {
  const { id } = c.req.param();
  const userId = c.req.query('userId');
  const cost = parseFloat(c.req.query('cost') ?? '0.01');
  if (!userId) return c.json({ error: 'userId query param required' }, 400);

  const result = await canMemberSpend(id, userId, cost);
  return c.json({ success: true, ...result });
});

// Invites

/**
 * GET /api/teams/:id/invites - List pending invites
 */
app.get('/:id/invites', async (c) => {
  const { id } = c.req.param();
  const invites = await listTeamInvites(id);
  return c.json({ success: true, invites, total: invites.length });
});

/**
 * POST /api/teams/:id/invites - Create an invite
 */
app.post('/:id/invites', zValidator('json', inviteSchema), async (c) => {
  const { id } = c.req.param();
  const body = c.req.valid('json');
  const invite = await createInvite(id, body.email, body.role as TeamRole, body.invitedBy);
  return c.json({ success: true, invite }, 201);
});

/**
 * POST /api/teams/invites/:inviteId/accept - Accept an invite
 */
app.post('/invites/:inviteId/accept', zValidator('json', z.object({
  userId: z.string(),
})), async (c) => {
  const { inviteId } = c.req.param();
  const { userId } = c.req.valid('json');
  const member = await acceptInvite(inviteId, userId);
  if (!member) return c.json({ success: false, error: 'Invite not found or expired' }, 404);
  return c.json({ success: true, member });
});

export const teamRoutes = app;
