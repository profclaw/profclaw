/**
 * Floating Chatbot Component
 *
 * A context-aware floating chat widget that appears in the bottom-right corner.
 * Knows what page the user is viewing and provides relevant assistance.
 * Uses the existing chat infrastructure for AI-powered conversations.
 *
 * Features:
 * - Session persistence (conversations saved and restored)
 * - Model transparency (shows which AI model is being used)
 * - Tool integration (can execute actions via AI tools)
 * - Context-aware (knows current page and entity being viewed)
 */

import { useState, useRef, useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  X,
  Send,
  Loader2,
  Minimize2,
  Maximize2,
  Sparkles,
  MessageSquare,
  User,
  Trash2,
  Ticket,
  LayoutDashboard,
  ListTodo,
  FolderKanban,
  Settings,
  FileText,
  Coins,
  Zap,
  Webhook,
  Brain,
  AlertTriangle,
  Cpu,
  Wrench,
  CheckCircle,
  XCircle,
  RefreshCw,
  ChevronDown,
  Clock,
} from "lucide-react";
import { api } from "@/core/api/client";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  isLoading?: boolean;
  model?: string;
  provider?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    result?: unknown;
    status?: "pending" | "success" | "error";
  }>;
}

// Page context configuration
interface PageContext {
  type: string;
  name: string;
  icon: typeof Sparkles;
  description: string;
  capabilities: string[];
  quickActions: Array<{ label: string; prompt: string }>;
}

// Storage key for conversation IDs by context
const STORAGE_KEY_PREFIX = "glinr_chatbot_conversation_";

// Get storage key for a page context
function getStorageKey(contextType: string, entityId?: string): string {
  return entityId
    ? `${STORAGE_KEY_PREFIX}${contextType}_${entityId}`
    : `${STORAGE_KEY_PREFIX}${contextType}`;
}

// Define page contexts with their capabilities and quick actions
const PAGE_CONTEXTS: Record<string, PageContext> = {
  dashboard: {
    type: "dashboard",
    name: "Dashboard",
    icon: LayoutDashboard,
    description: "Overview of your workspace with stats and recent activity",
    capabilities: [
      "View workspace statistics and metrics",
      "See recent tickets and tasks",
      "Check team activity and progress",
      "Get insights on productivity trends",
    ],
    quickActions: [
      {
        label: "Status report",
        prompt:
          "Give me a status report of my workspace. What are the key metrics and any items needing attention?",
      },
      {
        label: "What's new?",
        prompt:
          "What's happened recently in my workspace? Any updates I should know about?",
      },
      {
        label: "Productivity tips",
        prompt:
          "Based on my current workload, what productivity tips do you have?",
      },
    ],
  },
  tickets: {
    type: "tickets",
    name: "Tickets",
    icon: Ticket,
    description: "Manage and track your tickets",
    capabilities: [
      "Create new tickets",
      "Search and filter tickets",
      "Update ticket status and priority",
      "Add comments and checklists",
      "Assign tickets to team members",
    ],
    quickActions: [
      {
        label: "Create ticket",
        prompt: "Help me create a new ticket. Ask me what it should be about.",
      },
      {
        label: "Find tickets",
        prompt: "Help me find tickets. What would you like to search for?",
      },
      {
        label: "Ticket overview",
        prompt:
          "Give me an overview of my tickets - how many are open, in progress, and done?",
      },
    ],
  },
  ticketDetail: {
    type: "ticket-detail",
    name: "Ticket Details",
    icon: Ticket,
    description: "Viewing a specific ticket",
    capabilities: [
      "Update this ticket (status, priority, description)",
      "Add comments to this ticket",
      "Create checklists and subtasks",
      "Link related tickets",
      "Generate AI summaries",
    ],
    quickActions: [
      {
        label: "Summarize",
        prompt: "Summarize this ticket and its current status for me.",
      },
      {
        label: "Suggest next steps",
        prompt:
          "Based on this ticket, what should be the next steps to resolve it?",
      },
      {
        label: "Draft comment",
        prompt: "Help me draft a status update comment for this ticket.",
      },
    ],
  },
  projects: {
    type: "projects",
    name: "Projects",
    icon: FolderKanban,
    description: "Manage your projects and sprints",
    capabilities: [
      "Create new projects",
      "View project progress",
      "Manage sprints and iterations",
      "See project analytics",
    ],
    quickActions: [
      {
        label: "Create project",
        prompt:
          "Help me create a new project. What should it be called and what prefix should it use?",
      },
      {
        label: "Project status",
        prompt: "Give me a status update on all my projects.",
      },
      {
        label: "Sprint planning",
        prompt: "Help me plan a new sprint. What tickets should be included?",
      },
    ],
  },
  projectDetail: {
    type: "project-detail",
    name: "Project Details",
    icon: FolderKanban,
    description: "Viewing a specific project",
    capabilities: [
      "View project metrics and progress",
      "Manage sprints for this project",
      "See all tickets in this project",
      "Update project settings",
    ],
    quickActions: [
      {
        label: "Project summary",
        prompt:
          "Give me a summary of this project - progress, blockers, and upcoming work.",
      },
      {
        label: "Sprint status",
        prompt: "What's the status of the current sprint in this project?",
      },
      {
        label: "Create ticket",
        prompt: "Help me create a new ticket for this project.",
      },
    ],
  },
  tasks: {
    type: "tasks",
    name: "Tasks",
    icon: ListTodo,
    description: "View and manage AI agent tasks",
    capabilities: [
      "View pending and completed tasks",
      "Retry failed tasks",
      "See task execution details",
      "Monitor agent activity",
    ],
    quickActions: [
      {
        label: "Task status",
        prompt:
          "Give me an overview of my task queue - pending, running, and completed.",
      },
      {
        label: "Failed tasks",
        prompt: "Are there any failed tasks that need attention?",
      },
      {
        label: "Agent activity",
        prompt: "What are my AI agents currently working on?",
      },
    ],
  },
  summaries: {
    type: "summaries",
    name: "Summaries",
    icon: FileText,
    description: "AI-generated session summaries",
    capabilities: [
      "Browse past session summaries",
      "Search for specific work",
      "Review completed work history",
    ],
    quickActions: [
      {
        label: "Recent work",
        prompt:
          "What work has been completed recently? Show me recent summaries.",
      },
      {
        label: "Find summary",
        prompt: "Help me find a summary about a specific topic or task.",
      },
    ],
  },
  costs: {
    type: "costs",
    name: "Cost Dashboard",
    icon: Coins,
    description: "Track AI usage and costs",
    capabilities: [
      "View token usage statistics",
      "Monitor cost trends",
      "See cost breakdown by model",
      "Set usage alerts",
    ],
    quickActions: [
      {
        label: "Cost summary",
        prompt: "What's my AI usage and cost this month?",
      },
      {
        label: "Compare models",
        prompt: "Compare the costs between different AI models I use.",
      },
    ],
  },
  gateway: {
    type: "gateway",
    name: "AI Gateway",
    icon: Zap,
    description: "Manage AI agent workflows",
    capabilities: [
      "Execute AI workflows",
      "Configure agents",
      "Monitor gateway status",
    ],
    quickActions: [
      {
        label: "Run workflow",
        prompt: "Help me run an AI workflow. What task should I execute?",
      },
      {
        label: "Gateway status",
        prompt: "What's the status of the AI gateway?",
      },
    ],
  },
  agents: {
    type: "agents",
    name: "Agents",
    icon: Bot,
    description: "Configure AI agents",
    capabilities: [
      "View available agents",
      "Configure agent settings",
      "Monitor agent health",
    ],
    quickActions: [
      { label: "Agent status", prompt: "Show me the status of all AI agents." },
      { label: "Configure agent", prompt: "Help me configure an AI agent." },
    ],
  },
  settings: {
    type: "settings",
    name: "Settings",
    icon: Settings,
    description: "Configure GLINR settings",
    capabilities: [
      "Configure AI providers",
      "Manage integrations",
      "Update preferences",
    ],
    quickActions: [
      { label: "Setup help", prompt: "Help me set up and configure GLINR." },
      { label: "Provider config", prompt: "Help me configure an AI provider." },
    ],
  },
  webhooks: {
    type: "webhooks",
    name: "Webhooks",
    icon: Webhook,
    description: "Manage webhook integrations",
    capabilities: [
      "View webhook status",
      "Test webhook connections",
      "Configure webhook endpoints",
    ],
    quickActions: [
      {
        label: "Webhook status",
        prompt: "Show me the status of all webhooks.",
      },
      {
        label: "Setup webhook",
        prompt: "Help me set up a new webhook integration.",
      },
    ],
  },
  failed: {
    type: "failed",
    name: "Failed Tasks",
    icon: AlertTriangle,
    description: "Review and retry failed tasks",
    capabilities: [
      "View failed task details",
      "Retry failed tasks",
      "Analyze failure patterns",
    ],
    quickActions: [
      {
        label: "Analyze failures",
        prompt: "Analyze the failed tasks and tell me what went wrong.",
      },
      { label: "Retry all", prompt: "Help me retry the failed tasks." },
    ],
  },
  memory: {
    type: "memory",
    name: "Memory",
    icon: Brain,
    description: "AI memory and context",
    capabilities: [
      "Search memory for past context",
      "View memory statistics",
      "Manage memory files",
    ],
    quickActions: [
      {
        label: "Search memory",
        prompt: "Search my memory for information about...",
      },
      { label: "Memory stats", prompt: "What's stored in my AI memory?" },
    ],
  },
  cron: {
    type: "cron",
    name: "Scheduled Jobs",
    icon: Clock,
    description: "Manage automated scheduled tasks",
    capabilities: [
      "Create new scheduled jobs",
      "View job status and history",
      "Trigger jobs manually",
      "Pause and resume jobs",
      "Monitor execution logs",
    ],
    quickActions: [
      {
        label: "Job status",
        prompt:
          "Show me the status of all my scheduled jobs. How many are active, paused, or failed?",
      },
      {
        label: "Recent failures",
        prompt:
          "Are there any failed scheduled jobs? Show me the recent failures and what went wrong.",
      },
      {
        label: "Create job",
        prompt:
          "Help me create a new scheduled job. What task should it automate and how often should it run?",
      },
      {
        label: "Job history",
        prompt:
          "Show me the execution history of my scheduled jobs. Which ones ran recently?",
      },
    ],
  },
  default: {
    type: "default",
    name: "GLINR",
    icon: Sparkles,
    description: "AI-powered task management",
    capabilities: [
      "Answer questions about GLINR",
      "Help with navigation",
      "Provide general assistance",
    ],
    quickActions: [
      { label: "Help", prompt: "What can you help me with in GLINR?" },
      { label: "Navigate", prompt: "Help me find what I need in GLINR." },
    ],
  },
};

// Detect current page context from route
function usePageContext(): { context: PageContext; entityId?: string } {
  const location = useLocation();
  const path = location.pathname;

  return useMemo(() => {
    // Check for specific routes
    if (path === "/") {
      return { context: PAGE_CONTEXTS.dashboard };
    }

    // Ticket detail page
    const ticketMatch = path.match(/^\/tickets\/([^/]+)$/);
    if (ticketMatch && ticketMatch[1] !== "board") {
      return { context: PAGE_CONTEXTS.ticketDetail, entityId: ticketMatch[1] };
    }

    // Ticket list/board
    if (path === "/tickets" || path === "/tickets/board") {
      return { context: PAGE_CONTEXTS.tickets };
    }

    // Project detail page
    const projectMatch = path.match(/^\/projects\/([^/]+)$/);
    if (projectMatch) {
      return {
        context: PAGE_CONTEXTS.projectDetail,
        entityId: projectMatch[1],
      };
    }

    // Project list
    if (path === "/projects") {
      return { context: PAGE_CONTEXTS.projects };
    }

    // Task detail
    const taskMatch = path.match(/^\/tasks\/([^/]+)$/);
    if (taskMatch) {
      return { context: PAGE_CONTEXTS.tasks, entityId: taskMatch[1] };
    }

    // Other pages
    if (path === "/tasks") return { context: PAGE_CONTEXTS.tasks };
    if (path.startsWith("/summaries"))
      return { context: PAGE_CONTEXTS.summaries };
    if (path === "/costs") return { context: PAGE_CONTEXTS.costs };
    if (path === "/gateway") return { context: PAGE_CONTEXTS.gateway };
    if (path === "/agents") return { context: PAGE_CONTEXTS.agents };
    if (path.startsWith("/settings"))
      return { context: PAGE_CONTEXTS.settings };
    if (path === "/webhooks") return { context: PAGE_CONTEXTS.webhooks };
    if (path === "/failed") return { context: PAGE_CONTEXTS.failed };
    if (path === "/memory") return { context: PAGE_CONTEXTS.memory };
    if (path === "/cron") return { context: PAGE_CONTEXTS.cron };

    return { context: PAGE_CONTEXTS.default };
  }, [path]);
}

// Tool call display component
function ToolCallDisplay({
  toolCall,
}: {
  toolCall: NonNullable<ChatMessage["toolCalls"]>[0];
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="mt-2 p-2 rounded-lg bg-muted/50 border border-border/50 text-xs">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 w-full text-left"
      >
        <Wrench className="h-3 w-3 text-blue-500" />
        <span className="font-medium">{toolCall.name}</span>
        {toolCall.status === "success" && (
          <CheckCircle className="h-3 w-3 text-green-500 ml-auto" />
        )}
        {toolCall.status === "error" && (
          <XCircle className="h-3 w-3 text-red-500 ml-auto" />
        )}
        {toolCall.status === "pending" && (
          <Loader2 className="h-3 w-3 animate-spin text-yellow-500 ml-auto" />
        )}
      </button>
      {isExpanded && (
        <div className="mt-2 space-y-1">
          <div className="text-muted-foreground">
            <span className="font-medium">Args:</span>
            <pre className="mt-1 p-1 bg-background rounded text-[10px] overflow-x-auto">
              {JSON.stringify(toolCall.arguments, null, 2)}
            </pre>
          </div>
          {toolCall.result !== undefined && toolCall.result !== null && (
            <div className="text-muted-foreground">
              <span className="font-medium">Result:</span>
              <pre className="mt-1 p-1 bg-background rounded text-[10px] overflow-x-auto max-h-24 overflow-y-auto">
                {typeof toolCall.result === "string"
                  ? toolCall.result
                  : JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FloatingChatbot() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const { context: pageContext, entityId } = usePageContext();
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Check if we're on the chat page (used for conditional rendering, not early return)
  const isOnChatPage =
    location.pathname === "/chat" || location.pathname.startsWith("/chat/");

  // Fetch ticket data if on ticket detail page
  const { data: ticketData } = useQuery({
    queryKey: ["ticket", entityId],
    queryFn: () => api.tickets.get(entityId!, false),
    enabled: pageContext.type === "ticket-detail" && !!entityId,
  });

  // Fetch project data if on project detail page
  const { data: projectData } = useQuery({
    queryKey: ["project", entityId],
    queryFn: () => api.projects.get(entityId!),
    enabled: pageContext.type === "project-detail" && !!entityId,
  });

  // Fetch current provider info
  const { data: providerData } = useQuery({
    queryKey: ["chat-providers"],
    queryFn: () => api.chat.providers(),
    staleTime: 60000,
  });

  // Fetch available models
  const { data: modelsData } = useQuery({
    queryKey: ["chat", "models"],
    queryFn: () => api.chat.models(),
    staleTime: 60000,
  });

  // Selected model for this chatbot (separate from main chat)
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("glinr-floating-chat-model") || "";
    }
    return "";
  });

  // Handle model change
  const handleModelChange = (model: string) => {
    setSelectedModel(model);
    localStorage.setItem("glinr-floating-chat-model", model);
  };

  // Get available models (filtered by configured providers)
  const aliases = useMemo(() => modelsData?.aliases || [], [modelsData]);
  const providers = useMemo(
    () => providerData?.providers || [],
    [providerData],
  );
  const configuredProviderTypes = useMemo(
    () => new Set(providers.map((p: { type: string }) => p.type)),
    [providers],
  );

  const availableModels = useMemo(
    () =>
      aliases
        .filter((alias: { provider: string }) =>
          configuredProviderTypes.has(alias.provider),
        )
        .reduce(
          (
            acc: Record<
              string,
              { alias: string; provider: string; model: string }
            >,
            alias: { alias: string; provider: string; model: string },
          ) => {
            const key = alias.provider;
            if (!acc[key] || alias.alias.length < acc[key].alias.length) {
              acc[key] = alias;
            }
            return acc;
          },
          {} as Record<
            string,
            { alias: string; provider: string; model: string }
          >,
        ),
    [aliases, configuredProviderTypes],
  );

  const sortedModels = useMemo(
    () =>
      Object.values(availableModels).sort((a, b) => {
        const aHealthy = providers.find(
          (p: { type: string; healthy: boolean }) => p.type === a.provider,
        )?.healthy
          ? 1
          : 0;
        const bHealthy = providers.find(
          (p: { type: string; healthy: boolean }) => p.type === b.provider,
        )?.healthy
          ? 1
          : 0;
        return bHealthy - aHealthy || a.provider.localeCompare(b.provider);
      }),
    [availableModels, providers],
  );

  // Auto-select first healthy model if none selected
  useEffect(() => {
    if (!selectedModel && sortedModels.length > 0) {
      const firstHealthy = sortedModels.find(
        (m) =>
          providers.find(
            (p: { type: string; healthy: boolean }) => p.type === m.provider,
          )?.healthy,
      );
      if (firstHealthy) {
        setSelectedModel(firstHealthy.alias);
      }
    }
  }, [selectedModel, sortedModels, providers]);

  // Set default model from provider data (unused effect for now, provider info shown in footer)
  // The actual model used comes from the API response after first message

  // Load conversation from storage on mount or context change
  const storageKey = getStorageKey(pageContext.type, entityId);

  useEffect(() => {
    const loadConversation = async () => {
      const storedConversationId = localStorage.getItem(storageKey);

      if (storedConversationId) {
        setIsLoadingHistory(true);
        try {
          const data = await api.chat.conversations.get(storedConversationId);
          setConversationId(storedConversationId);

          // Convert stored messages to local format
          const loadedMessages: ChatMessage[] = data.messages
            .filter((m) => m.role !== "system")
            .map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              timestamp: new Date(m.createdAt),
              model: m.model,
              provider: m.provider,
              toolCalls: m.toolCalls?.map((tc) => ({
                ...tc,
                status: "success" as const,
              })),
            }));

          setMessages(loadedMessages);

          // Get model from last assistant message
          const lastAssistant = loadedMessages
            .filter((m) => m.role === "assistant")
            .pop();
          if (lastAssistant?.model) {
            setCurrentModel(lastAssistant.model);
          }
        } catch {
          // Conversation doesn't exist anymore, clear storage
          localStorage.removeItem(storageKey);
          setConversationId(null);
          setMessages([]);
        } finally {
          setIsLoadingHistory(false);
        }
      } else {
        setConversationId(null);
        setMessages([]);
      }
    };

    if (isOpen) {
      loadConversation();
    }
  }, [storageKey, isOpen]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && !isLoadingHistory) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, isLoadingHistory]);

  // Create conversation mutation
  const createConversationMutation = useMutation({
    mutationFn: async () => {
      const title = `${pageContext.name} Chat`;
      const data = await api.chat.conversations.create({
        title,
        presetId: "glinr-assistant",
        ticketId: pageContext.type === "ticket-detail" ? entityId : undefined,
        projectId: pageContext.type === "project-detail" ? entityId : undefined,
      });
      return data.conversation.id;
    },
    onSuccess: (newConversationId) => {
      setConversationId(newConversationId);
      localStorage.setItem(storageKey, newConversationId);
    },
  });

  // Send message mutation (with tools)
  const sendMessageMutation = useMutation({
    mutationFn: async (userMessage: string) => {
      // Ensure we have a conversation
      let currentConversationId = conversationId;
      if (!currentConversationId) {
        currentConversationId = await createConversationMutation.mutateAsync();
      }

      // Add user message to UI
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: userMessage,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);

      // Add loading assistant message
      const loadingId = `assistant-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: loadingId,
          role: "assistant",
          content: "",
          timestamp: new Date(),
          isLoading: true,
        },
      ]);

      // Send message with tools enabled and selected model
      const response = await api.chat.conversations.sendMessageWithTools(
        currentConversationId!,
        {
          content: userMessage,
          enableTools: true,
          model: selectedModel || undefined,
        },
      );

      return {
        loadingId,
        response,
      };
    },
    onSuccess: ({ loadingId, response }) => {
      // Update model info
      if (response.assistantMessage.model) {
        setCurrentModel(response.assistantMessage.model);
      }

      // Replace loading message with actual response
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === loadingId
            ? {
                ...msg,
                id: response.assistantMessage.id,
                content: response.assistantMessage.content,
                isLoading: false,
                model: response.assistantMessage.model,
                provider: response.assistantMessage.provider,
                toolCalls: response.assistantMessage.toolCalls?.map((tc) => ({
                  ...tc,
                  status: "success" as const,
                })),
              }
            : msg,
        ),
      );

      // Invalidate related queries if tools were called
      if (response.assistantMessage.toolCalls?.length) {
        queryClient.invalidateQueries({ queryKey: ["tickets"] });
        queryClient.invalidateQueries({ queryKey: ["projects"] });
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
      }
    },
    onError: (error) => {
      // Remove loading message and show error
      setMessages((prev) => {
        const withoutLoading = prev.filter((m) => !m.isLoading);
        return [
          ...withoutLoading,
          {
            id: `error-${Date.now()}`,
            role: "assistant",
            content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : "Unknown error"}`,
            timestamp: new Date(),
          },
        ];
      });
    },
  });

  const handleSend = () => {
    if (!input.trim() || sendMessageMutation.isPending) return;
    const message = input.trim();
    setInput("");
    sendMessageMutation.mutate(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearChat = async () => {
    // Delete conversation if exists
    if (conversationId) {
      try {
        await api.chat.conversations.delete(conversationId);
      } catch {
        // Ignore errors
      }
      localStorage.removeItem(storageKey);
      setConversationId(null);
    }
    setMessages([]);
    setCurrentModel(null);
  };

  const PageIcon = pageContext.icon;

  // Don't render on /chat page to avoid overlap with full chat view
  if (isOnChatPage) {
    return null;
  }

  return (
    <>
      {/* Chat Window - Liquid Glass Effect */}
      {isOpen && (
        <div
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden transition-all duration-300 ease-out",
            // Responsive positioning
            "bottom-24 right-4 sm:right-6",
            // Clean panel styling
            "glass-heavy",
            "rounded-[2rem] shadow-2xl shadow-primary/10",
            // Responsive sizes - larger on desktop
            isExpanded
              ? "w-[calc(100vw-2rem)] sm:w-130 md:w-150 lg:w-170 h-[72vh] sm:h-155 md:h-180"
              : "w-[calc(100vw-2rem)] sm:w-105 md:w-120 h-[62vh] sm:h-140 md:h-155",
          )}
        >
          {/* Header - Glass effect */}
          <div className="flex items-center justify-between px-5 py-4 bg-primary/5">
            <div className="flex items-center gap-3">
              <div className="relative h-9 w-9 rounded-xl glass-heavy flex items-center justify-center shadow-lg shadow-primary/5">
                <Sparkles className="h-5 w-5 text-primary" />
                <span className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 text-[8px] font-black uppercase rounded-lg bg-primary text-primary-foreground leading-none shadow-sm">
                  Beta
                </span>
              </div>
              <div>
                <h3 className="text-sm font-black tracking-tight uppercase tracking-[0.1em]">GLINR Assistant</h3>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-semibold">
                  <PageIcon className="h-3 w-3" />
                  <span className="uppercase tracking-widest">{pageContext.name}</span>
                  {entityId && ticketData && (
                    <span className="text-sky-600 dark:text-sky-400">
                      • GLINR-{(ticketData as { sequence?: number }).sequence}
                    </span>
                  )}
                  {entityId && projectData && (
                    <span className="text-sky-600 dark:text-sky-400">
                      • {(projectData as { key?: string }).key}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {/* Model Switcher */}
            {sortedModels.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-bold bg-primary/10 hover:bg-primary/20 transition-all shadow-sm">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        providers.find(
                          (p: { type: string; healthy: boolean }) =>
                            p.type ===
                            aliases.find(
                              (a: { alias: string }) =>
                                a.alias === selectedModel,
                            )?.provider,
                        )?.healthy
                          ? "bg-emerald-500 shadow-[0_0_8px_var(--success)]"
                          : "bg-amber-400 shadow-[0_0_8px_var(--warning)]",
                      )}
                    />
                    <Cpu className="h-3.5 w-3.5 text-primary" />
                    <span className="capitalize max-w-20 truncate text-primary font-black">
                      {selectedModel || currentModel || "Model"}
                    </span>
                    <ChevronDown className="h-3 w-3 text-primary opacity-50" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-52 glass-heavy shadow-2xl"
                >
                  <div className="px-2 py-1.5 text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
                    Select Model
                  </div>
                  <DropdownMenuSeparator />
                  {sortedModels.map((alias) => {
                    const provider = providers.find(
                      (p: { type: string }) => p.type === alias.provider,
                    );
                    const isHealthy = provider?.healthy;
                    const isSelected =
                      (selectedModel || currentModel) === alias.alias;
                    const isLocal = alias.provider === "ollama";
                    return (
                      <DropdownMenuItem
                        key={alias.alias}
                        onClick={() => handleModelChange(alias.alias)}
                        className={cn(
                          "flex items-center justify-between cursor-pointer text-xs py-2",
                          isSelected && "bg-primary/20",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              isHealthy ? "bg-emerald-500" : "bg-amber-400",
                            )}
                          />
                          <span
                            className={cn(
                              "capitalize font-bold",
                              isSelected && "text-primary",
                            )}
                          >
                            {alias.alias}
                          </span>
                        </div>
                        <span className="text-[9px] text-muted-foreground">
                          {isLocal ? "Local" : alias.provider}
                        </span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearChat}
                  className="h-7 w-7 p-0"
                  title="Clear chat"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded(!isExpanded)}
                className="h-7 w-7 p-0"
                title={isExpanded ? "Minimize" : "Expand"}
              >
                {isExpanded ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsOpen(false)}
                className="h-7 w-7 p-0"
                title="Close"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5 scrollbar-none liquid-fade-y">
            {isLoadingHistory ? (
              <div className="flex flex-col items-center justify-center h-full">
                <RefreshCw className="h-6 w-6 animate-spin text-sky-500 mb-2" />
                <p className="text-xs text-muted-foreground">
                  Loading conversation...
                </p>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <div className="h-12 w-12 rounded-xl bg-sky-500/10 flex items-center justify-center mb-3">
                  <PageIcon className="h-6 w-6 text-sky-500" />
                </div>
                <h4 className="text-sm font-medium mb-1">
                  {pageContext.name} Assistant
                </h4>
                <p className="text-xs text-muted-foreground mb-4 max-w-70">
                  {pageContext.description}. How can I help?
                </p>

                {/* Context-specific quick actions */}
                <div className="w-full space-y-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    Quick Actions
                  </p>
                  <div className="flex flex-col gap-2">
                    {pageContext.quickActions.map((action) => (
                      <button
                        key={action.label}
                        onClick={() => {
                          setInput(action.prompt);
                          setTimeout(() => inputRef.current?.focus(), 0);
                        }}
                        className="px-3 py-2 text-xs text-left rounded-lg bg-muted/50 hover:bg-muted transition-colors border border-transparent hover:border-border"
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Capabilities hint */}
                <div className="mt-4 pt-4 border-t border-border w-full">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">
                    I can help you
                  </p>
                  <ul className="text-[11px] text-muted-foreground text-left space-y-1">
                    {pageContext.capabilities.slice(0, 3).map((cap, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="text-sky-500 mt-0.5">•</span>
                        {cap}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Model info footer */}
                {providerData?.default && (
                  <div className="mt-4 pt-2 text-[10px] text-muted-foreground/70 flex items-center gap-1">
                    <Cpu className="h-3 w-3" />
                    <span>Powered by {providerData.default}</span>
                  </div>
                )}
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex gap-3",
                    message.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  {message.role === "assistant" && (
                    <div className="h-7 w-7 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                      <Bot className="h-4 w-4 text-zinc-500" />
                    </div>
                  )}
                  <div
                    className={cn(
                      "max-w-[85%] rounded-[1.5rem] px-5 py-3.5 text-[14px] leading-relaxed shadow-lg transition-all",
                      message.role === "user"
                        ? "bg-primary text-primary-foreground rounded-tr-sm ml-auto shadow-primary/10"
                        : "glass text-foreground rounded-tl-sm shadow-sm",
                      message.role === "assistant" && "mr-auto"
                    )}
                  >
                    {message.isLoading ? (
                      <div className="flex items-center gap-2 py-0.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 dark:bg-zinc-600 animate-bounce delay-0" />
                        <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 dark:bg-zinc-600 animate-bounce delay-150" />
                        <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 dark:bg-zinc-600 animate-bounce delay-300" />
                      </div>
                    ) : message.role === "assistant" ? (
                      <>
                        <MarkdownRenderer content={message.content} />
                        {/* Tool calls display */}
                        {message.toolCalls && message.toolCalls.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {message.toolCalls.map((tc) => (
                              <ToolCallDisplay key={tc.id} toolCall={tc} />
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    )}
                  </div>
                  {message.role === "user" && (
                    <div className="h-8 w-8 rounded-xl glass-heavy flex items-center justify-center shrink-0 shadow-lg">
                      <User className="h-4.5 w-4.5 text-primary" />
                    </div>
                  )}
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input - Glass effect */}
          <div className="p-4 bg-primary/5">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Ask about ${pageContext.name.toLowerCase()}...`}
                rows={1}
                disabled={isLoadingHistory}
                className="flex-1 px-4 py-3 text-sm glass rounded-[1.5rem] resize-none focus:outline-none focus:ring-1 focus:ring-primary/20 focus:bg-white/50 dark:focus:bg-black/50 min-h-11 max-h-32 placeholder:text-muted-foreground/50 disabled:opacity-50 transition-all font-medium"
                style={{
                  height: "auto",
                  overflow: input.split("\n").length > 3 ? "auto" : "hidden",
                }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = "auto";
                  target.style.height =
                    Math.min(target.scrollHeight, 120) + "px";
                }}
              />
              <Button
                onClick={handleSend}
                disabled={
                  !input.trim() ||
                  sendMessageMutation.isPending ||
                  isLoadingHistory
                }
                size="sm"
                className="h-11 w-11 p-0 rounded-2xl bg-primary hover:bg-primary-hover text-primary-foreground shadow-xl shadow-primary/20 hover:scale-110 active:scale-95 transition-all"
              >
                {sendMessageMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground text-center mt-2 font-medium opacity-60">
              Press Enter to send • Shift+Enter for new line
              {messages.length > 0 && " • Session auto-saved"}
            </p>
          </div>
        </div>
      )}

      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "fixed bottom-6 right-6 z-50 h-[60px] w-[60px] rounded-[1.5rem] flex items-center justify-center transition-all duration-300 ease-out hover:scale-110 active:scale-90 shadow-2xl",
          isOpen
            ? "glass-heavy text-primary shadow-primary/10"
            : "bg-primary text-primary-foreground shadow-primary/30",
        )}
        title={
          isOpen ? "Close chat" : `Open GLINR Assistant (${pageContext.name})`
        }
      >
        {isOpen ? (
          <MessageSquare className="h-6 w-6" />
        ) : (
          <Sparkles className="h-6 w-6" />
        )}
      </button>
    </>
  );
}

export default FloatingChatbot;
