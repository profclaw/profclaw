/**
 * In-Memory Task Queue
 *
 * Drop-in replacement for BullMQ task queue in pico/mini modes.
 * Uses a Map-based FIFO with priority ordering. No Redis required.
 * Persists tasks to the same SQLite storage as the BullMQ queue.
 */

import type {
  Task,
  TaskResult,
  CreateTaskInput,
  TaskStatusType,
} from '../types/task.js';
import { randomUUID } from 'crypto';
import { createContextualLogger } from '../utils/logger.js';

const log = createContextualLogger('MemoryQueue');
import { getStorage, initStorage } from '../storage/index.js';
import { getConcurrency } from '../core/deployment.js';

// Lazy-loaded heavy modules (deferred to first task execution for lower cold-start footprint)
async function lazyGetAgentRegistry() {
  const { getAgentRegistry } = await import('../adapters/registry.js');
  return getAgentRegistry();
}
async function lazyPostResultToSource(task: Task, result: TaskResult) {
  const { postResultToSource } = await import('./notifications.js');
  return postResultToSource(task, result);
}
async function lazyCreateTaskNotification(event: TaskEvent) {
  const { createTaskNotification } = await import('../notifications/in-app.js');
  return createTaskNotification(event);
}
async function lazyExtractAndSummarize(result: TaskResult, meta: Record<string, unknown>) {
  const { extractFromTaskResult, createSummary } = await import('../summaries/index.js');
  const summaryInput = await extractFromTaskResult(result, meta);
  await createSummary(summaryInput);
}
import {
  handleTaskFailure,
  initDeadLetterQueue,
} from './failure-handler.js';

// Task store (cache, synced with DB)
const taskStore = new Map<string, Task>();
const eventCallbacks = new Map<string, (event: TaskEvent) => void>();

// Processing state
let processing = false;
let activeCount = 0;
let maxConcurrency = 1;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let evictionInterval: ReturnType<typeof setInterval> | null = null;

// Task eviction settings (prevent unbounded memory growth)
const TASK_EVICTION_TTL_MS = parseInt(process.env['TASK_EVICTION_TTL_MS'] ?? '3600000', 10); // 1 hour
const TASK_EVICTION_INTERVAL_MS = 300000; // 5 minutes
const TASK_LOAD_MAX_AGE_MS = 86400000; // 24 hours - only load recent tasks from DB

interface TaskEvent {
  type: 'created' | 'queued' | 'started' | 'progress' | 'completed' | 'failed';
  taskId: string;
  task: Task;
  result?: TaskResult;
  progress?: number;
}

function ensureDate(value: Date | string | undefined): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  return new Date(value);
}

async function persistTask(task: Task): Promise<void> {
  try {
    const storage = getStorage();
    const taskWithDates = {
      ...task,
      createdAt: ensureDate(task.createdAt) || new Date(),
      updatedAt: ensureDate(task.updatedAt) || new Date(),
      startedAt: ensureDate(task.startedAt),
      completedAt: ensureDate(task.completedAt),
    };

    const existing = await storage.getTask(task.id);
    if (existing) {
      await storage.updateTask(task.id, taskWithDates);
    } else {
      await storage.createTask(taskWithDates);
    }
  } catch (error) {
    log.error('Failed to persist task to DB', { taskId: task.id, error: error instanceof Error ? error.message : String(error) });
  }
}

async function loadTasksFromDB(): Promise<void> {
  try {
    const storage = getStorage();
    const { tasks } = await storage.getTasks({ limit: 10000 });
    const loadCutoff = Date.now() - TASK_LOAD_MAX_AGE_MS;
    let loaded = 0;

    for (const task of tasks) {
      // Only load active tasks or recently updated tasks to bound startup memory
      const isActive = task.status === 'pending' || task.status === 'queued' ||
                       task.status === 'in_progress' || task.status === 'assigned';
      const updatedAt = task.updatedAt instanceof Date
        ? task.updatedAt.getTime()
        : new Date(task.updatedAt).getTime();

      if (isActive || updatedAt > loadCutoff) {
        taskStore.set(task.id, task);
        loaded++;
      }
    }
    log.info('Loaded tasks from database', { loaded, skipped: tasks.length - loaded });
  } catch (error) {
    log.warn('Failed to load tasks from DB, starting fresh', { error: error instanceof Error ? error.message : String(error) });
  }
}

// SSE broadcast callback
let sseBroadcaster: ((eventType: string, data: Record<string, unknown>) => void) | null = null;

function emitEvent(event: TaskEvent): void {
  for (const callback of eventCallbacks.values()) {
    try {
      callback(event);
    } catch (error) {
      log.error('Error in event callback', error instanceof Error ? error : new Error(String(error)));
    }
  }

  if (sseBroadcaster) {
    try {
      sseBroadcaster(`task:${event.type}`, {
        taskId: event.taskId,
        task: {
          id: event.task.id,
          title: event.task.title,
          status: event.task.status,
          priority: event.task.priority,
          source: event.task.source,
          assignedAgent: event.task.assignedAgent,
          createdAt: event.task.createdAt,
          startedAt: event.task.startedAt,
          completedAt: event.task.completedAt,
        },
        result: event.result
          ? {
              success: event.result.success,
              error: event.result.error?.message,
            }
          : undefined,
        progress: event.progress,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      log.error('Error broadcasting SSE event', error instanceof Error ? error : new Error(String(error)));
    }
  }

  if (event.type === 'completed' || event.type === 'failed') {
    lazyCreateTaskNotification(event).then((id: string | null) => {
      if (id && sseBroadcaster) sseBroadcaster('notification:new', { id });
    }).catch((err: unknown) => log.error('Notification creation failed', err instanceof Error ? err : new Error(String(err))));
  }
}

/**
 * Process a single task (same logic as BullMQ worker).
 */
async function processTask(task: Task): Promise<TaskResult> {
  log.info('Processing task', { taskId: task.id, title: task.title });

  task.status = 'in_progress';
  task.startedAt = new Date();
  task.attempts += 1;
  taskStore.set(task.id, task);
  persistTask(task);

  emitEvent({ type: 'started', taskId: task.id, task });

  const registry = await lazyGetAgentRegistry();
  const adapter = registry.findAdapterForTask(task);

  if (!adapter) {
    const result: TaskResult = {
      success: false,
      output: 'No suitable agent adapter found for task',
      error: { code: 'NO_ADAPTER', message: 'No suitable agent adapter found for task' },
    };
    task.status = 'failed';
    task.completedAt = new Date();
    task.result = result;
    taskStore.set(task.id, task);
    await persistTask(task);
    emitEvent({ type: 'failed', taskId: task.id, task, result });
    return result;
  }

  log.info('Using adapter', { adapter: adapter.name });

  try {
    const result = await adapter.executeTask(task);
    task.result = result;

    if (result.success) {
      task.status = 'completed';
      task.completedAt = new Date();
      taskStore.set(task.id, task);
      await persistTask(task);

      // Create summary
      try {
        await lazyExtractAndSummarize(result, {
          taskId: task.id,
          agent: adapter.type,
          model: result.metadata?.model as string,
          startedAt: task.startedAt,
        });
      } catch (error) {
        log.error('Failed to create summary', { taskId: task.id, error: error instanceof Error ? error.message : String(error) });
      }

      // Post results back to source
      try {
        await lazyPostResultToSource(task, result);
      } catch (error) {
        log.error('Failed to post result to source', { taskId: task.id, error: error instanceof Error ? error.message : String(error) });
      }

      emitEvent({ type: 'completed', taskId: task.id, task, result });
    } else {
      // Handle failure with retry logic
      if (task.attempts < task.maxAttempts) {
        task.status = 'queued';
        taskStore.set(task.id, task);
        await persistTask(task);
        log.info('Task failed, retrying', { taskId: task.id, attempt: task.attempts, maxAttempts: task.maxAttempts });
      } else {
        task.status = 'failed';
        task.completedAt = new Date();
        taskStore.set(task.id, task);
        await persistTask(task);
        emitEvent({ type: 'failed', taskId: task.id, task, result });

        // Send to DLQ
        try {
          await handleTaskFailure(task, new Error(result.error?.message || 'Task failed'));
        } catch (dlqError) {
          log.error('DLQ error', { taskId: task.id, error: dlqError instanceof Error ? dlqError.message : String(dlqError) });
        }
      }
    }

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const result: TaskResult = {
      success: false,
      output: `Task execution failed: ${errorMessage}`,
      error: { code: 'EXECUTION_ERROR', message: errorMessage },
    };

    if (task.attempts < task.maxAttempts) {
      task.status = 'queued';
      taskStore.set(task.id, task);
      await persistTask(task);
      log.info('Task errored, retrying', { taskId: task.id, attempt: task.attempts, maxAttempts: task.maxAttempts });
    } else {
      task.status = 'failed';
      task.completedAt = new Date();
      task.result = result;
      taskStore.set(task.id, task);
      await persistTask(task);
      emitEvent({ type: 'failed', taskId: task.id, task, result });

      try {
        await handleTaskFailure(task, new Error(errorMessage));
      } catch (dlqError) {
        log.error('DLQ error', { taskId: task.id, error: dlqError instanceof Error ? dlqError.message : String(dlqError) });
      }
    }

    return result;
  }
}

/**
 * Process the next queued task if capacity allows.
 */
async function processNext(): Promise<void> {
  if (activeCount >= maxConcurrency) return;

  // Find next queued task by priority (lower number = higher priority)
  const queued = Array.from(taskStore.values())
    .filter(t => t.status === 'queued')
    .sort((a, b) => a.priority - b.priority);

  if (queued.length === 0) return;

  const task = queued[0];
  activeCount++;

  try {
    await processTask(task);
  } finally {
    activeCount--;
    // Check for more work
    processNext().catch((err: unknown) => log.error('processNext error', err instanceof Error ? err : new Error(String(err))));
  }
}

/**
 * Evict completed/failed/cancelled tasks older than the configured TTL
 * to prevent unbounded memory growth in long-running instances.
 */
function evictStaleTasks(): void {
  const cutoff = Date.now() - TASK_EVICTION_TTL_MS;
  let evicted = 0;

  for (const [id, task] of taskStore) {
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      const updatedAt = task.updatedAt instanceof Date
        ? task.updatedAt.getTime()
        : new Date(task.updatedAt).getTime();
      if (updatedAt < cutoff) {
        taskStore.delete(id);
        evicted++;
      }
    }
  }

  if (evicted > 0) {
    log.info('Evicted stale tasks', { evicted, storeSize: taskStore.size });
  }
}

// -- Exported interface (matches task-queue.ts) --

export async function initTaskQueue(): Promise<void> {
  await initStorage();
  await loadTasksFromDB();
  await initDeadLetterQueue();

  maxConcurrency = getConcurrency();
  processing = true;

  // Poll for queued tasks every 500ms
  pollInterval = setInterval(() => {
    if (processing) {
      processNext().catch((err: unknown) => log.error('processNext error', err instanceof Error ? err : new Error(String(err))));
    }
  }, 500);

  // Periodic eviction of completed/failed tasks to bound memory
  evictionInterval = setInterval(evictStaleTasks, TASK_EVICTION_INTERVAL_MS);

  log.info('In-memory queue initialized', { concurrency: maxConcurrency });
}

export async function addTask(input: CreateTaskInput): Promise<Task> {
  const task: Task = {
    ...input,
    labels: input.labels ?? [],
    metadata: input.metadata ?? {},
    id: randomUUID(),
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
    attempts: 0,
    maxAttempts: 3,
  };

  taskStore.set(task.id, task);
  await persistTask(task);

  emitEvent({ type: 'created', taskId: task.id, task });

  // Queue immediately
  task.status = 'queued';
  taskStore.set(task.id, task);
  await persistTask(task);

  emitEvent({ type: 'queued', taskId: task.id, task });

  log.info('Task added to queue', { taskId: task.id });

  // Trigger processing
  processNext().catch((err: unknown) => log.error('processNext error', err instanceof Error ? err : new Error(String(err))));

  return task;
}

export function getTask(id: string): Task | undefined {
  return taskStore.get(id);
}

export function getTasks(options?: {
  status?: TaskStatusType;
  limit?: number;
  offset?: number;
}): Task[] {
  let tasks = Array.from(taskStore.values());

  if (options?.status) {
    tasks = tasks.filter(t => t.status === options.status);
  }

  tasks.sort((a, b) => {
    const dateA = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
    const dateB = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
    return dateB - dateA;
  });

  const offset = options?.offset || 0;
  const limit = options?.limit || 50;
  return tasks.slice(offset, offset + limit);
}

export function onTaskEvent(callback: (event: TaskEvent) => void): () => void {
  const id = randomUUID();
  eventCallbacks.set(id, callback);
  return () => eventCallbacks.delete(id);
}

export function registerSSEBroadcaster(
  broadcaster: (eventType: string, data: Record<string, unknown>) => void,
): void {
  sseBroadcaster = broadcaster;
}

export async function cancelTask(id: string): Promise<boolean> {
  const task = taskStore.get(id);
  if (!task) return false;

  const cancellableStatuses: TaskStatusType[] = ['pending', 'queued', 'assigned', 'in_progress'];
  if (!cancellableStatuses.includes(task.status)) return false;

  task.status = 'cancelled';
  task.completedAt = new Date();
  task.result = {
    success: false,
    output: 'Task was cancelled by user',
    error: { code: 'CANCELLED', message: 'Task cancelled by user' },
  };
  taskStore.set(id, task);
  await persistTask(task);

  emitEvent({ type: 'failed', taskId: id, task });
  return true;
}

export async function retryTask(id: string): Promise<Task | null> {
  const task = taskStore.get(id);
  if (!task) return null;

  const retryableStatuses: TaskStatusType[] = ['failed', 'cancelled', 'completed'];
  if (!retryableStatuses.includes(task.status)) return null;

  const newTask = await addTask({
    title: task.title,
    description: task.description,
    prompt: task.prompt,
    priority: task.priority,
    source: task.source,
    sourceId: task.sourceId,
    sourceUrl: task.sourceUrl,
    repository: task.repository,
    branch: task.branch,
    labels: task.labels,
    metadata: {
      ...task.metadata,
      retriedFrom: id,
    },
  });

  return newTask;
}

export async function closeTaskQueue(): Promise<void> {
  processing = false;
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  if (evictionInterval) {
    clearInterval(evictionInterval);
    evictionInterval = null;
  }
  log.info('In-memory queue closed');
}
