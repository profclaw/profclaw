/**
 * Session Spawn Types
 *
 * Type definitions for the agent session hierarchy and messaging system.
 * Enables parent agents to spawn child sessions for parallel work.
 */

// Session Types

export type SessionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type SessionStopReason =
  | 'completed'
  | 'budget_exceeded'
  | 'max_steps'
  | 'cancelled'
  | 'error'
  | 'timeout';

export interface AgentSession {
  id: string;
  parentSessionId: string | null;
  conversationId: string;

  // Identity
  name: string;
  description?: string;
  goal?: string;

  // Status
  status: SessionStatus;

  // Hierarchy
  depth: number; // 0 = root, max = 3

  // Execution tracking
  currentStep: number;
  maxSteps: number;
  usedBudget: number; // tokens used
  maxBudget: number; // token limit

  // Result
  finalResult?: Record<string, unknown>;
  stopReason?: SessionStopReason;

  // Tool restrictions
  allowedTools?: string[];
  disallowedTools?: string[];

  // Timestamps
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  updatedAt: Date;

  // Metadata
  metadata?: Record<string, unknown>;
}

// Message Types

export type MessageType = 'message' | 'result' | 'request' | 'notification' | 'error';

export type MessageStatus = 'pending' | 'delivered' | 'read' | 'expired';

export interface SessionMessage {
  id: string;
  fromSessionId: string;
  toSessionId: string;

  // Content
  type: MessageType;
  subject?: string;
  content: Record<string, unknown>;

  // Priority 1-10 (10 = highest)
  priority: number;

  // Status
  status: MessageStatus;

  // Threading
  replyToMessageId?: string;

  // TTL
  expiresAt?: Date;

  // Timestamps
  createdAt: Date;
  deliveredAt?: Date;
  readAt?: Date;
}

// Manager Types

export interface SpawnSessionParams {
  parentSessionId: string;
  name: string;
  goal: string;
  description?: string;
  maxSteps?: number;
  maxBudget?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateSessionParams {
  currentStep?: number;
  usedBudget?: number;
  status?: SessionStatus;
  metadata?: Record<string, unknown>;
}

export interface CompleteSessionParams {
  finalResult: Record<string, unknown>;
  stopReason: SessionStopReason;
}

export interface SendMessageParams {
  fromSessionId: string;
  target: 'parent' | 'children' | 'siblings' | string; // string = specific session ID
  type: MessageType;
  subject?: string;
  content: Record<string, unknown>;
  priority?: number;
  replyToMessageId?: string;
  ttlMs?: number;
}

export interface ReceiveMessagesParams {
  sessionId: string;
  types?: MessageType[];
  fromSessionId?: string;
  minPriority?: number;
  markAsRead?: boolean;
  limit?: number;
}

export interface CleanupParams {
  olderThanMs: number;
}

// Manager Interface

export interface AgentSessionManager {
  // Session lifecycle
  spawn(params: SpawnSessionParams): Promise<AgentSession>;
  get(sessionId: string): Promise<AgentSession | null>;
  update(sessionId: string, params: UpdateSessionParams): Promise<AgentSession | null>;
  complete(sessionId: string, params: CompleteSessionParams): Promise<AgentSession | null>;
  cancel(sessionId: string, reason?: string): Promise<AgentSession | null>;

  // Hierarchy queries
  getChildren(sessionId: string): Promise<AgentSession[]>;
  getSiblings(sessionId: string): Promise<AgentSession[]>;
  getParent(sessionId: string): Promise<AgentSession | null>;
  getByConversation(conversationId: string): Promise<AgentSession[]>;

  // Messaging
  send(params: SendMessageParams): Promise<SessionMessage[]>;
  receive(params: ReceiveMessagesParams): Promise<SessionMessage[]>;
  getUnreadCount(sessionId: string): Promise<number>;

  // Cleanup
  cleanup(params: CleanupParams): Promise<{ sessionsDeleted: number; messagesDeleted: number }>;
}

// Constants

export const SESSION_CONSTANTS = {
  MAX_SPAWN_DEPTH: 3,
  MAX_CHILDREN_PER_SESSION: 5,
  DEFAULT_MAX_STEPS: 20,
  DEFAULT_MAX_BUDGET: 20_000,
  DEFAULT_MESSAGE_PRIORITY: 5,
  MAX_MESSAGE_PRIORITY: 10,
} as const;
