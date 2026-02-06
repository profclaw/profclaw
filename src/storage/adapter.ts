import type { Task, CreateTaskInput, TaskEvent as TaskEventType } from '../types/task.js';
import type { Summary, CreateSummaryInput, SummaryQuery, SummaryStats } from '../types/summary.js';

/**
 * Task Event for audit logging
 */
export interface TaskEventInput {
  taskId: string;
  type: 'created' | 'queued' | 'assigned' | 'started' | 'progress' | 'completed' | 'failed' | 'cancelled' | 'retried';
  agentId?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Task Analytics Summary
 */
export interface TaskAnalytics {
  // Overall stats
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  cancelledTasks: number;

  // Performance metrics
  successRate: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;

  // Breakdowns
  byStatus: Record<string, number>;
  byPriority: Record<number, number>;
  bySource: Record<string, number>;
  byAgent: Record<string, { count: number; successRate: number; avgDurationMs: number }>;

  // Time series (last 30 days)
  daily: Array<{
    date: string;
    created: number;
    completed: number;
    failed: number;
  }>;

  // Recent activity
  recentCompletions: number; // last 24h
  recentFailures: number; // last 24h
}

/**
 * Task filter options for advanced queries
 */
export interface TaskFilterOptions {
  status?: string | string[];
  priority?: number | number[];
  source?: string | string[];
  agent?: string;
  labels?: string[];
  createdAfter?: Date;
  createdBefore?: Date;
  completedAfter?: Date;
  completedBefore?: Date;
  repository?: string;
  searchQuery?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'priority' | 'completedAt';
  sortOrder?: 'asc' | 'desc';
  // Cursor-based pagination (Phase 17)
  cursorCreatedAt?: Date;
  cursorId?: string;
}

/**
 * Generic Storage Adapter Interface
 */
export interface StorageAdapter {
  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // Tasks
  createTask(input: CreateTaskInput): Promise<Task>;
  getTask(id: string): Promise<Task | null>;
  updateTask(id: string, updates: Partial<Task>): Promise<Task>;
  deleteTask(id: string): Promise<boolean>;
  getTasks(query?: { limit?: number; offset?: number; status?: string }): Promise<{ tasks: Task[]; total: number }>;

  // Summaries
  createSummary(input: CreateSummaryInput): Promise<Summary>;
  getSummary(id: string, includeRawOutput?: boolean): Promise<Summary | null>;
  getTaskSummaries(taskId: string): Promise<Summary[]>;
  querySummaries(query: Partial<SummaryQuery>): Promise<{ summaries: Summary[]; total: number }>;
  deleteSummary(id: string): Promise<boolean>;
  getSummaryStats(): Promise<SummaryStats>;
  getSummaryRawOutput(summaryId: string): Promise<string | null>; // Phase 17: lazy load

  // Vector Search (Optional implementation)
  storeEmbedding?(id: string, entityType: 'task' | 'summary', entityId: string, embedding: number[], model: string): Promise<void>;
  searchSimilar?(entityType: 'task' | 'summary', embedding: number[], limit?: number): Promise<Array<{ entityId: string; distance: number }>>;

  // Health
  healthCheck(): Promise<{ healthy: boolean; latencyMs: number }>;

  // Agent Stats
  getAgentStats(): Promise<Record<string, { completed: number; failed: number; avgDuration: number; lastActivity?: Date }>>;

  // Costs
  getCostAnalytics(): Promise<{
    daily: Array<{ date: string; cost: number; tokens: number }>;
    byModel: Record<string, { cost: number; tokens: number }>;
    byAgent: Record<string, { cost: number; tokens: number }>;
    totalCost: number;
    totalTokens: number;
  }>;

  // Generic SQL operations (for settings, etc.)
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;

  // Task Events (Audit Log) - Optional
  recordTaskEvent?(event: TaskEventInput): Promise<void>;
  getTaskEvents?(taskId: string): Promise<TaskEventType[]>;

  // Task Analytics - Optional
  getTaskAnalytics?(): Promise<TaskAnalytics>;
  getTasksFiltered?(options: TaskFilterOptions): Promise<{ tasks: Task[]; total: number }>;

  // Task Archival - Optional
  archiveOldTasks?(olderThanDays: number): Promise<{ archived: number }>;
  getArchivedTasks?(options: { limit?: number; offset?: number }): Promise<{ tasks: Task[]; total: number }>;
}
