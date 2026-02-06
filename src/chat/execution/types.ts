/**
 * Tool Execution Types
 *
 * Core types for the AI tool execution system.
 * Inspired by OpenClaw's execution model.
 */

import type { z } from 'zod';

// =============================================================================
// Security Types
// =============================================================================

/**
 * Security mode determines how commands are validated
 * - deny: Block all tool execution
 * - sandbox: Run in Docker container (isolated)
 * - allowlist: Only pre-approved commands/patterns
 * - ask: Require user approval for each tool call
 * - full: No restrictions (dangerous!)
 */
export type SecurityMode = 'deny' | 'sandbox' | 'allowlist' | 'ask' | 'full';

/**
 * Security policy for tool execution
 */
export interface SecurityPolicy {
  mode: SecurityMode;
  allowlist?: AllowlistEntry[];
  askTimeout?: number; // ms to wait for user approval
  sandboxConfig?: SandboxConfig;
}

export interface AllowlistEntry {
  pattern: string; // glob pattern or regex
  type: 'command' | 'path' | 'url';
  description?: string;
  addedAt: string;
  addedBy?: string;
}

export interface SandboxConfig {
  enabled: boolean;
  image: string;
  containerName?: string;
  workdir: string;
  mounts?: SandboxMount[];
  env?: Record<string, string>;
  networkMode?: 'none' | 'bridge' | 'host';
  memoryLimit?: string;
  cpuLimit?: string;
}

export interface SandboxMount {
  hostPath: string;
  containerPath: string;
  readonly?: boolean;
}

// =============================================================================
// Tool Definition Types
// =============================================================================

/**
 * Tool definition for AI function calling
 * Note: parameters uses z.ZodType with any input type to support .default() schemas
 */
export interface ToolDefinition<TParams = unknown, TResult = unknown> {
  name: string;
  description: string;
  category: ToolCategory;
  parameters: z.ZodType<TParams, z.ZodTypeDef, any>;

  // Security
  requiresApproval?: boolean;
  securityLevel: 'safe' | 'moderate' | 'dangerous';
  allowedHosts?: ('sandbox' | 'gateway' | 'local')[];

  // Execution
  execute: ToolExecutor<TParams, TResult>;

  /**
   * Optional availability check. If defined, the tool is only included in the
   * tool list sent to the AI model when `available` is true. Tools that require
   * external configuration (API keys, services) should implement this to avoid
   * wasting tokens on tools the model can't use.
   *
   * Follows OpenClaw's config-gated tool pattern.
   */
  isAvailable?: () => ToolAvailability;

  // Optional metadata
  examples?: ToolExample[];
  rateLimit?: RateLimitConfig;
}

export interface ToolAvailability {
  available: boolean;
  reason?: string;
}

export type ToolCategory =
  | 'execution'    // Shell commands, scripts
  | 'filesystem'   // File read/write/search
  | 'web'          // Web fetch, search
  | 'data'         // Database, API calls
  | 'system'       // System info, env
  | 'glinr'        // GLINR task/ticket operations
  | 'memory'       // Conversation memory management
  | 'browser'      // Browser automation (Playwright)
  | 'custom';      // User-defined

export interface ToolExample {
  description: string;
  params: Record<string, unknown>;
  expectedOutput?: string;
}

export interface RateLimitConfig {
  maxCalls: number;
  windowMs: number;
}

// =============================================================================
// Tool Execution Types
// =============================================================================

export type ToolExecutor<TParams, TResult> = (
  context: ToolExecutionContext,
  params: TParams,
) => Promise<ToolResult<TResult>>;

export interface ToolExecutionContext {
  toolCallId: string;
  conversationId: string;
  userId?: string;

  // Execution environment
  workdir: string;
  env: Record<string, string>;
  securityPolicy: SecurityPolicy;

  // Callbacks
  onProgress?: (update: ToolProgressUpdate) => void;
  signal?: AbortSignal;

  // Session management
  sessionManager: SessionManager;
}

export interface ToolProgressUpdate {
  type: 'output' | 'status' | 'approval-needed';
  content: string;
  timestamp: number;
}

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  output?: string;
  error?: ToolError;

  // Execution details
  durationMs?: number;
  sessionId?: string;

  // For streaming/background
  isRunning?: boolean;
  isBackgrounded?: boolean;
}

export interface ToolError {
  code: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
}

// =============================================================================
// Session Management Types
// =============================================================================

export interface SessionManager {
  create(session: Omit<ToolSession, 'id' | 'createdAt'>): ToolSession;
  get(sessionId: string): ToolSession | undefined;
  update(sessionId: string, update: Partial<ToolSession>): void;
  list(filter?: SessionFilter): ToolSession[];
  kill(sessionId: string): Promise<void>;
  cleanup(): void;
}

export interface ToolSession {
  id: string;
  toolCallId: string;
  toolName: string;
  conversationId: string;

  // Process info
  pid?: number;
  command?: string;
  workdir?: string;

  // State
  status: SessionStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;

  // Output
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  exitSignal?: string | null;

  // Limits
  maxOutputChars: number;
  truncated: boolean;

  // Background
  backgrounded: boolean;
  notifyOnExit: boolean;
}

export type SessionStatus =
  | 'pending'      // Waiting for approval
  | 'running'      // Actively executing
  | 'completed'    // Finished successfully
  | 'failed'       // Finished with error
  | 'killed'       // Manually terminated
  | 'timeout';     // Exceeded time limit

export interface SessionFilter {
  conversationId?: string;
  toolName?: string;
  status?: SessionStatus[];
  since?: number;
}

// =============================================================================
// Approval Types
// =============================================================================

export interface ApprovalRequest {
  id: string;
  toolCallId: string;
  toolName: string;
  conversationId: string;

  // What needs approval
  command?: string;
  params: Record<string, unknown>;
  securityLevel: 'moderate' | 'dangerous';

  // Timing
  createdAt: number;
  expiresAt: number;

  // State
  status: 'pending' | 'approved' | 'denied' | 'expired';
  decision?: ApprovalDecision;
  decidedAt?: number;
  decidedBy?: string;
}

export type ApprovalDecision =
  | 'allow-once'    // Allow this specific call
  | 'allow-always'  // Add to allowlist
  | 'deny';         // Block execution

export interface ApprovalResponse {
  requestId: string;
  decision: ApprovalDecision;
  userId?: string;
}

// =============================================================================
// Tool Call Types (from AI response)
// =============================================================================

export interface AIToolCall {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  toolCallId: string;
  toolName: string;
  result: ToolResult;
  approvalRequired?: boolean;
  approvalId?: string;
  rateLimitInfo?: {
    remaining: number;
    resetAt: number;
  };
}

// =============================================================================
// Registry Types
// =============================================================================

export interface ToolRegistry {
  register<TParams, TResult>(tool: ToolDefinition<TParams, TResult>): void;
  unregister(name: string): boolean;
  get(name: string): ToolDefinition | undefined;
  list(category?: ToolCategory): ToolDefinition[];
  getForAI(): AIToolSchema[];
}

/**
 * Tool schema for AI function calling (OpenAI/Anthropic format)
 */
export interface AIToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}
