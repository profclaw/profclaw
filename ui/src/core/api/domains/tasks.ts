/**
 * Tasks API
 *
 * Endpoints for task management, filtering, and analytics
 */

import { request } from './base';
import type { Task, TasksResponse, TaskAnalytics, TaskFilterParams, TaskEvent } from '../../types';

export const tasksApi = {
  list: (params?: { limit?: number; offset?: number; status?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    if (params?.status) searchParams.set('status', params.status);
    const query = searchParams.toString();
    return request<TasksResponse>(`/tasks${query ? `?${query}` : ''}`);
  },

  get: async (id: string) => {
    const response = await request<{ task: Task }>(`/tasks/${id}`);
    return response.task;
  },

  create: (data: Partial<Task>) =>
    request<Task>('/tasks', { method: 'POST', body: JSON.stringify(data) }),

  update: (id: string, data: Partial<Task>) =>
    request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  delete: (id: string) =>
    request<{ success: boolean }>(`/tasks/${id}`, { method: 'DELETE' }),

  cancel: (id: string) =>
    request<{ message: string; task: Task }>(`/tasks/${id}/cancel`, { method: 'POST' }),

  retry: (id: string) =>
    request<{ message: string; task: Task; originalTaskId: string }>(`/tasks/${id}/retry`, {
      method: 'POST',
    }),

  analytics: () => request<TaskAnalytics>('/tasks/analytics'),

  filter: (params: TaskFilterParams) => {
    const searchParams = new URLSearchParams();
    if (params.status)
      searchParams.set(
        'status',
        Array.isArray(params.status) ? params.status.join(',') : params.status
      );
    if (params.priority)
      searchParams.set(
        'priority',
        Array.isArray(params.priority) ? params.priority.join(',') : String(params.priority)
      );
    if (params.source)
      searchParams.set(
        'source',
        Array.isArray(params.source) ? params.source.join(',') : params.source
      );
    if (params.agent) searchParams.set('agent', params.agent);
    if (params.labels) searchParams.set('labels', params.labels.join(','));
    if (params.createdAfter) searchParams.set('createdAfter', params.createdAfter);
    if (params.createdBefore) searchParams.set('createdBefore', params.createdBefore);
    if (params.q) searchParams.set('q', params.q);
    if (params.sortBy) searchParams.set('sortBy', params.sortBy);
    if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.offset) searchParams.set('offset', String(params.offset));
    const query = searchParams.toString();
    return request<TasksResponse & { total: number }>(`/tasks/filter${query ? `?${query}` : ''}`);
  },

  events: (id: string) =>
    request<{ taskId: string; events: TaskEvent[]; count: number }>(`/tasks/${id}/events`),

  archived: (params?: { limit?: number; offset?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    const query = searchParams.toString();
    return request<TasksResponse & { total: number }>(`/tasks/archived${query ? `?${query}` : ''}`);
  },

  archive: (olderThanDays = 30) =>
    request<{ message: string; archived: number }>('/tasks/archive', {
      method: 'POST',
      body: JSON.stringify({ olderThanDays }),
    }),
};
