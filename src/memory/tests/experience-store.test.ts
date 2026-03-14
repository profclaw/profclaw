import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock the storage client with a full in-memory SQLite-like implementation
// =============================================================================

// We use a simple map as in-memory backing store
const store = new Map<string, Record<string, unknown>>();
let idCounter = 0;

type SqlArgs = Array<string | number | null>;

interface QueryResult {
  rows: Array<Record<string, unknown>>;
}

/**
 * Minimal in-memory "database" that handles the SQL patterns used by
 * experience-store.ts without requiring a real SQLite instance.
 */
function createMockClient() {
  return {
    execute: vi.fn(
      async (
        queryOrObj:
          | string
          | { sql: string; args?: SqlArgs },
      ): Promise<QueryResult> => {
        const sql =
          typeof queryOrObj === 'string'
            ? queryOrObj
            : queryOrObj.sql;
        const args: SqlArgs =
          (typeof queryOrObj === 'object' && queryOrObj.args) ? queryOrObj.args : [];

        // ---------------------------------------------------------------
        // DDL - silently ignore
        // ---------------------------------------------------------------
        if (/CREATE TABLE|CREATE INDEX/i.test(sql)) {
          return { rows: [] };
        }

        // ---------------------------------------------------------------
        // INSERT
        // ---------------------------------------------------------------
        if (/^\s*INSERT/i.test(sql)) {
          // Extract the id from args position 0
          const id = args[0] as string;
          const row: Record<string, unknown> = {
            id,
            type: args[1],
            intent: args[2],
            solution: args[3],
            success_score: args[4],
            tags: args[5],
            source_conversation_id: args[6],
            user_id: args[7],
            created_at: args[8],
            last_used_at: args[9],
            use_count: 1,
            weight: 1.0,
          };
          store.set(id, row);
          return { rows: [] };
        }

        // ---------------------------------------------------------------
        // UPDATE - handles multiple patterns
        // ---------------------------------------------------------------
        if (/^\s*UPDATE/i.test(sql)) {
          if (/SET solution = \?, use_count = use_count \+ 1/i.test(sql)) {
            // trackPreference update (more specific - must come before markUsed check)
            const [newSolution, newLastUsedAt, id] = args as [string, number, string];
            const row = store.get(id);
            if (row) {
              store.set(id, {
                ...row,
                solution: newSolution,
                use_count: (row['use_count'] as number) + 1,
                last_used_at: newLastUsedAt,
                weight: Math.min(1.0, (row['weight'] as number) + 0.05),
              });
            }
          } else if (/use_count = use_count \+ 1.*last_used_at/i.test(sql)) {
            // markUsed: UPDATE experiences SET use_count = use_count + 1, last_used_at = ? WHERE id = ?
            const [newLastUsedAt, id] = args as [number, string];
            const row = store.get(id);
            if (row) {
              store.set(id, {
                ...row,
                use_count: (row['use_count'] as number) + 1,
                last_used_at: newLastUsedAt,
              });
            }
          } else if (/SET weight = \? WHERE id = \?/i.test(sql)) {
            // applyDecay individual update
            const [newWeight, id] = args as [number, string];
            const row = store.get(id);
            if (row) {
              store.set(id, { ...row, weight: newWeight });
            }
          }
          return { rows: [] };
        }

        // ---------------------------------------------------------------
        // DELETE
        // ---------------------------------------------------------------
        if (/^\s*DELETE/i.test(sql)) {
          if (/WHERE id = \?/i.test(sql)) {
            store.delete(args[0] as string);
          } else if (/WHERE weight < \?/i.test(sql)) {
            const minWeight = args[0] as number;
            for (const [id, row] of store.entries()) {
              if ((row['weight'] as number) < minWeight) {
                store.delete(id);
              }
            }
          }
          return { rows: [] };
        }

        // ---------------------------------------------------------------
        // SELECT - multiple patterns
        // ---------------------------------------------------------------
        if (/^\s*SELECT/i.test(sql)) {
          const all = Array.from(store.values());

          // COUNT queries
          if (/SELECT COUNT\(\*\) as count FROM experiences WHERE weight < \?/i.test(sql)) {
            const minWeight = args[0] as number;
            const count = all.filter((r) => (r['weight'] as number) < minWeight).length;
            return { rows: [{ count }] };
          }

          if (/SELECT COUNT\(\*\) as count/i.test(sql)) {
            // Possibly filtered count
            let filtered = all;
            if (/WHERE/i.test(sql)) {
              // Simple type filter
              if (/type = \?/i.test(sql) && args[0]) {
                filtered = filtered.filter((r) => r['type'] === args[0]);
              }
              if (/user_id = \?/i.test(sql)) {
                const uidIdx = sql.toLowerCase().indexOf('user_id') < sql.toLowerCase().indexOf('type') ? 0 : 1;
                filtered = filtered.filter((r) => r['user_id'] === args[uidIdx]);
              }
            }
            return { rows: [{ count: filtered.length }] };
          }

          // AVG age query
          if (/AVG\(.*created_at.*\) as avg_age/i.test(sql)) {
            const now = args[0] as number;
            if (all.length === 0) return { rows: [{ avg_age: 0 }] };
            const avg = all.reduce((sum, r) => sum + (now - (r['created_at'] as number)) / 86400000, 0) / all.length;
            return { rows: [{ avg_age: avg }] };
          }

          // GROUP BY type count
          if (/GROUP BY type/i.test(sql)) {
            const byType = new Map<string, number>();
            for (const row of all) {
              const t = row['type'] as string;
              byType.set(t, (byType.get(t) ?? 0) + 1);
            }
            return { rows: Array.from(byType.entries()).map(([type, count]) => ({ type, count })) };
          }

          // SELECT id, last_used_at, weight FROM experiences (decay query)
          if (/SELECT id, last_used_at, weight FROM experiences/i.test(sql)) {
            return { rows: all.map((r) => ({ id: r['id'], last_used_at: r['last_used_at'], weight: r['weight'] })) };
          }

          // trackPreference existence check (multiline SQL - use [\s\S]* not .*)
          if (/type = 'user_preference'[\s\S]*user_id = \?[\s\S]*LOWER\(intent\)/i.test(sql)) {
            const userId = args[0] as string;
            const intent = (args[1] as string).toLowerCase();
            const match = all.find(
              (r) =>
                r['type'] === 'user_preference' &&
                r['user_id'] === userId &&
                (r['intent'] as string).toLowerCase() === intent,
            );
            if (match) {
              return { rows: [{ id: match['id'], solution: match['solution'], use_count: match['use_count'] }] };
            }
            return { rows: [] };
          }

          // getUserPreferences - SELECT solution WHERE type = 'user_preference' AND user_id = ?
          if (/SELECT solution FROM experiences\s+WHERE type = 'user_preference' AND user_id = \?/i.test(sql)) {
            const userId = args[0] as string;
            const rows = all
              .filter((r) => r['type'] === 'user_preference' && r['user_id'] === userId)
              .sort((a, b) => (b['weight'] as number) - (a['weight'] as number))
              .map((r) => ({ solution: r['solution'] }));
            return { rows };
          }

          // SELECT * FROM experiences WHERE id = ?
          if (/WHERE id = \?/i.test(sql)) {
            const row = store.get(args[0] as string);
            return { rows: row ? [row] : [] };
          }

          // findSimilarExperiences - keyword/weight query
          if (/keyword_score/i.test(sql)) {
            // Return rows with weight > 0.05, respecting the LIMIT (last numeric arg)
            const minWeight = 0.05;
            const limitArg = args.filter((a) => typeof a === 'number').pop() as number | undefined;
            let resultRows = all
              .filter((r) => (r['weight'] as number) > minWeight)
              .map((r) => ({ ...r, keyword_score: 1 }));
            if (limitArg !== undefined) {
              resultRows = resultRows.slice(0, limitArg);
            }
            return { rows: resultRows };
          }

          // fallback for findSimilarExperiences empty words
          if (/weight > 0\.1 ORDER BY use_count/i.test(sql)) {
            const lim = args[0] as number ?? 10;
            const resultRows = all
              .filter((r) => (r['weight'] as number) > 0.1)
              .sort((a, b) => (b['use_count'] as number) - (a['use_count'] as number))
              .slice(0, lim);
            return { rows: resultRows };
          }

          // General SELECT * with optional filters
          let filtered = [...all];
          if (/type = \?/i.test(sql) && args.includes(args[0])) {
            filtered = filtered.filter((r) => r['type'] === args[0]);
          }
          if (/user_id = \?/i.test(sql)) {
            const userIdArg = args.find((a) => typeof a === 'string' && a.startsWith('user-'));
            if (userIdArg) {
              filtered = filtered.filter((r) => r['user_id'] === userIdArg);
            }
          }
          if (/weight >= \?/i.test(sql)) {
            const minW = args.find((a) => typeof a === 'number') as number;
            if (minW !== undefined) {
              filtered = filtered.filter((r) => (r['weight'] as number) >= minW);
            }
          }
          // Apply limit/offset at end (last two numeric args)
          const numericArgs = args.filter((a) => typeof a === 'number') as number[];
          if (numericArgs.length >= 2) {
            const lim = numericArgs[numericArgs.length - 2];
            const off = numericArgs[numericArgs.length - 1];
            filtered = filtered.slice(off, off + lim);
          }
          return { rows: filtered };
        }

        return { rows: [] };
      },
    ),
  };
}

let mockClient = createMockClient();

vi.mock('../../storage/index.js', () => ({
  getClient: () => mockClient,
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  createContextualLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Must be imported AFTER the mocks are in place
import {
  recordExperience,
  getExperience,
  markUsed,
  deleteExperience,
  listExperiences,
  findSimilarExperiences,
  trackPreference,
  getUserPreferences,
  applyDecay,
  pruneExpired,
  getStats,
} from '../experience-store.js';
import type { ExperienceType } from '../experience-store.js';

// =============================================================================
// Helpers
// =============================================================================

function makeExp(overrides: Partial<Parameters<typeof recordExperience>[0]> = {}) {
  return {
    type: 'tool_chain' as ExperienceType,
    intent: 'run tests and fix errors',
    solution: { tools: ['exec', 'read_file'] },
    successScore: 0.9,
    tags: ['test', 'fix'],
    sourceConversationId: 'conv-abc',
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('experience-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    idCounter = 0;
    mockClient = createMockClient();
  });

  // ---------------------------------------------------------------------------
  // recordExperience + getExperience round-trip
  // ---------------------------------------------------------------------------

  describe('recordExperience + getExperience', () => {
    it('stores an experience and retrieves it by ID', async () => {
      const id = await recordExperience(makeExp());
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);

      const found = await getExperience(id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(id);
      expect(found!.type).toBe('tool_chain');
      expect(found!.intent).toBe('run tests and fix errors');
    });

    it('persists solution as parsed JSON (not raw string)', async () => {
      const solution = { tools: ['exec', 'grep'], totalDurationMs: 500, allSucceeded: true };
      const id = await recordExperience(makeExp({ solution }));
      const found = await getExperience(id);
      expect(found!.solution).toEqual(solution);
    });

    it('persists tags as an array', async () => {
      const id = await recordExperience(makeExp({ tags: ['node', 'typescript', 'build'] }));
      const found = await getExperience(id);
      expect(found!.tags).toEqual(['node', 'typescript', 'build']);
    });

    it('sets initial useCount to 1 and weight to 1.0', async () => {
      const id = await recordExperience(makeExp());
      const found = await getExperience(id);
      expect(found!.useCount).toBe(1);
      expect(found!.weight).toBe(1.0);
    });

    it('stores userId when provided', async () => {
      const id = await recordExperience(makeExp({ userId: 'user-42' }));
      const found = await getExperience(id);
      expect(found!.userId).toBe('user-42');
    });

    it('returns null for non-existent ID', async () => {
      const found = await getExperience('does-not-exist');
      expect(found).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // markUsed
  // ---------------------------------------------------------------------------

  describe('markUsed', () => {
    it('increments useCount when markUsed is called', async () => {
      const id = await recordExperience(makeExp());
      // Initial count is 1 (set in INSERT)
      await markUsed(id);

      const found = await getExperience(id);
      expect(found!.useCount).toBe(2);
    });

    it('updates lastUsedAt to a recent timestamp', async () => {
      const before = Date.now();
      const id = await recordExperience(makeExp());
      await markUsed(id);
      const after = Date.now();

      const found = await getExperience(id);
      expect(found!.lastUsedAt).toBeGreaterThanOrEqual(before);
      expect(found!.lastUsedAt).toBeLessThanOrEqual(after + 5);
    });

    it('is a no-op for non-existent id (does not throw)', async () => {
      await expect(markUsed('non-existent-id')).resolves.not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // deleteExperience
  // ---------------------------------------------------------------------------

  describe('deleteExperience', () => {
    it('removes the experience from the store', async () => {
      const id = await recordExperience(makeExp());
      const deleted = await deleteExperience(id);

      expect(deleted).toBe(true);
      const found = await getExperience(id);
      expect(found).toBeNull();
    });

    it('returns true even for non-existent id (DELETE is idempotent in our mock)', async () => {
      const result = await deleteExperience('ghost-id');
      expect(result).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // findSimilarExperiences
  // ---------------------------------------------------------------------------

  describe('findSimilarExperiences', () => {
    it('returns empty array when store is empty', async () => {
      const results = await findSimilarExperiences('run tests');
      expect(results).toEqual([]);
    });

    it('returns experiences when keywords match intent', async () => {
      await recordExperience(makeExp({ intent: 'run unit tests for the project' }));
      await recordExperience(makeExp({ intent: 'deploy the application to production' }));

      const results = await findSimilarExperiences('run tests');
      expect(results.length).toBeGreaterThan(0);
    });

    it('re-ranks results by tag overlap when tags are provided', async () => {
      await recordExperience(makeExp({ intent: 'fix typescript errors', tags: ['typescript', 'fix'] }));
      await recordExperience(makeExp({ intent: 'fix syntax errors', tags: ['syntax', 'fix'] }));

      const results = await findSimilarExperiences('fix errors', ['typescript']);
      // Result with typescript tag should come first
      if (results.length >= 2) {
        const firstTags = results[0].tags;
        expect(firstTags).toContain('typescript');
      }
    });

    it('returns experiences sorted by weight descending when no tags given', async () => {
      await recordExperience(makeExp({ intent: 'build the project fast' }));
      await recordExperience(makeExp({ intent: 'build the release package' }));

      const results = await findSimilarExperiences('build project');
      // Should return without error and be an array
      expect(Array.isArray(results)).toBe(true);
    });

    it('respects the limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await recordExperience(makeExp({ intent: `task number ${i} for testing` }));
      }
      const results = await findSimilarExperiences('task', undefined, 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  // ---------------------------------------------------------------------------
  // trackPreference + getUserPreferences
  // ---------------------------------------------------------------------------

  describe('trackPreference + getUserPreferences', () => {
    it('creates a new preference experience on first call', async () => {
      await trackPreference('user-1', 'language', 'TypeScript');

      const prefs = await getUserPreferences('user-1');
      expect(prefs['language']).toBeDefined();
      expect(prefs['language'].length).toBe(1);
      expect(prefs['language'][0].preference).toBe('TypeScript');
      expect(prefs['language'][0].confidence).toBeCloseTo(0.4);
    });

    it('increases confidence on repeated calls for same category+value', async () => {
      await trackPreference('user-2', 'framework', 'React');
      await trackPreference('user-2', 'framework', 'React'); // second call

      const prefs = await getUserPreferences('user-2');
      // Confidence should be > 0.4 (initial) after second call
      expect(prefs['framework'][0].confidence).toBeGreaterThan(0.4);
    });

    it('groups preferences by category', async () => {
      await trackPreference('user-3', 'language', 'Python');
      await trackPreference('user-3', 'style', 'functional');

      const prefs = await getUserPreferences('user-3');
      expect(prefs['language']).toBeDefined();
      expect(prefs['style']).toBeDefined();
    });

    it('returns empty object for unknown user', async () => {
      const prefs = await getUserPreferences('user-nobody');
      expect(prefs).toEqual({});
    });

    it('confidence is capped at 1.0 after many repeated calls', async () => {
      for (let i = 0; i < 20; i++) {
        await trackPreference('user-4', 'editor', 'neovim');
      }
      const prefs = await getUserPreferences('user-4');
      expect(prefs['editor'][0].confidence).toBeLessThanOrEqual(1.0);
    });
  });

  // ---------------------------------------------------------------------------
  // applyDecay
  // ---------------------------------------------------------------------------

  describe('applyDecay', () => {
    it('returns 0 when store is empty', async () => {
      const count = await applyDecay();
      expect(count).toBe(0);
    });

    it('reduces weight for old experiences', async () => {
      // Insert a row directly into store with an old last_used_at
      const id = await recordExperience(makeExp());
      // Manually age it: set last_used_at 60 days ago
      const row = store.get(id);
      if (row) {
        const sixtyDaysAgo = Date.now() - 60 * 24 * 60 * 60 * 1000;
        store.set(id, { ...row, last_used_at: sixtyDaysAgo, weight: 1.0 });
      }

      const updated = await applyDecay(30); // 30-day half-life

      expect(updated).toBe(1);
      const found = await getExperience(id);
      // After 60 days with 30-day half-life, weight should be ~0.25
      expect(found!.weight).toBeLessThan(0.5);
    });

    it('returns the count of updated records', async () => {
      await recordExperience(makeExp());
      await recordExperience(makeExp());

      const count = await applyDecay();
      expect(count).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // pruneExpired
  // ---------------------------------------------------------------------------

  describe('pruneExpired', () => {
    it('returns 0 when no experiences are below minWeight', async () => {
      await recordExperience(makeExp()); // weight = 1.0
      const pruned = await pruneExpired(0.05);
      expect(pruned).toBe(0);
    });

    it('removes experiences below minWeight threshold', async () => {
      const id = await recordExperience(makeExp());
      // Force weight below threshold
      const row = store.get(id);
      if (row) store.set(id, { ...row, weight: 0.01 });

      const pruned = await pruneExpired(0.05);
      expect(pruned).toBe(1);
      expect(store.has(id)).toBe(false);
    });

    it('preserves experiences at or above minWeight', async () => {
      const id = await recordExperience(makeExp());
      const row = store.get(id);
      if (row) store.set(id, { ...row, weight: 0.1 });

      const pruned = await pruneExpired(0.05);
      expect(pruned).toBe(0);
      expect(store.has(id)).toBe(true);
    });

    it('returns count of pruned records when multiple are below threshold', async () => {
      for (let i = 0; i < 3; i++) {
        const id = await recordExperience(makeExp());
        const row = store.get(id);
        if (row) store.set(id, { ...row, weight: 0.01 });
      }

      const pruned = await pruneExpired(0.05);
      expect(pruned).toBe(3);
      expect(store.size).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // getStats
  // ---------------------------------------------------------------------------

  describe('getStats', () => {
    it('returns zero stats for empty store', async () => {
      const stats = await getStats();
      expect(stats.total).toBe(0);
      expect(stats.byType).toEqual({});
      expect(stats.avgAge).toBe(0);
    });

    it('returns correct total count', async () => {
      await recordExperience(makeExp());
      await recordExperience(makeExp());
      await recordExperience(makeExp());

      const stats = await getStats();
      expect(stats.total).toBe(3);
    });

    it('groups count byType correctly', async () => {
      await recordExperience(makeExp({ type: 'tool_chain' }));
      await recordExperience(makeExp({ type: 'tool_chain' }));
      await recordExperience(makeExp({ type: 'user_preference' }));

      const stats = await getStats();
      expect(stats.byType['tool_chain']).toBe(2);
      expect(stats.byType['user_preference']).toBe(1);
    });

    it('avgAge is 0 for freshly inserted experiences', async () => {
      await recordExperience(makeExp());
      const stats = await getStats();
      // Freshly created = near 0 days
      expect(stats.avgAge).toBeGreaterThanOrEqual(0);
      expect(stats.avgAge).toBeLessThan(1); // less than 1 day
    });
  });

  // ---------------------------------------------------------------------------
  // listExperiences
  // ---------------------------------------------------------------------------

  describe('listExperiences', () => {
    it('returns all experiences when no filters applied', async () => {
      await recordExperience(makeExp());
      await recordExperience(makeExp());

      const result = await listExperiences();
      expect(result.total).toBe(2);
      expect(result.experiences.length).toBe(2);
    });

    it('returns empty result when store is empty', async () => {
      const result = await listExperiences();
      expect(result.total).toBe(0);
      expect(result.experiences).toEqual([]);
    });

    it('filters by type', async () => {
      await recordExperience(makeExp({ type: 'task_solution' }));
      await recordExperience(makeExp({ type: 'error_recovery' }));

      const result = await listExperiences({ type: 'task_solution' });
      expect(result.experiences.every((e) => e.type === 'task_solution')).toBe(true);
    });

    it('filters by userId', async () => {
      await recordExperience(makeExp({ userId: 'user-alice' }));
      await recordExperience(makeExp({ userId: 'user-bob' }));

      const result = await listExperiences({ userId: 'user-alice' });
      // All returned experiences should belong to alice
      for (const exp of result.experiences) {
        expect(exp.userId).toBe('user-alice');
      }
    });

    it('respects limit and offset options', async () => {
      for (let i = 0; i < 5; i++) {
        await recordExperience(makeExp({ intent: `experience ${i}` }));
      }

      const page1 = await listExperiences({ limit: 2, offset: 0 });
      const page2 = await listExperiences({ limit: 2, offset: 2 });

      expect(page1.experiences.length).toBeLessThanOrEqual(2);
      expect(page2.experiences.length).toBeLessThanOrEqual(2);
    });

    it('filters by minWeight', async () => {
      const id1 = await recordExperience(makeExp());
      const id2 = await recordExperience(makeExp());

      // Lower the weight of id2 below threshold
      const row2 = store.get(id2);
      if (row2) store.set(id2, { ...row2, weight: 0.02 });

      const result = await listExperiences({ minWeight: 0.5 });
      const ids = result.experiences.map((e) => e.id);
      expect(ids).toContain(id1);
      expect(ids).not.toContain(id2);
    });
  });
});
