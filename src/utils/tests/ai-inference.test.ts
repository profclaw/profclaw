import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isAIAvailable,
  quickInference,
  categorizeTicket,
  suggestTicketImprovements,
  summarizeTicket,
  calculateSimilarity,
} from "../ai-inference.js";

const mockFetch = vi.fn();

describe("ai-inference", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns availability when tags endpoint succeeds", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    const available = await isAIAvailable();

    expect(available).toBe(true);
  });

  it("returns false when tags endpoint fails", async () => {
    mockFetch.mockRejectedValue(new Error("network"));

    const available = await isAIAvailable();

    expect(available).toBe(false);
  });

  it("runs quick inference and parses response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: '{"value":1}' } }),
    });

    const result = await quickInference("system", "user", (text) =>
      JSON.parse(text),
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ value: 1 });
  });

  it("returns parse error when response is invalid", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: "not-json" } }),
    });

    const result = await quickInference("system", "user", () => {
      throw new Error("bad parse");
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to parse AI response");
  });

  it("returns error when API fails", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const result = await quickInference("system", "user", (text) => text);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Ollama API error");
  });

  it("categorizes tickets with defaults", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content:
            '{"type":"bug","priority":"high","labels":["crash"],"confidence":0.9}',
        },
      }),
    });

    const result = await categorizeTicket("Crash", "App fails");

    expect(result.success).toBe(true);
    expect(result.data?.type).toBe("bug");
  });

  it("suggests ticket improvements", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: '{"acceptanceCriteria":["one"],"estimatedEffort":"small"}',
        },
      }),
    });

    const result = await suggestTicketImprovements("Title", "Desc", "task");

    expect(result.success).toBe(true);
    expect(result.data?.estimatedEffort).toBe("small");
  });

  it("summarizes tickets", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: "Summary text" } }),
    });

    const result = await summarizeTicket("Title", "Desc");

    expect(result.success).toBe(true);
    expect(result.data).toBe("Summary text");
  });

  it("calculates similarity", () => {
    const score = calculateSimilarity("Hello world", "hello there world");

    expect(score).toBeGreaterThan(0);
  });
});
