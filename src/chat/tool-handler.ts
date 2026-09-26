/**
 * Chat Tool Handler
 *
 * Bridges AI chat with the tool execution security pipeline.
 * Converts tool definitions and handles execution through ToolExecutor.
 */

import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  getToolExecutor,
  getToolRegistry,
  initializeToolExecution,
  type ToolExecutionContext,
  type SecurityPolicy,
  type SessionManager,
  type ToolSession,
  type SessionFilter,
} from './execution/index.js';
import type {
  NativeToolDefinition,
  ToolExecutionResult,
} from '../providers/ai-sdk.js';
import { logger } from '../utils/logger.js';
import { SAFE_BROWSER_TOOL_NAMES } from '../browser/index.js';
import { ResultStore } from '../agents/result-store.js';
import { truncateAndStore, isTruncationEnabled } from '../agents/output-truncator.js';
import {
  LOAD_TOOLS_NAME,
  FETCH_RESULT_NAME,
  getToolSelectorSession,
} from '../agents/tool-selector.js';
import { runLoadTools, runFetchResult } from './meta-tool-handlers.js';

// Types

export interface ChatToolHandlerOptions {
  conversationId: string;
  userId?: string;
  workdir?: string;
  securityMode?: 'deny' | 'sandbox' | 'allowlist' | 'ask' | 'full';
}

export interface ChatToolHandler {
  /** Get tools formatted for AI provider */
  getTools(): NativeToolDefinition[];

  /** Execute a tool call through the security pipeline */
  executeTool(
    toolName: string,
    args: unknown,
    toolCallId: string
  ): Promise<ToolExecutionResult>;

  /** Get pending approvals for this conversation */
  getPendingApprovals(): Array<{
    id: string;
    toolName: string;
    command?: string;
    params: Record<string, unknown>;
  }>;

  /** Handle approval decision */
  handleApproval(
    approvalId: string,
    decision: 'allow-once' | 'allow-always' | 'deny'
  ): Promise<ToolExecutionResult | null>;

  /** Delete spilled tool-result temp files. Call when the request/run ends. */
  dispose(): Promise<void>;
}

// In-Memory Session Manager for Chat

class ChatSessionManager implements SessionManager {
  private sessions = new Map<string, ToolSession>();
  private counter = 0;

  create(session: Omit<ToolSession, 'id' | 'createdAt'>): ToolSession {
    const id = `chat-session-${++this.counter}-${Date.now()}`;
    const fullSession: ToolSession = {
      ...session,
      id,
      createdAt: Date.now(),
    };
    this.sessions.set(id, fullSession);
    return fullSession;
  }

  get(sessionId: string): ToolSession | undefined {
    return this.sessions.get(sessionId);
  }

  update(sessionId: string, update: Partial<ToolSession>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.set(sessionId, { ...session, ...update });
    }
  }

  list(filter?: SessionFilter): ToolSession[] {
    let sessions = Array.from(this.sessions.values());

    if (filter?.conversationId) {
      sessions = sessions.filter(s => s.conversationId === filter.conversationId);
    }
    if (filter?.toolName) {
      sessions = sessions.filter(s => s.toolName === filter.toolName);
    }
    if (filter?.status) {
      sessions = sessions.filter(s => filter.status!.includes(s.status));
    }

    return sessions;
  }

  async kill(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session?.pid) {
      try {
        process.kill(session.pid, 'SIGTERM');
      } catch {
        // Process may have already exited
      }
    }
    this.update(sessionId, { status: 'killed', completedAt: Date.now() });
  }

  cleanup(): void {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes

    for (const [id, session] of this.sessions) {
      if (session.completedAt && now - session.completedAt > maxAge) {
        this.sessions.delete(id);
      }
    }
  }
}

// Chat Tool Handler Implementation

let initialized = false;

export async function createChatToolHandler(
  options: ChatToolHandlerOptions
): Promise<ChatToolHandler> {
  // Initialize tool execution system if needed
  if (!initialized) {
    await initializeToolExecution({ registerBuiltins: true });
    initialized = true;
  }

  const registry = getToolRegistry();
  const executor = getToolExecutor();
  const sessionManager = new ChatSessionManager();
  const resultStore = new ResultStore(options.conversationId.replace(/[^a-zA-Z0-9_-]/g, '_'));

  /** Cap large results before they reach the model; the full result stays in the store. */
  const capForModel = async (toolName: string, toolCallId: string, data: unknown): Promise<unknown> => {
    if (!isTruncationEnabled() || toolName === FETCH_RESULT_NAME || toolName === LOAD_TOOLS_NAME) {
      return data;
    }
    try {
      return (await truncateAndStore(resultStore, toolCallId, data)).value;
    } catch (error) {
      logger.warn(`[ChatToolHandler] Output truncation failed for ${toolName}`, {
        component: 'ChatToolHandler',
        error: error instanceof Error ? error.message : String(error),
      });
      return data;
    }
  };

  // Build security policy
  const securityPolicy: SecurityPolicy = {
    mode: options.securityMode || 'ask',
    askTimeout: 60000, // 1 minute timeout for approvals
  };

  // Create execution context factory
  const createContext = (toolCallId: string): ToolExecutionContext => ({
    toolCallId,
    conversationId: options.conversationId,
    userId: options.userId,
    workdir: options.workdir || process.cwd(),
    env: process.env as Record<string, string>,
    securityPolicy,
    sessionManager,
  });

  const handler: ChatToolHandler = {
    getTools(): NativeToolDefinition[] {
      const tools = registry.list();
      return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as z.ZodType<unknown>,
      }));
    },

    async executeTool(
      toolName: string,
      args: unknown,
      toolCallId: string
    ): Promise<ToolExecutionResult> {
      logger.info(`[ChatToolHandler] Executing tool: ${toolName}`, {
        component: 'ChatToolHandler',
        toolCallId,
      });

      // Meta-tools are served locally, not through the registry
      if (toolName === LOAD_TOOLS_NAME) {
        const allTools = registry.list().map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        }));
        return {
          result: await runLoadTools(args, {
            session: getToolSelectorSession(options.conversationId),
            allTools,
            invoke: async (tool, toolArgs) => (await handler.executeTool(tool, toolArgs, randomUUID())).result,
          }),
        };
      }
      if (toolName === FETCH_RESULT_NAME) {
        return { result: await runFetchResult(args, resultStore) };
      }

      try {
        getToolSelectorSession(options.conversationId).noteToolUse(toolName);
        const context = createContext(toolCallId);
        const result = await executor.execute(
          {
            id: toolCallId,
            name: toolName,
            arguments: args as Record<string, unknown>,
          },
          context
        );

        // Check if approval is required
        if (result.approvalRequired && result.approvalId) {
          logger.info(`[ChatToolHandler] Tool requires approval: ${toolName}`, {
            component: 'ChatToolHandler',
            approvalId: result.approvalId,
          });

          return {
            result: {
              pending: true,
              message: `Tool "${toolName}" requires approval before execution.`,
              approvalId: result.approvalId,
            },
            approvalRequired: true,
            approvalId: result.approvalId,
          };
        }

        // Return clean data for AI SDK (avoids ModelMessage[] schema errors)
        // The AI only sees `result` — `output` is preserved for UI rendering
        if (result.result.success) {
          // Extract clean data for the AI model
          const aiResult = await capForModel(toolName, toolCallId, result.result.data ?? { success: true });
          return {
            result: aiResult,
            output: result.result.output,  // Sidecar for UI display
          };
        }

        return {
          result: {
            success: false,
            error: result.result.error?.message || 'Tool execution failed',
          },
        };
      } catch (error) {
        logger.error(`[ChatToolHandler] Tool execution error: ${toolName}`, error instanceof Error ? error : undefined);
        return {
          result: {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    },

    getPendingApprovals(): Array<{
      id: string;
      toolName: string;
      command?: string;
      params: Record<string, unknown>;
    }> {
      const approvals = executor.getPendingApprovals(options.conversationId);
      return approvals.map((a) => ({
        id: a.id,
        toolName: a.toolName,
        command: a.command,
        params: a.params,
      }));
    },

    async dispose(): Promise<void> {
      await resultStore.cleanup();
    },

    async handleApproval(
      approvalId: string,
      decision: 'allow-once' | 'allow-always' | 'deny'
    ): Promise<ToolExecutionResult | null> {
      logger.info(`[ChatToolHandler] Handling approval: ${approvalId} -> ${decision}`, {
        component: 'ChatToolHandler',
      });

      try {
        const result = await executor.executeAfterApproval(
          approvalId,
          decision,
          createContext(randomUUID())
        );

        if (!result) {
          return null;
        }

        if (result.result.success) {
          const aiResult = await capForModel(approvalId, randomUUID(), result.result.data ?? { success: true });
          return {
            result: aiResult,
            output: result.result.output,
          };
        }

        return {
          result: {
            success: false,
            error: result.result.error?.message || 'Tool execution failed',
          },
        };
      } catch (error) {
        logger.error(`[ChatToolHandler] Approval handling error`, error instanceof Error ? error : undefined);
        return {
          result: {
            success: false,
            error: error instanceof Error ? error.message : 'Approval handling failed',
          },
        };
      }
    },
  };
  return handler;
}

// Tool Categories for Chat

/**
 * Get tools by category for selective tool exposure
 */
export function getToolCategories(): Record<string, string[]> {
  const registry = getToolRegistry();
  const tools = registry.list();

  const categories: Record<string, string[]> = {};
  for (const tool of tools) {
    const category = tool.category || 'custom';
    if (!categories[category]) {
      categories[category] = [];
    }
    categories[category].push(tool.name);
  }

  return categories;
}

/**
 * Get a subset of tools for chat
 * Default includes safe tools that are useful for general assistance
 */
export function getChatTools(
  include?: string[],
  exclude?: string[]
): NativeToolDefinition[] {
  const registry = getToolRegistry();
  let tools = registry.list();

  // Filter by include list
  if (include && include.length > 0) {
    tools = tools.filter((t) => include.includes(t.name));
  }

  // Filter by exclude list
  if (exclude && exclude.length > 0) {
    tools = tools.filter((t) => !exclude.includes(t.name));
  }

  // Filter out tools that aren't available (missing config, API keys, etc.)
  // Tools without isAvailable() are always included (assumed available)
  const unavailable: string[] = [];
  tools = tools.filter((t) => {
    if (!t.isAvailable) return true;
    const status = t.isAvailable();
    if (!status.available) {
      unavailable.push(`${t.name} (${status.reason || 'not configured'})`);
      return false;
    }
    return true;
  });

  if (unavailable.length > 0) {
    logger.info(`[ChatTools] Excluded unavailable tools: ${unavailable.join(', ')}`);
  }

  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as z.ZodType<unknown>,
  }));
}

// Default Chat Tools (safe subset)

/**
 * Get the default set of tools for chat
 * Excludes dangerous execution tools by default
 */
export function getDefaultChatTools(): NativeToolDefinition[] {
  // Default safe tools for chat assistance
  const safeTools = [
    // File operations (read-only)
    'read_file',
    'search_files',
    'grep',
    // System info (read-only)
    'system_info',
    'env_vars',
    'which',
    'path_info',
    'process_list',
    // Git operations (read-only)
    'git_status',
    'git_diff',
    'git_log',
    // Web operations
    'web_fetch',
    'web_search',
    // Session/agent info (read-only)
    'session_status',
    'sessions_list',
    'agents_list',
    // Memory operations (read-only)
    'memory_search',
    'memory_get',
    'memory_stats',
    // profClaw ops tools (internal ticket/project management)
    'create_ticket',
    'create_project',
    'list_tickets',
    'list_projects',
    'update_ticket',
    'get_ticket',
    // Task completion
    'complete_task',
    // Browser tools (safe ones from centralized definition)
    ...SAFE_BROWSER_TOOL_NAMES,
  ];

  return getChatTools(safeTools);
}

/**
 * Get all tools for power users (requires appropriate security mode)
 */
export function getAllChatTools(): NativeToolDefinition[] {
  return getChatTools();
}

/**
 * Get tools filtered for a specific model's capability.
 * Uses the tool router to select appropriate tools based on model size/capability.
 * Falls back to default tools if model routing is not applicable.
 */
export function getChatToolsForModel(
  modelId: string,
  options?: { includeAll?: boolean; conversationId?: string },
): NativeToolDefinition[] {
  const registry = getToolRegistry();
  const schemas = registry.getForModel(modelId, options?.conversationId);

  // Convert AIToolSchema back to NativeToolDefinition format
  return schemas.map((schema) => {
    const tool = registry.get(schema.function.name);
    if (!tool) {
      return {
        name: schema.function.name,
        description: schema.function.description,
        parameters: z.object({}) as z.ZodType<unknown>,
      };
    }
    return {
      name: tool.name,
      description: schema.function.description,
      parameters: tool.parameters as z.ZodType<unknown>,
    };
  });
}
