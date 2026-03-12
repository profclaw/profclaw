/**
 * Unified Task Queue
 *
 * Delegates to BullMQ (Redis) or in-memory queue based on deployment mode.
 * All consumers import from this module instead of task-queue or memory-queue directly.
 */

import type { Task, TaskResult, CreateTaskInput, TaskStatusType } from '../types/task.js';
import { shouldUseRedis } from '../core/deployment.js';
import { logger } from '../utils/logger.js';

// Queue backend interface
interface QueueBackend {
  initTaskQueue(): Promise<void>;
  addTask(input: CreateTaskInput): Promise<Task>;
  getTask(id: string): Task | undefined;
  getTasks(options?: { status?: TaskStatusType; limit?: number; offset?: number }): Task[];
  onTaskEvent(callback: (event: Record<string, unknown>) => void): () => void;
  registerSSEBroadcaster(broadcaster: (eventType: string, data: Record<string, unknown>) => void): void;
  cancelTask(id: string): Promise<boolean>;
  retryTask(id: string): Promise<Task | null>;
  closeTaskQueue(): Promise<void>;
}

let backend: QueueBackend | null = null;
let backendType: 'redis' | 'memory' | null = null;

async function loadBackend(): Promise<QueueBackend> {
  if (backend) return backend;

  if (shouldUseRedis()) {
    try {
      // Test Redis connectivity before committing
      const IORedis = (await import('ioredis')).default;
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      const testRedis = new IORedis(redisUrl, {
        maxRetriesPerRequest: 1,
        connectTimeout: 5000,
        lazyConnect: true,
      });
      await testRedis.connect();
      await testRedis.ping();
      await testRedis.disconnect();

      backend = await import('./task-queue.js') as unknown as QueueBackend;
      backendType = 'redis';
      console.log('[Queue] Using Redis-backed BullMQ queue');
      return backend;
    } catch (error) {
      if (process.env.PROFCLAW_REQUIRE_REDIS === 'true') {
        console.error('[FATAL] PROFCLAW_REQUIRE_REDIS=true but Redis is unreachable');
        process.exit(1);
      }
      console.log('[Queue] Redis unavailable, falling back to in-memory queue');
    }
  }

  // Fallback: in-memory queue
  backend = await import('./memory-queue.js') as unknown as QueueBackend;
  backendType = 'memory';
  console.log('[Queue] Using in-memory queue (no Redis)');
  return backend;
}

function getBackend(): QueueBackend {
  if (!backend) {
    throw new Error('Queue not initialized. Call initQueue() first.');
  }
  return backend;
}

// -- Public API (matches task-queue.ts exports) --

export async function initQueue(): Promise<void> {
  const b = await loadBackend();
  await b.initTaskQueue();
}

export async function addTask(input: CreateTaskInput): Promise<Task> {
  return getBackend().addTask(input);
}

export function getTask(id: string): Task | undefined {
  return getBackend().getTask(id);
}

export function getTasks(options?: {
  status?: TaskStatusType;
  limit?: number;
  offset?: number;
}): Task[] {
  return getBackend().getTasks(options);
}

export function onTaskEvent(callback: (event: Record<string, unknown>) => void): () => void {
  return getBackend().onTaskEvent(callback);
}

export function registerSSEBroadcaster(
  broadcaster: (eventType: string, data: Record<string, unknown>) => void,
): void {
  getBackend().registerSSEBroadcaster(broadcaster);
}

export async function cancelTask(id: string): Promise<boolean> {
  return getBackend().cancelTask(id);
}

export async function retryTask(id: string): Promise<Task | null> {
  return getBackend().retryTask(id);
}

export async function closeQueue(): Promise<void> {
  if (backend) {
    await backend.closeTaskQueue();
  }
}

/** Get current queue backend type. */
export function getQueueType(): 'redis' | 'memory' | null {
  return backendType;
}
