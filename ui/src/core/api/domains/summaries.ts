/**
 * Summaries API
 *
 * Endpoints for task summaries and statistics
 */

import { request } from './base';
import type { Summary, SummariesResponse, SummaryStats } from '../../types';

export const summariesApi = {
  list: (params?: { limit?: number; offset?: number; agent?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    if (params?.agent) searchParams.set('agent', params.agent);
    const query = searchParams.toString();
    return request<SummariesResponse>(`/summaries${query ? `?${query}` : ''}`);
  },

  get: async (id: string) => {
    const response = await request<{ summary: Summary }>(`/summaries/${id}`);
    return response.summary;
  },

  recent: async (limit = 10) => {
    const response = await request<{ summaries: Summary[]; count: number }>(
      `/summaries/recent?limit=${limit}`
    );
    return response.summaries;
  },

  stats: () => request<SummaryStats>('/summaries/stats'),
};
