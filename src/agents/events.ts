/**
 * Agent Streaming Events
 *
 * Discriminated union of all events that the AgentExecutor can yield
 * from its async generator stream() method.
 */

export type AgentEvent =
  | { type: 'session:start'; sessionId: string; config: Record<string, unknown> }
  | { type: 'step:start'; stepIndex: number }
  | { type: 'tool:call'; toolName: string; args: unknown; toolCallId: string }
  | { type: 'tool:result'; toolCallId: string; result: unknown; duration: number; success: boolean }
  | { type: 'tool:error'; toolCallId: string; error: string }
  | { type: 'content'; text: string; delta: string }
  | { type: 'thinking'; text: string }
  | { type: 'cost:update'; inputTokens: number; outputTokens: number; estimatedCost: number }
  | { type: 'circuit:open'; toolName: string; cooldownMs: number }
  | { type: 'step:complete'; stepIndex: number; toolCalls: number; hasContent: boolean }
  | { type: 'session:complete'; result: Record<string, unknown>; totalSteps: number; totalTokens: number }
  | { type: 'session:error'; error: string; stack?: string }
  | { type: 'session:abort'; reason: string }
  | { type: 'checkpoint:saved'; sessionId: string; step: number }
  | { type: 'checkpoint:resumed'; sessionId: string; step: number }
  | { type: 'budget:warning'; usedPercent: number; tokensUsed: number; tokensMax: number }
