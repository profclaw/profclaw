import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockInitBuiltInTemplates,
  mockListScheduledJobs,
} = vi.hoisted(() => ({
  mockInitBuiltInTemplates: vi.fn(() => Promise.resolve()),
  mockListScheduledJobs: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../../cron/scheduler.js', () => ({
  createScheduledJob: vi.fn(),
  getScheduledJob: vi.fn(),
  listScheduledJobs: mockListScheduledJobs,
  updateScheduledJob: vi.fn(),
  pauseScheduledJob: vi.fn(),
  resumeScheduledJob: vi.fn(),
  deleteScheduledJob: vi.fn(),
  archiveScheduledJob: vi.fn(),
  restoreScheduledJob: vi.fn(),
  triggerScheduledJob: vi.fn(),
  getJobRunHistory: vi.fn(),
  getScheduler: vi.fn(() => ({
    triggerByEvent: vi.fn(() => Promise.resolve({ triggered: [] })),
  })),
}));

vi.mock('../../cron/templates.js', () => ({
  listJobTemplates: vi.fn(() => Promise.resolve([])),
  getJobTemplate: vi.fn(),
  createJobTemplate: vi.fn(),
  deleteJobTemplate: vi.fn(),
  applyJobTemplate: vi.fn(),
  initBuiltInTemplates: mockInitBuiltInTemplates,
}));

vi.mock('../../utils/logger.js', () => ({
  createContextualLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import { Hono } from 'hono';
import { cronRoutes } from '../cron.js';

function makeApp() {
  const app = new Hono();
  app.route('/api/cron', cronRoutes);
  return app;
}

describe('cron route lazy initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not initialize templates on import', () => {
    expect(mockInitBuiltInTemplates).not.toHaveBeenCalled();
  });

  it('initializes templates once on first request', async () => {
    const app = makeApp();

    const first = await app.fetch(new Request('http://localhost/api/cron/jobs'));
    const second = await app.fetch(new Request('http://localhost/api/cron/jobs'));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mockInitBuiltInTemplates).toHaveBeenCalledTimes(1);
    expect(mockListScheduledJobs).toHaveBeenCalledTimes(2);
  });
});
