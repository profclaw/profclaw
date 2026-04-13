/**
 * Chat API
 *
 * Endpoints for AI chat, conversations, skills, and tool management
 */

import { request } from './base';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatUsage,
  ModelInfo,
  ModelAlias,
} from '../../types';

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  provider?: string;
  tokenUsage?: { prompt: number; completion: number; total: number };
  cost?: number;
  toolCalls?: ToolCall[];
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  presetId: string;
  taskId?: string;
  ticketId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  status?: 'pending' | 'running' | 'success' | 'error';
  duration?: number;
}

export interface PendingApproval {
  id: string;
  toolName: string;
  params: Record<string, unknown>;
  securityLevel: 'moderate' | 'dangerous';
  command?: string;
  expiresAt?: number;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  icon: string;
  capabilities: string[];
  preferredModel?: 'fast' | 'balanced' | 'powerful';
  examples: string[];
}

export interface MemoryStats {
  messageCount: number;
  estimatedTokens: number;
  contextWindow: number;
  usagePercentage: number;
  needsCompaction: boolean;
  summaryCount: number;
}

export const chatApi = {
  completions: (data: ChatCompletionRequest) =>
    request<ChatCompletionResponse>('/chat/completions', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  models: (provider?: string) => {
    const query = provider ? `?provider=${provider}` : '';
    return request<{ models: ModelInfo[]; aliases: ModelAlias[] }>(`/chat/models${query}`);
  },

  providers: () =>
    request<{
      default: string;
      providers: Array<{
        type: string;
        enabled: boolean;
        healthy: boolean;
        message?: string;
        latencyMs?: number;
      }>;
    }>('/chat/providers'),

  setDefault: (provider: string) =>
    request<{ success: boolean; default: string }>('/chat/providers/default', {
      method: 'POST',
      body: JSON.stringify({ provider }),
    }),

  configure: (
    type: string,
    config: {
      apiKey?: string;
      baseUrl?: string;
      defaultModel?: string;
      apiVersion?: string;
      resourceName?: string;
      deploymentName?: string;
      enabled?: boolean;
    }
  ) =>
    request<{ success: boolean; message: string }>(`/chat/providers/${type}/configure`, {
      method: 'POST',
      body: JSON.stringify({ type, ...config }),
    }),

  quick: (
    prompt: string,
    options?: { model?: string; systemPrompt?: string; temperature?: number }
  ) =>
    request<{ content: string; model: string; provider: string; usage: ChatUsage }>('/chat/quick', {
      method: 'POST',
      body: JSON.stringify({ prompt, ...options }),
    }),

  health: (type: string) =>
    request<{ provider: string; healthy: boolean; message: string; latencyMs?: number }>(
      `/chat/providers/${type}/health`,
      { method: 'POST' }
    ),

  // Intelligence features
  presets: () =>
    request<{
      presets: Array<{
        id: string;
        name: string;
        description: string;
        icon: string;
        examples: string[];
      }>;
      default: string;
    }>('/chat/presets'),

  quickActions: () =>
    request<{ actions: Array<{ id: string; label: string; icon: string; prompt: string }> }>(
      '/chat/quick-actions'
    ),

  // Skills system
  skills: {
    list: () =>
      request<{
        skills: Skill[];
        modelTiers: Array<{ tier: 'fast' | 'balanced' | 'powerful'; description: string; costMultiplier: number }>;
      }>('/chat/skills'),

    detect: (
      message: string,
      context?: { hasTask?: boolean; hasTicket?: boolean; hasCode?: boolean }
    ) =>
      request<{
        matches: Array<{
          skillId: string;
          skillName: string;
          confidence: number;
          matchedPattern?: string;
          extractedVars?: Record<string, string>;
          preferredModel?: string;
        }>;
        recommendedSkill: { id: string; name: string; confidence: number } | null;
      }>('/chat/skills/detect', {
        method: 'POST',
        body: JSON.stringify({ message, ...context }),
      }),

    route: (
      message: string,
      options?: {
        availableModels?: string[];
        hasTask?: boolean;
        hasTicket?: boolean;
        hasCode?: boolean;
      }
    ) =>
      request<{
        skill: { id: string; name: string; confidence: number };
        model: { selected: string; tier: string; reason: string; costMultiplier: number };
        routing: { method: string; pattern?: string };
      }>('/chat/skills/route', {
        method: 'POST',
        body: JSON.stringify({ message, ...options }),
      }),
  },

  // Smart chat with context
  smart: (data: {
    messages: Array<{ role: string; content: string }>;
    model?: string;
    presetId?: string;
    taskId?: string;
    ticketId?: string;
    temperature?: number;
  }) =>
    request<ChatCompletionResponse & { context: { presetId: string; taskId?: string; ticketId?: string } }>(
      '/chat/smart',
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    ),

  // Conversation management
  conversations: {
    list: (params?: { limit?: number; offset?: number; taskId?: string; ticketId?: string }) => {
      const query = new URLSearchParams();
      if (params?.limit) query.set('limit', params.limit.toString());
      if (params?.offset) query.set('offset', params.offset.toString());
      if (params?.taskId) query.set('taskId', params.taskId);
      if (params?.ticketId) query.set('ticketId', params.ticketId);
      const queryStr = query.toString();
      return request<{
        conversations: Array<{
          id: string;
          title: string;
          presetId: string;
          createdAt: string;
          updatedAt: string;
        }>;
        total: number;
      }>(`/chat/conversations${queryStr ? `?${queryStr}` : ''}`);
    },

    recent: (limit = 10) =>
      request<{
        conversations: Array<{
          id: string;
          title: string;
          presetId: string;
          preview: string;
          messageCount: number;
          createdAt: string;
          updatedAt: string;
        }>;
      }>(`/chat/conversations/recent?limit=${limit}`),

    create: (data: {
      title?: string;
      presetId?: string;
      taskId?: string;
      ticketId?: string;
      projectId?: string;
    }) =>
      request<{ conversation: Conversation }>('/chat/conversations', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    get: (id: string) =>
      request<{ conversation: Conversation; messages: ConversationMessage[] }>(
        `/chat/conversations/${id}`
      ),

    delete: (id: string) =>
      request<{ message: string }>(`/chat/conversations/${id}`, { method: 'DELETE' }),

    sendMessage: (
      conversationId: string,
      data: { content: string; model?: string; temperature?: number }
    ) =>
      request<{
        userMessage: ConversationMessage;
        assistantMessage: ConversationMessage;
        usage?: { promptTokens: number; completionTokens: number; totalTokens: number; cost?: number };
        compaction?: { originalCount: number; compactedCount: number; tokensReduced: number };
      }>(`/chat/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    /**
     * Send a message with SSE streaming. Yields content chunks then a done event.
     */
    sendMessageStream: async function* (
      conversationId: string,
      data: { content: string; model?: string; temperature?: number }
    ): AsyncGenerator<
      | { type: 'content'; data: string }
      | { type: 'done'; data: { usage?: { promptTokens: number; completionTokens: number; totalTokens: number; cost?: number }; messageId: string; compaction?: { originalCount: number; compactedCount: number; tokensReduced: number } } }
      | { type: 'error'; data: string }
    > {
      const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api';
      const url = `${baseUrl}/chat/conversations/${conversationId}/messages`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ ...data, stream: true }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error((error as { error?: string }).error || 'Stream chat request failed');
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const jsonStr = line.slice(6).trim();
              if (!jsonStr) continue;
              try {
                const event = JSON.parse(jsonStr) as Record<string, unknown>;
                if (event.content !== undefined) {
                  yield { type: 'content', data: event.content as string };
                } else if (event.done === true) {
                  yield {
                    type: 'done',
                    data: {
                      usage: event.usage as { promptTokens: number; completionTokens: number; totalTokens: number; cost?: number } | undefined,
                      messageId: event.messageId as string,
                      compaction: event.compaction as { originalCount: number; compactedCount: number; tokensReduced: number } | undefined,
                    },
                  };
                } else if (event.error !== undefined) {
                  yield { type: 'error', data: event.error as string };
                }
              } catch {
                // skip malformed SSE event
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    },

    deleteMessage: (conversationId: string, messageId: string) =>
      request<{ success: boolean }>(`/chat/conversations/${conversationId}/messages/${messageId}`, {
        method: 'DELETE',
      }),

    exportConversation: (conversationId: string) =>
      request<{
        conversation: { id: string; title: string; createdAt: string };
        messages: ConversationMessage[];
        exportedAt: string;
      }>(`/chat/conversations/${conversationId}/export`),

    // Memory management
    getMemoryStats: (conversationId: string, model?: string) =>
      request<{
        conversationId: string;
        stats: MemoryStats;
        recommendation: string;
      }>(`/chat/conversations/${conversationId}/memory${model ? `?model=${model}` : ''}`),

    compact: (conversationId: string, model?: string) =>
      request<{
        compacted: boolean;
        message?: string;
        originalCount?: number;
        compactedCount?: number;
        tokensReduced?: number;
        summary?: string;
        stats: MemoryStats;
      }>(`/chat/conversations/${conversationId}/compact${model ? `?model=${model}` : ''}`, {
        method: 'POST',
      }),

    // Send message with native tool calling
    sendMessageWithTools: (
      conversationId: string,
      data: { content: string; model?: string; temperature?: number; enableTools?: boolean }
    ) =>
      request<{
        userMessage: ConversationMessage;
        assistantMessage: ConversationMessage;
        usage?: { promptTokens: number; completionTokens: number; totalTokens: number; cost?: number };
        compaction?: { originalCount: number; compactedCount: number; tokensReduced: number };
        toolCalls?: ToolCall[];
        pendingApprovals?: PendingApproval[];
        toolSupport?: {
          requested: boolean;
          supported: boolean;
          used: boolean;
          recommendation?: string;
        };
      }>(`/chat/conversations/${conversationId}/messages/with-tools`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },

  // Tool approval
  tools: {
    approve: (data: {
      conversationId: string;
      approvalId: string;
      decision: 'allow-once' | 'allow-always' | 'deny';
    }) =>
      request<{ success: boolean; message: string; result?: unknown }>('/chat/tools/approve', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    list: () =>
      request<{
        tools: Array<{
          name: string;
          description: string;
          category?: string;
          securityLevel: 'safe' | 'moderate' | 'dangerous';
        }>;
        count: number;
      }>('/chat/tools'),
  },

  // Agentic mode with SSE streaming
  agentic: {
    /**
     * Send a message in agentic mode with SSE streaming.
     * Returns an async generator that yields events.
     */
    sendMessage: async function* (
      conversationId: string,
      data: {
        content: string;
        model?: string;
        temperature?: number;
        showThinking?: boolean;
        maxSteps?: number;
        maxBudget?: number;
      }
    ): AsyncGenerator<AgenticStreamEvent> {
      const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api';
      const url = `${baseUrl}/chat/conversations/${conversationId}/messages/agentic`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || 'Agentic chat request failed');
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events from buffer
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const jsonStr = line.slice(6).trim();
              if (jsonStr) {
                try {
                  const event = JSON.parse(jsonStr) as AgenticStreamEvent;
                  yield event;
                } catch {
                  console.warn('Failed to parse SSE event:', jsonStr);
                }
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    },

    /**
     * Convenience method to collect all events and return final result.
     */
    sendMessageAndWait: async (
      conversationId: string,
      data: {
        content: string;
        model?: string;
        temperature?: number;
        showThinking?: boolean;
        maxSteps?: number;
        maxBudget?: number;
      },
      onEvent?: (event: AgenticStreamEvent) => void
    ): Promise<AgenticChatResult> => {
      const events: AgenticStreamEvent[] = [];
      let summary = '';
      let error: string | null = null;
      const toolCalls: ToolCall[] = [];
      let totalSteps = 0;
      let totalTokens = 0;

      for await (const event of chatApi.agentic.sendMessage(conversationId, data)) {
        events.push(event);
        onEvent?.(event);

        if (event.type === 'summary') {
          const summaryData = event.data as { summary: string };
          summary = summaryData.summary;
        }
        if (event.type === 'complete') {
          const completeData = event.data as {
            totalSteps: number;
            totalTokens: number;
            toolCalls: ToolCall[];
          };
          totalSteps = completeData.totalSteps;
          totalTokens = completeData.totalTokens;
          toolCalls.push(...(completeData.toolCalls || []));
        }
        if (event.type === 'error') {
          const errorData = event.data as { message: string };
          error = errorData.message;
        }
      }

      return {
        events,
        summary,
        error,
        toolCalls,
        totalSteps,
        totalTokens,
      };
    },
  },
};

// Agentic streaming event type (matches backend)
export interface AgenticStreamEvent {
  type:
    | 'session:start'
    | 'thinking:start'
    | 'thinking:update'
    | 'thinking:end'
    | 'step:start'
    | 'step:complete'
    | 'tool:call'
    | 'tool:result'
    | 'content'
    | 'summary'
    | 'complete'
    | 'error'
    | 'user_message'
    | 'message_saved';
  data: Record<string, unknown>;
  timestamp: number;
}

export interface AgenticChatResult {
  events: AgenticStreamEvent[];
  summary: string;
  error: string | null;
  toolCalls: ToolCall[];
  totalSteps: number;
  totalTokens: number;
}
