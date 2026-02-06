import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../queue/index.js', () => ({
  addTask: vi.fn(),
  getTask: vi.fn(() => null),
  getTasks: vi.fn(() => []),
  cancelTask: vi.fn(),
  retryTask: vi.fn(),
}));

vi.mock('../../storage/index.js', () => ({
  getStorage: vi.fn(() => ({
    archiveOldTasks: vi.fn(async () => ({ archived: 0 })),
  })),
}));

import { Hono } from 'hono';
import { getStorage } from '../../storage/index.js';
import { tasksRoutes } from '../tasks.js';

function makeApp() {
  const app = new Hono();
  app.route('/api/tasks', tasksRoutes);
  return app;
}

describe('tasks routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getStorage).mockReturnValue({
      archiveOldTasks: vi.fn(async () => ({ archived: 0 })),
    } as never);
  });

  it('returns 400 for malformed JSON on archive', async () => {
    const app = makeApp();
    const res = await app.fetch(new Request('http://localhost/api/tasks/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"olderThanDays":',
    }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 400 for non-object JSON on archive', async () => {
    const app = makeApp();
    const res = await app.fetch(new Request('http://localhost/api/tasks/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(['not-an-object']),
    }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Request body must be a JSON object');
  });

  it('returns 400 for invalid olderThanDays on archive', async () => {
    const app = makeApp();
    const res = await app.fetch(new Request('http://localhost/api/tasks/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ olderThanDays: 0 }),
    }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('olderThanDays must be a positive number');
  });

  it('returns 400 for malformed JSON on import', async () => {
    const app = makeApp();
    const res = await app.fetch(new Request('http://localhost/api/tasks/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"version":',
    }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 400 for invalid task status filters', async () => {
    const app = makeApp();
    const res = await app.fetch(new Request('http://localhost/api/tasks?status=not-a-status'));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid status');
  });
});
