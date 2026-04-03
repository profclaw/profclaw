/**
 * Context Compactor
 *
 * Compresses old conversation turns into a structured markdown summary when
 * the estimated token count crosses a configurable threshold. Summarisation
 * is purely local — no LLM calls are made.
 */

import type { ModelMessage } from "ai";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CompactionConfig {
  /** Total token budget for the context window. Default: 100_000 */
  maxContextTokens: number;
  /** Trigger compaction once estimated tokens exceed this value. Default: 70_000 */
  compactionThreshold: number;
  /** Number of most-recent turns (user+assistant pairs) to preserve verbatim. Default: 5 */
  preserveRecentTurns: number;
  /** Maximum tokens for the generated summary message. Default: 2_000 */
  summaryMaxTokens: number;
}

export interface CompactionResult {
  messages: ModelMessage[];
  compacted: boolean;
  originalTokens: number;
  compactedTokens: number;
  turnsCompacted: number;
}

// ─── Internals ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: CompactionConfig = {
  maxContextTokens: 100_000,
  compactionThreshold: 70_000,
  preserveRecentTurns: 5,
  summaryMaxTokens: 2_000,
};

/** Rough character-to-token ratio used throughout (4 chars ≈ 1 token). */
const CHARS_PER_TOKEN = 4;

// ─── Helper utilities ─────────────────────────────────────────────────────────

function messageToText(message: ModelMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part === "string") return part;
        // TextPart
        if (
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          (part as { type: string }).type === "text" &&
          "text" in part
        ) {
          return String((part as { text: unknown }).text);
        }
        // ToolCallPart
        if (
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          (part as { type: string }).type === "tool-call"
        ) {
          const tc = part as {
            toolName: string;
            args?: unknown;
            toolCallId?: string;
          };
          return `[tool_call: ${tc.toolName}(${JSON.stringify(tc.args ?? {})})]`;
        }
        // ToolResultPart
        if (
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          (part as { type: string }).type === "tool-result"
        ) {
          const tr = part as { toolName?: string; result?: unknown };
          return `[tool_result: ${tr.toolName ?? "unknown"} → ${JSON.stringify(tr.result ?? null)}]`;
        }
        return JSON.stringify(part);
      })
      .join(" ");
  }
  return "";
}

/** Extract file paths that were read or written during a set of messages. */
function extractFilePaths(messages: ModelMessage[]): string[] {
  const paths = new Set<string>();
  const filePattern = /(?:read|write|edit|create|modify)\s+([`"']?[\w./\-_]+\.[a-zA-Z]+[`"']?)/gi;

  for (const msg of messages) {
    const text = messageToText(msg);
    let match: RegExpExecArray | null;
    while ((match = filePattern.exec(text)) !== null) {
      paths.add(match[1].replace(/[`"']/g, ""));
    }
  }
  return Array.from(paths);
}

/** Extract tool calls (name + brief args summary) from a set of messages. */
interface ToolCallSummary {
  name: string;
  argsSummary: string;
  outcome: string;
}

function extractToolCalls(messages: ModelMessage[]): ToolCallSummary[] {
  const calls: ToolCallSummary[] = [];

  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;

    for (const part of msg.content) {
      if (
        typeof part !== "object" ||
        part === null ||
        !("type" in part)
      ) {
        continue;
      }

      const typed = part as { type: string };

      if (typed.type === "tool-call") {
        const tc = part as {
          toolName: string;
          args?: Record<string, unknown>;
        };
        const argKeys = Object.keys(tc.args ?? {}).slice(0, 3).join(", ");
        calls.push({
          name: tc.toolName,
          argsSummary: argKeys ? `{${argKeys}}` : "(no args)",
          outcome: "called",
        });
      }

      if (typed.type === "tool-result") {
        const tr = part as {
          toolName?: string;
          result?: unknown;
          isError?: boolean;
        };
        const last = [...calls].reverse().find((c: ToolCallSummary) => c.name === (tr.toolName ?? ""));
        const resultText =
          typeof tr.result === "string"
            ? tr.result.slice(0, 120)
            : JSON.stringify(tr.result ?? null).slice(0, 120);

        if (last) {
          last.outcome = tr.isError === true ? `error: ${resultText}` : `ok: ${resultText}`;
        } else {
          calls.push({
            name: tr.toolName ?? "unknown",
            argsSummary: "",
            outcome: tr.isError === true ? `error: ${resultText}` : `ok: ${resultText}`,
          });
        }
      }
    }
  }

  return calls;
}

/** Extract the apparent user goals from user-role messages. */
function extractUserGoals(messages: ModelMessage[]): string[] {
  const goals: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    const text = messageToText(msg).trim();
    if (text.length > 0) {
      // Keep only the first 200 chars per turn to stay concise
      goals.push(text.slice(0, 200) + (text.length > 200 ? "…" : ""));
    }
  }
  return goals;
}

/** Build a structured markdown summary capped at approximately maxTokens. */
function buildSummary(
  messages: ModelMessage[],
  maxTokens: number,
): string {
  const maxChars = maxTokens * CHARS_PER_TOKEN;

  const userGoals = extractUserGoals(messages);
  const toolCalls = extractToolCalls(messages);
  const filePaths = extractFilePaths(messages);

  const lines: string[] = [
    "# Conversation Summary (compacted context)",
    "",
    "## User Requests / Goals",
  ];

  if (userGoals.length > 0) {
    for (const goal of userGoals) {
      lines.push(`- ${goal}`);
    }
  } else {
    lines.push("- (no explicit user messages in compacted range)");
  }

  lines.push("", "## Tool Calls & Outcomes");
  if (toolCalls.length > 0) {
    for (const tc of toolCalls) {
      lines.push(`- **${tc.name}** ${tc.argsSummary} → ${tc.outcome}`);
    }
  } else {
    lines.push("- (no tool calls in compacted range)");
  }

  lines.push("", "## Files Read / Written / Modified");
  if (filePaths.length > 0) {
    for (const fp of filePaths) {
      lines.push(`- \`${fp}\``);
    }
  } else {
    lines.push("- (no file operations detected)");
  }

  lines.push("", "## Key Decisions");
  // Look for assistant messages that contain decision-like keywords
  const decisions: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const text = messageToText(msg).trim();
    if (
      /decided|chosen|using|selected|approach|strategy|plan/i.test(text) &&
      text.length > 20
    ) {
      decisions.push(text.slice(0, 200) + (text.length > 200 ? "…" : ""));
    }
  }
  if (decisions.length > 0) {
    for (const d of decisions) {
      lines.push(`- ${d}`);
    }
  } else {
    lines.push("- (no explicit decisions recorded)");
  }

  const full = lines.join("\n");
  // Trim to maxChars if necessary
  return full.length > maxChars ? full.slice(0, maxChars) + "\n…(truncated)" : full;
}

// ─── ContextCompactor ─────────────────────────────────────────────────────────

export class ContextCompactor {
  private config: CompactionConfig;

  constructor(config?: Partial<CompactionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Estimate the token count for a list of messages using the 4-chars-per-token
   * heuristic.
   */
  estimateTokens(messages: ModelMessage[]): number {
    let totalChars = 0;
    for (const msg of messages) {
      totalChars += messageToText(msg).length;
      // Add a small overhead per message for role + formatting
      totalChars += 10;
    }
    return Math.ceil(totalChars / CHARS_PER_TOKEN);
  }

  /**
   * Compact the message list if it exceeds the compaction threshold.
   *
   * Strategy:
   *  1. Identify the most-recent N turns to preserve verbatim.
   *  2. Summarise all older messages into a single system-role summary message.
   *  3. Return the summary + preserved recent messages.
   */
  async compact(messages: ModelMessage[]): Promise<CompactionResult> {
    const originalTokens = this.estimateTokens(messages);

    if (originalTokens < this.config.compactionThreshold) {
      return {
        messages,
        compacted: false,
        originalTokens,
        compactedTokens: originalTokens,
        turnsCompacted: 0,
      };
    }

    // Separate system messages (always kept verbatim at the front) from the
    // conversational messages that can be compacted.
    const systemMessages = messages.filter((m) => m.role === "system");
    const conversational = messages.filter((m) => m.role !== "system");

    // A "turn" is a contiguous user+assistant exchange. For simplicity we treat
    // each individual message as one turn unit here; the preserve count is in
    // terms of individual messages (not user+assistant pairs).
    const turnsToPreserve = this.config.preserveRecentTurns * 2; // user + assistant per turn
    const splitAt = Math.max(0, conversational.length - turnsToPreserve);

    const toCompact = conversational.slice(0, splitAt);
    const toPreserve = conversational.slice(splitAt);

    const turnsCompacted = toCompact.length;

    if (turnsCompacted === 0) {
      // Nothing old enough to compact
      return {
        messages,
        compacted: false,
        originalTokens,
        compactedTokens: originalTokens,
        turnsCompacted: 0,
      };
    }

    const summaryText = buildSummary(toCompact, this.config.summaryMaxTokens);

    const summaryMessage: ModelMessage = {
      role: "system",
      content: summaryText,
    };

    const compactedMessages: ModelMessage[] = [
      ...systemMessages,
      summaryMessage,
      ...toPreserve,
    ];

    const compactedTokens = this.estimateTokens(compactedMessages);

    return {
      messages: compactedMessages,
      compacted: true,
      originalTokens,
      compactedTokens,
      turnsCompacted,
    };
  }
}
