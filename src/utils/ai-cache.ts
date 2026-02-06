/**
 * AI Inference Cache Utility
 *
 * Provides caching layer for AI inference results to avoid
 * redundant API calls for identical inputs.
 *
 * Cache key = SHA256(cacheType + model + normalized_input)
 */

import { createHash } from 'crypto';
import { logger } from './logger.js';

// Default cache TTL: 7 days for most operations
const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Cache TTLs by type (in milliseconds)
const CACHE_TTL_BY_TYPE: Record<string, number> = {
  categorize: 30 * 24 * 60 * 60 * 1000,     // 30 days - categorization is stable
  suggest: 7 * 24 * 60 * 60 * 1000,         // 7 days - suggestions can evolve
  summarize: 14 * 24 * 60 * 60 * 1000,      // 14 days - summaries are fairly stable
  analyze_comment: 7 * 24 * 60 * 60 * 1000, // 7 days
  generate_response: 1 * 24 * 60 * 60 * 1000, // 1 day - responses should be fresh
};

export type CacheType = 'categorize' | 'suggest' | 'summarize' | 'analyze_comment' | 'generate_response';

export interface CacheEntry<T> {
  id: string;
  cacheType: CacheType;
  inputHash: string;
  model: string;
  provider?: string;
  response: T;
  confidence?: number;
  hitCount: number;
  lastHitAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CacheStats {
  totalEntries: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
  byType: Record<string, { entries: number; hits: number }>;
}

// In-memory stats tracking
let cacheHits = 0;
let cacheMisses = 0;

/**
 * Generate a consistent hash for cache lookup
 */
export function generateCacheKey(
  cacheType: CacheType,
  model: string,
  ...inputs: (string | undefined)[]
): string {
  // Normalize inputs: lowercase, trim, remove extra whitespace
  const normalizedInputs = inputs
    .filter((i): i is string => !!i)
    .map((i) => i.toLowerCase().trim().replace(/\s+/g, ' '))
    .join('|');

  const keyData = `${cacheType}:${model}:${normalizedInputs}`;
  return createHash('sha256').update(keyData).digest('hex');
}

/**
 * Get cached response if available and not expired
 */
export async function getCachedResponse<T>(
  db: any, // Database instance
  cacheType: CacheType,
  model: string,
  ...inputs: (string | undefined)[]
): Promise<T | null> {
  try {
    const inputHash = generateCacheKey(cacheType, model, ...inputs);
    const now = Date.now();

    const result = await db.query(
      `SELECT id, response, expires_at, confidence
       FROM ai_inference_cache
       WHERE cache_type = ? AND input_hash = ? AND model = ?`,
      [cacheType, inputHash, model]
    ) as Array<{
      id: string;
      response: string;
      expires_at: number | null;
      confidence: number | null;
    }>;

    if (!result || result.length === 0) {
      cacheMisses++;
      return null;
    }

    const entry = result[0];

    // Check expiration
    if (entry.expires_at && entry.expires_at < now) {
      cacheMisses++;
      // Clean up expired entry
      await db.execute(`DELETE FROM ai_inference_cache WHERE id = ?`, [entry.id]);
      logger.debug('[AI Cache] Entry expired', { cacheType, inputHash: inputHash.slice(0, 8) });
      return null;
    }

    // Update hit stats
    await db.execute(
      `UPDATE ai_inference_cache SET hit_count = hit_count + 1, last_hit_at = ? WHERE id = ?`,
      [now, entry.id]
    );

    cacheHits++;
    logger.debug('[AI Cache] Cache hit', { cacheType, inputHash: inputHash.slice(0, 8) });

    // Parse and return response
    const response = typeof entry.response === 'string'
      ? JSON.parse(entry.response)
      : entry.response;
    return response as T;
  } catch (error) {
    logger.warn('[AI Cache] Error reading cache', { error });
    cacheMisses++;
    return null;
  }
}

/**
 * Store response in cache
 */
export async function setCachedResponse<T>(
  db: any,
  cacheType: CacheType,
  model: string,
  response: T,
  options: {
    inputs: (string | undefined)[];
    provider?: string;
    confidence?: number;
    ttlMs?: number;
  }
): Promise<void> {
  try {
    const inputHash = generateCacheKey(cacheType, model, ...options.inputs);
    const id = `cache_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const now = Date.now();
    const ttl = options.ttlMs ?? CACHE_TTL_BY_TYPE[cacheType] ?? DEFAULT_CACHE_TTL_MS;
    const expiresAt = ttl > 0 ? now + ttl : null;

    // Upsert: delete existing then insert
    await db.execute(
      `DELETE FROM ai_inference_cache WHERE cache_type = ? AND input_hash = ? AND model = ?`,
      [cacheType, inputHash, model]
    );

    await db.execute(
      `INSERT INTO ai_inference_cache
       (id, cache_type, input_hash, model, provider, response, confidence, hit_count, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [
        id,
        cacheType,
        inputHash,
        model,
        options.provider ?? null,
        JSON.stringify(response),
        options.confidence ?? null,
        expiresAt,
        now,
        now,
      ]
    );

    logger.debug('[AI Cache] Stored response', { cacheType, inputHash: inputHash.slice(0, 8) });
  } catch (error) {
    logger.warn('[AI Cache] Error storing cache', { error });
  }
}

/**
 * Invalidate cache entries by type or specific hash
 */
export async function invalidateCache(
  db: any,
  options: {
    cacheType?: CacheType;
    inputHash?: string;
    olderThanMs?: number;
  }
): Promise<number> {
  try {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.cacheType) {
      conditions.push('cache_type = ?');
      params.push(options.cacheType);
    }

    if (options.inputHash) {
      conditions.push('input_hash = ?');
      params.push(options.inputHash);
    }

    if (options.olderThanMs) {
      const cutoff = Date.now() - options.olderThanMs;
      conditions.push('created_at < ?');
      params.push(cutoff);
    }

    if (conditions.length === 0) {
      return 0;
    }

    const result = await db.execute(
      `DELETE FROM ai_inference_cache WHERE ${conditions.join(' AND ')}`,
      params
    );

    const deleted = result?.rowsAffected ?? 0;
    logger.info('[AI Cache] Invalidated entries', { deleted, ...options });
    return deleted;
  } catch (error) {
    logger.warn('[AI Cache] Error invalidating cache', { error });
    return 0;
  }
}

/**
 * Clean up expired cache entries
 */
export async function cleanupExpiredCache(db: any): Promise<number> {
  try {
    const now = Date.now();
    const result = await db.execute(
      `DELETE FROM ai_inference_cache WHERE expires_at IS NOT NULL AND expires_at < ?`,
      [now]
    );

    const deleted = result?.rowsAffected ?? 0;
    if (deleted > 0) {
      logger.info('[AI Cache] Cleaned up expired entries', { deleted });
    }
    return deleted;
  } catch (error) {
    logger.warn('[AI Cache] Error cleaning up cache', { error });
    return 0;
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(db: any): Promise<CacheStats> {
  try {
    const totalResult = await db.query(
      `SELECT COUNT(*) as count FROM ai_inference_cache`
    ) as Array<{ count: number }>;
    const totalEntries = totalResult[0]?.count ?? 0;

    const byTypeResult = await db.query(
      `SELECT cache_type, COUNT(*) as entries, SUM(hit_count) as hits
       FROM ai_inference_cache
       GROUP BY cache_type`
    ) as Array<{ cache_type: string; entries: number; hits: number }>;

    const byType: Record<string, { entries: number; hits: number }> = {};
    for (const row of byTypeResult) {
      byType[row.cache_type] = { entries: row.entries, hits: row.hits ?? 0 };
    }

    const totalHits = cacheHits;
    const totalMisses = cacheMisses;
    const hitRate = totalHits + totalMisses > 0
      ? (totalHits / (totalHits + totalMisses)) * 100
      : 0;

    return {
      totalEntries,
      hitCount: totalHits,
      missCount: totalMisses,
      hitRate: Math.round(hitRate * 100) / 100,
      byType,
    };
  } catch (error) {
    logger.warn('[AI Cache] Error getting stats', { error });
    return {
      totalEntries: 0,
      hitCount: cacheHits,
      missCount: cacheMisses,
      hitRate: 0,
      byType: {},
    };
  }
}

/**
 * Reset in-memory stats (for testing)
 */
export function resetCacheStats(): void {
  cacheHits = 0;
  cacheMisses = 0;
}
