import { Hono } from 'hono';
import type { Context } from 'hono';
import { addTask, getTask, getTasks, cancelTask, retryTask } from '../queue/index.js';
import { CreateTaskSchema, TaskStatus } from '../types/task.js';
import type { Task, TaskStatusType } from '../types/task.js';
import { getStorage } from '../storage/index.js';
import type { TaskFilterOptions } from '../storage/adapter.js';
import { createContextualLogger } from '../utils/logger.js';

const tasks = new Hono();
const log = createContextualLogger('TasksRoutes');
const validTaskStatuses = new Set<string>(Object.values(TaskStatus));

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

// Sparse fieldset: default fields for list view (Phase 17 optimization)
const TASK_LIST_FIELDS = [
  'id', 'title', 'status', 'priority', 'source', 'sourceId', 'sourceUrl',
  'labels', 'assignedAgent', 'createdAt', 'updatedAt', 'startedAt', 'completedAt',
] as const;

// Helper to pick only specified fields from an object
function pickTaskFields<T extends Record<string, unknown>>(obj: T, fields: readonly string[]): Partial<T> {
  const result: Partial<T> = {};
  for (const field of fields) {
    if (field in obj) {
      (result as Record<string, unknown>)[field] = obj[field];
    }
  }
  return result;
}

// Cursor-based pagination helpers (Phase 17)
interface CursorData {
  createdAt: number;
  id: string;
}

function encodeCursor(data: CursorData): string {
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

function decodeCursor(cursor: string): CursorData | null {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf-8');
    const data = JSON.parse(json);
    if (typeof data.createdAt === 'number' && typeof data.id === 'string') {
      return data as CursorData;
    }
    return null;
  } catch {
    return null;
  }
}

function getNextCursor<T extends { id: string; createdAt?: Date | number | string }>(
  items: T[],
  limit: number
): string | null {
  if (items.length < limit) return null;
  const lastItem = items[items.length - 1];
  if (!lastItem?.createdAt) return null;

  const createdAt = lastItem.createdAt instanceof Date
    ? lastItem.createdAt.getTime()
    : typeof lastItem.createdAt === 'string'
    ? new Date(lastItem.createdAt).getTime()
    : lastItem.createdAt;

  return encodeCursor({ createdAt, id: lastItem.id });
}

// List tasks - reads from database for consistency with dashboard
tasks.get('/', async (c) => {
  const storage = getStorage();
  const status = c.req.query('status');
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  // Cursor-based pagination (Phase 17) - takes precedence over offset
  const cursor = c.req.query('cursor');
  const cursorData = cursor ? decodeCursor(cursor) : null;

  // Sparse fieldset support (Phase 17)
  const fieldsParam = c.req.query('fields'); // Comma-separated field names
  const sparseFields = fieldsParam ? fieldsParam.split(',').map(f => f.trim()) : null;
  const includeFull = c.req.query('full') === 'true'; // Backward compat: return full objects

  if (status && !validTaskStatuses.has(status)) {
    return c.json({ error: 'Invalid status' }, 400);
  }

  // Use database query for persistence and consistency
  if (storage.getTasksFiltered) {
    try {
      const options: TaskFilterOptions = {
        limit,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      };
      if (status) {
        options.status = status;
      }

      // Use cursor for pagination if provided, otherwise fall back to offset
      if (cursorData) {
        options.cursorCreatedAt = new Date(cursorData.createdAt);
        options.cursorId = cursorData.id;
      } else {
        options.offset = offset;
      }

      const result = await storage.getTasksFiltered(options);

      // Generate next cursor from full results (before sparse filtering)
      const nextCursor = getNextCursor(result.tasks, limit);

      // Apply sparse fieldset
      const taskList = !includeFull
        ? result.tasks.map(t => pickTaskFields(t as unknown as Record<string, unknown>, sparseFields || [...TASK_LIST_FIELDS]))
        : result.tasks;

      return c.json({
        tasks: taskList,
        total: result.total,
        count: taskList.length,
        limit,
        nextCursor,
        offset: cursorData ? undefined : offset,
        sparse: !includeFull,
      });
    } catch (error) {
      log.error(
        'Error loading tasks from DB, falling back to in-memory',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  // Fallback to in-memory queue (no cursor support for in-memory)
  const taskList = getTasks({
    status: status as TaskStatusType | undefined,
    limit,
    offset,
  });

  // Get total count (without limit)
  const allTasks = getTasks({ status: status as TaskStatusType | undefined });

  // Generate next cursor
  const nextCursor = getNextCursor(taskList as Task[], limit);

  // Apply sparse fieldset
  const sparseTasks = !includeFull
    ? taskList.map(t => pickTaskFields(t as unknown as Record<string, unknown>, sparseFields || [...TASK_LIST_FIELDS]))
    : taskList;

  return c.json({
    tasks: sparseTasks,
    total: allTasks.length,
    count: sparseTasks.length,
    limit,
    nextCursor,
    offset: cursorData ? undefined : offset,
    sparse: !includeFull,
  });
});

// Create task
tasks.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = CreateTaskSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten(),
        },
        400
      );
    }

    const task = await addTask(parsed.data);

    return c.json(
      {
        message: 'Task created',
        task,
      },
      201
    );
  } catch (error) {
    log.error('Error creating task', error instanceof Error ? error : new Error(String(error)));
    return c.json(
      {
        error: 'Failed to create task',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// Task analytics
tasks.get('/analytics', async (c) => {
  const storage = getStorage();

  if (!storage.getTaskAnalytics) {
    return c.json({ error: 'Analytics not available' }, 501);
  }

  try {
    const analytics = await storage.getTaskAnalytics();
    return c.json(analytics);
  } catch (error) {
    log.error('Error getting task analytics', error instanceof Error ? error : new Error(String(error)));
    return c.json({
      error: 'Failed to get analytics',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Advanced task filtering
tasks.get('/filter', async (c) => {
  const storage = getStorage();

  if (!storage.getTasksFiltered) {
    return c.json({ error: 'Advanced filtering not available' }, 501);
  }

  const options: TaskFilterOptions = {};

  // Parse query parameters
  const status = c.req.query('status');
  if (status) options.status = status.includes(',') ? status.split(',') : status;

  const priority = c.req.query('priority');
  if (priority) {
    options.priority = priority.includes(',')
      ? priority.split(',').map(Number)
      : Number(priority);
  }

  const source = c.req.query('source');
  if (source) options.source = source.includes(',') ? source.split(',') : source;

  const agent = c.req.query('agent');
  if (agent) options.agent = agent;

  const labels = c.req.query('labels');
  if (labels) options.labels = labels.split(',');

  const createdAfter = c.req.query('createdAfter');
  if (createdAfter) options.createdAfter = new Date(createdAfter);

  const createdBefore = c.req.query('createdBefore');
  if (createdBefore) options.createdBefore = new Date(createdBefore);

  const completedAfter = c.req.query('completedAfter');
  if (completedAfter) options.completedAfter = new Date(completedAfter);

  const completedBefore = c.req.query('completedBefore');
  if (completedBefore) options.completedBefore = new Date(completedBefore);

  const repository = c.req.query('repository');
  if (repository) options.repository = repository;

  const searchQuery = c.req.query('q');
  if (searchQuery) options.searchQuery = searchQuery;

  const sortBy = c.req.query('sortBy') as TaskFilterOptions['sortBy'];
  if (sortBy) options.sortBy = sortBy;

  const sortOrder = c.req.query('sortOrder') as TaskFilterOptions['sortOrder'];
  if (sortOrder) options.sortOrder = sortOrder;

  options.limit = parseInt(c.req.query('limit') || '50');
  options.offset = parseInt(c.req.query('offset') || '0');

  try {
    const result = await storage.getTasksFiltered(options);
    return c.json({
      tasks: result.tasks,
      total: result.total,
      limit: options.limit,
      offset: options.offset,
    });
  } catch (error) {
    log.error('Error filtering tasks', error instanceof Error ? error : new Error(String(error)));
    return c.json({
      error: 'Failed to filter tasks',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Get archived tasks
tasks.get('/archived', async (c) => {
  const storage = getStorage();

  if (!storage.getArchivedTasks) {
    return c.json({ error: 'Archival not available' }, 501);
  }

  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  try {
    const result = await storage.getArchivedTasks({ limit, offset });
    return c.json({
      tasks: result.tasks,
      total: result.total,
      limit,
      offset,
    });
  } catch (error) {
    log.error('Error getting archived tasks', error instanceof Error ? error : new Error(String(error)));
    return c.json({
      error: 'Failed to get archived tasks',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Archive old tasks
tasks.post('/archive', async (c) => {
  const storage = getStorage();

  if (!storage.archiveOldTasks) {
    return c.json({ error: 'Archival not available' }, 501);
  }

  try {
    const parsed = await parseJsonBody(c);
    if (!parsed.ok) {
      return parsed.response;
    }

    const rawOlderThanDays = parsed.body.olderThanDays;
    const olderThanDays = rawOlderThanDays === undefined ? 30 : rawOlderThanDays;

    if (typeof olderThanDays !== 'number' || !Number.isFinite(olderThanDays) || olderThanDays <= 0) {
      return c.json({ error: 'olderThanDays must be a positive number' }, 400);
    }

    const result = await storage.archiveOldTasks(olderThanDays);
    return c.json({
      message: `Archived ${result.archived} tasks older than ${olderThanDays} days`,
      archived: result.archived,
    });
  } catch (error) {
    log.error('Error archiving tasks', error instanceof Error ? error : new Error(String(error)));
    return c.json({
      error: 'Failed to archive tasks',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Export all tasks as JSON
tasks.get('/export', (_c) => {
  const taskList = getTasks({ limit: 10000 });
  const exportData = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    taskCount: taskList.length,
    tasks: taskList.map(task => ({
      id: task.id,
      title: task.title,
      description: task.description,
      prompt: task.prompt,
      status: task.status,
      priority: task.priority,
      source: task.source,
      sourceId: task.sourceId,
      sourceUrl: task.sourceUrl,
      repository: task.repository,
      branch: task.branch,
      labels: task.labels,
      assignedAgent: task.assignedAgent,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
    })),
  };

  return new Response(JSON.stringify(exportData, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="profclaw-tasks-${new Date().toISOString().split('T')[0]}.json"`,
    },
  });
});

// Import tasks from JSON
tasks.post('/import', async (c) => {
  try {
    const parsed = await parseJsonBody(c);
    if (!parsed.ok) {
      return parsed.response;
    }

    const body = parsed.body;

    if (!body.version || !Array.isArray(body.tasks)) {
      return c.json({ error: 'Invalid import format. Expected { version, tasks[] }' }, 400);
    }

    const results = {
      imported: 0,
      skipped: 0,
      errors: [] as string[],
    };

    for (const taskData of body.tasks) {
      try {
        const existing = getTask(taskData.id);
        if (existing) {
          results.skipped++;
          continue;
        }

        const parsed = CreateTaskSchema.safeParse({
          title: taskData.title,
          description: taskData.description,
          prompt: taskData.prompt,
          priority: taskData.priority,
          source: taskData.source || 'import',
          sourceId: taskData.sourceId,
          sourceUrl: taskData.sourceUrl,
          repository: taskData.repository,
          branch: taskData.branch,
          labels: taskData.labels || [],
          assignedAgent: taskData.assignedAgent,
        });

        if (!parsed.success) {
          results.errors.push(`Task "${taskData.title}": ${parsed.error.message}`);
          continue;
        }

        await addTask(parsed.data);
        results.imported++;
      } catch (error) {
        results.errors.push(`Task "${taskData.title}": ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return c.json({
      message: `Import completed: ${results.imported} imported, ${results.skipped} skipped`,
      results,
    });
  } catch (error) {
    log.error('Error importing tasks', error instanceof Error ? error : new Error(String(error)));
    return c.json({
      error: 'Import failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Get single task
tasks.get('/:id', (c) => {
  const id = c.req.param('id');
  const task = getTask(id);

  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }

  return c.json({ task });
});

// Get task events (audit log)
tasks.get('/:id/events', async (c) => {
  const storage = getStorage();
  const id = c.req.param('id');

  if (!storage.getTaskEvents) {
    return c.json({ error: 'Task events not available' }, 501);
  }

  const task = getTask(id);
  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }

  try {
    const events = await storage.getTaskEvents(id);
    return c.json({
      taskId: id,
      events,
      count: events.length,
    });
  } catch (error) {
    log.error('Error getting task events', error instanceof Error ? error : new Error(String(error)));
    return c.json({
      error: 'Failed to get task events',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Cancel a task
tasks.post('/:id/cancel', async (c) => {
  const id = c.req.param('id');
  const success = await cancelTask(id);

  if (!success) {
    const task = getTask(id);
    if (!task) {
      return c.json({ error: 'Task not found' }, 404);
    }
    return c.json({ error: 'Task cannot be cancelled (not running or pending)' }, 400);
  }

  return c.json({ message: 'Task cancelled', task: getTask(id) });
});

// Retry a task
tasks.post('/:id/retry', async (c) => {
  const id = c.req.param('id');
  const newTask = await retryTask(id);

  if (!newTask) {
    const task = getTask(id);
    if (!task) {
      return c.json({ error: 'Task not found' }, 404);
    }
    return c.json({ error: 'Task cannot be retried (not failed or completed)' }, 400);
  }

  return c.json({ message: 'Task queued for retry', task: newTask, originalTaskId: id });
});

export { tasks as tasksRoutes };
