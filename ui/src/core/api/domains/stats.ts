/**
 * Stats & Analytics API
 *
 * Endpoints for dashboard stats, costs, sync status, and integrations
 */

import { request } from './base';
import type { Settings, PluginHealth, GatewayStatus, GatewayAgent, GatewayWorkflow, GatewayConfig, GatewayExecuteRequest, GatewayExecuteResponse, DashboardStats, State, StateGroup } from '../../types';

export const healthApi = {
  check: () => request<{ status: string; storage?: { healthy: boolean } }>('/health'),
};

export const statsApi = {
  get: () =>
    request<{
      pending: number;
      inProgress: number;
      completed: number;
      failed: number;
      total: number;
    }>('/stats'),

  dashboard: () => request<DashboardStats>('/stats/dashboard'),

  sprintBurndown: (sprintId: string) =>
    request<{
      sprint: {
        id: string;
        name: string;
        status: string;
        startDate?: string;
        endDate?: string;
        capacity?: number;
      };
      totalPoints: number;
      ticketCount: number;
      completedPoints: number;
      burndown: Array<{ date: string; remaining?: number; ideal: number }>;
    }>(`/stats/sprints/${sprintId}/burndown`),

  projectVelocity: (projectId: string) =>
    request<{
      projectId: string;
      sprints: Array<{
        sprintId: string;
        sprintName: string;
        completedAt: string;
        plannedPoints: number;
        completedPoints: number;
        ticketCount: number;
        completedTickets: number;
      }>;
      averageVelocity: number;
      sprintCount: number;
    }>(`/stats/projects/${projectId}/velocity`),

  projectStats: (projectId: string) =>
    request<{
      tickets: {
        total: number;
        byStatus: Record<string, number>;
        byType: Record<string, number>;
        byPriority: Record<string, number>;
      };
      sprints: { total: number; active: number; completed: number };
    }>(`/stats/projects/${projectId}`),
};

export const costsApi = {
  summary: () =>
    request<{
      totalTokens: number;
      inputTokens: number;
      outputTokens: number;
      totalCost: number;
      taskCount: number;
    }>('/costs/summary'),

  analytics: () =>
    request<{
      daily: Array<{ date: string; cost: number; tokens: number }>;
      byModel: Record<string, { cost: number; tokens: number }>;
      byAgent: Record<string, { cost: number; tokens: number }>;
      totalCost: number;
      totalTokens: number;
    }>('/costs/analytics'),

  budget: () =>
    request<{ limit: number; spent: number; remaining: number; percentage: number }>(
      '/costs/budget'
    ),
};

export const dlqApi = {
  list: () =>
    request<{
      tasks: Array<{ id: string; title: string; error: string; failedAt: string; attempts: number }>;
      count: number;
    }>('/dlq'),

  stats: () => request<{ total: number }>('/dlq/stats'),

  retry: (id: string) => request<{ message: string }>(`/dlq/${id}/retry`, { method: 'POST' }),

  remove: (id: string) => request<{ message: string }>(`/dlq/${id}`, { method: 'DELETE' }),
};

export const integrationsApi = {
  status: () =>
    request<{
      integrations: Record<
        string,
        {
          name: string;
          configured: boolean;
          webhookUrl: string;
          oauthUrl: string;
          icon: string;
          description: string;
        }
      >;
      baseUrl: string;
      hookEndpoints: { toolUse: string; sessionEnd: string; promptSubmit: string };
    }>('/integrations/status'),
};

export const settingsApi = {
  get: () => request<{ settings: Settings }>('/settings'),

  update: (updates: Partial<Settings>) =>
    request<{ message: string; settings: Settings }>('/settings', {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),

  reset: () =>
    request<{ message: string; settings: Settings }>('/settings/reset', { method: 'POST' }),
};

export const pluginsApi = {
  health: () => request<{ plugins: PluginHealth[] }>('/plugins/health'),

  toggle: (pluginId: string, enabled: boolean) =>
    request<{ message: string; settings: Settings }>(`/plugins/${pluginId}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
};

export const gatewayApi = {
  status: () => request<GatewayStatus>('/gateway/status'),

  agents: () => request<{ agents: GatewayAgent[]; count: number }>('/gateway/agents'),

  workflows: () => request<{ workflows: GatewayWorkflow[] }>('/gateway/workflows'),

  workflow: (type: string) => request<{ workflow: GatewayWorkflow }>(`/gateway/workflows/${type}`),

  config: () => request<{ config: GatewayConfig }>('/gateway/config'),

  execute: (req: GatewayExecuteRequest) =>
    request<GatewayExecuteResponse>('/gateway/execute', {
      method: 'POST',
      body: JSON.stringify(req),
    }),

  updateConfig: (updates: Partial<GatewayConfig>) =>
    request<{ message: string; config: GatewayConfig }>('/gateway/config', {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),
};

export const syncApi = {
  status: () =>
    request<{
      enabled: boolean;
      initialized: boolean;
      adapters: Record<string, { connected: boolean; lastSync?: string; errorCount: number }>;
      pendingConflicts: number;
      autoSyncEnabled: boolean;
      health: Record<string, { healthy: boolean; latencyMs: number }>;
    }>('/sync/status'),

  trigger: (platform?: string) =>
    request<{ message: string; results: unknown[] }>('/sync/trigger', {
      method: 'POST',
      body: JSON.stringify({ platform }),
    }),

  push: (ticketId: string, platform?: string) =>
    request<{ message: string; externalId?: string }>(`/sync/push/${ticketId}`, {
      method: 'POST',
      body: JSON.stringify({ platform }),
    }),

  conflicts: () =>
    request<{ conflicts: Array<{ ticketId: string; field: string; localValue: unknown; remoteValue: unknown }>; count: number }>(
      '/sync/conflicts'
    ),

  resolveConflict: (ticketId: string, resolution: 'local' | 'remote') =>
    request<{ message: string; resolution: string }>(`/sync/conflicts/${ticketId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution }),
    }),
};

export const statesApi = {
  list: (projectId?: string) => {
    const query = projectId ? `?projectId=${projectId}` : '';
    return request<{ states: State[] }>(`/states${query}`);
  },

  get: (id: string) => request<{ state: State }>(`/states/${id}`),

  create: (data: { projectId?: string; name: string; slug?: string; color?: string; description?: string; stateGroup: StateGroup; isDefault?: boolean; sequence?: number }) =>
    request<{ state: State }>('/states', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: { name?: string; slug?: string; color?: string; description?: string; stateGroup?: StateGroup; isDefault?: boolean; sequence?: number }) =>
    request<{ state: State }>(`/states/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<{ message: string }>(`/states/${id}`, { method: 'DELETE' }),
};

export interface MentionItem {
  id: string;
  entity_identifier: string;
  entity_name: 'user' | 'ticket';
  title: string;
  subTitle?: string;
}

export interface MentionSection {
  key: string;
  title: string;
  items: MentionItem[];
}

export const searchApi = {
  mentions: (query: string, entityType: 'all' | 'user' | 'ticket' = 'all', limit = 5) =>
    request<{ sections: MentionSection[] }>(`/search/mentions?q=${encodeURIComponent(query)}&type=${entityType}&limit=${limit}`),
};
