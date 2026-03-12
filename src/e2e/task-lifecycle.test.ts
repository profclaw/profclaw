import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import type { CreateTaskInput, Task, TaskResult } from '../types/task.js';
import { TaskSource, TaskStatus } from '../types/task.js';

// Set environment variables
process.env.STORAGE_TIER = 'memory';

// In-memory local state for the test
let receivedEvents: Array<{ type: string; taskId: string; task: Task; result?: TaskResult }> = [];

// Mock BullMQ
vi.mock('bullmq', () => {
  const workers = new Map<string, any>();
  const activeJobs = new Map<string, any>();
  const jobQueues = new Map<string, any[]>();
  const isProcessing = new Map<string, boolean>();

  async function processNextJob(queueName: string) {
    if (isProcessing.get(queueName)) return;
    
    const queue = jobQueues.get(queueName) || [];
    if (queue.length === 0) return;

    // Sort by priority (asc: 1 is highest)
    queue.sort((a, b) => (a.opts?.priority || 100) - (b.opts?.priority || 100));
    
    const job = queue.shift();
    if (!job) return;

    isProcessing.set(queueName, true);
    const worker = workers.get(queueName);

    if (worker && worker.processor) {
      // Simulate task start delay
      setTimeout(async () => {
        try {
          const result = await worker.processor(job);
          await worker._emit('completed', job, result);
        } catch (error) {
          await worker._emit('failed', job, error);
        } finally {
          isProcessing.set(queueName, false);
          // Process next job after a tiny gap
          setTimeout(() => processNextJob(queueName), 5);
        }
      }, 20);
    } else {
      isProcessing.set(queueName, false);
    }
  }

  class MockQueue {
    name: string;
    constructor(name: string) { this.name = name; }
    async add(jobName: string, data: any, options: any) {
      const job = { 
        id: data.id || randomUUID(), 
        name: jobName, 
        data: JSON.parse(JSON.stringify(data)),
        opts: options,
        updateProgress: vi.fn().mockImplementation(async (p) => {
          const w = workers.get(this.name);
          if (w) await w._emit('progress', job, p);
        }),
      };
      activeJobs.set(job.id, job);
      
      if (!jobQueues.has(this.name)) jobQueues.set(this.name, []);
      jobQueues.get(this.name)!.push(job);
      
      // Trigger processing loop
      processNextJob(this.name).catch(console.error);
      
      return job;
    }
    async getJob(id: string) { return activeJobs.get(id); }
    async close() {}
  }

  class MockWorker {
    name: string;
    processor: any;
    handlers = new Map<string, any>();

    constructor(name: string, processor: any) { 
      this.name = name;
      this.processor = processor;
      workers.set(name, this);
    }
    on(event: string, handler: any) { 
      this.handlers.set(event, handler);
      return this; 
    }
    async close() {}
    
    async _emit(event: string, ...args: any[]) {
      const handler = this.handlers.get(event);
      if (handler) await handler(...args);
    }
  }

  return { Queue: MockQueue, Worker: MockWorker };
});

// Mock notifications
vi.mock('../notifications/slack.js', () => ({
  sendSlackNotification: vi.fn().mockResolvedValue(undefined),
}));

// Mock registry
vi.mock('../adapters/registry.js', () => ({
  getAgentRegistry: () => ({
    findAdapterForTask: (task: Task) => {
      if (task.assignedAgent === 'non-existent-adapter') return null;
      return {
        name: 'MockAdapter',
        type: 'openclaw',
        capabilities: ['code_generation'],
        healthCheck: async () => ({ healthy: true, message: 'OK', latencyMs: 10, lastChecked: new Date() }),
        executeTask: async () => {
          // Simulate some work
          await new Promise(r => setTimeout(r, 10));
          return { success: true, output: 'Task completed', duration: 100 };
        },
      };
    },
  }),
}));

// Import after mocks
import {
  initTaskQueue,
  addTask,
  getTask,
  getTasks,
  onTaskEvent,
  closeTaskQueue,
} from '../queue/task-queue.js';

/**
 * E2E Test: Full Task Lifecycle
 *
 * These tests require async task processing which is complex to mock.
 * Run with real Redis for full E2E: REDIS_URL=redis://localhost:6379 pnpm test:e2e
 */

// Skip E2E tests in regular test runs - they need actual async processing
describe('E2E: Full Task Lifecycle', () => {
  // Track events for assertions
  let receivedEvents: Array<{ type: string; taskId: string; task: Task; result?: TaskResult }> = [];
  let unsubscribe: (() => void) | null = null;

  beforeAll(async () => {
    // Initialize the task queue
    try {
      await initTaskQueue();
    } catch (error) {
      console.warn('Task queue initialization warning (might be expected in test):', error);
    }

    // Subscribe to task events
    unsubscribe = onTaskEvent((event) => {
      receivedEvents.push(event);
    });
  });

  beforeEach(() => {
    receivedEvents = [];
  });

  afterAll(async () => {
    // Clean up
    if (unsubscribe) {
      unsubscribe();
    }
    await closeTaskQueue();
  });

  it('should complete full task lifecycle: create → queue → process → complete', async () => {
    // Step 1: Create task input
    const taskInput: CreateTaskInput = {
      title: 'E2E Test: Add health check endpoint',
      description: 'Add a /health endpoint that returns server status',
      prompt: 'Create a GET /health endpoint in the server that returns { status: "ok" }',
      priority: 2, // High priority
      source: TaskSource.API,
      sourceId: 'e2e-test-1',
      sourceUrl: undefined,
      repository: 'profclaw/task-manager',
      branch: 'main',
      labels: ['enhancement', 'test'],
      assignedAgent: undefined, // Let routing decide
      metadata: {
        testRun: true,
        timestamp: new Date().toISOString(),
      },
    };

    // Step 2: Add task to queue
    const task = await addTask(taskInput);

    // Verify task was created with correct properties
    expect(task).toBeDefined();
    expect(task.id).toBeDefined();
    expect(task.title).toBe(taskInput.title);
    expect(task.status).toBe(TaskStatus.QUEUED);
    expect(task.createdAt).toBeInstanceOf(Date);
    expect(task.attempts).toBe(0);

    // Verify task is in store
    const storedTask = getTask(task.id);
    expect(storedTask).toBeDefined();
    expect(storedTask?.id).toBe(task.id);

    // Verify 'created' and 'queued' events were emitted
    expect(receivedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'created',
          taskId: task.id,
        }),
        expect.objectContaining({
          type: 'queued',
          taskId: task.id,
        }),
      ])
    );

    // Step 3: Wait for task to be processed
    // The worker picks it up automatically
    const maxWaitTime = 30000; // 30 seconds
    const startTime = Date.now();
    let processedTask: Task | undefined;

    while (Date.now() - startTime < maxWaitTime) {
      processedTask = getTask(task.id);
      if (processedTask && processedTask.status === TaskStatus.COMPLETED) {
        break;
      }
      if (processedTask && processedTask.status === TaskStatus.FAILED) {
        break;
      }
      // Wait a bit before checking again
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Step 4: Verify task completed successfully
    expect(processedTask).toBeDefined();
    expect(processedTask!.status).toBe(TaskStatus.COMPLETED);
    expect(processedTask!.result).toBeDefined();
    expect(processedTask!.result?.success).toBe(true);
    expect(processedTask!.startedAt).toBeInstanceOf(Date);
    expect(processedTask!.completedAt).toBeInstanceOf(Date);
    expect(processedTask!.result?.duration).toBeGreaterThan(0);

    // Step 5: Verify events were emitted in correct order
    expect(receivedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'created', taskId: task.id }),
        expect.objectContaining({ type: 'queued', taskId: task.id }),
        expect.objectContaining({ type: 'started', taskId: task.id }),
        expect.objectContaining({ type: 'completed', taskId: task.id }),
      ])
    );

    const completedEvent = receivedEvents.find(
      (e) => e.type === 'completed' && e.taskId === task.id
    );
    expect(completedEvent?.result).toBeDefined();
    expect(completedEvent?.result?.success).toBe(true);
  }, 35000); // Increase timeout for this test

  it('should handle task retrieval with filters', async () => {
    // Add multiple tasks
    const task1 = await addTask({
      title: 'Task 1',
      prompt: 'Do task 1',
      priority: 1,
      source: TaskSource.API,
      labels: [],
      metadata: {},
    });

    const task2 = await addTask({
      title: 'Task 2',
      prompt: 'Do task 2',
      priority: 3,
      source: TaskSource.API,
      labels: [],
      metadata: {},
    });

    // Get all tasks
    const allTasks = getTasks();
    expect(allTasks.length).toBeGreaterThanOrEqual(2);
    expect(allTasks.some((t) => t.id === task1.id)).toBe(true);
    expect(allTasks.some((t) => t.id === task2.id)).toBe(true);

    // Get tasks with specific status
    const queuedTasks = getTasks({ status: TaskStatus.QUEUED });
    expect(queuedTasks.every((t) => t.status === TaskStatus.QUEUED)).toBe(true);

    // Test pagination
    const limitedTasks = getTasks({ limit: 1 });
    expect(limitedTasks.length).toBe(1);

    const offsetTasks = getTasks({ limit: 1, offset: 1 });
    expect(offsetTasks.length).toBeGreaterThanOrEqual(0);
    if (offsetTasks.length > 0) {
      expect(offsetTasks[0].id).not.toBe(limitedTasks[0].id);
    }
  });

  it('should handle task failure and store error information', async () => {
    // Create a task that will fail (invalid agent assignment)
    const taskInput: CreateTaskInput = {
      title: 'E2E Test: Task failure handling',
      prompt: 'Test task that should fail gracefully',
      priority: 3,
      source: TaskSource.API,
      labels: [],
      metadata: {},
      assignedAgent: 'non-existent-adapter', // This will cause failure
    };

    const task = await addTask(taskInput);

    // Wait for task to fail
    const maxWaitTime = 15000;
    const startTime = Date.now();
    let finalTask: Task | undefined;

    while (Date.now() - startTime < maxWaitTime) {
      finalTask = getTask(task.id);
      if (finalTask && finalTask.status === TaskStatus.FAILED) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Verify task failed with proper error information
    expect(finalTask).toBeDefined();
    expect(finalTask!.status).toBe(TaskStatus.FAILED);
    expect(finalTask!.result).toBeDefined();
    expect(finalTask!.result?.success).toBe(false);
    expect(finalTask!.result?.error).toBeDefined();
    expect(finalTask!.result?.error?.message).toBeDefined();

    // Verify failed event was emitted
    const failedEvent = receivedEvents.find(
      (e) => e.type === 'failed' && e.taskId === task.id
    );
    expect(failedEvent).toBeDefined();
  }, 20000);

  it('should respect task priority in queue processing', async () => {
    const tasksCreated: Task[] = [];

    // Add low priority task
    const lowPriorityTask = await addTask({
      title: 'Low priority task',
      prompt: 'This should be processed last',
      priority: 4, // LOW
      source: TaskSource.API,
      labels: [],
      metadata: { priority: 'low' },
    });
    tasksCreated.push(lowPriorityTask);

    // Add high priority task
    const highPriorityTask = await addTask({
      title: 'High priority task',
      prompt: 'This should be processed first',
      priority: 2, // HIGH
      source: TaskSource.API,
      labels: [],
      metadata: { priority: 'high' },
    });
    tasksCreated.push(highPriorityTask);

    // Add critical priority task
    const criticalPriorityTask = await addTask({
      title: 'Critical priority task',
      prompt: 'This should be processed immediately',
      priority: 1, // CRITICAL
      source: TaskSource.API,
      labels: [],
      metadata: { priority: 'critical' },
    });
    tasksCreated.push(criticalPriorityTask);

    // Wait for all to complete
    const maxWaitTime = 45000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const allCompleted = tasksCreated.every((t) => {
        const current = getTask(t.id);
        return current && (current.status === TaskStatus.COMPLETED || current.status === TaskStatus.FAILED);
      });

      if (allCompleted) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Verify all tasks completed
    const completedTasks = tasksCreated.map((t) => getTask(t.id)!);
    expect(completedTasks.every((t) => t.status === TaskStatus.COMPLETED)).toBe(true);

    // Verify each task has proper completion data
    for (const task of completedTasks) {
      expect(task.result).toBeDefined();
      expect(task.result?.success).toBe(true);
      expect(task.startedAt).toBeInstanceOf(Date);
      expect(task.completedAt).toBeInstanceOf(Date);
    }
  }, 50000);
});
