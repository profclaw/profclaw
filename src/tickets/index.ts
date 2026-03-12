/**
 * profClaw Ticket Service
 *
 * Core CRUD operations for AI-native tickets
 */

import { randomUUID } from "crypto";
import {
  eq,
  and,
  or,
  desc,
  asc,
  like,
  sql,
  inArray,
  gte,
  lte,
  isNull,
  notInArray,
} from "drizzle-orm";
import { getDb } from "../storage/index.js";
import {
  tickets,
  ticketExternalLinks,
  ticketRelations,
  ticketWatchers,
  ticketAssignees,
  ticketMentions,
  ticketAttachments,
  ticketReactions,
  ticketComments,
  ticketHistory,
  ticketSequence,
  sprintTickets,
} from "../storage/schema.js";
import type {
  Ticket,
  TicketWithRelations,
  CreateTicketInput,
  UpdateTicketInput,
  BulkUpdateTicketsInput,
  BulkDeleteTicketsInput,
  TicketQuery,
  ExternalLink,
  TicketRelation,
  TicketRelationType,
  TicketWatcher,
  TicketAssignee,
  TicketMention,
  TicketAttachment,
  TicketReaction,
  TicketComment,
  HistoryEntry,
} from "./types.js";
import {
  CreateTicketSchema,
  UpdateTicketSchema,
  BulkUpdateTicketsSchema,
  BulkDeleteTicketsSchema,
  TicketQuerySchema,
} from "./types.js";
import { logger } from "../utils/logger.js";

// Outbound sync callbacks (async, fire-and-forget)
let syncCallbacks: {
  onTicketChanged?: (
    ticketId: string,
    updates: Partial<Ticket>,
  ) => Promise<void>;
  onCommentCreated?: (
    ticketId: string,
    content: string,
    source: string,
  ) => Promise<void>;
} = {};

/**
 * Register sync callbacks (called by sync integration module)
 */
export function registerSyncCallbacks(callbacks: {
  onTicketChanged?: (
    ticketId: string,
    updates: Partial<Ticket>,
  ) => Promise<void>;
  onCommentCreated?: (
    ticketId: string,
    content: string,
    source: string,
  ) => Promise<void>;
}): void {
  syncCallbacks = callbacks;
}

// Re-export types
export * from "./types.js";

// === Helpers ===

function generateId(): string {
  return randomUUID();
}

async function getNextSequence(workspaceId = "default"): Promise<number> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  // Upsert sequence counter
  const result = await db
    .insert(ticketSequence)
    .values({ workspaceId, lastSequence: 1 })
    .onConflictDoUpdate({
      target: ticketSequence.workspaceId,
      set: { lastSequence: sql`${ticketSequence.lastSequence} + 1` },
    })
    .returning();

  return result[0]?.lastSequence ?? 1;
}

// === CRUD Operations ===

/**
 * Create a new ticket
 */
export async function createTicket(input: CreateTicketInput): Promise<Ticket> {
  const parsed = CreateTicketSchema.parse(input);
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const id = generateId();
  const sequence = await getNextSequence();
  const now = new Date().toISOString();

  const ticket: Ticket & { projectId?: string } = {
    id,
    sequence,
    projectId: parsed.projectId,
    title: parsed.title,
    description: parsed.description || "",
    descriptionHtml: undefined,
    type: parsed.type || "task",
    priority: parsed.priority || "medium",
    status: parsed.status || "backlog",
    labels: parsed.labels || [],
    assignee: parsed.assignee,
    assigneeAgent: parsed.assigneeAgent,
    parentId: parsed.parentId,
    linkedPRs: [],
    linkedCommits: [],
    linkedBranch: undefined,
    createdAt: now,
    updatedAt: now,
    startedAt: undefined,
    completedAt: undefined,
    startDate: parsed.startDate,
    dueDate: parsed.dueDate,
    createdBy: parsed.createdBy || "human",
    aiAgent: parsed.aiAgent,
    aiSessionId: parsed.aiSessionId,
    aiTaskId: parsed.aiTaskId,
    estimate: parsed.estimate,
    estimateUnit: parsed.estimateUnit,
  };

  await db.insert(tickets).values({
    id: ticket.id,
    sequence: ticket.sequence,
    projectId: ticket.projectId,
    title: ticket.title,
    description: ticket.description,
    type: ticket.type,
    priority: ticket.priority,
    status: ticket.status,
    labels: ticket.labels,
    assignee: ticket.assignee,
    assigneeAgent: ticket.assigneeAgent,
    parentId: ticket.parentId,
    linkedPRs: ticket.linkedPRs,
    linkedCommits: ticket.linkedCommits,
    createdBy: ticket.createdBy,
    aiAgent: ticket.aiAgent,
    aiSessionId: ticket.aiSessionId,
    aiTaskId: ticket.aiTaskId,
    startDate: ticket.startDate,
    dueDate: ticket.dueDate,
    estimate: ticket.estimate,
    estimateUnit: ticket.estimateUnit,
  });

  // Record creation in history
  await recordHistory(id, "created", undefined, "created", {
    type: parsed.createdBy || "human",
    name: parsed.aiAgent || "User",
    platform: "profclaw",
  });

  // Create external link if provided
  if (parsed.externalLink) {
    await createExternalLink(id, {
      platform: parsed.externalLink.platform,
      externalId: parsed.externalLink.externalId,
      externalUrl: parsed.externalLink.externalUrl,
    });
  }

  return ticket;
}

/**
 * Get a ticket by ID
 */
export async function getTicket(id: string): Promise<Ticket | null> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const result = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, id))
    .limit(1);
  if (result.length === 0) return null;

  const row = result[0];
  return rowToTicket(row);
}

/**
 * Get children of a ticket (for epics/parent tickets)
 */
export async function getChildren(parentId: string): Promise<Ticket[]> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const rows = await db
    .select()
    .from(tickets)
    .where(eq(tickets.parentId, parentId))
    .orderBy(asc(tickets.sequence));

  return rows.map(rowToTicket);
}

/**
 * Get a ticket with all relations
 */
export async function getTicketWithRelations(
  id: string,
): Promise<TicketWithRelations | null> {
  const ticket = await getTicket(id);
  if (!ticket) return null;

  const [
    externalLinks,
    relations,
    watchers,
    assignees,
    mentions,
    attachments,
    reactions,
    comments,
    history,
    children,
    parent,
  ] = await Promise.all([
    getExternalLinks(id),
    getTicketRelations(id),
    getTicketWatchers(id),
    getTicketAssignees(id),
    getTicketMentions(id),
    getTicketAttachments(id),
    getTicketReactions(id),
    getComments(id),
    getHistory(id),
    getChildren(id),
    ticket.parentId ? getTicket(ticket.parentId) : Promise.resolve(null),
  ]);

  return {
    ...ticket,
    externalLinks,
    relations,
    watchers,
    assignees,
    mentions,
    attachments,
    reactions,
    comments,
    history,
    children,
    parent: parent ?? undefined,
  };
}

/**
 * Update a ticket
 */
export async function updateTicket(
  id: string,
  input: UpdateTicketInput,
): Promise<Ticket | null> {
  const parsed = UpdateTicketSchema.parse(input);
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const existing = await getTicket(id);
  if (!existing) return null;

  const updates: Record<string, any> = {
    updatedAt: new Date(),
  };

  // Track changes for history
  const changes: Array<{
    field: string;
    oldValue: string | undefined;
    newValue: string | undefined;
  }> = [];

  if (parsed.title !== undefined && parsed.title !== existing.title) {
    updates.title = parsed.title;
    changes.push({
      field: "title",
      oldValue: existing.title,
      newValue: parsed.title,
    });
  }
  if (
    parsed.description !== undefined &&
    parsed.description !== existing.description
  ) {
    updates.description = parsed.description;
    changes.push({
      field: "description",
      oldValue: existing.description,
      newValue: parsed.description,
    });
  }
  if (parsed.type !== undefined && parsed.type !== existing.type) {
    updates.type = parsed.type;
    changes.push({
      field: "type",
      oldValue: existing.type,
      newValue: parsed.type,
    });
  }
  if (parsed.priority !== undefined && parsed.priority !== existing.priority) {
    updates.priority = parsed.priority;
    changes.push({
      field: "priority",
      oldValue: existing.priority,
      newValue: parsed.priority,
    });
  }
  if (parsed.status !== undefined && parsed.status !== existing.status) {
    updates.status = parsed.status;
    changes.push({
      field: "status",
      oldValue: existing.status,
      newValue: parsed.status,
    });

    // Auto-set timestamps based on status
    if (parsed.status === "in_progress" && !existing.startedAt) {
      updates.startedAt = new Date();
    }
    if (parsed.status === "done" || parsed.status === "cancelled") {
      updates.completedAt = new Date();
    }
  }
  if (parsed.labels !== undefined) {
    updates.labels = parsed.labels;
    changes.push({
      field: "labels",
      oldValue: JSON.stringify(existing.labels),
      newValue: JSON.stringify(parsed.labels),
    });
  }
  if (parsed.assignee !== undefined && parsed.assignee !== existing.assignee) {
    updates.assignee = parsed.assignee;
    changes.push({
      field: "assignee",
      oldValue: existing.assignee,
      newValue: parsed.assignee,
    });
  }
  if (
    parsed.assigneeAgent !== undefined &&
    parsed.assigneeAgent !== existing.assigneeAgent
  ) {
    updates.assigneeAgent = parsed.assigneeAgent;
    changes.push({
      field: "assigneeAgent",
      oldValue: existing.assigneeAgent,
      newValue: parsed.assigneeAgent,
    });
  }
  if (parsed.parentId !== undefined && parsed.parentId !== existing.parentId) {
    updates.parentId = parsed.parentId;
    changes.push({
      field: "parentId",
      oldValue: existing.parentId,
      newValue: parsed.parentId,
    });
  }
  if (parsed.dueDate !== undefined) {
    updates.dueDate = parsed.dueDate ? new Date(parsed.dueDate) : null;
    changes.push({
      field: "dueDate",
      oldValue: existing.dueDate,
      newValue: parsed.dueDate,
    });
  }
  if (parsed.startDate !== undefined) {
    updates.startDate = parsed.startDate ? new Date(parsed.startDate) : null;
    changes.push({
      field: "startDate",
      oldValue: existing.startDate,
      newValue: parsed.startDate,
    });
  }
  if (parsed.estimate !== undefined) {
    updates.estimate = parsed.estimate;
  }
  if (parsed.estimateUnit !== undefined) {
    updates.estimateUnit = parsed.estimateUnit;
  }
  if (
    parsed.projectId !== undefined &&
    parsed.projectId !== existing.projectId
  ) {
    updates.projectId = parsed.projectId;
    changes.push({
      field: "projectId",
      oldValue: existing.projectId,
      newValue: parsed.projectId,
    });
  }

  await db.update(tickets).set(updates).where(eq(tickets.id, id));

  // Record history for each change
  for (const change of changes) {
    await recordHistory(id, change.field, change.oldValue, change.newValue, {
      type: "human",
      name: "User",
      platform: "profclaw",
    });
  }

  // Trigger outbound sync (fire-and-forget)
  if (syncCallbacks.onTicketChanged && changes.length > 0) {
    syncCallbacks.onTicketChanged(id, parsed).catch((err) => {
      logger.error("[TicketService] Sync callback error", err as Error);
    });
  }

  return getTicket(id);
}

/**
 * Delete a ticket
 */
export async function deleteTicket(id: string): Promise<boolean> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  // Delete related records first
  await db
    .delete(ticketExternalLinks)
    .where(eq(ticketExternalLinks.ticketId, id));
  await db
    .delete(ticketRelations)
    .where(
      or(
        eq(ticketRelations.sourceTicketId, id),
        eq(ticketRelations.targetTicketId, id),
      ),
    );
  await db.delete(ticketComments).where(eq(ticketComments.ticketId, id));
  await db.delete(ticketHistory).where(eq(ticketHistory.ticketId, id));
  await db.delete(ticketWatchers).where(eq(ticketWatchers.ticketId, id));
  await db.delete(ticketAssignees).where(eq(ticketAssignees.ticketId, id));
  await db.delete(ticketMentions).where(eq(ticketMentions.ticketId, id));
  await db.delete(ticketAttachments).where(eq(ticketAttachments.ticketId, id));
  await db.delete(ticketReactions).where(eq(ticketReactions.ticketId, id));

  const result = await db.delete(tickets).where(eq(tickets.id, id));
  return true;
}

// === Bulk Operations ===

export async function bulkUpdateTickets(
  input: BulkUpdateTicketsInput,
): Promise<{
  updated: Ticket[];
  failed: Array<{ id: string; error: string }>;
}> {
  const parsed = BulkUpdateTicketsSchema.parse(input);
  const updated: Ticket[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const id of parsed.ids) {
    try {
      const ticket = await updateTicket(id, parsed.updates);
      if (ticket) {
        updated.push(ticket);
      } else {
        failed.push({ id, error: "Ticket not found" });
      }
    } catch (error) {
      failed.push({
        id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return { updated, failed };
}

export async function bulkDeleteTickets(
  input: BulkDeleteTicketsInput,
): Promise<{
  deletedIds: string[];
  failed: Array<{ id: string; error: string }>;
}> {
  const parsed = BulkDeleteTicketsSchema.parse(input);
  const deletedIds: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const id of parsed.ids) {
    try {
      const deleted = await deleteTicket(id);
      if (deleted) {
        deletedIds.push(id);
      } else {
        failed.push({ id, error: "Ticket not found" });
      }
    } catch (error) {
      failed.push({
        id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return { deletedIds, failed };
}

/**
 * Query tickets with filters
 */
export async function queryTickets(
  query: TicketQuery = {},
): Promise<{ tickets: Ticket[]; total: number }> {
  const parsed = TicketQuerySchema.parse(query);
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const conditions: any[] = [];

  // Project filter
  if (parsed.projectId) {
    conditions.push(eq(tickets.projectId, parsed.projectId));
  }

  // Status filter
  if (parsed.status) {
    const statuses = Array.isArray(parsed.status)
      ? parsed.status
      : [parsed.status];
    conditions.push(inArray(tickets.status, statuses));
  }

  // Type filter
  if (parsed.type) {
    const types = Array.isArray(parsed.type) ? parsed.type : [parsed.type];
    conditions.push(inArray(tickets.type, types));
  }

  // Priority filter
  if (parsed.priority) {
    const priorities = Array.isArray(parsed.priority)
      ? parsed.priority
      : [parsed.priority];
    conditions.push(inArray(tickets.priority, priorities));
  }

  // Assignee filter
  if (parsed.assignee) {
    conditions.push(eq(tickets.assignee, parsed.assignee));
  }

  // Agent filter
  if (parsed.assigneeAgent) {
    conditions.push(eq(tickets.assigneeAgent, parsed.assigneeAgent));
  }

  // Parent filter
  if (parsed.parentId) {
    conditions.push(eq(tickets.parentId, parsed.parentId));
  }

  // Search
  if (parsed.search) {
    conditions.push(
      or(
        like(tickets.title, `%${parsed.search}%`),
        like(tickets.description, `%${parsed.search}%`),
      ),
    );
  }

  // Date filters
  if (parsed.createdAfter) {
    conditions.push(gte(tickets.createdAt, new Date(parsed.createdAfter)));
  }
  if (parsed.createdBefore) {
    conditions.push(lte(tickets.createdAt, new Date(parsed.createdBefore)));
  }

  if (parsed.startDateAfter) {
    conditions.push(gte(tickets.startDate, new Date(parsed.startDateAfter)));
  }
  if (parsed.startDateBefore) {
    conditions.push(lte(tickets.startDate, new Date(parsed.startDateBefore)));
  }

  // CreatedBy filter (human vs ai)
  if (parsed.createdBy) {
    conditions.push(eq(tickets.createdBy, parsed.createdBy));
  }

  // Single label filter (case-insensitive search in labels JSON array)
  if (parsed.label) {
    // SQLite JSON contains search - labels is stored as JSON array
    conditions.push(
      sql`EXISTS (SELECT 1 FROM json_each(${tickets.labels}) WHERE json_each.value LIKE ${`%${parsed.label}%`})`,
    );
  }

  // Multiple labels filter
  if (parsed.labels && parsed.labels.length > 0) {
    // All specified labels must be present
    for (const label of parsed.labels) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM json_each(${tickets.labels}) WHERE json_each.value LIKE ${`%${label}%`})`,
      );
    }
  }

  // Cursor-based pagination (Phase 17)
  // When cursor is provided, filter for items "after" the cursor
  // For DESC order: createdAt < cursorCreatedAt OR (createdAt = cursorCreatedAt AND id < cursorId)
  // For ASC order: createdAt > cursorCreatedAt OR (createdAt = cursorCreatedAt AND id > cursorId)
  if (parsed.cursorCreatedAt && parsed.cursorId) {
    const cursorTime = parsed.cursorCreatedAt;
    const cursorId = parsed.cursorId;
    const isDesc = parsed.sortOrder !== "asc";

    if (isDesc) {
      conditions.push(
        or(
          sql`${tickets.createdAt} < ${cursorTime}`,
          and(
            sql`${tickets.createdAt} = ${cursorTime}`,
            sql`${tickets.id} < ${cursorId}`,
          ),
        ),
      );
    } else {
      conditions.push(
        or(
          sql`${tickets.createdAt} > ${cursorTime}`,
          and(
            sql`${tickets.createdAt} = ${cursorTime}`,
            sql`${tickets.id} > ${cursorId}`,
          ),
        ),
      );
    }
  }

  // Build where clause
  let whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Handle sprint filtering - requires subquery or join
  let ticketIdsToFilter: string[] = [];

  if (parsed.sprintId) {
    // Get ticket IDs in this sprint
    const sprintTicketRows = await db
      .select({ ticketId: sprintTickets.ticketId })
      .from(sprintTickets)
      .where(eq(sprintTickets.sprintId, parsed.sprintId));
    ticketIdsToFilter = sprintTicketRows.map(
      (r: { ticketId: string }) => r.ticketId,
    );

    if (ticketIdsToFilter.length === 0) {
      return { tickets: [], total: 0 };
    }
    // Add IN condition for sprint tickets
    conditions.push(inArray(tickets.id, ticketIdsToFilter));
    whereClause = and(...conditions);
  } else if (parsed.inBacklog) {
    // Get all ticket IDs that ARE in a sprint, then exclude them
    const ticketsInSprints = await db
      .selectDistinct({ ticketId: sprintTickets.ticketId })
      .from(sprintTickets);
    const excludeIds = ticketsInSprints.map(
      (r: { ticketId: string }) => r.ticketId,
    );

    if (excludeIds.length > 0) {
      // Add NOT IN condition
      conditions.push(
        sql`${tickets.id} NOT IN (${sql.join(
          excludeIds.map((id: string) => sql`${id}`),
          sql`, `,
        )})`,
      );
      whereClause = and(...conditions);
    }
  }

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(tickets)
    .where(whereClause);
  const total = countResult[0]?.count ?? 0;

  // Sorting
  const sortColumn =
    parsed.sortBy === "priority"
      ? tickets.priority
      : parsed.sortBy === "updatedAt"
        ? tickets.updatedAt
        : parsed.sortBy === "sequence"
          ? tickets.sequence
          : parsed.sortBy === "dueDate"
            ? tickets.dueDate
            : parsed.sortBy === "startDate"
              ? tickets.startDate
              : tickets.createdAt;
  const sortOrder =
    parsed.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);

  // Pagination
  const limit = parsed.limit || 50;
  const offset = parsed.offset || 0;
  const useCursor = !!(parsed.cursorCreatedAt && parsed.cursorId);

  // When using cursor, don't use offset (cursor already filters)
  const rows = useCursor
    ? await db
        .select()
        .from(tickets)
        .where(whereClause)
        .orderBy(sortOrder)
        .limit(limit)
    : await db
        .select()
        .from(tickets)
        .where(whereClause)
        .orderBy(sortOrder)
        .limit(limit)
        .offset(offset);

  return {
    tickets: rows.map(rowToTicket),
    total,
  };
}

// === Relations ===

export async function createTicketRelation(
  sourceTicketId: string,
  targetTicketId: string,
  relationType: TicketRelationType,
): Promise<TicketRelation> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const id = generateId();
  const now = new Date().toISOString();

  await db.insert(ticketRelations).values({
    id,
    sourceTicketId,
    targetTicketId,
    relationType,
  });

  return {
    id,
    sourceTicketId,
    targetTicketId,
    relationType,
    createdAt: now,
  };
}

export async function getTicketRelations(
  ticketId: string,
): Promise<TicketRelation[]> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const rows = await db
    .select()
    .from(ticketRelations)
    .where(
      or(
        eq(ticketRelations.sourceTicketId, ticketId),
        eq(ticketRelations.targetTicketId, ticketId),
      ),
    )
    .orderBy(desc(ticketRelations.createdAt));

  return rows.map((row: any) => ({
    id: row.id,
    sourceTicketId: row.sourceTicketId,
    targetTicketId: row.targetTicketId,
    relationType: row.relationType as TicketRelationType,
    createdAt: toISOString(row.createdAt),
  }));
}

export async function deleteTicketRelation(
  relationId: string,
  ticketId?: string,
): Promise<boolean> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const conditions = [eq(ticketRelations.id, relationId)];
  if (ticketId) {
    const relationScope = or(
      eq(ticketRelations.sourceTicketId, ticketId),
      eq(ticketRelations.targetTicketId, ticketId),
    );
    if (relationScope) {
      conditions.push(relationScope);
    }
  }

  const existing = await db
    .select({ id: ticketRelations.id })
    .from(ticketRelations)
    .where(and(...conditions))
    .limit(1);

  if (existing.length === 0) return false;

  await db.delete(ticketRelations).where(eq(ticketRelations.id, relationId));
  return true;
}

// === Watchers ===

export async function addTicketWatcher(
  ticketId: string,
  userId: string,
): Promise<TicketWatcher> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const existing = await db
    .select({ id: ticketWatchers.id })
    .from(ticketWatchers)
    .where(
      and(
        eq(ticketWatchers.ticketId, ticketId),
        eq(ticketWatchers.userId, userId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0];
    return {
      id: row.id,
      ticketId,
      userId,
      createdAt: new Date().toISOString(),
    };
  }

  const id = generateId();
  const now = new Date().toISOString();

  await db.insert(ticketWatchers).values({
    id,
    ticketId,
    userId,
  });

  return { id, ticketId, userId, createdAt: now };
}

export async function removeTicketWatcher(
  ticketId: string,
  userId: string,
): Promise<boolean> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const existing = await db
    .select({ id: ticketWatchers.id })
    .from(ticketWatchers)
    .where(
      and(
        eq(ticketWatchers.ticketId, ticketId),
        eq(ticketWatchers.userId, userId),
      ),
    )
    .limit(1);

  if (existing.length === 0) return false;

  await db
    .delete(ticketWatchers)
    .where(
      and(
        eq(ticketWatchers.ticketId, ticketId),
        eq(ticketWatchers.userId, userId),
      ),
    );
  return true;
}

export async function getTicketWatchers(
  ticketId: string,
): Promise<TicketWatcher[]> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const rows = await db
    .select()
    .from(ticketWatchers)
    .where(eq(ticketWatchers.ticketId, ticketId))
    .orderBy(desc(ticketWatchers.createdAt));

  return rows.map((row: any) => ({
    id: row.id,
    ticketId: row.ticketId,
    userId: row.userId,
    createdAt: toISOString(row.createdAt),
  }));
}

// === Assignees ===

export async function addTicketAssignee(
  ticketId: string,
  userId: string,
): Promise<TicketAssignee> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const existing = await db
    .select({ id: ticketAssignees.id })
    .from(ticketAssignees)
    .where(
      and(
        eq(ticketAssignees.ticketId, ticketId),
        eq(ticketAssignees.userId, userId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0];
    return {
      id: row.id,
      ticketId,
      userId,
      createdAt: new Date().toISOString(),
    };
  }

  const id = generateId();
  const now = new Date().toISOString();

  await db.insert(ticketAssignees).values({
    id,
    ticketId,
    userId,
  });

  return { id, ticketId, userId, createdAt: now };
}

export async function removeTicketAssignee(
  ticketId: string,
  userId: string,
): Promise<boolean> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const existing = await db
    .select({ id: ticketAssignees.id })
    .from(ticketAssignees)
    .where(
      and(
        eq(ticketAssignees.ticketId, ticketId),
        eq(ticketAssignees.userId, userId),
      ),
    )
    .limit(1);

  if (existing.length === 0) return false;

  await db
    .delete(ticketAssignees)
    .where(
      and(
        eq(ticketAssignees.ticketId, ticketId),
        eq(ticketAssignees.userId, userId),
      ),
    );
  return true;
}

export async function getTicketAssignees(
  ticketId: string,
): Promise<TicketAssignee[]> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const rows = await db
    .select()
    .from(ticketAssignees)
    .where(eq(ticketAssignees.ticketId, ticketId))
    .orderBy(desc(ticketAssignees.createdAt));

  return rows.map((row: any) => ({
    id: row.id,
    ticketId: row.ticketId,
    userId: row.userId,
    createdAt: toISOString(row.createdAt),
  }));
}

// === Mentions ===

export async function addTicketMention(params: {
  ticketId: string;
  userId: string;
  source: "description" | "comment" | "history";
  sourceId?: string;
}): Promise<TicketMention> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const id = generateId();
  const now = new Date().toISOString();

  await db.insert(ticketMentions).values({
    id,
    ticketId: params.ticketId,
    userId: params.userId,
    source: params.source,
    sourceId: params.sourceId,
  });

  return {
    id,
    ticketId: params.ticketId,
    userId: params.userId,
    source: params.source,
    sourceId: params.sourceId,
    createdAt: now,
  };
}

export async function getTicketMentions(
  ticketId: string,
): Promise<TicketMention[]> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const rows = await db
    .select()
    .from(ticketMentions)
    .where(eq(ticketMentions.ticketId, ticketId))
    .orderBy(desc(ticketMentions.createdAt));

  return rows.map((row: any) => ({
    id: row.id,
    ticketId: row.ticketId,
    userId: row.userId,
    source: row.source as TicketMention["source"],
    sourceId: row.sourceId ?? undefined,
    createdAt: toISOString(row.createdAt),
  }));
}

// === Attachments ===

export async function addTicketAttachment(params: {
  ticketId: string;
  fileName: string;
  fileType?: string;
  fileSize?: number;
  url: string;
  storagePath?: string;
  uploadedBy?: string;
}): Promise<TicketAttachment> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const id = generateId();
  const now = new Date().toISOString();

  await db.insert(ticketAttachments).values({
    id,
    ticketId: params.ticketId,
    fileName: params.fileName,
    fileType: params.fileType,
    fileSize: params.fileSize,
    url: params.url,
    storagePath: params.storagePath,
    uploadedBy: params.uploadedBy,
  });

  return {
    id,
    ticketId: params.ticketId,
    fileName: params.fileName,
    fileType: params.fileType,
    fileSize: params.fileSize,
    url: params.url,
    storagePath: params.storagePath,
    uploadedBy: params.uploadedBy,
    createdAt: now,
  };
}

export async function getTicketAttachments(
  ticketId: string,
): Promise<TicketAttachment[]> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const rows = await db
    .select()
    .from(ticketAttachments)
    .where(eq(ticketAttachments.ticketId, ticketId))
    .orderBy(desc(ticketAttachments.createdAt));

  return rows.map((row: any) => ({
    id: row.id,
    ticketId: row.ticketId,
    fileName: row.fileName,
    fileType: row.fileType ?? undefined,
    fileSize: row.fileSize ?? undefined,
    url: row.url,
    storagePath: row.storagePath ?? undefined,
    uploadedBy: row.uploadedBy ?? undefined,
    createdAt: toISOString(row.createdAt),
  }));
}

export async function deleteTicketAttachment(
  attachmentId: string,
  ticketId?: string,
): Promise<boolean> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const conditions = [eq(ticketAttachments.id, attachmentId)];
  if (ticketId) {
    conditions.push(eq(ticketAttachments.ticketId, ticketId));
  }

  const existing = await db
    .select({ id: ticketAttachments.id })
    .from(ticketAttachments)
    .where(and(...conditions))
    .limit(1);

  if (existing.length === 0) return false;

  await db
    .delete(ticketAttachments)
    .where(eq(ticketAttachments.id, attachmentId));
  return true;
}

// === Reactions ===

export async function addTicketReaction(params: {
  ticketId: string;
  userId: string;
  emoji: string;
}): Promise<TicketReaction> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const existing = await db
    .select({ id: ticketReactions.id })
    .from(ticketReactions)
    .where(
      and(
        eq(ticketReactions.ticketId, params.ticketId),
        eq(ticketReactions.userId, params.userId),
        eq(ticketReactions.emoji, params.emoji),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0];
    return {
      id: row.id,
      ticketId: params.ticketId,
      userId: params.userId,
      emoji: params.emoji,
      createdAt: new Date().toISOString(),
    };
  }

  const id = generateId();
  const now = new Date().toISOString();

  await db.insert(ticketReactions).values({
    id,
    ticketId: params.ticketId,
    userId: params.userId,
    emoji: params.emoji,
  });

  return {
    id,
    ticketId: params.ticketId,
    userId: params.userId,
    emoji: params.emoji,
    createdAt: now,
  };
}

export async function getTicketReactions(
  ticketId: string,
): Promise<TicketReaction[]> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const rows = await db
    .select()
    .from(ticketReactions)
    .where(eq(ticketReactions.ticketId, ticketId))
    .orderBy(desc(ticketReactions.createdAt));

  return rows.map((row: any) => ({
    id: row.id,
    ticketId: row.ticketId,
    userId: row.userId,
    emoji: row.emoji,
    createdAt: toISOString(row.createdAt),
  }));
}

export async function deleteTicketReaction(
  reactionId: string,
  ticketId?: string,
): Promise<boolean> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const conditions = [eq(ticketReactions.id, reactionId)];
  if (ticketId) {
    conditions.push(eq(ticketReactions.ticketId, ticketId));
  }

  const existing = await db
    .select({ id: ticketReactions.id })
    .from(ticketReactions)
    .where(and(...conditions))
    .limit(1);

  if (existing.length === 0) return false;

  await db.delete(ticketReactions).where(eq(ticketReactions.id, reactionId));
  return true;
}

// === External Links ===

export async function createExternalLink(
  ticketId: string,
  link: { platform: string; externalId: string; externalUrl?: string },
): Promise<ExternalLink> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const id = generateId();
  const now = new Date().toISOString();

  await db.insert(ticketExternalLinks).values({
    id,
    ticketId,
    platform: link.platform,
    externalId: link.externalId,
    externalUrl: link.externalUrl,
  });

  return {
    id,
    ticketId,
    platform: link.platform as any,
    externalId: link.externalId,
    externalUrl: link.externalUrl,
    syncEnabled: true,
    syncDirection: "bidirectional",
    createdAt: now,
  };
}

export async function getExternalLinks(
  ticketId: string,
): Promise<ExternalLink[]> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const rows = await db
    .select()
    .from(ticketExternalLinks)
    .where(eq(ticketExternalLinks.ticketId, ticketId));

  return rows.map((row: any) => ({
    id: row.id,
    ticketId: row.ticketId,
    platform: row.platform as any,
    externalId: row.externalId,
    externalUrl: row.externalUrl ?? undefined,
    syncEnabled: row.syncEnabled,
    syncDirection: row.syncDirection as any,
    lastSyncedAt: toOptionalISOString(row.lastSyncedAt),
    syncError: row.syncError ?? undefined,
    createdAt: toISOString(row.createdAt),
  }));
}

// === Comments ===

export async function addComment(
  ticketId: string,
  content: string,
  author: { type: "human" | "ai"; name: string; platform: string },
): Promise<TicketComment> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const id = generateId();
  const now = new Date().toISOString();

  await db.insert(ticketComments).values({
    id,
    ticketId,
    content,
    authorType: author.type,
    authorName: author.name,
    authorPlatform: author.platform,
    source: author.platform as any,
    isAiResponse: author.type === "ai",
  });

  // Trigger outbound sync (fire-and-forget)
  if (syncCallbacks.onCommentCreated) {
    syncCallbacks
      .onCommentCreated(ticketId, content, author.platform)
      .catch((err) => {
        logger.error(
          "[TicketService] Comment sync callback error",
          err as Error,
        );
      });
  }

  return {
    id,
    ticketId,
    content,
    author: { type: author.type, name: author.name, platform: author.platform },
    source: author.platform as any,
    isAiResponse: author.type === "ai",
    createdAt: now,
  };
}

export async function getComments(ticketId: string): Promise<TicketComment[]> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const rows = await db
    .select()
    .from(ticketComments)
    .where(eq(ticketComments.ticketId, ticketId))
    .orderBy(asc(ticketComments.createdAt));

  return rows.map((row: any) => ({
    id: row.id,
    ticketId: row.ticketId,
    content: row.content,
    contentHtml: row.contentHtml ?? undefined,
    author: {
      type: row.authorType as any,
      name: row.authorName,
      platform: row.authorPlatform,
      avatarUrl: row.authorAvatarUrl ?? undefined,
    },
    source: row.source as any,
    externalId: row.externalId ?? undefined,
    isAiResponse: row.isAiResponse,
    respondingTo: row.respondingTo ?? undefined,
    createdAt: toISOString(row.createdAt),
    updatedAt: toOptionalISOString(row.updatedAt),
  }));
}

// === History ===

async function recordHistory(
  ticketId: string,
  field: string,
  oldValue: string | undefined,
  newValue: string | undefined,
  changedBy: { type: "human" | "ai"; name: string; platform: string },
): Promise<void> {
  const db = getDb();
  if (!db) return;

  await db.insert(ticketHistory).values({
    id: generateId(),
    ticketId,
    field,
    oldValue,
    newValue,
    changedByType: changedBy.type,
    changedByName: changedBy.name,
    changedByPlatform: changedBy.platform,
  });
}

export async function getHistory(ticketId: string): Promise<HistoryEntry[]> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const rows = await db
    .select()
    .from(ticketHistory)
    .where(eq(ticketHistory.ticketId, ticketId))
    .orderBy(desc(ticketHistory.timestamp));

  return rows.map((row: any) => ({
    id: row.id,
    ticketId: row.ticketId,
    field: row.field,
    oldValue: row.oldValue ?? undefined,
    newValue: row.newValue ?? undefined,
    changedBy: {
      type: row.changedByType as any,
      name: row.changedByName,
      platform: row.changedByPlatform,
    },
    timestamp: toISOString(row.timestamp),
  }));
}

// === Sync Helpers ===

/**
 * Get a ticket by its external link (for sync engine)
 */
export async function getTicketByExternalLink(
  platform: string,
  externalId: string,
): Promise<Ticket | null> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const links = await db
    .select()
    .from(ticketExternalLinks)
    .where(
      and(
        eq(ticketExternalLinks.platform, platform),
        eq(ticketExternalLinks.externalId, externalId),
      ),
    )
    .limit(1);

  if (links.length === 0) return null;

  return getTicket(links[0].ticketId);
}

/**
 * Update an external link (for sync engine)
 */
export async function updateExternalLink(
  id: string,
  updates: { lastSyncedAt?: string; syncError?: string; syncEnabled?: boolean },
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const updateData: Record<string, any> = {};
  if (updates.lastSyncedAt)
    updateData.lastSyncedAt = new Date(updates.lastSyncedAt);
  if (updates.syncError !== undefined)
    updateData.syncError = updates.syncError || null;
  if (updates.syncEnabled !== undefined)
    updateData.syncEnabled = updates.syncEnabled;

  await db
    .update(ticketExternalLinks)
    .set(updateData)
    .where(eq(ticketExternalLinks.id, id));
}

/**
 * Create a ticket from sync (with external link)
 */
export async function createTicketFromSync(
  ticket: Omit<Ticket, "id" | "sequence">,
  link: { platform: string; externalId: string; externalUrl?: string },
): Promise<Ticket> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const id = generateId();
  const sequence = await getNextSequence();

  const newTicket: Ticket = {
    ...ticket,
    id,
    sequence,
  };

  await db.insert(tickets).values({
    id: newTicket.id,
    sequence: newTicket.sequence,
    title: newTicket.title,
    description: newTicket.description,
    type: newTicket.type,
    priority: newTicket.priority,
    status: newTicket.status,
    labels: newTicket.labels,
    assignee: newTicket.assignee,
    assigneeAgent: newTicket.assigneeAgent,
    parentId: newTicket.parentId,
    linkedPRs: newTicket.linkedPRs,
    linkedCommits: newTicket.linkedCommits,
    createdBy: newTicket.createdBy,
    aiAgent: newTicket.aiAgent,
    aiSessionId: newTicket.aiSessionId,
    aiTaskId: newTicket.aiTaskId,
    startDate: newTicket.startDate,
    dueDate: newTicket.dueDate,
    estimate: newTicket.estimate,
    estimateUnit: newTicket.estimateUnit,
  });

  // Create external link
  await createExternalLink(id, link);

  // Record creation in history
  await recordHistory(
    id,
    "created",
    undefined,
    `synced from ${link.platform}`,
    {
      type: "human",
      name: link.platform,
      platform: link.platform,
    },
  );

  return newTicket;
}

/**
 * Update a ticket from sync (with source tracking)
 */
export async function updateTicketFromSync(
  id: string,
  updates: UpdateTicketInput,
  source: string,
): Promise<Ticket | null> {
  const parsed = UpdateTicketSchema.parse(updates);
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const existing = await getTicket(id);
  if (!existing) return null;

  const dbUpdates: Record<string, any> = {
    updatedAt: new Date(),
  };

  // Track changes for history
  const changes: Array<{
    field: string;
    oldValue: string | undefined;
    newValue: string | undefined;
  }> = [];

  if (parsed.title !== undefined && parsed.title !== existing.title) {
    dbUpdates.title = parsed.title;
    changes.push({
      field: "title",
      oldValue: existing.title,
      newValue: parsed.title,
    });
  }
  if (
    parsed.description !== undefined &&
    parsed.description !== existing.description
  ) {
    dbUpdates.description = parsed.description;
    changes.push({
      field: "description",
      oldValue: existing.description,
      newValue: parsed.description,
    });
  }
  if (parsed.type !== undefined && parsed.type !== existing.type) {
    dbUpdates.type = parsed.type;
    changes.push({
      field: "type",
      oldValue: existing.type,
      newValue: parsed.type,
    });
  }
  if (parsed.priority !== undefined && parsed.priority !== existing.priority) {
    dbUpdates.priority = parsed.priority;
    changes.push({
      field: "priority",
      oldValue: existing.priority,
      newValue: parsed.priority,
    });
  }
  if (parsed.status !== undefined && parsed.status !== existing.status) {
    dbUpdates.status = parsed.status;
    changes.push({
      field: "status",
      oldValue: existing.status,
      newValue: parsed.status,
    });

    // Auto-set timestamps based on status
    if (parsed.status === "in_progress" && !existing.startedAt) {
      dbUpdates.startedAt = new Date();
    }
    if (parsed.status === "done" || parsed.status === "cancelled") {
      dbUpdates.completedAt = new Date();
    }
  }
  if (parsed.labels !== undefined) {
    dbUpdates.labels = parsed.labels;
    changes.push({
      field: "labels",
      oldValue: JSON.stringify(existing.labels),
      newValue: JSON.stringify(parsed.labels),
    });
  }
  if (parsed.assignee !== undefined && parsed.assignee !== existing.assignee) {
    dbUpdates.assignee = parsed.assignee;
    changes.push({
      field: "assignee",
      oldValue: existing.assignee,
      newValue: parsed.assignee,
    });
  }
  if (parsed.startDate !== undefined) {
    dbUpdates.startDate = parsed.startDate ? new Date(parsed.startDate) : null;
    changes.push({
      field: "startDate",
      oldValue: existing.startDate,
      newValue: parsed.startDate,
    });
  }
  if (parsed.dueDate !== undefined) {
    dbUpdates.dueDate = parsed.dueDate ? new Date(parsed.dueDate) : null;
    changes.push({
      field: "dueDate",
      oldValue: existing.dueDate,
      newValue: parsed.dueDate,
    });
  }
  if (parsed.startDate !== undefined) {
    dbUpdates.startDate = parsed.startDate ? new Date(parsed.startDate) : null;
    changes.push({
      field: "startDate",
      oldValue: existing.startDate,
      newValue: parsed.startDate,
    });
  }

  await db.update(tickets).set(dbUpdates).where(eq(tickets.id, id));

  // Record history with source
  for (const change of changes) {
    await recordHistory(id, change.field, change.oldValue, change.newValue, {
      type: "human",
      name: source,
      platform: source,
    });
  }

  return getTicket(id);
}

/**
 * Add a comment from sync (external source)
 */
export async function addCommentFromSync(
  ticketId: string,
  content: string,
  author: { type: "human" | "ai"; name: string; platform: string },
  externalId?: string,
): Promise<TicketComment> {
  const db = getDb();
  if (!db) throw new Error("Database not initialized");

  const id = generateId();
  const now = new Date().toISOString();

  await db.insert(ticketComments).values({
    id,
    ticketId,
    content,
    authorType: author.type,
    authorName: author.name,
    authorPlatform: author.platform,
    source: author.platform as any,
    externalId,
    isAiResponse: author.type === "ai",
  });

  return {
    id,
    ticketId,
    content,
    author,
    source: author.platform as any,
    externalId,
    isAiResponse: author.type === "ai",
    createdAt: now,
  };
}

// === Helpers ===

function toISOString(value: unknown): string {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) {
    const time = value.getTime();
    if (isNaN(time) || time < 0 || time > 8640000000000000) {
      return new Date().toISOString();
    }
    return value.toISOString();
  }
  if (typeof value === "number") {
    // Handle numeric timestamps (could be ms or seconds)
    const timestamp = value > 1e12 ? value : value * 1000; // Assume seconds if too small
    if (isNaN(timestamp) || timestamp < 0 || timestamp > 8640000000000000) {
      return new Date().toISOString();
    }
    return new Date(timestamp).toISOString();
  }
  if (typeof value === "string") {
    const date = new Date(value);
    const time = date.getTime();
    if (isNaN(time) || time < 0 || time > 8640000000000000) {
      return value; // Return original string if invalid
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
  if (typeof value === "number") {
    // Handle numeric timestamps (could be ms or seconds)
    const timestamp = value > 1e12 ? value : value * 1000;
    if (isNaN(timestamp) || timestamp < 0 || timestamp > 8640000000000000) {
      return undefined;
    }
    return new Date(timestamp).toISOString();
  }
  if (typeof value === "string") {
    const date = new Date(value);
    const time = date.getTime();
    if (isNaN(time) || time < 0 || time > 8640000000000000) {
      return value; // Return original string if invalid
    }
    return date.toISOString();
  }
  return undefined;
}

function rowToTicket(
  row: any,
): Ticket & { projectId?: string; projectKey?: string; projectName?: string } {
  return {
    id: row.id,
    sequence: row.sequence,
    workspaceId: row.workspaceId ?? undefined,
    projectId: row.projectId ?? undefined,
    projectKey: row.projectKey ?? undefined,
    projectName: row.projectName ?? undefined,
    title: row.title,
    description: row.description,
    descriptionHtml: row.descriptionHtml ?? undefined,
    type: row.type,
    priority: row.priority,
    status: row.status,
    labels: row.labels || [],
    assignee: row.assignee ?? undefined,
    assigneeAgent: row.assigneeAgent ?? undefined,
    parentId: row.parentId ?? undefined,
    linkedPRs: row.linkedPRs || [],
    linkedCommits: row.linkedCommits || [],
    linkedBranch: row.linkedBranch ?? undefined,
    createdAt: toISOString(row.createdAt),
    updatedAt: toISOString(row.updatedAt),
    startedAt: toOptionalISOString(row.startedAt),
    completedAt: toOptionalISOString(row.completedAt),
    startDate: toOptionalISOString(row.startDate),
    dueDate: toOptionalISOString(row.dueDate),
    createdBy: row.createdBy,
    aiAgent: row.aiAgent ?? undefined,
    aiSessionId: row.aiSessionId ?? undefined,
    aiTaskId: row.aiTaskId ?? undefined,
    estimate: row.estimate ?? undefined,
    estimateUnit: row.estimateUnit ?? undefined,
  };
}
