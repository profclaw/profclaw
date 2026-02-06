import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleTaskFailure, initDeadLetterQueue, setTaskQueueRef, getDeadLetterQueue, removeFromDeadLetterQueue, discardFromDeadLetterQueue, retryDeadLetterTask, getDeadLetterQueueStats } from '../failure-handler.js';
import { getStorage } from '../../storage/index.js';

// Mock storage
vi.mock('../../storage/index.js', () => {
    const mockStorage = {
        execute: vi.fn().mockResolvedValue({}),
        query: vi.fn().mockResolvedValue([]),
    };
    return {
        getStorage: vi.fn().mockReturnValue(mockStorage),
    };
});

// Mock slack notifications
vi.mock('../../notifications/slack.js', () => ({
    sendSlackNotification: vi.fn().mockResolvedValue({}),
}));

describe('Failure Handler', () => {
    let mockQueue: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockQueue = {
            add: vi.fn().mockResolvedValue({}),
        };
        setTaskQueueRef(mockQueue);
    });

    it('should initialize the dead letter queue table', async () => {
        await initDeadLetterQueue();
        const storage = getStorage();
        expect(storage.execute).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS dead_letter_tasks'));
    });

    it('should schedule a retry if max attempts not reached', async () => {
        const task = { id: 'task-1', attempts: 0, maxAttempts: 3, priority: 1, title: 'T' } as any;
        const error = new Error('Fail');
        
        await handleTaskFailure(task, error);
        
        expect(mockQueue.add).toHaveBeenCalledWith(
            expect.stringContaining('retry-task-1'),
            expect.objectContaining({ id: 'task-1', attempts: 1 }),
            expect.objectContaining({ delay: expect.any(Number) })
        );
    });

    it('should move to DLQ if max attempts reached', async () => {
        const task = { id: 'task-1', attempts: 2, maxAttempts: 3, priority: 1, title: 'T', labels: [], metadata: {} } as any;
        const error = new Error('Final Fail');
        
        await handleTaskFailure(task, error);
        
        const storage = getStorage();
        expect(storage.execute).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO dead_letter_tasks'),
            expect.any(Array)
        );
    });

    it('should retrieve dead letter queue tasks', async () => {
        const storage = getStorage();
        (storage.query as any).mockResolvedValueOnce([{ count: 1 }]).mockResolvedValueOnce([{ id: 'dlq-1', task_id: 't1', labels: '[]', metadata: '{}', created_at: Date.now()/1000 }]);
        
        const result = await getDeadLetterQueue();
        expect(result.total).toBe(1);
        expect(result.tasks[0].id).toBe('dlq-1');
    });

    it('should resolve a DLQ task', async () => {
        await removeFromDeadLetterQueue('dlq-1', 'user', 'fixed');
        const storage = getStorage();
        expect(storage.execute).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE dead_letter_tasks'),
            expect.arrayContaining(['user', 'fixed', 'dlq-1'])
        );
    });

    it('should discard a DLQ task', async () => {
        await discardFromDeadLetterQueue('dlq-1');
        const storage = getStorage();
        expect(storage.execute).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE dead_letter_tasks'),
            expect.arrayContaining(['dlq-1'])
        );
    });

    it('should retry a task from DLQ', async () => {
        const storage = getStorage();
        (storage.query as any).mockResolvedValueOnce([{ task_id: 't1', labels: '[]', metadata: '{}', max_attempts: 3, priority: 1 }]);
        
        const success = await retryDeadLetterTask('dlq-1');
        expect(success).toBe(true);
        expect(mockQueue.add).toHaveBeenCalled();
        expect(storage.execute).toHaveBeenCalledWith(expect.stringContaining('UPDATE dead_letter_tasks'), ['dlq-1']);
    });

    it('should get DLQ statistics', async () => {
        const storage = getStorage();
        (storage.query as any).mockResolvedValueOnce([
            { status: 'pending', count: 5 },
            { status: 'resolved', count: 3 }
        ]);
        
        const stats = await getDeadLetterQueueStats();
        expect(stats.pending).toBe(5);
        expect(stats.resolved).toBe(3);
        expect(stats.total).toBe(8);
    });
});
