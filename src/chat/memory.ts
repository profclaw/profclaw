/**
 * Conversation Memory Management
 *
 * Handles context window optimization and automatic message compaction
 * to keep conversations within model limits while preserving context.
 *
 * Features:
 * - Automatic compaction when context window is near limit
 * - AI-powered summarization of older messages
 * - Tool result truncation for large outputs
 * - Priority-based message retention
 * - Sliding window with importance scoring
 */

import { MODEL_CATALOG } from '../providers/core/models.js';
import type { ConversationMessage, ToolCallRecord } from './conversations.js';
import { createContextualLogger } from '../utils/logger.js';

const log = createContextualLogger('Memory');

// === Configuration ===

export interface MemoryConfig {
  // Max percentage of context window to use before compacting (0.7 = 70%)
  compactThreshold: number;
  // Number of recent messages to always keep intact
  preserveRecentCount: number;
  // Minimum messages before compaction kicks in
  minMessagesForCompaction: number;
  // Target token count after compaction (percentage of context)
  targetAfterCompaction: number;
  // Max tokens for a single tool result before truncation
  maxToolResultTokens: number;
  // Whether to summarize large tool results
  summarizeLargeToolResults: boolean;
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  compactThreshold: 0.7,
  preserveRecentCount: 6, // Keep last 3 exchanges (user + assistant)
  minMessagesForCompaction: 10,
  targetAfterCompaction: 0.5,
  maxToolResultTokens: 2000, // ~8KB of text
  summarizeLargeToolResults: true,
};

// === Token Estimation ===

/**
 * Rough token estimation (4 chars per token average)
 * This is a fast approximation - actual tokenization varies by model
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens for a message array
 */
export function estimateMessagesTokens(messages: ConversationMessage[]): number {
  return messages.reduce((total, msg) => {
    // Content + role overhead (~10 tokens per message for structure)
    return total + estimateTokens(msg.content) + 10;
  }, 0);
}

/**
 * Get context window for the current model
 */
export function getContextWindow(model?: string): number {
  // Default to 128k if model not specified
  if (!model) return 128000;

  const modelInfo = MODEL_CATALOG.find(
    (m) => m.id === model || m.id.includes(model) || model.includes(m.id)
  );

  return modelInfo?.contextWindow || 128000;
}

// === Tool Result Processing ===

/**
 * Truncate large tool results to save context space
 */
export function truncateToolResult(
  result: unknown,
  maxTokens: number = DEFAULT_MEMORY_CONFIG.maxToolResultTokens
): { result: unknown; wasTruncated: boolean; originalTokens: number } {
  const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  const originalTokens = estimateTokens(resultStr);

  if (originalTokens <= maxTokens) {
    return { result, wasTruncated: false, originalTokens };
  }

  // Truncate to maxTokens worth of characters (rough estimate)
  const maxChars = maxTokens * 4;
  const truncated = resultStr.slice(0, maxChars);

  // Try to parse back if it was JSON
  if (typeof result !== 'string') {
    try {
      return {
        result: {
          _truncated: true,
          _originalLength: resultStr.length,
          data: truncated + '\n\n[... truncated]',
        },
        wasTruncated: true,
        originalTokens,
      };
    } catch {
      // Fall through to string return
    }
  }

  return {
    result: truncated + '\n\n[... truncated, ' + (originalTokens - maxTokens) + ' tokens removed]',
    wasTruncated: true,
    originalTokens,
  };
}

/**
 * Process tool calls in a message, truncating large results
 */
export function processToolCallsForCompaction(
  toolCalls: ToolCallRecord[] | undefined,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG
): { toolCalls: ToolCallRecord[] | undefined; tokensSaved: number } {
  if (!toolCalls || toolCalls.length === 0) {
    return { toolCalls, tokensSaved: 0 };
  }

  let tokensSaved = 0;
  const processedCalls = toolCalls.map((tc) => {
    if (tc.result === undefined) return tc;

    const { result, wasTruncated, originalTokens } = truncateToolResult(
      tc.result,
      config.maxToolResultTokens
    );

    if (wasTruncated) {
      const newTokens = estimateTokens(
        typeof result === 'string' ? result : JSON.stringify(result)
      );
      tokensSaved += originalTokens - newTokens;
    }

    return { ...tc, result };
  });

  return { toolCalls: processedCalls, tokensSaved };
}

// === Priority-Based Retention ===

/**
 * Message importance scoring for retention decisions
 */
export function scoreMessageImportance(message: ConversationMessage): number {
  let score = 0;

  // System messages are always high priority
  if (message.role === 'system') {
    score += 100;
  }

  // User messages that ask questions or give instructions
  if (message.role === 'user') {
    score += 20;
    if (message.content.includes('?')) score += 10;
    if (/^(create|make|build|implement|fix|update|change)/i.test(message.content)) {
      score += 15;
    }
  }

  // Assistant messages with tool calls are important
  if (message.role === 'assistant') {
    score += 10;
    if (message.toolCalls && message.toolCalls.length > 0) {
      score += 5 * message.toolCalls.length;
    }
  }

  // Messages that mention errors or important keywords
  if (/error|fail|success|complete|done|critical|important/i.test(message.content)) {
    score += 10;
  }

  // Longer messages likely contain more context
  const tokens = estimateTokens(message.content);
  if (tokens > 100) score += 5;
  if (tokens > 500) score += 10;

  return score;
}

/**
 * Select messages to keep based on importance scoring
 */
export function selectMessagesForRetention(
  messages: ConversationMessage[],
  targetTokens: number,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG
): ConversationMessage[] {
  // Always keep the most recent messages
  const recentMessages = messages.slice(-config.preserveRecentCount);
  const olderMessages = messages.slice(0, -config.preserveRecentCount);

  // Score and sort older messages by importance
  const scoredMessages = olderMessages.map((m) => ({
    message: m,
    score: scoreMessageImportance(m),
    tokens: estimateTokens(m.content),
  }));

  scoredMessages.sort((a, b) => b.score - a.score);

  // Select older messages until we hit target
  const recentTokens = estimateMessagesTokens(recentMessages);
  let remainingBudget = targetTokens - recentTokens;

  const selectedOlder: ConversationMessage[] = [];
  for (const { message, tokens } of scoredMessages) {
    if (remainingBudget <= 0) break;
    if (tokens <= remainingBudget) {
      selectedOlder.push(message);
      remainingBudget -= tokens;
    }
  }

  // Sort selected older messages by timestamp to maintain order
  selectedOlder.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return [...selectedOlder, ...recentMessages];
}

// === Compaction Logic ===

export interface CompactionResult {
  messages: ConversationMessage[];
  summary?: string;
  originalCount: number;
  compactedCount: number;
  tokensReduced: number;
  wasCompacted: boolean;
  toolResultsTruncated?: number;
}

/**
 * Check if messages need compaction based on token count
 */
export function needsCompaction(
  messages: ConversationMessage[],
  model?: string,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG
): boolean {
  if (messages.length < config.minMessagesForCompaction) {
    return false;
  }

  const contextWindow = getContextWindow(model);
  const currentTokens = estimateMessagesTokens(messages);
  const threshold = contextWindow * config.compactThreshold;

  return currentTokens > threshold;
}

/**
 * Create a summary of messages using AI
 */
export async function summarizeMessages(
  messages: ConversationMessage[],
  model?: string
): Promise<string> {
  const content = messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n');

  const summaryPrompt = `Summarize this conversation concisely, preserving key information, decisions made, and context needed for continuing the discussion. Be brief but complete.

CONVERSATION:
${content}

SUMMARY:`;

  try {
    const { aiProvider } = await import('../providers/ai-sdk.js');
    const response = await aiProvider.chat({
      messages: [
        {
          id: 'summary-request',
          role: 'user',
          content: summaryPrompt,
          timestamp: new Date().toISOString(),
        },
      ],
      model: model || 'local', // Prefer local/free model for summaries
      maxTokens: 500,
      temperature: 0.3,
    });

    return response.content;
  } catch (error) {
    // Fallback to simple truncation if AI fails
    log.warn('AI summarization failed, using truncation', { error: error instanceof Error ? error.message : String(error) });
    return `Previous conversation summary (${messages.length} messages): ${messages
      .slice(-3)
      .map((m) => m.content.slice(0, 100))
      .join(' ... ')}`;
  }
}

/**
 * Compact messages by summarizing older ones and truncating large tool results
 */
export async function compactMessages(
  messages: ConversationMessage[],
  model?: string,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG
): Promise<CompactionResult> {
  const originalCount = messages.length;
  const originalTokens = estimateMessagesTokens(messages);

  // Don't compact if not needed
  if (!needsCompaction(messages, model, config)) {
    return {
      messages,
      originalCount,
      compactedCount: messages.length,
      tokensReduced: 0,
      wasCompacted: false,
    };
  }

  // First pass: Truncate large tool results in all messages
  let toolResultsTruncated = 0;
  let tokensSavedFromToolResults = 0;

  const messagesWithTruncatedTools = messages.map((m) => {
    if (!m.toolCalls || m.toolCalls.length === 0) return m;

    const { toolCalls, tokensSaved } = processToolCallsForCompaction(m.toolCalls, config);
    if (tokensSaved > 0) {
      toolResultsTruncated++;
      tokensSavedFromToolResults += tokensSaved;
    }

    return { ...m, toolCalls };
  });

  // Check if tool truncation was enough
  const tokensAfterToolTruncation = estimateMessagesTokens(messagesWithTruncatedTools);
  const contextWindow = getContextWindow(model);
  const targetTokens = contextWindow * config.targetAfterCompaction;

  if (tokensAfterToolTruncation <= contextWindow * config.compactThreshold) {
    // Tool truncation was sufficient
    return {
      messages: messagesWithTruncatedTools,
      originalCount,
      compactedCount: messagesWithTruncatedTools.length,
      tokensReduced: tokensSavedFromToolResults,
      wasCompacted: tokensSavedFromToolResults > 0,
      toolResultsTruncated: toolResultsTruncated > 0 ? toolResultsTruncated : undefined,
    };
  }

  // Second pass: Use priority-based selection or summarization
  const preserveCount = Math.min(config.preserveRecentCount, messagesWithTruncatedTools.length - 1);
  const messagesToSummarize = messagesWithTruncatedTools.slice(0, -preserveCount);
  const messagesToKeep = messagesWithTruncatedTools.slice(-preserveCount);

  // Try priority-based selection first for moderate compaction needs
  const tokensNeeded = tokensAfterToolTruncation - targetTokens;
  const olderMessagesTokens = estimateMessagesTokens(messagesToSummarize);

  if (tokensNeeded < olderMessagesTokens * 0.5) {
    // We only need to remove ~50% of older messages, use priority selection
    const selected = selectMessagesForRetention(
      messagesWithTruncatedTools,
      Math.floor(targetTokens),
      config
    );

    const selectedTokens = estimateMessagesTokens(selected);

    return {
      messages: selected,
      originalCount,
      compactedCount: selected.length,
      tokensReduced: originalTokens - selectedTokens,
      wasCompacted: true,
      toolResultsTruncated: toolResultsTruncated > 0 ? toolResultsTruncated : undefined,
    };
  }

  // Full summarization needed for heavy compaction
  const summary = await summarizeMessages(messagesToSummarize, model);

  // Create summary message
  const summaryMessage: ConversationMessage = {
    id: `summary-${Date.now()}`,
    conversationId: messages[0]?.conversationId || '',
    role: 'system',
    content: `[CONVERSATION SUMMARY - ${messagesToSummarize.length} messages compacted]\n\n${summary}`,
    createdAt: new Date().toISOString(),
  };

  // New message array: summary + recent messages
  const compactedMessages = [summaryMessage, ...messagesToKeep];
  const compactedTokens = estimateMessagesTokens(compactedMessages);

  return {
    messages: compactedMessages,
    summary,
    originalCount,
    compactedCount: compactedMessages.length,
    tokensReduced: originalTokens - compactedTokens,
    wasCompacted: true,
    toolResultsTruncated: toolResultsTruncated > 0 ? toolResultsTruncated : undefined,
  };
}

// === Memory Stats ===

export interface MemoryStats {
  messageCount: number;
  estimatedTokens: number;
  contextWindow: number;
  usagePercentage: number;
  needsCompaction: boolean;
  summaryCount: number;
}

/**
 * Get memory stats for a conversation
 */
export function getMemoryStats(
  messages: ConversationMessage[],
  model?: string,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG
): MemoryStats {
  const contextWindow = getContextWindow(model);
  const estimatedTokens = estimateMessagesTokens(messages);
  const summaryCount = messages.filter((m) =>
    m.content.startsWith('[CONVERSATION SUMMARY')
  ).length;

  return {
    messageCount: messages.length,
    estimatedTokens,
    contextWindow,
    usagePercentage: (estimatedTokens / contextWindow) * 100,
    needsCompaction: needsCompaction(messages, model, config),
    summaryCount,
  };
}

export default {
  DEFAULT_MEMORY_CONFIG,
  estimateTokens,
  estimateMessagesTokens,
  getContextWindow,
  needsCompaction,
  summarizeMessages,
  compactMessages,
  getMemoryStats,
  // Advanced pruning
  truncateToolResult,
  processToolCallsForCompaction,
  scoreMessageImportance,
  selectMessagesForRetention,
};
