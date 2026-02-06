/**
 * E2E Test: Task Failure Handling
 *
 * Tests end-to-end flow of task failures including:
 * - Task execution failures
 * - Retry logic with exponential backoff
 * - Dead letter queue handling
 * - Error recovery and graceful degradation
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { initTaskQueue, addTask, getTask, closeTaskQueue } from './task-queue.js';
import { handleTaskFailure, getDeadLetterQueue, removeFromDeadLetterQueue, retryDeadLetterTask } from './failure-handler.js';
import { TaskSource, TaskStatus, type Task, type CreateTaskInput } from '../types/task.js';
import { getAgentRegistry } from '../adapters/registry.js';
import type { AgentAdapter } from '../types/agent.js';

// Mock Redis by using in-memory queue for testing
vi.mock('bullmq', () => {
  const queues = new Map();

  class MockQueue {
    name: string;
    jobs: unknown[];

    constructor(name: string) {
      this.name = name;
      this.jobs = [];
      queues.set(name, this);
    }

    async add(jobId: string, data: unknown, options?: unknown) {
      const job = {
        id: jobId,
        data,
        opts: options,
        attemptsMade: 0,
        processedOn: Date.now(),
      };
      this.jobs.push(job);
      return job;
    }

    async close() {}

    async getJobs() {
      return this.jobs;
    }
  }

  class MockWorker {
    name: string;
    callbacks: Map<string, (...args: unknown[]) => void>;

    constructor(name: string, processor: unknown, options?: unknown) {
      this.name = name;
      this.callbacks = new Map();
    }

    on(event: string, callback: (...args: unknown[]) => void) {
      this.callbacks.set(event, callback);
      return this;
    }

    async close() {}

    async run() {}
  }

  return {
    Queue: MockQueue,
    Worker: MockWorker,
    Job: vi.fn(),
  };
});

// Mock Slack notifications to avoid external calls
vi.mock('../notifications/slack.js', () => ({
  sendSlackNotification: vi.fn(async () => {}),
}));

// In-memory DLQ storage for E2E tests
const dlqStore: Map<string, any> = new Map();

// Mock storage for DLQ persistence
vi.mock('../storage/index.js', () => ({
  initStorage: vi.fn().mockResolvedValue(undefined),
  getStorage: () => ({
    execute: vi.fn(async (sql: string, params?: any[]) => {
      if (sql.includes('INSERT INTO dead_letter_tasks')) {
        const [id, taskId, title, description, prompt, source, sourceId, sourceUrl,
          repository, branch, labels, assignedAgent, priority, attempts, maxAttempts,
          lastErrorCode, lastErrorMessage, lastErrorStack, status, metadata] = params || [];
        dlqStore.set(taskId, {
          id, task_id: taskId, title, description, prompt, source, source_id: sourceId,
          source_url: sourceUrl, repository, branch, labels, assigned_agent: assignedAgent,
          priority, attempts, max_attempts: maxAttempts, last_error_code: lastErrorCode,
          last_error_message: lastErrorMessage, last_error_stack: lastErrorStack,
          retry_count: 0, status, metadata, created_at: Math.floor(Date.now() / 1000),
        });
      }
      if (sql.includes('UPDATE dead_letter_tasks') && sql.includes("status = 'resolved'")) {
        // Handle both remove (dlqId at index 2) and retry (dlqId at last position)
        const dlqId = params?.length === 1 ? params[0] : params?.[params.length - 1];
        for (const [taskId, entry] of dlqStore.entries()) {
          if (entry.id === dlqId || taskId === dlqId) {
            dlqStore.delete(taskId);
            break;
          }
        }
      }
      return undefined;
    }),
    query: vi.fn(async (sql: string, params?: any[]) => {
      if (sql.includes('COUNT(*)')) {
        return [{ count: dlqStore.size }];
      }
      if (sql.includes('SELECT * FROM dead_letter_tasks WHERE status')) {
        return Array.from(dlqStore.values());
      }
      if (sql.includes('SELECT * FROM dead_letter_tasks WHERE id')) {
        const id = params?.[0];
        for (const entry of dlqStore.values()) {
          if (entry.id === id) return [entry];
        }
        return [];
      }
      return [];
    }),
    getTask: vi.fn().mockResolvedValue(null),
    createTask: vi.fn().mockResolvedValue(undefined),
    updateTask: vi.fn().mockResolvedValue(undefined),
    getTasks: vi.fn().mockResolvedValue({ tasks: [], total: 0 }),
  }),
}));

// Mock GitHub fetch for failure comments
global.fetch = vi.fn();

describe('E2E: Task Failure Handling', () => {
  let mockFailingAdapter: AgentAdapter;
  let mockRecoveringAdapter: AgentAdapter;

  beforeAll(async () => {
    // Initialize the task queue with test configuration
    await initTaskQueue();
  });

  afterAll(async () => {
    // Clean up
    await closeTaskQueue();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    dlqStore.clear(); // Clear in-memory DLQ store

    // Create a mock adapter that always fails
    mockFailingAdapter = {
      type: 'openclaw',
      name: 'Failing Test Adapter',
      capabilities: ['code_generation'],
      healthCheck: vi.fn(async () => ({
        healthy: true,
        message: 'Healthy',
        latencyMs: 10,
        lastChecked: new Date(),
      })),
      executeTask: vi.fn(async () => {
        throw new Error('Simulated task execution failure');
      }),
    };

    // Create a mock adapter that fails initially but succeeds on retry
    let attemptCount = 0;
    mockRecoveringAdapter = {
      type: 'openclaw',
      name: 'Recovering Test Adapter',
      capabilities: ['code_generation'],
      healthCheck: vi.fn(async () => ({
        healthy: true,
        message: 'Healthy',
        latencyMs: 10,
        lastChecked: new Date(),
      })),
      executeTask: vi.fn(async (task) => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Temporary failure, will recover');
        }
        return {
          success: true,
          output: 'Task completed successfully on retry',
          duration: 1000,
        };
      }),
    };
  });

  describe('Task Execution Failure', () => {
    it('should handle a task that fails gracefully', async () => {
      const taskInput: CreateTaskInput = {
        title: 'Test failing task',
        description: 'This task is designed to fail',
        prompt: 'Execute a task that will fail',
        priority: 2,
        source: TaskSource.API,
        sourceId: 'test-fail-001',
        metadata: { testCase: 'graceful_failure' },
      };

      // Add task to queue
      const task = await addTask(taskInput);

      expect(task.id).toBeDefined();
      expect(task.status).toBe(TaskStatus.QUEUED);
      expect(task.attempts).toBe(0);

      // Simulate task execution failure
      const error = new Error('Simulated task execution failure');
      await handleTaskFailure(task, error);

      // Verify task attempts were incremented
      expect(task.attempts).toBe(1);

      // Task should not yet be in dead letter queue (has retries remaining)
      const dlq = await getDeadLetterQueue();
      expect(dlq.tasks.find(t => t.taskId === task.id)).toBeUndefined();
    });

    it('should retry task with exponential backoff', async () => {
      const taskInput: CreateTaskInput = {
        title: 'Test retry logic',
        description: 'Task to test retry behavior',
        prompt: 'Execute task with retries',
        priority: 2,
        source: TaskSource.GITHUB_ISSUE,
        sourceId: 'test-retry-001',
        repository: 'test-org/test-repo',
      };

      const task = await addTask(taskInput);
      const error = new Error('First attempt failure');

      // First failure
      await handleTaskFailure(task, error);
      expect(task.attempts).toBe(1);

      // Second failure
      await handleTaskFailure(task, error);
      expect(task.attempts).toBe(2);

      // Should still not be in DLQ (maxAttempts is 3 by default)
      const dlq = await getDeadLetterQueue();
      expect(dlq.tasks.find(t => t.taskId === task.id)).toBeUndefined();
    });

    it('should move task to dead letter queue after max retries', async () => {
      // Set GitHub token for this test
      const originalToken = process.env.GITHUB_TOKEN;
      process.env.GITHUB_TOKEN = 'test-token-123';

      const taskInput: CreateTaskInput = {
        title: 'Test max retries exceeded',
        description: 'Task that will exhaust all retries',
        prompt: 'Execute task that keeps failing',
        priority: 1,
        source: TaskSource.GITHUB_ISSUE,
        sourceId: '123',
        sourceUrl: 'https://github.com/test-org/test-repo/issues/123',
        repository: 'test-org/test-repo',
      };

      const task = await addTask(taskInput);
      const error = new Error('Persistent failure');

      // Mock GitHub fetch for failure comment
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 1 }),
      } as Response);

      // Fail maxAttempts times
      for (let i = 0; i < task.maxAttempts; i++) {
        await handleTaskFailure(task, error);
      }

      // Task should now be in dead letter queue
      const dlq = await getDeadLetterQueue();
      const dlqTask = dlq.tasks.find(t => t.taskId === task.id);

      expect(dlqTask).toBeDefined();
      expect(dlqTask?.status).toBe('pending'); // DLQ status is 'pending' initially
      expect(dlqTask?.attempts).toBe(task.maxAttempts);
      expect(dlqTask?.lastErrorCode).toBe('MAX_RETRIES_EXCEEDED');
      expect(dlqTask?.lastErrorMessage).toContain('Persistent failure');

      // Verify GitHub comment was posted
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://api.github.com/repos/test-org/test-repo/issues/123/comments'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );

      // Restore original token
      if (originalToken !== undefined) {
        process.env.GITHUB_TOKEN = originalToken;
      } else {
        delete process.env.GITHUB_TOKEN;
      }
    });
  });

  describe('Dead Letter Queue Management', () => {
    it('should retrieve tasks from dead letter queue', async () => {
      const taskInput: CreateTaskInput = {
        title: 'DLQ test task',
        description: 'Task for DLQ testing',
        prompt: 'Test DLQ retrieval',
        priority: 3,
        source: TaskSource.JIRA,
        sourceId: 'PROJ-456',
      };

      const task = await addTask(taskInput);
      const error = new Error('Force into DLQ');

      // Fail maxAttempts times to move to DLQ
      for (let i = 0; i < task.maxAttempts; i++) {
        await handleTaskFailure(task, error);
      }

      const dlq = await getDeadLetterQueue();
      expect(dlq.tasks.length).toBeGreaterThan(0);

      const foundTask = dlq.tasks.find(t => t.taskId === task.id);
      expect(foundTask).toBeDefined();
      expect(foundTask?.title).toBe('DLQ test task');
    });

    it('should remove task from dead letter queue', async () => {
      const taskInput: CreateTaskInput = {
        title: 'Test DLQ removal',
        description: 'Task to test removal from DLQ',
        prompt: 'Remove from DLQ',
        priority: 2,
        source: TaskSource.API,
      };

      const task = await addTask(taskInput);
      const error = new Error('Force into DLQ for removal test');

      // Move to DLQ
      for (let i = 0; i < task.maxAttempts; i++) {
        await handleTaskFailure(task, error);
      }

      // Verify it's in DLQ
      let dlq = await getDeadLetterQueue();
      const dlqEntry = dlq.tasks.find(t => t.taskId === task.id);
      expect(dlqEntry).toBeDefined();

      // Remove from DLQ
      const removed = await removeFromDeadLetterQueue(dlqEntry!.id);
      expect(removed).toBe(true);

      // Verify it's no longer in DLQ
      dlq = await getDeadLetterQueue();
      expect(dlq.tasks.find(t => t.taskId === task.id)).toBeUndefined();
    });

    it('should retry task from dead letter queue', async () => {
      const taskInput: CreateTaskInput = {
        title: 'Test DLQ retry',
        description: 'Task to test retry from DLQ',
        prompt: 'Retry from DLQ',
        priority: 2,
        source: TaskSource.LINEAR,
        sourceId: 'LIN-789',
      };

      const task = await addTask(taskInput);
      const error = new Error('Force into DLQ for retry test');

      // Move to DLQ
      for (let i = 0; i < task.maxAttempts; i++) {
        await handleTaskFailure(task, error);
      }

      // Verify task is in DLQ with pending status (DLQ status, not task status)
      let dlq = await getDeadLetterQueue();
      const dlqTask = dlq.tasks.find(t => t.taskId === task.id);
      expect(dlqTask?.status).toBe('pending');
      expect(dlqTask?.attempts).toBe(task.maxAttempts);

      // Retry from DLQ
      const retried = await retryDeadLetterTask(dlqTask!.id);
      expect(retried).toBe(true);

      // Verify task is no longer in DLQ (marked as resolved)
      dlq = await getDeadLetterQueue();
      expect(dlq.tasks.find(t => t.taskId === task.id)).toBeUndefined();
    });
  });

  describe('Error Recovery', () => {
    it('should handle network timeout errors', async () => {
      const taskInput: CreateTaskInput = {
        title: 'Test network timeout',
        description: 'Simulate network timeout',
        prompt: 'Task with network timeout',
        priority: 2,
        source: TaskSource.API,
      };

      const task = await addTask(taskInput);
      const error = new Error('Network timeout after 30s');
      error.name = 'TimeoutError';

      await handleTaskFailure(task, error);

      expect(task.attempts).toBe(1);
      // Should be scheduled for retry, not in DLQ
      const dlq = await getDeadLetterQueue();
      expect(dlq.tasks.find(t => t.taskId === task.id)).toBeUndefined();
    });

    it('should handle adapter unavailable errors', async () => {
      const taskInput: CreateTaskInput = {
        title: 'Test adapter unavailable',
        description: 'Simulate adapter being down',
        prompt: 'Task with unavailable adapter',
        priority: 1,
        source: TaskSource.GITHUB_PR,
        sourceId: '42',
        repository: 'test-org/test-repo',
      };

      const task = await addTask(taskInput);
      const error = new Error('Agent adapter is currently unavailable');

      await handleTaskFailure(task, error);

      expect(task.attempts).toBe(1);
      // Should retry since adapter might come back
      const dlq = await getDeadLetterQueue();
      expect(dlq.tasks.find(t => t.taskId === task.id)).toBeUndefined();
    });

    it('should handle validation errors gracefully', async () => {
      const taskInput: CreateTaskInput = {
        title: 'Test validation error',
        description: 'Invalid task configuration',
        prompt: 'Task with validation issues',
        priority: 3,
        source: TaskSource.API,
      };

      const task = await addTask(taskInput);
      const error = new Error('Task validation failed: missing required field');
      error.name = 'ValidationError';

      // Validation errors might be unrecoverable, but still handled gracefully
      await handleTaskFailure(task, error);

      expect(task.attempts).toBe(1);
    });
  });

  describe('GitHub Integration Failures', () => {
    it('should handle GitHub API errors when posting failure comment', async () => {
      const taskInput: CreateTaskInput = {
        title: 'Test GitHub API failure',
        description: 'Test handling of GitHub API errors',
        prompt: 'Task with GitHub API failure',
        priority: 2,
        source: TaskSource.GITHUB_ISSUE,
        sourceId: '999',
        sourceUrl: 'https://github.com/test-org/test-repo/issues/999',
        repository: 'test-org/test-repo',
      };

      const task = await addTask(taskInput);
      const error = new Error('Task execution failed');

      // Mock GitHub API failure
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('GitHub API rate limit exceeded')
      );

      // Fail maxAttempts times
      for (let i = 0; i < task.maxAttempts; i++) {
        await handleTaskFailure(task, error);
      }

      // Task should still be in DLQ even if GitHub comment failed
      const dlq = await getDeadLetterQueue();
      expect(dlq.tasks.find(t => t.taskId === task.id)).toBeDefined();
    });

    it('should skip GitHub comment for non-GitHub tasks', async () => {
      const taskInput: CreateTaskInput = {
        title: 'Non-GitHub task',
        description: 'Task from Jira',
        prompt: 'Jira task that fails',
        priority: 2,
        source: TaskSource.JIRA,
        sourceId: 'PROJ-123',
      };

      const task = await addTask(taskInput);
      const error = new Error('Task failed');

      const fetchSpy = global.fetch as ReturnType<typeof vi.fn>;
      fetchSpy.mockClear();

      // Fail maxAttempts times
      for (let i = 0; i < task.maxAttempts; i++) {
        await handleTaskFailure(task, error);
      }

      // GitHub API should not have been called
      expect(fetchSpy).not.toHaveBeenCalled();

      // Task should still be in DLQ
      const dlq = await getDeadLetterQueue();
      expect(dlq.tasks.find(t => t.taskId === task.id)).toBeDefined();
    });
  });

  describe('Concurrent Failure Handling', () => {
    it('should handle multiple concurrent task failures', async () => {
      const tasks = await Promise.all([
        addTask({
          title: 'Concurrent task 1',
          prompt: 'Task 1',
          priority: 2,
          source: TaskSource.API,
        }),
        addTask({
          title: 'Concurrent task 2',
          prompt: 'Task 2',
          priority: 2,
          source: TaskSource.API,
        }),
        addTask({
          title: 'Concurrent task 3',
          prompt: 'Task 3',
          priority: 2,
          source: TaskSource.API,
        }),
      ]);

      const error = new Error('Concurrent failure');

      // Fail all tasks concurrently
      await Promise.all(
        tasks.map(task =>
          (async () => {
            for (let i = 0; i < task.maxAttempts; i++) {
              await handleTaskFailure(task, error);
            }
          })()
        )
      );

      const dlq = await getDeadLetterQueue();

      // All tasks should be in DLQ
      for (const task of tasks) {
        expect(dlq.tasks.find(t => t.taskId === task.id)).toBeDefined();
      }
    });
  });

  describe('Task Result Error Details', () => {
    it('should include comprehensive error details in task result', async () => {
      const taskInput: CreateTaskInput = {
        title: 'Test error details',
        description: 'Verify error details in result',
        prompt: 'Task with detailed error',
        priority: 2,
        source: TaskSource.API,
      };

      const task = await addTask(taskInput);
      const error = new Error('Detailed error message');
      error.stack = 'Error stack trace here';

      // Fail maxAttempts times
      for (let i = 0; i < task.maxAttempts; i++) {
        await handleTaskFailure(task, error);
      }

      expect(task.result).toBeDefined();
      expect(task.result?.success).toBe(false);
      expect(task.result?.error?.code).toBe('MAX_RETRIES_EXCEEDED');
      expect(task.result?.error?.message).toContain('Detailed error message');
      expect(task.result?.error?.message).toContain(`${task.maxAttempts} attempts`);
      expect(task.result?.error?.stack).toBeDefined();
    });
  });
});
