/**
 * Memory Routes
 *
 * API endpoints for memory system management.
 * Provides search, browse, sync, and delete capabilities.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  initMemoryTables,
  syncMemoryFiles,
  searchMemory,
  getMemoryContent,
  getMemoryStats,
  listMemoryFiles,
  listFileChunks,
  deleteMemoryChunk,
  deleteMemoryFile,
  clearAllMemories,
  listMemorySessions,
  createMemorySession,
  archiveSession,
  DEFAULT_MEMORY_CONFIG,
  getMemoryWatcher,
} from '../memory/index.js';
import { logger } from '../utils/logger.js';

const memory = new Hono();

// =============================================================================
// Schema Validators
// =============================================================================

const SearchSchema = z.object({
  query: z.string().min(1),
  maxResults: z.number().optional().default(6),
  minScore: z.number().optional(),
});

const GetContentSchema = z.object({
  path: z.string().min(1),
  fromLine: z.number().optional(),
  toLine: z.number().optional(),
  lines: z.number().optional(),
});

const SyncSchema = z.object({
  basePath: z.string().optional().default(process.cwd()),
});

const SessionCreateSchema = z.object({
  name: z.string().optional(),
  conversationId: z.string().optional(),
  userId: z.string().optional(),
  projectId: z.string().optional(),
});

const SessionListSchema = z.object({
  status: z.enum(['active', 'archived', 'deleted']).optional(),
  limit: z.coerce.number().optional().default(20),
  offset: z.coerce.number().optional().default(0),
});

// =============================================================================
// Routes
// =============================================================================

/**
 * Initialize memory tables
 */
memory.post('/init', async (c) => {
  try {
    await initMemoryTables();
    return c.json({ message: 'Memory tables initialized successfully' });
  } catch (error) {
    logger.error('[Memory API] Failed to initialize tables:', error as Error);
    return c.json(
      {
        error: 'Failed to initialize memory tables',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * Get memory statistics
 */
memory.get('/stats', async (c) => {
  try {
    const stats = await getMemoryStats();
    return c.json({ stats });
  } catch (error) {
    logger.error('[Memory API] Failed to get stats:', error as Error);
    return c.json(
      {
        error: 'Failed to get memory statistics',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * Search memories (auto-syncs if dirty)
 */
memory.post('/search', zValidator('json', SearchSchema), async (c) => {
  try {
    const { query, maxResults, minScore } = c.req.valid('json');

    // Use watcher for auto-sync before search if available
    const watcher = getMemoryWatcher();
    if (watcher) {
      const result = await watcher.search(query, maxResults);
      return c.json({
        query,
        method: result.method,
        totalCandidates: result.totalCandidates,
        chunks: result.chunks.map((chunk) => ({
          id: chunk.id,
          path: chunk.path,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          text: chunk.text,
          score: chunk.score,
        })),
        autoSynced: watcher.isDirty() === false, // Was auto-synced before search
      });
    }

    // Fallback to direct search without auto-sync
    const config = {
      ...DEFAULT_MEMORY_CONFIG,
      query: {
        ...DEFAULT_MEMORY_CONFIG.query,
        maxResults,
        ...(minScore !== undefined ? { minScore } : {}),
      },
    };

    const result = await searchMemory(query, config);

    return c.json({
      query,
      method: result.method,
      totalCandidates: result.totalCandidates,
      chunks: result.chunks.map((chunk) => ({
        id: chunk.id,
        path: chunk.path,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        text: chunk.text,
        score: chunk.score,
      })),
    });
  } catch (error) {
    logger.error('[Memory API] Search failed:', error as Error);
    return c.json(
      {
        error: 'Memory search failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * Get specific content from a memory file
 */
memory.post('/get', zValidator('json', GetContentSchema), async (c) => {
  try {
    const params = c.req.valid('json');
    const result = await getMemoryContent(params.path, {
      fromLine: params.fromLine,
      toLine: params.toLine,
      lines: params.lines,
    });

    if (!result) {
      return c.json({ error: 'File not found' }, 404);
    }

    return c.json(result);
  } catch (error) {
    logger.error('[Memory API] Get content failed:', error as Error);
    return c.json(
      {
        error: 'Failed to get memory content',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * Sync memory files from disk
 */
memory.post('/sync', zValidator('json', SyncSchema), async (c) => {
  try {
    const { basePath } = c.req.valid('json');
    const result = await syncMemoryFiles(basePath, DEFAULT_MEMORY_CONFIG);

    return c.json({
      message: 'Memory sync completed',
      synced: result.synced,
      added: result.added,
      updated: result.updated,
      removed: result.removed,
    });
  } catch (error) {
    logger.error('[Memory API] Sync failed:', error as Error);
    return c.json(
      {
        error: 'Memory sync failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * List all memory files
 */
memory.get('/files', async (c) => {
  try {
    const files = await listMemoryFiles();
    return c.json({ files });
  } catch (error) {
    logger.error('[Memory API] Failed to list files:', error as Error);
    return c.json(
      {
        error: 'Failed to list memory files',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * List chunks for a specific file
 */
memory.get('/files/:path/chunks', async (c) => {
  try {
    const path = decodeURIComponent(c.req.param('path'));
    const chunks = await listFileChunks(path);
    return c.json({ path, chunks });
  } catch (error) {
    logger.error('[Memory API] Failed to list chunks:', error as Error);
    return c.json(
      {
        error: 'Failed to list file chunks',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * Delete a specific chunk
 */
memory.delete('/chunks/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const deleted = await deleteMemoryChunk(id);

    if (!deleted) {
      return c.json({ error: 'Chunk not found' }, 404);
    }

    return c.json({ message: 'Chunk deleted', id });
  } catch (error) {
    logger.error('[Memory API] Failed to delete chunk:', error as Error);
    return c.json(
      {
        error: 'Failed to delete chunk',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * Delete all memories for a file
 */
memory.delete('/files/:path', async (c) => {
  try {
    const path = decodeURIComponent(c.req.param('path'));
    const deleted = await deleteMemoryFile(path);

    if (!deleted) {
      return c.json({ error: 'File not found' }, 404);
    }

    return c.json({ message: 'File memories deleted', path });
  } catch (error) {
    logger.error('[Memory API] Failed to delete file:', error as Error);
    return c.json(
      {
        error: 'Failed to delete file memories',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * Clear all memories
 */
memory.delete('/all', async (c) => {
  try {
    await clearAllMemories();
    return c.json({ message: 'All memories cleared' });
  } catch (error) {
    logger.error('[Memory API] Failed to clear memories:', error as Error);
    return c.json(
      {
        error: 'Failed to clear memories',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// =============================================================================
// Session Routes
// =============================================================================

/**
 * List memory sessions
 */
memory.get('/sessions', async (c) => {
  try {
    const status = c.req.query('status') as 'active' | 'archived' | 'deleted' | undefined;
    const limit = parseInt(c.req.query('limit') || '20', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);

    const result = await listMemorySessions({ status, limit, offset });

    return c.json({
      sessions: result.sessions,
      total: result.total,
      limit,
      offset,
    });
  } catch (error) {
    logger.error('[Memory API] Failed to list sessions:', error as Error);
    return c.json(
      {
        error: 'Failed to list sessions',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * Create a new memory session
 */
memory.post('/sessions', zValidator('json', SessionCreateSchema), async (c) => {
  try {
    const params = c.req.valid('json');
    const session = await createMemorySession(params);
    return c.json({ session }, 201);
  } catch (error) {
    logger.error('[Memory API] Failed to create session:', error as Error);
    return c.json(
      {
        error: 'Failed to create session',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * Archive a session
 */
memory.post('/sessions/:id/archive', async (c) => {
  try {
    const id = c.req.param('id');
    await archiveSession(id);
    return c.json({ message: 'Session archived', id });
  } catch (error) {
    logger.error('[Memory API] Failed to archive session:', error as Error);
    return c.json(
      {
        error: 'Failed to archive session',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * Get memory configuration
 */
memory.get('/config', (c) => {
  return c.json({
    config: {
      sources: DEFAULT_MEMORY_CONFIG.sources,
      provider: DEFAULT_MEMORY_CONFIG.provider,
      model: DEFAULT_MEMORY_CONFIG.model,
      chunking: DEFAULT_MEMORY_CONFIG.chunking,
      query: DEFAULT_MEMORY_CONFIG.query,
      sync: DEFAULT_MEMORY_CONFIG.sync,
      paths: DEFAULT_MEMORY_CONFIG.paths,
    },
  });
});

/**
 * Get watcher status (auto-sync state)
 */
memory.get('/watcher/status', (c) => {
  const watcher = getMemoryWatcher();
  if (!watcher) {
    return c.json({
      enabled: false,
      message: 'Memory watcher is not enabled',
    });
  }

  const state = watcher.getState();
  return c.json({
    enabled: true,
    state: {
      dirty: state.dirty,
      syncing: state.syncing,
      lastSyncAt: state.lastSyncAt,
      watchedFiles: state.watchedFiles,
      watching: state.watching,
    },
    config: {
      onSessionStart: DEFAULT_MEMORY_CONFIG.sync.onSessionStart,
      onSearch: DEFAULT_MEMORY_CONFIG.sync.onSearch,
      watch: DEFAULT_MEMORY_CONFIG.sync.watch,
      watchDebounceMs: DEFAULT_MEMORY_CONFIG.sync.watchDebounceMs,
    },
  });
});

/**
 * Warm session - trigger sync on session start
 */
memory.post('/warm', async (c) => {
  const watcher = getMemoryWatcher();
  if (!watcher) {
    return c.json({
      message: 'Memory watcher not enabled, manual sync required',
      synced: false,
    });
  }

  try {
    await watcher.warmSession();
    const state = watcher.getState();
    return c.json({
      message: 'Session warmed with memory sync',
      synced: true,
      lastSyncAt: state.lastSyncAt,
    });
  } catch (error) {
    logger.error('[Memory API] Warm session failed:', error as Error);
    return c.json(
      {
        error: 'Failed to warm session',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

export { memory as memoryRoutes };
