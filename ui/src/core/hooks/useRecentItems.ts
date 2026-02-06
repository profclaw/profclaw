/**
 * Recent items hooks for CommandPalette
 *
 * Provides cached recent conversations and tickets.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/core/api/client.js';

export function useRecentConversations(limit = 5) {
  return useQuery({
    queryKey: ['recent-conversations', limit],
    queryFn: () => api.chat.conversations.recent(limit),
    staleTime: 60000,
    select: (data) => data.conversations,
  });
}

export function useRecentTickets(limit = 5) {
  return useQuery({
    queryKey: ['recent-tickets', limit],
    queryFn: () => api.tickets.list({ limit, sortBy: 'updatedAt', sortOrder: 'desc' }),
    staleTime: 60000,
    select: (data) => data.tickets,
  });
}
