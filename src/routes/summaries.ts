import { Hono } from 'hono';
import {
  createSummary,
  getSummary,
  querySummaries,
  searchSummaries,
  getSummaryStats,
  getRecentSummaries,
  deleteSummary,
  CreateSummaryInputSchema,
  SummaryQuerySchema,
} from '../summaries/index.js';
import {
  generatePRDescription,
  generateChangelog,
  generateReleaseNotes,
  generateCommitMessage,
  TASK_TYPE_TEMPLATES,
} from '../summaries/templates.js';
import { getEmbeddingService } from '../ai/embedding-service.js';
import { getStorage } from '../storage/index.js';
import type { StorageAdapter } from '../storage/adapter.js';
import type { Summary } from '../types/summary.js';
import { createContextualLogger } from '../utils/logger.js';

const summaries = new Hono();
const log = createContextualLogger('Summaries');
type SemanticSearchResult = Awaited<ReturnType<NonNullable<StorageAdapter['searchSimilar']>>>[number];

// Sparse fieldset: default fields for list view (Phase 17 optimization)
const SUMMARY_LIST_FIELDS = [
  'id', 'taskId', 'sessionId', 'agent', 'model', 'title', 'taskType', 'component',
  'labels', 'repository', 'branch', 'createdAt', 'hasBlobOutput',
] as const;

// Helper to pick only specified fields from an object
function pickSummaryFields<T extends Record<string, unknown>>(obj: T, fields: readonly string[]): Partial<T> {
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

// Get summary statistics (before :id route to avoid conflict)
summaries.get('/stats', async (c) => {
  const stats = await getSummaryStats();
  return c.json(stats);
});

// Get recent summaries (before :id route to avoid conflict)
summaries.get('/recent', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50');
  const summaryList = await getRecentSummaries(limit);

  return c.json({
    summaries: summaryList,
    count: summaryList.length,
  });
});

// Search summaries (before :id route to avoid conflict)
summaries.get('/search', async (c) => {
  const q = c.req.query('q');
  const limit = parseInt(c.req.query('limit') || '20');

  if (!q) {
    return c.json({ error: 'Query parameter "q" is required' }, 400);
  }

  const summaryList = await searchSummaries(q, limit);
  return c.json({
    query: q,
    summaries: summaryList,
    count: summaryList.length,
  });
});

// Semantic Search
summaries.get('/semantic', async (c) => {
  const query = c.req.query('q');
  const type = c.req.query('type') as 'task' | 'summary' || 'summary';
  const limit = parseInt(c.req.query('limit') || '5');

  if (!query) return c.json({ error: 'Missing query' }, 400);

  try {
    const storage = getStorage();
    if (!storage.searchSimilar) {
      return c.json({ error: 'Semantic search not supported by current storage tier' }, 501);
    }

    let vector: number[];
    const vectorStr = c.req.query('vector');

    if (vectorStr) {
      vector = JSON.parse(vectorStr) as number[];
    } else {
      const service = getEmbeddingService();
      vector = await service.generateEmbedding(query);
    }

    const results = await storage.searchSimilar(type, vector, limit);

    const enriched = await Promise.all(results.map(async (r: SemanticSearchResult) => ({
      ...r,
      summary: type === 'summary' ? await getSummary(r.entityId) : null
    })));

    return c.json({
      query,
      results: enriched
    });
  } catch (error) {
    log.error('Semantic search error', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Search failed', message: (error as Error).message }, 500);
  }
});

// Generate Changelog
summaries.get('/changelog', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50');
  const version = c.req.query('version');
  const format = (c.req.query('format') || 'keepachangelog') as 'keepachangelog' | 'simple';
  const date = c.req.query('date');

  const summaryList = await getRecentSummaries(limit);
  const changelog = generateChangelog(summaryList, {
    version,
    date,
    format,
    includeIssueLinks: true,
  });

  return c.json({
    version: version || 'Unreleased',
    format,
    count: summaryList.length,
    changelog,
  });
});

// Generate Release Notes
summaries.get('/release-notes', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50');
  const version = c.req.query('version') || '1.0.0';
  const title = c.req.query('title');

  const summaryList = await getRecentSummaries(limit);
  const notes = generateReleaseNotes(summaryList, {
    version,
    title,
    includeStats: true,
  });

  return c.json({
    version,
    count: summaryList.length,
    notes,
  });
});

// Get task type templates
summaries.get('/templates', async (c) => {
  return c.json({
    templates: TASK_TYPE_TEMPLATES,
    categories: ['Added', 'Changed', 'Fixed', 'Removed', 'Security', 'Deprecated'],
  });
});

// List/query summaries
summaries.get('/', async (c) => {
  const queryParams: Record<string, unknown> = {};

  const taskId = c.req.query('taskId');
  const sessionId = c.req.query('sessionId');
  const agent = c.req.query('agent');
  const taskType = c.req.query('taskType');
  const component = c.req.query('component');
  const repository = c.req.query('repository');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const search = c.req.query('search');
  const sortBy = c.req.query('sortBy');
  const sortOrder = c.req.query('sortOrder');
  const limit = c.req.query('limit');
  const offset = c.req.query('offset');

  // Cursor-based pagination (Phase 17) - takes precedence over offset
  const cursor = c.req.query('cursor');
  const cursorData = cursor ? decodeCursor(cursor) : null;

  // Sparse fieldset support (Phase 17)
  const fieldsParam = c.req.query('fields'); // Comma-separated field names
  const sparseFields = fieldsParam ? fieldsParam.split(',').map(f => f.trim()) : null;
  const includeFull = c.req.query('full') === 'true'; // Backward compat: return full objects

  if (taskId) queryParams.taskId = taskId;
  if (sessionId) queryParams.sessionId = sessionId;
  if (agent) queryParams.agent = agent;
  if (taskType) queryParams.taskType = taskType;
  if (component) queryParams.component = component;
  if (repository) queryParams.repository = repository;
  if (from) queryParams.from = from;
  if (to) queryParams.to = to;
  if (search) queryParams.search = search;
  if (sortBy) queryParams.sortBy = sortBy;
  if (sortOrder) queryParams.sortOrder = sortOrder;

  const pageLimit = limit ? parseInt(limit) : 50;
  queryParams.limit = pageLimit;

  // Use cursor for pagination if provided, otherwise fall back to offset
  if (cursorData) {
    queryParams.cursorCreatedAt = new Date(cursorData.createdAt);
    queryParams.cursorId = cursorData.id;
  } else if (offset) {
    queryParams.offset = parseInt(offset);
  }

  const parsed = SummaryQuerySchema.partial().safeParse(queryParams);
  if (!parsed.success) {
    return c.json(
      {
        error: 'Invalid query parameters',
        details: parsed.error.flatten(),
      },
      400
    );
  }

  const result = await querySummaries(parsed.data);

  // Generate next cursor from full results (before sparse filtering)
  const nextCursor = getNextCursor(result.summaries as Summary[], pageLimit);

  // Apply sparse fieldset - strip rawOutput and large fields by default
  const summaryList = !includeFull
    ? result.summaries.map(s => pickSummaryFields(s as unknown as Record<string, unknown>, sparseFields || [...SUMMARY_LIST_FIELDS])) as typeof result.summaries
    : result.summaries;

  return c.json({
    summaries: summaryList,
    total: result.total,
    limit: pageLimit,
    nextCursor,
    offset: cursorData ? undefined : (queryParams.offset || 0),
    sparse: !includeFull,
  });
});

// Create summary
summaries.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = CreateSummaryInputSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten(),
        },
        400
      );
    }

    const summary = await createSummary(parsed.data);

    return c.json(
      {
        message: 'Summary created',
        summary,
      },
      201
    );
  } catch (error) {
    log.error('Error creating summary', error instanceof Error ? error : new Error(String(error)));
    return c.json(
      {
        error: 'Failed to create summary',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// Generate PR Description
summaries.get('/:id/pr-description', async (c) => {
  const id = c.req.param('id');
  const summary = await getSummary(id);

  if (!summary) {
    return c.json({ error: 'Summary not found' }, 404);
  }

  const includeFileChanges = c.req.query('includeFiles') !== 'false';
  const includeDecisions = c.req.query('includeDecisions') !== 'false';
  const includeBlockers = c.req.query('includeBlockers') !== 'false';
  const includeTokenStats = c.req.query('includeTokens') === 'true';

  const description = generatePRDescription(summary, {
    includeFileChanges,
    includeDecisions,
    includeBlockers,
    includeTokenStats,
  });

  return c.json({
    id: summary.id,
    title: summary.title,
    description,
  });
});

// Generate Commit Message
summaries.get('/:id/commit-message', async (c) => {
  const id = c.req.param('id');
  const summary = await getSummary(id);

  if (!summary) {
    return c.json({ error: 'Summary not found' }, 404);
  }

  const includeBody = c.req.query('includeBody') === 'true';
  const maxLength = parseInt(c.req.query('maxLength') || '72');

  const message = generateCommitMessage(summary, {
    maxLength,
    includeBody,
  });

  return c.json({
    id: summary.id,
    message,
  });
});

// Get single summary
summaries.get('/:id', async (c) => {
  const id = c.req.param('id');
  const includeRawOutput = c.req.query('includeRawOutput') === 'true';
  const summary = await getSummary(id, includeRawOutput);

  if (!summary) {
    return c.json({ error: 'Summary not found' }, 404);
  }

  return c.json({ summary });
});

// Get raw output for a summary (lazy loading - Phase 17)
summaries.get('/:id/raw-output', async (c) => {
  const id = c.req.param('id');
  const storage = getStorage();

  // Check summary exists
  const summary = await getSummary(id);
  if (!summary) {
    return c.json({ error: 'Summary not found' }, 404);
  }

  // Fetch raw output from blob storage
  const rawOutput = await storage.getSummaryRawOutput(id);

  if (!rawOutput) {
    return c.json({ error: 'Raw output not available', hasBlob: false }, 404);
  }

  return c.json({
    id,
    rawOutput,
    length: rawOutput.length,
  });
});

// Delete summary
summaries.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await deleteSummary(id);

  if (!deleted) {
    return c.json({ error: 'Summary not found' }, 404);
  }

  return c.json({ message: 'Summary deleted' });
});

export { summaries as summariesRoutes };
