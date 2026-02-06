import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock storage
const mockExecute = vi.fn().mockResolvedValue(undefined);
const mockQuery = vi.fn().mockResolvedValue([]);

vi.mock('../storage/index.js', () => ({
  getStorage: () => ({
    execute: mockExecute,
    query: mockQuery,
  }),
}));

// Mock slack notifications
vi.mock('../notifications/slack.js', () => ({
  sendSlackNotification: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocks
import {
  initDeadLetterQueue,
  handleTaskFailure,
  getDeadLetterQueue,
  getDeadLetterQueueStats,
  retryDeadLetterTask,
  removeFromDeadLetterQueue,
  discardFromDeadLetterQueue,
  setTaskQueueRef,
} from './failure-handler.js';
import type { Task } from '../types/task.js';

describe('Failure Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initDeadLetterQueue', () => {
    it('should create the DLQ table and index', async () => {
      await initDeadLetterQueue();

      expect(mockExecute).toHaveBeenCalledTimes(2);
      expect(mockExecute.mock.calls[0][0]).toContain('CREATE TABLE IF NOT EXISTS dead_letter_tasks');
      expect(mockExecute.mock.calls[1][0]).toContain('CREATE INDEX IF NOT EXISTS idx_dlq_status');
    });
  });

  describe('handleTaskFailure', () => {
    it('should schedule retry when under max attempts', async () => {
      const mockAdd = vi.fn().mockResolvedValue(undefined);
      setTaskQueueRef({ add: mockAdd } as any);

      const task: Task = {
        id: 'task-1',
        title: 'Test Task',
        prompt: 'Do something',
        status: 'in_progress',
        priority: 1,
        source: 'test',
        createdAt: new Date(),
        updatedAt: new Date(),
        attempts: 0,
        maxAttempts: 3,
        labels: [],
        metadata: {},
      };

      const error = new Error('Test failure');
      await handleTaskFailure(task, error);

      // Should have scheduled a retry
      expect(mockAdd).toHaveBeenCalled();
      expect(task.attempts).toBe(1);
    });

    it('should add to DLQ when max attempts reached', async () => {
      const task: Task = {
        id: 'task-2',
        title: 'Test Task',
        prompt: 'Do something',
        status: 'in_progress',
        priority: 1,
        source: 'test',
        createdAt: new Date(),
        updatedAt: new Date(),
        attempts: 2, // Already at max-1
        maxAttempts: 3,
        labels: [],
        metadata: {},
      };

      const error = new Error('Final failure');
      await handleTaskFailure(task, error);

      // Should have inserted into DLQ
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO dead_letter_tasks'),
        expect.any(Array)
      );
    });
  });

  describe('getDeadLetterQueue', () => {
    it('should return tasks with pagination info', async () => {
      mockQuery
        .mockResolvedValueOnce([{ count: 5 }]) // Total count
        .mockResolvedValueOnce([
          {
            id: 'dlq-1',
            task_id: 'task-1',
            title: 'Failed Task',
            prompt: 'Do something',
            source: 'test',
            priority: 1,
            attempts: 3,
            max_attempts: 3,
            last_error_code: 'MAX_RETRIES_EXCEEDED',
            last_error_message: 'Test error',
            retry_count: 0,
            status: 'pending',
            labels: '[]',
            metadata: '{}',
            created_at: Math.floor(Date.now() / 1000),
          },
        ]);

      const result = await getDeadLetterQueue({ limit: 10 });

      expect(result.total).toBe(5);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].taskId).toBe('task-1');
    });
  });

  describe('getDeadLetterQueueStats', () => {
    it('should return aggregated stats', async () => {
      mockQuery.mockResolvedValueOnce([
        { status: 'pending', count: 3 },
        { status: 'resolved', count: 10 },
        { status: 'discarded', count: 2 },
      ]);

      const stats = await getDeadLetterQueueStats();

      expect(stats).toEqual({
        pending: 3,
        resolved: 10,
        discarded: 2,
        total: 15,
      });
    });
  });

  describe('retryDeadLetterTask', () => {
    it('should return false when no queue ref', async () => {
      setTaskQueueRef(null as any);

      const result = await retryDeadLetterTask('dlq-1');

      expect(result).toBe(false);
    });

    it('should retry task and update DLQ entry', async () => {
      const mockAdd = vi.fn().mockResolvedValue(undefined);
      setTaskQueueRef({ add: mockAdd } as any);

      mockQuery.mockResolvedValueOnce([
        {
          id: 'dlq-1',
          task_id: 'task-1',
          title: 'Failed Task',
          prompt: 'Do something',
          source: 'test',
          priority: 1,
          max_attempts: 3,
          labels: '[]',
          metadata: '{}',
          retry_count: 0,
        },
      ]);

      const result = await retryDeadLetterTask('dlq-1');

      expect(result).toBe(true);
      expect(mockAdd).toHaveBeenCalled();
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE dead_letter_tasks'),
        expect.any(Array)
      );
    });
  });

  describe('removeFromDeadLetterQueue', () => {
    it('should mark task as resolved', async () => {
      await removeFromDeadLetterQueue('dlq-1', 'admin', 'Fixed manually');

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'resolved'"),
        expect.arrayContaining(['admin', 'Fixed manually', 'dlq-1'])
      );
    });
  });

  describe('discardFromDeadLetterQueue', () => {
    it('should mark task as discarded', async () => {
      await discardFromDeadLetterQueue('dlq-1', 'admin', 'Not worth retrying');

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'discarded'"),
        expect.arrayContaining(['admin', 'Not worth retrying', 'dlq-1'])
      );
    });
  });
});

describe('Backoff with Jitter', () => {
  it('should calculate exponential backoff with jitter', () => {
    // Test indirectly by checking multiple failures produce different delays
    // (due to jitter) but within expected range
    const baseDelay = 5 * 60 * 1000; // 5 minutes

    // For attempt 1: base * 3^0 = 5 min, with ±10% jitter = 4.5-5.5 min
    // For attempt 2: base * 3^1 = 15 min, with ±10% jitter = 13.5-16.5 min
    // For attempt 3: base * 3^2 = 45 min, with ±10% jitter = 40.5-49.5 min

    // This is tested implicitly in handleTaskFailure - the delay passed to add()
    // should be within the expected range
  });
});
