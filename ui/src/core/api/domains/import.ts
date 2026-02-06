/**
 * Import API
 *
 * Endpoints for importing data from external platforms (GitHub Projects, etc.)
 */

import { request } from './base';

export interface GitHubProject {
  id: string;
  number: number;
  title: string;
  shortDescription?: string;
  url: string;
  public: boolean;
  creator?: { login: string };
  items: { totalCount: number };
  fields: { totalCount: number };
}

export interface GitHubIteration {
  id: string;
  title: string;
  startDate: string;
  duration: number;
}

export interface GitHubProjectItem {
  id: string;
  title: string;
  body?: string;
  url: string;
  status?: string;
  priority?: string;
  type?: string;
  labels: string[];
  assignees: string[];
  iteration?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FieldMappings {
  status: Record<string, string>;
  priority: Record<string, string>;
  type: Record<string, string>;
}

export const importApi = {
  github: {
    validateToken: (token: string) =>
      request<{ valid: boolean; username: string }>('/import/github/validate-token', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),

    status: () => request<{ hasToken: boolean; username?: string }>('/import/github/status'),

    disconnect: () =>
      request<{ message: string }>('/import/github/disconnect', { method: 'DELETE' }),

    listProjects: () => request<{ projects: GitHubProject[] }>('/import/github/projects'),

    getPreview: (projectId: string) =>
      request<{
        project: { id: string; title: string; url: string };
        iterations: GitHubIteration[];
        items: GitHubProjectItem[];
        fieldMappings: FieldMappings;
      }>(`/import/github/projects/${encodeURIComponent(projectId)}/preview`),

    execute: (
      projectId: string,
      data: {
        projectKey: string;
        projectName: string;
        projectIcon?: string;
        projectColor?: string;
        importIterations?: boolean;
        enableSync?: boolean;
        fieldMappings?: FieldMappings;
      }
    ) =>
      request<{
        project: { id: string; key: string; name: string };
        summary: {
          projectCreated: boolean;
          sprintsCreated: number;
          ticketsCreated: number;
        };
      }>(`/import/github/projects/${encodeURIComponent(projectId)}/execute`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
};
