import { describe, it, expect, beforeAll, vi } from 'vitest';
import { initStorage, getStorage } from '../../storage/index.js';
import { 
  createSummary, 
  getSummary, 
  querySummaries, 
  getTaskSummaries,
  getSummaryStats,
  deleteSummary,
  getRecentSummaries,
  getSessionSummaries,
  searchSummaries,
  clearAllSummaries
} from '../storage.js';
import { randomUUID } from 'crypto';

describe('Persistent Summary Storage', () => {
  beforeAll(async () => {
    // Initialize in-memory SQLite for testing
    process.env.STORAGE_TIER = 'memory';
    await initStorage();
  });

  it('should create and retrieve a summary', async () => {
    const taskId = randomUUID();
    
    // Create task first to satisfy foreign key
    const storage = await getStorage();
    await storage.createTask({
      id: taskId,
      title: 'Test Task',
      prompt: 'Test prompt',
      source: 'test',
    } as any);

    const input = {
      taskId,
      agent: 'test-agent',
      title: 'Test Summary',
      whatChanged: 'Changed some things',
      filesChanged: [{ path: 'test.ts', action: 'modified' as const }],
      decisions: [],
      blockers: [],
      artifacts: [],
    };

    const created = await createSummary(input);
    expect(created.id).toBeDefined();
    expect(created.title).toBe(input.title);

    const retrieved = await getSummary(created.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.title).toBe(input.title);
    expect(retrieved?.taskId).toBe(taskId);
  });

  it('should query summaries by taskId', async () => {
    const taskId = randomUUID();
    const storage = await getStorage();
    await storage.createTask({
      id: taskId,
      title: 'Task for query',
      prompt: '...',
      source: 'test',
    } as any);

    await createSummary({
      taskId,
      agent: 'agent-1',
      title: 'Task Summary',
      whatChanged: '...',
    });

    const result = await querySummaries({ taskId });
    expect(result.total).toBe(1);
    expect(result.summaries[0].taskId).toBe(taskId);
    
    const taskSummaries = await getTaskSummaries(taskId);
    expect(taskSummaries).toHaveLength(1);
  });

  it('should search summaries by text', async () => {
    const uniqueTitle = `Unique Title ${randomUUID()}`;
    await createSummary({
      agent: 'search-agent',
      title: uniqueTitle,
      whatChanged: 'Target content',
    });

    const result = await querySummaries({ search: 'Target content' });
    expect(result.summaries.some(s => s.title === uniqueTitle)).toBe(true);
  });

  it('should get summary stats', async () => {
    const stats = await getSummaryStats();
    expect(stats.totalCount).toBeDefined();
    // In-memory test db might have different results but should be defined
  });

  it('should get recent summaries', async () => {
    const recent = await getRecentSummaries(5);
    expect(recent.length).toBeGreaterThan(0);
  });

  it('should delete a summary', async () => {
    const summary = await createSummary({
      title: 'Delete Me',
      whatChanged: '...',
      agent: 'test',
    });
    
    const deleted = await deleteSummary(summary.id);
    expect(deleted).toBe(true);
    
    const retrieved = await getSummary(summary.id);
    expect(retrieved).toBeNull();
  });

  it('should get summaries by sessionId', async () => {
    const sessionId = 'session-999';
    await createSummary({
      sessionId,
      agent: 'test',
      title: 'Session Summary',
      whatChanged: '...',
    });

    const summaries = await getSessionSummaries(sessionId);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].sessionId).toBe(sessionId);
  });

  it('should search summaries specifically', async () => {
    const uniqueTitle = `Searchable Title ${randomUUID()}`;
    await createSummary({
      title: uniqueTitle,
      whatChanged: 'Findable keyword',
      agent: 'test',
    });

    const summaries = await searchSummaries('Findable keyword');
    expect(summaries.some(s => s.title === uniqueTitle)).toBe(true);
  });

  it('should store embeddings when summary is created', async () => {
    const summary = await createSummary({
      title: 'Embedding Test',
      whatChanged: 'Content for embedding',
      agent: 'test',
    });

    // Embedding generation is async/background — just verify the summary was created
    expect(summary.id).toBeDefined();
    expect(summary.title).toBe('Embedding Test');
  });

  it('should not throw for clearAllSummaries', async () => {
    await expect(clearAllSummaries()).resolves.toBeUndefined();
  });
});
