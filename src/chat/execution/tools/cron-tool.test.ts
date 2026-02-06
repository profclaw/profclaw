import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCronDeps } = vi.hoisted(() => ({
  mockCronDeps: {
    createScheduledJob: vi.fn(),
    getScheduledJob: vi.fn(),
    listScheduledJobs: vi.fn(),
    updateScheduledJob: vi.fn(),
    pauseScheduledJob: vi.fn(),
    resumeScheduledJob: vi.fn(),
    deleteScheduledJob: vi.fn(),
    archiveScheduledJob: vi.fn(),
    restoreScheduledJob: vi.fn(),
    triggerScheduledJob: vi.fn(),
    getJobRunHistory: vi.fn(),
  },
}));

vi.mock('../../../cron/scheduler.js', () => ({
  createScheduledJob: mockCronDeps.createScheduledJob,
  getScheduledJob: mockCronDeps.getScheduledJob,
  listScheduledJobs: mockCronDeps.listScheduledJobs,
  updateScheduledJob: mockCronDeps.updateScheduledJob,
  pauseScheduledJob: mockCronDeps.pauseScheduledJob,
  resumeScheduledJob: mockCronDeps.resumeScheduledJob,
  deleteScheduledJob: mockCronDeps.deleteScheduledJob,
  archiveScheduledJob: mockCronDeps.archiveScheduledJob,
  restoreScheduledJob: mockCronDeps.restoreScheduledJob,
  triggerScheduledJob: mockCronDeps.triggerScheduledJob,
  getJobRunHistory: mockCronDeps.getJobRunHistory,
}));

import {
  cronCreateTool,
  cronListTool,
  cronTriggerTool,
  cronArchiveTool,
  cronHistoryTool,
} from './cron-tool.js';
import type { ToolExecutionContext, ToolSession } from '../types.js';

function createContext(): ToolExecutionContext {
  return {
    toolCallId: 'tool-call-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    workdir: '/tmp',
    env: {},
    securityPolicy: { mode: 'ask' },
    sessionManager: {
      create(session: Omit<ToolSession, 'id' | 'createdAt'>): ToolSession {
        return { ...session, id: 'session-1', createdAt: Date.now() };
      },
      get() {
        return undefined;
      },
      update() {},
      list() {
        return [];
      },
      async kill() {},
      cleanup() {},
    },
  };
}

describe('cron tools', () => {
  const jobId = '123e4567-e89b-12d3-a456-426614174000';

  beforeEach(() => {
    vi.clearAllMocks();
    mockCronDeps.createScheduledJob.mockResolvedValue({
      id: jobId,
      name: 'Health Check',
      jobType: 'tool',
      status: 'active',
      cronExpression: '*/5 * * * *',
      intervalMs: null,
      nextRunAt: new Date('2026-03-12T00:05:00Z'),
    });
    mockCronDeps.listScheduledJobs.mockResolvedValue([]);
    mockCronDeps.getScheduledJob.mockResolvedValue({
      id: jobId,
      name: 'Health Check',
      status: 'active',
      runCount: 3,
      successCount: 2,
    });
    mockCronDeps.triggerScheduledJob.mockResolvedValue({ runId: 'run-1' });
    mockCronDeps.archiveScheduledJob.mockResolvedValue(true);
    mockCronDeps.restoreScheduledJob.mockResolvedValue(true);
    mockCronDeps.getJobRunHistory.mockResolvedValue([
      {
        id: 'run-1',
        startedAt: new Date(Date.now() - 60_000),
        status: 'success',
        durationMs: 320,
        triggeredBy: 'manual',
      },
    ]);
  });

  it('rejects cron_create when no schedule is provided', async () => {
    const result = await cronCreateTool.execute(createContext(), {
      name: 'No Schedule',
      type: 'tool',
      tool: 'git_status',
      toolParams: {},
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_SCHEDULE');
  });

  it('creates tool jobs with conversation context in the payload', async () => {
    const result = await cronCreateTool.execute(createContext(), {
      name: 'Health Check',
      cron: '*/5 * * * *',
      type: 'tool',
      tool: 'git_status',
      toolParams: { path: '.' },
    });

    expect(result.success).toBe(true);
    expect(mockCronDeps.createScheduledJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'tool',
        payload: {
          tool: 'git_status',
          params: { path: '.' },
          conversationId: 'conv-1',
        },
      }),
    );
  });

  it('returns an empty-state message when cron_list has no jobs', async () => {
    const result = await cronListTool.execute(createContext(), {
      limit: 20,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('No scheduled jobs found');
  });

  it('triggers an existing scheduled job', async () => {
    const result = await cronTriggerTool.execute(createContext(), {
      id: jobId,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Job Triggered');
  });

  it('rejects archiving jobs that are already archived', async () => {
    mockCronDeps.getScheduledJob.mockResolvedValueOnce({
      id: jobId,
      name: 'Archived Job',
      status: 'archived',
    });

    const result = await cronArchiveTool.execute(createContext(), {
      id: jobId,
      action: 'archive',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ALREADY_ARCHIVED');
  });

  it('formats recent run history for cron_history', async () => {
    const result = await cronHistoryTool.execute(createContext(), {
      id: jobId,
      limit: 10,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Run History');
    expect(result.data?.runs).toHaveLength(1);
  });
});
