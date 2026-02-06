/**
 * Hook Types for profClaw
 *
 * Types for processing and storing hook events from Claude Code and other agents.
 */

export type HookEventType = 'PostToolUse' | 'Stop' | 'UserPromptSubmit';

/**
 * Processed hook event stored by profClaw
 */
export interface HookEvent {
  id: string;
  sessionId: string;
  event: HookEventType;
  timestamp: Date;
  workingDirectory?: string;
  data: HookEventData;
  inference?: HookInference;
}

/**
 * Data extracted from hook payload
 */
export interface HookEventData {
  tool?: string;
  filePath?: string;
  action?: 'create' | 'modify' | 'delete' | 'read' | 'execute';
  linesChanged?: number;
  command?: string;
  error?: string;
  summary?: string;
}

/**
 * Inferences made about the hook by the rules engine
 */
export interface HookInference {
  taskType?: string;
  component?: string;
  linkedIssue?: string;
  linkedPr?: string;
  commitMessage?: string;
  confidence: number;
}

/**
 * Session aggregate from multiple hooks
 */
export interface SessionAggregate {
  sessionId: string;
  startTime: Date;
  endTime?: Date;
  status: 'active' | 'completed' | 'cancelled' | 'error';
  filesModified: string[];
  filesCreated: string[];
  filesRead: string[];
  commandsExecuted: string[];
  toolUseCounts: Record<string, number>;
  inferences: HookInference[];
  summary?: string;
}

/**
 * Hook processing result
 */
export interface HookProcessingResult {
  success: boolean;
  eventId: string;
  inference?: HookInference;
  error?: string;
}

/**
 * Configuration for hook endpoints
 */
export interface HookConfig {
  enabled: boolean;
  storeEvents: boolean;
  inferenceEnabled: boolean;
  maxEventsPerSession: number;
}
