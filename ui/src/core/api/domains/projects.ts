/**
 * Projects & Sprints API
 *
 * Endpoints for project management, sprints, and labels
 */

import { request } from './base';

export interface ProjectStats {
  totalTickets: number;
  openTickets: number;
  inProgressTickets: number;
  doneTickets: number;
  velocity?: number;
}

export interface ProjectExternalLink {
  id: string;
  projectId: string;
  platform: string;
  externalId: string;
  externalUrl?: string;
  syncEnabled: boolean;
  syncDirection: 'push' | 'pull' | 'bidirectional';
  lastSyncedAt?: string;
  syncError?: string;
  createdAt: string;
}

export interface Project {
  id: string;
  sequence: number;
  key: string;
  name: string;
  description?: string;
  icon: string;
  color: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
  // Additional fields when include=all
  stats?: ProjectStats;
  externalLinks?: ProjectExternalLink[];
  ticketCount?: number;
  activeSprintCount?: number;
}

export interface Sprint {
  id: string;
  sequence: number;
  projectId: string;
  name: string;
  goal?: string;
  status: 'planning' | 'active' | 'completed' | 'cancelled';
  startDate?: string;
  endDate?: string;
  capacity?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Label {
  id: string;
  projectId?: string;
  name: string;
  description?: string;
  color: string;
  parentId?: string;
  sortOrder: number;
  externalSource?: string;
  externalId?: string;
  createdAt: string;
  updatedAt: string;
}

export const projectsApi = {
  list: (params?: {
    status?: string;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
    includeArchived?: boolean;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.search) searchParams.set('search', params.search);
    if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
    if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    if (params?.includeArchived) searchParams.set('includeArchived', 'true');
    const query = searchParams.toString();
    return request<{ projects: Project[]; total: number; limit: number; offset: number }>(
      `/projects${query ? `?${query}` : ''}`
    );
  },

  get: async (id: string, include?: 'all') => {
    const query = include ? `?include=${include}` : '';
    const response = await request<{ project: Project }>(`/projects/${id}${query}`);
    return response.project;
  },

  getByKey: async (key: string) => {
    const response = await request<{ project: Project }>(`/projects/by-key/${key}`);
    return response.project;
  },

  create: (data: {
    key: string;
    name: string;
    description?: string;
    icon?: string;
    color?: string;
    lead?: string;
  }) =>
    request<{ message: string; project: Project }>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (
    id: string,
    data: { name?: string; description?: string; icon?: string; color?: string; lead?: string }
  ) =>
    request<{ message: string; project: Project }>(`/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  archive: (id: string) =>
    request<{ message: string; project: Project }>(`/projects/${id}/archive`, { method: 'POST' }),

  delete: (id: string) =>
    request<{ message: string }>(`/projects/${id}`, { method: 'DELETE' }),

  getDefault: async () => {
    const response = await request<{ project: Project }>('/projects/default');
    return response.project;
  },

  migrate: () =>
    request<{ message: string; migrated: number }>('/projects/migrate', { method: 'POST' }),

  // External Links
  getExternalLinks: (projectId: string) =>
    request<{ externalLinks: Array<{ platform: string; externalId: string; externalUrl?: string }> }>(
      `/projects/${projectId}/external-links`
    ),

  addExternalLink: (
    projectId: string,
    data: { platform: string; externalId: string; externalUrl?: string }
  ) =>
    request<{ message: string; externalLink: { platform: string; externalId: string; externalUrl?: string } }>(
      `/projects/${projectId}/external-links`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    ),

  // Sprints
  sprints: {
    list: (
      projectId: string,
      params?: {
        status?: string;
        search?: string;
        sortBy?: string;
        sortOrder?: 'asc' | 'desc';
        limit?: number;
        offset?: number;
      }
    ) => {
      const searchParams = new URLSearchParams();
      if (params?.status) searchParams.set('status', params.status);
      if (params?.search) searchParams.set('search', params.search);
      if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
      if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);
      if (params?.limit) searchParams.set('limit', String(params.limit));
      if (params?.offset) searchParams.set('offset', String(params.offset));
      const query = searchParams.toString();
      return request<{ sprints: Sprint[]; total: number; limit: number; offset: number }>(
        `/projects/${projectId}/sprints${query ? `?${query}` : ''}`
      );
    },

    get: async (projectId: string, sprintId: string, include?: 'stats') => {
      const query = include ? `?include=${include}` : '';
      const response = await request<{ sprint: Sprint }>(
        `/projects/${projectId}/sprints/${sprintId}${query}`
      );
      return response.sprint;
    },

    getActive: async (projectId: string) => {
      const response = await request<{ sprint: Sprint }>(`/projects/${projectId}/sprints/active`);
      return response.sprint;
    },

    create: (
      projectId: string,
      data: {
        name: string;
        goal?: string;
        description?: string;
        startDate?: string;
        endDate?: string;
        capacity?: number;
      }
    ) =>
      request<{ message: string; sprint: Sprint }>(`/projects/${projectId}/sprints`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (
      projectId: string,
      sprintId: string,
      data: {
        name?: string;
        goal?: string;
        description?: string;
        startDate?: string;
        endDate?: string;
        capacity?: number;
      }
    ) =>
      request<{ message: string; sprint: Sprint }>(`/projects/${projectId}/sprints/${sprintId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    start: (projectId: string, sprintId: string) =>
      request<{ message: string; sprint: Sprint }>(
        `/projects/${projectId}/sprints/${sprintId}/start`,
        { method: 'POST' }
      ),

    complete: (projectId: string, sprintId: string) =>
      request<{ message: string; sprint: Sprint }>(
        `/projects/${projectId}/sprints/${sprintId}/complete`,
        { method: 'POST' }
      ),

    cancel: (projectId: string, sprintId: string) =>
      request<{ message: string; sprint: Sprint }>(
        `/projects/${projectId}/sprints/${sprintId}/cancel`,
        { method: 'POST' }
      ),

    delete: (projectId: string, sprintId: string) =>
      request<{ message: string }>(`/projects/${projectId}/sprints/${sprintId}`, {
        method: 'DELETE',
      }),

    // Sprint Tickets
    getTickets: (projectId: string, sprintId: string) =>
      request<{ ticketIds: string[] }>(`/projects/${projectId}/sprints/${sprintId}/tickets`),

    addTickets: (projectId: string, sprintId: string, ticketIds: string[]) =>
      request<{ message: string; assignments: Array<{ ticketId: string; sprintId: string }> }>(
        `/projects/${projectId}/sprints/${sprintId}/tickets`,
        {
          method: 'POST',
          body: JSON.stringify({ ticketIds }),
        }
      ),

    removeTicket: (projectId: string, sprintId: string, ticketId: string) =>
      request<{ message: string }>(
        `/projects/${projectId}/sprints/${sprintId}/tickets/${ticketId}`,
        { method: 'DELETE' }
      ),

    reorderTickets: (projectId: string, sprintId: string, ticketOrder: string[]) =>
      request<{ message: string }>(`/projects/${projectId}/sprints/${sprintId}/tickets/reorder`, {
        method: 'PUT',
        body: JSON.stringify({ ticketOrder }),
      }),
  },
};

export const labelsApi = {
  list: (projectId: string, params?: { search?: string; includeGlobal?: boolean }) => {
    const searchParams = new URLSearchParams();
    if (params?.search) searchParams.set('search', params.search);
    if (params?.includeGlobal) searchParams.set('includeGlobal', 'true');
    const query = searchParams.toString();
    return request<{ labels: Label[]; total: number }>(
      `/projects/${projectId}/labels${query ? `?${query}` : ''}`
    );
  },

  create: (
    projectId: string,
    data: { name: string; description?: string; color?: string; parentId?: string }
  ) =>
    request<{ message: string; label: Label }>(`/projects/${projectId}/labels`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (
    labelId: string,
    data: { name?: string; description?: string; color?: string; parentId?: string; sortOrder?: number }
  ) =>
    request<{ message: string; label: Label }>(`/labels/${labelId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (labelId: string) =>
    request<{ message: string }>(`/labels/${labelId}`, { method: 'DELETE' }),

  // Ticket labels
  getTicketLabels: (ticketId: string) =>
    request<{ ticketId: string; labels: Label[]; count: number }>(`/tickets/${ticketId}/labels`),

  setTicketLabels: (ticketId: string, labelIds: string[]) =>
    request<{ message: string; labels: Label[] }>(`/tickets/${ticketId}/labels`, {
      method: 'PUT',
      body: JSON.stringify({ labelIds }),
    }),

  addTicketLabel: (ticketId: string, labelId: string) =>
    request<{ message: string }>(`/tickets/${ticketId}/labels/${labelId}`, { method: 'POST' }),

  removeTicketLabel: (ticketId: string, labelId: string) =>
    request<{ message: string }>(`/tickets/${ticketId}/labels/${labelId}`, { method: 'DELETE' }),
};
