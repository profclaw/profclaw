/**
 * Cost History Persistence
 *
 * Flushes in-memory usage data to SQLite for long-term tracking.
 * Provides aggregation queries for analytics dashboards.
 */

import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';

interface CostEntry {
  model: string;
  provider?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  source: string;
  agentId?: string;
  sessionId?: string;
}

interface CostAggregation {
  period: string;
  totalCost: number;
  totalTokens: number;
  byModel: Record<string, { cost: number; tokens: number; count: number }>;
  bySource: Record<string, { cost: number; tokens: number; count: number }>;
  entryCount: number;
}

type DbClient = {
  execute: (sql: string, params?: unknown[]) => Promise<unknown>;
};

// Buffer for batch writes
const pendingEntries: CostEntry[] = [];
let flushInterval: ReturnType<typeof setInterval> | null = null;
let getDbFn: (() => DbClient) | null = null;

/**
 * Initialize cost persistence with database connection
 */
export function initCostPersistence(
  getDb: () => DbClient,
): void {
  getDbFn = getDb;

  // Create table if not exists
  ensureTable().catch((err: unknown) => {
    logger.warn('[CostPersistence] Failed to create table', { error: (err as Error).message });
  });

  // Flush every 30 seconds
  flushInterval = setInterval(() => {
    flushPending().catch((err: unknown) => {
      logger.warn('[CostPersistence] Flush failed', { error: (err as Error).message });
    });
  }, 30_000);

  logger.info('[CostPersistence] Initialized');
}

async function ensureTable(): Promise<void> {
  if (!getDbFn) return;
  const db = getDbFn();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cost_history (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      model TEXT NOT NULL,
      provider TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'chat',
      agent_id TEXT,
      metadata TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // Index for time-range queries
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_cost_history_created
    ON cost_history(created_at)
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_cost_history_model
    ON cost_history(model)
  `);
}

/**
 * Record a cost entry (buffered, flushed periodically)
 */
export function recordCost(entry: CostEntry): void {
  pendingEntries.push(entry);

  // Flush immediately if buffer is large
  if (pendingEntries.length >= 50) {
    flushPending().catch(() => {});
  }
}

/**
 * Flush buffered entries to database
 */
export async function flushPending(): Promise<number> {
  if (pendingEntries.length === 0 || !getDbFn) return 0;

  const entries = pendingEntries.splice(0, pendingEntries.length);
  const db = getDbFn();

  let written = 0;
  for (const entry of entries) {
    try {
      const id = randomUUID();
      // Store cost as microdollars (integer) for precision
      const costMicro = Math.round(entry.cost * 1_000_000);

      await db.execute(
        `INSERT INTO cost_history (id, session_id, model, provider, input_tokens, output_tokens, total_tokens, cost, source, agent_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`,
        [id, entry.sessionId ?? null, entry.model, entry.provider ?? null,
         entry.inputTokens, entry.outputTokens, entry.totalTokens,
         costMicro, entry.source, entry.agentId ?? null],
      );
      written++;
    } catch (err) {
      logger.warn('[CostPersistence] Failed to write entry', {
        model: entry.model,
        error: (err as Error).message,
      });
    }
  }

  if (written > 0) {
    logger.debug('[CostPersistence] Flushed entries', { count: written });
  }
  return written;
}

/**
 * Query cost history with aggregation
 */
export async function getCostHistory(options: {
  since?: Date;
  until?: Date;
  model?: string;
  source?: string;
  limit?: number;
} = {}): Promise<CostAggregation> {
  if (!getDbFn) {
    return { period: 'all', totalCost: 0, totalTokens: 0, byModel: {}, bySource: {}, entryCount: 0 };
  }

  const db = getDbFn();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.since) {
    conditions.push('created_at >= ?');
    params.push(Math.floor(options.since.getTime() / 1000));
  }
  if (options.until) {
    conditions.push('created_at <= ?');
    params.push(Math.floor(options.until.getTime() / 1000));
  }
  if (options.model) {
    conditions.push('model = ?');
    params.push(options.model);
  }
  if (options.source) {
    conditions.push('source = ?');
    params.push(options.source);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit ?? 10000;

  const result = await db.execute(
    `SELECT model, source, agent_id, input_tokens, output_tokens, total_tokens, cost
     FROM cost_history ${where} ORDER BY created_at DESC LIMIT ?`,
    [...params, limit],
  ) as { rows: Array<Record<string, unknown>> };

  const rows = result.rows ?? [];
  const byModel: Record<string, { cost: number; tokens: number; count: number }> = {};
  const bySource: Record<string, { cost: number; tokens: number; count: number }> = {};
  let totalCost = 0;
  let totalTokens = 0;

  for (const row of rows) {
    const model = String(row['model'] ?? 'unknown');
    const source = String(row['source'] ?? 'unknown');
    const costUsd = Number(row['cost'] ?? 0) / 1_000_000;
    const tokens = Number(row['total_tokens'] ?? 0);

    totalCost += costUsd;
    totalTokens += tokens;

    if (!byModel[model]) byModel[model] = { cost: 0, tokens: 0, count: 0 };
    byModel[model].cost += costUsd;
    byModel[model].tokens += tokens;
    byModel[model].count += 1;

    if (!bySource[source]) bySource[source] = { cost: 0, tokens: 0, count: 0 };
    bySource[source].cost += costUsd;
    bySource[source].tokens += tokens;
    bySource[source].count += 1;
  }

  const period = options.since
    ? `${options.since.toISOString()} - ${options.until?.toISOString() ?? 'now'}`
    : 'all';

  return { period, totalCost, totalTokens, byModel, bySource, entryCount: rows.length };
}

/**
 * Get daily cost breakdown for the last N days
 */
export async function getDailyCosts(days: number = 30): Promise<Array<{
  date: string;
  cost: number;
  tokens: number;
  requests: number;
}>> {
  if (!getDbFn) return [];

  const db = getDbFn();
  const since = Math.floor(Date.now() / 1000) - (days * 86400);

  const result = await db.execute(
    `SELECT date(created_at, 'unixepoch') as day,
            SUM(cost) as total_cost,
            SUM(total_tokens) as total_tokens,
            COUNT(*) as request_count
     FROM cost_history
     WHERE created_at >= ?
     GROUP BY day
     ORDER BY day DESC`,
    [since],
  ) as { rows: Array<Record<string, unknown>> };

  return (result.rows ?? []).map(row => ({
    date: String(row['day']),
    cost: Number(row['total_cost'] ?? 0) / 1_000_000,
    tokens: Number(row['total_tokens'] ?? 0),
    requests: Number(row['request_count'] ?? 0),
  }));
}

/**
 * Cleanup old cost history entries
 */
export async function pruneCostHistory(retainDays: number = 90): Promise<number> {
  if (!getDbFn) return 0;

  const db = getDbFn();
  const cutoff = Math.floor(Date.now() / 1000) - (retainDays * 86400);

  const result = await db.execute(
    'DELETE FROM cost_history WHERE created_at < ?',
    [cutoff],
  ) as { rowsAffected?: number };

  const pruned = result.rowsAffected ?? 0;
  if (pruned > 0) {
    logger.info('[CostPersistence] Pruned old entries', { pruned, retainDays });
  }
  return pruned;
}

/**
 * Stop cost persistence (flush remaining, clear interval)
 */
export async function stopCostPersistence(): Promise<void> {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }

  // Final flush
  await flushPending();
  logger.info('[CostPersistence] Stopped');
}
