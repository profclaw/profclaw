/**
 * States API Routes
 *
 * Handles custom workflow states for projects.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { listStates, createState, updateState, deleteState } from '../states/index.js';

export const statesRoutes = new Hono();

const createStateBodySchema = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  color: z.string().optional(),
  description: z.string().optional(),
  stateGroup: z.enum(['backlog', 'unstarted', 'started', 'completed', 'cancelled']),
  isDefault: z.boolean().optional(),
  sequence: z.number().optional(),
});

const updateStateBodySchema = z.object({
  name: z.string().optional(),
  slug: z.string().optional(),
  color: z.string().optional(),
  description: z.string().optional(),
  statusGroup: z.enum(['backlog', 'unstarted', 'started', 'completed', 'cancelled']).optional(),
  isDefault: z.boolean().optional(),
  sequence: z.number().optional(),
});

async function parseJsonBody(c: Context): Promise<
  { ok: true; body: Record<string, unknown> } | { ok: false; response: Response }
> {
  try {
    const body = await c.req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return {
        ok: false,
        response: c.json({ error: 'Request body must be a JSON object' }, 400),
      };
    }

    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      response: c.json({ error: 'Invalid JSON body' }, 400),
    };
  }
}

/**
 * GET /api/projects/:projectId/states
 * List all states for a project
 */
statesRoutes.get('/projects/:projectId/states', async (c) => {
  const projectId = c.req.param('projectId');
  try {
    const states = await listStates(projectId);
    return c.json({ states });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to list states' }, 500);
  }
});

/**
 * POST /api/projects/:projectId/states
 * Create a new state for a project
 */
statesRoutes.post('/projects/:projectId/states', async (c) => {
  const projectId = c.req.param('projectId');
  try {
    const parsed = await parseJsonBody(c);
    if (!parsed.ok) {
      return parsed.response;
    }

    const bodyParse = createStateBodySchema.safeParse(parsed.body);
    if (!bodyParse.success) {
      return c.json({ error: 'Invalid state payload' }, 400);
    }
    const body = bodyParse.data;
    const state = await createState({
      ...body,
      projectId,
    });
    return c.json({ state }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to create state' }, 400);
  }
});

/**
 * PATCH /api/states/:id
 * Update a state
 */
statesRoutes.patch('/states/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const parsed = await parseJsonBody(c);
    if (!parsed.ok) {
      return parsed.response;
    }

    const bodyParse = updateStateBodySchema.safeParse(parsed.body);
    if (!bodyParse.success) {
      return c.json({ error: 'Invalid state update' }, 400);
    }
    const body = bodyParse.data;
    const state = await updateState(id, body);
    return c.json({ state });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to update state' }, 400);
  }
});

/**
 * DELETE /api/states/:id
 * Delete a state
 */
statesRoutes.delete('/states/:id', async (c) => {
  const id = c.req.param('id');
  try {
    await deleteState(id);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to delete state' }, 400);
  }
});
