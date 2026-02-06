import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateCacheKey,
  getCachedResponse,
  setCachedResponse,
  invalidateCache,
  cleanupExpiredCache,
  getCacheStats,
  resetCacheStats,
} from "../ai-cache.js";

vi.mock("../logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe("ai-cache", () => {
  let db: {
    query: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    resetCacheStats();
    db = {
      query: vi.fn(),
      execute: vi.fn(),
    };
  });

  it("generates consistent cache keys with normalization", () => {
    const key1 = generateCacheKey("summarize", "model", "Hello  World", "Test");
    const key2 = generateCacheKey("summarize", "model", "hello world", "test");

    expect(key1).toBe(key2);
  });

  it("returns null on cache miss", async () => {
    db.query.mockResolvedValue([]);

    const result = await getCachedResponse(db, "summarize", "model", "input");

    expect(result).toBeNull();
  });

  it("returns cached response on hit", async () => {
    db.query.mockResolvedValue([
      { id: "1", response: '{"a":1}', expires_at: null, confidence: null },
    ]);
    db.execute.mockResolvedValue({ rowsAffected: 1 });

    const result = await getCachedResponse<{ a: number }>(
      db,
      "summarize",
      "model",
      "input",
    );

    expect(result).toEqual({ a: 1 });
    expect(db.execute).toHaveBeenCalled();
  });

  it("deletes expired entries and returns null", async () => {
    const now = Date.now();
    db.query.mockResolvedValue([
      {
        id: "1",
        response: '{"a":1}',
        expires_at: now - 1000,
        confidence: null,
      },
    ]);
    db.execute.mockResolvedValue({ rowsAffected: 1 });

    const result = await getCachedResponse<{ a: number }>(
      db,
      "summarize",
      "model",
      "input",
    );

    expect(result).toBeNull();
    expect(db.execute).toHaveBeenCalled();
  });

  it("stores cache entries", async () => {
    db.execute.mockResolvedValue({ rowsAffected: 1 });

    await setCachedResponse(
      db,
      "summarize",
      "model",
      { a: 1 },
      {
        inputs: ["input"],
        provider: "test",
        confidence: 0.9,
        ttlMs: 1000,
      },
    );

    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it("invalidates cache entries by type", async () => {
    db.execute.mockResolvedValue({ rowsAffected: 2 });

    const deleted = await invalidateCache(db, { cacheType: "summarize" });

    expect(deleted).toBe(2);
  });

  it("returns 0 when invalidation has no conditions", async () => {
    const deleted = await invalidateCache(db, {});

    expect(deleted).toBe(0);
  });

  it("cleans up expired cache entries", async () => {
    db.execute.mockResolvedValue({ rowsAffected: 3 });

    const deleted = await cleanupExpiredCache(db);

    expect(deleted).toBe(3);
  });

  it("returns stats with hit rate", async () => {
    db.query.mockResolvedValue([
      { cache_type: "summarize", entries: 1, hits: 2 },
    ]);

    const stats = await getCacheStats(db);

    expect(stats.totalEntries).toBeGreaterThanOrEqual(0);
    expect(stats.hitRate).toBeGreaterThanOrEqual(0);
  });
});
