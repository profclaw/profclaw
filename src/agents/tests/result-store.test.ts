import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile, stat } from "node:fs/promises";
import { ResultStore } from "../result-store.js";

describe("ResultStore", () => {
  let store: ResultStore;
  const sessionId = "test-session-abc";

  beforeEach(() => {
    store = new ResultStore(sessionId);
  });

  afterEach(async () => {
    await store.cleanup();
  });

  it("small result stays inline without writing a temp file", async () => {
    const result = { message: "hello", count: 42 };
    const stored = await store.store("call-1", result);

    expect(stored.truncated).toBe(false);
    expect(stored.fullPath).toBeUndefined();
    expect(stored.originalSize).toBeGreaterThan(0);
    // inline should be the raw JSON
    expect(JSON.parse(stored.inline)).toEqual(result);
  });

  it("large result (> 50KB) spills to a temp file and returns a summary inline", async () => {
    // Build a string that serializes to > 50_000 bytes
    const bigPayload = { data: "x".repeat(60_000) };
    const stored = await store.store("call-2", bigPayload);

    expect(stored.fullPath).toBeDefined();
    expect(stored.truncated).toBe(false);
    expect(stored.originalSize).toBeGreaterThan(50_000);

    // inline should be the summary, not the raw JSON
    expect(stored.inline).toMatch(/^\[Result stored:/);
    expect(stored.inline).toContain("Preview:");

    // temp file should actually exist and contain valid JSON
    const fileContent = await readFile(stored.fullPath!, "utf8");
    expect(() => JSON.parse(fileContent)).not.toThrow();
  });

  it("very large result (> 5MB) gets truncated before saving", async () => {
    // Build a string that serializes to > 5_000_000 bytes
    const hugePayload = { data: "y".repeat(5_100_000) };
    const stored = await store.store("call-3", hugePayload);

    expect(stored.truncated).toBe(true);
    expect(stored.fullPath).toBeDefined();
    expect(stored.originalSize).toBeGreaterThan(5_000_000);
    expect(stored.inline).toMatch(/truncated from/);

    // File on disk should be <= MAX_TOTAL_SIZE bytes
    const fileStats = await stat(stored.fullPath!);
    expect(fileStats.size).toBeLessThanOrEqual(5_000_000);
  });

  it("retrieve returns the stored result by toolCallId", async () => {
    const result = { ok: true };
    await store.store("call-4", result);

    const retrieved = store.retrieve("call-4");
    expect(retrieved).toBeDefined();
    expect(JSON.parse(retrieved!.inline)).toEqual(result);
  });

  it("cleanup deletes temp files and clears internal state", async () => {
    // Store a large result so a temp file is created
    const bigPayload = { data: "z".repeat(60_000) };
    const stored = await store.store("call-5", bigPayload);
    const filePath = stored.fullPath!;
    expect(filePath).toBeDefined();

    // Verify file exists before cleanup
    await expect(stat(filePath)).resolves.toBeTruthy();

    // Cleanup should remove it
    await store.cleanup();

    // File should no longer exist
    await expect(stat(filePath)).rejects.toThrow();

    // Retrieve should return undefined after cleanup
    expect(store.retrieve("call-5")).toBeUndefined();
  });
});
