import type { Task, TaskResult } from './task.js';

/**
 * Agent Adapter Interface
 *
 * This is the core abstraction that allows the task manager to work with
 * any AI agent: OpenClaw, Claude Code, GitHub Copilot, Devin, etc.
 *
 * Each adapter implements this interface to handle the specifics of
 * communicating with that particular agent.
 */
export interface AgentAdapter {
  /** Unique identifier for this adapter type */
  readonly type: string;

  /** Human-readable name */
  readonly name: string;

  /** Description of the agent's capabilities */
  readonly description: string;

  /** What this agent is best at */
  readonly capabilities: AgentCapability[];

  /**
   * Check if the agent is available and healthy
   */
  healthCheck(): Promise<AgentHealth>;

  /**
   * Execute a task and return the result
   * This is the main method that sends work to the AI agent
   */
  executeTask(task: Task): Promise<TaskResult>;

  /**
   * Cancel a running task (if supported)
   */
  cancelTask?(taskId: string): Promise<boolean>;

  /**
   * Get the current status of a task (if async execution)
   */
  getTaskStatus?(taskId: string): Promise<AgentTaskStatus>;

  /**
   * Stream task output in real-time (if supported)
   */
  streamTaskOutput?(taskId: string): AsyncGenerator<string, void, unknown>;
}

/** What an agent can do */
export type AgentCapability =
  | 'code_generation'
  | 'code_review'
  | 'bug_fix'
  | 'testing'
  | 'documentation'
  | 'refactoring'
  | 'research'
  | 'git_operations'
  | 'file_operations'
  | 'web_browsing'
  | 'api_calls'
  | 'image_generation'
  | 'data_analysis';

/** Agent health status */
export interface AgentHealth {
  healthy: boolean;
  latencyMs?: number;
  message?: string;
  lastChecked: Date;
  details?: Record<string, unknown>;
}

/** Status of a task being executed by an agent */
export interface AgentTaskStatus {
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress?: number; // 0-100
  currentStep?: string;
  startedAt?: Date;
  estimatedCompletion?: Date;
}

/**
 * Configuration for an agent adapter instance
 */
export interface AgentConfig {
  /** Unique instance ID */
  id: string;

  /** Adapter type (e.g., 'openclaw', 'claude-code') */
  type: string;

  /** Whether this agent is enabled */
  enabled: boolean;

  /** Max concurrent tasks this agent can handle */
  maxConcurrent: number;

  /** Priority weight (higher = preferred for matching tasks) */
  priority: number;

  /** Task types this agent should handle */
  taskTypes?: string[];

  /** Labels that route tasks to this agent */
  labels?: string[];

  /** Adapter-specific configuration */
  config: Record<string, unknown>;
}

/**
 * Agent registry for managing multiple agent adapters
 */
export interface AgentRegistry {
  /** Register a new adapter type */
  registerAdapter(type: string, factory: AgentAdapterFactory): void;

  /** Create an adapter instance from config */
  createAdapter(config: AgentConfig): AgentAdapter;

  /** Get all registered adapter types */
  getAdapterTypes(): string[];

  /** Get adapter by instance ID */
  getAdapter(id: string): AgentAdapter | undefined;

  /** Get all active adapters */
  getActiveAdapters(): AgentAdapter[];

  /** Find best adapter for a task */
  findAdapterForTask(task: Task): AgentAdapter | undefined;
}

/** Factory function to create adapter instances */
export type AgentAdapterFactory = (config: AgentConfig) => AgentAdapter;
