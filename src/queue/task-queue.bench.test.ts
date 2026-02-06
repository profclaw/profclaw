import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processTask, initTaskQueue, closeTaskQueue } from './task-queue.js';
import type { Task, TaskResult } from '../types/task.js';
import { Job } from 'bullmq';

// Mock BullMQ
const mockQueueAdd = vi.fn();
const mockQueueClose = vi.fn();
const mockWorkerClose = vi.fn();
const mockWorkerOn = vi.fn();

vi.mock('bullmq', () => {
  class MockQueue {
    add = mockQueueAdd;
    close = mockQueueClose;
  }
  class MockWorker {
    on = mockWorkerOn;
    close = mockWorkerClose;
  }
  return {
    Queue: MockQueue,
    Worker: MockWorker,
    Job: vi.fn(),
  };
});

// Mock Registry
vi.mock('../adapters/registry.js', () => ({
  getAgentRegistry: () => ({
    findAdapterForTask: () => ({
      name: 'MockAdapter',
      executeTask: async () => {
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms task execution
        return {
          success: true,
          output: 'Task completed',
          duration: 100,
        } as TaskResult;
      },
    }),
  }),
}));

// Mock Notifications
vi.mock('./notifications.js', () => ({
  postResultToSource: async () => {
    await new Promise(resolve => setTimeout(resolve, 500)); // 500ms notification
  },
}));

// Mock Storage for DLQ initialization
vi.mock('../storage/index.js', () => ({
  initStorage: vi.fn().mockResolvedValue(undefined),
  getStorage: () => ({
    execute: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
    getTask: vi.fn().mockResolvedValue(null),
    createTask: vi.fn().mockResolvedValue(undefined),
    updateTask: vi.fn().mockResolvedValue(undefined),
    getTasks: vi.fn().mockResolvedValue({ tasks: [], total: 0 }),
  }),
}));

// Skip benchmark tests in CI - timing is unreliable
// Run manually with: pnpm test task-queue.bench.test.ts
describe.skip('Task Queue Performance Benchmark', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await initTaskQueue();
  });

  afterEach(async () => {
    await closeTaskQueue();
  });

  it('measures processTask execution time (optimized)', async () => {
    const mockJob = {
      data: {
        id: 'task-1',
        title: 'Test Task',
        priority: 1,
        source: 'github_issue',
        status: 'queued',
      } as Task,
    } as unknown as Job<Task>;

    const start = performance.now();
    await processTask(mockJob);
    const end = performance.now();
    const duration = end - start;

    console.log(`[Benchmark] processTask took ${duration.toFixed(2)}ms`);

    // Should take ~100ms (task execution only)
    expect(duration).toBeGreaterThan(90);
    expect(duration).toBeLessThan(200); // Allow some overhead, but definitely not 600ms

    // Verify queue add was called
    expect(mockQueueAdd).toHaveBeenCalledWith('notify-source', expect.objectContaining({
      task: mockJob.data,
      result: expect.objectContaining({ success: true }),
    }));
  });
});
