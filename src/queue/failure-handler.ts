/**
 * Task Failure Handler
 *
 * Handles task failures with:
 * - Exponential backoff with jitter (prevents thundering herd)
 * - Database-persisted dead letter queue (survives restarts)
 * - BullMQ integration for actual delayed retries
 */

import type { Task, TaskResult } from '../types/task.js';
import { sendSlackNotification } from '../notifications/slack.js';
import { getStorage } from '../storage/index.js';
import { randomUUID } from 'crypto';
import type { Queue } from 'bullmq';

// Reference to the task queue (set during init)
let taskQueueRef: Queue<Task> | null = null;

/**
 * Set reference to BullMQ queue for retry operations
 */
export function setTaskQueueRef(queue: Queue<Task>): void {
  taskQueueRef = queue;
}

/**
 * Dead Letter Task record (matches database schema)
 */
export interface DeadLetterTask {
  id: string;
  taskId: string;
  title: string;
  description?: string;
  prompt: string;
  source: string;
  sourceId?: string;
  sourceUrl?: string;
  repository?: string;
  branch?: string;
  labels: string[];
  assignedAgent?: string;
  priority: number;
  attempts: number;
  maxAttempts: number;
  lastErrorCode: string;
  lastErrorMessage: string;
  lastErrorStack?: string;
  retryCount: number;
  lastRetryAt?: Date;
  status: 'pending' | 'resolved' | 'discarded';
  resolvedAt?: Date;
  resolvedBy?: string;
  resolutionNote?: string;
  metadata: Record<string, any>;
  createdAt: Date;
  taskCreatedAt?: Date;
  taskStartedAt?: Date;
}

/**
 * Initialize DLQ table (call on startup)
 */
export async function initDeadLetterQueue(): Promise<void> {
  const storage = getStorage();
  await storage.execute(`
    CREATE TABLE IF NOT EXISTS dead_letter_tasks (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      prompt TEXT NOT NULL,
      source TEXT NOT NULL,
      source_id TEXT,
      source_url TEXT,
      repository TEXT,
      branch TEXT,
      labels TEXT NOT NULL DEFAULT '[]',
      assigned_agent TEXT,
      priority INTEGER NOT NULL DEFAULT 3,
      attempts INTEGER NOT NULL,
      max_attempts INTEGER NOT NULL,
      last_error_code TEXT NOT NULL,
      last_error_message TEXT NOT NULL,
      last_error_stack TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_retry_at INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      resolved_at INTEGER,
      resolved_by TEXT,
      resolution_note TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      task_created_at INTEGER,
      task_started_at INTEGER
    )
  `);

  // Index for querying pending items
  await storage.execute(`
    CREATE INDEX IF NOT EXISTS idx_dlq_status ON dead_letter_tasks(status)
  `);
}

/**
 * Handle a failed task
 */
export async function handleTaskFailure(task: Task, error: Error): Promise<void> {
  console.error(`[FailureHandler] Task ${task.id} failed: ${error.message}`);

  task.attempts = (task.attempts || 0) + 1;

  // Check if we should retry
  if (task.attempts < task.maxAttempts) {
    const delay = calculateBackoffWithJitter(task.attempts);
    console.log(`[FailureHandler] Scheduling retry ${task.attempts}/${task.maxAttempts} in ${Math.round(delay / 1000)}s`);

    // Actually retry with BullMQ delay
    if (taskQueueRef) {
      await taskQueueRef.add(
        `retry-${task.id}-${task.attempts}`,
        { ...task, status: 'pending' },
        {
          delay,
          priority: task.priority,
          jobId: `${task.id}-retry-${task.attempts}`,
        }
      );
      console.log(`[FailureHandler] Task ${task.id} requeued with ${delay}ms delay`);
    } else {
      console.warn('[FailureHandler] Task queue not available, cannot retry');
    }

    await sendSlackNotification({
      type: 'task_retry',
      title: `🔄 Task Retry: ${task.title}`,
      message: `Attempt ${task.attempts}/${task.maxAttempts} failed. Retrying in ${Math.round(delay / 60000)} minutes.\nError: ${error.message}`,
      task,
      severity: 'info',
    }).catch(console.error);

    return;
  }

  // Max retries reached - move to dead letter queue
  console.error(`[FailureHandler] Task ${task.id} exceeded max retries, moving to dead letter queue`);

  task.status = 'failed';
  task.result = {
    success: false,
    output: '',
    error: {
      code: 'MAX_RETRIES_EXCEEDED',
      message: `Task failed after ${task.maxAttempts} attempts. Last error: ${error.message}`,
      stack: error.stack,
    },
  };

  // Persist to database DLQ
  await addToDeadLetterQueue(task, error);

  // Post failure comment on GitHub
  await postFailureComment(task, error);

  // Send critical alert
  await sendSlackNotification({
    type: 'task_failed',
    title: `❌ Task Failed: ${task.title}`,
    message: `Task failed after ${task.maxAttempts} attempts and moved to dead letter queue.\n\nLast error: ${error.message}\n\nSource: ${task.sourceUrl || 'N/A'}`,
    task,
    severity: 'error',
  }).catch(console.error);
}

/**
 * Calculate exponential backoff with jitter
 * Base: 5min, 15min, 45min pattern + ±10% jitter
 */
function calculateBackoffWithJitter(attempt: number): number {
  const baseDelay = 5 * 60 * 1000; // 5 minutes
  const exponentialDelay = Math.pow(3, attempt - 1) * baseDelay;

  // Add jitter: ±10% randomization to prevent thundering herd
  const jitter = 0.9 + Math.random() * 0.2; // 0.9 to 1.1

  return Math.floor(exponentialDelay * jitter);
}

/**
 * Add task to database DLQ
 */
async function addToDeadLetterQueue(task: Task, error: Error): Promise<void> {
  const storage = getStorage();
  const id = randomUUID();

  await storage.execute(
    `INSERT INTO dead_letter_tasks (
      id, task_id, title, description, prompt, source, source_id, source_url,
      repository, branch, labels, assigned_agent, priority,
      attempts, max_attempts, last_error_code, last_error_message, last_error_stack,
      status, metadata, task_created_at, task_started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      task.id,
      task.title,
      task.description ?? null,
      task.prompt,
      task.source,
      task.sourceId ?? null,
      task.sourceUrl ?? null,
      task.repository ?? null,
      task.branch ?? null,
      JSON.stringify(task.labels ?? []),
      task.assignedAgent ?? null,
      task.priority ?? 3,
      task.attempts ?? 0,
      task.maxAttempts ?? 3,
      'MAX_RETRIES_EXCEEDED',
      error.message,
      error.stack ?? null,
      'pending',
      JSON.stringify(task.metadata ?? {}),
      task.createdAt ? Math.floor(new Date(task.createdAt as any).getTime() / 1000) : null,
      task.startedAt ? Math.floor(new Date(task.startedAt as any).getTime() / 1000) : null,
    ]
  );

  console.log(`[FailureHandler] Task ${task.id} persisted to DLQ with ID ${id}`);
}

/**
 * Post failure comment on GitHub issue
 */
async function postFailureComment(task: Task, error: Error): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token || !task.repository || !task.sourceId) {
    return;
  }

  if (task.source !== 'github_issue' && task.source !== 'github_pr') {
    return;
  }

  const [owner, repo] = task.repository.split('/');
  const issueNumber = parseInt(task.sourceId);

  const body = `## ❌ AI Task Failed

**Status:** Failed after ${task.maxAttempts} attempts

### Error
\`\`\`
${error.message}
\`\`\`

### Details
- **Task ID:** \`${task.id}\`
- **Attempts:** ${task.attempts}/${task.maxAttempts}
- **Duration:** ${task.startedAt ? Math.round((Date.now() - new Date(task.startedAt as any).getTime()) / 1000) : 'N/A'}s

### Next Steps
This task has been moved to the dead letter queue for manual review. Please:
1. Check if the issue description is clear
2. Verify the codebase is in a buildable state
3. Re-trigger the task or assign to a human developer

---
*Posted by [GLINR Task Manager](https://github.com/GLINCKER/glinr-task-manager)*`;

  try {
    await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'glinr-task-manager',
        },
        body: JSON.stringify({ body }),
      }
    );
  } catch (err) {
    console.error('[FailureHandler] Failed to post GitHub comment:', err);
  }
}

/**
 * Get dead letter queue tasks from database
 */
export async function getDeadLetterQueue(options?: {
  status?: 'pending' | 'resolved' | 'discarded';
  limit?: number;
  offset?: number;
}): Promise<{ tasks: DeadLetterTask[]; total: number }> {
  const storage = getStorage();
  const status = options?.status || 'pending';
  const limit = options?.limit || 50;
  const offset = options?.offset || 0;

  // Get total count
  const countResult = await storage.query<{ count: number }>(
    'SELECT COUNT(*) as count FROM dead_letter_tasks WHERE status = ?',
    [status]
  );
  const total = countResult[0]?.count || 0;

  // Get tasks
  const rows = await storage.query<Record<string, any>>(
    `SELECT * FROM dead_letter_tasks WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [status, limit, offset]
  );

  const tasks = rows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    title: row.title,
    description: row.description,
    prompt: row.prompt,
    source: row.source,
    sourceId: row.source_id,
    sourceUrl: row.source_url,
    repository: row.repository,
    branch: row.branch,
    labels: JSON.parse(row.labels || '[]'),
    assignedAgent: row.assigned_agent,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    lastErrorStack: row.last_error_stack,
    retryCount: row.retry_count,
    lastRetryAt: row.last_retry_at ? new Date(row.last_retry_at * 1000) : undefined,
    status: row.status as 'pending' | 'resolved' | 'discarded',
    resolvedAt: row.resolved_at ? new Date(row.resolved_at * 1000) : undefined,
    resolvedBy: row.resolved_by,
    resolutionNote: row.resolution_note,
    metadata: JSON.parse(row.metadata || '{}'),
    createdAt: new Date(row.created_at * 1000),
    taskCreatedAt: row.task_created_at ? new Date(row.task_created_at * 1000) : undefined,
    taskStartedAt: row.task_started_at ? new Date(row.task_started_at * 1000) : undefined,
  }));

  return { tasks, total };
}

/**
 * Remove task from dead letter queue (mark as resolved)
 */
export async function removeFromDeadLetterQueue(
  dlqId: string,
  resolvedBy?: string,
  resolutionNote?: string
): Promise<boolean> {
  const storage = getStorage();

  const result = await storage.execute(
    `UPDATE dead_letter_tasks
     SET status = 'resolved', resolved_at = strftime('%s', 'now'), resolved_by = ?, resolution_note = ?
     WHERE id = ?`,
    [resolvedBy || 'system', resolutionNote || null, dlqId]
  );

  return true;
}

/**
 * Discard a task from dead letter queue (won't be retried)
 */
export async function discardFromDeadLetterQueue(
  dlqId: string,
  resolvedBy?: string,
  resolutionNote?: string
): Promise<boolean> {
  const storage = getStorage();

  await storage.execute(
    `UPDATE dead_letter_tasks
     SET status = 'discarded', resolved_at = strftime('%s', 'now'), resolved_by = ?, resolution_note = ?
     WHERE id = ?`,
    [resolvedBy || 'system', resolutionNote || 'Discarded', dlqId]
  );

  return true;
}

/**
 * Retry a task from dead letter queue
 */
export async function retryDeadLetterTask(dlqId: string): Promise<boolean> {
  if (!taskQueueRef) {
    console.error('[FailureHandler] Task queue not available, cannot retry');
    return false;
  }

  const storage = getStorage();

  // Get the DLQ entry
  const rows = await storage.query<Record<string, any>>(
    'SELECT * FROM dead_letter_tasks WHERE id = ? AND status = ?',
    [dlqId, 'pending']
  );

  if (rows.length === 0) {
    console.error(`[FailureHandler] DLQ entry ${dlqId} not found or not pending`);
    return false;
  }

  const dlqEntry = rows[0];

  // Reconstruct task object
  const task: Task = {
    id: dlqEntry.task_id,
    title: dlqEntry.title,
    description: dlqEntry.description,
    prompt: dlqEntry.prompt,
    status: 'pending',
    priority: dlqEntry.priority,
    source: dlqEntry.source,
    sourceId: dlqEntry.source_id,
    sourceUrl: dlqEntry.source_url,
    repository: dlqEntry.repository,
    branch: dlqEntry.branch,
    labels: JSON.parse(dlqEntry.labels || '[]'),
    assignedAgent: dlqEntry.assigned_agent,
    createdAt: new Date(),
    updatedAt: new Date(),
    attempts: 0, // Reset attempts for retry
    maxAttempts: dlqEntry.max_attempts,
    metadata: {
      ...JSON.parse(dlqEntry.metadata || '{}'),
      retriedFromDLQ: dlqId,
      dlqRetryCount: (dlqEntry.retry_count || 0) + 1,
    },
  };

  // Add back to main queue
  await taskQueueRef.add(
    `dlq-retry-${task.id}`,
    task,
    {
      priority: task.priority,
      jobId: `${task.id}-dlq-retry-${Date.now()}`,
    }
  );

  // Update DLQ entry
  await storage.execute(
    `UPDATE dead_letter_tasks
     SET retry_count = retry_count + 1, last_retry_at = strftime('%s', 'now'), status = 'resolved', resolution_note = 'Retried'
     WHERE id = ?`,
    [dlqId]
  );

  console.log(`[FailureHandler] Task ${task.id} moved from DLQ back to main queue`);
  return true;
}

/**
 * Get DLQ statistics
 */
export async function getDeadLetterQueueStats(): Promise<{
  pending: number;
  resolved: number;
  discarded: number;
  total: number;
}> {
  const storage = getStorage();

  const rows = await storage.query<{ status: string; count: number }>(
    `SELECT status, COUNT(*) as count FROM dead_letter_tasks GROUP BY status`
  );

  const stats = {
    pending: 0,
    resolved: 0,
    discarded: 0,
    total: 0,
  };

  for (const row of rows) {
    if (row.status === 'pending') stats.pending = row.count;
    else if (row.status === 'resolved') stats.resolved = row.count;
    else if (row.status === 'discarded') stats.discarded = row.count;
    stats.total += row.count;
  }

  return stats;
}
