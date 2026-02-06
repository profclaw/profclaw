/**
 * Notifications API
 *
 * In-app notification CRUD with read/unread state
 */

import { request } from './base';

export interface Notification {
  id: string;
  userId: string | null;
  title: string;
  description: string | null;
  type: 'success' | 'error' | 'info' | 'warning';
  category: 'system' | 'task' | 'ticket' | 'agent' | 'chat' | 'cron';
  entityType: string | null;
  entityId: string | null;
  read: boolean;
  createdAt: number;
}

export interface NotificationsResponse {
  notifications: Notification[];
  total: number;
  unreadCount: number;
}

export interface CreateNotificationInput {
  title: string;
  description?: string;
  type?: 'success' | 'error' | 'info' | 'warning';
  category?: 'system' | 'task' | 'ticket' | 'agent' | 'chat' | 'cron';
  entityType?: string;
  entityId?: string;
  userId?: string;
}

export const notificationsApi = {
  list: (params?: { limit?: number; unread?: boolean }) => {
    const search = new URLSearchParams();
    if (params?.limit) search.set('limit', String(params.limit));
    if (params?.unread) search.set('unread', 'true');
    const qs = search.toString();
    return request<NotificationsResponse>(`/notifications${qs ? `?${qs}` : ''}`);
  },

  create: (input: CreateNotificationInput) =>
    request<{ id: string; title: string; type: string; category: string; read: boolean }>(
      '/notifications',
      { method: 'POST', body: JSON.stringify(input) },
    ),

  markRead: (id: string) =>
    request<{ success: boolean }>(`/notifications/${id}/read`, { method: 'PATCH' }),

  markAllRead: () =>
    request<{ success: boolean }>('/notifications/mark-all-read', { method: 'POST' }),

  delete: (id: string) =>
    request<{ success: boolean }>(`/notifications/${id}`, { method: 'DELETE' }),

  unreadCount: () =>
    request<{ count: number }>('/notifications/unread-count'),
};
