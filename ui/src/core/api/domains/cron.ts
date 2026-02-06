/**
 * Cron / Scheduled Jobs API
 *
 * Endpoints for managing scheduled jobs, templates, and event triggers
 */

import { request } from './base';

export type JobType = 'http' | 'tool' | 'script' | 'message';
export type JobStatus = 'active' | 'paused' | 'completed' | 'failed' | 'archived';
export type RunStatus = 'pending' | 'running' | 'success' | 'failure' | 'error' | 'timeout' | 'cancelled';

export interface ScheduledJob {
  id: string;
  name: string;
  description?: string;
  cronExpression?: string;
  intervalMs?: number;
  runAt?: string;
  timezone: string;
  eventTrigger?: { type: string; config: Record<string, unknown> };
  jobType: JobType;
  payload: Record<string, unknown>;
  templateId?: string;
  delivery?: {
    channels: Array<{
      type: string;
      target: string;
      onSuccess?: boolean;
      onFailure?: boolean;
    }>;
  };
  status: JobStatus;
  labels: string[];
  userId?: string;
  projectId?: string;
  createdBy: 'human' | 'ai';
  archivedAt?: string;
  lastRunAt?: string;
  lastRunStatus?: string;
  lastRunError?: string;
  nextRunAt?: string;
  runCount: number;
  successCount: number;
  failureCount: number;
  maxRuns?: number;
  maxFailures?: number;
  retryOnFailure: boolean;
  deleteOnComplete: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JobRunHistory {
  id: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  status: RunStatus;
  output?: string;
  error?: string;
  triggeredBy: string;
}

export interface JobTemplate {
  id: string;
  name: string;
  description?: string;
  icon: string;
  category: string;
  jobType: JobType;
  payloadTemplate: Record<string, unknown>;
  suggestedCron?: string;
  suggestedIntervalMs?: number;
  defaultRetryPolicy?: {
    enabled: boolean;
    initialDelayMs: number;
    backoffMultiplier: number;
    maxDelayMs: number;
    maxRetries: number;
  };
  defaultDelivery?: {
    channels: Array<{
      type: string;
      target: string;
      onSuccess?: boolean;
      onFailure?: boolean;
    }>;
  };
  isBuiltIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CronStats {
  total: number;
  active: number;
  paused: number;
  completed: number;
  failed: number;
  archived: number;
  byType: { http: number; tool: number; script: number; message: number };
  byScheduleType: { cron: number; interval: number; oneShot: number; eventTriggered: number };
  totalRuns: number;
  totalSuccesses: number;
  totalFailures: number;
}

export interface CreateJobInput {
  name: string;
  description?: string;
  cronExpression?: string;
  intervalMs?: number;
  runAt?: string;
  timezone?: string;
  eventTrigger?: { type: string; config: Record<string, unknown> };
  jobType: JobType;
  payload: Record<string, unknown>;
  templateId?: string;
  labels?: string[];
  delivery?: {
    channels: Array<{
      type: string;
      target: string;
      onSuccess?: boolean;
      onFailure?: boolean;
    }>;
  };
  userId?: string;
  projectId?: string;
  maxRuns?: number;
  maxFailures?: number;
  retryPolicy?: { enabled?: boolean; maxRetries?: number; backoff?: string };
  deleteOnComplete?: boolean;
  expiresAt?: string;
}

export const cronApi = {
  // Jobs
  list: (params?: {
    status?: string;
    jobType?: string;
    projectId?: string;
    userId?: string;
    limit?: number;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.jobType) searchParams.set('jobType', params.jobType);
    if (params?.projectId) searchParams.set('projectId', params.projectId);
    if (params?.userId) searchParams.set('userId', params.userId);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    const query = searchParams.toString();
    return request<{ success: boolean; jobs: ScheduledJob[]; total: number }>(
      `/cron/jobs${query ? `?${query}` : ''}`
    );
  },

  get: (id: string) => request<{ success: boolean; job: ScheduledJob }>(`/cron/jobs/${id}`),

  create: (data: CreateJobInput) =>
    request<{ success: boolean; job: ScheduledJob; scheduleType: string }>('/cron/jobs', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<CreateJobInput> & { status?: 'active' | 'paused' }) =>
    request<{ success: boolean; job: ScheduledJob }>(`/cron/jobs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<{ success: boolean; deleted: boolean }>(`/cron/jobs/${id}`, { method: 'DELETE' }),

  trigger: (id: string) =>
    request<{ success: boolean; runId: string }>(`/cron/jobs/${id}/trigger`, { method: 'POST' }),

  pause: (id: string) =>
    request<{ success: boolean; status: 'paused' }>(`/cron/jobs/${id}/pause`, { method: 'POST' }),

  resume: (id: string) =>
    request<{ success: boolean; status: 'active' }>(`/cron/jobs/${id}/resume`, { method: 'POST' }),

  archive: (id: string) =>
    request<{ success: boolean; status: 'archived' }>(`/cron/jobs/${id}/archive`, { method: 'POST' }),

  restore: (id: string) =>
    request<{ success: boolean; status: 'paused' }>(`/cron/jobs/${id}/restore`, { method: 'POST' }),

  history: (id: string, limit = 20) =>
    request<{
      success: boolean;
      job: { id: string; name: string; runCount: number; successCount: number; failureCount: number };
      history: JobRunHistory[];
      total: number;
    }>(`/cron/jobs/${id}/history?limit=${limit}`),

  stats: () => request<{ success: boolean; stats: CronStats }>('/cron/stats'),

  // Templates
  listTemplates: (params?: {
    category?: string;
    jobType?: string;
    includeBuiltIn?: boolean;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.category) searchParams.set('category', params.category);
    if (params?.jobType) searchParams.set('jobType', params.jobType);
    if (params?.includeBuiltIn !== undefined)
      searchParams.set('includeBuiltIn', String(params.includeBuiltIn));
    const query = searchParams.toString();
    return request<{ success: boolean; templates: JobTemplate[]; total: number }>(
      `/cron/templates${query ? `?${query}` : ''}`
    );
  },

  getTemplate: (id: string) =>
    request<{ success: boolean; template: JobTemplate }>(`/cron/templates/${id}`),

  createTemplate: (data: {
    name: string;
    description?: string;
    icon?: string;
    category?: string;
    jobType: JobType;
    payloadTemplate: Record<string, unknown>;
    suggestedCron?: string;
    suggestedIntervalMs?: number;
  }) =>
    request<{ success: boolean; template: JobTemplate }>('/cron/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteTemplate: (id: string) =>
    request<{ success: boolean; deleted: boolean }>(`/cron/templates/${id}`, { method: 'DELETE' }),

  createFromTemplate: (data: {
    templateId: string;
    name: string;
    description?: string;
    variables?: Record<string, string>;
    cronExpression?: string;
    intervalMs?: number;
    runAt?: string;
  }) =>
    request<{ success: boolean; job: ScheduledJob; templateUsed: string }>(
      '/cron/jobs/from-template',
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    ),

  // Events
  triggerEvent: (eventType: string, eventData: Record<string, unknown>) =>
    request<{ success: boolean; eventType: string; triggered: string[]; count: number }>(
      '/cron/events',
      {
        method: 'POST',
        body: JSON.stringify({ eventType, eventData }),
      }
    ),
};
