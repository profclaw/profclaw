import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addTask, getTask, getTasks, initTaskQueue, cancelTask, retryTask, processTask, onTaskEvent, closeTaskQueue } from '../task-queue.js';
import { Queue } from 'bullmq';
import { getStorage } from '../../storage/index.js';

// Mock BullMQ
vi.mock('bullmq', () => {
  return {
    Queue: vi.fn().mockImplementation(function() {
      return {
        add: vi.fn().mockResolvedValue({ id: 'job-1' }),
        getJob: vi.fn().mockResolvedValue({ remove: vi.fn() }),
        close: vi.fn(),
      };
    }),
    Worker: vi.fn().mockImplementation(function() {
      return {
        on: vi.fn(),
        close: vi.fn(),
      };
    }),
  };
});

// Mock storage
vi.mock('../../storage/index.js', () => {
  const mockStorage = {
    createTask: vi.fn().mockResolvedValue({}),
    updateTask: vi.fn().mockResolvedValue({}),
    getTask: vi.fn().mockResolvedValue(null),
    getTasks: vi.fn().mockResolvedValue({ tasks: [] }),
    execute: vi.fn().mockResolvedValue({}),
  };
  return {
    getStorage: vi.fn().mockReturnValue(mockStorage),
    initStorage: vi.fn().mockResolvedValue({}),
  };
});

// Mock agent registry
vi.mock('../../adapters/registry.js', () => ({
  getAgentRegistry: vi.fn().mockReturnValue({
    findAdapterForTask: vi.fn().mockReturnValue({
      name: 'test-adapter',
      type: 'test',
      executeTask: vi.fn().mockResolvedValue({
        success: true,
        output: 'Done',
        metadata: { model: 'test-model' }
      })
    })
  })
}));

// Mock summary services
vi.mock('../../summaries/index.js', () => ({
  extractFromTaskResult: vi.fn().mockResolvedValue({}),
  createSummary: vi.fn().mockResolvedValue({}),
}));

// Mock config-loader
vi.mock('../../utils/config-loader.js', () => ({
  loadConfig: vi.fn().mockReturnValue({
    queue: { name: 'test-queue', redis: { url: 'redis://localhost:6379' } }
  })
}));

describe('Task Queue', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.REDIS_URL = 'redis://localhost:6379';
    await initTaskQueue();
  });

  it('should add a task to the queue and database', async () => {
    const input = {
      title: 'New Task',
      prompt: 'Do something',
      source: 'api',
      priority: 1,
    } as any;

    const task = await addTask(input);

    expect(task.id).toBeDefined();
    expect(task.title).toBe('New Task');
    expect(task.status).toBe('queued');

    const storage = getStorage();
    expect(storage.createTask).toHaveBeenCalled();
    
    // Check BullMQ interaction
    const queueInstance = vi.mocked(Queue).mock.results[0].value;
    expect(queueInstance.add).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({ title: 'New Task' }),
      expect.objectContaining({ priority: 1 })
    );
  });

  it('should retrieve a task from store', async () => {
    const input = { title: 'T', prompt: 'P', source: 'S' } as any;
    const created = await addTask(input);

    const task = getTask(created.id);
    expect(task).toEqual(expect.objectContaining({ title: 'T' }));
  });

  it('should query tasks with status filter', async () => {
      await addTask({ title: 'F1', status: 'failed' } as any);
      const tasks = getTasks({ status: 'queued' });
      expect(tasks.every(t => t.status === 'queued')).toBe(true);
  });

  it('should cancel a cancellable task', async () => {
      const task = await addTask({ title: 'Cancel Me' } as any);
      const success = await cancelTask(task.id);
      expect(success).toBe(true);
      expect(getTask(task.id)?.status).toBe('cancelled');
  });

  it('should retry a failed task', async () => {
      const task = await addTask({ title: 'Retry Me' } as any);
      task.status = 'failed'; // Manually set for test
      
      const retried = await retryTask(task.id);
      expect(retried).not.toBeNull();
      expect(retried?.metadata?.retriedFrom).toBe(task.id);
  });

  it('should process a task through adapter and create summary', async () => {
      const task = await addTask({ title: 'Process Me' } as any);
      const job = { data: task } as any;
      
      const result = await processTask(job);
      expect(result.success).toBe(true);
      
      const { createSummary } = await import('../../summaries/index.js');
      expect(createSummary).toHaveBeenCalled();
  });

  it('should subscribe to task events', async () => {
      const spy = vi.fn();
      const unsubscribe = onTaskEvent(spy);
      
      await addTask({ title: 'Event Test' } as any);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'created' }));
      
      unsubscribe();
  });

  it('should broadcast events via SSE', async () => {
      const { registerSSEBroadcaster } = await import('../task-queue.js');
      const spy = vi.fn();
      registerSSEBroadcaster(spy);
      
      await addTask({ title: 'SSE Test' } as any);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('task:created'), expect.any(Object));
  });

  it('should throw if no adapter found in processTask', async () => {
      const { getAgentRegistry } = await import('../../adapters/registry.js');
      (getAgentRegistry().findAdapterForTask as any).mockReturnValue(null);
      
      const job = { data: { id: 'x', title: 'No Adapter' } } as any;
      await expect(processTask(job)).rejects.toThrow('No suitable agent adapter found');
  });

  it('should close the queue and workers', async () => {
      await closeTaskQueue();
      // Verifying internal nulling is hard, but we can check if close was called on mocks
      const queueInstance = vi.mocked(Queue).mock.results[0].value;
      expect(queueInstance.close).toHaveBeenCalled();
  });
});
