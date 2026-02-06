/**
 * States API Routes
 *
 * Handles custom workflow states for projects.
 */

import { Hono } from 'hono';
import { listStates, createState, updateState, deleteState, getState } from '../states/index.js';

export const statesRoutes = new Hono();

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
    const body = await c.req.json();
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
    const body = await c.req.json();
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
