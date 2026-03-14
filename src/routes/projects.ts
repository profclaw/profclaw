/**
 * Projects & Sprints API Routes
 *
 * Multi-project support with custom ticket prefixes and sprint management.
 */

import { Hono } from 'hono';
import { createContextualLogger } from '../utils/logger.js';

const log = createContextualLogger('Projects');
import {
  // Projects
  createProject,
  getProject,
  getProjectByKey,
  getProjectWithRelations,
  updateProject,
  archiveProject,
  deleteProject,
  queryProjects,
  createProjectExternalLink,
  getProjectExternalLinks,
  findProjectByExternalId,
  getOrCreateDefaultProject,
  migrateTicketsToDefaultProject,
  // Sprints
  createSprint,
  getSprint,
  getSprintWithStats,
  updateSprint,
  startSprint,
  completeSprint,
  cancelSprint,
  deleteSprint,
  querySprints,
  getActiveSprint,
  // Sprint-Tickets
  addTicketsToSprint,
  removeTicketFromSprint,
  getSprintTickets,
  reorderSprintTickets,
  // Schemas
  CreateProjectSchema,
  UpdateProjectSchema,
  CreateSprintSchema,
  UpdateSprintSchema,
  AddTicketsToSprintSchema,
} from '../projects/index.js';

const projectsRouter = new Hono();

function getErrorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const code = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : undefined;
}

function errorMessageIncludes(error: unknown, snippet: string): boolean {
  return getErrorMessage(error)?.includes(snippet) ?? false;
}

// PROJECTS ROUTES

/**
 * GET /projects - List all projects
 */
projectsRouter.get('/', async (c) => {
  const queryParams: Record<string, unknown> = {};

  const status = c.req.query('status');
  const search = c.req.query('search') || c.req.query('q');
  const workspaceId = c.req.query('workspaceId');
  const sortBy = c.req.query('sortBy');
  const sortOrder = c.req.query('sortOrder');
  const limit = c.req.query('limit');
  const offset = c.req.query('offset');
  const includeArchived = c.req.query('includeArchived');

  if (status) queryParams.status = status.includes(',') ? status.split(',') : status;
  if (search) queryParams.search = search;
  if (workspaceId) queryParams.workspaceId = workspaceId;
  if (sortBy) queryParams.sortBy = sortBy;
  if (sortOrder) queryParams.sortOrder = sortOrder;
  if (limit) queryParams.limit = parseInt(limit);
  if (offset) queryParams.offset = parseInt(offset);
  if (includeArchived === 'true') queryParams.includeArchived = true;

  try {
    const result = await queryProjects(queryParams);
    return c.json({
      projects: result.projects,
      total: result.total,
      limit: queryParams.limit || 50,
      offset: queryParams.offset || 0,
    });
  } catch (error) {
    log.error('Error querying projects', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to query projects' }, 500);
  }
});

/**
 * POST /projects - Create a new project
 */
projectsRouter.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = CreateProjectSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({
        error: 'Validation failed',
        details: parsed.error.flatten(),
      }, 400);
    }

    const project = await createProject(parsed.data);

    return c.json({
      message: 'Project created',
      project,
    }, 201);
  } catch (error: unknown) {
    log.error('Error creating project', error instanceof Error ? error : new Error(String(error)));

    // Check for unique constraint violation
    if (errorMessageIncludes(error, 'UNIQUE constraint failed') || getErrorCode(error) === 'SQLITE_CONSTRAINT') {
      return c.json({
        error: 'Project key already exists',
        message: 'Please choose a different project key',
      }, 409);
    }

    return c.json({
      error: 'Failed to create project',
      message: getErrorMessage(error) ?? 'Unknown error',
    }, 500);
  }
});

/**
 * GET /projects/default - Get or create default project
 */
projectsRouter.get('/default', async (c) => {
  try {
    const project = await getOrCreateDefaultProject();
    return c.json({ project });
  } catch (error) {
    log.error('Error getting default project', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to get default project' }, 500);
  }
});

/**
 * POST /projects/migrate - Migrate existing tickets to default project
 */
projectsRouter.post('/migrate', async (c) => {
  try {
    const result = await migrateTicketsToDefaultProject();
    return c.json({
      message: 'Migration complete',
      migrated: result.migrated,
    });
  } catch (error) {
    log.error('Error migrating tickets', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to migrate tickets' }, 500);
  }
});

/**
 * GET /projects/by-key/:key - Get project by key
 */
projectsRouter.get('/by-key/:key', async (c) => {
  const key = c.req.param('key');

  try {
    const project = await getProjectByKey(key);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }
    return c.json({ project });
  } catch (error) {
    log.error('Error getting project by key', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to get project' }, 500);
  }
});

/**
 * GET /projects/by-external/:platform/:externalId - Find project by external ID (for sync)
 */
projectsRouter.get('/by-external/:platform/:externalId', async (c) => {
  const platform = c.req.param('platform');
  const externalId = c.req.param('externalId');

  try {
    const project = await findProjectByExternalId(platform, externalId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }
    return c.json({ project });
  } catch (error) {
    log.error('Error finding project by external ID', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to find project' }, 500);
  }
});

/**
 * GET /projects/:id - Get project by ID
 */
projectsRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const includeRelations = c.req.query('include') === 'all';

  try {
    const project = includeRelations
      ? await getProjectWithRelations(id)
      : await getProject(id);

    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    return c.json({ project });
  } catch (error) {
    log.error('Error getting project', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to get project' }, 500);
  }
});

/**
 * PATCH /projects/:id - Update a project
 */
projectsRouter.patch('/:id', async (c) => {
  const id = c.req.param('id');

  try {
    const body = await c.req.json();
    const parsed = UpdateProjectSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({
        error: 'Validation failed',
        details: parsed.error.flatten(),
      }, 400);
    }

    const project = await updateProject(id, parsed.data);

    return c.json({
      message: 'Project updated',
      project,
    });
  } catch (error: unknown) {
    log.error('Error updating project', error instanceof Error ? error : new Error(String(error)));

    if (errorMessageIncludes(error, 'not found')) {
      return c.json({ error: 'Project not found' }, 404);
    }

    return c.json({
      error: 'Failed to update project',
      message: getErrorMessage(error) ?? 'Unknown error',
    }, 500);
  }
});

/**
 * POST /projects/:id/archive - Archive a project
 */
projectsRouter.post('/:id/archive', async (c) => {
  const id = c.req.param('id');

  try {
    const project = await archiveProject(id);
    return c.json({
      message: 'Project archived',
      project,
    });
  } catch (error: unknown) {
    log.error('Error archiving project', error instanceof Error ? error : new Error(String(error)));

    if (errorMessageIncludes(error, 'not found')) {
      return c.json({ error: 'Project not found' }, 404);
    }

    return c.json({ error: 'Failed to archive project' }, 500);
  }
});

/**
 * DELETE /projects/:id - Delete a project (hard delete)
 */
projectsRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');

  try {
    await deleteProject(id);
    return c.json({ message: 'Project deleted' });
  } catch (error) {
    log.error('Error deleting project', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to delete project' }, 500);
  }
});

// === Project External Links ===

/**
 * GET /projects/:id/external-links - Get external links for project
 */
projectsRouter.get('/:id/external-links', async (c) => {
  const id = c.req.param('id');

  try {
    const links = await getProjectExternalLinks(id);
    return c.json({ externalLinks: links });
  } catch (error) {
    log.error('Error getting external links', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to get external links' }, 500);
  }
});

/**
 * POST /projects/:id/external-links - Add external link to project
 */
projectsRouter.post('/:id/external-links', async (c) => {
  const id = c.req.param('id');

  try {
    const body = await c.req.json();

    if (!body.platform || !body.externalId) {
      return c.json({ error: 'platform and externalId are required' }, 400);
    }

    const link = await createProjectExternalLink(id, {
      platform: body.platform,
      externalId: body.externalId,
      externalUrl: body.externalUrl,
    });

    return c.json({
      message: 'External link created',
      externalLink: link,
    }, 201);
  } catch (error) {
    log.error('Error creating external link', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to create external link' }, 500);
  }
});

// SPRINTS ROUTES (nested under /projects/:projectId/sprints)

/**
 * GET /projects/:projectId/sprints - List sprints for a project
 */
projectsRouter.get('/:projectId/sprints', async (c) => {
  const projectId = c.req.param('projectId');
  const queryParams: Record<string, unknown> = { projectId };

  const status = c.req.query('status');
  const search = c.req.query('search') || c.req.query('q');
  const sortBy = c.req.query('sortBy');
  const sortOrder = c.req.query('sortOrder');
  const limit = c.req.query('limit');
  const offset = c.req.query('offset');

  if (status) queryParams.status = status.includes(',') ? status.split(',') : status;
  if (search) queryParams.search = search;
  if (sortBy) queryParams.sortBy = sortBy;
  if (sortOrder) queryParams.sortOrder = sortOrder;
  if (limit) queryParams.limit = parseInt(limit);
  if (offset) queryParams.offset = parseInt(offset);

  try {
    const result = await querySprints(queryParams);
    return c.json({
      sprints: result.sprints,
      total: result.total,
      limit: queryParams.limit || 50,
      offset: queryParams.offset || 0,
    });
  } catch (error) {
    log.error('Error querying sprints', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to query sprints' }, 500);
  }
});

/**
 * POST /projects/:projectId/sprints - Create a new sprint
 */
projectsRouter.post('/:projectId/sprints', async (c) => {
  const projectId = c.req.param('projectId');

  try {
    const body = await c.req.json();
    const parsed = CreateSprintSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({
        error: 'Validation failed',
        details: parsed.error.flatten(),
      }, 400);
    }

    const sprint = await createSprint(projectId, parsed.data);

    return c.json({
      message: 'Sprint created',
      sprint,
    }, 201);
  } catch (error: unknown) {
    log.error('Error creating sprint', error instanceof Error ? error : new Error(String(error)));

    if (errorMessageIncludes(error, 'not found')) {
      return c.json({ error: 'Project not found' }, 404);
    }

    return c.json({
      error: 'Failed to create sprint',
      message: getErrorMessage(error) ?? 'Unknown error',
    }, 500);
  }
});

/**
 * GET /projects/:projectId/sprints/active - Get active sprint
 */
projectsRouter.get('/:projectId/sprints/active', async (c) => {
  const projectId = c.req.param('projectId');

  try {
    const sprint = await getActiveSprint(projectId);
    if (!sprint) {
      return c.json({ error: 'No active sprint' }, 404);
    }
    return c.json({ sprint });
  } catch (error) {
    log.error('Error getting active sprint', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to get active sprint' }, 500);
  }
});

/**
 * GET /projects/:projectId/sprints/:sprintId - Get sprint by ID
 */
projectsRouter.get('/:projectId/sprints/:sprintId', async (c) => {
  const sprintId = c.req.param('sprintId');
  const includeStats = c.req.query('include') === 'stats';

  try {
    const sprint = includeStats
      ? await getSprintWithStats(sprintId)
      : await getSprint(sprintId);

    if (!sprint) {
      return c.json({ error: 'Sprint not found' }, 404);
    }

    return c.json({ sprint });
  } catch (error) {
    log.error('Error getting sprint', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to get sprint' }, 500);
  }
});

/**
 * PATCH /projects/:projectId/sprints/:sprintId - Update a sprint
 */
projectsRouter.patch('/:projectId/sprints/:sprintId', async (c) => {
  const sprintId = c.req.param('sprintId');

  try {
    const body = await c.req.json();
    const parsed = UpdateSprintSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({
        error: 'Validation failed',
        details: parsed.error.flatten(),
      }, 400);
    }

    const sprint = await updateSprint(sprintId, parsed.data);

    return c.json({
      message: 'Sprint updated',
      sprint,
    });
  } catch (error: unknown) {
    log.error('Error updating sprint', error instanceof Error ? error : new Error(String(error)));

    if (errorMessageIncludes(error, 'not found')) {
      return c.json({ error: 'Sprint not found' }, 404);
    }

    return c.json({
      error: 'Failed to update sprint',
      message: getErrorMessage(error) ?? 'Unknown error',
    }, 500);
  }
});

/**
 * POST /projects/:projectId/sprints/:sprintId/start - Start a sprint
 */
projectsRouter.post('/:projectId/sprints/:sprintId/start', async (c) => {
  const sprintId = c.req.param('sprintId');

  try {
    const sprint = await startSprint(sprintId);
    return c.json({
      message: 'Sprint started',
      sprint,
    });
  } catch (error: unknown) {
    log.error('Error starting sprint', error instanceof Error ? error : new Error(String(error)));

    if (errorMessageIncludes(error, 'not found')) {
      return c.json({ error: 'Sprint not found' }, 404);
    }
    if (errorMessageIncludes(error, 'cannot be started')) {
      return c.json({ error: getErrorMessage(error) }, 400);
    }

    return c.json({ error: 'Failed to start sprint' }, 500);
  }
});

/**
 * POST /projects/:projectId/sprints/:sprintId/complete - Complete a sprint
 */
projectsRouter.post('/:projectId/sprints/:sprintId/complete', async (c) => {
  const sprintId = c.req.param('sprintId');

  try {
    const sprint = await completeSprint(sprintId);
    return c.json({
      message: 'Sprint completed',
      sprint,
    });
  } catch (error: unknown) {
    log.error('Error completing sprint', error instanceof Error ? error : new Error(String(error)));

    if (errorMessageIncludes(error, 'not found')) {
      return c.json({ error: 'Sprint not found' }, 404);
    }
    if (errorMessageIncludes(error, 'cannot be completed')) {
      return c.json({ error: getErrorMessage(error) }, 400);
    }

    return c.json({ error: 'Failed to complete sprint' }, 500);
  }
});

/**
 * POST /projects/:projectId/sprints/:sprintId/cancel - Cancel a sprint
 */
projectsRouter.post('/:projectId/sprints/:sprintId/cancel', async (c) => {
  const sprintId = c.req.param('sprintId');

  try {
    const sprint = await cancelSprint(sprintId);
    return c.json({
      message: 'Sprint cancelled',
      sprint,
    });
  } catch (error: unknown) {
    log.error('Error cancelling sprint', error instanceof Error ? error : new Error(String(error)));

    if (errorMessageIncludes(error, 'not found')) {
      return c.json({ error: 'Sprint not found' }, 404);
    }

    return c.json({ error: 'Failed to cancel sprint' }, 500);
  }
});

/**
 * DELETE /projects/:projectId/sprints/:sprintId - Delete a sprint
 */
projectsRouter.delete('/:projectId/sprints/:sprintId', async (c) => {
  const sprintId = c.req.param('sprintId');

  try {
    await deleteSprint(sprintId);
    return c.json({ message: 'Sprint deleted' });
  } catch (error) {
    log.error('Error deleting sprint', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to delete sprint' }, 500);
  }
});

// === Sprint Tickets ===

/**
 * GET /projects/:projectId/sprints/:sprintId/tickets - Get tickets in sprint
 */
projectsRouter.get('/:projectId/sprints/:sprintId/tickets', async (c) => {
  const sprintId = c.req.param('sprintId');

  try {
    const ticketIds = await getSprintTickets(sprintId);
    return c.json({ ticketIds });
  } catch (error) {
    log.error('Error getting sprint tickets', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to get sprint tickets' }, 500);
  }
});

/**
 * POST /projects/:projectId/sprints/:sprintId/tickets - Add tickets to sprint
 */
projectsRouter.post('/:projectId/sprints/:sprintId/tickets', async (c) => {
  const sprintId = c.req.param('sprintId');

  try {
    const body = await c.req.json();
    const parsed = AddTicketsToSprintSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({
        error: 'Validation failed',
        details: parsed.error.flatten(),
      }, 400);
    }

    const assignments = await addTicketsToSprint(sprintId, parsed.data);

    return c.json({
      message: 'Tickets added to sprint',
      assignments,
    }, 201);
  } catch (error: unknown) {
    log.error('Error adding tickets to sprint', error instanceof Error ? error : new Error(String(error)));

    if (errorMessageIncludes(error, 'not found')) {
      return c.json({ error: 'Sprint not found' }, 404);
    }

    return c.json({ error: 'Failed to add tickets to sprint' }, 500);
  }
});

/**
 * DELETE /projects/:projectId/sprints/:sprintId/tickets/:ticketId - Remove ticket from sprint
 */
projectsRouter.delete('/:projectId/sprints/:sprintId/tickets/:ticketId', async (c) => {
  const sprintId = c.req.param('sprintId');
  const ticketId = c.req.param('ticketId');

  try {
    await removeTicketFromSprint(sprintId, ticketId);
    return c.json({ message: 'Ticket removed from sprint' });
  } catch (error) {
    log.error('Error removing ticket from sprint', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to remove ticket from sprint' }, 500);
  }
});

/**
 * PUT /projects/:projectId/sprints/:sprintId/tickets/reorder - Reorder tickets in sprint
 */
projectsRouter.put('/:projectId/sprints/:sprintId/tickets/reorder', async (c) => {
  const sprintId = c.req.param('sprintId');

  try {
    const body = await c.req.json();

    if (!Array.isArray(body.ticketOrder)) {
      return c.json({ error: 'ticketOrder must be an array of ticket IDs' }, 400);
    }

    await reorderSprintTickets(sprintId, body.ticketOrder);

    return c.json({ message: 'Tickets reordered' });
  } catch (error) {
    log.error('Error reordering sprint tickets', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to reorder tickets' }, 500);
  }
});

export const projectsRoutes = projectsRouter;
