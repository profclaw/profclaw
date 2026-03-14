import { z } from 'zod';

// Task priority levels
export const TaskPriority = {
  CRITICAL: 1,
  HIGH: 2,
  MEDIUM: 3,
  LOW: 4,
} as const;

export type TaskPriorityType = (typeof TaskPriority)[keyof typeof TaskPriority];

// Task status
export const TaskStatus = {
  PENDING: 'pending',
  QUEUED: 'queued',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export type TaskStatusType = (typeof TaskStatus)[keyof typeof TaskStatus];

// Source of the task (where it came from)
export const TaskSource = {
  GITHUB_ISSUE: 'github_issue',
  GITHUB_PR: 'github_pr',
  JIRA: 'jira',
  LINEAR: 'linear',
  SLACK: 'slack',
  DISCORD: 'discord',
  TELEGRAM: 'telegram',
  API: 'api',
  MANUAL: 'manual',
} as const;

export type TaskSourceType = (typeof TaskSource)[keyof typeof TaskSource];

// Zod schema for task creation
export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  prompt: z.string().min(1), // The actual prompt to send to AI
  priority: z.number().min(1).max(4).default(3),
  source: z.string(),
  sourceId: z.string().optional(), // e.g., issue number, PR number
  sourceUrl: z.string().url().optional(),
  repository: z.string().optional(), // e.g., "profclaw/profclaw"
  branch: z.string().optional(),
  labels: z.array(z.string()).default([]),
  assignedAgent: z.string().optional(), // Which agent adapter to use
  metadata: z.record(z.unknown()).default({}),
});

export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

// Full task object (from database)
export interface Task extends CreateTaskInput {
  id: string;
  status: TaskStatusType;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  assignedAgentId?: string;
  // Task→Ticket relationship (Phase 17)
  ticketId?: string;
  result?: TaskResult;
  attempts: number;
  maxAttempts: number;
}

// Result from an AI agent
export interface TaskResult {
  success: boolean;
  output: string; // The AI's response/work summary
  artifacts?: TaskArtifact[];
  tokensUsed?: {
    input: number;
    output: number;
    total: number;
  };
  cost?: {
    amount: number;
    currency: string;
  };
  duration?: number; // milliseconds
  error?: {
    code: string;
    message: string;
    stack?: string;
  };
  metadata?: Record<string, unknown>;
}

// Artifacts produced by the task (commits, PRs, files, etc.)
export interface TaskArtifact {
  type: 'commit' | 'pull_request' | 'file' | 'comment' | 'branch' | 'other';
  url?: string;
  sha?: string; // For commits
  path?: string; // For files
  content?: string;
  metadata?: Record<string, unknown>;
}

// Task event for audit logging
export interface TaskEvent {
  id: string;
  taskId: string;
  type: 'created' | 'queued' | 'assigned' | 'started' | 'progress' | 'completed' | 'failed' | 'cancelled' | 'retried';
  timestamp: Date;
  agentId?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}
