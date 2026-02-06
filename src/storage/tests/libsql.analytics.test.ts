import { describe, it, expect, beforeAll } from 'vitest';
import { LibSQLAdapter } from '../libsql.js';
import { count } from 'drizzle-orm';
import { randomUUID } from 'crypto';

describe('LibSQLAdapter Analytics', () => {
  let adapter: LibSQLAdapter;

  beforeAll(async () => {
    adapter = new LibSQLAdapter({ dbPath: ':memory:' });
    await adapter.connect();
  });

  describe('Agent Stats and Analytics', () => {
    it('should generate agent stats', async () => {
      const now = new Date();
      const startedAt = new Date(now.getTime() - 10000);
      
      const taskId1 = randomUUID();
      // Create some tasks with different statuses and agents
      await adapter.createTask({
        id: taskId1,
        title: 'Task 1',
        prompt: 'Task 1 prompt',
        source: 'test',
        status: 'completed',
        assignedAgent: 'claude',
        startedAt,
        completedAt: now
      } as any);

      const taskId2 = randomUUID();
      await adapter.createTask({
        id: taskId2,
        title: 'Task 2',
        prompt: 'Task 2 prompt',
        source: 'test',
        status: 'failed',
        assignedAgent: 'claude',
        startedAt,
        completedAt: now
      } as any);

      const stats = await adapter.getAgentStats();
      expect(stats['claude']).toBeDefined();
      expect(stats['claude'].completed).toBeGreaterThanOrEqual(1);
      expect(stats['claude'].failed).toBeGreaterThanOrEqual(1);
    });

    it('should get task analytics', async () => {
      const analytics = await adapter.getTaskAnalytics?.();
      expect(analytics).toBeDefined();
      expect(analytics?.totalTasks).toBeGreaterThanOrEqual(2);
    });

    it('should get cost analytics', async () => {
      const taskId = randomUUID();
      await adapter.createTask({ id: taskId, title: 'Cost Task', prompt: '...', source: 'test' } as any);

      await adapter.createSummary({
        id: randomUUID(),
        taskId: taskId,
        agent: 'claude',
        title: 'Summary',
        whatChanged: 'None',
        cost: { amount: 0.05, currency: 'USD' },
        tokensUsed: { total: 1000 }
      } as any);

      const costAnalytics = await adapter.getCostAnalytics();
      expect(costAnalytics.totalCost).toBeGreaterThan(0);
      expect(costAnalytics.byAgent['claude']).toBeDefined();
      expect(costAnalytics.byAgent['claude'].cost).toBe(0.05);
    });
  });

  describe('Health Check', () => {
    it('should return health status', async () => {
      const health = await adapter.healthCheck();
      expect(health.healthy).toBe(true);
    });
  });
});
