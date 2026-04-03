import { describe, it, expect } from "vitest";
import { ContextCompactor } from "../context-compactor.js";
import type { ModelMessage } from "ai";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a simple user message. */
function userMsg(text: string): ModelMessage {
  return { role: "user", content: text };
}

/** Build a simple assistant message. */
function assistantMsg(text: string): ModelMessage {
  return { role: "assistant", content: text };
}

/** Build a system message. */
function systemMsg(text: string): ModelMessage {
  return { role: "system", content: text };
}

/**
 * Build a message large enough to push the total over a threshold.
 * Repeating a 5-char word N times → roughly N*5/4 tokens.
 */
function bigMsg(role: "user" | "assistant", approxTokens: number): ModelMessage {
  const chars = approxTokens * 4;
  const content = "word ".repeat(Math.ceil(chars / 5)).slice(0, chars);
  return { role, content };
}

/** Build a conversation with N turns above a token threshold. */
function buildLargeConversation(
  turns: number,
  tokensPerMessage: number,
): ModelMessage[] {
  const msgs: ModelMessage[] = [];
  for (let i = 0; i < turns; i++) {
    msgs.push(bigMsg("user", tokensPerMessage));
    msgs.push(bigMsg("assistant", tokensPerMessage));
  }
  return msgs;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ContextCompactor", () => {
  // ── 1. Below threshold — messages unchanged ────────────────────────────────

  it("returns messages unchanged when below compaction threshold", async () => {
    const compactor = new ContextCompactor({
      maxContextTokens: 100_000,
      compactionThreshold: 70_000,
      preserveRecentTurns: 5,
      summaryMaxTokens: 2_000,
    });

    // Build a small conversation well under 70 000 tokens
    const messages: ModelMessage[] = [
      userMsg("Hello, can you help me?"),
      assistantMsg("Sure! What do you need?"),
      userMsg("Just a quick question."),
      assistantMsg("Go ahead."),
    ];

    const result = await compactor.compact(messages);

    expect(result.compacted).toBe(false);
    expect(result.messages).toBe(messages); // same reference — untouched
    expect(result.turnsCompacted).toBe(0);
    expect(result.originalTokens).toBe(result.compactedTokens);
  });

  // ── 2. Above threshold — older messages are compacted ─────────────────────

  it("compacts older messages when token count exceeds threshold", async () => {
    // threshold at 1 000 tokens so we don't need giant strings in tests
    const compactor = new ContextCompactor({
      maxContextTokens: 2_000,
      compactionThreshold: 1_000,
      preserveRecentTurns: 2,
      summaryMaxTokens: 500,
    });

    // 12 turns × 2 messages × ~100 tokens = ~2 400 tokens → above threshold
    const messages = buildLargeConversation(6, 100);

    const result = await compactor.compact(messages);

    expect(result.compacted).toBe(true);
    expect(result.turnsCompacted).toBeGreaterThan(0);
    // Compacted total should be smaller than original
    expect(result.compactedTokens).toBeLessThan(result.originalTokens);
    // Result messages should be fewer than original
    expect(result.messages.length).toBeLessThan(messages.length);
  });

  // ── 3. Correct number of recent turns preserved ────────────────────────────

  it("preserves exactly the configured number of recent turns verbatim", async () => {
    const preserveRecentTurns = 3;
    const compactor = new ContextCompactor({
      maxContextTokens: 2_000,
      compactionThreshold: 500,
      preserveRecentTurns,
      summaryMaxTokens: 300,
    });

    // 8 turns × 2 msgs × 50 tokens ≈ 800 tokens → triggers compaction
    const turns = 8;
    const messages = buildLargeConversation(turns, 50);
    // Tag the last N turns so we can identify them
    const lastTurns = messages.slice(-(preserveRecentTurns * 2));

    const result = await compactor.compact(messages);

    expect(result.compacted).toBe(true);

    // The final (preserveRecentTurns * 2) conversational messages must appear
    // verbatim (same content) in the output, in order.
    const outConversational = result.messages.filter((m) => m.role !== "system");
    const preservedSlice = outConversational.slice(-(preserveRecentTurns * 2));

    expect(preservedSlice.length).toBe(lastTurns.length);
    for (let i = 0; i < lastTurns.length; i++) {
      expect(preservedSlice[i].content).toBe(lastTurns[i].content);
    }
  });

  // ── 4. Summary includes file modifications and tool results ────────────────

  it("includes file paths and tool call outcomes in the generated summary", async () => {
    // Use a compactor with a threshold low enough to be triggered by a small
    // conversation but still representative of real usage.
    const compactor = new ContextCompactor({
      maxContextTokens: 2_000,
      compactionThreshold: 50,   // intentionally tiny so any real message triggers it
      preserveRecentTurns: 1,
      summaryMaxTokens: 2_000,
    });

    // Craft messages that contain file-operation text and tool-call parts.
    // Pad the user message so the total is well over 50 tokens (~200 chars).
    const longUserGoal =
      "Please read the file src/index.ts, analyse its contents thoroughly, " +
      "and then write the transformed result to src/output.ts. " +
      "Make sure to handle all edge cases correctly.";

    const toolCallMessage: ModelMessage = {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "tc-1",
          toolName: "read_file",
          args: { path: "src/index.ts" },
        },
      ],
    };

    const toolResultMessage: ModelMessage = {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "tc-1",
          toolName: "read_file",
          result: "export function main() { return 42; }",
        },
      ],
    };

    const writeCallMessage: ModelMessage = {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "tc-2",
          toolName: "write_file",
          args: { path: "src/output.ts" },
        },
      ],
    };

    const writeResultMessage: ModelMessage = {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "tc-2",
          toolName: "write_file",
          result: { success: true },
        },
      ],
    };

    const recentUser = userMsg("What is the final result?");
    const recentAssistant = assistantMsg("Here is the result.");

    const messages: ModelMessage[] = [
      userMsg(longUserGoal),
      toolCallMessage,
      toolResultMessage,
      writeCallMessage,
      writeResultMessage,
      recentUser,
      recentAssistant,
    ];

    const result = await compactor.compact(messages);

    expect(result.compacted).toBe(true);

    // Find the summary message (system role added by compactor)
    const summaryMsg = result.messages.find(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        m.content.includes("Conversation Summary"),
    );

    expect(summaryMsg).toBeDefined();
    const summaryText = summaryMsg?.content as string;

    // Tool names should appear in the summary
    expect(summaryText).toContain("read_file");
    expect(summaryText).toContain("write_file");

    // Tool outcome should appear
    expect(summaryText).toContain("Tool Calls & Outcomes");
  });
});
