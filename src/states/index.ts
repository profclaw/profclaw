/**
 * States Service
 *
 * Manages customizable workflow states for projects.
 * Maps custom states to core StateGroups (backlog, unstarted, started, completed, cancelled).
 */

import { randomUUID } from 'crypto';
import { eq, asc, isNull } from 'drizzle-orm';
import { getDb } from '../storage/index.js';
import { states } from '../storage/schema.js';
import type { StateGroup } from '../tickets/types.js';

export interface State {
  id: string;
  projectId: string | null;
  name: string;
  slug: string;
  color: string;
  description: string | null;
  stateGroup: StateGroup;
  isDefault: boolean;
  sequence: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateStateInput {
  projectId?: string;
  name: string;
  slug?: string;
  color?: string;
  description?: string;
  stateGroup: StateGroup;
  isDefault?: boolean;
  sequence?: number;
}

export interface UpdateStateInput {
  name?: string;
  slug?: string;
  color?: string;
  description?: string;
  statusGroup?: StateGroup;
  isDefault?: boolean;
  sequence?: number;
}

// STATE CRUD

/**
 * Create a new state
 */
export async function createState(input: CreateStateInput): Promise<State> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const id = randomUUID();
  const slug = input.slug || input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const now = new Date();

  // If this is the new default, unset existing default for this project
  if (input.isDefault) {
    await db
      .update(states)
      .set({ isDefault: false })
      .where(input.projectId ? eq(states.projectId, input.projectId) : isNull(states.projectId));
  }

  const newState = {
    id,
    projectId: input.projectId || null,
    name: input.name,
    slug,
    color: input.color || '#6B7280',
    description: input.description || null,
    stateGroup: input.stateGroup,
    isDefault: !!input.isDefault,
    sequence: input.sequence ?? 65535,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(states).values(newState);

  return newState as State;
}

/**
 * Get a state by ID
 */
export async function getState(id: string): Promise<State | null> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const result = await db.select().from(states).where(eq(states.id, id)).limit(1);
  return (result[0] as State) || null;
}

/**
 * List states for a project
 */
export async function listStates(projectId?: string): Promise<State[]> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const result = await db
    .select()
    .from(states)
    .where(projectId ? eq(states.projectId, projectId) : isNull(states.projectId))
    .orderBy(asc(states.sequence), asc(states.name));

  return result as State[];
}

/**
 * Update a state
 */
export async function updateState(id: string, input: UpdateStateInput): Promise<State> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const existing = await getState(id);
  if (!existing) throw new Error(`State ${id} not found`);

  // If setting as default, unset others first
  if (input.isDefault) {
    await db
      .update(states)
      .set({ isDefault: false })
      .where(existing.projectId ? eq(states.projectId, existing.projectId) : isNull(states.projectId));
  }

  const updates: Partial<typeof states.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) updates.name = input.name;
  if (input.slug !== undefined) updates.slug = input.slug;
  if (input.color !== undefined) updates.color = input.color;
  if (input.description !== undefined) updates.description = input.description;
  if (input.statusGroup !== undefined) updates.stateGroup = input.statusGroup;
  if (input.isDefault !== undefined) updates.isDefault = input.isDefault;
  if (input.sequence !== undefined) updates.sequence = input.sequence;

  await db.update(states).set(updates).where(eq(states.id, id));

  const updated = await getState(id);
  if (!updated) throw new Error(`State ${id} not found after update`);
  return updated;
}

/**
 * Delete a state
 */
export async function deleteState(id: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const state = await getState(id);
  if (!state) return;

  if (state.isDefault) {
    throw new Error('Cannot delete the default state. Set another state as default first.');
  }

  await db.delete(states).where(eq(states.id, id));
}

// PROJECT INITIALIZATION

/**
 * Initialize default states for a new project
 */
export async function initializeProjectStates(projectId: string): Promise<State[]> {
  const defaultStates: CreateStateInput[] = [
    { name: 'Backlog', slug: 'backlog', color: '#94a3b8', stateGroup: 'backlog', sequence: 1000 },
    { name: 'Todo', slug: 'todo', color: '#3b82f6', stateGroup: 'unstarted', sequence: 2000, isDefault: true },
    { name: 'In Progress', slug: 'in-progress', color: '#f59e0b', stateGroup: 'started', sequence: 3000 },
    { name: 'In Review', slug: 'in-review', color: '#8b5cf6', stateGroup: 'started', sequence: 4000 },
    { name: 'Done', slug: 'done', color: '#10b981', stateGroup: 'completed', sequence: 5000 },
    { name: 'Cancelled', slug: 'cancelled', color: '#6b7280', stateGroup: 'cancelled', sequence: 6000 },
  ];

  const results: State[] = [];
  for (const input of defaultStates) {
    const state = await createState({ ...input, projectId });
    results.push(state);
  }

  return results;
}
