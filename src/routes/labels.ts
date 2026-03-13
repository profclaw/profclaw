/**
 * Labels API Routes
 *
 * CRUD operations for labels with project scoping.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import {
  createLabel,
  getLabel,
  listLabels,
  updateLabel,
  deleteLabel,
  getTicketLabels,
  addLabelToTicket,
  removeLabelFromTicket,
  setTicketLabels,
} from '../labels/index.js';

export const labelsRoutes = new Hono();

function getErrorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

const createLabelBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  color: z.string().optional(),
  parentId: z.string().optional(),
});

const updateLabelBodySchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  color: z.string().optional(),
  parentId: z.string().nullable().optional(),
  sortOrder: z.number().optional(),
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

// PROJECT LABELS

/**
 * GET /api/projects/:projectId/labels
 * List all labels for a project
 */
labelsRoutes.get('/projects/:projectId/labels', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const labelsList = await listLabels(projectId);

    return c.json({
      labels: labelsList,
      count: labelsList.length,
    });
  } catch (error) {
    console.error('[Labels] List error:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to list labels' },
      500
    );
  }
});

/**
 * POST /api/projects/:projectId/labels
 * Create a new label for a project
 */
labelsRoutes.post('/projects/:projectId/labels', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const parsed = await parseJsonBody(c);
    if (!parsed.ok) {
      return parsed.response;
    }

    const bodyParse = createLabelBodySchema.safeParse(parsed.body);
    if (!bodyParse.success) {
      return c.json({ error: 'name is required' }, 400);
    }

    const body = bodyParse.data;

    const label = await createLabel({
      projectId,
      name: body.name,
      description: body.description,
      color: body.color,
      parentId: body.parentId,
    });

    return c.json(label, 201);
  } catch (error: unknown) {
    console.error('[Labels] Create error:', error);

    if (getErrorMessage(error)?.includes('UNIQUE constraint')) {
      return c.json({ error: 'A label with this name already exists' }, 409);
    }

    return c.json(
      { error: getErrorMessage(error) ?? 'Failed to create label' },
      500
    );
  }
});

/**
 * GET /api/labels/:id
 * Get a single label by ID
 */
labelsRoutes.get('/labels/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const label = await getLabel(id);

    if (!label) {
      return c.json({ error: 'Label not found' }, 404);
    }

    return c.json(label);
  } catch (error) {
    console.error('[Labels] Get error:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to get label' },
      500
    );
  }
});

/**
 * PATCH /api/labels/:id
 * Update a label
 */
labelsRoutes.patch('/labels/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const parsed = await parseJsonBody(c);
    if (!parsed.ok) {
      return parsed.response;
    }

    const bodyParse = updateLabelBodySchema.safeParse(parsed.body);
    if (!bodyParse.success) {
      return c.json({ error: 'Invalid label update' }, 400);
    }

    const body = bodyParse.data;

    const label = await updateLabel(id, {
      name: body.name,
      description: body.description,
      color: body.color,
      parentId: body.parentId,
      sortOrder: body.sortOrder,
    });

    return c.json(label);
  } catch (error: unknown) {
    console.error('[Labels] Update error:', error);

    if (getErrorMessage(error)?.includes('not found')) {
      return c.json({ error: 'Label not found' }, 404);
    }

    return c.json(
      { error: getErrorMessage(error) ?? 'Failed to update label' },
      500
    );
  }
});

/**
 * DELETE /api/labels/:id
 * Delete a label
 */
labelsRoutes.delete('/labels/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await deleteLabel(id);
    return c.json({ success: true });
  } catch (error) {
    console.error('[Labels] Delete error:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to delete label' },
      500
    );
  }
});

// TICKET LABELS

/**
 * GET /api/tickets/:ticketId/labels
 * Get all labels for a ticket
 */
labelsRoutes.get('/tickets/:ticketId/labels', async (c) => {
  try {
    const ticketId = c.req.param('ticketId');
    const labelsList = await getTicketLabels(ticketId);

    return c.json({
      labels: labelsList,
      count: labelsList.length,
    });
  } catch (error) {
    console.error('[Labels] Get ticket labels error:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to get ticket labels' },
      500
    );
  }
});

/**
 * PUT /api/tickets/:ticketId/labels
 * Set all labels for a ticket (replaces existing)
 */
labelsRoutes.put('/tickets/:ticketId/labels', async (c) => {
  try {
    const ticketId = c.req.param('ticketId');
    const parsed = await parseJsonBody(c);
    if (!parsed.ok) {
      return parsed.response;
    }

    const body = parsed.body;

    if (!Array.isArray(body.labelIds)) {
      return c.json({ error: 'labelIds must be an array' }, 400);
    }

    await setTicketLabels(ticketId, body.labelIds);
    const labels = await getTicketLabels(ticketId);

    return c.json({
      labels,
      count: labels.length,
    });
  } catch (error) {
    console.error('[Labels] Set ticket labels error:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to set ticket labels' },
      500
    );
  }
});

/**
 * POST /api/tickets/:ticketId/labels/:labelId
 * Add a label to a ticket
 */
labelsRoutes.post('/tickets/:ticketId/labels/:labelId', async (c) => {
  try {
    const ticketId = c.req.param('ticketId');
    const labelId = c.req.param('labelId');

    await addLabelToTicket(ticketId, labelId);

    return c.json({ success: true });
  } catch (error) {
    console.error('[Labels] Add label to ticket error:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to add label' },
      500
    );
  }
});

/**
 * DELETE /api/tickets/:ticketId/labels/:labelId
 * Remove a label from a ticket
 */
labelsRoutes.delete('/tickets/:ticketId/labels/:labelId', async (c) => {
  try {
    const ticketId = c.req.param('ticketId');
    const labelId = c.req.param('labelId');

    await removeLabelFromTicket(ticketId, labelId);

    return c.json({ success: true });
  } catch (error) {
    console.error('[Labels] Remove label from ticket error:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to remove label' },
      500
    );
  }
});
