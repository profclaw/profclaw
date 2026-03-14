/**
 * Experience Store - Cross-Conversation Memory
 *
 * Learns from past interactions across conversations:
 * - Tool chains that worked before
 * - User language/framework/tool preferences
 * - Task solutions and error recovery patterns
 *
 * Phase 19, Category 5
 */

import { randomUUID } from 'node:crypto';
import { getClient } from '../storage/index.js';
import { createContextualLogger } from '../utils/logger.js';

const log = createContextualLogger('ExperienceStore');

// Types

export type ExperienceType =
  | 'tool_chain'
  | 'user_preference'
  | 'task_solution'
  | 'error_recovery';

export interface Experience {
  id: string;
  /** What kind of experience */
  type: ExperienceType;
  /** What task/intent this solved */
  intent: string;
  /** The solution (tool chain, preference value, etc.) */
  solution: unknown;
  /** Success score 0-1 */
  successScore: number;
  /** Context tags for retrieval */
  tags: string[];
  /** Conversation ID where this was learned */
  sourceConversationId: string;
  /** User ID if preference-related */
  userId?: string;
  /** Timestamps (unix ms) */
  createdAt: number;
  lastUsedAt: number;
  useCount: number;
  /** Decay weight (1.0 = fresh, approaches 0 over time) */
  weight: number;
}

export interface ToolChainExperience {
  tools: Array<{ name: string; params: Record<string, unknown> }>;
  totalDurationMs: number;
  allSucceeded: boolean;
}

export interface UserPreferenceExperience {
  category: string; // 'language', 'framework', 'style', 'tool'
  preference: string;
  confidence: number; // 0-1, increases with repetition
}

export interface ExperienceStats {
  total: number;
  byType: Record<string, number>;
  avgAge: number; // average age in days
}

// Raw row shape returned from SQLite
interface ExperienceRow {
  id: string;
  type: string;
  intent: string;
  solution: string;
  success_score: number;
  tags: string;
  source_conversation_id: string;
  user_id: string | null;
  created_at: number;
  last_used_at: number;
  use_count: number;
  weight: number;
}

// Table Initialization

/**
 * Initialize the experiences table and indexes.
 * Call once on startup (idempotent - uses IF NOT EXISTS).
 */
export async function initExperienceStore(): Promise<void> {
  const client = getClient();

  await client.execute(`
    CREATE TABLE IF NOT EXISTS experiences (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      intent TEXT NOT NULL,
      solution TEXT NOT NULL,
      success_score REAL NOT NULL DEFAULT 1.0,
      tags TEXT NOT NULL DEFAULT '[]',
      source_conversation_id TEXT NOT NULL DEFAULT '',
      user_id TEXT,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      use_count INTEGER NOT NULL DEFAULT 1,
      weight REAL NOT NULL DEFAULT 1.0
    )
  `);

  await client.execute(
    `CREATE INDEX IF NOT EXISTS idx_experiences_type ON experiences(type)`,
  );
  await client.execute(
    `CREATE INDEX IF NOT EXISTS idx_experiences_intent ON experiences(intent)`,
  );
  await client.execute(
    `CREATE INDEX IF NOT EXISTS idx_experiences_user ON experiences(user_id)`,
  );
  await client.execute(
    `CREATE INDEX IF NOT EXISTS idx_experiences_weight ON experiences(weight)`,
  );
}

// Helpers

function rowToExperience(row: ExperienceRow): Experience {
  return {
    id: row.id,
    type: row.type as ExperienceType,
    intent: row.intent,
    solution: JSON.parse(row.solution) as unknown,
    successScore: row.success_score,
    tags: JSON.parse(row.tags) as string[],
    sourceConversationId: row.source_conversation_id,
    userId: row.user_id ?? undefined,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    useCount: row.use_count,
    weight: row.weight,
  };
}

// Core CRUD

/**
 * Record a new experience learned from a conversation.
 * Returns the generated ID.
 */
export async function recordExperience(
  exp: Omit<Experience, 'id' | 'createdAt' | 'lastUsedAt' | 'useCount' | 'weight'>,
): Promise<string> {
  const client = getClient();
  const id = randomUUID();
  const now = Date.now();

  try {
    await client.execute({
      sql: `
        INSERT INTO experiences
          (id, type, intent, solution, success_score, tags,
           source_conversation_id, user_id, created_at, last_used_at,
           use_count, weight)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1.0)
      `,
      args: [
        id,
        exp.type,
        exp.intent,
        JSON.stringify(exp.solution),
        exp.successScore,
        JSON.stringify(exp.tags),
        exp.sourceConversationId,
        exp.userId ?? null,
        now,
        now,
      ],
    });

    return id;
  } catch (error) {
    log.error('Failed to record experience', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

/**
 * Get a single experience by ID.
 */
export async function getExperience(id: string): Promise<Experience | null> {
  const client = getClient();

  try {
    const result = await client.execute({
      sql: `SELECT * FROM experiences WHERE id = ?`,
      args: [id],
    });

    if (result.rows.length === 0) return null;
    return rowToExperience(result.rows[0] as unknown as ExperienceRow);
  } catch (error) {
    log.error('Failed to get experience', error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

/**
 * Mark an experience as used - increments useCount and updates lastUsedAt.
 */
export async function markUsed(id: string): Promise<void> {
  const client = getClient();

  try {
    await client.execute({
      sql: `
        UPDATE experiences
        SET use_count = use_count + 1, last_used_at = ?
        WHERE id = ?
      `,
      args: [Date.now(), id],
    });
  } catch (error) {
    log.error('Failed to mark experience used', error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Delete an experience by ID. Returns true if deleted.
 */
export async function deleteExperience(id: string): Promise<boolean> {
  const client = getClient();

  try {
    await client.execute({
      sql: `DELETE FROM experiences WHERE id = ?`,
      args: [id],
    });
    return true;
  } catch (error) {
    log.error('Failed to delete experience', error instanceof Error ? error : new Error(String(error)));
    return false;
  }
}

// Listing / Querying

export interface ListExperiencesOptions {
  type?: ExperienceType;
  userId?: string;
  limit?: number;
  offset?: number;
  minWeight?: number;
}

/**
 * List experiences with optional filters.
 */
export async function listExperiences(
  options: ListExperiencesOptions = {},
): Promise<{ experiences: Experience[]; total: number }> {
  const client = getClient();
  const { type, userId, limit = 50, offset = 0, minWeight } = options;

  const conditions: string[] = [];
  const args: (string | number)[] = [];

  if (type) {
    conditions.push('type = ?');
    args.push(type);
  }
  if (userId) {
    conditions.push('user_id = ?');
    args.push(userId);
  }
  if (minWeight !== undefined) {
    conditions.push('weight >= ?');
    args.push(minWeight);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const countResult = await client.execute({
      sql: `SELECT COUNT(*) as count FROM experiences ${where}`,
      args,
    });

    const rows = await client.execute({
      sql: `
        SELECT * FROM experiences ${where}
        ORDER BY last_used_at DESC
        LIMIT ? OFFSET ?
      `,
      args: [...args, limit, offset],
    });

    const total = (countResult.rows[0] as unknown as { count: number }).count;

    return {
      experiences: rows.rows.map((r: unknown) => rowToExperience(r as ExperienceRow)),
      total: Number(total),
    };
  } catch (error) {
    log.error('Failed to list experiences', error instanceof Error ? error : new Error(String(error)));
    return { experiences: [], total: 0 };
  }
}

// 5.3 Pattern Matching - Similarity Search

/**
 * Find similar experiences by keyword overlap in intent + tag matching.
 * Before planning a task, check if a similar task was solved before.
 */
export async function findSimilarExperiences(
  intent: string,
  tags?: string[],
  limit = 10,
): Promise<Experience[]> {
  const client = getClient();

  try {
    // Tokenise intent into words for LIKE matching (exclude short stop words)
    const words = intent
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 3)
      .slice(0, 8); // cap to avoid excessive query expansion

    if (words.length === 0) {
      // Fall back to most-used recent experiences
      const result = await client.execute({
        sql: `SELECT * FROM experiences WHERE weight > 0.1 ORDER BY use_count DESC, last_used_at DESC LIMIT ?`,
        args: [limit],
      });
      return result.rows.map((r: unknown) => rowToExperience(r as ExperienceRow));
    }

    // Build LIKE conditions for intent keyword matching
    const intentConditions = words.map(() => `LOWER(intent) LIKE ?`).join(' OR ');
    const intentArgs = words.map((w) => `%${w}%`);

    const result = await client.execute({
      sql: `
        SELECT *, (
          ${words.map(() => `CASE WHEN LOWER(intent) LIKE ? THEN 1 ELSE 0 END`).join(' + ')}
        ) AS keyword_score
        FROM experiences
        WHERE weight > 0.05 AND (${intentConditions})
        ORDER BY keyword_score DESC, weight DESC, use_count DESC
        LIMIT ?
      `,
      args: [...intentArgs, ...intentArgs, limit],
    });

    const results = result.rows.map((r: unknown) =>
      rowToExperience(r as ExperienceRow),
    );

    // If tags provided, re-rank by tag overlap
    if (tags && tags.length > 0) {
      const tagSet = new Set(tags.map((t) => t.toLowerCase()));
      results.sort((a: Experience, b: Experience) => {
        const aOverlap = a.tags.filter((t: string) => tagSet.has(t.toLowerCase())).length;
        const bOverlap = b.tags.filter((t: string) => tagSet.has(t.toLowerCase())).length;
        if (bOverlap !== aOverlap) return bOverlap - aOverlap;
        return b.weight - a.weight;
      });
    }

    return results;
  } catch (error) {
    log.error('Similarity search failed', error instanceof Error ? error : new Error(String(error)));
    return [];
  }
}

// 5.2 User Preference Learning

/**
 * Track a user preference (language, framework, tool, style).
 * If an existing preference for this user+category+value exists,
 * increments confidence. Otherwise creates a new experience.
 */
export async function trackPreference(
  userId: string,
  category: string,
  value: string,
): Promise<void> {
  const client = getClient();

  try {
    // Check for existing preference experience for this user/category/value
    const existing = await client.execute({
      sql: `
        SELECT id, solution, use_count FROM experiences
        WHERE type = 'user_preference'
          AND user_id = ?
          AND LOWER(intent) = LOWER(?)
        LIMIT 1
      `,
      args: [userId, `${category}:${value}`],
    });

    if (existing.rows.length > 0) {
      const row = existing.rows[0] as unknown as {
        id: string;
        solution: string;
        use_count: number;
      };
      const currentSolution = JSON.parse(row.solution) as UserPreferenceExperience;

      // Increment confidence (capped at 1.0), diminishing returns
      const newConfidence = Math.min(
        1.0,
        currentSolution.confidence + (1.0 - currentSolution.confidence) * 0.2,
      );

      await client.execute({
        sql: `
          UPDATE experiences
          SET solution = ?, use_count = use_count + 1, last_used_at = ?, weight = MIN(1.0, weight + 0.05)
          WHERE id = ?
        `,
        args: [
          JSON.stringify({ ...currentSolution, confidence: newConfidence }),
          Date.now(),
          row.id,
        ],
      });
    } else {
      const solution: UserPreferenceExperience = {
        category,
        preference: value,
        confidence: 0.4, // initial confidence
      };

      await recordExperience({
        type: 'user_preference',
        intent: `${category}:${value}`,
        solution,
        successScore: 1.0,
        tags: [category, 'preference'],
        sourceConversationId: 'system',
        userId,
      });
    }
  } catch (error) {
    log.error('Failed to track preference', error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Get all tracked preferences for a user, grouped by category.
 */
export async function getUserPreferences(
  userId: string,
): Promise<Record<string, UserPreferenceExperience[]>> {
  const client = getClient();

  try {
    const result = await client.execute({
      sql: `
        SELECT solution FROM experiences
        WHERE type = 'user_preference' AND user_id = ?
        ORDER BY weight DESC, use_count DESC
      `,
      args: [userId],
    });

    const grouped: Record<string, UserPreferenceExperience[]> = {};

    for (const row of result.rows) {
      const pref = JSON.parse(
        (row as unknown as { solution: string }).solution,
      ) as UserPreferenceExperience;

      if (!grouped[pref.category]) {
        grouped[pref.category] = [];
      }
      grouped[pref.category].push(pref);
    }

    return grouped;
  } catch (error) {
    log.error('Failed to get user preferences', error instanceof Error ? error : new Error(String(error)));
    return {};
  }
}

// 5.4 Memory Decay

const DEFAULT_HALF_LIFE_DAYS = 30;

/**
 * Apply exponential decay to all experience weights.
 * weight = weight * exp(-ln(2) / halfLife * daysSinceLastUsed)
 *
 * Recent experiences approach 1.0, old ones approach 0.
 * Run daily via cron.
 */
export async function applyDecay(halfLifeDays = DEFAULT_HALF_LIFE_DAYS): Promise<number> {
  const client = getClient();
  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;
  const decayConstant = Math.LN2 / halfLifeDays;

  try {
    // Fetch all to recalculate (SQLite lacks EXP() in older versions; safe to do in JS)
    const result = await client.execute({
      sql: `SELECT id, last_used_at, weight FROM experiences`,
      args: [],
    });

    let updated = 0;

    for (const row of result.rows) {
      const r = row as unknown as { id: string; last_used_at: number; weight: number };
      const daysSince = (now - r.last_used_at) / msPerDay;
      const newWeight = r.weight * Math.exp(-decayConstant * daysSince);

      await client.execute({
        sql: `UPDATE experiences SET weight = ? WHERE id = ?`,
        args: [Math.max(0, newWeight), r.id],
      });
      updated++;
    }

    log.info('Decay applied', { count: updated, halfLifeDays });
    return updated;
  } catch (error) {
    log.error('Decay calculation failed', error instanceof Error ? error : new Error(String(error)));
    return 0;
  }
}

/**
 * Remove experiences whose weight has dropped below the threshold.
 * Returns count of pruned records.
 */
export async function pruneExpired(minWeight = 0.05): Promise<number> {
  const client = getClient();

  try {
    const countResult = await client.execute({
      sql: `SELECT COUNT(*) as count FROM experiences WHERE weight < ?`,
      args: [minWeight],
    });

    const count = Number(
      (countResult.rows[0] as unknown as { count: number }).count,
    );

    if (count > 0) {
      await client.execute({
        sql: `DELETE FROM experiences WHERE weight < ?`,
        args: [minWeight],
      });
      log.info('Pruned expired experiences', { count, minWeight });
    }

    return count;
  } catch (error) {
    log.error('Prune failed', error instanceof Error ? error : new Error(String(error)));
    return 0;
  }
}

// Statistics

/**
 * Get aggregate statistics about the experience store.
 */
export async function getStats(): Promise<ExperienceStats> {
  const client = getClient();

  try {
    const totalResult = await client.execute({
      sql: `SELECT COUNT(*) as count FROM experiences`,
      args: [],
    });

    const typeResult = await client.execute({
      sql: `SELECT type, COUNT(*) as count FROM experiences GROUP BY type`,
      args: [],
    });

    const avgAgeResult = await client.execute({
      sql: `SELECT AVG((? - created_at) / 86400000.0) as avg_age FROM experiences`,
      args: [Date.now()],
    });

    const total = Number(
      (totalResult.rows[0] as unknown as { count: number }).count,
    );

    const byType: Record<string, number> = {};
    for (const row of typeResult.rows) {
      const r = row as unknown as { type: string; count: number };
      byType[r.type] = Number(r.count);
    }

    const avgAge = Number(
      (avgAgeResult.rows[0] as unknown as { avg_age: number | null }).avg_age ?? 0,
    );

    return { total, byType, avgAge: Math.round(avgAge * 10) / 10 };
  } catch (error) {
    log.error('Failed to get stats', error instanceof Error ? error : new Error(String(error)));
    return { total: 0, byType: {}, avgAge: 0 };
  }
}
