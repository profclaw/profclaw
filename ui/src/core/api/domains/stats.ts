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

  routing: () =>
    request<{
      success: boolean;
      data: {
        totalRouted: number;
        totalSaved: string;
        avgSavingsPercent: string;
        byTier: Record<string, number>;
        message: string;
      };
    }>('/costs/routing'),

  optimize: () =>
    request<{
      success: boolean;
      data: {
        configuredProviders: string[];
        providerCount: number;
        recommendations: Array<{
          priority: 'high' | 'medium' | 'low';
          action: string;
          reason: string;
          estimatedMonthlySavings: string;
          envVar: string;
          signupUrl: string;
        }>;
        optimalSetup: boolean;
      };
    }>('/costs/optimize'),
};

export const teamsApi = {
  list: (userId: string) =>
    request<{ success: boolean; teams: Array<{
      id: string; name: string; slug: string; memberCount: number;
      monthlyBudgetUsd: number; smartRoutingEnabled: boolean;
    }>; total: number }>(`/teams?userId=${userId}`),

  get: (id: string) =>
    request<{ success: boolean; team: Record<string, unknown> }>(`/teams/${id}`),

  create: (data: { name: string; ownerId: string; monthlyBudget?: number }) =>
    request<{ success: boolean; team: Record<string, unknown> }>('/teams', {
      method: 'POST', body: JSON.stringify(data),
    }),

  members: (teamId: string) =>
    request<{ success: boolean; members: Array<{
      userId: string; role: string; totalSpentUsd: number; requestCount: number;
    }>; total: number }>(`/teams/${teamId}/members`),

  usage: (teamId: string) =>
    request<{ success: boolean; usage: {
      totalSpentUsd: number; budgetUsd: number; budgetUsedPercent: number;
      memberBreakdown: Array<{ userId: string; spentUsd: number; requestCount: number }>;
      alertsTriggered: number[];
    } }>(`/teams/${teamId}/usage`),

  invite: (teamId: string, email: string, role: string, invitedBy: string) =>
    request<{ success: boolean; invite: Record<string, unknown> }>(`/teams/${teamId}/invites`, {
      method: 'POST', body: JSON.stringify({ email, role, invitedBy }),
    }),
};

export const memoryInsightsApi = {
  insights: () =>
    request<{
      success: boolean;
      data: {
        stats: { total: number; byType: Record<string, number>; avgAge: number };
        learningRate: string;
        topToolChains: Array<{
          intent: string; tools: string[]; useCount: number; successScore: number;
        }>;
        recentPreferences: Array<{ intent: string; useCount: number; weight: number }>;
        summary: string;
      };
    }>('/memory/insights'),

  observe: (conversationId: string, messages: Array<{ role: string; content: string }>) =>
    request<{
      success: boolean;
      data: {
        observations: Array<{ type: string; summary: string; confidence: number }>;
        experiencesRecorded: number;
        preferencesTracked: number;
      };
    }>('/memory/observe', {
      method: 'POST',
      body: JSON.stringify({ conversationId, messages }),
    }),

  importSources: () =>
    request<{
      success: boolean;
      sources: Array<{ source: string; description: string; defaultPath: string; format: string }>;
    }>('/memory/import/sources'),

  importFrom: (source: string, options?: { path?: string; file?: string; dryRun?: boolean }) =>
    request<{
      success: boolean;
      data: {
        source: string; memories: number; conversations: number;
        skills: number; preferences: number; errors: string[];
      };
      summary: string;
    }>('/memory/import', {
      method: 'POST',
      body: JSON.stringify({ source, ...options }),
    }),

  search: (query: string, maxResults?: number) =>
    request<{ results: Array<{ path: string; content: string; score: number }> }>(
      `/memory/search?query=${encodeURIComponent(query)}&maxResults=${maxResults ?? 6}`
    ),
};

export const skillsApi = {
  list: () =>
    request<{
      skills: Array<{
        name: string; source: string; enabled: boolean; eligible: boolean;
        emoji?: string; description: string; userInvocable: boolean; modelInvocable: boolean;
        toolCategories: string[];
      }>;
      stats: { total: number; enabled: number; eligible: number };
    }>('/skills'),

  categories: () =>
    request<{ success: boolean; data: Array<{ name: string; count: number }> }>('/skills/categories'),

  overview: () =>
    request<{
      success: boolean;
      data: {
        total: number; enabled: number; eligible: number;
        bySource: Record<string, number>; byCategory: Record<string, number>;
        userInvocable: number; modelInvocable: number; mcpServers: number;
      };
    }>('/skills/stats/overview'),

  effectiveness: (name: string) =>
    request<{
      success: boolean;
      data: {
        skillId: string; totalAttempts: number; totalSuccesses: number;
        overallSuccessRate: number;
        byModel: Array<{ model: string; attempts: number; successRate: number; avgDurationMs: number }>;
      };
    }>(`/skills/${name}/effectiveness`),

  marketplaceSearch: (query?: string, category?: string) =>
    request<{ success: boolean; data: Array<Record<string, unknown>> }>(
      `/skills/marketplace/search?${query ? `q=${encodeURIComponent(query)}` : ''}${category ? `&category=${category}` : ''}`
    ),

  install: (source: string) =>
    request<{ success: boolean; data: Record<string, unknown> }>('/skills/marketplace/install', {
      method: 'POST', body: JSON.stringify({ source }),
    }),

  uninstall: (name: string) =>
    request<{ success: boolean }>(`/skills/marketplace/${name}`, { method: 'DELETE' }),

  checkUpdates: () =>
    request<{ success: boolean; data: Array<Record<string, unknown>> }>('/skills/marketplace/updates'),

  toggle: (name: string, enabled: boolean) =>
    request<{ success: boolean }>(`/skills/${name}/toggle`, {
      method: 'POST', body: JSON.stringify({ enabled }),
    }),
};

export const feedsApi = {
  list: (category?: string) =>
    request<{
      success: boolean;
      data: Array<{ id: string; name: string; url: string; category: string; articleCount: number; enabled: boolean }>;
    }>(`/feeds${category ? `?category=${category}` : ''}`),

  add: (name: string, url: string, category?: string) =>
    request<{ success: boolean; data: Record<string, unknown> }>('/feeds', {
      method: 'POST', body: JSON.stringify({ name, url, category }),
    }),

  installBundle: (bundle: string) =>
    request<{ success: boolean; data: Record<string, unknown> }>('/feeds/bundles/install', {
      method: 'POST', body: JSON.stringify({ bundle }),
    }),

  poll: (feedId?: string) =>
    request<{ success: boolean; data: Record<string, unknown> }>('/feeds/poll', {
      method: 'POST', body: JSON.stringify({ feedId }),
    }),

  digest: (hours?: number, category?: string) =>
    request<{
      success: boolean;
      data: Array<{ id: string; title: string; url: string; summary: string; publishedAt: string }>;
    }>(`/feeds/digest?hours=${hours ?? 24}${category ? `&category=${category}` : ''}`),

  discover: (url: string) =>
    request<{ success: boolean; data: { feedUrl?: string } }>(`/feeds/discover?url=${encodeURIComponent(url)}`),
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
