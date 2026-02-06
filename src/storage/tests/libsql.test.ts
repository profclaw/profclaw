import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LibSQLAdapter } from '../libsql.js';
import { randomUUID } from 'crypto';

describe('LibSQLAdapter', () => {
  let adapter: LibSQLAdapter;
  const testDbPath = ':memory:';

  beforeAll(async () => {
    adapter = new LibSQLAdapter({ dbPath: testDbPath });
    await adapter.connect();
  });

  describe('Tasks', () => {
    const testTask = {
      id: randomUUID(),
      title: 'Test Task',
      description: 'Test Description',
      prompt: 'Do something',
      source: 'unit-test',
      priority: 2,
    };

    it('should create and get a task', async () => {
      await adapter.createTask(testTask as any);
      const retrieved = await adapter.getTask(testTask.id);
      expect(retrieved).toMatchObject(testTask);
    });

    it('should update task status', async () => {
      await adapter.updateTask(testTask.id, { 
        status: 'completed', 
        result: 'All done',
        completedAt: new Date()
      });
      const retrieved = await adapter.getTask(testTask.id);
      expect(retrieved?.status).toBe('completed');
      expect(retrieved?.result).toBe('All done');
      expect(retrieved?.completedAt).toBeDefined();
    });

    it('should query tasks with filters', async () => {
      await adapter.createTask({
        id: randomUUID(),
        title: 'Another Task',
        prompt: 'Task 2',
        source: 'unit-test',
        status: 'pending',
      } as any);

      const { tasks: allTasks, total } = await adapter.getTasks();
      expect(allTasks.length).toBeGreaterThanOrEqual(2);
      expect(total).toBeGreaterThanOrEqual(2);

      const { tasks: pendingTasks } = await adapter.getTasks({ status: 'pending' });
      expect(pendingTasks.every(t => t.status === 'pending')).toBe(true);
    });
  });

  describe('Summaries', () => {
    it('should create and query summaries', async () => {
      const taskId = randomUUID();
      await adapter.createTask({
        id: taskId,
        title: 'Task for Summary',
        prompt: '...',
        source: 'test'
      } as any);

      const summaryInput = {
        taskId,
        agent: 'claude',
        title: 'Build success',
        whatChanged: 'Added tests',
        filesChanged: [{ path: 'test.ts', action: 'added' }],
        decisions: ['Use vitest'],
        blockers: [],
        artifacts: [],
      };

      const created = await adapter.createSummary(summaryInput as any);
      expect(created.id).toBeDefined();
      expect(created.title).toBe(summaryInput.title);

      const results = await adapter.querySummaries({ taskId });
      expect(results.total).toBe(1);
      expect(results.summaries[0].taskId).toBe(taskId);
    });
  });

  describe('Task Events', () => {
    it('should record and retrieve task events', async () => {
      const taskId = randomUUID();
      // Must create task first due to FK constraint
      await adapter.createTask({
        id: taskId,
        title: 'Event Task',
        prompt: '...',
        source: 'test'
      } as any);

      await adapter.recordTaskEvent({
        taskId,
        type: 'progress',
        message: 'Starting task',
        agentId: 'test-agent'
      });

      const events = await adapter.getTaskEvents(taskId);
      expect(events.length).toBe(1);
      expect(events[0].message).toBe('Starting task');
    });
  });

  describe('Stats & Analytics', () => {
    it('should return health check info', async () => {
      const health = await adapter.healthCheck();
      expect(health.healthy).toBe(true);
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should aggregate agent stats', async () => {
      const stats = await adapter.getAgentStats();
      expect(stats).toBeDefined();
    });
  });
});
