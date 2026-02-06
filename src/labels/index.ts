/**
 * Labels Service
 *
 * Manages labels for tickets with support for:
 * - Project-scoped labels
 * - Hierarchical labels (parent/child)
 * - External sync tracking (GitHub, Linear)
 */

import { randomUUID } from 'crypto';
import { eq, and, isNull, desc, asc } from 'drizzle-orm';
import { getDb } from '../storage/index.js';
import { labels, ticketLabels } from '../storage/schema.js';

// TODO(@copilot): Generate unit tests for this module
// Key functions to test: createLabel, getLabel, listLabels, updateLabel, deleteLabel, addLabelToTicket, removeLabelFromTicket, getTicketLabels, setTicketLabels, findLabelByExternalId, findOrCreateLabel, syncLabelsFromGitHub
// Test file location: src/labels/tests/index.test.ts

// Types
export interface Label {
  id: string;
  projectId: string | null;
  name: string;
  description: string | null;
  color: string;
  parentId: string | null;
  sortOrder: number;
  externalSource: string | null;
  externalId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLabelInput {
  projectId?: string;
  name: string;
  description?: string;
  color?: string;
  parentId?: string;
  externalSource?: string;
  externalId?: string;
}

export interface UpdateLabelInput {
  name?: string;
  description?: string;
  color?: string;
  parentId?: string | null;
  sortOrder?: number;
}

// =============================================================================
// LABEL CRUD
// =============================================================================

/**
 * Create a new label
 */
export async function createLabel(input: CreateLabelInput): Promise<Label> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const id = randomUUID();
  const now = new Date();

  // Get max sort order for this project
  const existing = await db
    .select({ sortOrder: labels.sortOrder })
    .from(labels)
    .where(input.projectId ? eq(labels.projectId, input.projectId) : isNull(labels.projectId))
    .orderBy(desc(labels.sortOrder))
    .limit(1);

  const sortOrder = (existing[0]?.sortOrder ?? 0) + 10000;

  const newLabel = {
    id,
    projectId: input.projectId || null,
    name: input.name,
    description: input.description || null,
    color: input.color || '#6B7280',
    parentId: input.parentId || null,
    sortOrder,
    externalSource: input.externalSource || null,
    externalId: input.externalId || null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(labels).values(newLabel);

  return newLabel as Label;
}

/**
 * Get a label by ID
 */
export async function getLabel(id: string): Promise<Label | null> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const result = await db.select().from(labels).where(eq(labels.id, id)).limit(1);
  return (result[0] as Label) || null;
}

/**
 * List labels for a project (or workspace-level if no projectId)
 */
export async function listLabels(projectId?: string): Promise<Label[]> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const result = await db
    .select()
    .from(labels)
    .where(projectId ? eq(labels.projectId, projectId) : isNull(labels.projectId))
    .orderBy(asc(labels.sortOrder), asc(labels.name));

  return result as Label[];
}

/**
 * Update a label
 */
export async function updateLabel(id: string, input: UpdateLabelInput): Promise<Label> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const updates: any = { updatedAt: new Date() };
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;
  if (input.color !== undefined) updates.color = input.color;
  if (input.parentId !== undefined) updates.parentId = input.parentId;
  if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;

  await db.update(labels).set(updates).where(eq(labels.id, id));

  const updated = await getLabel(id);
  if (!updated) throw new Error(`Label ${id} not found`);
  return updated;
}

/**
 * Delete a label
 */
export async function deleteLabel(id: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  // Delete ticket-label associations first
  await db.delete(ticketLabels).where(eq(ticketLabels.labelId, id));

  // Delete the label
  await db.delete(labels).where(eq(labels.id, id));
}

// =============================================================================
// TICKET-LABEL ASSOCIATIONS
// =============================================================================

/**
 * Add a label to a ticket
 */
export async function addLabelToTicket(ticketId: string, labelId: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  // Check if already exists
  const existing = await db
    .select()
    .from(ticketLabels)
    .where(and(eq(ticketLabels.ticketId, ticketId), eq(ticketLabels.labelId, labelId)))
    .limit(1);

  if (existing.length > 0) return; // Already exists

  await db.insert(ticketLabels).values({
    id: randomUUID(),
    ticketId,
    labelId,
    addedAt: new Date(),
  });
}

/**
 * Remove a label from a ticket
 */
export async function removeLabelFromTicket(ticketId: string, labelId: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  await db
    .delete(ticketLabels)
    .where(and(eq(ticketLabels.ticketId, ticketId), eq(ticketLabels.labelId, labelId)));
}

/**
 * Get all labels for a ticket
 */
export async function getTicketLabels(ticketId: string): Promise<Label[]> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const result = await db
    .select({
      id: labels.id,
      projectId: labels.projectId,
      name: labels.name,
      description: labels.description,
      color: labels.color,
      parentId: labels.parentId,
      sortOrder: labels.sortOrder,
      externalSource: labels.externalSource,
      externalId: labels.externalId,
      createdAt: labels.createdAt,
      updatedAt: labels.updatedAt,
    })
    .from(ticketLabels)
    .innerJoin(labels, eq(ticketLabels.labelId, labels.id))
    .where(eq(ticketLabels.ticketId, ticketId))
    .orderBy(asc(labels.sortOrder));

  return result as Label[];
}

/**
 * Set all labels for a ticket (replaces existing)
 */
export async function setTicketLabels(ticketId: string, labelIds: string[]): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  // Remove all existing labels
  await db.delete(ticketLabels).where(eq(ticketLabels.ticketId, ticketId));

  // Add new labels
  if (labelIds.length > 0) {
    const now = new Date();
    await db.insert(ticketLabels).values(
      labelIds.map((labelId) => ({
        id: randomUUID(),
        ticketId,
        labelId,
        addedAt: now,
      }))
    );
  }
}

// =============================================================================
// EXTERNAL SYNC HELPERS
// =============================================================================

/**
 * Find a label by external source and ID
 */
export async function findLabelByExternalId(
  projectId: string,
  externalSource: string,
  externalId: string
): Promise<Label | null> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const result = await db
    .select()
    .from(labels)
    .where(
      and(
        eq(labels.projectId, projectId),
        eq(labels.externalSource, externalSource),
        eq(labels.externalId, externalId)
      )
    )
    .limit(1);

  return (result[0] as Label) || null;
}

/**
 * Find or create a label from external source
 */
export async function findOrCreateLabel(
  projectId: string,
  name: string,
  options: {
    color?: string;
    externalSource?: string;
    externalId?: string;
  } = {}
): Promise<Label> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  // Try to find by external ID first
  if (options.externalSource && options.externalId) {
    const byExternal = await findLabelByExternalId(
      projectId,
      options.externalSource,
      options.externalId
    );
    if (byExternal) return byExternal;
  }

  // Try to find by name
  const byName = await db
    .select()
    .from(labels)
    .where(and(eq(labels.projectId, projectId), eq(labels.name, name)))
    .limit(1);

  if (byName[0]) return byName[0] as Label;

  // Create new label
  return createLabel({
    projectId,
    name,
    color: options.color,
    externalSource: options.externalSource,
    externalId: options.externalId,
  });
}

/**
 * Sync labels from GitHub issue labels
 */
export async function syncLabelsFromGitHub(
  projectId: string,
  githubLabels: Array<{ name: string; color?: string }>
): Promise<Label[]> {
  const synced: Label[] = [];

  for (const ghLabel of githubLabels) {
    const label = await findOrCreateLabel(projectId, ghLabel.name, {
      color: ghLabel.color ? `#${ghLabel.color}` : undefined,
      externalSource: 'github',
      externalId: ghLabel.name, // GitHub uses name as ID
    });
    synced.push(label);
  }

  return synced;
}
