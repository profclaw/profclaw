import { Queue, Worker, Job } from "bullmq";
import type {
  Task,
  TaskResult,
  CreateTaskInput,
  TaskStatusType,
} from "../types/task.js";
import { getAgentRegistry } from "../adapters/registry.js";
import { randomUUID } from "crypto";
import { postResultToSource } from "./notifications.js";
import { createTaskNotification } from "../notifications/in-app.js";
import { extractFromTaskResult, createSummary } from "../summaries/index.js";
import { createContextualLogger } from "../utils/logger.js";

const log = createContextualLogger('TaskQueue');
import { getStorage, initStorage } from "../storage/index.js";
import {
  handleTaskFailure,
  setTaskQueueRef,
  initDeadLetterQueue,
} from "./failure-handler.js";

/**
 * Task Queue Manager
 *
 * Uses BullMQ (Redis-backed) for reliable task queuing with:
 * - Priority-based processing
 * - Retries with exponential backoff
 * - Progress tracking
 * - Result storage
 */

import { loadConfig } from "../utils/config-loader.js";

interface SettingsYaml {
  queue: {
    name: string;
    notificationName: string;
    concurrency: number;
    notificationConcurrency: number;
    redis: {
      url: string;
    };
    retry: {
      attempts: number;
      backoff: number;
      type: "exponential" | "fixed";
    };
  };
}

const settings = loadConfig<SettingsYaml>("settings.yml");

const QUEUE_NAME = settings.queue?.name || "ai-tasks";
const NOTIFICATION_QUEUE_NAME =
  settings.queue?.notificationName || "ai-task-notifications";
const REDIS_URL =
  process.env.REDIS_URL ||
  settings.queue?.redis?.url ||
  "redis://localhost:6379";

// Connection config
const connection = {
  host: new URL(REDIS_URL).hostname,
  port: parseInt(new URL(REDIS_URL).port || "6379"),
  password: new URL(REDIS_URL).password || undefined,
};

// Task queue instance
let taskQueue: Queue<Task> | null = null;
let taskWorker: Worker<Task, TaskResult> | null = null;

// Notification queue instance
let notificationQueue: Queue<{ task: Task; result: TaskResult }> | null = null;
let notificationWorker: Worker<
  { task: Task; result: TaskResult },
  void
> | null = null;

// In-memory task store (cache, synced with DB)
const taskStore = new Map<string, Task>();
const eventCallbacks = new Map<string, (event: TaskEvent) => void>();

/**
 * Ensure a value is a Date object (handles ISO strings from BullMQ)
 */
function ensureDate(value: Date | string | undefined): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  return new Date(value);
}

/**
 * Persist task to database (async, non-blocking)
 */
async function persistTask(task: Task): Promise<void> {
  try {
    const storage = getStorage();

    // Ensure date fields are proper Date objects (BullMQ serializes to strings)
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

/**
 * Load tasks from database into memory cache
 */
async function loadTasksFromDB(): Promise<void> {
  try {
    const storage = getStorage();
    const { tasks } = await storage.getTasks({ limit: 10000 });
    for (const task of tasks) {
      taskStore.set(task.id, task);
    }
    log.info('Loaded tasks from database', { count: tasks.length });
  } catch (error) {
    log.warn('Failed to load tasks from DB, starting fresh', { error: error instanceof Error ? error.message : String(error) });
  }
}

interface TaskEvent {
  type: "created" | "queued" | "started" | "progress" | "completed" | "failed";
  taskId: string;
  task: Task;
  result?: TaskResult;
  progress?: number;
}

/**
 * Initialize the task queue
 */
export async function initTaskQueue(): Promise<void> {
  // Ensure storage is initialized before accessing DB
  await initStorage();

  // Load existing tasks from database
  await loadTasksFromDB();

  // Initialize dead letter queue table
  await initDeadLetterQueue();

  // Create queue
  taskQueue = new Queue<Task>(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: settings.queue?.retry?.attempts || 3,
      backoff: {
        type: settings.queue?.retry?.type || "exponential",
        delay: settings.queue?.retry?.backoff || 5000,
      },
      removeOnComplete: {
        age: 86400, // Keep completed jobs for 24 hours
        count: 1000,
      },
      removeOnFail: {
        age: 604800, // Keep failed jobs for 7 days
      },
    },
  });

  // Create worker
  taskWorker = new Worker<Task, TaskResult>(
    QUEUE_NAME,
    async (job: Job<Task>) => {
      return processTask(job);
    },
    {
      connection,
      concurrency:
        parseInt(process.env.TASK_CONCURRENCY || "") ||
        settings.queue?.concurrency ||
        2,
    },
  );

  // Set up event handlers
  taskWorker.on("completed", async (job, result) => {
    const task = taskStore.get(job.data.id);
    if (task) {
      task.status = "completed";
      task.completedAt = new Date();
      task.result = result;
      taskStore.set(task.id, task);
      await persistTask(task); // Persist to DB

      emitEvent({
        type: "completed",
        taskId: task.id,
        task,
        result,
      });
    }
    log.info('Task completed', { taskId: job.data.id });
  });

  taskWorker.on("failed", async (job, err) => {
    if (!job) return;
    const task = taskStore.get(job.data.id) || job.data;

    // Use failure handler for retry logic and DLQ management
    try {
      await handleTaskFailure(task, err);
    } catch (handlerError) {
      log.error('Failure handler error', { taskId: task.id, error: handlerError instanceof Error ? handlerError.message : String(handlerError) });
    }

    // Update local state
    if (task.attempts >= task.maxAttempts) {
      task.status = "failed";
      task.result = {
        success: false,
        output: "",
        error: {
          code: "TASK_FAILED",
          message: err.message,
          stack: err.stack,
        },
      };
      taskStore.set(task.id, task);
      await persistTask(task); // Persist to DB

      emitEvent({
        type: "failed",
        taskId: task.id,
        task,
        result: task.result,
      });
    }

    log.error('Task failed', { taskId: job.data.id, attempt: task.attempts, maxAttempts: task.maxAttempts, error: err.message });
  });

  taskWorker.on("progress", (job, progress) => {
    const task = taskStore.get(job.data.id);
    if (task) {
      emitEvent({
        type: "progress",
        taskId: task.id,
        task,
        progress: progress as number,
      });
    }
  });

  // Set queue reference for failure handler (enables delayed retries)
  setTaskQueueRef(taskQueue);

  // Create notification queue
  notificationQueue = new Queue(NOTIFICATION_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  });

  // Create notification worker
  notificationWorker = new Worker(
    NOTIFICATION_QUEUE_NAME,
    async (job) => {
      const { task, result } = job.data;
      await postResultToSource(task, result);
    },
    {
      connection,
      concurrency: 5, // Higher concurrency for IO bound tasks
    },
  );

  log.info('Task queue initialized');
}

/**
 * Process a task
 */
export async function processTask(job: Job<Task>): Promise<TaskResult> {
  const task = job.data;

  log.info('Processing task', { taskId: task.id, title: task.title });

  // Update status
  task.status = "in_progress";
  task.startedAt = new Date();
  taskStore.set(task.id, task);
  persistTask(task); // Persist to DB

  emitEvent({
    type: "started",
    taskId: task.id,
    task,
  });

  // Get the agent registry
  const registry = getAgentRegistry();

  // Find appropriate adapter
  const adapter = registry.findAdapterForTask(task);

  if (!adapter) {
    throw new Error("No suitable agent adapter found for task");
  }

  log.info('Using adapter', { adapter: adapter.name });

  // Execute the task
  const result = await adapter.executeTask(task);

  // Update task with result
  task.result = result;

  if (result.success) {
    // 1. Create structured summary
    try {
      const summaryInput = await extractFromTaskResult(result, {
        taskId: task.id,
        agent: adapter.type,
        model: result.metadata?.model as string,
        startedAt: task.startedAt,
      });
      await createSummary(summaryInput);
    } catch (error) {
      log.error('Failed to create summary', { taskId: task.id, error: error instanceof Error ? error.message : String(error) });
    }

    // 2. Post results back to source (e.g., GitHub comment)
    if (notificationQueue) {
      await notificationQueue.add("notify-source", { task, result });
    } else {
      log.warn('Notification queue not initialized, falling back to direct call');
      // Fallback for safety/testing without queue init
      await postResultToSource(task, result);
    }
  }

  return result;
}

/**
 * Add a new task to the queue
 */
export async function addTask(input: CreateTaskInput): Promise<Task> {
  if (!taskQueue) {
    throw new Error("Task queue not initialized");
  }

  // Create full task object with defaults for optional fields
  const task: Task = {
    ...input,
    labels: input.labels ?? [],
    metadata: input.metadata ?? {},
    id: randomUUID(),
    status: "pending",
    createdAt: new Date(),
    updatedAt: new Date(),
    attempts: 0,
    maxAttempts: 3,
  };

  // Store task in memory
  taskStore.set(task.id, task);

  // Persist to DB FIRST (before adding to queue to avoid race condition)
  await persistTask(task);

  emitEvent({
    type: "created",
    taskId: task.id,
    task,
  });

  // Add to queue with priority
  await taskQueue.add(task.id, task, {
    priority: task.priority,
    jobId: task.id,
  });

  task.status = "queued";
  taskStore.set(task.id, task);
  await persistTask(task); // Update status in DB

  emitEvent({
    type: "queued",
    taskId: task.id,
    task,
  });

  log.info('Task added to queue', { taskId: task.id });

  return task;
}

/**
 * Get task by ID
 */
export function getTask(id: string): Task | undefined {
  return taskStore.get(id);
}

/**
 * Get all tasks (paginated)
 */
export function getTasks(options?: {
  status?: TaskStatusType;
  limit?: number;
  offset?: number;
}): Task[] {
  let tasks = Array.from(taskStore.values());

  // Filter by status
  if (options?.status) {
    tasks = tasks.filter((t) => t.status === options.status);
  }

  // Sort by created date (newest first)
  // Handle both Date objects and ISO strings
  tasks.sort((a, b) => {
    const dateA =
      a.createdAt instanceof Date
        ? a.createdAt.getTime()
        : new Date(a.createdAt).getTime();
    const dateB =
      b.createdAt instanceof Date
        ? b.createdAt.getTime()
        : new Date(b.createdAt).getTime();
    return dateB - dateA;
  });

  // Paginate
  const offset = options?.offset || 0;
  const limit = options?.limit || 50;
  return tasks.slice(offset, offset + limit);
}

/**
 * Subscribe to task events
 */
export function onTaskEvent(callback: (event: TaskEvent) => void): () => void {
  const id = randomUUID();
  eventCallbacks.set(id, callback);
  return () => eventCallbacks.delete(id);
}

// SSE broadcast callback (set from server.ts)
let sseBroadcaster: ((eventType: string, data: Record<string, unknown>) => void) | null = null;

/**
 * Register SSE broadcaster for real-time updates
 */
export function registerSSEBroadcaster(
  broadcaster: (eventType: string, data: Record<string, unknown>) => void,
): void {
  sseBroadcaster = broadcaster;
}

/**
 * Emit event to all subscribers and SSE
 */
function emitEvent(event: TaskEvent): void {
  // Call registered callbacks
  for (const callback of eventCallbacks.values()) {
    try {
      callback(event);
    } catch (error) {
      log.error('Error in event callback', error instanceof Error ? error : new Error(String(error)));
    }
  }

  // Broadcast to SSE clients
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

  // Write to notifications DB for bell dropdown
  if (event.type === 'completed' || event.type === 'failed') {
    createTaskNotification(event).then((id: string | null) => {
      if (id && sseBroadcaster) sseBroadcaster('notification:new', { id });
    }).catch((err: unknown) => log.error('Notification creation failed', err instanceof Error ? err : new Error(String(err))));
  }
}

/**
 * Cancel a running task
 */
export async function cancelTask(id: string): Promise<boolean> {
  const task = taskStore.get(id);
  if (!task) return false;

  // Can only cancel pending, queued, assigned, or in_progress tasks
  const cancellableStatuses: TaskStatusType[] = [
    "pending",
    "queued",
    "assigned",
    "in_progress",
  ];
  if (!cancellableStatuses.includes(task.status)) {
    return false;
  }

  // Update task status
  task.status = "cancelled";
  task.completedAt = new Date();
  task.result = {
    success: false,
    output: "Task was cancelled by user",
    error: {
      code: "CANCELLED",
      message: "Task cancelled by user",
    },
  };
  taskStore.set(id, task);
  await persistTask(task); // Persist cancellation to DB

  // Try to remove from BullMQ if pending
  if (taskQueue) {
    try {
      const job = await taskQueue.getJob(id);
      if (job) {
        await job.remove();
      }
    } catch {
      // Job may already be processing
    }
  }

  emitEvent({ type: "failed", taskId: id, task });
  return true;
}

/**
 * Retry a failed task
 */
export async function retryTask(id: string): Promise<Task | null> {
  const task = taskStore.get(id);
  if (!task) return null;

  // Can retry failed, cancelled, or completed tasks
  const retryableStatuses: TaskStatusType[] = [
    "failed",
    "cancelled",
    "completed",
  ];
  if (!retryableStatuses.includes(task.status)) {
    return null;
  }

  // Create a new task with same input
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

/**
 * Close the queue (for graceful shutdown)
 */
export async function closeTaskQueue(): Promise<void> {
  if (taskWorker) {
    await taskWorker.close();
    taskWorker = null;
  }
  if (taskQueue) {
    await taskQueue.close();
    taskQueue = null;
  }
  if (notificationWorker) {
    await notificationWorker.close();
    notificationWorker = null;
  }
  if (notificationQueue) {
    await notificationQueue.close();
    notificationQueue = null;
  }
  log.info('Task queue closed');
}
