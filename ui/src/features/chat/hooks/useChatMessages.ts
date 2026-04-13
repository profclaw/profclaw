/**
 * useChatMessages
 *
 * Manages the local message list: state and copy helper.
 *
 * Note: handleDeleteMessage is intentionally kept in ChatView because it
 * requires both the messages state (from here) and the conversationId (from
 * useChatConversations) — bridging the two hooks in the parent avoids a
 * circular dependency.
 */

import { useState, useCallback } from 'react';
import type { Message } from '../types';

export function useChatMessages() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = useCallback(async (content: string, id: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  return {
    messages,
    setMessages,
    copiedId,
    handleCopy,
  };
}
