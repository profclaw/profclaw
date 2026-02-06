/**
 * Tickets API
 *
 * Endpoints for AI-native ticket management, comments, history, and AI features
 */

import { request } from './base';
import type {
  Ticket,
  TicketStatus,
  TicketComment,
  TicketHistoryEntry,
  TicketExternalLink,
  TicketCategorization,
  TicketSuggestion,
  SimilarTicket,
  TicketsResponse,
  AIStatus,
  AIResponderStatus,
  AICommentResponse,
  AICommentAnalysis,
  ExternalPlatform,
  TicketWithRelations,
  CreateTicketInput,
  TicketQueryParams,
  TicketChecklist,
  TicketChecklistItem,
  TicketRelation,
} from '../../types';

export const ticketsApi = {
  list: (params?: TicketQueryParams) => {
    const searchParams = new URLSearchParams();
    if (params?.projectId) searchParams.set('projectId', params.projectId);
    if (params?.sprintId) searchParams.set('sprintId', params.sprintId);
    if (params?.inBacklog) searchParams.set('inBacklog', 'true');
    if (params?.status)
      searchParams.set(
        'status',
        Array.isArray(params.status) ? params.status.join(',') : params.status
      );
    if (params?.type)
      searchParams.set('type', Array.isArray(params.type) ? params.type.join(',') : params.type);
    if (params?.priority)
      searchParams.set(
        'priority',
        Array.isArray(params.priority) ? params.priority.join(',') : params.priority
      );
    if (params?.assignee) searchParams.set('assignee', params.assignee);
    if (params?.assigneeAgent) searchParams.set('assigneeAgent', params.assigneeAgent);
    if (params?.parentId) searchParams.set('parentId', params.parentId);
    if (params?.search) searchParams.set('search', params.search);
    if (params?.createdBy) searchParams.set('createdBy', params.createdBy);
    if (params?.label) searchParams.set('label', params.label);
    if (params?.labels) searchParams.set('labels', params.labels.join(','));
    if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
    if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    const query = searchParams.toString();
    return request<TicketsResponse>(`/tickets${query ? `?${query}` : ''}`);
  },

  get: async (id: string, includeRelations = false) => {
    const query = includeRelations ? '?include=all' : '';
    const response = await request<{ ticket: Ticket | TicketWithRelations }>(
      `/tickets/${id}${query}`
    );
    return response.ticket;
  },

  create: (data: CreateTicketInput) =>
    request<{ message: string; ticket: Ticket }>('/tickets', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<CreateTicketInput>) =>
    request<{ message: string; ticket: Ticket }>(`/tickets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string) => request<{ message: string }>(`/tickets/${id}`, { method: 'DELETE' }),

  transition: (id: string, status: TicketStatus) =>
    request<{ message: string; ticket: Ticket }>(`/tickets/${id}/transition`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),

  assignAgent: (id: string, agent: string) =>
    request<{ message: string; ticket: Ticket }>(`/tickets/${id}/assign-agent`, {
      method: 'POST',
      body: JSON.stringify({ agent }),
    }),

  // Comments
  getComments: (id: string) =>
    request<{ ticketId: string; comments: TicketComment[]; count: number }>(
      `/tickets/${id}/comments`
    ),

  addComment: (
    id: string,
    content: string,
    author?: { type: 'human' | 'ai'; name: string; platform: string }
  ) =>
    request<{ message: string; comment: TicketComment }>(`/tickets/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content, author }),
    }),

  // External Links
  getLinks: (id: string) =>
    request<{ ticketId: string; links: TicketExternalLink[]; count: number }>(
      `/tickets/${id}/links`
    ),

  addLink: (
    id: string,
    link: { platform: ExternalPlatform; externalId: string; externalUrl?: string }
  ) =>
    request<{ message: string; link: TicketExternalLink }>(`/tickets/${id}/links`, {
      method: 'POST',
      body: JSON.stringify(link),
    }),

  // History
  getHistory: (id: string) =>
    request<{ ticketId: string; history: TicketHistoryEntry[]; count: number }>(
      `/tickets/${id}/history`
    ),

  // AI Features
  ai: {
    status: () => request<AIStatus>('/tickets/ai/status'),

    responderStatus: () => request<AIResponderStatus>('/tickets/ai/responder-status'),

    categorize: (title: string, description?: string) =>
      request<{ categorization: TicketCategorization; durationMs: number }>(
        '/tickets/ai/categorize',
        {
          method: 'POST',
          body: JSON.stringify({ title, description }),
        }
      ),

    suggest: (title: string, description?: string, type?: string) =>
      request<{ suggestions: TicketSuggestion; durationMs: number }>('/tickets/ai/suggest', {
        method: 'POST',
        body: JSON.stringify({ title, description, type }),
      }),

    summary: (id: string) =>
      request<{ summary: string; source: 'ai' | 'fallback'; durationMs?: number }>(
        `/tickets/${id}/ai/summary`
      ),

    similar: (id: string, limit = 5) =>
      request<{ ticketId: string; similar: SimilarTicket[]; count: number }>(
        `/tickets/${id}/similar?limit=${limit}`
      ),

    respond: (
      id: string,
      options?: { commentId?: string; autoPost?: boolean; minConfidence?: number }
    ) =>
      request<AICommentResponse>(`/tickets/${id}/comments/ai-respond`, {
        method: 'POST',
        body: JSON.stringify(options || {}),
      }),

    analyzeComment: (id: string, content: string) =>
      request<AICommentAnalysis>(`/tickets/${id}/ai/analyze-comment`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      }),
  },

  // Checklists
  checklists: {
    list: (ticketId: string) =>
      request<{ checklists: TicketChecklist[] }>(`/tickets/${ticketId}/checklists`),

    create: (ticketId: string, data: { title: string }) =>
      request<{ checklist: TicketChecklist }>(`/tickets/${ticketId}/checklists`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (ticketId: string, checklistId: string, data: { title?: string }) =>
      request<{ checklist: TicketChecklist }>(`/tickets/${ticketId}/checklists/${checklistId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    delete: (ticketId: string, checklistId: string) =>
      request<{ message: string }>(`/tickets/${ticketId}/checklists/${checklistId}`, {
        method: 'DELETE',
      }),

    addItem: (ticketId: string, checklistId: string, data: { content: string; assignee?: string; dueDate?: string }) =>
      request<{ item: TicketChecklistItem }>(`/tickets/${ticketId}/checklists/${checklistId}/items`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    updateItem: (ticketId: string, checklistId: string, itemId: string, data: { content?: string; completed?: boolean; assignee?: string; dueDate?: string }) =>
      request<{ item: TicketChecklistItem }>(`/tickets/${ticketId}/checklists/${checklistId}/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    deleteItem: (ticketId: string, checklistId: string, itemId: string) =>
      request<{ message: string }>(`/tickets/${ticketId}/checklists/${checklistId}/items/${itemId}`, {
        method: 'DELETE',
      }),

    reorderItems: (ticketId: string, checklistId: string, itemIds: string[]) =>
      request<{ items: TicketChecklistItem[] }>(`/tickets/${ticketId}/checklists/${checklistId}/reorder`, {
        method: 'POST',
        body: JSON.stringify({ itemIds }),
      }),
  },

  // Relations
  addRelation: (ticketId: string, targetTicketId: string, relationType: string) =>
    request<{ message: string; relation: TicketRelation }>(`/tickets/${ticketId}/relations`, {
      method: 'POST',
      body: JSON.stringify({ targetTicketId, relationType }),
    }),

  removeRelation: (ticketId: string, relationId: string) =>
    request<{ message: string }>(`/tickets/${ticketId}/relations/${relationId}`, {
      method: 'DELETE',
    }),
};
