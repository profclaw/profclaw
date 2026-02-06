import { Hono } from 'hono';
import { getStorage } from '../storage/index.js';
import { getEmbeddingService, type EmbeddingService } from '../ai/embedding-service.js';
import { getSummary, searchSummaries } from '../summaries/index.js';
import { getTask, getTasks } from '../queue/index.js';
import type { Summary } from '../types/summary.js';
import type { Task } from '../types/task.js';
import { logger } from '../utils/logger.js';

const search = new Hono();
const validSearchTypes = new Set(['task', 'summary', 'all']);

/**
 * Unified semantic search endpoint
 *
 * Searches across tasks and summaries using vector embeddings.
 * Falls back to text search if embeddings are not available.
 *
 * Query params:
 * - q: Search query (required)
 * - type: 'task' | 'summary' | 'all' (default: 'all')
 * - limit: Max results (default: 10)
 * - threshold: Minimum similarity score 0-1 (default: 0.5)
 */
search.get('/semantic', async (c) => {
  const query = c.req.query('q');
  const type = (c.req.query('type') || 'all') as 'task' | 'summary' | 'all';
  const limit = parseInt(c.req.query('limit') || '10');
  const threshold = parseFloat(c.req.query('threshold') || '0.5');

  if (!query) {
    return c.json({ error: 'Query parameter "q" is required' }, 400);
  }

  if (!validSearchTypes.has(type)) {
    return c.json({ error: 'Invalid search type' }, 400);
  }

  const storage = getStorage();
  const results: {
    tasks: Array<{ task: Task; score: number }>;
    summaries: Array<{ summary: Summary; score: number }>;
    totalResults: number;
  } = {
    tasks: [],
    summaries: [],
    totalResults: 0,
  };

  try {
    // Check if semantic search is supported
    if (!storage.searchSimilar) {
      // Fall back to text search
      logger.info('[Search] Semantic search not supported, falling back to text search');

      if (type === 'all' || type === 'summary') {
        const summaryResults = await searchSummaries(query, limit);
        results.summaries = summaryResults.map((s) => ({
          summary: s,
          score: 1.0, // Text search doesn't provide scores
        }));
      }

      if (type === 'all' || type === 'task') {
        const allTasks = await getTasks();
        const taskResults = allTasks.filter((t) => {
          const searchText = `${t.title} ${t.description || ''} ${t.prompt}`.toLowerCase();
          return searchText.includes(query.toLowerCase());
        }).slice(0, limit);

        results.tasks = taskResults.map((t) => ({
          task: t,
          score: 1.0,
        }));
      }

      results.totalResults = results.tasks.length + results.summaries.length;

      return c.json({
        query,
        type,
        method: 'text',
        ...results,
      });
    }

    // Generate embedding for query
    const embeddingService = getEmbeddingService();
    const queryEmbedding = await embeddingService.generateEmbedding(query);

    // Search summaries
    if (type === 'all' || type === 'summary') {
      const summaryMatches = await storage.searchSimilar('summary', queryEmbedding, limit);

      for (const match of summaryMatches) {
        if (match.distance >= threshold) {
          const summary = await getSummary(match.entityId);
          if (summary) {
            results.summaries.push({
              summary,
              score: match.distance,
            });
          }
        }
      }
    }

    // Search tasks
    if (type === 'all' || type === 'task') {
      const taskMatches = await storage.searchSimilar('task', queryEmbedding, limit);

      for (const match of taskMatches) {
        if (match.distance >= threshold) {
          const task = await getTask(match.entityId);
          if (task) {
            results.tasks.push({
              task,
              score: match.distance,
            });
          }
        }
      }
    }

    // Sort by score
    results.tasks.sort((a, b) => b.score - a.score);
    results.summaries.sort((a, b) => b.score - a.score);
    results.totalResults = results.tasks.length + results.summaries.length;

    return c.json({
      query,
      type,
      method: 'semantic',
      threshold,
      ...results,
    });
  } catch (error) {
    logger.error('[Search] Semantic search failed:', error as Error);
    return c.json({
      error: 'Search failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Full-text search across all entities
 */
search.get('/text', async (c) => {
  const query = c.req.query('q');
  const type = (c.req.query('type') || 'all') as 'task' | 'summary' | 'all';
  const limit = parseInt(c.req.query('limit') || '20');

  if (!query) {
    return c.json({ error: 'Query parameter "q" is required' }, 400);
  }

  if (!validSearchTypes.has(type)) {
    return c.json({ error: 'Invalid search type' }, 400);
  }

  const results: {
    tasks: Task[];
    summaries: Summary[];
    totalResults: number;
  } = {
    tasks: [],
    summaries: [],
    totalResults: 0,
  };

  try {
    const queryLower = query.toLowerCase();

    if (type === 'all' || type === 'summary') {
      results.summaries = await searchSummaries(query, limit);
    }

    if (type === 'all' || type === 'task') {
      const allTasks = await getTasks();
      results.tasks = allTasks.filter((t) => {
        const searchText = `${t.title} ${t.description || ''} ${t.prompt}`.toLowerCase();
        return searchText.includes(queryLower);
      }).slice(0, limit);
    }

    results.totalResults = results.tasks.length + results.summaries.length;

    return c.json({
      query,
      type,
      ...results,
    });
  } catch (error) {
    logger.error('[Search] Text search failed:', error as Error);
    return c.json({
      error: 'Search failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Get search capabilities
 */
search.get('/capabilities', async (c) => {
  const storage = getStorage();
  const hasSemanticSearch = !!storage.searchSimilar;

  let embeddingProvider = 'none';
  try {
    const service = getEmbeddingService() as EmbeddingService & { provider?: string };
    embeddingProvider = service.provider || 'unknown';
  } catch {
    // No embedding service available
  }

  return c.json({
    textSearch: true,
    semanticSearch: hasSemanticSearch,
    embeddingProvider,
    supportedTypes: ['task', 'summary', 'all'],
  });
});

export { search as searchRoutes };
