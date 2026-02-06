/**
 * Agent Types and Interfaces
 *
 * Core type definitions for the GLINR agentic loop system.
 * Follows patterns from OpenClaw pi-agent-core for session-based execution.
 */

// =============================================================================
// Agent Status
// =============================================================================

export type AgentStatus =
  | 'idle' // Created but not started
  | 'running' // Actively processing
  | 'waiting_approval' // Waiting for user approval on a tool call
  | 'completed' // Successfully completed goal
  | 'failed' // Failed with error
  | 'cancelled'; // Cancelled by user

// =============================================================================
// Tool Call Records
// =============================================================================

export type ToolCallStatus = 'pending' | 'approved' | 'denied' | 'executed' | 'failed';

export interface ToolCallRecord {
  /** Unique identifier for this tool call */
  id: string;
  /** Name of the tool being called */
  name: string;
  /** Arguments passed to the tool */
  args: Record<string, unknown>;
  /** Result returned from the tool (if executed) */
  result?: unknown;
  /** Current status of the tool call */
  status: ToolCallStatus;
  /** Error message if failed */
  error?: string;
  /** When the tool call started */
  startedAt: number;
  /** When the tool call completed */
  completedAt?: number;
  /** Duration in milliseconds */
  durationMs?: number;
}

// =============================================================================
// Agent State
// =============================================================================

export interface AgentState {
  /** Unique session identifier */
  sessionId: string;
  /** Associated conversation ID */
  conversationId: string;
  /** Current agent status */
  status: AgentStatus;
  /** The user's goal/task to accomplish */
  goal: string;
  /** Current step number (starts at 0) */
  currentStep: number;
  /** Maximum token budget */
  maxBudget: number;
  /** Tokens used so far */
  usedBudget: number;
  /** Input tokens used so far */
  inputTokensUsed: number;
  /** Output tokens used so far */
  outputTokensUsed: number;
  /** History of all tool calls */
  toolCallHistory: ToolCallRecord[];
  /** Tool calls waiting for approval */
  pendingToolCalls: ToolCallRecord[];
  /** Accumulated context from tool results */
  context: AgentContext;
  /** When the agent was created */
  createdAt: number;
  /** When the agent was last updated */
  updatedAt: number;
  /** Final result when completed */
  finalResult?: AgentResult;
}

// =============================================================================
// Agent Context
// =============================================================================

export interface AgentContext {
  /** Last hint from a tool response */
  lastHint?: string;
  /** Available projects from list_projects */
  availableProjects?: Array<{
    key: string;
    name: string;
    id: string;
  }>;
  /** Tickets created during this session */
  createdTickets?: Array<{
    id: string;
    key: string;
    title: string;
    type: string;
  }>;
  /** Files modified during this session */
  modifiedFiles?: string[];
  /** Commits created during this session */
  commits?: Array<{
    sha: string;
    message: string;
  }>;
  /** PRs created during this session */
  pullRequests?: Array<{
    number: number;
    url: string;
    title: string;
  }>;
  /** Custom context data */
  [key: string]: unknown;
}

// =============================================================================
// Agent Result
// =============================================================================

export interface AgentArtifact {
  type: 'ticket' | 'commit' | 'file' | 'pr' | 'project' | 'other';
  id: string;
  description?: string;
  url?: string;
}

export interface AgentResult {
  /** Whether the task was completed successfully */
  success: boolean;
  /** Summary of what was accomplished */
  summary: string;
  /** Artifacts created during execution */
  artifacts: AgentArtifact[];
  /** Suggested next steps */
  nextSteps?: string[];
  /** Why the agent stopped */
  stopReason: string;
  /** Total steps taken */
  totalSteps: number;
  /** Total tokens used */
  totalTokens: number;
  /** Input tokens used */
  inputTokens?: number;
  /** Output tokens used */
  outputTokens?: number;
}

// =============================================================================
// Stop Conditions
// =============================================================================

export interface StopCondition {
  /** Name for logging/debugging */
  name: string;
  /** Check if this condition is met */
  check: (state: AgentState, lastResult: unknown) => boolean | Promise<boolean>;
}

// =============================================================================
// Agent Configuration
// =============================================================================

/** Thinking effort level for Anthropic models (Opus 4.6+) */
export type ThinkingEffort = 'low' | 'medium' | 'high' | 'max';

/** Map effort levels to thinking budget tokens */
export const EFFORT_BUDGET_MAP: Record<ThinkingEffort, number> = {
  low: 1024,
  medium: 5000,
  high: 12000,
  max: 32000,
};

export interface AgentConfig {
  /** Maximum steps before forced stop (safety limit) */
  maxSteps?: number;
  /** Maximum token budget */
  maxBudget?: number;
  /** Stop conditions to check after each step */
  stopConditions?: StopCondition[];
  /** Security mode for tool execution */
  securityMode?: 'deny' | 'sandbox' | 'allowlist' | 'ask' | 'full';
  /** Timeout per step in milliseconds */
  stepTimeoutMs?: number;
  /** Enable streaming responses */
  enableStreaming?: boolean;
  /** Thinking effort level for Anthropic models (low saves cost, max for complex reasoning) */
  effort?: ThinkingEffort;
}

// =============================================================================
// Agent Events
// =============================================================================

export interface AgentEvents {
  /** Emitted when agent starts */
  start: [state: AgentState];
  /** Emitted at the start of each step */
  'step:start': [state: AgentState];
  /** Emitted when a step completes */
  'step:complete': [state: AgentState, result: unknown];
  /** Emitted when a tool call is made */
  'tool:call': [state: AgentState, toolCall: ToolCallRecord];
  /** Emitted when a tool call completes */
  'tool:result': [state: AgentState, toolCall: ToolCallRecord];
  /** Emitted when waiting for approval */
  'approval:required': [state: AgentState, toolCalls: ToolCallRecord[]];
  /** Emitted when approval is received */
  'approval:received': [state: AgentState, approved: boolean];
  /** Emitted when agent completes successfully */
  complete: [state: AgentState, reason: string];
  /** Emitted when agent fails */
  error: [error: Error, state: AgentState];
  /** Emitted when agent is cancelled */
  cancelled: [state: AgentState];
  /** Emitted for streaming text chunks */
  'stream:chunk': [chunk: string];
}

// =============================================================================
// Step Context (passed to model at each step)
// =============================================================================

export interface StepContext {
  /** Current step number */
  step: number;
  /** The user's goal */
  goal: string;
  /** Tools used so far */
  toolsUsed: string[];
  /** Result from the last tool call */
  lastToolResult?: unknown;
  /** Accumulated context */
  accumulatedContext: AgentContext;
  /** Hint for next action */
  hint: string;
  /** Remaining budget */
  remainingBudget: number;
}
