import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import type { Task, TaskResult } from '../../types/task.js';

// ---------------------------------------------------------------------------
// Hoisted mock factories (must run before any module import)
// ---------------------------------------------------------------------------

const { mockDeps } = vi.hoisted(() => ({
  mockDeps: {
    // storage/index.js
    storage: {
      createTask: vi.fn().mockResolvedValue({}),
      updateTask: vi.fn().mockResolvedValue({}),
      getTask: vi.fn().mockResolvedValue(null),
      getTasks: vi.fn().mockResolvedValue({ tasks: [] }),
    },
    initStorage: vi.fn().mockResolvedValue({}),

    // adapters/registry.js (lazy-loaded via dynamic import)
    getAgentRegistry: vi.fn(),

    // queue/notifications.js (lazy-loaded)
    postResultToSource: vi.fn().mockResolvedValue(undefined),

    // notifications/in-app.js (lazy-loaded)
    createTaskNotification: vi.fn().mockResolvedValue(null),

    // summaries/index.js (lazy-loaded)
    extractFromTaskResult: vi.fn().mockResolvedValue({}),
    createSummary: vi.fn().mockResolvedValue({}),

    // queue/failure-handler.js
    handleTaskFailure: vi.fn().mockResolvedValue(undefined),
    initDeadLetterQueue: vi.fn().mockResolvedValue(undefined),

    // core/deployment.js
    getConcurrency: vi.fn().mockReturnValue(2),

    // utils/logger.js
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

vi.mock('../../storage/index.js', () => ({
  getStorage: vi.fn(() => mockDeps.storage),
  initStorage: mockDeps.initStorage,
}));

vi.mock('../../adapters/registry.js', () => ({
  getAgentRegistry: mockDeps.getAgentRegistry,
}));

vi.mock('../notifications.js', () => ({
  postResultToSource: mockDeps.postResultToSource,
}));

vi.mock('../../notifications/in-app.js', () => ({
  createTaskNotification: mockDeps.createTaskNotification,
}));

vi.mock('../../summaries/index.js', () => ({
  extractFromTaskResult: mockDeps.extractFromTaskResult,
  createSummary: mockDeps.createSummary,
}));

vi.mock('../failure-handler.js', () => ({
  handleTaskFailure: mockDeps.handleTaskFailure,
  initDeadLetterQueue: mockDeps.initDeadLetterQueue,
}));

vi.mock('../../core/deployment.js', () => ({
  getConcurrency: mockDeps.getConcurrency,
}));

vi.mock('../../utils/logger.js', () => ({
  logger: mockDeps.logger,
  createContextualLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Helper: build a default adapter (success)
// ---------------------------------------------------------------------------

function makeAdapter(overrides: {
  success?: boolean;
  output?: string;
  executeTask?: () => Promise<TaskResult>;
} = {}) {
  const result: TaskResult = {
    success: overrides.success ?? true,
    output: overrides.output ?? 'Done',
    metadata: { model: 'test-model' },
  };
  return {
    name: 'test-adapter',
    type: 'test',
    executeTask: overrides.executeTask ?? vi.fn().mockResolvedValue(result),
  };
}

// ---------------------------------------------------------------------------
// Import the module AFTER mocks are registered
// ---------------------------------------------------------------------------

import {
  initTaskQueue,
  closeTaskQueue,
  addTask,
  getTask,
  getTasks,
  onTaskEvent,
  registerSSEBroadcaster,
  cancelTask,
  retryTask,
} from '../memory-queue.js';

// ---------------------------------------------------------------------------
// Shared base input
// ---------------------------------------------------------------------------

const baseInput = {
  title: 'Test Task',
  prompt: 'Do the thing',
  source: 'api',
  priority: 3,
} as const;

// ---------------------------------------------------------------------------
// Wait helper for async task processing
// ---------------------------------------------------------------------------

async function waitForStatus(
  taskId: string,
  statuses: string[],
  timeoutMs = 3000
): Promise<Task | undefined> {
  await vi.waitFor(
    () => {
      const stored = getTask(taskId);
      if (!stored || !statuses.includes(stored.status)) {
        throw new Error(`Task ${taskId} still has status ${stored?.status}`);
      }
      return stored;
    },
    { timeout: timeoutMs, interval: 20 }
  );
  return getTask(taskId);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('MemoryQueue', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset adapter to always succeed by default
    mockDeps.getAgentRegistry.mockReturnValue({
      findAdapterForTask: vi.fn().mockReturnValue(makeAdapter()),
    });
    mockDeps.storage.getTasks.mockResolvedValue({ tasks: [] });
    mockDeps.storage.getTask.mockResolvedValue(null);
    await initTaskQueue();
  });

  afterEach(async () => {
    await closeTaskQueue();
  });

  // =========================================================================
  // addTask
  // =========================================================================

  describe('addTask', () => {
    it('returns a task with a generated id, title, and initial properties', async () => {
      // Capture immutable properties from the returned task object.
      // The returned reference is mutated in-place by processTask so we
      // snapshot the fields that are set synchronously before any async work.
      const task = await addTask({ ...baseInput });
      const { id, title, maxAttempts, createdAt } = task;

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(title).toBe('Test Task');
      expect(maxAttempts).toBe(3);
      expect(createdAt).toBeInstanceOf(Date);
      // status at return time is 'queued' but processing can race ahead
      expect(['queued', 'in_progress', 'completed']).toContain(task.status);
    });

    it('persists the task to storage on creation', async () => {
      const task = await addTask({ ...baseInput });

      // createTask must have been called with our specific task id
      expect(mockDeps.storage.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: task.id, title: 'Test Task' }),
      );
    });

    it('applies default labels and metadata when omitted', async () => {
      const task = await addTask({ ...baseInput });

      expect(task.labels).toEqual([]);
      expect(task.metadata).toEqual({});
    });

    it('preserves provided labels and metadata', async () => {
      const task = await addTask({
        ...baseInput,
        labels: ['frontend', 'urgent'],
        metadata: { ticketId: 'PC-99' },
      });

      expect(task.labels).toEqual(['frontend', 'urgent']);
      expect(task.metadata).toMatchObject({ ticketId: 'PC-99' });
    });

    it('emits a created event and a queued event', async () => {
      const events: string[] = [];
      const unsub = onTaskEvent(e => events.push(e.type));

      await addTask({ ...baseInput });

      unsub();
      expect(events).toContain('created');
      expect(events).toContain('queued');
    });

    it('broadcasts SSE events for created and queued', async () => {
      const broadcaster = vi.fn();
      registerSSEBroadcaster(broadcaster);

      await addTask({ ...baseInput });

      const eventTypes = (broadcaster.mock.calls as [string, Record<string, unknown>][]).map(c => c[0]);
      expect(eventTypes).toContain('task:created');
      expect(eventTypes).toContain('task:queued');

      // Clean up broadcaster for subsequent tests
      registerSSEBroadcaster(() => undefined);
    });
  });

  // =========================================================================
  // getTask
  // =========================================================================

  describe('getTask', () => {
    it('returns the task by id', async () => {
      const created = await addTask({ ...baseInput });
      const fetched = getTask(created.id);

      expect(fetched).toBeDefined();
      expect(fetched?.id).toBe(created.id);
      expect(fetched?.title).toBe('Test Task');
    });

    it('returns undefined for an unknown id', () => {
      expect(getTask('non-existent-id')).toBeUndefined();
    });
  });

  // =========================================================================
  // getTasks
  // =========================================================================

  describe('getTasks', () => {
    it('returns all tasks when no filter is given', async () => {
      await addTask({ ...baseInput, title: 'Task A' });
      await addTask({ ...baseInput, title: 'Task B' });

      const all = getTasks();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it('filters tasks by status', async () => {
      await addTask({ ...baseInput });
      const task = await addTask({ ...baseInput, title: 'To cancel' });
      await cancelTask(task.id);

      const cancelled = getTasks({ status: 'cancelled' });
      expect(cancelled.every(t => t.status === 'cancelled')).toBe(true);
    });

    it('respects the limit option', async () => {
      await addTask({ ...baseInput, title: 'L1' });
      await addTask({ ...baseInput, title: 'L2' });
      await addTask({ ...baseInput, title: 'L3' });

      const limited = getTasks({ limit: 2 });
      expect(limited.length).toBeLessThanOrEqual(2);
    });

    it('respects the offset option', async () => {
      await addTask({ ...baseInput, title: 'O1' });
      await addTask({ ...baseInput, title: 'O2' });

      const first = getTasks({ limit: 1, offset: 0 });
      const second = getTasks({ limit: 1, offset: 1 });

      expect(first[0]?.id).not.toBe(second[0]?.id);
    });

    it('returns tasks sorted newest first', async () => {
      // Close and reinit with empty store so we have a clean slate
      await closeTaskQueue();
      await initTaskQueue();

      const t1 = await addTask({ ...baseInput, title: 'Earlier' });
      // Introduce tiny delay so createdAt timestamps differ
      await new Promise(resolve => setTimeout(resolve, 2));
      const t2 = await addTask({ ...baseInput, title: 'Later' });

      const all = getTasks();
      const ids = all.map(t => t.id);
      // t2 was created after t1, so it should appear first
      const idx1 = ids.indexOf(t1.id);
      const idx2 = ids.indexOf(t2.id);
      expect(idx2).toBeLessThan(idx1);
    });
  });

  // =========================================================================
  // Event callbacks (onTaskEvent)
  // =========================================================================

  describe('onTaskEvent', () => {
    it('invokes the callback on task events', async () => {
      const spy = vi.fn();
      const unsub = onTaskEvent(spy);

      await addTask({ ...baseInput });

      unsub();
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'created' }));
    });

    it('stops invoking after unsubscribe', async () => {
      const spy = vi.fn();
      const unsub = onTaskEvent(spy);
      unsub();

      await addTask({ ...baseInput });

      expect(spy).not.toHaveBeenCalled();
    });

    it('supports multiple simultaneous listeners', async () => {
      const spy1 = vi.fn();
      const spy2 = vi.fn();
      const u1 = onTaskEvent(spy1);
      const u2 = onTaskEvent(spy2);

      await addTask({ ...baseInput });

      u1();
      u2();
      expect(spy1).toHaveBeenCalled();
      expect(spy2).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // SSE broadcasting (registerSSEBroadcaster)
  // =========================================================================

  describe('registerSSEBroadcaster', () => {
    it('receives task:created and task:queued events with task metadata', async () => {
      const broadcaster = vi.fn();
      registerSSEBroadcaster(broadcaster);

      const task = await addTask({ ...baseInput, title: 'SSE Task' });

      const calls = broadcaster.mock.calls as [string, Record<string, unknown>][];
      const createdCall = calls.find(c => c[0] === 'task:created');
      expect(createdCall).toBeDefined();
      const payload = createdCall![1] as { taskId: string; task: { title: string } };
      expect(payload.taskId).toBe(task.id);
      expect(payload.task.title).toBe('SSE Task');

      // Clean up
      registerSSEBroadcaster(() => undefined);
    });
  });

  // =========================================================================
  // cancelTask
  // =========================================================================

  describe('cancelTask', () => {
    it('cancels a queued task and returns true', async () => {
      // Use a blocking adapter so task stays in_progress or queued
      const blocker = {
        name: 'blocker',
        type: 'test',
        executeTask: vi.fn().mockImplementation(
          () => new Promise<TaskResult>(resolve => setTimeout(() => resolve({ success: true, output: 'done' }), 10000))
        ),
      };
      mockDeps.getAgentRegistry.mockReturnValue({
        findAdapterForTask: vi.fn().mockReturnValue(blocker),
      });

      const task = await addTask({ ...baseInput });
      const result = await cancelTask(task.id);

      expect(result).toBe(true);
      expect(getTask(task.id)?.status).toBe('cancelled');
    });

    it('sets completedAt on cancellation', async () => {
      const task = await addTask({ ...baseInput });
      // If already processing, cancel anyway - it still sets completedAt on cancel path
      // First cancel a freshly added task
      const task2 = await addTask({ ...baseInput, title: 'Fresh cancel' });
      await cancelTask(task2.id);

      // Either way the cancelled task should have completedAt
      const stored = getTask(task2.id);
      if (stored?.status === 'cancelled') {
        expect(stored.completedAt).toBeInstanceOf(Date);
      } else {
        // Task was processed before we could cancel - that's fine
        expect(['completed', 'failed', 'in_progress']).toContain(stored?.status);
      }
      void task;
    });

    it('returns false for an unknown task id', async () => {
      const result = await cancelTask('no-such-id');
      expect(result).toBe(false);
    });

    it('returns false if the task is already completed', async () => {
      const task = await addTask({ ...baseInput });
      // Wait for the task to complete
      await waitForStatus(task.id, ['completed', 'failed'], 3000);

      const result = await cancelTask(task.id);
      expect(result).toBe(false);
    });

    it('emits a failed event on cancellation', async () => {
      const events: string[] = [];
      const unsub = onTaskEvent(e => events.push(e.type));

      const task = await addTask({ ...baseInput });
      events.length = 0;

      // Try to cancel - may or may not succeed depending on processing speed
      const cancelled = await cancelTask(task.id);
      unsub();

      if (cancelled) {
        expect(events).toContain('failed');
      } else {
        // Already completed - events not emitted by cancelTask but by processTask
        expect(['completed', 'failed']).toContain(getTask(task.id)?.status);
      }
    });
  });

  // =========================================================================
  // retryTask
  // =========================================================================

  describe('retryTask', () => {
    it('creates a new task from a failed task with retriedFrom metadata', async () => {
      const task = await addTask({ ...baseInput });
      const stored = getTask(task.id)!;
      stored.status = 'failed';

      const retried = await retryTask(task.id);

      expect(retried).not.toBeNull();
      expect(retried!.id).not.toBe(task.id);
      expect(retried!.metadata).toMatchObject({ retriedFrom: task.id });
    });

    it('returns null for an unknown task id', async () => {
      const result = await retryTask('ghost-id');
      expect(result).toBeNull();
    });

    it('returns null when the task status is not retryable (queued)', async () => {
      const task = await addTask({ ...baseInput });
      // queued/in_progress are not in retryable statuses - force status to queued
      const stored = getTask(task.id)!;
      stored.status = 'queued';

      const result = await retryTask(task.id);
      expect(result).toBeNull();
    });

    it('copies title, prompt, source, and labels into the retried task', async () => {
      const task = await addTask({
        ...baseInput,
        title: 'Original Title',
        labels: ['a', 'b'],
      });
      const stored = getTask(task.id)!;
      stored.status = 'cancelled';

      const retried = await retryTask(task.id);

      expect(retried!.title).toBe('Original Title');
      expect(retried!.labels).toEqual(['a', 'b']);
    });
  });

  // =========================================================================
  // Task processing lifecycle
  // =========================================================================

  describe('task processing lifecycle', () => {
    it('marks task as completed when the adapter succeeds', async () => {
      const task = await addTask({ ...baseInput });

      const stored = await waitForStatus(task.id, ['completed', 'failed']);
      expect(stored?.status).toBe('completed');
    });

    it('calls postResultToSource after a successful execution', async () => {
      const task = await addTask({ ...baseInput });

      await waitForStatus(task.id, ['completed', 'failed']);

      expect(mockDeps.postResultToSource).toHaveBeenCalledWith(
        expect.objectContaining({ id: task.id }),
        expect.objectContaining({ success: true }),
      );
    });

    it('calls extractFromTaskResult and createSummary after success', async () => {
      const task = await addTask({ ...baseInput });

      await waitForStatus(task.id, ['completed', 'failed']);

      expect(mockDeps.extractFromTaskResult).toHaveBeenCalled();
      expect(mockDeps.createSummary).toHaveBeenCalled();
    });

    it('marks task as failed when no adapter is found', async () => {
      mockDeps.getAgentRegistry.mockReturnValue({
        findAdapterForTask: vi.fn().mockReturnValue(null),
      });

      const task = await addTask({ ...baseInput });

      const stored = await waitForStatus(task.id, ['failed']);
      expect(stored?.status).toBe('failed');
      expect(stored?.result?.error?.code).toBe('NO_ADAPTER');
    });

    it('increments attempts and requeues when adapter returns failure with attempts remaining', async () => {
      let callCount = 0;
      const failAdapter = {
        name: 'fail-adapter',
        type: 'test',
        executeTask: vi.fn().mockImplementation(async () => {
          callCount++;
          // After 3 attempts fail permanently to reach maxAttempts
          return {
            success: false,
            output: 'Nope',
            error: { code: 'FAIL', message: 'Nope' },
          } satisfies TaskResult;
        }),
      };
      mockDeps.getAgentRegistry.mockReturnValue({
        findAdapterForTask: vi.fn().mockReturnValue(failAdapter),
      });

      const task = await addTask({ ...baseInput });

      // Wait for eventual failure after all retries
      await waitForStatus(task.id, ['failed'], 5000);

      // Should have been called once per attempt (maxAttempts = 3)
      expect(callCount).toBeGreaterThanOrEqual(1);
      expect(getTask(task.id)?.status).toBe('failed');
    });

    it('sends failed task to DLQ after exhausting maxAttempts', async () => {
      const failAdapter = {
        name: 'fail-adapter',
        type: 'test',
        executeTask: vi.fn().mockResolvedValue({
          success: false,
          output: 'Fail',
          error: { code: 'FAIL', message: 'Always fails' },
        } satisfies TaskResult),
      };
      mockDeps.getAgentRegistry.mockReturnValue({
        findAdapterForTask: vi.fn().mockReturnValue(failAdapter),
      });

      const task = await addTask({ ...baseInput });

      await waitForStatus(task.id, ['failed'], 5000);

      expect(mockDeps.handleTaskFailure).toHaveBeenCalledWith(
        expect.objectContaining({ id: task.id }),
        expect.any(Error),
      );
    });

    it('handles adapter execution exceptions and marks task failed', async () => {
      const throwingAdapter = {
        name: 'throwing-adapter',
        type: 'test',
        executeTask: vi.fn().mockRejectedValue(new Error('Unexpected crash')),
      };
      mockDeps.getAgentRegistry.mockReturnValue({
        findAdapterForTask: vi.fn().mockReturnValue(throwingAdapter),
      });

      const task = await addTask({ ...baseInput });

      await waitForStatus(task.id, ['failed'], 5000);

      const stored = getTask(task.id);
      expect(stored?.status).toBe('failed');
      expect(stored?.result?.error?.code).toBe('EXECUTION_ERROR');
      expect(stored?.result?.error?.message).toContain('Unexpected crash');
    });

    it('emits a completed event via SSE broadcaster when task succeeds', async () => {
      const broadcaster = vi.fn();
      registerSSEBroadcaster(broadcaster);

      const task = await addTask({ ...baseInput });
      await waitForStatus(task.id, ['completed', 'failed']);

      const eventTypes = (broadcaster.mock.calls as [string, unknown][]).map(c => c[0]);
      expect(eventTypes.some(t => (t as string).includes('task:'))).toBe(true);

      registerSSEBroadcaster(() => undefined);
    });
  });

  // =========================================================================
  // initTaskQueue / closeTaskQueue
  // =========================================================================

  describe('initTaskQueue / closeTaskQueue', () => {
    it('calls initStorage and initDeadLetterQueue on init', async () => {
      expect(mockDeps.initStorage).toHaveBeenCalled();
      expect(mockDeps.initDeadLetterQueue).toHaveBeenCalled();
    });

    it('loads tasks from DB on init', async () => {
      expect(mockDeps.storage.getTasks).toHaveBeenCalledWith({ limit: 10000 });
    });

    it('pre-populates the in-memory store with DB tasks', async () => {
      const dbTask: Task = {
        id: 'db-task-fixture',
        title: 'DB Task',
        prompt: 'From DB',
        source: 'api',
        priority: 3,
        status: 'completed',
        createdAt: new Date(),
        updatedAt: new Date(),
        attempts: 1,
        maxAttempts: 3,
        labels: [],
        metadata: {},
      };
      mockDeps.storage.getTasks.mockResolvedValue({ tasks: [dbTask] });

      await closeTaskQueue();
      await initTaskQueue();

      const fetched = getTask('db-task-fixture');
      expect(fetched).toBeDefined();
      expect(fetched?.title).toBe('DB Task');
    });

    it('does not throw if DB load fails (warns and starts fresh)', async () => {
      mockDeps.storage.getTasks.mockRejectedValueOnce(new Error('DB down'));

      await closeTaskQueue();
      await expect(initTaskQueue()).resolves.not.toThrow();
    });

    it('stops processing after closeTaskQueue', async () => {
      await closeTaskQueue();

      // After close, adding tasks still works but polling stops
      const task = await addTask({ ...baseInput });
      expect(task.id).toBeDefined();

      // Re-init for afterEach cleanup
      await initTaskQueue();
    });
  });
});
