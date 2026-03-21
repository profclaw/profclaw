/**
 * Interactive CLI Types
 *
 * Self-contained type definitions for the interactive REPL.
 * This module is designed to be extractable as a standalone package.
 *
 * @package profclaw-interactive (future standalone)
 */

// Connection

export interface ServerConfig {
  baseUrl: string;
  apiToken?: string;
}

// Session

export interface Session {
  conversationId: string;
  mode: 'chat' | 'agentic';
  model?: string;
  provider?: string;
  title?: string;
  totalTokens: number;
  totalCost: number;
  messageCount: number;
  createdAt: Date;
}

// Messages

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  provider?: string;
  toolCalls?: ToolCallInfo[];
  usage?: TokenUsage;
  durationMs?: number;
  timestamp: Date;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  status: 'pending' | 'running' | 'success' | 'error';
  durationMs?: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
}

// SSE Events

export type SSEEventType =
  | 'user_message'
  | 'session_start'  | 'session:start'
  | 'thinking_start' | 'thinking:start'
  | 'thinking_update'| 'thinking:update'
  | 'thinking_end'   | 'thinking:end'
  | 'content_delta'
  | 'step_start'     | 'step:start'
  | 'step_complete'  | 'step:complete'
  | 'tool_call'      | 'tool:call'
  | 'tool_result'    | 'tool:result'
  | 'summary'
  | 'complete'
  | 'error'
  | 'fallback'
  | 'message_saved'
  | string; // Allow any event type for forward compatibility

export interface SSEEvent {
  type: SSEEventType;
  data: Record<string, unknown>;
  timestamp: number;
}

// Slash Commands

export interface SlashCommand {
  name: string;
  aliases: string[];
  description: string;
  args?: string;
  handler: (args: string[], state: REPLState) => Promise<void> | void;
}

// REPL State

export interface REPLState {
  session: Session | null;
  model?: string;
  provider?: string;
  agenticMode: boolean;
  showThinking: boolean;
  showTools: boolean;
  showUsage: boolean;
  effort: 'low' | 'medium' | 'high';
  isStreaming: boolean;
  streamStartTime?: number;
  /** Total tokens used this REPL session */
  sessionTokens: number;
  sessionCost: number;
  messageCount: number;
  /** Server base URL for API calls */
  serverUrl: string;
  /** Last response model used (for /retry with different model) */
  lastModel?: string;
  /** Last response cached for comparison */
  lastResponseCache?: { content: string; model: string; durationMs: number };
}

// REPL Options

export interface InteractiveOptions {
  server: ServerConfig;
  model?: string;
  provider?: string;
  sessionId?: string;
  agentic?: boolean;
  showThinking?: boolean;
  effort?: 'low' | 'medium' | 'high';
}

// Renderer

export interface Renderer {
  userMessage(content: string): void;
  assistantStart(model?: string): void;
  assistantDelta(chunk: string): void;
  assistantEnd(): void;
  thinkingStart(): void;
  thinkingDelta(chunk: string): void;
  thinkingEnd(): void;
  toolCall(name: string, args: Record<string, unknown>): void;
  toolResult(name: string, result: unknown, success: boolean, durationMs?: number): void;
  usage(usage: TokenUsage, durationMs?: number): void;
  error(message: string): void;
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  divider(): void;
  clear(): void;
  statusLine(text: string): void;
  sessionFooter(state: { sessionTokens: number; sessionCost: number; messageCount: number; model?: string }): void;
}
