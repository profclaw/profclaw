import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JobScheduler } from '../scheduler.js';
import { getDb } from '../../storage/index.js';

// Mock dependencies
vi.mock('bullmq', () => {
    class MockQueue {
        constructor() {}
        add = vi.fn().mockResolvedValue({ id: 'bull-job-id' });
        close = vi.fn().mockResolvedValue(undefined);
        removeRepeatableByKey = vi.fn().mockResolvedValue(undefined);
    }
    class MockWorker {
        constructor() {}
        on = vi.fn();
        close = vi.fn().mockResolvedValue(undefined);
    }
    return {
        Queue: MockQueue,
        Worker: MockWorker,
        Job: vi.fn(),
    };
});

vi.mock('../../storage/index.js', () => ({
  getDb: vi.fn()
}));

vi.mock('../../storage/schema.js', () => ({
  scheduledJobs: { id: 'id', name: 'name' }, // Mock table objects
  jobRunHistory: { id: 'id', jobId: 'jobId' }
}));

describe('JobScheduler', () => {
  let scheduler: JobScheduler;
  let mockDb: any;

  // Helper to create thenable mocks for Drizzle queries
  const createQueryMock = (returnValue: any = []) => {
    const p = Promise.resolve(returnValue);
    const mock = Object.assign(p, {
      where: vi.fn(),
      limit: vi.fn(),
      orderBy: vi.fn(),
    });
    mock.where.mockReturnValue(mock);
    mock.limit.mockReturnValue(mock);
    mock.orderBy.mockReturnValue(mock);
    return mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockDb = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => createQueryMock([]))
      })),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue({ rowsAffected: 1 })
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue({ rowsAffected: 1, lastInsertRowid: '1' })
        })
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({ rowsAffected: 1 })
      }),
    };
    (getDb as any).mockResolvedValue(mockDb);

    scheduler = new JobScheduler();
  });

  describe('createJob', () => {
    it('should create and schedule a cron job', async () => {
      const params = {
        name: 'Test Job',
        cronExpression: '0 0 * * *',
        jobType: 'http' as const,
        payload: { url: 'https://example.com' },
      };

      const job = await scheduler.createJob(params);

      expect(job.name).toBe('Test Job');
      expect(job.status).toBe('active');
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should create a one-shot job', async () => {
      const runAt = new Date(Date.now() + 10000);
      const params = {
        name: 'One Shot',
        runAt,
        jobType: 'message' as const,
        payload: { content: 'hello' },
      };

      const job = await scheduler.createJob(params);

      expect(job.runAt).toEqual(runAt);
      expect(job.maxRuns).toBe(1);
    });
  });

  describe('Job Management', () => {
    it('should pause a job', async () => {
      // Mock result of update...set...where
      mockDb.update().set().where.mockResolvedValue({ rowsAffected: 1 });

      const result = await scheduler.pauseJob('job-1');

      expect(result).toBe(true);
    });

    it('should delete a job', async () => {
      mockDb.delete().where.mockResolvedValue({ rowsAffected: 1 });

      const result = await scheduler.deleteJob('job-2');

      expect(result).toBe(true);
    });
  });

  describe('Execution Logic', () => {
    it('should trigger a job immediately', async () => {
      const mockJob = { id: 'job-3', name: 'Trigger Me', status: 'active', jobType: 'http', payload: {} };
      const qm = createQueryMock([mockJob]);
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => qm)
      }));

      const result = await scheduler.triggerJob('job-3');

      expect(result).not.toBeNull();
    });
  });

  describe('Lifecycle & Execution', () => {
    it('should start and stop the scheduler', async () => {
      await scheduler.start();
      // @ts-ignore
      expect(scheduler.isRunning).toBe(true);
      
      await scheduler.stop();
      // @ts-ignore
      expect(scheduler.isRunning).toBe(false);
    });

    it('should execute an HTTP job', async () => {
      const mockJob = { 
          id: 'job-http', 
          name: 'HTTP Job', 
          status: 'active', 
          jobType: 'http', 
          payload: { url: 'https://api.test/hook' },
          runCount: 0,
          successCount: 0,
          failureCount: 0
      };
      const qm = createQueryMock([mockJob]);
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => qm)
      }));
      
      // Mock fetch
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve('success_payload')
      });

      await scheduler.triggerJob('job-http');
      
      expect(global.fetch).toHaveBeenCalledWith('https://api.test/hook', expect.any(Object));
      expect(mockDb.insert).toHaveBeenCalled(); // Record run history
      expect(mockDb.update).toHaveBeenCalled(); // Update stats
    });

    it('should execute a script job', async () => {
        const mockJob = { 
            id: 'job-script', 
            name: 'Script Job', 
            status: 'active', 
            jobType: 'script', 
            payload: { command: 'echo hello' },
            runCount: 0,
            successCount: 0,
            failureCount: 0
        };
        const qm = createQueryMock([mockJob]);
        mockDb.select.mockImplementation(() => ({ from: () => qm }));
        
        await scheduler.triggerJob('job-script');
        
        expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should trigger jobs by event', async () => {
        const mockJob = { 
            id: 'job-event', 
            name: 'Event Job', 
            status: 'active', 
            eventTrigger: { type: 'webhook', config: { source: 'github' } },
            jobType: 'http',
            payload: { url: 'http://test' },
            runCount: 0,
            successCount: 0,
            failureCount: 0
        };
        const qm = createQueryMock([mockJob]);
        mockDb.select.mockImplementation(() => ({ from: () => qm }));
  
        const result = await scheduler.triggerByEvent('webhook', { source: 'github' });
        
        expect(result.triggered).toContain('job-event');
    });

    it('should execute a message job', async () => {
        const mockJob = { 
            id: 'job-msg', 
            name: 'Message Job', 
            status: 'active', 
            jobType: 'message', 
            payload: { conversationId: 'c1', content: 'hello' },
            runCount: 0,
            successCount: 0,
            failureCount: 0
        };
        const qm = createQueryMock([mockJob]);
        mockDb.select.mockImplementation(() => ({ from: () => qm }));
        
        await scheduler.triggerJob('job-msg');
        
        expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should update a job', async () => {
        const mockJob = { id: 'job-upd', name: 'Old Name', status: 'active' };
        const qm = createQueryMock([mockJob]);
        mockDb.select.mockImplementation(() => ({ from: () => qm }));
        mockDb.update().set().where.mockResolvedValue({ rowsAffected: 1 });

        const result = await scheduler.updateJob('job-upd', { name: 'New Name' });

        expect(result).not.toBeNull();
        expect(mockDb.update).toHaveBeenCalled();
    });

    it('should resume a job', async () => {
        const mockJob = { id: 'job-res', status: 'paused', cronExpression: '0 0 * * *' };
        const qm = createQueryMock([mockJob]);
        mockDb.select.mockImplementation(() => ({ from: () => qm }));
        mockDb.update().set().where.mockResolvedValue({ rowsAffected: 1 });

        const result = await scheduler.resumeJob('job-res');

        expect(result).toBe(true);
    });

    it('should archive and restore a job', async () => {
        const mockJob = { id: 'job-arc', status: 'archived', cronExpression: '0 0 * * *' };
        const qm = createQueryMock([mockJob]);
        mockDb.select.mockImplementation(() => ({ from: () => qm }));
        mockDb.update().set().where.mockResolvedValue({ rowsAffected: 1 });

        const archived = await scheduler.archiveJob('job-arc');
        expect(archived).toBe(true);

        const restored = await scheduler.restoreJob('job-arc');
        expect(restored).toBe(true);
    });

    it('should get job run history', async () => {
        const mockHistory = [
            { id: 'h1', startedAt: new Date(), status: 'success', triggeredBy: 'manual' }
        ];
        const qm = createQueryMock(mockHistory);
        mockDb.select.mockImplementation(() => ({ from: () => qm }));

        const history = await scheduler.getJobHistory('job-1');
        expect(history.length).toBe(1);
    });
  });

  describe('Utility', () => {
    it('should match event triggers correctly', () => {
      const trigger = {
        type: 'file' as const,
        config: { pathPattern: '\\.js$' }
      };

      // @ts-ignore - accessing private method
      const matches = scheduler.matchesEventTrigger(trigger, { path: 'test.js' });
      expect(matches).toBe(true);

      // @ts-ignore
      const noMatch = scheduler.matchesEventTrigger(trigger, { path: 'test.txt' });
      expect(noMatch).toBe(false);
    });
  });
});
