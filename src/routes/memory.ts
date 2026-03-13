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
import {
  initExperienceStore,
  recordExperience,
  getExperience,
  deleteExperience,
  listExperiences,
  findSimilarExperiences,
  markUsed,
  applyDecay,
  pruneExpired,
  getStats as getExperienceStats,
  trackPreference,
  getUserPreferences,
} from '../memory/experience-store.js';
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

// =============================================================================
// Experience Store Routes (Phase 19, Category 5)
// =============================================================================

const ExperienceTypeSchema = z.enum([
  'tool_chain',
  'user_preference',
  'task_solution',
  'error_recovery',
]);

const RecordExperienceSchema = z.object({
  type: ExperienceTypeSchema,
  intent: z.string().min(1),
  // solution is any JSON value - store as-is
  solution: z.record(z.string(), z.unknown()).or(z.array(z.unknown())).or(z.string()).or(z.number()).or(z.boolean()).or(z.null()),
  successScore: z.number().min(0).max(1).default(1.0),
  tags: z.array(z.string()).default([]),
  sourceConversationId: z.string().default(''),
  userId: z.string().optional(),
});

const ListExperiencesSchema = z.object({
  type: ExperienceTypeSchema.optional(),
  userId: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).default(50),
  offset: z.coerce.number().min(0).default(0),
  minWeight: z.coerce.number().min(0).max(1).optional(),
});

const PreferenceTrackSchema = z.object({
  userId: z.string().min(1),
  category: z.string().min(1),
  value: z.string().min(1),
});

const DecaySchema = z.object({
  halfLifeDays: z.number().min(1).max(365).default(30),
});

const PruneSchema = z.object({
  minWeight: z.number().min(0).max(1).default(0.05),
});

/**
 * Initialize experience store tables
 */
memory.post('/experiences/init', async (c) => {
  try {
    await initExperienceStore();
    return c.json({ message: 'Experience store initialized' });
  } catch (error) {
    logger.error('[Experience API] Init failed:', error as Error);
    return c.json(
      { error: 'Failed to initialize experience store', message: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});

/**
 * GET /api/memory/experiences/stats - Aggregate statistics
 */
memory.get('/experiences/stats', async (c) => {
  try {
    const stats = await getExperienceStats();
    return c.json({ stats });
  } catch (error) {
    logger.error('[Experience API] Stats failed:', error as Error);
    return c.json(
      { error: 'Failed to get experience stats', message: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});

/**
 * GET /api/memory/experiences/search - Similarity search
 * Query params: q (required), tags (comma-separated), limit
 */
memory.get('/experiences/search', async (c) => {
  try {
    const q = c.req.query('q') ?? '';
    const tagsRaw = c.req.query('tags');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '10', 10), 100);
    const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : undefined;

    if (!q) {
      return c.json({ error: 'Query parameter q is required' }, 400);
    }

    const experiences = await findSimilarExperiences(q, tags, limit);
    return c.json({ query: q, tags, experiences });
  } catch (error) {
    logger.error('[Experience API] Search failed:', error as Error);
    return c.json(
      { error: 'Experience search failed', message: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});

/**
 * POST /api/memory/experiences/decay - Trigger decay calculation
 */
memory.post('/experiences/decay', zValidator('json', DecaySchema), async (c) => {
  try {
    const { halfLifeDays } = c.req.valid('json');
    const updated = await applyDecay(halfLifeDays);
    return c.json({ message: 'Decay applied', updated, halfLifeDays });
  } catch (error) {
    logger.error('[Experience API] Decay failed:', error as Error);
    return c.json(
      { error: 'Decay calculation failed', message: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});

/**
 * POST /api/memory/experiences/prune - Remove low-weight experiences
 */
memory.post('/experiences/prune', zValidator('json', PruneSchema), async (c) => {
  try {
    const { minWeight } = c.req.valid('json');
    const pruned = await pruneExpired(minWeight);
    return c.json({ message: 'Prune complete', pruned, minWeight });
  } catch (error) {
    logger.error('[Experience API] Prune failed:', error as Error);
    return c.json(
      { error: 'Prune failed', message: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});

/**
 * GET /api/memory/experiences - List/search experiences
 */
memory.get('/experiences', async (c) => {
  try {
    const parsed = ListExperiencesSchema.safeParse({
      type: c.req.query('type'),
      userId: c.req.query('userId'),
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
      minWeight: c.req.query('minWeight'),
    });

    if (!parsed.success) {
      return c.json({ error: 'Invalid query params', issues: parsed.error.issues }, 400);
    }

    const result = await listExperiences(parsed.data);
    return c.json({
      experiences: result.experiences,
      total: result.total,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
  } catch (error) {
    logger.error('[Experience API] List failed:', error as Error);
    return c.json(
      { error: 'Failed to list experiences', message: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});

/**
 * POST /api/memory/experiences - Record a new experience
 */
memory.post('/experiences', zValidator('json', RecordExperienceSchema), async (c) => {
  try {
    const body = c.req.valid('json');
    const id = await recordExperience(body);
    return c.json({ id, message: 'Experience recorded' }, 201);
  } catch (error) {
    logger.error('[Experience API] Record failed:', error as Error);
    return c.json(
      { error: 'Failed to record experience', message: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});

/**
 * GET /api/memory/experiences/:id - Get single experience
 */
memory.get('/experiences/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const experience = await getExperience(id);

    if (!experience) {
      return c.json({ error: 'Experience not found' }, 404);
    }

    return c.json({ experience });
  } catch (error) {
    logger.error('[Experience API] Get failed:', error as Error);
    return c.json(
      { error: 'Failed to get experience', message: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});

/**
 * POST /api/memory/experiences/:id/use - Mark experience as used
 */
memory.post('/experiences/:id/use', async (c) => {
  try {
    const id = c.req.param('id');
    await markUsed(id);
    return c.json({ message: 'Marked as used', id });
  } catch (error) {
    logger.error('[Experience API] Mark used failed:', error as Error);
    return c.json(
      { error: 'Failed to mark experience as used', message: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});

/**
 * DELETE /api/memory/experiences/:id - Delete an experience
 */
memory.delete('/experiences/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const deleted = await deleteExperience(id);

    if (!deleted) {
      return c.json({ error: 'Experience not found or delete failed' }, 404);
    }

    return c.json({ message: 'Experience deleted', id });
  } catch (error) {
    logger.error('[Experience API] Delete failed:', error as Error);
    return c.json(
      { error: 'Failed to delete experience', message: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});

/**
 * POST /api/memory/preferences - Track a user preference
 */
memory.post('/preferences', zValidator('json', PreferenceTrackSchema), async (c) => {
  try {
    const { userId, category, value } = c.req.valid('json');
    await trackPreference(userId, category, value);
    return c.json({ message: 'Preference tracked', userId, category, value });
  } catch (error) {
    logger.error('[Experience API] Track preference failed:', error as Error);
    return c.json(
      { error: 'Failed to track preference', message: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});

/**
 * GET /api/memory/preferences/:userId - Get all preferences for a user
 */
memory.get('/preferences/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');
    const preferences = await getUserPreferences(userId);
    return c.json({ userId, preferences });
  } catch (error) {
    logger.error('[Experience API] Get preferences failed:', error as Error);
    return c.json(
      { error: 'Failed to get preferences', message: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});

export { memory as memoryRoutes };
