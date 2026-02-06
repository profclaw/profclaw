/**
 * Agentic Chat Executor
 *
 * Handles agentic mode chat using the AgentExecutor for multi-step task completion.
 * This is the bridge between the chat routes and the agent system.
 *
 * Features:
 * - Multi-step autonomous tool execution
 * - Real-time streaming updates
 * - Provider fallback on errors (OpenClaw-style)
 * - Robust error handling with error classification
 * - Provider cooldown tracking
 */

import { randomUUID } from 'node:crypto';
import { tool as createTool, jsonSchema } from 'ai';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import { AgentExecutor, type AgentState, type AgentConfig, type ToolCallRecord } from '../agents/index.js';
import { aiProvider, MODEL_ALIASES, type ChatMessage, type ProviderType } from '../providers/index.js';
import { normalizeToolSchema } from '../providers/schema-utils.js';
import { logger } from '../utils/logger.js';
import type { ChatToolHandler } from './tool-handler.js';
import {
  runWithModelFallback,
  getUserFriendlyErrorMessage,
  isProviderInCooldown,
  getProvidersInCooldown,
  describeFailoverError,
  coerceToFailoverError,
  type FallbackAttempt,
  type ModelResolver,
} from './failover/index.js';

// =============================================================================
// Model Resolution Helper
// =============================================================================

/**
 * Create a model resolver that uses aiProvider to get configured models.
 * This ensures Azure deployments and other provider-specific configs are used.
 */
function createModelResolver(): ModelResolver {
  return (provider: ProviderType): string | undefined => {
    try {
      // Use resolveModel with the provider name to get the configured default model
      // This handles Azure deployment names and other provider-specific configs
      const resolved = aiProvider.resolveModel(provider);
      if (resolved.provider === provider) {
        return resolved.model;
      }
    } catch {
      // Provider not configured, return undefined
    }
    return undefined;
  };
}

// =============================================================================
// Types
// =============================================================================

export interface AgenticChatRequest {
  conversationId: string;
  messages: ChatMessage[];
  systemPrompt: string;
  model?: string;
  provider?: string;
  temperature?: number;
  /** Thinking effort level for Anthropic models: low (cheap), medium, high, max (deep reasoning) */
  effort?: 'low' | 'medium' | 'high' | 'max';
  toolHandler: ChatToolHandler;
  tools: Array<{
    name: string;
    description: string;
    parameters: unknown;
  }>;
  onStep?: (state: AgentState) => void;
  onToolCall?: (state: AgentState, toolName: string, args: Record<string, unknown>) => void;
  onToolResult?: (state: AgentState, toolName: string, result: unknown) => void;
}

export interface AgenticChatResponse {
  content: string;
  model: string;
  provider: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number;
  };
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    result?: unknown;
    status: 'success' | 'error';
  }>;
  agentState: {
    sessionId: string;
    totalSteps: number;
    stopReason: string;
    artifacts: Array<{
      type: string;
      id: string;
      description?: string;
    }>;
  };
  /** Information about fallback attempts if any */
  fallbackInfo?: {
    usedFallback: boolean;
    requestedProvider: string;
    requestedModel: string;
    attempts: FallbackAttempt[];
  };
}

// =============================================================================
// Shared Tool Schema Conversion
// =============================================================================

/**
 * Convert tool definitions (with Zod parameters) to AI SDK format.
 * Handles Azure schema normalization automatically.
 */
 
function convertToolsToAiSdk(
  toolDefs: Array<{ name: string; description: string; parameters: unknown }>,
  provider: string,
  logPrefix: string,
  onToolExecute?: (name: string, args: Record<string, unknown>) => Promise<unknown>,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aiSdkTools: Record<string, any> = {};
  const isAzure = provider === 'azure';

  // Passthrough validator - accepts any value the model returns
  const passthroughValidate = (value: unknown) => ({
    success: true as const,
    value: value as Record<string, unknown>,
  });

  if (isAzure) {
    logger.info(`[${logPrefix}] Azure detected - normalizing ${toolDefs.length} tool schemas`);
  }

  for (const toolDef of toolDefs) {
    try {
      const rawJsonSchema = zodToJsonSchema(toolDef.parameters as z.ZodType, {
        $refStrategy: 'none',
      });

      // Build the execute function if onToolExecute is provided
      const execute = onToolExecute
        ? async (args: Record<string, unknown>) => onToolExecute(toolDef.name, args)
        : undefined;

      if (isAzure) {
        const normalized = normalizeToolSchema(rawJsonSchema);
        if (normalized.type !== 'object') {
          normalized.type = 'object';
        }
        if (!normalized.properties) {
          normalized.properties = {};
        }
         
        aiSdkTools[toolDef.name] = createTool({
          description: toolDef.description,
          inputSchema: jsonSchema(normalized as any, { validate: passthroughValidate }),
          execute,
        } as any);
      } else {
         
        aiSdkTools[toolDef.name] = createTool({
          description: toolDef.description,
          inputSchema: jsonSchema(rawJsonSchema as any, { validate: passthroughValidate }),
          execute,
        } as any);
      }
    } catch (schemaError) {
      logger.warn(`[${logPrefix}] Failed to create tool ${toolDef.name}, using minimal schema`, {
        error: schemaError instanceof Error ? schemaError.message : String(schemaError),
      });

      const execute = onToolExecute
        ? async (args: Record<string, unknown>) => onToolExecute(toolDef.name, args)
        : undefined;

       
      aiSdkTools[toolDef.name] = createTool({
        description: toolDef.description,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputSchema: jsonSchema({ type: 'object', properties: {} } as any, { validate: passthroughValidate }),
        execute,
      } as any);
    }
  }

  if (isAzure) {
    logger.info(`[${logPrefix}] Azure schema normalization complete`);
  }

  return aiSdkTools;
}

// =============================================================================
// Agentic Chat Executor
// =============================================================================

/**
 * Execute an agentic chat conversation.
 * Uses the AgentExecutor to run tools continuously until task completion.
 * Automatically falls back to other providers on failure.
 */
export async function executeAgenticChat(
  request: AgenticChatRequest
): Promise<AgenticChatResponse> {
  const sessionId = randomUUID();

  // Extract the user's goal from the last user message
  const lastUserMessage = [...request.messages].reverse().find((m) => m.role === 'user');
  const goal = lastUserMessage?.content || 'Complete the user request';

  logger.info('[AgenticChat] Starting agentic execution', {
    sessionId,
    conversationId: request.conversationId,
    goal: goal.substring(0, 100),
  });

  // Resolve the primary model and provider
  const explicitProvider = request.provider as ProviderType | undefined;
  const modelRef = request.model || 'sonnet';
  const aliasEntry = MODEL_ALIASES[modelRef as keyof typeof MODEL_ALIASES];
  const primaryProvider = explicitProvider || (aliasEntry?.provider || 'anthropic') as ProviderType;

  // For Azure and similar providers, use the configured deployment name, not hardcoded alias
  let primaryModel = aliasEntry?.model || modelRef;
  try {
    const resolved = aiProvider.resolveModel(primaryProvider);
    if (resolved.provider === primaryProvider && resolved.model) {
      primaryModel = resolved.model; // Use configured deployment (e.g., 'gpt4o')
    }
  } catch {
    // Keep the alias model if provider not configured
  }

  // Get configured providers
  const configuredProviders = aiProvider.getConfiguredProviders();

  // Log if any providers are in cooldown
  const cooldowns = getProvidersInCooldown();
  if (cooldowns.length > 0) {
    logger.info('[AgenticChat] Providers currently in cooldown', {
      cooldowns: cooldowns.map((c) => ({
        provider: c.provider,
        reason: c.reason,
        remainingMs: c.cooldownUntil - Date.now(),
      })),
    });
  }

  // Create agent configuration
  const agentConfig: Partial<AgentConfig> = {
    maxSteps: 50, // Allow up to 50 steps for complex tasks
    maxBudget: 50000, // 50k token budget
    securityMode: 'ask', // Prompt for approval when needed
    enableStreaming: true,
    effort: request.effort,
  };

  // Store raw tool definitions - we'll convert to AI SDK format per-provider
  const toolDefinitions = request.tools;

  // Build messages with system prompt
  const messages = [
    { role: 'system' as const, content: request.systemPrompt },
    ...request.messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    })),
  ];

  // Tool execution handler — unwrap ToolExecutionResult to return only the inner result
  // The executor.ts processToolCalls expects the raw tool result, not the wrapper
  const onToolExecute = async (toolName: string, args: Record<string, unknown>): Promise<unknown> => {
    const executionResult = await request.toolHandler.executeTool(toolName, args, randomUUID());
    return executionResult.result;
  };

  try {
    // Run with automatic fallback between providers
    const fallbackResult = await runWithModelFallback({
      primaryProvider,
      primaryModel,
      configuredProviders,
      modelResolver: createModelResolver(),
      run: async (provider, model) => {
        // Get the model instance for this provider
        const modelInstance = aiProvider.getModel(provider, model);

        // Convert tool definitions to AI SDK format with execute wrappers
        const aiSdkTools = convertToolsToAiSdk(toolDefinitions, provider, 'AgenticChat', onToolExecute);

        // Create the agent executor
        const agent = new AgentExecutor(sessionId, request.conversationId, goal, agentConfig);

        // Set up event handlers
        if (request.onStep) {
          agent.on('step:start', request.onStep);
        }

        if (request.onToolCall) {
          agent.on('tool:call', (state, toolCall) => {
            request.onToolCall!(state, toolCall.name, toolCall.args);
          });
        }

        if (request.onToolResult) {
          agent.on('tool:result', (state, toolCall) => {
            request.onToolResult!(state, toolCall.name, toolCall.result);
          });
        }

        // Run the agent with normalized tools (pass provider hint for effort/thinking)
        return agent.run(modelInstance, messages, aiSdkTools, onToolExecute, provider);
      },
      onError: (attempt) => {
        const described = describeFailoverError(attempt.error);
        logger.warn('[AgenticChat] Provider attempt failed', {
          provider: attempt.provider,
          model: attempt.model,
          error: described.message,
          reason: described.reason,
          attempt: attempt.attempt,
          total: attempt.total,
        });
      },
    });

    const finalState = fallbackResult.result;
    const actualProvider = fallbackResult.provider;
    const actualModel = fallbackResult.model;
    const usedFallback = actualProvider !== primaryProvider || actualModel !== primaryModel;

    if (usedFallback) {
      logger.info('[AgenticChat] Used fallback provider', {
        requested: `${primaryProvider}/${primaryModel}`,
        actual: `${actualProvider}/${actualModel}`,
        attempts: fallbackResult.attempts.length,
      });
    }

    // Build response
    const toolCalls = finalState.toolCallHistory.map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.args,
      result: tc.result,
      status: tc.status === 'executed' ? ('success' as const) : ('error' as const),
    }));

    // Extract content - executor's finalize() now handles the 3-tier priority
    const content = finalState.finalResult?.summary || 'Task completed.';

    logger.info('[AgenticChat] Completed agentic execution', {
      sessionId,
      steps: finalState.currentStep,
      toolCalls: toolCalls.length,
      stopReason: finalState.finalResult?.stopReason,
      provider: actualProvider,
      model: actualModel,
      usedFallback,
    });

    return {
      content,
      model: actualModel,
      provider: actualProvider,
      usage: {
        promptTokens: Math.floor(finalState.usedBudget * 0.7), // Estimate
        completionTokens: Math.floor(finalState.usedBudget * 0.3),
        totalTokens: finalState.usedBudget,
        cost: 0, // Would need model info for accurate cost
      },
      toolCalls,
      agentState: {
        sessionId: finalState.sessionId,
        totalSteps: finalState.currentStep,
        stopReason: finalState.finalResult?.stopReason || 'unknown',
        artifacts: finalState.finalResult?.artifacts || [],
      },
      fallbackInfo: {
        usedFallback,
        requestedProvider: primaryProvider,
        requestedModel: primaryModel,
        attempts: fallbackResult.attempts,
      },
    };
  } catch (error) {
    const err = error as Error;
    const described = describeFailoverError(err);

    logger.error('[AgenticChat] Agentic execution failed', {
      error: described.message,
      reason: described.reason,
      status: described.status,
    });

    // Get user-friendly error message
    const userMessage = getUserFriendlyErrorMessage(err, primaryProvider);

    // Return error response
    return {
      content: `Task execution failed: ${userMessage}`,
      model: primaryModel,
      provider: primaryProvider,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cost: 0,
      },
      agentState: {
        sessionId,
        totalSteps: 0,
        stopReason: 'error',
        artifacts: [],
      },
    };
  }
}

// =============================================================================
// Streaming Event Types
// =============================================================================

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
    | 'fallback';
  data: unknown;
  timestamp: number;
}

export interface StreamAgenticChatRequest extends AgenticChatRequest {
  /** Enable thinking/reasoning display (default: true) */
  showThinking?: boolean;
  /** Maximum steps before stopping (default: 50) */
  maxSteps?: number;
  /** Token budget (default: 50000) */
  maxBudget?: number;
  // effort is inherited from AgenticChatRequest
}

// =============================================================================
// Streaming Agentic Chat Implementation
// =============================================================================

/**
 * Execute an agentic chat with streaming updates.
 * Yields events for real-time UI updates including:
 * - Session lifecycle (start, complete, error)
 * - Thinking/reasoning (what the AI is considering)
 * - Step progress (current step, remaining budget)
 * - Tool calls and results
 * - Fallback events when switching providers
 * - Final summary
 *
 * Features OpenClaw-style provider fallback: if the primary provider fails,
 * automatically tries other configured providers with cooldown tracking.
 *
 * Tool usage is guided by system prompt - we trust the AI to decide when
 * tools are needed vs when to respond directly (OpenClaw pattern).
 */
export async function* streamAgenticChat(
  request: StreamAgenticChatRequest
): AsyncGenerator<AgenticStreamEvent> {
  const sessionId = randomUUID();
  const showThinking = request.showThinking ?? true;

  // Extract the user's goal from the last user message
  const lastUserMessage = [...request.messages].reverse().find((m) => m.role === 'user');
  const goal = lastUserMessage?.content || 'Complete the user request';

  logger.info('[AgenticChat] Starting streaming agentic execution', {
    sessionId,
    conversationId: request.conversationId,
    goal: goal.substring(0, 100),
    showThinking,
  });

  // Resolve the primary model and provider
  // If provider is explicitly given, use it directly
  const explicitProvider = request.provider as ProviderType | undefined;
  const modelRef = request.model || 'sonnet';
  const aliasEntry = MODEL_ALIASES[modelRef as keyof typeof MODEL_ALIASES];
  const primaryProvider = explicitProvider || (aliasEntry?.provider || 'anthropic') as ProviderType;

  // For Azure and similar providers, use the configured deployment name, not hardcoded alias
  let primaryModel = aliasEntry?.model || modelRef;
  try {
    const resolved = aiProvider.resolveModel(primaryProvider);
    if (resolved.provider === primaryProvider && resolved.model) {
      primaryModel = resolved.model; // Use configured deployment (e.g., 'gpt4o')
    }
  } catch {
    // Keep the alias model if provider not configured
  }

  logger.info('[AgenticChat] Provider resolution', {
    explicitProvider: explicitProvider || 'none',
    modelRef,
    primaryProvider,
    primaryModel,
  });

  // Get configured providers
  const configuredProviders = aiProvider.getConfiguredProviders();

  if (configuredProviders.length === 0) {
    yield {
      type: 'error',
      data: {
        message: 'No AI providers configured. Please configure at least one provider in Settings.',
        sessionId,
      },
      timestamp: Date.now(),
    };
    return;
  }

  // Log if any providers are in cooldown
  const cooldowns = getProvidersInCooldown();
  if (cooldowns.length > 0) {
    logger.info('[AgenticChat] Providers currently in cooldown', {
      cooldowns: cooldowns.map((c) => ({
        provider: c.provider,
        reason: c.reason,
        remainingMs: c.cooldownUntil - Date.now(),
      })),
    });
  }

  // Yield session start with model info
  yield {
    type: 'session:start',
    data: {
      sessionId,
      conversationId: request.conversationId,
      goal,
      model: primaryModel,
      provider: primaryProvider,
      configuredProviders,
      cooldownProviders: cooldowns.map((c) => c.provider),
    },
    timestamp: Date.now(),
  };

  // Create agent configuration
  const agentConfig: Partial<AgentConfig> = {
    maxSteps: request.maxSteps ?? 50,
    maxBudget: request.maxBudget ?? 50000,
    securityMode: 'ask',
    enableStreaming: true,
    effort: request.effort,
  };

  // Store raw tool definitions - we'll convert to AI SDK format per-provider
  const toolDefinitions = request.tools;

  // Build messages with system prompt
  const messages = [
    { role: 'system' as const, content: request.systemPrompt },
    ...request.messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    })),
  ];

  // Event queue for streaming from callbacks
  const eventQueue: AgenticStreamEvent[] = [];
  let resolveQueue: (() => void) | null = null;

  const pushEvent = (event: AgenticStreamEvent) => {
    eventQueue.push(event);
    if (resolveQueue) {
      resolveQueue();
      resolveQueue = null;
    }
  };

  // Tool execution handler — unwrap ToolExecutionResult to return only the inner result
  const onToolExecute = async (toolName: string, args: Record<string, unknown>): Promise<unknown> => {
    const executionResult = await request.toolHandler.executeTool(toolName, args, randomUUID());
    return executionResult.result;
  };

  // Track the result
  let finalState: AgentState | null = null;
  let agentError: Error | null = null;
  let agentComplete = false;
  let actualProvider = primaryProvider;
  let actualModel = primaryModel;
  let fallbackAttempts: FallbackAttempt[] = [];

  // Run the agent with fallback in a separate async context
  const runAgent = async () => {
    try {
      const fallbackResult = await runWithModelFallback({
        primaryProvider,
        primaryModel,
        configuredProviders,
        modelResolver: createModelResolver(),
        run: async (provider, model) => {
          // Notify if we're using a fallback
          if (provider !== primaryProvider || model !== primaryModel) {
            pushEvent({
              type: 'fallback',
              data: {
                from: { provider: actualProvider, model: actualModel },
                to: { provider, model },
                reason: fallbackAttempts.length > 0
                  ? fallbackAttempts[fallbackAttempts.length - 1]?.error
                  : 'Primary provider unavailable',
              },
              timestamp: Date.now(),
            });

            if (showThinking) {
              pushEvent({
                type: 'thinking:update',
                data: {
                  message: `Switching to ${provider}/${model}`,
                  provider,
                  model,
                  isRetry: true,
                },
                timestamp: Date.now(),
              });
            }
          }

          actualProvider = provider as ProviderType;
          actualModel = model;

          // Get the model instance for this provider
          const modelInstance = aiProvider.getModel(provider, model);

          // Create the agent executor
          const agent = new AgentExecutor(sessionId, request.conversationId, goal, agentConfig);

          // Set up event handlers
          agent.on('step:start', (state) => {
            if (showThinking) {
              pushEvent({
                type: 'thinking:start',
                data: {
                  step: state.currentStep,
                  message: `Planning step ${state.currentStep}...`,
                  remainingBudget: state.maxBudget - state.usedBudget,
                },
                timestamp: Date.now(),
              });
            }

            pushEvent({
              type: 'step:start',
              data: {
                step: state.currentStep,
                maxSteps: agentConfig.maxSteps,
                usedBudget: state.usedBudget,
                maxBudget: state.maxBudget,
              },
              timestamp: Date.now(),
            });
          });

          agent.on('step:complete', (state, result) => {
            if (showThinking) {
              pushEvent({
                type: 'thinking:end',
                data: {
                  step: state.currentStep,
                  message: `Step ${state.currentStep} completed`,
                  text: (result as any)?.text?.substring(0, 200),
                },
                timestamp: Date.now(),
              });
            }

            pushEvent({
              type: 'step:complete',
              data: {
                step: state.currentStep,
                usedBudget: state.usedBudget,
                budgetRemaining: state.maxBudget - state.usedBudget,
                stepsRemaining: (agentConfig.maxSteps ?? 50) - state.currentStep,
                toolCallsInStep: (result as any)?.steps?.[0]?.toolCalls?.length ?? 0,
              },
              timestamp: Date.now(),
            });
          });

          agent.on('tool:call', (state, toolCall) => {
            if (showThinking) {
              pushEvent({
                type: 'thinking:update',
                data: {
                  message: `Calling tool: ${toolCall.name}`,
                  tool: toolCall.name,
                  args: toolCall.args,
                },
                timestamp: Date.now(),
              });
            }

            pushEvent({
              type: 'tool:call',
              data: {
                id: toolCall.id,
                name: toolCall.name,
                args: toolCall.args,
                step: state.currentStep,
              },
              timestamp: Date.now(),
            });
          });

          agent.on('tool:result', (state, toolCall) => {
            pushEvent({
              type: 'tool:result',
              data: {
                id: toolCall.id,
                name: toolCall.name,
                result: toolCall.result,
                status: toolCall.status,
                error: toolCall.error,
                duration:
                  toolCall.completedAt && toolCall.startedAt
                    ? toolCall.completedAt - toolCall.startedAt
                    : undefined,
              },
              timestamp: Date.now(),
            });
          });

          // Convert tool definitions to AI SDK format with execute wrappers
          const aiSdkTools = convertToolsToAiSdk(toolDefinitions, provider, 'AgenticChat/Stream', onToolExecute);

          // Run the agent — tools already have execute functions,
          // pass provider hint for effort/thinking options
          return agent.run(modelInstance, messages, aiSdkTools, onToolExecute, provider);
        },
        onError: (attempt) => {
          const described = describeFailoverError(attempt.error);
          logger.warn('[AgenticChat] Provider attempt failed, trying fallback', {
            provider: attempt.provider,
            model: attempt.model,
            error: described.message,
            reason: described.reason,
            attempt: attempt.attempt,
            total: attempt.total,
          });

          fallbackAttempts.push({
            provider: attempt.provider,
            model: attempt.model,
            error: described.message,
            reason: described.reason,
            status: described.status,
            code: described.code,
          });
        },
      });

      finalState = fallbackResult.result;
      actualProvider = fallbackResult.provider as ProviderType;
      actualModel = fallbackResult.model;
      fallbackAttempts = fallbackResult.attempts;
      agentComplete = true;
    } catch (error) {
      agentError = error as Error;
      agentComplete = true;
    }

    // Wake up the generator
    if (resolveQueue) {
      resolveQueue();
      resolveQueue = null;
    }
  };

  // Start the agent
  runAgent();

  // Yield events as they come in
  while (!agentComplete || eventQueue.length > 0) {
    // Yield all queued events
    while (eventQueue.length > 0) {
      yield eventQueue.shift()!;
    }

    // If agent is not complete, wait for more events
    if (!agentComplete) {
      await new Promise<void>((resolve) => {
        resolveQueue = resolve;
        // Timeout to check for completion
        setTimeout(resolve, 100);
      });
    }
  }

  // Handle error
  if (agentError) {
    const userMessage = getUserFriendlyErrorMessage(agentError, actualProvider);
    yield {
      type: 'error',
      data: {
        message: userMessage,
        sessionId,
        provider: actualProvider,
        attemptedProviders: fallbackAttempts.map((a) => a.provider),
        attempts: fallbackAttempts,
      },
      timestamp: Date.now(),
    };
    return;
  }

  // Yield final summary if we have a state
  // TypeScript doesn't track async mutations, so we need to assert the type
  if (finalState) {
    const state = finalState as AgentState;
    const usedFallback = actualProvider !== primaryProvider || actualModel !== primaryModel;

    // Build summary
    const toolCalls = state.toolCallHistory.map((tc: ToolCallRecord) => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.args,
      result: tc.result,
      status: tc.status === 'executed' ? 'success' : 'error',
    }));

    // Executor's finalize() now handles the 3-tier summary priority
    const summary = state.finalResult?.summary || 'Task completed.';

    yield {
      type: 'summary',
      data: {
        summary,
        artifacts: state.finalResult?.artifacts || [],
        nextSteps: state.finalResult?.nextSteps || [],
      },
      timestamp: Date.now(),
    };

    yield {
      type: 'complete',
      data: {
        sessionId,
        model: actualModel,
        provider: actualProvider,
        requestedModel: primaryModel,
        requestedProvider: primaryProvider,
        usedFallback,
        fallbackAttempts: usedFallback ? fallbackAttempts : undefined,
        totalSteps: state.currentStep,
        totalTokens: state.usedBudget,
        inputTokens: state.inputTokensUsed,
        outputTokens: state.outputTokensUsed,
        stopReason: state.finalResult?.stopReason || 'unknown',
        toolCalls,
        artifacts: state.finalResult?.artifacts || [],
      },
      timestamp: Date.now(),
    };

    logger.info('[AgenticChat] Streaming execution completed', {
      sessionId,
      steps: state.currentStep,
      toolCalls: toolCalls.length,
      stopReason: state.finalResult?.stopReason,
      provider: actualProvider,
      model: actualModel,
      usedFallback,
      attempts: fallbackAttempts.length,
    });
  }
}
