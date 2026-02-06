/**
 * GLINR Projects & Sprints Service
 *
 * Multi-project support with custom ticket prefixes and sprint management.
 * Designed for bi-directional sync with Linear, Jira, GitHub.
 */

import { randomUUID } from 'crypto';
import { eq, and, desc, asc, like, sql, inArray, count } from 'drizzle-orm';
import { getDb } from '../storage/index.js';
import {
  projects,
  projectSequence,
  projectExternalLinks,
  sprints,
  sprintSequence,
  sprintTickets,
  tickets,
} from '../storage/schema.js';
import type {
  Project,
  ProjectWithRelations,
  CreateProjectInput,
  UpdateProjectInput,
  ProjectQuery,
  ProjectExternalLink,
  Sprint,
  SprintWithStats,
  CreateSprintInput,
  UpdateSprintInput,
  SprintQuery,
  SprintTicket,
  AddTicketsToSprintInput,
} from './types.js';
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  ProjectQuerySchema,
  CreateSprintSchema,
  UpdateSprintSchema,
  SprintQuerySchema,
  AddTicketsToSprintSchema,
} from './types.js';

// Re-export types
export * from './types.js';

// === Helpers ===

function generateId(): string {
  return randomUUID();
}

function toISOString(value: unknown): string {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) {
    const time = value.getTime();
    if (isNaN(time) || time < 0 || time > 8640000000000000) {
      return new Date().toISOString();
    }
    return value.toISOString();
  }
  if (typeof value === 'number') {
    const timestamp = value > 1e12 ? value : value * 1000;
    if (isNaN(timestamp) || timestamp < 0 || timestamp > 8640000000000000) {
      return new Date().toISOString();
    }
    return new Date(timestamp).toISOString();
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    const time = date.getTime();
    if (isNaN(time) || time < 0 || time > 8640000000000000) {
      return value;
    }
    return date.toISOString();
  }
  return new Date().toISOString();
}

function toOptionalISOString(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    const time = value.getTime();
    if (isNaN(time) || time < 0 || time > 8640000000000000) {
      return undefined;
    }
    return value.toISOString();
  }
  if (typeof value === 'number') {
    const timestamp = value > 1e12 ? value : value * 1000;
    if (isNaN(timestamp) || timestamp < 0 || timestamp > 8640000000000000) {
      return undefined;
    }
    return new Date(timestamp).toISOString();
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    const time = date.getTime();
    if (isNaN(time) || time < 0 || time > 8640000000000000) {
      return value;
    }
    return date.toISOString();
  }
  return undefined;
}

// === Project Sequence ===

async function getNextProjectSequence(workspaceId = 'default'): Promise<number> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const result = await db
    .insert(projectSequence)
    .values({ workspaceId, lastSequence: 1 })
    .onConflictDoUpdate({
      target: projectSequence.workspaceId,
      set: { lastSequence: sql`${projectSequence.lastSequence} + 1` },
    })
    .returning();

  return result[0]?.lastSequence ?? 1;
}

// === Sprint Sequence ===

async function getNextSprintSequence(projectId: string): Promise<number> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const result = await db
    .insert(sprintSequence)
    .values({ projectId, lastSequence: 1 })
    .onConflictDoUpdate({
      target: sprintSequence.projectId,
      set: { lastSequence: sql`${sprintSequence.lastSequence} + 1` },
    })
    .returning();

  return result[0]?.lastSequence ?? 1;
}

// === Row Converters ===

function rowToProject(row: any): Project {
  return {
    id: row.id,
    sequence: row.sequence,
    workspaceId: row.workspaceId || 'default',
    key: row.key,
    name: row.name,
    description: row.description || undefined,
    icon: row.icon || '📋',
    color: row.color || '#6366f1',
    defaultAssignee: row.defaultAssignee || undefined,
    defaultAgent: row.defaultAgent || undefined,
    defaultLabels: row.defaultLabels || [],
    cycleView: row.cycleView ?? true,
    boardView: row.boardView ?? true,
    lead: row.lead || undefined,
    status: row.status || 'active',
    createdAt: toISOString(row.createdAt),
    updatedAt: toISOString(row.updatedAt),
    archivedAt: toOptionalISOString(row.archivedAt),
  };
}

function rowToSprint(row: any): Sprint {
  return {
    id: row.id,
    sequence: row.sequence,
    projectId: row.projectId,
    name: row.name,
    goal: row.goal || undefined,
    description: row.description || undefined,
    status: row.status || 'planning',
    startDate: toOptionalISOString(row.startDate),
    endDate: toOptionalISOString(row.endDate),
    capacity: row.capacity || undefined,
    createdAt: toISOString(row.createdAt),
    updatedAt: toISOString(row.updatedAt),
    completedAt: toOptionalISOString(row.completedAt),
  };
}

function rowToExternalLink(row: any): ProjectExternalLink {
  return {
    id: row.id,
    projectId: row.projectId,
    platform: row.platform,
    externalId: row.externalId,
    externalUrl: row.externalUrl || undefined,
    syncEnabled: row.syncEnabled ?? true,
    syncDirection: row.syncDirection || 'bidirectional',
    lastSyncedAt: toOptionalISOString(row.lastSyncedAt),
    syncError: row.syncError || undefined,
    createdAt: toISOString(row.createdAt),
  };
}

// =============================================================================
// PROJECTS CRUD
// =============================================================================

/**
 * Create a new project
 */
export async function createProject(input: CreateProjectInput): Promise<Project> {
  const parsed = CreateProjectSchema.parse(input);
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const id = generateId();
  const sequence = await getNextProjectSequence();
  const now = new Date();

  const project: Project = {
    id,
    sequence,
    workspaceId: 'default',
    key: parsed.key,
    name: parsed.name,
    description: parsed.description,
    icon: parsed.icon || '📋',
    color: parsed.color || '#6366f1',
    defaultAssignee: parsed.defaultAssignee,
    defaultAgent: parsed.defaultAgent,
    defaultLabels: parsed.defaultLabels || [],
    cycleView: parsed.cycleView ?? true,
    boardView: parsed.boardView ?? true,
    lead: parsed.lead,
    status: 'active',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  await db.insert(projects).values({
    id: project.id,
    sequence: project.sequence,
    workspaceId: project.workspaceId,
    key: project.key,
    name: project.name,
    description: project.description,
    icon: project.icon,
    color: project.color,
    defaultAssignee: project.defaultAssignee,
    defaultAgent: project.defaultAgent,
    defaultLabels: project.defaultLabels,
    cycleView: project.cycleView,
    boardView: project.boardView,
    lead: project.lead,
    status: project.status,
    createdAt: now,
    updatedAt: now,
  });

  // Create external link if provided
  if (parsed.externalLink) {
    await createProjectExternalLink(id, {
      platform: parsed.externalLink.platform,
      externalId: parsed.externalLink.externalId,
      externalUrl: parsed.externalLink.externalUrl,
    });
  }

  return project;
}

/**
 * Get a project by ID
 */
export async function getProject(id: string): Promise<Project | null> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const result = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (result.length === 0) return null;

  return rowToProject(result[0]);
}

/**
 * Get a project by key (e.g., "GLINR")
 */
export async function getProjectByKey(key: string): Promise<Project | null> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const result = await db.select().from(projects).where(eq(projects.key, key.toUpperCase())).limit(1);
  if (result.length === 0) return null;

  return rowToProject(result[0]);
}

/**
 * Get a project with all relations (external links, stats)
 */
export async function getProjectWithRelations(id: string): Promise<ProjectWithRelations | null> {
  const project = await getProject(id);
  if (!project) return null;

  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  // Get external links
  const externalLinks = await db
    .select()
    .from(projectExternalLinks)
    .where(eq(projectExternalLinks.projectId, id));

  // Get ticket stats
  const ticketStatsResult = await db
    .select({
      status: tickets.status,
      count: count(),
    })
    .from(tickets)
    .where(eq(tickets.projectId, id))
    .groupBy(tickets.status);

  const stats = {
    totalTickets: 0,
    openTickets: 0,
    inProgressTickets: 0,
    doneTickets: 0,
  };

  for (const row of ticketStatsResult) {
    stats.totalTickets += Number(row.count);
    if (row.status === 'backlog' || row.status === 'todo') {
      stats.openTickets += Number(row.count);
    } else if (row.status === 'in_progress' || row.status === 'in_review') {
      stats.inProgressTickets += Number(row.count);
    } else if (row.status === 'done') {
      stats.doneTickets += Number(row.count);
    }
  }

  // Get active sprint count
  const activeSprintsResult = await db
    .select({ count: count() })
    .from(sprints)
    .where(and(eq(sprints.projectId, id), eq(sprints.status, 'active')));

  return {
    ...project,
    externalLinks: externalLinks.map(rowToExternalLink),
    ticketCount: stats.totalTickets,
    activeSprintCount: Number(activeSprintsResult[0]?.count || 0),
    stats,
  };
}

/**
 * Update a project
 */
export async function updateProject(id: string, input: UpdateProjectInput): Promise<Project> {
  const parsed = UpdateProjectSchema.parse(input);
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const now = new Date();

  await db
    .update(projects)
    .set({
      ...parsed,
      updatedAt: now,
    })
    .where(eq(projects.id, id));

  const updated = await getProject(id);
  if (!updated) throw new Error(`Project ${id} not found after update`);

  return updated;
}

/**
 * Archive a project
 */
export async function archiveProject(id: string): Promise<Project> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const now = new Date();

  await db
    .update(projects)
    .set({
      status: 'archived',
      archivedAt: now,
      updatedAt: now,
    })
    .where(eq(projects.id, id));

  const updated = await getProject(id);
  if (!updated) throw new Error(`Project ${id} not found after archive`);

  return updated;
}

/**
 * Delete a project (hard delete - use archiveProject instead in most cases)
 */
export async function deleteProject(id: string): Promise<boolean> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  // Delete external links first
  await db.delete(projectExternalLinks).where(eq(projectExternalLinks.projectId, id));

  // Delete project
  await db.delete(projects).where(eq(projects.id, id));

  return true;
}

/**
 * Query projects with filters
 */
export async function queryProjects(query: ProjectQuery = {}): Promise<{ projects: Project[]; total: number }> {
  const parsed = ProjectQuerySchema.parse(query);
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const conditions = [];

  // Status filter
  if (parsed.status) {
    if (Array.isArray(parsed.status)) {
      conditions.push(inArray(projects.status, parsed.status));
    } else {
      conditions.push(eq(projects.status, parsed.status));
    }
  } else if (!parsed.includeArchived) {
    conditions.push(eq(projects.status, 'active'));
  }

  // Workspace filter
  if (parsed.workspaceId) {
    conditions.push(eq(projects.workspaceId, parsed.workspaceId));
  }

  // Search filter
  if (parsed.search) {
    const searchPattern = `%${parsed.search}%`;
    conditions.push(
      sql`(${projects.name} LIKE ${searchPattern} OR ${projects.key} LIKE ${searchPattern} OR ${projects.description} LIKE ${searchPattern})`
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Sorting
  let orderBy: any = desc(projects.createdAt);
  if (parsed.sortBy === 'name') {
    orderBy = parsed.sortOrder === 'desc' ? desc(projects.name) : asc(projects.name);
  } else if (parsed.sortBy === 'key') {
    orderBy = parsed.sortOrder === 'desc' ? desc(projects.key) : asc(projects.key);
  } else if (parsed.sortBy === 'updatedAt') {
    orderBy = parsed.sortOrder === 'desc' ? desc(projects.updatedAt) : asc(projects.updatedAt);
  } else if (parsed.sortBy === 'createdAt') {
    orderBy = parsed.sortOrder === 'asc' ? asc(projects.createdAt) : desc(projects.createdAt);
  }

  const result = await db
    .select()
    .from(projects)
    .where(whereClause)
    .orderBy(orderBy)
    .limit(parsed.limit || 50)
    .offset(parsed.offset || 0);

  const totalResult = await db.select({ count: count() }).from(projects).where(whereClause);

  return {
    projects: result.map(rowToProject),
    total: Number(totalResult[0]?.count || 0),
  };
}

// =============================================================================
// PROJECT EXTERNAL LINKS
// =============================================================================

/**
 * Create an external link for a project (Linear Team, Jira Project, etc.)
 */
export async function createProjectExternalLink(
  projectId: string,
  input: { platform: string; externalId: string; externalUrl?: string }
): Promise<ProjectExternalLink> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const id = generateId();
  const now = new Date();

  await db.insert(projectExternalLinks).values({
    id,
    projectId,
    platform: input.platform,
    externalId: input.externalId,
    externalUrl: input.externalUrl,
    syncEnabled: true,
    syncDirection: 'bidirectional',
    createdAt: now,
  });

  return {
    id,
    projectId,
    platform: input.platform as any,
    externalId: input.externalId,
    externalUrl: input.externalUrl,
    syncEnabled: true,
    syncDirection: 'bidirectional',
    createdAt: now.toISOString(),
  };
}

/**
 * Get external links for a project
 */
export async function getProjectExternalLinks(projectId: string): Promise<ProjectExternalLink[]> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const result = await db
    .select()
    .from(projectExternalLinks)
    .where(eq(projectExternalLinks.projectId, projectId));

  return result.map(rowToExternalLink);
}

/**
 * Find project by external ID (for sync)
 */
export async function findProjectByExternalId(platform: string, externalId: string): Promise<Project | null> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const linkResult = await db
    .select()
    .from(projectExternalLinks)
    .where(and(eq(projectExternalLinks.platform, platform), eq(projectExternalLinks.externalId, externalId)))
    .limit(1);

  if (linkResult.length === 0) return null;

  return getProject(linkResult[0].projectId);
}

// =============================================================================
// SPRINTS CRUD
// =============================================================================

/**
 * Create a new sprint for a project
 */
export async function createSprint(projectId: string, input: CreateSprintInput): Promise<Sprint> {
  const parsed = CreateSprintSchema.parse(input);
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  // Verify project exists
  const project = await getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  const id = generateId();
  const sequence = await getNextSprintSequence(projectId);
  const now = new Date();

  const sprint: Sprint = {
    id,
    sequence,
    projectId,
    name: parsed.name,
    goal: parsed.goal,
    description: parsed.description,
    status: 'planning',
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    capacity: parsed.capacity,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  await db.insert(sprints).values({
    id: sprint.id,
    sequence: sprint.sequence,
    projectId: sprint.projectId,
    name: sprint.name,
    goal: sprint.goal,
    description: sprint.description,
    status: sprint.status,
    startDate: parsed.startDate ? new Date(parsed.startDate) : undefined,
    endDate: parsed.endDate ? new Date(parsed.endDate) : undefined,
    capacity: sprint.capacity,
    createdAt: now,
    updatedAt: now,
  });

  return sprint;
}

/**
 * Get a sprint by ID
 */
export async function getSprint(id: string): Promise<Sprint | null> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const result = await db.select().from(sprints).where(eq(sprints.id, id)).limit(1);
  if (result.length === 0) return null;

  return rowToSprint(result[0]);
}

/**
 * Get a sprint with stats (ticket counts, burndown data)
 */
export async function getSprintWithStats(id: string): Promise<SprintWithStats | null> {
  const sprint = await getSprint(id);
  if (!sprint) return null;

  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  // Get ticket stats for this sprint
  const ticketResults = await db
    .select({
      ticketId: sprintTickets.ticketId,
      status: tickets.status,
      estimate: tickets.estimate,
    })
    .from(sprintTickets)
    .innerJoin(tickets, eq(sprintTickets.ticketId, tickets.id))
    .where(eq(sprintTickets.sprintId, id));

  let ticketCount = 0;
  let completedCount = 0;
  let totalPoints = 0;
  let completedPoints = 0;

  for (const row of ticketResults) {
    ticketCount++;
    const points = row.estimate || 0;
    totalPoints += points;

    if (row.status === 'done') {
      completedCount++;
      completedPoints += points;
    }
  }

  return {
    ...sprint,
    ticketCount,
    completedCount,
    totalPoints,
    completedPoints,
  };
}

/**
 * Update a sprint
 */
export async function updateSprint(id: string, input: UpdateSprintInput): Promise<Sprint> {
  const parsed = UpdateSprintSchema.parse(input);
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const now = new Date();

  const updateData: any = {
    ...parsed,
    updatedAt: now,
  };

  // Convert date strings to Date objects
  if (parsed.startDate !== undefined) {
    updateData.startDate = parsed.startDate ? new Date(parsed.startDate) : null;
  }
  if (parsed.endDate !== undefined) {
    updateData.endDate = parsed.endDate ? new Date(parsed.endDate) : null;
  }

  await db.update(sprints).set(updateData).where(eq(sprints.id, id));

  const updated = await getSprint(id);
  if (!updated) throw new Error(`Sprint ${id} not found after update`);

  return updated;
}

/**
 * Start a sprint
 */
export async function startSprint(id: string): Promise<Sprint> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const sprint = await getSprint(id);
  if (!sprint) throw new Error(`Sprint ${id} not found`);

  if (sprint.status !== 'planning') {
    throw new Error(`Sprint ${id} cannot be started (current status: ${sprint.status})`);
  }

  const now = new Date();

  await db
    .update(sprints)
    .set({
      status: 'active',
      startDate: sprint.startDate ? new Date(sprint.startDate) : now,
      updatedAt: now,
    })
    .where(eq(sprints.id, id));

  const updated = await getSprint(id);
  if (!updated) throw new Error(`Sprint ${id} not found after start`);

  return updated;
}

/**
 * Complete a sprint
 */
export async function completeSprint(id: string): Promise<Sprint> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const sprint = await getSprint(id);
  if (!sprint) throw new Error(`Sprint ${id} not found`);

  if (sprint.status !== 'active') {
    throw new Error(`Sprint ${id} cannot be completed (current status: ${sprint.status})`);
  }

  const now = new Date();

  await db
    .update(sprints)
    .set({
      status: 'completed',
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(sprints.id, id));

  const updated = await getSprint(id);
  if (!updated) throw new Error(`Sprint ${id} not found after complete`);

  return updated;
}

/**
 * Cancel a sprint
 */
export async function cancelSprint(id: string): Promise<Sprint> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const now = new Date();

  await db
    .update(sprints)
    .set({
      status: 'cancelled',
      updatedAt: now,
    })
    .where(eq(sprints.id, id));

  const updated = await getSprint(id);
  if (!updated) throw new Error(`Sprint ${id} not found after cancel`);

  return updated;
}

/**
 * Delete a sprint
 */
export async function deleteSprint(id: string): Promise<boolean> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  // Remove all ticket assignments first
  await db.delete(sprintTickets).where(eq(sprintTickets.sprintId, id));

  // Delete sprint
  await db.delete(sprints).where(eq(sprints.id, id));

  return true;
}

/**
 * Query sprints with filters
 */
export async function querySprints(query: SprintQuery = {}): Promise<{ sprints: Sprint[]; total: number }> {
  const parsed = SprintQuerySchema.parse(query);
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const conditions = [];

  // Project filter
  if (parsed.projectId) {
    conditions.push(eq(sprints.projectId, parsed.projectId));
  }

  // Status filter
  if (parsed.status) {
    if (Array.isArray(parsed.status)) {
      conditions.push(inArray(sprints.status, parsed.status));
    } else {
      conditions.push(eq(sprints.status, parsed.status));
    }
  }

  // Search filter
  if (parsed.search) {
    const searchPattern = `%${parsed.search}%`;
    conditions.push(
      sql`(${sprints.name} LIKE ${searchPattern} OR ${sprints.goal} LIKE ${searchPattern} OR ${sprints.description} LIKE ${searchPattern})`
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Sorting
  let orderBy: any = desc(sprints.createdAt);
  if (parsed.sortBy === 'startDate') {
    orderBy = parsed.sortOrder === 'desc' ? desc(sprints.startDate) : asc(sprints.startDate);
  } else if (parsed.sortBy === 'endDate') {
    orderBy = parsed.sortOrder === 'desc' ? desc(sprints.endDate) : asc(sprints.endDate);
  } else if (parsed.sortBy === 'sequence') {
    orderBy = parsed.sortOrder === 'desc' ? desc(sprints.sequence) : asc(sprints.sequence);
  } else if (parsed.sortBy === 'createdAt') {
    orderBy = parsed.sortOrder === 'asc' ? asc(sprints.createdAt) : desc(sprints.createdAt);
  }

  const result = await db
    .select()
    .from(sprints)
    .where(whereClause)
    .orderBy(orderBy)
    .limit(parsed.limit || 50)
    .offset(parsed.offset || 0);

  const totalResult = await db.select({ count: count() }).from(sprints).where(whereClause);

  return {
    sprints: result.map(rowToSprint),
    total: Number(totalResult[0]?.count || 0),
  };
}

/**
 * Get sprints for a project
 */
export async function getProjectSprints(projectId: string): Promise<Sprint[]> {
  const result = await querySprints({ projectId, sortBy: 'sequence', sortOrder: 'asc' });
  return result.sprints;
}

/**
 * Get active sprint for a project
 */
export async function getActiveSprint(projectId: string): Promise<Sprint | null> {
  const result = await querySprints({ projectId, status: 'active', limit: 1 });
  return result.sprints[0] || null;
}

// =============================================================================
// SPRINT-TICKET ASSIGNMENTS
// =============================================================================

/**
 * Add tickets to a sprint
 */
export async function addTicketsToSprint(sprintId: string, input: AddTicketsToSprintInput): Promise<SprintTicket[]> {
  const parsed = AddTicketsToSprintSchema.parse(input);
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  // Verify sprint exists
  const sprint = await getSprint(sprintId);
  if (!sprint) throw new Error(`Sprint ${sprintId} not found`);

  const now = new Date();
  const results: SprintTicket[] = [];

  // Get current max sort order
  const maxOrderResult = await db
    .select({ maxOrder: sql<number>`MAX(${sprintTickets.sortOrder})` })
    .from(sprintTickets)
    .where(eq(sprintTickets.sprintId, sprintId));
  let nextOrder = (maxOrderResult[0]?.maxOrder || 0) + 1;

  for (const ticketId of parsed.ticketIds) {
    // Check if already assigned
    const existing = await db
      .select()
      .from(sprintTickets)
      .where(and(eq(sprintTickets.sprintId, sprintId), eq(sprintTickets.ticketId, ticketId)))
      .limit(1);

    if (existing.length > 0) continue; // Skip if already assigned

    const id = generateId();

    await db.insert(sprintTickets).values({
      id,
      sprintId,
      ticketId,
      sortOrder: nextOrder,
      addedAt: now,
    });

    results.push({
      id,
      sprintId,
      ticketId,
      sortOrder: nextOrder,
      addedAt: now.toISOString(),
    });

    nextOrder++;
  }

  return results;
}

/**
 * Remove a ticket from a sprint
 */
export async function removeTicketFromSprint(sprintId: string, ticketId: string): Promise<boolean> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  await db
    .delete(sprintTickets)
    .where(and(eq(sprintTickets.sprintId, sprintId), eq(sprintTickets.ticketId, ticketId)));

  return true;
}

/**
 * Get all tickets in a sprint
 */
export async function getSprintTickets(sprintId: string): Promise<string[]> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const result = await db
    .select({ ticketId: sprintTickets.ticketId })
    .from(sprintTickets)
    .where(eq(sprintTickets.sprintId, sprintId))
    .orderBy(asc(sprintTickets.sortOrder));

  return result.map((r: { ticketId: string }) => r.ticketId);
}

/**
 * Reorder tickets in a sprint
 */
export async function reorderSprintTickets(
  sprintId: string,
  ticketOrder: string[]
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  // Update sort order for each ticket
  for (let i = 0; i < ticketOrder.length; i++) {
    await db
      .update(sprintTickets)
      .set({ sortOrder: i })
      .where(and(eq(sprintTickets.sprintId, sprintId), eq(sprintTickets.ticketId, ticketOrder[i])));
  }
}

// =============================================================================
// DEFAULT PROJECT MANAGEMENT
// =============================================================================

/**
 * Get or create the default project
 */
export async function getOrCreateDefaultProject(): Promise<Project> {
  const existing = await getProjectByKey('GLINR');
  if (existing) return existing;

  return createProject({
    key: 'GLINR',
    name: 'GLINR Task Manager',
    description: 'Default project for GLINR tasks',
    icon: '🚀',
    color: '#6366f1',
  });
}

/**
 * Migrate existing tickets to default project
 */
export async function migrateTicketsToDefaultProject(): Promise<{ migrated: number }> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const defaultProject = await getOrCreateDefaultProject();

  const result = await db
    .update(tickets)
    .set({ projectId: defaultProject.id })
    .where(sql`${tickets.projectId} IS NULL`);

  // Get count of updated rows (libSQL might not return this directly)
  const countResult = await db
    .select({ count: count() })
    .from(tickets)
    .where(eq(tickets.projectId, defaultProject.id));

  return { migrated: Number(countResult[0]?.count || 0) };
}
