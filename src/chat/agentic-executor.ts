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
import { tool as createTool, jsonSchema, type ToolSet } from 'ai';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import { AgentExecutor, type AgentState, type AgentConfig, type ToolCallRecord } from '../agents/index.js';
import { MODEL_ALIASES } from '../providers/core/models.js';
import { routeQuery, recordRoutingDecision, isSmartRouterEnabled } from '../providers/smart-router.js';
import { generateSuggestions, gatherContext, type Suggestion } from './proactive/index.js';
import type { ChatMessage, ProviderType } from '../providers/core/types.js';

// Experience store lazy import to avoid circular deps
let experienceStorePromise: Promise<typeof import('../memory/experience-store.js')> | null = null;
function getExperienceStore(): Promise<typeof import('../memory/experience-store.js')> {
  if (!experienceStorePromise) {
    experienceStorePromise = import('../memory/experience-store.js').catch(() => {
      experienceStorePromise = null;
      return null as never;
    });
  }
  return experienceStorePromise;
}
import { normalizeToolSchema } from '../providers/schema-utils.js';
import { logger } from '../utils/logger.js';
import type { ChatToolHandler } from './tool-handler.js';
import {
  runWithModelFallback,
  getUserFriendlyErrorMessage,
  getProvidersInCooldown,
  describeFailoverError,
  type FallbackAttempt,
  type ModelResolver,
} from './failover/index.js';

type AIProviderManager = Awaited<
  typeof import('../providers/ai-sdk.js')
>['aiProvider'];

type JsonSchemaInput = Parameters<typeof jsonSchema>[0];

interface AgentStepSummary {
  text?: string;
  steps?: Array<{
    toolCalls?: unknown[];
  }>;
}

const passthroughValidate = (value: unknown) => ({
  success: true as const,
  value: value as Record<string, unknown>,
});

function asJsonSchemaInput(schema: unknown): JsonSchemaInput {
  return schema as JsonSchemaInput;
}

function getAgentStepSummary(result: unknown): AgentStepSummary {
  if (!result || typeof result !== 'object') {
    return {};
  }

  return result as AgentStepSummary;
}

function createAiSdkTool(
  description: string,
  schema: JsonSchemaInput,
  execute?: (args: Record<string, unknown>) => Promise<unknown>,
) {
  const inputSchema = jsonSchema<Record<string, unknown>>(schema, {
    validate: passthroughValidate,
  });

  if (execute) {
    return createTool<Record<string, unknown>, unknown>({
      description,
      inputSchema,
      execute,
    });
  }

  return createTool<Record<string, unknown>>({
    description,
    inputSchema,
  });
}

let aiProviderPromise: Promise<AIProviderManager> | null = null;

async function getAIProvider(): Promise<AIProviderManager> {
  if (!aiProviderPromise) {
    aiProviderPromise = import('../providers/ai-sdk.js').then(
      ({ aiProvider }) => aiProvider,
    );
  }

  return aiProviderPromise;
}

// Model Resolution Helper

/**
 * Create a model resolver that uses aiProvider to get configured models.
 * This ensures Azure deployments and other provider-specific configs are used.
 */
function createModelResolver(aiProvider: AIProviderManager): ModelResolver {
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

// Types

export interface AgenticChatRequest {
  conversationId: string;
  messages: ChatMessage[];
  systemPrompt: string;
  model?: string;
  provider?: string;
  temperature?: number;
  /** Thinking effort level for Anthropic models: low (cheap), medium, high, max (deep reasoning) */
  effort?: 'low' | 'medium' | 'high' | 'max';
  /** User ID for budget tracking and preference recall */
  userId?: string;
  /** Team ID for shared budget enforcement */
  teamId?: string;
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
  /** Proactive follow-up suggestions based on completed task */
  suggestions?: Suggestion[];
}

// Shared Tool Schema Conversion

/**
 * Convert tool definitions (with Zod parameters) to AI SDK format.
 * Handles Azure schema normalization automatically.
 */
 
function convertToolsToAiSdk(
  toolDefs: Array<{ name: string; description: string; parameters: unknown }>,
  provider: string,
  logPrefix: string,
  onToolExecute?: (name: string, args: Record<string, unknown>) => Promise<unknown>,
): ToolSet {
  const aiSdkTools: ToolSet = {};
  const isAzure = provider === 'azure';

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
         
        aiSdkTools[toolDef.name] = createAiSdkTool(
          toolDef.description,
          asJsonSchemaInput(normalized),
          execute,
        );
      } else {
        aiSdkTools[toolDef.name] = createAiSdkTool(
          toolDef.description,
          asJsonSchemaInput(rawJsonSchema),
          execute,
        );
      }
    } catch (schemaError) {
      logger.warn(`[${logPrefix}] Failed to create tool ${toolDef.name}, using minimal schema`, {
        error: schemaError instanceof Error ? schemaError.message : String(schemaError),
      });

      const execute = onToolExecute
        ? async (args: Record<string, unknown>) => onToolExecute(toolDef.name, args)
        : undefined;

      aiSdkTools[toolDef.name] = createAiSdkTool(
        toolDef.description,
        asJsonSchemaInput({ type: 'object', properties: {} }),
        execute,
      );
    }
  }

  if (isAzure) {
    logger.info(`[${logPrefix}] Azure schema normalization complete`);
  }

  return aiSdkTools;
}

// Agentic Chat Executor

/**
 * Execute an agentic chat conversation.
 * Uses the AgentExecutor to run tools continuously until task completion.
 * Automatically falls back to other providers on failure.
 */
export async function executeAgenticChat(
  request: AgenticChatRequest
): Promise<AgenticChatResponse> {
  const sessionId = randomUUID();
  const aiProvider = await getAIProvider();

  // Extract the user's goal from the last user message
  const lastUserMessage = [...request.messages].reverse().find((m) => m.role === 'user');
  const goal = lastUserMessage?.content || 'Complete the user request';

  logger.info('[AgenticChat] Starting agentic execution', {
    sessionId,
    conversationId: request.conversationId,
    goal: goal.substring(0, 100),
  });

  // Team budget check (if user is in a team)
  if (request.teamId && request.userId) {
    try {
      const { canMemberSpend, recordMemberUsage } = await import('../teams/index.js');
      const budgetCheck = await canMemberSpend(request.teamId, request.userId, 0.05); // estimated min cost
      if (!budgetCheck.allowed) {
        return {
          content: `Budget exceeded: ${budgetCheck.reason}. Contact your team admin to increase the budget.`,
          model: 'none',
          provider: 'none',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 },
          agentState: { sessionId, totalSteps: 0, stopReason: 'budget_exceeded', artifacts: [] },
        };
      }
    } catch {
      // Teams module not initialized - skip budget check
    }
  }

  // Resolve the primary model and provider - fully provider-agnostic
  const explicitProvider = request.provider as ProviderType | undefined;
  const configuredProviders = aiProvider.getConfiguredProviders();
  const availableProviders = new Set(configuredProviders as ProviderType[]);

  // Smart Model Router: auto-select model based on query complexity
  let modelRef = request.model;
  let smartRouted = false;

  if (!request.model && !explicitProvider && isSmartRouterEnabled()) {
    const routingDecision = routeQuery(goal, availableProviders, {
      conversationLength: request.messages.length,
      hasToolUse: request.tools.length > 0,
      hasCodeContext: request.tools.some(t => t.name.startsWith('git_') || t.name === 'exec'),
      hasImages: false,
    });
    modelRef = routingDecision.selectedModel.id;
    smartRouted = true;
    recordRoutingDecision(routingDecision);

    logger.info('[AgenticChat] Smart-routed to model', {
      tier: routingDecision.complexity.tier,
      model: routingDecision.selectedModel.id,
      provider: routingDecision.selectedModel.provider,
      savings: `${routingDecision.savingsPercent}%`,
      reasoning: routingDecision.complexity.reasoning,
    });
  }

  // Fall back to provider-agnostic default if no model specified
  if (!modelRef) {
    modelRef = aiProvider.getDefaultProvider() as string;
    // Try to get the default model for the default provider
    try {
      const resolved = aiProvider.resolveModel(modelRef);
      modelRef = resolved.model;
    } catch {
      modelRef = 'sonnet'; // last resort alias
    }
  }

  const aliasEntry = MODEL_ALIASES[modelRef as keyof typeof MODEL_ALIASES];
  // Resolve provider from alias, smart route result, or configured default
  const primaryProvider = explicitProvider
    ?? (aliasEntry?.provider && availableProviders.has(aliasEntry.provider as ProviderType) ? aliasEntry.provider : undefined) as ProviderType | undefined
    ?? (aiProvider.getDefaultProvider() as ProviderType);

  // For Azure and similar providers, use the configured deployment name, not hardcoded alias
  let primaryModel = smartRouted ? modelRef : (aliasEntry?.model || modelRef);
  if (!smartRouted) {
    try {
      const resolved = aiProvider.resolveModel(primaryProvider);
      if (resolved.provider === primaryProvider && resolved.model) {
        primaryModel = resolved.model;
      }
    } catch {
      // Keep the alias model if provider not configured
    }
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

  // Recall relevant past experiences to enhance system prompt
  try {
    const store = await getExperienceStore();
    if (store) {
      const similar = await store.findSimilarExperiences(goal, [], 3);
      const hints = similar
        .filter(exp => exp.successScore >= 0.7 && exp.weight > 0.1)
        .slice(0, 2)
        .map(exp => {
          if (exp.type === 'tool_chain') {
            const chain = exp.solution as { tools: Array<{ name: string }> };
            return `Previously solved similar task using: ${chain.tools.map(t => t.name).join(' -> ')} (used ${exp.useCount}x)`;
          }
          return `Past experience: ${exp.intent} (score: ${exp.successScore})`;
        });

      if (hints.length > 0) {
        request.systemPrompt += `\n\nRelevant past experiences:\n${hints.join('\n')}`;
        logger.debug('[AgenticChat] Injected experience context', { count: hints.length });
        for (const exp of similar.slice(0, 2)) {
          store.markUsed(exp.id).catch(() => {});
        }
      }
    }
  } catch {
    // Experience recall is best-effort
  }

  // Auto-context gathering for complex queries (code/file-related tasks)
  if (request.tools.length > 0 && goal.length > 30) {
    try {
      const context = await gatherContext(goal, {
        maxSources: 4,
        maxTokens: 2000,
        includeFiles: true,
        includeMemory: false, // memory handled by experience store above
        includeHistory: false,
      });
      if (context.sources.length > 0) {
        const contextBlock = context.sources
          .map(s => `[${s.type}${s.path ? `: ${s.path}` : ''}]\n${s.content.slice(0, 500)}`)
          .join('\n\n');
        request.systemPrompt += `\n\nProject context (auto-gathered):\n${contextBlock}`;
        logger.debug('[AgenticChat] Injected project context', {
          sources: context.sources.length,
          tokens: context.tokens,
        });
      }
    } catch {
      // Context gathering is best-effort
    }
  }

  // Create agent configuration
  const agentConfig: Partial<AgentConfig> = {
    maxSteps: 20, // Reasonable default
    maxBudget: 30000, // 30k token budget to control costs
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
      modelResolver: createModelResolver(aiProvider),
      run: async (provider, model) => {
        // Get the model instance for this provider
        const modelInstance = await aiProvider.getModel(provider, model);

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
    let content = finalState.finalResult?.summary || 'Task completed.';

    // Run guardrails on the final response
    try {
      const { runGuardrails } = await import('./execution/guardrails.js');
      const guardrailResult = await runGuardrails(
        content,
        toolCalls.map((tc) => ({ name: tc.name, params: (tc.arguments ?? {}) as Record<string, unknown> })),
        { userQuery: request.messages.at(-1)?.content ?? '' },
      );
      if (guardrailResult.cleanedResponse) {
        content = guardrailResult.cleanedResponse;
      }
      if (!guardrailResult.passed) {
        logger.warn('[AgenticChat] Guardrails flagged response', {
          sessionId,
          validationIssues: guardrailResult.validation.issues.length,
          hallucinationFlags: guardrailResult.hallucination.flags.length,
          safetyBlocked: guardrailResult.safety.blocked.length,
          qualityTier: guardrailResult.quality.tier,
        });
      }
    } catch (guardrailError) {
      logger.warn('[AgenticChat] Guardrails check failed (non-blocking)', {
        error: guardrailError instanceof Error ? guardrailError.message : String(guardrailError),
      });
    }

    logger.info('[AgenticChat] Completed agentic execution', {
      sessionId,
      steps: finalState.currentStep,
      toolCalls: toolCalls.length,
      stopReason: finalState.finalResult?.stopReason,
      provider: actualProvider,
      model: actualModel,
      usedFallback,
    });

    // Record team usage (async, non-blocking)
    if (request.teamId && request.userId) {
      import('../teams/index.js').then(({ recordMemberUsage }) => {
        const estimatedCost = finalState.usedBudget * 0.00001; // rough token-to-cost estimate
        recordMemberUsage(request.teamId!, request.userId!, estimatedCost).catch(() => {});
      }).catch(() => {});
    }

    // Record successful tool chains to experience store (async, non-blocking)
    if (toolCalls.length > 0) {
      const successfulCalls = toolCalls.filter(tc => tc.status === 'success');
      if (successfulCalls.length > 0) {
        getExperienceStore().then(async (store) => {
          if (!store) return;
          try {
            await store.recordExperience({
              type: 'tool_chain',
              intent: goal.slice(0, 200),
              solution: {
                tools: successfulCalls.map(tc => ({ name: tc.name, params: tc.arguments })),
                totalDurationMs: finalState.usedBudget,
                allSucceeded: successfulCalls.length === toolCalls.length,
              },
              successScore: successfulCalls.length / Math.max(toolCalls.length, 1),
              tags: [
                ...new Set(successfulCalls.map(tc => tc.name)),
                actualProvider,
                actualModel,
              ],
              sourceConversationId: request.conversationId,
            });
          } catch {
            // Non-critical - don't break execution
          }
        }).catch(() => {});
      }
    }

    // Generate proactive follow-up suggestions
    const suggestions = generateSuggestions(goal, {
      failedTests: toolCalls.filter(tc => tc.name === 'test_run' && tc.status === 'error').length,
      createdFiles: toolCalls.filter(tc => tc.name === 'write_file' && tc.status === 'success')
        .map(tc => String(tc.arguments['path'] ?? '')).filter(Boolean),
      prCreated: toolCalls.some(tc => tc.name === 'github_pr' && tc.status === 'success'),
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
      suggestions: suggestions.length > 0 ? suggestions : undefined,
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

// Streaming Event Types

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

// Streaming Agentic Chat Implementation

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
  const aiProvider = await getAIProvider();
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

  // Resolve the primary model and provider - provider-agnostic
  const explicitProvider = request.provider as ProviderType | undefined;
  const configuredProviders = aiProvider.getConfiguredProviders();
  const availableProviders = new Set(configuredProviders as ProviderType[]);

  // Use smart routing for streaming too
  let modelRef = request.model;
  if (!request.model && !explicitProvider && isSmartRouterEnabled()) {
    const routingDecision = routeQuery(goal, availableProviders, {
      conversationLength: request.messages.length,
      hasToolUse: request.tools.length > 0,
    });
    modelRef = routingDecision.selectedModel.id;
    recordRoutingDecision(routingDecision);
  }

  // Fall back to provider-agnostic default
  if (!modelRef) {
    try {
      const resolved = aiProvider.resolveModel(aiProvider.getDefaultProvider() as string);
      modelRef = resolved.model;
    } catch {
      modelRef = 'sonnet';
    }
  }

  const aliasEntry = MODEL_ALIASES[modelRef as keyof typeof MODEL_ALIASES];
  const primaryProvider = explicitProvider
    ?? (aliasEntry?.provider && availableProviders.has(aliasEntry.provider as ProviderType) ? aliasEntry.provider : undefined) as ProviderType | undefined
    ?? (aiProvider.getDefaultProvider() as ProviderType);

  // For Azure and similar providers, use the configured deployment name
  let primaryModel = aliasEntry?.model || modelRef;
  try {
    const resolved = aiProvider.resolveModel(primaryProvider);
    if (resolved.provider === primaryProvider && resolved.model) {
      primaryModel = resolved.model;
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
    maxSteps: request.maxSteps ?? 20,
    // Azure counts cached prompt tokens in totalUsage (inflates to ~75K for tool schemas)
    // Set budget high enough for multi-step tasks without premature abort
    maxBudget: request.maxBudget ?? 500000,
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
        modelResolver: createModelResolver(aiProvider),
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
          const modelInstance = await aiProvider.getModel(provider, model);

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
            const stepSummary = getAgentStepSummary(result);
            if (showThinking) {
              pushEvent({
                type: 'thinking:end',
                data: {
                  step: state.currentStep,
                  message: `Step ${state.currentStep} completed`,
                  text: stepSummary.text?.substring(0, 200),
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
                toolCallsInStep: stepSummary.steps?.[0]?.toolCalls?.length ?? 0,
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

    // Record tool chain to experience store (async, non-blocking)
    const successfulCalls = toolCalls.filter(tc => tc.status === 'success');
    if (successfulCalls.length > 0) {
      getExperienceStore().then(async (store) => {
        if (!store) return;
        try {
          await store.recordExperience({
            type: 'tool_chain',
            intent: goal.slice(0, 200),
            solution: {
              tools: successfulCalls.map(tc => ({ name: tc.name, params: tc.arguments })),
              totalDurationMs: state.usedBudget,
              allSucceeded: successfulCalls.length === toolCalls.length,
            },
            successScore: successfulCalls.length / Math.max(toolCalls.length, 1),
            tags: [...new Set(successfulCalls.map(tc => tc.name)), actualProvider, actualModel],
            sourceConversationId: request.conversationId,
          });
        } catch {
          // Non-critical
        }
      }).catch(() => {});
    }
  }
}
