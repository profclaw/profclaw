/**
 * Chat View
 *
 * Main chat interface with tool calling support and approval workflow.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertCircle, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { api } from '@/core/api/client';
import {
  ChatHeader,
  ChatMessages,
  ChatInput,
  ChatHistory,
  ChatSidebar,
  ProviderSetupDialog,
  AgenticThinking,
  TalkModeOverlay,
  type AgenticEvent,
} from '../components';
import { WorkflowQuickActions } from '../components/WorkflowQuickActions';
import { AutonomySlider, type AutonomyLevel } from '../components/AutonomySlider';
import { ToolTimeline, type ToolCallEvent } from '../components/ToolTimeline';
import { useTalkMode } from '@/core/hooks/useTalkMode';
import {
  ToolApprovalDialog,
  type PendingApproval,
} from '@/components/shared/ToolApprovalDialog';
import type { Message, MemoryStats } from '../types';
import { useChatMessages } from '../hooks/useChatMessages';
import { useChatConversations } from '../hooks/useChatConversations';

export function ChatView() {
  const queryClient = useQueryClient();

  // Constants for localStorage keys
  const STORAGE_KEYS = {
    model: 'profclaw-chat-model',
    preset: 'profclaw-chat-preset',
    sidebarOpen: 'profclaw-chat-sidebar-open',
    agentMode: 'profclaw-chat-agent-mode',
  } as const;

  // State
  const [input, setInput] = useState('');
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    // Load saved model from localStorage on initial render
    if (typeof window !== 'undefined') {
      return localStorage.getItem(STORAGE_KEYS.model) || '';
    }
    return '';
  });
  const [selectedPreset, setSelectedPreset] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(STORAGE_KEYS.preset) || 'profclaw-assistant';
    }
    return 'profclaw-assistant';
  });
  const [showProviderSetup, setShowProviderSetup] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  // Tool-related state (tools auto-enable with agent mode)
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);

  // Sidebar and mode state
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEYS.sidebarOpen);
      return saved !== null ? JSON.parse(saved) : true;
    }
    return true;
  });
  const [agentMode, setAgentMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEYS.agentMode);
      return saved !== null ? JSON.parse(saved) : false;
    }
    return false;
  });
  const [autonomyLevel, setAutonomyLevel] = useState<AutonomyLevel>('ask-dangerous');
  const [focusedView, setFocusedView] = useState(false);

  // Agentic execution state
  const [agenticEvents, setAgenticEvents] = useState<AgenticEvent[]>([]);
  const [isAgenticRunning, setIsAgenticRunning] = useState(false);

  // Streaming state for regular chat
  const [isStreaming, setIsStreaming] = useState(false);

  // Derive tool call events from agentic events for ToolTimeline
  const toolCallEvents = useMemo<ToolCallEvent[]>(() => {
    const calls = new Map<string, ToolCallEvent>();
    for (const event of agenticEvents) {
      if (event.type === 'tool:call') {
        const data = event.data as { id?: string; name?: string; toolCallId?: string; toolName?: string };
        const id = data.id ?? data.toolCallId ?? crypto.randomUUID();
        const name = data.name ?? data.toolName ?? 'unknown';
        calls.set(id, { id, toolName: name, status: 'running', startedAt: Date.now() });
      }
      if (event.type === 'tool:result') {
        const data = event.data as { id?: string; toolCallId?: string; success?: boolean; error?: string };
        const id = data.id ?? data.toolCallId ?? '';
        const existing = calls.get(id);
        if (existing) {
          existing.status = data.success === false ? 'failed' : 'completed';
          existing.completedAt = Date.now();
          if (data.error) existing.error = data.error;
        }
      }
    }
    return Array.from(calls.values());
  }, [agenticEvents]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Track the last assistant message ID to avoid re-triggering TTS
  const lastSpokenMessageIdRef = useRef<string | null>(null);

  // ============================================================================
  // Custom Hooks
  // ============================================================================

  // Message state management
  const {
    messages,
    setMessages,
    copiedId,
    handleCopy,
  } = useChatMessages();

  // Conversation management
  const {
    conversationId,
    conversations,
    loadConversation,
    handleNewChat: handleNewChatFromHook,
    handleSelectConversation,
    handleDeleteConversation,
    handleExportConversation,
    ensureConversation,
    invalidateAfterSend,
    urlConversationIdRef,
    searchParams,
  } = useChatConversations({
    onMessagesLoaded: setMessages,
    onNewChat: useCallback(() => {
      setMessages([]);
      setPendingApprovals([]);
    }, [setMessages]),
    selectedPreset,
    onPresetChange: setSelectedPreset,
  });

  const handleNewChat = useCallback(() => {
    handleNewChatFromHook();
  }, [handleNewChatFromHook]);

  // handleDeleteMessage bridges messages state + conversationId from the two hooks
  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
      if (!conversationId) return;
      try {
        await api.chat.conversations.deleteMessage(conversationId, messageId);
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
      } catch {
        toast.error('Failed to delete message');
      }
    },
    [conversationId, setMessages],
  );

  // ============================================================================
  // Queries
  // ============================================================================

  const { data: modelsData } = useQuery({
    queryKey: ['chat', 'models'],
    queryFn: () => api.chat.models(),
    staleTime: 60000, // Cache for 1 minute
  });

  const { data: providersData, refetch: refetchProviders } = useQuery({
    queryKey: ['chat', 'providers'],
    queryFn: () => api.chat.providers(),
    refetchInterval: 30000,
    staleTime: 25000, // Prevent duplicate fetches within 25s
  });

  const { data: presetsData } = useQuery({
    queryKey: ['chat', 'presets'],
    queryFn: () => api.chat.presets(),
    staleTime: 60000,
  });

  const { data: quickActionsData } = useQuery({
    queryKey: ['chat', 'quickActions'],
    queryFn: () => api.chat.quickActions(),
    staleTime: 60000,
  });

  const { data: memoryStats } = useQuery({
    queryKey: ['chat', 'memory', conversationId],
    queryFn: () => api.chat.conversations.getMemoryStats(conversationId!, selectedModel),
    enabled: !!conversationId,
    refetchInterval: 60000,
    staleTime: 55000,
  });

  // Model capability detection
  const { data: modelCapability } = useQuery<{
    capability: 'basic' | 'instruction' | 'reasoning';
    tier: 'essential' | 'standard' | 'full';
    maxSchemaTokens: number;
  }>({
    queryKey: ['model-capability', selectedModel],
    queryFn: async () => {
      if (!selectedModel) return { capability: 'reasoning' as const, tier: 'full' as const, maxSchemaTokens: 20000 };
      const res = await fetch(`/api/chat/model-capability?model=${encodeURIComponent(selectedModel)}`);
      if (!res.ok) return { capability: 'reasoning' as const, tier: 'full' as const, maxSchemaTokens: 20000 };
      return res.json() as Promise<{ capability: 'basic' | 'instruction' | 'reasoning'; tier: 'essential' | 'standard' | 'full'; maxSchemaTokens: number }>;
    },
    staleTime: 300_000,
    enabled: !!selectedModel,
  });

  // Voice availability status
  const { data: voiceStatus } = useQuery<{ available: boolean; stt: { provider: string | null }; tts: { provider: string | null } }>({
    queryKey: ['voice-status'],
    queryFn: async () => {
      const res = await fetch('/api/voice/status');
      if (!res.ok) return { available: false, stt: { provider: null }, tts: { provider: null } };
      return res.json() as Promise<{ available: boolean; stt: { provider: string | null }; tts: { provider: string | null } }>;
    },
    staleTime: 60_000,
    retry: 1,
  });

  const sttAvailable = voiceStatus?.stt?.provider != null;
  const ttsAvailable = voiceStatus?.tts?.provider != null;

  // ============================================================================
  // Mutations
  // ============================================================================

  const configureProvider = useMutation({
    mutationFn: ({ type, apiKey }: { type: string; apiKey: string }) =>
      api.chat.configure(type, { apiKey, enabled: true }),
    onSuccess: () => {
      toast.success('Provider configured successfully');
      refetchProviders();
      queryClient.invalidateQueries({ queryKey: ['chat', 'providers'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to configure provider');
    },
  });

  const sendConversationMessage = useMutation({
    mutationFn: ({ conversationId, content, model }: { conversationId: string; content: string; model?: string }) =>
      api.chat.conversations.sendMessage(conversationId, { content, model }),
    onSuccess: (response) => {
      const assistantMessage: Message = {
        id: response.assistantMessage.id,
        role: 'assistant',
        content: response.assistantMessage.content,
        timestamp: response.assistantMessage.createdAt,
        usage: response.usage,
      };
      setMessages((prev) => {
        const filtered = prev.filter((m) => !m.isLoading);
        return [...filtered, assistantMessage];
      });
      invalidateAfterSend();
      if (response.compaction) {
        toast.info(
          `Memory compacted: ${response.compaction.originalCount} → ${response.compaction.compactedCount} messages`,
          { duration: 4000 }
        );
      }
    },
    onError: (error) => {
      setMessages((prev) => {
        const filtered = prev.filter((m) => !m.isLoading);
        const lastMessage = filtered[filtered.length - 1];
        if (lastMessage && lastMessage.role === 'user') {
          return [
            ...filtered.slice(0, -1),
            { ...lastMessage, error: error instanceof Error ? error.message : 'Failed to send message' },
          ];
        }
        return filtered;
      });
      toast.error('Failed to send message');
    },
  });

  // Send message with native tool calling
  const sendMessageWithTools = useMutation({
    mutationFn: ({ conversationId, content, model }: { conversationId: string; content: string; model?: string }) =>
      api.chat.conversations.sendMessageWithTools(conversationId, { content, model, enableTools: true }),
    onSuccess: (response) => {
      const assistantMessage: Message = {
        id: response.assistantMessage.id,
        role: 'assistant',
        content: response.assistantMessage.content,
        timestamp: response.assistantMessage.createdAt,
        usage: response.usage,
        toolCalls: response.toolCalls,
      };
      setMessages((prev) => {
        const filtered = prev.filter((m) => !m.isLoading);
        return [...filtered, assistantMessage];
      });
      invalidateAfterSend();

      // Handle pending approvals
      if (response.pendingApprovals && response.pendingApprovals.length > 0) {
        setPendingApprovals((prev) => {
          const newApprovals = response.pendingApprovals!.filter(
            (a) => !prev.some((p) => p.id === a.id)
          );
          return [...prev, ...newApprovals];
        });
      }

      if (response.compaction) {
        toast.info(
          `Memory compacted: ${response.compaction.originalCount} → ${response.compaction.compactedCount} messages`,
          { duration: 4000 }
        );
      }

      if (response.toolCalls && response.toolCalls.length > 0) {
        toast.success(`Used ${response.toolCalls.length} tool(s)`, { duration: 3000 });
      }

      // Show warning if tools were requested but not supported
      if (response.toolSupport?.requested && !response.toolSupport.supported) {
        toast.warning(
          response.toolSupport.recommendation ||
            `Model doesn't support tools. Using normal conversation mode.`,
          { duration: 6000 }
        );
      }
    },
    onError: (error) => {
      setMessages((prev) => {
        const filtered = prev.filter((m) => !m.isLoading);
        const lastMessage = filtered[filtered.length - 1];
        if (lastMessage && lastMessage.role === 'user') {
          return [
            ...filtered.slice(0, -1),
            { ...lastMessage, error: error instanceof Error ? error.message : 'Failed to send message' },
          ];
        }
        return filtered;
      });
      toast.error('Failed to send message');
    },
  });

  // Handle tool approval decisions
  const approveToolMutation = useMutation({
    mutationFn: ({ approvalId, decision }: { approvalId: string; decision: 'allow-once' | 'allow-always' | 'deny' }) =>
      api.chat.tools.approve({
        conversationId: conversationId!,
        approvalId,
        decision,
      }),
    onSuccess: (response, { approvalId, decision }) => {
      setPendingApprovals((prev) => prev.filter((a) => a.id !== approvalId));
      if (decision === 'deny') {
        toast.info('Tool execution denied');
      } else {
        toast.success(decision === 'allow-always' ? 'Tool allowed (always)' : 'Tool executed');
        if (response.result) {
          const resultMessage: Message = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: typeof response.result === 'string'
              ? response.result
              : `Tool completed:\n\`\`\`json\n${JSON.stringify(response.result, null, 2)}\n\`\`\``,
            timestamp: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, resultMessage]);
        }
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to process approval');
    },
  });

  // Stable callback for tool decisions
  const handleToolDecision = useCallback((approvalId: string, decision: 'allow-once' | 'allow-always' | 'deny') => {
    approveToolMutation.mutate({ approvalId, decision });
  }, [approveToolMutation]);

  // ============================================================================
  // Effects
  // ============================================================================

  // Load conversation from URL or auto-load last conversation
  useEffect(() => {
    const urlConversationId = searchParams.get('c');
    if (urlConversationId && urlConversationId !== urlConversationIdRef.current) {
      urlConversationIdRef.current = urlConversationId;
      void loadConversation(urlConversationId).then(() => setShowHistory(false));
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-load last conversation if no URL param and conversations are available
  useEffect(() => {
    const urlConversationId = searchParams.get('c');
    if (!urlConversationId && !conversationId && conversations?.length) {
      const lastConversation = conversations[0];
      if (lastConversation?.id) {
        void loadConversation(lastConversation.id).then(() => setShowHistory(false));
      }
    }
  }, [conversations]); // eslint-disable-line react-hooks/exhaustive-deps

  // Smart model selection with localStorage persistence
  useEffect(() => {
    if (!providersData?.providers || !modelsData?.aliases) return;

    const aliases = modelsData.aliases;
    const providers = providersData.providers;
    const healthyProviders = providers.filter((p) => p.healthy);

    // Helper to check if a model alias has a healthy provider
    const isModelHealthy = (modelAlias: string) => {
      const alias = aliases.find((a) => a.alias === modelAlias);
      if (!alias) return false;
      return healthyProviders.some((p) => p.type === alias.provider);
    };

    // If we have a saved model and it's healthy, keep it
    if (selectedModel && isModelHealthy(selectedModel)) {
      return;
    }

    // Try to find a healthy model to select
    if (healthyProviders.length > 0) {
      // Priority order for auto-selection
      const aliasMap: Record<string, string> = {
        anthropic: 'sonnet',
        openai: 'gpt',
        google: 'gemini',
        azure: 'azure',
        groq: 'groq',
        xai: 'grok',
        ollama: 'local',
      };

      // Find first healthy provider and get its preferred alias
      const firstHealthy = healthyProviders[0];
      const newModel = aliasMap[firstHealthy.type] || 'local';
      setSelectedModel(newModel);
    }
  }, [providersData, modelsData, selectedModel]);

  // Persist model selection to localStorage
  const handleModelChange = useCallback((model: string) => {
    setSelectedModel(model);
    localStorage.setItem(STORAGE_KEYS.model, model);
  }, [STORAGE_KEYS.model]);

  // Persist preset selection to localStorage
  const handlePresetChange = useCallback((preset: string) => {
    setSelectedPreset(preset);
    localStorage.setItem(STORAGE_KEYS.preset, preset);
  }, [STORAGE_KEYS.preset]);

  // ============================================================================
  // Handlers
  // ============================================================================

  const handleSend = async () => {
    const isPendingAny = sendConversationMessage.isPending || sendMessageWithTools.isPending || isAgenticRunning || isStreaming;
    if (!input.trim() || isPendingAny) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
      images: pendingImages.length > 0 ? [...pendingImages] : undefined,
    };

    const loadingMessage: Message = {
      id: 'loading',
      role: 'assistant',
      content: '',
      isLoading: true,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage, loadingMessage]);
    const messageContent = input.trim();
    setInput('');
    setPendingImages([]);

    // In agent mode, use the streaming agentic endpoint
    if (agentMode) {
      // Clear previous agentic events
      setAgenticEvents([]);
      setIsAgenticRunning(true);

      try {
        // Ensure we have a conversation
        const targetConversationId = await ensureConversation();

        // Start streaming agentic execution
        for await (const event of api.chat.agentic.sendMessage(targetConversationId, {
          content: messageContent,
          model: selectedModel || undefined,
          showThinking: true,
        })) {
          // Add event to state for UI display
          setAgenticEvents((prev) => [...prev, event as AgenticEvent]);

          // Handle specific events
          if (event.type === 'summary') {
            const summaryData = event.data as { summary: string };
            // Update the loading message with the summary
            setMessages((prev) => {
              const filtered = prev.filter((m) => !m.isLoading);
              return [
                ...filtered,
                {
                  id: crypto.randomUUID(),
                  role: 'assistant' as const,
                  content: summaryData.summary,
                  timestamp: new Date().toISOString(),
                },
              ];
            });
          }

          if (event.type === 'complete') {
            const completeData = event.data as {
              totalSteps: number;
              toolCalls: Array<{ name: string; arguments: Record<string, unknown>; result?: unknown }>;
              suggestions?: Array<{ id: string; type: string; message: string; confidence: number; action?: { label: string; command: string } }>;
            };
            toast.success(
              `Task completed in ${completeData.totalSteps} step${completeData.totalSteps !== 1 ? 's' : ''} with ${completeData.toolCalls?.length || 0} tool call${(completeData.toolCalls?.length || 0) !== 1 ? 's' : ''}`,
              { duration: 4000 }
            );

            // Attach suggestions to the last assistant message
            if (completeData.suggestions && completeData.suggestions.length > 0) {
              setMessages((prev) => {
                const lastIdx = prev.length - 1;
                if (lastIdx >= 0 && prev[lastIdx].role === 'assistant') {
                  const updated = [...prev];
                  updated[lastIdx] = { ...updated[lastIdx], suggestions: completeData.suggestions };
                  return updated;
                }
                return prev;
              });
            }
          }

          if (event.type === 'error') {
            const errorData = event.data as { message: string };
            setMessages((prev) => {
              const filtered = prev.filter((m) => !m.isLoading);
              const lastMessage = filtered[filtered.length - 1];
              if (lastMessage && lastMessage.role === 'user') {
                return [
                  ...filtered.slice(0, -1),
                  { ...lastMessage, error: errorData.message },
                ];
              }
              return filtered;
            });
            toast.error(errorData.message);
          }
        }

        invalidateAfterSend();
      } catch (error) {
        setMessages((prev) => {
          const filtered = prev.filter((m) => !m.isLoading);
          const lastMessage = filtered[filtered.length - 1];
          if (lastMessage && lastMessage.role === 'user') {
            return [
              ...filtered.slice(0, -1),
              { ...lastMessage, error: error instanceof Error ? error.message : 'Agentic execution failed' },
            ];
          }
          return filtered;
        });
        toast.error('Agentic execution failed');
      } finally {
        setIsAgenticRunning(false);
      }
      return;
    }

    // Non-agent mode: use streaming
    const targetConversationId = await ensureConversation();

    setIsStreaming(true);
    try {
      for await (const event of api.chat.conversations.sendMessageStream(targetConversationId, {
        content: messageContent,
        model: selectedModel || undefined,
      })) {
        if (event.type === 'content') {
          setMessages((prev) => {
            const updated = [...prev];
            const loadingIdx = updated.findIndex((m) => m.id === 'loading');
            if (loadingIdx >= 0) {
              updated[loadingIdx] = {
                ...updated[loadingIdx],
                content: (updated[loadingIdx].content || '') + event.data,
                isLoading: false,
              };
            }
            return updated;
          });
        } else if (event.type === 'done') {
          setMessages((prev) => {
            const updated = [...prev];
            const loadingIdx = updated.findIndex((m) => m.id === 'loading' || m.isLoading);
            if (loadingIdx >= 0) {
              updated[loadingIdx] = {
                ...updated[loadingIdx],
                id: event.data.messageId,
                isLoading: false,
                usage: event.data.usage,
              };
            }
            return updated;
          });
          invalidateAfterSend();
          if (event.data.compaction) {
            toast.info(
              `Memory compacted: ${event.data.compaction.originalCount} → ${event.data.compaction.compactedCount} messages`,
              { duration: 4000 }
            );
          }
        } else if (event.type === 'error') {
          throw new Error(event.data);
        }
      }
    } catch (error) {
      setMessages((prev) => {
        const filtered = prev.filter((m) => !m.isLoading);
        const lastMessage = filtered[filtered.length - 1];
        if (lastMessage && lastMessage.role === 'user') {
          return [
            ...filtered.slice(0, -1),
            { ...lastMessage, error: error instanceof Error ? error.message : 'Failed to send message' },
          ];
        }
        return filtered;
      });
      toast.error('Failed to send message');
    } finally {
      setIsStreaming(false);
    }
  };

  // ============================================================================
  // Talk Mode
  // ============================================================================

  const handleTalkModeSend = useCallback(async (text: string): Promise<void> => {
    const isPendingAny = sendConversationMessage.isPending || sendMessageWithTools.isPending || isAgenticRunning || isStreaming;
    if (!text.trim() || isPendingAny) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date().toISOString(),
    };

    const loadingMessage: Message = {
      id: 'loading',
      role: 'assistant',
      content: '',
      isLoading: true,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage, loadingMessage]);

    const sendMutation = agentMode ? sendMessageWithTools : sendConversationMessage;

    const targetConversationId = await ensureConversation();
    sendMutation.mutate({
      conversationId: targetConversationId,
      content: text.trim(),
      model: selectedModel || undefined,
    });
  }, [
    sendConversationMessage.isPending, sendMessageWithTools.isPending,
    isAgenticRunning, isStreaming, agentMode, selectedModel,
    sendConversationMessage, sendMessageWithTools, ensureConversation,
  ]);

  const talkMode = useTalkMode({
    onTranscription: useCallback((text: string) => {
      setInput((prev) => (prev ? `${prev} ${text}` : text));
    }, []),
    onSend: handleTalkModeSend,
  });

  // Auto-TTS: speak new assistant messages when Talk Mode is active with autoTts
  useEffect(() => {
    if (talkMode.state === 'idle' || !talkMode.config.autoTts) return;

    const lastMessage = messages[messages.length - 1];
    if (
      lastMessage &&
      lastMessage.role === 'assistant' &&
      !lastMessage.isLoading &&
      lastMessage.content &&
      lastMessage.id !== lastSpokenMessageIdRef.current
    ) {
      lastSpokenMessageIdRef.current = lastMessage.id;
      void talkMode.speakResponse(lastMessage.content);
    }
  }, [messages, talkMode.state, talkMode.config.autoTts, talkMode.speakResponse]);

  const handleToggleTalkMode = useCallback(() => {
    if (!sttAvailable && talkMode.state === 'idle') {
      toast.error('Talk Mode requires an STT provider. Go to Settings > Voice to configure.', { id: 'voice-unavailable' });
      return;
    }
    talkMode.toggle();
  }, [sttAvailable, talkMode.state, talkMode.toggle]);

  const handleRetry = (messageId: string) => {
    const messageIndex = messages.findIndex((m) => m.id === messageId);
    if (messageIndex === -1 || !conversationId) return;

    // Find the message to retry - if it's an assistant message with error, get the user message before it
    const message = messages[messageIndex];
    let userMessage: Message | undefined;

    if (message.role === 'assistant' && message.error) {
      // Find the preceding user message
      for (let i = messageIndex - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          userMessage = messages[i];
          break;
        }
      }
    } else if (message.role === 'user' && message.error) {
      userMessage = message;
    }

    if (!userMessage) {
      toast.error('Could not find message to retry');
      return;
    }

    // Remove the errored messages and add loading state
    const loadingMessage: Message = {
      id: 'loading',
      role: 'assistant',
      content: '',
      isLoading: true,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => {
      // Keep messages up to and including the user message, then add loading
      const userIndex = prev.findIndex((m) => m.id === userMessage!.id);
      return [...prev.slice(0, userIndex + 1), loadingMessage];
    });

    // Re-send the message
    const sendMutation = agentMode ? sendMessageWithTools : sendConversationMessage;
    sendMutation.mutate({
      conversationId,
      content: userMessage.content,
      model: selectedModel || undefined,
    });

    toast.info('Retrying message...');
  };

  const handleQuickAction = (prompt: string) => {
    setInput(prompt);
  };

  const handleWorkflowSelect = useCallback((workflowId: string) => {
    const workflowPrompts: Record<string, string> = {
      deploy: 'Run the deploy workflow for this project. Check build status, run tests, and deploy if everything passes.',
      review: 'Run a thorough code review on the recent changes. Check for bugs, security issues, and suggest improvements.',
      debug: 'Help me debug the current issue. Analyze logs, check error patterns, and suggest fixes.',
      research: 'Research this topic thoroughly. Search for latest information, compare approaches, and summarize findings.',
      test: 'Run the test suite, analyze results, and fix any failing tests.',
      refactor: 'Analyze the current code for refactoring opportunities. Suggest improvements for readability, performance, and maintainability.',
    };
    const prompt = workflowPrompts[workflowId] || `Run the ${workflowId} workflow`;
    setInput(prompt);
    // Auto-submit after brief delay so user sees the prompt
    setTimeout(() => {
      handleSend();
    }, 100);
  }, [handleSend]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setPendingImages((prev) => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleImageRemove = (index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  };

  const startRecording = async () => {
    if (!sttAvailable) {
      toast.error('Voice input requires an STT provider. Go to Settings > Voice to configure.', { id: 'voice-unavailable' });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());

        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (audioBlob.size === 0) return;

        try {
          const formData = new FormData();
          formData.append('audio', audioBlob, 'recording.webm');

          const response = await fetch('/api/voice/transcribe', {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) throw new Error('Transcription failed');

          const data = (await response.json()) as { text?: string };
          if (data.text) {
            setInput((prev) => (prev ? `${prev} ${data.text}` : (data.text ?? '')));
            toast.success('Voice transcribed');
          }
        } catch {
          toast.error('Voice transcription failed');
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      toast.success('Recording started');
    } catch {
      toast.error('Microphone access denied');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleSaveApiKey = async (type: string, apiKey: string) => {
    await configureProvider.mutateAsync({ type, apiKey });
  };

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen((prev: boolean) => {
      const newValue = !prev;
      localStorage.setItem(STORAGE_KEYS.sidebarOpen, JSON.stringify(newValue));
      return newValue;
    });
  }, [STORAGE_KEYS.sidebarOpen]);

  const handleToggleAgentMode = useCallback(() => {
    setAgentMode((prev: boolean) => {
      const newValue = !prev;
      localStorage.setItem(STORAGE_KEYS.agentMode, JSON.stringify(newValue));
      // Use unique ID to prevent duplicate toasts from React StrictMode
      toast.info(newValue ? 'Agent mode enabled (autonomous)' : 'Chat mode enabled (conversational)', {
        id: 'agent-mode-toggle',
      });
      return newValue;
    });
  }, [STORAGE_KEYS.agentMode]);

  const handleToggleFocusedView = useCallback(() => {
    setFocusedView((prev) => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add('chat-fullscreen');
      } else {
        document.documentElement.classList.remove('chat-fullscreen');
      }
      return next;
    });
  }, []);

  // Cleanup fullscreen class on unmount
  useEffect(() => {
    return () => {
      document.documentElement.classList.remove('chat-fullscreen');
    };
  }, []);

  // ============================================================================
  // Derived State
  // ============================================================================

  const aliases = modelsData?.aliases || [];
  const providers = providersData?.providers || [];
  const healthyProviders = providers.filter((p) => p.healthy);
  const presets = presetsData?.presets || [];
  const quickActions = quickActionsData?.actions || [];
  const currentPreset = presets.find((p) => p.id === selectedPreset);
  const isPending = sendConversationMessage.isPending || sendMessageWithTools.isPending || isAgenticRunning || isStreaming;
  const currentApproval = pendingApprovals[0];

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className={cn(
      "flex overflow-hidden transition-all duration-300",
      focusedView
        ? "h-screen rounded-none border-0 shadow-none mx-0 my-0 bg-background"
        : "rounded-2xl border border-border/30 bg-card/40 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.3)] -mx-2 -my-2 sm:-mx-4 sm:-my-3 h-[calc(100vh-6.5rem)]"
    )}>
      {/* Sidebar - hidden in focused view */}
      {!focusedView && (
        <aside className="shrink-0">
          <ChatSidebar
            isOpen={sidebarOpen}
            onToggle={handleToggleSidebar}
            conversations={conversations}
            currentConversationId={conversationId}
            onSelectConversation={handleSelectConversation}
            onNewChat={handleNewChat}
            onDeleteConversation={handleDeleteConversation}
            width={260}
          />
        </aside>
      )}

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-background/30" role="main">
        {/* Header */}
        <header className="border-b border-border/20 bg-card/30" role="banner">
          <ChatHeader
            currentPreset={currentPreset}
            presets={presets}
            selectedPreset={selectedPreset}
            selectedModel={selectedModel}
            aliases={aliases}
            providers={providers}
            healthyProviders={healthyProviders}
            memoryStats={memoryStats as MemoryStats | undefined}
            conversationId={conversationId}
            onPresetChange={handlePresetChange}
            onModelChange={handleModelChange}
            onNewChat={handleNewChat}
            onOpenHistory={() => setShowHistory(true)}
            onOpenProviderSetup={() => setShowProviderSetup(true)}
            onClearChat={handleNewChat}
            onExport={handleExportConversation}
            focusedView={focusedView}
            onToggleFocusedView={handleToggleFocusedView}
            modelCapability={modelCapability ? {
              toolTier: modelCapability.tier,
              capabilityLevel: modelCapability.capability,
            } : undefined}
          />
        </header>

      {/* Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden px-3 py-2">
        {/* No Provider Banner */}
      {healthyProviders.length === 0 && (
        <div className="mb-4 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-amber-200">No AI providers connected</p>
            <p className="text-sm text-amber-300/80 mt-1">
              Connect at least one provider to start chatting.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-amber-500/30 hover:bg-amber-500/10"
            onClick={() => setShowProviderSetup(true)}
          >
            <Zap className="h-4 w-4 mr-1" />
            Setup
          </Button>
        </div>
      )}

      {/* Autonomy Level (agent mode only) */}
      {agentMode && (
        <AutonomySlider
          level={autonomyLevel}
          onChange={setAutonomyLevel}
          className="mb-3"
        />
      )}

      {/* Agentic Thinking Display */}
      {agentMode && (agenticEvents.length > 0 || isAgenticRunning) && (
        <AgenticThinking
          events={agenticEvents}
          isActive={isAgenticRunning}
          className="mb-3"
        />
      )}

      {/* Tool Execution Timeline */}
      {agentMode && (toolCallEvents.length > 0 || isAgenticRunning) && (
        <ToolTimeline
          toolCalls={toolCallEvents}
          isExecuting={isAgenticRunning}
          className="mb-3"
        />
      )}

      {/* Messages */}
      <ChatMessages
        messages={messages}
        currentPreset={currentPreset}
        quickActions={quickActions}
        healthyProviders={healthyProviders.length}
        copiedId={copiedId}
        onCopy={handleCopy}
        onRetry={handleRetry}
        onDelete={handleDeleteMessage}
        onQuickAction={handleQuickAction}
        onOpenProviderSetup={() => setShowProviderSetup(true)}
      />

      {/* Talk Mode Overlay */}
      {talkMode.state !== 'idle' && (
        <TalkModeOverlay
          state={talkMode.state}
          energy={talkMode.energy}
          lastTranscription={talkMode.lastTranscription}
          isCalibrating={talkMode.isCalibrating}
          noiseFloor={talkMode.noiseFloor}
          selectedVoice={talkMode.selectedVoice}
          onVoiceChange={talkMode.setSelectedVoice}
          onStop={talkMode.stop}
          ttsAvailable={ttsAvailable}
        />
      )}

      {/* Input */}
      <ChatInput
        value={input}
        onChange={setInput}
        onSend={handleSend}
        isPending={isPending}
        disabled={healthyProviders.length === 0}
        placeholder={
          healthyProviders.length > 0
            ? agentMode
              ? 'Give the agent a task...'
              : 'Type a message...'
            : 'Configure a provider to start chatting...'
        }
        pendingImages={pendingImages}
        onImageSelect={handleImageSelect}
        onImageRemove={handleImageRemove}
        isRecording={isRecording}
        onStartRecording={startRecording}
        onStopRecording={stopRecording}
        agentMode={agentMode}
        onToggleAgentMode={handleToggleAgentMode}
        talkModeState={talkMode.state}
        onToggleTalkMode={handleToggleTalkMode}
        voiceAvailable={{ stt: sttAvailable, tts: ttsAvailable }}
      />

      {/* Workflow Quick Actions */}
      {agentMode && (
        <WorkflowQuickActions
          onWorkflowSelect={handleWorkflowSelect}
          disabled={isPending || healthyProviders.length === 0}
          className="px-3 pb-2"
        />
      )}
      </div>

      {/* History Sheet */}
      <ChatHistory
        open={showHistory}
        onOpenChange={setShowHistory}
        conversations={conversations}
        currentConversationId={conversationId}
        onSelectConversation={handleSelectConversation}
        onNewChat={handleNewChat}
      />

      {/* Provider Setup Dialog */}
      <ProviderSetupDialog
        open={showProviderSetup}
        onOpenChange={setShowProviderSetup}
        providers={providers}
        onSaveApiKey={handleSaveApiKey}
      />

      {/* Tool Approval Dialog */}
      {currentApproval && (
        <ToolApprovalDialog
          approval={currentApproval}
          onDecision={handleToolDecision}
          isLoading={approveToolMutation.isPending}
        />
      )}
      </main>
    </div>
  );
}
