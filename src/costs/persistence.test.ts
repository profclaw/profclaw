/**
 * Tests for Cost History Persistence
 *
 * Covers: initCostPersistence, recordCost, flushPending,
 * getCostHistory, getDailyCosts, pruneCostHistory, stopCostPersistence
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { logger } from '../utils/logger.js';
import {
  flushPending,
  getCostHistory,
  getDailyCosts,
  initCostPersistence,
  pruneCostHistory,
  recordCost,
  stopCostPersistence,
} from './persistence.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Drain one full turn of the event loop so that fire-and-forget promises
 * (ensureTable, auto-flush) have a chance to settle.
 */
async function flushPromises(): Promise<void> {
  // Three rounds of micro-task resolution cover chained .then() calls.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  // One macro-task tick for anything scheduled via setImmediate/setTimeout(0).
  await new Promise<void>(resolve => setTimeout(resolve, 0));
}

type ExecuteCall = { sql: string; params: unknown[] };

function makeMockDb(overrides: Partial<{
  executeResult: unknown;
  executeError: Error;
}> = {}) {
  const calls: ExecuteCall[] = [];

  const db = {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (overrides.executeError) throw overrides.executeError;
      return overrides.executeResult ?? { rows: [], rowsAffected: 0 };
    }),
    calls,
  };

  return db;
}

// ---------------------------------------------------------------------------
// Reset module state between tests via stopCostPersistence
// ---------------------------------------------------------------------------

beforeEach(async () => {
  vi.clearAllMocks();
  // Ensure a clean state - stop any previous session without caring about
  // the result (getDbFn may be null on the first run, which is fine).
  await stopCostPersistence();
});

afterEach(async () => {
  vi.useRealTimers();
  await stopCostPersistence();
});

// ===========================================================================
// initCostPersistence
// ===========================================================================

describe('initCostPersistence', () => {
  it('calls ensureTable on the provided db immediately', async () => {
    const db = makeMockDb();
    initCostPersistence(() => db);
    await flushPromises();

    const sqlCalls = db.calls.map(c => c.sql.trim());
    expect(sqlCalls.some(s => s.startsWith('CREATE TABLE IF NOT EXISTS cost_history'))).toBe(true);
  });

  it('creates both required indices', async () => {
    const db = makeMockDb();
    initCostPersistence(() => db);
    await flushPromises();

    const sqlCalls = db.calls.map(c => c.sql.trim());
    expect(sqlCalls.some(s => s.includes('idx_cost_history_created'))).toBe(true);
    expect(sqlCalls.some(s => s.includes('idx_cost_history_model'))).toBe(true);
  });

  it('logs info after initialisation', () => {
    const db = makeMockDb();
    initCostPersistence(() => db);

    expect(logger.info).toHaveBeenCalledWith('[CostPersistence] Initialized');
  });

  it('logs a warning when table creation fails', async () => {
    const dbError = makeMockDb({ executeError: new Error('disk full') });
    initCostPersistence(() => dbError);
    await flushPromises();

    expect(logger.warn).toHaveBeenCalledWith(
      '[CostPersistence] Failed to create table',
      expect.objectContaining({ error: 'disk full' }),
    );
  });

  it('starts a 30-second flush interval that triggers flushPending', async () => {
    vi.useFakeTimers();
    const db = makeMockDb();
    initCostPersistence(() => db);

    // Add an entry so flushPending has something to write
    recordCost({ model: 'gpt-4o', inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: 0.001, source: 'chat' });

    // Advance just under 30s - no flush yet
    vi.advanceTimersByTime(29_999);
    const insertsBefore = db.calls.filter(c => c.sql.includes('INSERT')).length;
    expect(insertsBefore).toBe(0);

    // Advance past 30s - interval fires, flushPending runs
    await vi.advanceTimersByTimeAsync(1);

    const insertsAfter = db.calls.filter(c => c.sql.includes('INSERT')).length;
    expect(insertsAfter).toBe(1);
  });
});

// ===========================================================================
// recordCost
// ===========================================================================

describe('recordCost', () => {
  it('buffers entries without writing to DB immediately', async () => {
    const db = makeMockDb();
    initCostPersistence(() => db);
    await flushPromises();
    const insertsBefore = db.calls.filter(c => c.sql.includes('INSERT')).length;

    recordCost({ model: 'claude-3-5-sonnet', inputTokens: 100, outputTokens: 50, totalTokens: 150, cost: 0.005, source: 'chat' });

    const insertsAfter = db.calls.filter(c => c.sql.includes('INSERT')).length;
    expect(insertsAfter).toBe(insertsBefore);
  });

  it('auto-flushes when buffer reaches 50 entries', async () => {
    const db = makeMockDb();
    initCostPersistence(() => db);
    await flushPromises();

    for (let i = 0; i < 50; i++) {
      recordCost({ model: 'gpt-4o', inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: 0.001, source: 'api' });
    }

    // Auto-flush is fire-and-forget; drain async queue
    await flushPromises();

    const inserts = db.calls.filter(c => c.sql.includes('INSERT')).length;
    expect(inserts).toBe(50);
  });

  it('does not auto-flush at 49 entries', async () => {
    const db = makeMockDb();
    initCostPersistence(() => db);
    await flushPromises();

    for (let i = 0; i < 49; i++) {
      recordCost({ model: 'gpt-4o', inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0.0001, source: 'api' });
    }

    await flushPromises();

    const inserts = db.calls.filter(c => c.sql.includes('INSERT')).length;
    expect(inserts).toBe(0);
  });

  it('accepts optional agentId and sessionId fields', async () => {
    const db = makeMockDb();
    initCostPersistence(() => db);
    await flushPromises();

    recordCost({
      model: 'claude-3-haiku',
      inputTokens: 50,
      outputTokens: 20,
      totalTokens: 70,
      cost: 0.002,
      source: 'task',
      agentId: 'agent-1',
      sessionId: 'sess-abc',
    });

    const count = await flushPending();
    expect(count).toBe(1);

    const insertCall = db.calls.find(c => c.sql.includes('INSERT'));
    expect(insertCall).toBeDefined();
    expect(insertCall!.params).toContain('sess-abc');
    expect(insertCall!.params).toContain('agent-1');
  });
});

// ===========================================================================
// flushPending
// ===========================================================================

describe('flushPending', () => {
  it('returns 0 and makes no INSERT when buffer is empty', async () => {
    const db = makeMockDb();
    initCostPersistence(() => db);
    await flushPromises();
    const insertsBefore = db.calls.filter(c => c.sql.includes('INSERT')).length;

    const written = await flushPending();

    expect(written).toBe(0);
    expect(db.calls.filter(c => c.sql.includes('INSERT')).length).toBe(insertsBefore);
  });

  it('returns 0 when DB is not initialised (getDbFn is null)', async () => {
    // Use a fresh module instance so getDbFn is truly null.
    vi.resetModules();
    const { flushPending: freshFlush, recordCost: freshRecord } = await import('./persistence.js');

    freshRecord({ model: 'gpt-4o', inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: 0.001, source: 'chat' });

    const written = await freshFlush();
    expect(written).toBe(0);
  });

  it('writes buffered entries and returns correct count', async () => {
    const db = makeMockDb();
    initCostPersistence(() => db);
    await flushPromises();

    recordCost({ model: 'gpt-4o', inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: 0.001, source: 'chat' });
    recordCost({ model: 'claude-3-5-sonnet', inputTokens: 200, outputTokens: 80, totalTokens: 280, cost: 0.01, source: 'task' });

    const written = await flushPending();

    expect(written).toBe(2);
    expect(db.calls.filter(c => c.sql.includes('INSERT')).length).toBe(2);
  });

  it('stores cost as microdollars (cost * 1_000_000 rounded)', async () => {
    const db = makeMockDb();
    initCostPersistence(() => db);
    await flushPromises();

    recordCost({ model: 'gpt-4o', inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: 0.001234, source: 'chat' });

    await flushPending();

    const insertCall = db.calls.find(c => c.sql.includes('INSERT'));
    expect(insertCall).toBeDefined();
    // cost is at index 7 in the params array
    const costParam = insertCall!.params[7] as number;
    expect(costParam).toBe(1234); // 0.001234 * 1_000_000
  });

  it('clears the buffer after flush so a second flush writes nothing', async () => {
    const db = makeMockDb();
    initCostPersistence(() => db);
    await flushPromises();

    recordCost({ model: 'gpt-4o', inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: 0.001, source: 'chat' });

    const first = await flushPending();
    const second = await flushPending();

    expect(first).toBe(1);
    expect(second).toBe(0);
  });

  it('handles per-entry write errors gracefully and continues with remaining entries', async () => {
    let callCount = 0;
    const db = {
      execute: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT')) {
          callCount++;
          if (callCount === 2) throw new Error('write failed');
        }
        return { rows: [], rowsAffected: 0 };
      }),
    };

    initCostPersistence(() => db);
    await flushPromises();

    recordCost({ model: 'a', inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0.001, source: 'chat' });
    recordCost({ model: 'b', inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0.001, source: 'chat' });
    recordCost({ model: 'c', inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0.001, source: 'chat' });

    const written = await flushPending();

    // Entry 2 failed, entries 1 and 3 succeeded
    expect(written).toBe(2);
    expect(logger.warn).toHaveBeenCalledWith(
      '[CostPersistence] Failed to write entry',
      expect.objectContaining({ error: 'write failed' }),
    );
  });

  it('logs a debug message after writing entries', async () => {
    const db = makeMockDb();
    initCostPersistence(() => db);
    await flushPromises();

    recordCost({ model: 'gpt-4o', inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: 0.001, source: 'chat' });
    await flushPending();

    expect(logger.debug).toHaveBeenCalledWith(
      '[CostPersistence] Flushed entries',
      expect.objectContaining({ count: 1 }),
    );
  });

  it('does not log debug when written count is 0 (all entries failed)', async () => {
    const db = {
      execute: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT')) throw new Error('all fail');
        return { rows: [], rowsAffected: 0 };
      }),
    };

    initCostPersistence(() => db);
    await flushPromises();

    recordCost({ model: 'x', inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0.001, source: 'chat' });
    const written = await flushPending();

    expect(written).toBe(0);
    const debugCalls = (logger.debug as ReturnType<typeof vi.fn>).mock.calls;
    const flushDebug = debugCalls.filter(args => String(args[0]).includes('Flushed entries'));
    expect(flushDebug.length).toBe(0);
  });

  it('passes null for missing optional sessionId and agentId fields', async () => {
    const db = makeMockDb();
    initCostPersistence(() => db);
    await flushPromises();

    recordCost({ model: 'llama3', inputTokens: 5, outputTokens: 3, totalTokens: 8, cost: 0, source: 'cron' });
    await flushPending();

    const insertCall = db.calls.find(c => c.sql.includes('INSERT'));
    expect(insertCall).toBeDefined();
    // sessionId is at index 1, agentId is at index 9
    expect(insertCall!.params[1]).toBeNull();
    expect(insertCall!.params[9]).toBeNull();
  });
});

// ===========================================================================
// getCostHistory
// ===========================================================================

describe('getCostHistory', () => {
  it('returns zero aggregation when DB is not initialised', async () => {
    const result = await getCostHistory();
    expect(result).toEqual({
      period: 'all',
      totalCost: 0,
      totalTokens: 0,
      byModel: {},
      bySource: {},
      entryCount: 0,
    });
  });

  it('aggregates rows by model correctly', async () => {
    const db = makeMockDb({
      executeResult: {
        rows: [
          { model: 'gpt-4o', source: 'chat', total_tokens: 100, cost: 2_000_000 },
          { model: 'gpt-4o', source: 'chat', total_tokens: 200, cost: 4_000_000 },
          { model: 'claude-3-haiku', source: 'task', total_tokens: 50, cost: 500_000 },
        ],
      },
    });

    initCostPersistence(() => db);

    const result = await getCostHistory();

    expect(result.byModel['gpt-4o'].count).toBe(2);
    expect(result.byModel['gpt-4o'].tokens).toBe(300);
    expect(result.byModel['gpt-4o'].cost).toBeCloseTo(6.0);
    expect(result.byModel['claude-3-haiku'].count).toBe(1);
    expect(result.byModel['claude-3-haiku'].cost).toBeCloseTo(0.5);
  });

  it('aggregates rows by source correctly', async () => {
    const db = makeMockDb({
      executeResult: {
        rows: [
          { model: 'gpt-4o', source: 'chat', total_tokens: 100, cost: 1_000_000 },
          { model: 'gpt-4o', source: 'api', total_tokens: 50, cost: 500_000 },
          { model: 'gpt-4o', source: 'chat', total_tokens: 80, cost: 800_000 },
        ],
      },
    });

    initCostPersistence(() => db);

    const result = await getCostHistory();

    expect(result.bySource['chat'].count).toBe(2);
    expect(result.bySource['chat'].tokens).toBe(180);
    expect(result.bySource['api'].count).toBe(1);
  });

  it('converts microdollars to USD (divides by 1_000_000)', async () => {
    const db = makeMockDb({
      executeResult: {
        rows: [{ model: 'm', source: 's', total_tokens: 0, cost: 1_500_000 }],
      },
    });

    initCostPersistence(() => db);

    const result = await getCostHistory();
    expect(result.totalCost).toBeCloseTo(1.5);
  });

  it('returns entryCount equal to number of rows returned', async () => {
    const rows = Array.from({ length: 7 }, () => ({
      model: 'x', source: 'y', total_tokens: 10, cost: 1000,
    }));
    const db = makeMockDb({ executeResult: { rows } });

    initCostPersistence(() => db);

    const result = await getCostHistory();
    expect(result.entryCount).toBe(7);
  });

  it('appends since param to WHERE clause when provided', async () => {
    const db = makeMockDb({ executeResult: { rows: [] } });
    initCostPersistence(() => db);

    const since = new Date('2025-01-01T00:00:00Z');
    await getCostHistory({ since });

    const queryCall = db.calls.find(c => c.sql.includes('SELECT') && c.sql.includes('cost_history'));
    expect(queryCall).toBeDefined();
    expect(queryCall!.sql).toContain('created_at >=');
    expect(queryCall!.params[0]).toBe(Math.floor(since.getTime() / 1000));
  });

  it('appends until param to WHERE clause when provided', async () => {
    const db = makeMockDb({ executeResult: { rows: [] } });
    initCostPersistence(() => db);

    const until = new Date('2025-12-31T23:59:59Z');
    await getCostHistory({ until });

    const queryCall = db.calls.find(c => c.sql.includes('SELECT') && c.sql.includes('cost_history'));
    expect(queryCall!.sql).toContain('created_at <=');
    expect(queryCall!.params[0]).toBe(Math.floor(until.getTime() / 1000));
  });

  it('appends model filter to WHERE clause when provided', async () => {
    const db = makeMockDb({ executeResult: { rows: [] } });
    initCostPersistence(() => db);

    await getCostHistory({ model: 'claude-3-opus' });

    const queryCall = db.calls.find(c => c.sql.includes('SELECT') && c.sql.includes('cost_history'));
    expect(queryCall!.sql).toContain('model = ?');
    expect(queryCall!.params).toContain('claude-3-opus');
  });

  it('appends source filter to WHERE clause when provided', async () => {
    const db = makeMockDb({ executeResult: { rows: [] } });
    initCostPersistence(() => db);

    await getCostHistory({ source: 'cron' });

    const queryCall = db.calls.find(c => c.sql.includes('SELECT') && c.sql.includes('cost_history'));
    expect(queryCall!.sql).toContain('source = ?');
    expect(queryCall!.params).toContain('cron');
  });

  it('sets period to "all" when no since is given', async () => {
    const db = makeMockDb({ executeResult: { rows: [] } });
    initCostPersistence(() => db);

    const result = await getCostHistory();
    expect(result.period).toBe('all');
  });

  it('sets period to ISO range string when both since and until are given', async () => {
    const db = makeMockDb({ executeResult: { rows: [] } });
    initCostPersistence(() => db);

    const since = new Date('2025-06-01T00:00:00.000Z');
    const until = new Date('2025-06-30T00:00:00.000Z');
    const result = await getCostHistory({ since, until });

    expect(result.period).toBe(`${since.toISOString()} - ${until.toISOString()}`);
  });

  it('uses "now" as end of period string when since is set but until is not', async () => {
    const db = makeMockDb({ executeResult: { rows: [] } });
    initCostPersistence(() => db);

    const since = new Date('2025-01-01T00:00:00.000Z');
    const result = await getCostHistory({ since });

    expect(result.period).toBe(`${since.toISOString()} - now`);
  });

  it('uses default limit of 10000 when not specified', async () => {
    const db = makeMockDb({ executeResult: { rows: [] } });
    initCostPersistence(() => db);

    await getCostHistory();

    const queryCall = db.calls.find(c => c.sql.includes('LIMIT'));
    expect(queryCall).toBeDefined();
    expect(queryCall!.params).toContain(10000);
  });

  it('respects a custom limit when provided', async () => {
    const db = makeMockDb({ executeResult: { rows: [] } });
    initCostPersistence(() => db);

    await getCostHistory({ limit: 25 });

    const queryCall = db.calls.find(c => c.sql.includes('LIMIT'));
    expect(queryCall!.params).toContain(25);
  });
});

// ===========================================================================
// getDailyCosts
// ===========================================================================

describe('getDailyCosts', () => {
  it('returns empty array when DB is not initialised', async () => {
    const result = await getDailyCosts();
    expect(result).toEqual([]);
  });

  it('maps rows to date/cost/tokens/requests shape', async () => {
    const db = makeMockDb({
      executeResult: {
        rows: [
          { day: '2025-06-01', total_cost: 1_200_000, total_tokens: 5000, request_count: 10 },
          { day: '2025-05-31', total_cost: 800_000, total_tokens: 3000, request_count: 6 },
        ],
      },
    });

    initCostPersistence(() => db);

    const result = await getDailyCosts(30);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ date: '2025-06-01', cost: 1.2, tokens: 5000, requests: 10 });
    expect(result[1]).toEqual({ date: '2025-05-31', cost: 0.8, tokens: 3000, requests: 6 });
  });

  it('converts microdollar cost to USD for each row', async () => {
    const db = makeMockDb({
      executeResult: {
        rows: [{ day: '2025-06-01', total_cost: 500_000, total_tokens: 100, request_count: 1 }],
      },
    });

    initCostPersistence(() => db);

    const result = await getDailyCosts(7);
    expect(result[0].cost).toBeCloseTo(0.5);
  });

  it('queries with correct since timestamp for the given number of days', async () => {
    const db = makeMockDb({ executeResult: { rows: [] } });
    initCostPersistence(() => db);

    const now = Date.now();
    await getDailyCosts(14);

    const queryCall = db.calls.find(c => c.sql.includes('GROUP BY day'));
    expect(queryCall).toBeDefined();
    const since = queryCall!.params[0] as number;
    const expectedSince = Math.floor(now / 1000) - (14 * 86400);
    expect(Math.abs(since - expectedSince)).toBeLessThanOrEqual(2);
  });

  it('defaults to 30 days when no argument is given', async () => {
    const db = makeMockDb({ executeResult: { rows: [] } });
    initCostPersistence(() => db);

    const now = Date.now();
    await getDailyCosts();

    const queryCall = db.calls.find(c => c.sql.includes('GROUP BY day'));
    const since = queryCall!.params[0] as number;
    const expected = Math.floor(now / 1000) - (30 * 86400);
    expect(Math.abs(since - expected)).toBeLessThanOrEqual(2);
  });
});

// ===========================================================================
// pruneCostHistory
// ===========================================================================

describe('pruneCostHistory', () => {
  it('returns 0 when DB is not initialised', async () => {
    const pruned = await pruneCostHistory(90);
    expect(pruned).toBe(0);
  });

  it('executes DELETE with correct cutoff timestamp', async () => {
    const db = makeMockDb({ executeResult: { rowsAffected: 3 } });
    initCostPersistence(() => db);

    const now = Date.now();
    await pruneCostHistory(30);

    const deleteCall = db.calls.find(c => c.sql.includes('DELETE'));
    expect(deleteCall).toBeDefined();
    expect(deleteCall!.sql).toContain('cost_history');

    const cutoff = deleteCall!.params[0] as number;
    const expected = Math.floor(now / 1000) - (30 * 86400);
    expect(Math.abs(cutoff - expected)).toBeLessThanOrEqual(2);
  });

  it('returns rowsAffected from DELETE result', async () => {
    const db = makeMockDb({ executeResult: { rowsAffected: 17 } });
    initCostPersistence(() => db);

    const pruned = await pruneCostHistory(90);
    expect(pruned).toBe(17);
  });

  it('logs info when rows are pruned', async () => {
    const db = makeMockDb({ executeResult: { rowsAffected: 5 } });
    initCostPersistence(() => db);

    await pruneCostHistory(60);

    expect(logger.info).toHaveBeenCalledWith(
      '[CostPersistence] Pruned old entries',
      expect.objectContaining({ pruned: 5, retainDays: 60 }),
    );
  });

  it('does not log when no rows are pruned', async () => {
    const db = makeMockDb({ executeResult: { rowsAffected: 0 } });
    initCostPersistence(() => db);

    vi.clearAllMocks();
    await pruneCostHistory(90);

    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls;
    const pruneLog = infoCalls.filter(args => String(args[0]).includes('Pruned'));
    expect(pruneLog.length).toBe(0);
  });

  it('defaults to 90 days retention when no argument is given', async () => {
    const db = makeMockDb({ executeResult: { rowsAffected: 0 } });
    initCostPersistence(() => db);

    const now = Date.now();
    await pruneCostHistory();

    const deleteCall = db.calls.find(c => c.sql.includes('DELETE'));
    const cutoff = deleteCall!.params[0] as number;
    const expected = Math.floor(now / 1000) - (90 * 86400);
    expect(Math.abs(cutoff - expected)).toBeLessThanOrEqual(2);
  });
});

// ===========================================================================
// stopCostPersistence
// ===========================================================================

describe('stopCostPersistence', () => {
  it('clears the flush interval so no further timed writes occur', async () => {
    vi.useFakeTimers();
    const db = makeMockDb();
    initCostPersistence(() => db);

    // Record one entry so there is something to flush on stop
    recordCost({ model: 'gpt-4o', inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: 0.001, source: 'chat' });

    await stopCostPersistence();

    // Count inserts that happened during the final flush on stop
    const insertsAtStop = db.calls.filter(c => c.sql.includes('INSERT')).length;

    // Add another entry and advance well past 30s - the interval should be dead
    recordCost({ model: 'gpt-4o', inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: 0.001, source: 'chat' });
    await vi.advanceTimersByTimeAsync(60_000);

    const insertsAfterAdvance = db.calls.filter(c => c.sql.includes('INSERT')).length;
    // The 60s advance should not have caused any new INSERTs via the interval
    expect(insertsAfterAdvance).toBe(insertsAtStop);
  });

  it('performs a final flush of all buffered entries', async () => {
    const db = makeMockDb();
    initCostPersistence(() => db);
    await flushPromises();

    recordCost({ model: 'x', inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0.001, source: 'chat' });
    recordCost({ model: 'y', inputTokens: 2, outputTokens: 2, totalTokens: 4, cost: 0.002, source: 'task' });

    await stopCostPersistence();

    const inserts = db.calls.filter(c => c.sql.includes('INSERT')).length;
    expect(inserts).toBe(2);
  });

  it('logs info on stop', async () => {
    const db = makeMockDb();
    initCostPersistence(() => db);
    await flushPromises();

    vi.clearAllMocks();
    await stopCostPersistence();

    expect(logger.info).toHaveBeenCalledWith('[CostPersistence] Stopped');
  });

  it('is safe to call multiple times consecutively without throwing', async () => {
    const db = makeMockDb();
    initCostPersistence(() => db);
    await flushPromises();

    await expect(stopCostPersistence()).resolves.not.toThrow();
    await expect(stopCostPersistence()).resolves.not.toThrow();
    await expect(stopCostPersistence()).resolves.not.toThrow();
  });
});
