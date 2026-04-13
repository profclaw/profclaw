/**
 * useChatConversations
 *
 * Manages conversation lifecycle: creation, selection, new-chat, export,
 * and the recent-conversations list query.
 */

import { useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/core/api/client';
import type { Message, Conversation } from '../types';

interface UseChatConversationsOptions {
  /** Called after a conversation is loaded so the parent can update messages. */
  onMessagesLoaded: (messages: Message[]) => void;
  /** Called when starting a new chat so the parent can clear messages / approvals. */
  onNewChat: () => void;
  /** The preset to use when auto-creating a conversation. */
  selectedPreset: string;
  /** Called when preset should change after loading a conversation. */
  onPresetChange: (preset: string) => void;
}

export function useChatConversations({
  onMessagesLoaded,
  onNewChat,
  selectedPreset,
  onPresetChange,
}: UseChatConversationsOptions) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [conversationId, setConversationIdState] = useState<string | null>(null);
  const urlConversationIdRef = useRef<string | null>(null);

  // Keep URL in sync with conversationId state
  const setConversationId = useCallback(
    (id: string | null) => {
      setConversationIdState(id);
      urlConversationIdRef.current = id;
      if (id) {
        setSearchParams({ c: id }, { replace: true });
      } else {
        setSearchParams({}, { replace: true });
      }
    },
    [setSearchParams],
  );

  // ============================================================================
  // Queries
  // ============================================================================

  const { data: recentConversations, refetch: refetchConversations } = useQuery({
    queryKey: ['chat', 'conversations', 'recent'],
    queryFn: () => api.chat.conversations.recent(10),
    staleTime: 10000,
  });

  const conversations = (recentConversations?.conversations || []) as Conversation[];

  // ============================================================================
  // Mutations
  // ============================================================================

  const createConversation = useMutation({
    mutationFn: (data: { title?: string; presetId?: string }) =>
      api.chat.conversations.create(data),
    onSuccess: (data) => {
      setConversationId(data.conversation.id);
      void refetchConversations();
    },
  });

  // ============================================================================
  // Handlers
  // ============================================================================

  const loadConversation = useCallback(
    async (id: string) => {
      try {
        const data = await api.chat.conversations.get(id);
        setConversationIdState(id);
        urlConversationIdRef.current = id;
        onPresetChange(data.conversation.presetId);
        onMessagesLoaded(
          data.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: m.createdAt,
            usage: m.tokenUsage
              ? {
                  promptTokens: m.tokenUsage.prompt,
                  completionTokens: m.tokenUsage.completion,
                  totalTokens: m.tokenUsage.total,
                  cost: m.cost,
                }
              : undefined,
            toolCalls: m.toolCalls?.map(
              (tc: {
                id: string;
                name: string;
                arguments?: Record<string, unknown>;
                result?: unknown;
                status?: string;
                duration?: number;
              }) => ({
                id: tc.id,
                name: tc.name,
                arguments: tc.arguments || {},
                result: tc.result,
                status: (tc.status || 'success') as 'pending' | 'running' | 'success' | 'error',
                duration: tc.duration,
              }),
            ),
          })),
        );
      } catch {
        toast.error('Failed to load conversation');
      }
    },
    [onMessagesLoaded, onPresetChange],
  );

  const handleNewChat = useCallback(() => {
    setConversationId(null);
    onNewChat();
    toast.success('Started new chat');
  }, [setConversationId, onNewChat]);

  const handleSelectConversation = useCallback(
    (id: string) => {
      void loadConversation(id);
    },
    [loadConversation],
  );

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      try {
        await api.chat.conversations.delete(id);
        void refetchConversations();
        if (conversationId === id) {
          handleNewChat();
        }
        toast.success('Conversation deleted');
      } catch {
        toast.error('Failed to delete conversation');
      }
    },
    [conversationId, refetchConversations, handleNewChat],
  );

  const handleExportConversation = useCallback(async () => {
    if (!conversationId) return;
    try {
      const data = await api.chat.conversations.exportConversation(conversationId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-${data.conversation.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Conversation exported');
    } catch {
      toast.error('Failed to export conversation');
    }
  }, [conversationId]);

  // Ensure a conversation exists, creating one lazily if needed.
  // Returns the resolved conversation ID.
  const ensureConversation = useCallback(async (): Promise<string> => {
    if (conversationId) return conversationId;
    const result = await createConversation.mutateAsync({ presetId: selectedPreset });
    return result.conversation.id;
  }, [conversationId, createConversation, selectedPreset]);

  // Refresh conversation list and memory cache after a message round-trip
  const invalidateAfterSend = useCallback(() => {
    void refetchConversations();
    queryClient.invalidateQueries({ queryKey: ['chat', 'memory'] });
  }, [refetchConversations, queryClient]);

  return {
    conversationId,
    setConversationId,
    conversations,
    refetchConversations,
    createConversation,
    loadConversation,
    handleNewChat,
    handleSelectConversation,
    handleDeleteConversation,
    handleExportConversation,
    ensureConversation,
    invalidateAfterSend,
    urlConversationIdRef,
    searchParams,
  };
}
