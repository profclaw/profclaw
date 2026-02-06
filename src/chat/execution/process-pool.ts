/**
 * Process Pool Manager
 *
 * Limits concurrent tool executions to prevent resource exhaustion.
 * Queues excess requests and tracks resource usage.
 */

import { EventEmitter } from 'events';
import { logger } from '../../utils/logger.js';

// Types

export interface PoolConfig {
  maxConcurrent: number;       // Max concurrent executions
  maxQueueSize: number;        // Max pending queue size
  defaultTimeout: number;      // Default timeout per execution (ms)
  maxMemoryMB?: number;        // Optional memory limit per execution
  enableMetrics?: boolean;     // Track execution metrics
}

export interface QueuedExecution {
  id: string;
  toolName: string;
  conversationId: string;
  userId?: string;
  priority: number;            // Higher = more important
  queuedAt: number;
  execute: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId?: NodeJS.Timeout;
}

export interface ActiveExecution {
  id: string;
  toolName: string;
  conversationId: string;
  userId?: string;
  startedAt: number;
  pid?: number;
}

export interface PoolMetrics {
  activeCount: number;
  queuedCount: number;
  totalExecuted: number;
  totalFailed: number;
  totalTimeout: number;
  totalRejected: number;
  avgDurationMs: number;
  peakConcurrent: number;
}

export interface PoolStatus {
  active: ActiveExecution[];
  queuedCount: number;
  metrics: PoolMetrics;
  config: PoolConfig;
}

// Constants (configurable via environment variables)

// Pool limits for I/O-bound chat tool executions
// Override via POOL_MAX_CONCURRENT, POOL_MAX_QUEUE_SIZE, POOL_TIMEOUT_MS, POOL_QUEUE_TIMEOUT_MS
const DEFAULT_MAX_CONCURRENT = parseInt(process.env.POOL_MAX_CONCURRENT || '50', 10);
const DEFAULT_MAX_QUEUE_SIZE = parseInt(process.env.POOL_MAX_QUEUE_SIZE || '200', 10);
const DEFAULT_TIMEOUT_MS = parseInt(process.env.POOL_TIMEOUT_MS || '300000', 10); // 5 minutes
const QUEUE_TIMEOUT_MS = parseInt(process.env.POOL_QUEUE_TIMEOUT_MS || '30000', 10); // 30 seconds

// Process Pool

export class ProcessPool extends EventEmitter {
  private config: PoolConfig;
  private active: Map<string, ActiveExecution> = new Map();
  private queue: QueuedExecution[] = [];
  private metrics: PoolMetrics;

  constructor(config?: Partial<PoolConfig>) {
    super();
    this.config = {
      maxConcurrent: config?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
      maxQueueSize: config?.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE,
      defaultTimeout: config?.defaultTimeout ?? DEFAULT_TIMEOUT_MS,
      maxMemoryMB: config?.maxMemoryMB,
      enableMetrics: config?.enableMetrics ?? true,
    };

    this.metrics = {
      activeCount: 0,
      queuedCount: 0,
      totalExecuted: 0,
      totalFailed: 0,
      totalTimeout: 0,
      totalRejected: 0,
      avgDurationMs: 0,
      peakConcurrent: 0,
    };
  }

  /**
   * Submit an execution to the pool
   */
  async submit<T>(
    id: string,
    toolName: string,
    conversationId: string,
    execute: () => Promise<T>,
    options?: {
      userId?: string;
      priority?: number;
      timeout?: number;
    },
  ): Promise<T> {
    // Check if we can execute immediately
    if (this.active.size < this.config.maxConcurrent) {
      return this.executeNow(id, toolName, conversationId, execute, options);
    }

    // Check queue capacity
    if (this.queue.length >= this.config.maxQueueSize) {
      this.metrics.totalRejected++;
      throw new PoolFullError(
        `Pool queue full (${this.queue.length}/${this.config.maxQueueSize}). Try again later.`
      );
    }

    // Queue the execution
    return this.queueExecution(id, toolName, conversationId, execute, options);
  }

  /**
   * Cancel a queued or active execution
   */
  cancel(id: string): boolean {
    // Check queue first
    const queueIndex = this.queue.findIndex(q => q.id === id);
    if (queueIndex !== -1) {
      const queued = this.queue[queueIndex];
      if (queued.timeoutId) clearTimeout(queued.timeoutId);
      this.queue.splice(queueIndex, 1);
      this.metrics.queuedCount = this.queue.length;
      queued.reject(new Error('Execution cancelled'));
      return true;
    }

    // Check active - can't cancel active without process handle
    const active = this.active.get(id);
    if (active) {
      logger.warn(`[Pool] Cannot cancel active execution ${id} (no process handle)`, { component: 'ProcessPool' });
      return false;
    }

    return false;
  }

  /**
   * Get pool status
   */
  getStatus(): PoolStatus {
    return {
      active: Array.from(this.active.values()),
      queuedCount: this.queue.length,
      metrics: { ...this.metrics },
      config: { ...this.config },
    };
  }

  /**
   * Get metrics
   */
  getMetrics(): PoolMetrics {
    return {
      ...this.metrics,
      activeCount: this.active.size,
      queuedCount: this.queue.length,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<PoolConfig>): void {
    this.config = { ...this.config, ...updates };
    logger.info('[Pool] Config updated', { component: 'ProcessPool', config: this.config });

    // Process queue if capacity increased
    this.processQueue();
  }

  /**
   * Check if pool has capacity
   */
  hasCapacity(): boolean {
    return this.active.size < this.config.maxConcurrent;
  }

  /**
   * Get current load percentage
   */
  getLoad(): number {
    return (this.active.size / this.config.maxConcurrent) * 100;
  }

  /**
   * Clear the queue (reject all pending)
   */
  clearQueue(): number {
    const count = this.queue.length;
    for (const queued of this.queue) {
      if (queued.timeoutId) clearTimeout(queued.timeoutId);
      queued.reject(new Error('Queue cleared'));
    }
    this.queue = [];
    this.metrics.queuedCount = 0;
    return count;
  }

  // Private Methods

  private async executeNow<T>(
    id: string,
    toolName: string,
    conversationId: string,
    execute: () => Promise<T>,
    options?: {
      userId?: string;
      priority?: number;
      timeout?: number;
    },
  ): Promise<T> {
    const startTime = Date.now();

    // Track active execution
    const activeExec: ActiveExecution = {
      id,
      toolName,
      conversationId,
      userId: options?.userId,
      startedAt: startTime,
    };
    this.active.set(id, activeExec);
    this.metrics.activeCount = this.active.size;

    // Update peak
    if (this.active.size > this.metrics.peakConcurrent) {
      this.metrics.peakConcurrent = this.active.size;
    }

    this.emit('execution:start', activeExec);

    try {
      // Execute with timeout
      const timeout = options?.timeout ?? this.config.defaultTimeout;
      const result = await this.withTimeout(execute(), timeout, id);

      // Update metrics
      const duration = Date.now() - startTime;
      this.updateDurationMetric(duration);
      this.metrics.totalExecuted++;

      this.emit('execution:complete', { id, duration, success: true });

      return result;
    } catch (error) {
      if (error instanceof TimeoutError) {
        this.metrics.totalTimeout++;
      } else {
        this.metrics.totalFailed++;
      }

      this.emit('execution:complete', { id, success: false, error });
      throw error;
    } finally {
      this.active.delete(id);
      this.metrics.activeCount = this.active.size;

      // Process next in queue
      this.processQueue();
    }
  }

  private queueExecution<T>(
    id: string,
    toolName: string,
    conversationId: string,
    execute: () => Promise<T>,
    options?: {
      userId?: string;
      priority?: number;
      timeout?: number;
    },
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const queued: QueuedExecution = {
        id,
        toolName,
        conversationId,
        userId: options?.userId,
        priority: options?.priority ?? 0,
        queuedAt: Date.now(),
        execute: execute as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      };

      // Set queue timeout
      queued.timeoutId = setTimeout(() => {
        const index = this.queue.findIndex(q => q.id === id);
        if (index !== -1) {
          this.queue.splice(index, 1);
          this.metrics.queuedCount = this.queue.length;
          this.metrics.totalTimeout++;
          reject(new QueueTimeoutError(`Execution ${id} timed out waiting in queue`));
        }
      }, QUEUE_TIMEOUT_MS);

      // Insert by priority (higher priority = earlier in queue)
      const insertIndex = this.queue.findIndex(q => q.priority < queued.priority);
      if (insertIndex === -1) {
        this.queue.push(queued);
      } else {
        this.queue.splice(insertIndex, 0, queued);
      }

      this.metrics.queuedCount = this.queue.length;

      logger.debug(`[Pool] Queued execution ${id} (queue size: ${this.queue.length})`, { component: 'ProcessPool' });
      this.emit('execution:queued', { id, position: this.queue.length });
    });
  }

  private processQueue(): void {
    while (this.active.size < this.config.maxConcurrent && this.queue.length > 0) {
      const queued = this.queue.shift()!;
      if (queued.timeoutId) clearTimeout(queued.timeoutId);
      this.metrics.queuedCount = this.queue.length;

      // Execute and resolve/reject the promise
      this.executeNow(
        queued.id,
        queued.toolName,
        queued.conversationId,
        queued.execute,
        { userId: queued.userId, priority: queued.priority },
      )
        .then(queued.resolve)
        .catch(queued.reject);
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, id: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new TimeoutError(`Execution ${id} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      promise
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  private updateDurationMetric(duration: number): void {
    const total = this.metrics.totalExecuted;
    if (total === 0) {
      this.metrics.avgDurationMs = duration;
    } else {
      // Running average
      this.metrics.avgDurationMs =
        (this.metrics.avgDurationMs * total + duration) / (total + 1);
    }
  }
}

// Error Classes

export class PoolFullError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PoolFullError';
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class QueueTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueueTimeoutError';
  }
}

// Singleton

let processPool: ProcessPool | null = null;

export function getProcessPool(): ProcessPool {
  if (!processPool) {
    processPool = new ProcessPool();
  }
  return processPool;
}

export function initProcessPool(config?: Partial<PoolConfig>): ProcessPool {
  processPool = new ProcessPool(config);
  return processPool;
}
