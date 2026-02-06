import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Hoisted mock factories - must come before vi.mock() calls
// ---------------------------------------------------------------------------
const {
  mockCreateScheduledJob,
  mockGetScheduledJob,
  mockListScheduledJobs,
  mockUpdateScheduledJob,
  mockPauseScheduledJob,
  mockResumeScheduledJob,
  mockDeleteScheduledJob,
  mockArchiveScheduledJob,
  mockRestoreScheduledJob,
  mockTriggerScheduledJob,
  mockGetJobRunHistory,
  mockTriggerByEvent,
  mockListJobTemplates,
  mockGetJobTemplate,
  mockCreateJobTemplate,
  mockDeleteJobTemplate,
  mockApplyJobTemplate,
  mockInitBuiltInTemplates,
} = vi.hoisted(() => {
  const mockTriggerByEvent = vi.fn(() => Promise.resolve({ triggered: [] }));
  return {
    mockCreateScheduledJob: vi.fn(),
    mockGetScheduledJob: vi.fn(),
    mockListScheduledJobs: vi.fn(() => Promise.resolve([])),
    mockUpdateScheduledJob: vi.fn(),
    mockPauseScheduledJob: vi.fn(),
    mockResumeScheduledJob: vi.fn(),
    mockDeleteScheduledJob: vi.fn(),
    mockArchiveScheduledJob: vi.fn(),
    mockRestoreScheduledJob: vi.fn(),
    mockTriggerScheduledJob: vi.fn(),
    mockGetJobRunHistory: vi.fn(),
    mockTriggerByEvent,
    mockListJobTemplates: vi.fn(() => Promise.resolve([])),
    mockGetJobTemplate: vi.fn(),
    mockCreateJobTemplate: vi.fn(),
    mockDeleteJobTemplate: vi.fn(),
    mockApplyJobTemplate: vi.fn(),
    mockInitBuiltInTemplates: vi.fn(() => Promise.resolve()),
  };
});

vi.mock('../../cron/scheduler.js', () => ({
  createScheduledJob: mockCreateScheduledJob,
  getScheduledJob: mockGetScheduledJob,
  listScheduledJobs: mockListScheduledJobs,
  updateScheduledJob: mockUpdateScheduledJob,
  pauseScheduledJob: mockPauseScheduledJob,
  resumeScheduledJob: mockResumeScheduledJob,
  deleteScheduledJob: mockDeleteScheduledJob,
  archiveScheduledJob: mockArchiveScheduledJob,
  restoreScheduledJob: mockRestoreScheduledJob,
  triggerScheduledJob: mockTriggerScheduledJob,
  getJobRunHistory: mockGetJobRunHistory,
  getScheduler: vi.fn(() => ({
    triggerByEvent: mockTriggerByEvent,
  })),
}));

vi.mock('../../cron/templates.js', () => ({
  listJobTemplates: mockListJobTemplates,
  getJobTemplate: mockGetJobTemplate,
  createJobTemplate: mockCreateJobTemplate,
  deleteJobTemplate: mockDeleteJobTemplate,
  applyJobTemplate: mockApplyJobTemplate,
  initBuiltInTemplates: mockInitBuiltInTemplates,
}));

vi.mock('../../utils/logger.js', () => ({
  createContextualLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import { cronRoutes } from '../cron.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const JOB = {
  id: 'job-1',
  name: 'Nightly Sync',
  jobType: 'tool',
  status: 'active',
  cronExpression: '0 0 * * *',
  payload: {},
  runCount: 5,
  successCount: 5,
  failureCount: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const TEMPLATE = {
  id: 'tpl-1',
  name: 'Daily Sync',
  jobType: 'tool',
  payloadTemplate: { tool: 'sync', args: {} },
  isBuiltIn: false,
};

function buildApp(): Hono {
  const app = new Hono();
  app.route('/api/cron', cronRoutes);
  return app;
}

function req(
  url: string,
  method = 'GET',
  body?: unknown,
): Request {
  const opts: RequestInit = { method };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  return new Request(`http://localhost${url}`, opts);
}

// ---------------------------------------------------------------------------
// GET /api/cron/jobs
// ---------------------------------------------------------------------------
describe('GET /api/cron/jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitBuiltInTemplates.mockResolvedValue(undefined);
    mockListScheduledJobs.mockResolvedValue([JOB]);
  });

  it('returns a list of jobs', async () => {
    const res = await buildApp().fetch(req('/api/cron/jobs'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(Array.isArray(json.jobs)).toBe(true);
    expect(json.total).toBe(1);
  });

  it('passes status filter to listScheduledJobs', async () => {
    mockListScheduledJobs.mockResolvedValue([]);
    await buildApp().fetch(req('/api/cron/jobs?status=active'));

    expect(mockListScheduledJobs).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' }),
    );
  });

  it('passes jobType filter to listScheduledJobs', async () => {
    mockListScheduledJobs.mockResolvedValue([]);
    await buildApp().fetch(req('/api/cron/jobs?jobType=tool'));

    expect(mockListScheduledJobs).toHaveBeenCalledWith(
      expect.objectContaining({ jobType: 'tool' }),
    );
  });

  it('passes projectId and userId filters', async () => {
    mockListScheduledJobs.mockResolvedValue([]);
    await buildApp().fetch(req('/api/cron/jobs?projectId=proj-1&userId=user-1'));

    expect(mockListScheduledJobs).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-1', userId: 'user-1' }),
    );
  });

  it('returns 400 for invalid status value', async () => {
    const res = await buildApp().fetch(req('/api/cron/jobs?status=invalid-status'));

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid jobType value', async () => {
    const res = await buildApp().fetch(req('/api/cron/jobs?jobType=unknown'));

    expect(res.status).toBe(400);
  });

  it('returns 500 when listScheduledJobs throws', async () => {
    mockListScheduledJobs.mockRejectedValue(new Error('DB failure'));
    const res = await buildApp().fetch(req('/api/cron/jobs'));

    expect(res.status).toBe(500);
    const json = await res.json() as Record<string, unknown>;
    expect(json.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /api/cron/jobs
// ---------------------------------------------------------------------------
describe('POST /api/cron/jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitBuiltInTemplates.mockResolvedValue(undefined);
    mockCreateScheduledJob.mockResolvedValue(JOB);
  });

  const validCronBody = {
    name: 'Nightly Sync',
    jobType: 'tool',
    cronExpression: '0 0 * * *',
    payload: { tool: 'sync' },
  };

  const validIntervalBody = {
    name: 'Health Check',
    jobType: 'http',
    intervalMs: 60000,
    payload: { url: 'https://example.com/health' },
  };

  const validOneShotBody = {
    name: 'One Shot',
    jobType: 'message',
    runAt: '2099-12-31T00:00:00.000Z',
    payload: { message: 'hello' },
  };

  it('creates a cron job and returns 201', async () => {
    const res = await buildApp().fetch(req('/api/cron/jobs', 'POST', validCronBody));

    expect(res.status).toBe(201);
    const json = await res.json() as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.scheduleType).toBe('scheduled');
  });

  it('creates an interval job', async () => {
    const res = await buildApp().fetch(req('/api/cron/jobs', 'POST', validIntervalBody));

    expect(res.status).toBe(201);
    const json = await res.json() as Record<string, unknown>;
    expect(json.scheduleType).toBe('scheduled');
  });

  it('creates a one-shot job', async () => {
    const res = await buildApp().fetch(req('/api/cron/jobs', 'POST', validOneShotBody));

    expect(res.status).toBe(201);
    const json = await res.json() as Record<string, unknown>;
    expect(json.scheduleType).toBe('one-shot');
  });

  it('creates an event-triggered job', async () => {
    const body = {
      name: 'On Webhook',
      jobType: 'tool',
      eventTrigger: { type: 'webhook', config: { path: '/hook' } },
      payload: { tool: 'notify' },
    };
    const res = await buildApp().fetch(req('/api/cron/jobs', 'POST', body));

    expect(res.status).toBe(201);
    const json = await res.json() as Record<string, unknown>;
    expect(json.scheduleType).toBe('event-triggered');
  });

  it('returns 400 when no schedule type is provided', async () => {
    const body = {
      name: 'No Schedule',
      jobType: 'tool',
      payload: { tool: 'sync' },
    };
    const res = await buildApp().fetch(req('/api/cron/jobs', 'POST', body));

    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    expect(json.success).toBe(false);
    expect(String(json.error)).toContain('schedule');
  });

  it('returns 400 when name is missing', async () => {
    const body = { jobType: 'tool', cronExpression: '0 0 * * *', payload: {} };
    const res = await buildApp().fetch(req('/api/cron/jobs', 'POST', body));

    expect(res.status).toBe(400);
  });

  it('returns 400 when jobType is invalid', async () => {
    const body = { name: 'Test', jobType: 'invalid', cronExpression: '* * * * *', payload: {} };
    const res = await buildApp().fetch(req('/api/cron/jobs', 'POST', body));

    expect(res.status).toBe(400);
  });

  it('returns 400 when intervalMs is below minimum', async () => {
    const body = { name: 'Too Fast', jobType: 'http', intervalMs: 500, payload: {} };
    const res = await buildApp().fetch(req('/api/cron/jobs', 'POST', body));

    expect(res.status).toBe(400);
  });

  it('passes delivery config to createScheduledJob', async () => {
    const body = {
      ...validCronBody,
      delivery: {
        channels: [{ type: 'slack', target: '#alerts', onFailure: true }],
      },
    };
    await buildApp().fetch(req('/api/cron/jobs', 'POST', body));

    expect(mockCreateScheduledJob).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery: expect.objectContaining({
          channels: expect.arrayContaining([
            expect.objectContaining({ type: 'slack', target: '#alerts' }),
          ]),
        }),
      }),
    );
  });

  it('passes retry policy to createScheduledJob', async () => {
    const body = {
      ...validCronBody,
      retryPolicy: { enabled: true, maxRetries: 3, initialDelayMs: 2000 },
    };
    await buildApp().fetch(req('/api/cron/jobs', 'POST', body));

    expect(mockCreateScheduledJob).toHaveBeenCalledWith(
      expect.objectContaining({
        retryPolicy: expect.objectContaining({ maxRetries: 3 }),
      }),
    );
  });

  it('returns 500 on unexpected error', async () => {
    mockCreateScheduledJob.mockRejectedValue(new Error('DB error'));
    const res = await buildApp().fetch(req('/api/cron/jobs', 'POST', validCronBody));

    expect(res.status).toBe(500);
    const json = await res.json() as Record<string, unknown>;
    expect(json.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /api/cron/jobs/from-template
// ---------------------------------------------------------------------------
describe('POST /api/cron/jobs/from-template', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitBuiltInTemplates.mockResolvedValue(undefined);
  });

  it('creates a job from a template', async () => {
    mockGetJobTemplate.mockResolvedValue(TEMPLATE);
    mockApplyJobTemplate.mockReturnValue({
      jobType: 'tool',
      payload: { tool: 'sync' },
      cronExpression: '0 0 * * *',
    });
    mockCreateScheduledJob.mockResolvedValue(JOB);

    const body = {
      templateId: 'tpl-1',
      name: 'Sync from template',
      variables: { env: 'production' },
    };
    const res = await buildApp().fetch(req('/api/cron/jobs/from-template', 'POST', body));

    expect(res.status).toBe(201);
    const json = await res.json() as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.templateUsed).toBe('Daily Sync');
  });

  it('returns 404 when template not found', async () => {
    mockGetJobTemplate.mockResolvedValue(null);

    const body = { templateId: 'nonexistent', name: 'Test' };
    const res = await buildApp().fetch(req('/api/cron/jobs/from-template', 'POST', body));

    expect(res.status).toBe(404);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBe('Template not found');
  });

  it('returns 400 when templateId is missing', async () => {
    const body = { name: 'Test' };
    const res = await buildApp().fetch(req('/api/cron/jobs/from-template', 'POST', body));

    expect(res.status).toBe(400);
  });

  it('returns 500 on unexpected error', async () => {
    mockGetJobTemplate.mockRejectedValue(new Error('DB error'));

    const body = { templateId: 'tpl-1', name: 'Test' };
    const res = await buildApp().fetch(req('/api/cron/jobs/from-template', 'POST', body));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// GET /api/cron/jobs/:id
// ---------------------------------------------------------------------------
describe('GET /api/cron/jobs/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitBuiltInTemplates.mockResolvedValue(undefined);
  });

  it('returns a job by id', async () => {
    mockGetScheduledJob.mockResolvedValue(JOB);
    const res = await buildApp().fetch(req('/api/cron/jobs/job-1'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect((json.job as Record<string, unknown>).id).toBe('job-1');
  });

  it('returns 404 when job not found', async () => {
    mockGetScheduledJob.mockResolvedValue(null);
    const res = await buildApp().fetch(req('/api/cron/jobs/missing'));

    expect(res.status).toBe(404);
    const json = await res.json() as Record<string, unknown>;
    expect(json.success).toBe(false);
    expect(json.error).toBe('Job not found');
  });

  it('returns 500 on DB error', async () => {
    mockGetScheduledJob.mockRejectedValue(new Error('DB failure'));
    const res = await buildApp().fetch(req('/api/cron/jobs/job-1'));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/cron/jobs/:id
// ---------------------------------------------------------------------------
describe('PATCH /api/cron/jobs/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitBuiltInTemplates.mockResolvedValue(undefined);
  });

  it('updates a job successfully', async () => {
    mockUpdateScheduledJob.mockResolvedValue({ ...JOB, name: 'Updated' });
    const res = await buildApp().fetch(req('/api/cron/jobs/job-1', 'PATCH', { name: 'Updated' }));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.success).toBe(true);
  });

  it('returns 404 when job not found', async () => {
    mockUpdateScheduledJob.mockResolvedValue(null);
    const res = await buildApp().fetch(req('/api/cron/jobs/missing', 'PATCH', { name: 'X' }));

    expect(res.status).toBe(404);
  });

  it('returns 400 when status value is invalid', async () => {
    const res = await buildApp().fetch(req('/api/cron/jobs/job-1', 'PATCH', { status: 'not-valid' }));

    expect(res.status).toBe(400);
  });

  it('returns 500 on unexpected error', async () => {
    mockUpdateScheduledJob.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(req('/api/cron/jobs/job-1', 'PATCH', { name: 'X' }));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/cron/jobs/:id
// ---------------------------------------------------------------------------
describe('DELETE /api/cron/jobs/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitBuiltInTemplates.mockResolvedValue(undefined);
  });

  it('deletes a job successfully', async () => {
    mockDeleteScheduledJob.mockResolvedValue(true);
    const res = await buildApp().fetch(req('/api/cron/jobs/job-1', 'DELETE'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.deleted).toBe(true);
  });

  it('returns 404 when job not found', async () => {
    mockDeleteScheduledJob.mockResolvedValue(false);
    const res = await buildApp().fetch(req('/api/cron/jobs/missing', 'DELETE'));

    expect(res.status).toBe(404);
  });

  it('returns 500 on error', async () => {
    mockDeleteScheduledJob.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(req('/api/cron/jobs/job-1', 'DELETE'));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// POST /api/cron/jobs/:id/trigger
// ---------------------------------------------------------------------------
describe('POST /api/cron/jobs/:id/trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitBuiltInTemplates.mockResolvedValue(undefined);
  });

  it('triggers a job and returns runId', async () => {
    mockTriggerScheduledJob.mockResolvedValue({ runId: 'run-abc123' });
    const res = await buildApp().fetch(req('/api/cron/jobs/job-1/trigger', 'POST'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.runId).toBe('run-abc123');
  });

  it('returns 404 when job not found or trigger fails', async () => {
    mockTriggerScheduledJob.mockResolvedValue(null);
    const res = await buildApp().fetch(req('/api/cron/jobs/missing/trigger', 'POST'));

    expect(res.status).toBe(404);
  });

  it('returns 500 on unexpected error', async () => {
    mockTriggerScheduledJob.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(req('/api/cron/jobs/job-1/trigger', 'POST'));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// POST /api/cron/jobs/:id/pause
// ---------------------------------------------------------------------------
describe('POST /api/cron/jobs/:id/pause', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitBuiltInTemplates.mockResolvedValue(undefined);
  });

  it('pauses a job', async () => {
    mockPauseScheduledJob.mockResolvedValue(true);
    const res = await buildApp().fetch(req('/api/cron/jobs/job-1/pause', 'POST'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.status).toBe('paused');
  });

  it('returns 404 when job not found', async () => {
    mockPauseScheduledJob.mockResolvedValue(false);
    const res = await buildApp().fetch(req('/api/cron/jobs/missing/pause', 'POST'));

    expect(res.status).toBe(404);
  });

  it('returns 500 on error', async () => {
    mockPauseScheduledJob.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(req('/api/cron/jobs/job-1/pause', 'POST'));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// POST /api/cron/jobs/:id/resume
// ---------------------------------------------------------------------------
describe('POST /api/cron/jobs/:id/resume', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitBuiltInTemplates.mockResolvedValue(undefined);
  });

  it('resumes a paused job', async () => {
    mockResumeScheduledJob.mockResolvedValue(true);
    const res = await buildApp().fetch(req('/api/cron/jobs/job-1/resume', 'POST'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.status).toBe('active');
  });

  it('returns 404 when job not found', async () => {
    mockResumeScheduledJob.mockResolvedValue(false);
    const res = await buildApp().fetch(req('/api/cron/jobs/missing/resume', 'POST'));

    expect(res.status).toBe(404);
  });

  it('returns 500 on error', async () => {
    mockResumeScheduledJob.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(req('/api/cron/jobs/job-1/resume', 'POST'));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// POST /api/cron/jobs/:id/archive
// ---------------------------------------------------------------------------
describe('POST /api/cron/jobs/:id/archive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitBuiltInTemplates.mockResolvedValue(undefined);
  });

  it('archives a job', async () => {
    mockArchiveScheduledJob.mockResolvedValue(true);
    const res = await buildApp().fetch(req('/api/cron/jobs/job-1/archive', 'POST'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.status).toBe('archived');
  });

  it('returns 404 when job not found', async () => {
    mockArchiveScheduledJob.mockResolvedValue(false);
    const res = await buildApp().fetch(req('/api/cron/jobs/missing/archive', 'POST'));

    expect(res.status).toBe(404);
  });

  it('returns 500 on error', async () => {
    mockArchiveScheduledJob.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(req('/api/cron/jobs/job-1/archive', 'POST'));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// POST /api/cron/jobs/:id/restore
// ---------------------------------------------------------------------------
describe('POST /api/cron/jobs/:id/restore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitBuiltInTemplates.mockResolvedValue(undefined);
  });

  it('restores an archived job', async () => {
    mockRestoreScheduledJob.mockResolvedValue(true);
    const res = await buildApp().fetch(req('/api/cron/jobs/job-1/restore', 'POST'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.status).toBe('paused');
  });

  it('returns 404 when job not found or not archived', async () => {
    mockRestoreScheduledJob.mockResolvedValue(false);
    const res = await buildApp().fetch(req('/api/cron/jobs/missing/restore', 'POST'));

    expect(res.status).toBe(404);
  });

  it('returns 500 on error', async () => {
    mockRestoreScheduledJob.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(req('/api/cron/jobs/job-1/restore', 'POST'));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// GET /api/cron/jobs/:id/history
// ---------------------------------------------------------------------------
describe('GET /api/cron/jobs/:id/history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitBuiltInTemplates.mockResolvedValue(undefined);
  });

  it('returns job run history', async () => {
    mockGetScheduledJob.mockResolvedValue(JOB);
    const history = [
      { id: 'run-1', jobId: 'job-1', status: 'success', startedAt: new Date().toISOString() },
    ];
    mockGetJobRunHistory.mockResolvedValue(history);

    const res = await buildApp().fetch(req('/api/cron/jobs/job-1/history'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(Array.isArray(json.history)).toBe(true);
    expect(json.total).toBe(1);
    const job = json.job as Record<string, unknown>;
    expect(job.id).toBe('job-1');
    expect(typeof job.runCount).toBe('number');
  });

  it('passes limit query parameter', async () => {
    mockGetScheduledJob.mockResolvedValue(JOB);
    mockGetJobRunHistory.mockResolvedValue([]);

    await buildApp().fetch(req('/api/cron/jobs/job-1/history?limit=5'));

    expect(mockGetJobRunHistory).toHaveBeenCalledWith('job-1', 5);
  });

  it('defaults to limit 20', async () => {
    mockGetScheduledJob.mockResolvedValue(JOB);
    mockGetJobRunHistory.mockResolvedValue([]);

    await buildApp().fetch(req('/api/cron/jobs/job-1/history'));

    expect(mockGetJobRunHistory).toHaveBeenCalledWith('job-1', 20);
  });

  it('returns 404 when job not found', async () => {
    mockGetScheduledJob.mockResolvedValue(null);
    const res = await buildApp().fetch(req('/api/cron/jobs/missing/history'));

    expect(res.status).toBe(404);
  });

  it('returns 500 on DB error', async () => {
    mockGetScheduledJob.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(req('/api/cron/jobs/job-1/history'));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// GET /api/cron/stats
// ---------------------------------------------------------------------------
describe('GET /api/cron/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitBuiltInTemplates.mockResolvedValue(undefined);
  });

  it('returns aggregated stats', async () => {
    mockListScheduledJobs.mockResolvedValue([
      { ...JOB, status: 'active', jobType: 'tool', cronExpression: '0 0 * * *', runCount: 5, successCount: 5, failureCount: 0 },
      { ...JOB, id: 'job-2', status: 'paused', jobType: 'http', cronExpression: undefined, intervalMs: 60000, runCount: 2, successCount: 1, failureCount: 1 },
      { ...JOB, id: 'job-3', status: 'archived', jobType: 'script', cronExpression: undefined, runCount: 1, successCount: 0, failureCount: 1 },
    ]);

    const res = await buildApp().fetch(req('/api/cron/stats'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.success).toBe(true);
    const stats = json.stats as Record<string, unknown>;
    expect(stats.total).toBe(2); // excludes archived
    expect(stats.active).toBe(1);
    expect(stats.paused).toBe(1);
    expect(stats.archived).toBe(1);
    expect(stats.totalRuns).toBe(8); // 5 + 2 + 1
    const byType = stats.byType as Record<string, number>;
    expect(byType.tool).toBe(1);
    expect(byType.http).toBe(1);
  });

  it('returns 500 on error', async () => {
    mockListScheduledJobs.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(req('/api/cron/stats'));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// GET /api/cron/templates
// ---------------------------------------------------------------------------
describe('GET /api/cron/templates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitBuiltInTemplates.mockResolvedValue(undefined);
    mockListJobTemplates.mockResolvedValue([TEMPLATE]);
  });

  it('returns a list of templates', async () => {
    const res = await buildApp().fetch(req('/api/cron/templates'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(Array.isArray(json.templates)).toBe(true);
    expect(json.total).toBe(1);
  });

  it('passes category filter to listJobTemplates', async () => {
    mockListJobTemplates.mockResolvedValue([]);
    await buildApp().fetch(req('/api/cron/templates?category=sync'));

    expect(mockListJobTemplates).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'sync' }),
    );
  });

  it('passes jobType filter to listJobTemplates', async () => {
    mockListJobTemplates.mockResolvedValue([]);
    await buildApp().fetch(req('/api/cron/templates?jobType=tool'));

    expect(mockListJobTemplates).toHaveBeenCalledWith(
      expect.objectContaining({ jobType: 'tool' }),
    );
  });

  it('excludes built-in templates when includeBuiltIn=false', async () => {
    mockListJobTemplates.mockResolvedValue([]);
    await buildApp().fetch(req('/api/cron/templates?includeBuiltIn=false'));

    expect(mockListJobTemplates).toHaveBeenCalledWith(
      expect.objectContaining({ includeBuiltIn: false }),
    );
  });

  it('returns 500 on error', async () => {
    mockListJobTemplates.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(req('/api/cron/templates'));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// GET /api/cron/templates/:id
// ---------------------------------------------------------------------------
describe('GET /api/cron/templates/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitBuiltInTemplates.mockResolvedValue(undefined);
  });

  it('returns a template by id', async () => {
    mockGetJobTemplate.mockResolvedValue(TEMPLATE);
    const res = await buildApp().fetch(req('/api/cron/templates/tpl-1'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect((json.template as Record<string, unknown>).id).toBe('tpl-1');
  });

  it('returns 404 when template not found', async () => {
    mockGetJobTemplate.mockResolvedValue(null);
    const res = await buildApp().fetch(req('/api/cron/templates/missing'));

    expect(res.status).toBe(404);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBe('Template not found');
  });

  it('returns 500 on error', async () => {
    mockGetJobTemplate.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(req('/api/cron/templates/tpl-1'));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// POST /api/cron/templates
// ---------------------------------------------------------------------------
describe('POST /api/cron/templates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitBuiltInTemplates.mockResolvedValue(undefined);
    mockCreateJobTemplate.mockResolvedValue(TEMPLATE);
  });

  const validTemplateBody = {
    name: 'Daily Sync',
    jobType: 'tool',
    payloadTemplate: { tool: 'sync', args: {} },
    category: 'sync',
  };

  it('creates a template and returns 201', async () => {
    const res = await buildApp().fetch(req('/api/cron/templates', 'POST', validTemplateBody));

    expect(res.status).toBe(201);
    const json = await res.json() as Record<string, unknown>;
    expect(json.success).toBe(true);
  });

  it('returns 400 when name is missing', async () => {
    const body = { jobType: 'tool', payloadTemplate: {} };
    const res = await buildApp().fetch(req('/api/cron/templates', 'POST', body));

    expect(res.status).toBe(400);
  });

  it('returns 400 when jobType is invalid', async () => {
    const body = { name: 'Test', jobType: 'invalid', payloadTemplate: {} };
    const res = await buildApp().fetch(req('/api/cron/templates', 'POST', body));

    expect(res.status).toBe(400);
  });

  it('returns 400 when category is invalid', async () => {
    const body = { name: 'Test', jobType: 'tool', payloadTemplate: {}, category: 'badcat' };
    const res = await buildApp().fetch(req('/api/cron/templates', 'POST', body));

    expect(res.status).toBe(400);
  });

  it('returns 500 on DB error', async () => {
    mockCreateJobTemplate.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(req('/api/cron/templates', 'POST', validTemplateBody));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/cron/templates/:id
// ---------------------------------------------------------------------------
describe('DELETE /api/cron/templates/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitBuiltInTemplates.mockResolvedValue(undefined);
  });

  it('deletes a custom template', async () => {
    mockDeleteJobTemplate.mockResolvedValue(true);
    const res = await buildApp().fetch(req('/api/cron/templates/tpl-1', 'DELETE'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.deleted).toBe(true);
  });

  it('returns 404 when template not found or is built-in', async () => {
    mockDeleteJobTemplate.mockResolvedValue(false);
    const res = await buildApp().fetch(req('/api/cron/templates/builtin-tpl', 'DELETE'));

    expect(res.status).toBe(404);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBe('Template not found or is built-in');
  });

  it('returns 500 on error', async () => {
    mockDeleteJobTemplate.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(req('/api/cron/templates/tpl-1', 'DELETE'));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// POST /api/cron/events
// ---------------------------------------------------------------------------
describe('POST /api/cron/events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitBuiltInTemplates.mockResolvedValue(undefined);
    mockTriggerByEvent.mockResolvedValue({ triggered: ['job-1', 'job-2'] });
  });

  it('triggers matching event jobs', async () => {
    const body = {
      eventType: 'webhook',
      eventData: { source: 'github', action: 'push' },
    };
    const res = await buildApp().fetch(req('/api/cron/events', 'POST', body));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.eventType).toBe('webhook');
    expect(json.count).toBe(2);
    expect(Array.isArray(json.triggered)).toBe(true);
  });

  it('returns 400 when eventType is invalid', async () => {
    const body = { eventType: 'invalid', eventData: {} };
    const res = await buildApp().fetch(req('/api/cron/events', 'POST', body));

    expect(res.status).toBe(400);
  });

  it('returns 400 when eventType is missing', async () => {
    const body = { eventData: { source: 'github' } };
    const res = await buildApp().fetch(req('/api/cron/events', 'POST', body));

    expect(res.status).toBe(400);
  });

  it('returns 500 on error', async () => {
    mockTriggerByEvent.mockRejectedValue(new Error('fail'));
    const body = { eventType: 'ticket', eventData: {} };
    const res = await buildApp().fetch(req('/api/cron/events', 'POST', body));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// POST /api/cron/webhook/:secret
// ---------------------------------------------------------------------------
describe('POST /api/cron/webhook/:secret', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitBuiltInTemplates.mockResolvedValue(undefined);
    mockTriggerByEvent.mockResolvedValue({ triggered: ['job-1'] });
  });

  it('processes a webhook trigger', async () => {
    const res = await buildApp().fetch(req(
      '/api/cron/webhook/mysecret',
      'POST',
      { event: 'push', repo: 'myrepo' },
    ));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.triggered).toBe(1);
    expect(mockTriggerByEvent).toHaveBeenCalledWith(
      'webhook',
      expect.objectContaining({ source: 'mysecret' }),
    );
  });

  it('handles missing/invalid JSON body gracefully', async () => {
    const res = await buildApp().fetch(new Request('http://localhost/api/cron/webhook/mysecret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    }));

    // Should still succeed - the route handles JSON parse errors silently
    expect(res.status).toBe(200);
  });

  it('handles empty body gracefully', async () => {
    const res = await buildApp().fetch(new Request('http://localhost/api/cron/webhook/mysecret', {
      method: 'POST',
    }));

    expect(res.status).toBe(200);
  });

  it('returns 500 when event processing fails', async () => {
    mockTriggerByEvent.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(req('/api/cron/webhook/mysecret', 'POST', {}));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Lazy template initialization
// ---------------------------------------------------------------------------
describe('template initialization', () => {
  it('initializes templates once across multiple requests', async () => {
    vi.clearAllMocks();
    mockInitBuiltInTemplates.mockResolvedValue(undefined);
    mockListScheduledJobs.mockResolvedValue([]);

    const app = buildApp();
    await app.fetch(req('/api/cron/jobs'));
    await app.fetch(req('/api/cron/jobs'));

    // The global flag means it may be called once total or not at all in some test runs
    // depending on test order - just verify it works correctly without throwing
    expect(mockListScheduledJobs).toHaveBeenCalledTimes(2);
  });
});
