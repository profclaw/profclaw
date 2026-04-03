/**
 * Agent Executor
 *
 * The main orchestrator for the profClaw agentic loop system.
 * Uses AI SDK's native multi-step execution (stopWhen + onStepFinish)
 * instead of a manual loop. Tools have execute functions and the SDK
 * handles message accumulation, tool result feeding, and step chaining.
 */

import {
  generateText,
  stepCountIs as sdkStepCountIs,
  hasToolCall as sdkHasToolCall,
} from "ai";
import type {
  LanguageModel,
  ModelMessage,
  StepResult,
  StopCondition as AiSdkStopCondition,
  ToolSet,
} from "ai";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type {
  AgentState,
  AgentConfig,
  AgentResult,
  AgentEvents,
  ToolCallRecord,
} from "./types.js";
import { EFFORT_BUDGET_MAP } from "./types.js";
import { defaultStopConditions, taskCompleted } from "./stop-conditions.js";
import { ToolCircuitBreaker } from "./circuit-breaker.js";
import { logger } from "../utils/logger.js";
import { ResultStore } from "./result-store.js";
import type { AgentEvent } from "./events.js";
import { getAgentSummaryTracker } from "./agent-summary.js";
import { getHookRegistry } from "../hooks/registry.js";
import type { HookRegistry } from "../hooks/registry.js";
import { ContextCompactor } from "./context-compactor.js";
import { getSleepPreventer } from "../utils/prevent-sleep.js";

// Types

/** Handler called by the executor to execute a tool by name */
export type ToolExecuteHandler = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

// Default Configuration

const DEFAULT_CONFIG: Required<AgentConfig> = {
  maxSteps: 100,
  maxBudget: 100000, // 100k tokens
  stopConditions: defaultStopConditions,
  securityMode: "ask",
  stepTimeoutMs: 60000, // 1 minute per step
  enableStreaming: true,
  effort: "medium",
};

/** After this many consecutive same-tool failures, inject a system hint */
const FAILURE_ESCALATION_THRESHOLD = 2;

type ExecutorTools = ToolSet;
type ExecutorStep = StepResult<ExecutorTools>;
type ContextProject = NonNullable<AgentState["context"]["availableProjects"]>[number];
type ContextTicket = NonNullable<AgentState["context"]["createdTickets"]>[number];
type AgentArtifact = AgentResult["artifacts"][number];
type ExecutorProviderOptions = {
  anthropic?: {
    thinking?: {
      type: 'enabled';
      budgetTokens: number;
    };
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function getRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toToolArgs(input: unknown): Record<string, unknown> {
  return getRecord(input) ?? {};
}

function getUsageInputTokens(usage: unknown): number {
  const usageRecord = getRecord(usage);
  if (!usageRecord) return 0;

  const inputTokens = usageRecord.inputTokens;
  if (typeof inputTokens === "number") return inputTokens;

  const promptTokens = usageRecord.promptTokens;
  return typeof promptTokens === "number" ? promptTokens : 0;
}

function getUsageOutputTokens(usage: unknown): number {
  const usageRecord = getRecord(usage);
  if (!usageRecord) return 0;

  const outputTokens = usageRecord.outputTokens;
  if (typeof outputTokens === "number") return outputTokens;

  const completionTokens = usageRecord.completionTokens;
  return typeof completionTokens === "number" ? completionTokens : 0;
}

function getToolCallInput(toolCall: unknown): Record<string, unknown> {
  const toolCallRecord = getRecord(toolCall);
  if (!toolCallRecord) return {};

  return toToolArgs(toolCallRecord.input ?? toolCallRecord.args);
}

function getToolResultOutput(toolResult: unknown): unknown {
  const toolResultRecord = getRecord(toolResult);
  if (!toolResultRecord) return undefined;

  return toolResultRecord.output ?? toolResultRecord.result;
}

function toContextProject(value: Record<string, unknown>): ContextProject | null {
  const id = getString(value.id);
  const key = getString(value.key);
  const name = getString(value.name);

  if (!id || !key || !name) {
    return null;
  }

  return { id, key, name };
}

function toContextTicket(value: Record<string, unknown>): ContextTicket | null {
  const id = getString(value.id);
  const key = getString(value.key);
  const title = getString(value.title);
  const type = getString(value.type);

  if (!id || !key || !title || !type) {
    return null;
  }

  return { id, key, title, type };
}

function toAgentArtifact(value: Record<string, unknown>): AgentArtifact | null {
  const type = getString(value.type);
  const id = getString(value.id);

  if (!type || !id) {
    return null;
  }

  const allowedTypes: AgentArtifact["type"][] = [
    "ticket",
    "commit",
    "file",
    "pr",
    "project",
    "other",
  ];
  if (!allowedTypes.includes(type as AgentArtifact["type"])) {
    return null;
  }

  return {
    type: type as AgentArtifact["type"],
    id,
    description: getString(value.description),
    url: getString(value.url),
  };
}

// Agent Executor Class

export class AgentExecutor extends EventEmitter<AgentEvents> {
  private state: AgentState;
  private config: Required<AgentConfig>;
  private abortController: AbortController;
  private isRunning: boolean = false;
  private resultStore: ResultStore;
  private circuitBreaker: ToolCircuitBreaker = new ToolCircuitBreaker();
  private hooks: HookRegistry;
  private compactor: ContextCompactor;

  constructor(
    sessionId: string,
    conversationId: string,
    goal: string,
    config: Partial<AgentConfig> = {},
  ) {
    super();
    this.abortController = new AbortController();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.resultStore = new ResultStore(sessionId);
    this.hooks = getHookRegistry();
    this.compactor = new ContextCompactor({
      maxContextTokens: this.config.maxBudget,
      compactionThreshold: Math.floor(this.config.maxBudget * 0.7),
    });

    // Ensure taskCompleted is always included in stop conditions
    if (!this.config.stopConditions.some((c) => c.name === "taskCompleted")) {
      this.config.stopConditions.push(taskCompleted());
    }

    this.state = {
      sessionId,
      conversationId,
      status: "idle",
      goal,
      currentStep: 0,
      maxBudget: this.config.maxBudget,
      usedBudget: 0,
      inputTokensUsed: 0,
      outputTokensUsed: 0,
      toolCallHistory: [],
      pendingToolCalls: [],
      context: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    logger.info("[AgentExecutor] Created new agent", {
      sessionId,
      conversationId,
      goal: goal.substring(0, 100),
      maxSteps: this.config.maxSteps,
      maxBudget: this.config.maxBudget,
    });

    // Register this session with the summary tracker
    getAgentSummaryTracker().start(sessionId);
  }

  // Public API

  /**
   * Async generator that streams agent events as they happen.
   *
   * Yields AgentEvent values in real time: session:start, step:start,
   * tool:call, tool:result/tool:error, content, cost:update, step:complete,
   * and finally session:complete, session:error, or session:abort.
   *
   * This is the canonical implementation; run() delegates here.
   */
  async *stream(
    model: LanguageModel,
    messages: ModelMessage[],
    tools: ExecutorTools,
    onToolExecute?: ToolExecuteHandler,
    providerHint?: string,
  ): AsyncGenerator<AgentEvent> {
    if (this.isRunning) {
      throw new Error("Agent is already running");
    }

    this.isRunning = true;
    this.state.status = "running";
    this.state.updatedAt = Date.now();
    this.emit("start", this.state);
    getSleepPreventer().start();

    logger.info("[AgentExecutor] Starting agent stream", {
      sessionId: this.state.sessionId,
      goal: this.state.goal,
    });

    // --- Async event channel ---
    // onStepFinish is a synchronous callback inside generateText. We bridge it
    // into the async generator by queuing events and signalling the consumer.
    const queue: AgentEvent[] = [];
    let resolveNext: (() => void) | undefined;
    let generateDone = false;
    let generateError: Error | undefined;

    const push = (event: AgentEvent): void => {
      queue.push(event);
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = undefined;
        r();
      }
    };

    // Yield session:start immediately
    push({
      type: 'session:start',
      sessionId: this.state.sessionId,
      config: {
        maxSteps: this.config.maxSteps,
        maxBudget: this.config.maxBudget,
        effort: this.config.effort,
        securityMode: this.config.securityMode,
        stepTimeoutMs: this.config.stepTimeoutMs,
      },
    });

    // Run generateText in the background, pushing events via push()
    const generatePromise = (async () => {
      try {
        // Fire onSessionStart hook
        await this.hooks.run('onSessionStart', {
          hookPoint: 'onSessionStart',
          sessionId: this.state.sessionId,
          metadata: {},
        });

        this.injectFailureHint(messages);

        // Use the streaming-aware wrapper so tool events are pushed in real time
        const executableTools = this.wrapToolsWithExecuteAndEvents(
          tools,
          onToolExecute,
          push,
        );

        // Compact context before the API call if messages are large
        const compactionResult = await this.compactor.compact(messages);
        if (compactionResult.compacted) {
          logger.info("[AgentExecutor] Context compacted before API call", {
            originalTokens: compactionResult.originalTokens,
            compactedTokens: compactionResult.compactedTokens,
            turnsCompacted: compactionResult.turnsCompacted,
          });
          messages = compactionResult.messages;
        }

        const hasTools = Object.keys(executableTools).length > 0;
        const providerOptions = this.buildProviderOptions(providerHint);

        const result = await generateText<ExecutorTools>({
          model,
          messages,
          tools: hasTools ? executableTools : undefined,
          ...(providerOptions ? { providerOptions } : {}),
          stopWhen: [
            sdkStepCountIs(this.config.maxSteps),
            sdkHasToolCall("complete_task"),
          ] as AiSdkStopCondition<ExecutorTools>[],
          abortSignal: this.abortController.signal,
          onStepFinish: (step: ExecutorStep) => {
            const stepIndex = this.state.currentStep;
            push({ type: 'step:start', stepIndex });

            this.state.currentStep++;
            this.state.updatedAt = Date.now();

            const stepInput = getUsageInputTokens(step.usage);
            const stepOutput = getUsageOutputTokens(step.usage);
            const tokensUsed = stepInput + stepOutput;
            this.state.usedBudget += tokensUsed;
            this.state.inputTokensUsed += stepInput;
            this.state.outputTokensUsed += stepOutput;

            // Update summary tracker with step progress
            getAgentSummaryTracker().update(this.state.sessionId, {
              status: 'thinking',
              stepCount: this.state.currentStep,
              tokensUsed: this.state.usedBudget,
            });

            push({
              type: 'cost:update',
              inputTokens: this.state.inputTokensUsed,
              outputTokens: this.state.outputTokensUsed,
              estimatedCost: 0,
            });

            if (step.text) {
              this.state.context.lastTextResponse = step.text;
              push({ type: 'content', text: step.text, delta: step.text });
            }

            let stepToolCalls = 0;
            for (const tc of step.toolCalls ?? []) {
              stepToolCalls++;
              const record: ToolCallRecord = {
                id: tc.toolCallId ?? randomUUID(),
                name: tc.toolName,
                args: getToolCallInput(tc),
                status: "pending",
                startedAt: Date.now(),
              };

              const tr = (step.toolResults ?? []).find(
                (toolResult) => toolResult.toolCallId === tc.toolCallId,
              );

              if (tr) {
                record.result = getToolResultOutput(tr);
                record.completedAt = Date.now();

                if (typeof record.result === "object" && record.result !== null) {
                  const resultObj = record.result as Record<string, unknown>;
                  const isPending = resultObj.pending === true;
                  const hasError = Boolean(resultObj.error);
                  const isFailure = resultObj.success === false || hasError;

                  if (isPending) {
                    record.status = "pending";
                  } else if (isFailure) {
                    record.status = "failed";
                    record.error =
                      (resultObj.error as string) ||
                      "Tool returned unsuccessful result";
                  } else {
                    record.status = "executed";
                  }
                } else {
                  record.status = "executed";
                }
              }

              this.state.toolCallHistory.push(record);
              this.emit("tool:call", this.state, record);
              this.extractContext(record);

              if (record.status === "executed") {
                this.emit("tool:result", this.state, record);
              }
            }

            this.emit("step:start", this.state);
            this.emit("step:complete", this.state, step);

            push({
              type: 'step:complete',
              stepIndex: this.state.currentStep,
              toolCalls: stepToolCalls,
              hasContent: Boolean(step.text),
            });

            logger.debug("[AgentExecutor] Step completed", {
              step: this.state.currentStep,
              toolCalls: step.toolCalls?.length ?? 0,
              tokensUsed,
              text: step.text?.substring(0, 100),
            });

            this.checkCustomStopConditions(step);

            if (this.state.usedBudget >= this.state.maxBudget) {
              logger.info("[AgentExecutor] Budget exceeded, aborting", {
                used: this.state.usedBudget,
                max: this.state.maxBudget,
              });
              this.abortController.abort();
            }
          },
        });

        const totalUsage = result.totalUsage;
        if (totalUsage) {
          const totalInput = getUsageInputTokens(totalUsage);
          const totalOutput = getUsageOutputTokens(totalUsage);
          this.state.usedBudget = totalInput + totalOutput;
          this.state.inputTokensUsed = totalInput;
          this.state.outputTokensUsed = totalOutput;
        }

        if (result.text) {
          this.state.context.lastTextResponse = result.text;
        }

        this.finalize();

        // Fire onSessionEnd hook after finalization
        await this.hooks.run('onSessionEnd', {
          hookPoint: 'onSessionEnd',
          sessionId: this.state.sessionId,
          metadata: {},
        });

        const finalResult = this.state.finalResult ?? {
          success: false,
          summary: 'No result',
          artifacts: [],
          stopReason: 'unknown',
          totalSteps: this.state.currentStep,
          totalTokens: this.state.usedBudget,
        };
        push({
          type: 'session:complete',
          result: finalResult as unknown as Record<string, unknown>,
          totalSteps: this.state.currentStep,
          totalTokens: this.state.usedBudget,
        });
      } catch (error) {
        const err = error as Error;
        if (err.name === "AbortError") {
          logger.info("[AgentExecutor] Agent aborted");
          this.finalize();
          // Fire onSessionEnd even on abort
          await this.hooks.run('onSessionEnd', {
            hookPoint: 'onSessionEnd',
            sessionId: this.state.sessionId,
            metadata: { aborted: true },
          });
          push({ type: 'session:abort', reason: 'aborted' });
        } else {
          generateError = err;
          // Fire onError hook before emitting the event
          await this.hooks.run('onError', {
            hookPoint: 'onError',
            sessionId: this.state.sessionId,
            error: err,
            metadata: {},
          });
          // Push the event BEFORE handleError so it is always emitted even if
          // the EventEmitter 'error' event throws due to missing listener.
          push({ type: 'session:error', error: err.message, stack: err.stack });
          try {
            this.handleError(err);
          } catch {
            // Swallow re-throw from EventEmitter if no 'error' listener is attached
          }
        }
      } finally {
        generateDone = true;
        this.isRunning = false;
        getSleepPreventer().stop();
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = undefined;
          r();
        }
      }
    })();

    // Drain the queue; wait for more events when it is empty
    while (true) {
      while (queue.length > 0) {
        yield queue.shift() as AgentEvent;
      }
      if (generateDone) break;
      await new Promise<void>((resolve) => {
        resolveNext = resolve;
      });
    }

    // Drain any remaining events that arrived while we were awaiting
    while (queue.length > 0) {
      yield queue.shift() as AgentEvent;
    }

    // Propagate errors after the consumer has seen all events
    await generatePromise;
    if (generateError) {
      throw generateError;
    }
  }

  /**
   * Run the agent until completion or stop condition.
   * Uses AI SDK's native multi-step execution — a single generateText call
   * with stopWhen + onStepFinish replaces the old manual loop.
   *
   * Backward-compatible: delegates to stream() and returns the final AgentState.
   */
  async run(
    model: LanguageModel,
    messages: ModelMessage[],
    tools: ExecutorTools,
    onToolExecute?: ToolExecuteHandler,
    providerHint?: string,
  ): Promise<AgentState> {
    // Consume the stream — stream() handles all state mutation and error handling
    for await (const _event of this.stream(model, messages, tools, onToolExecute, providerHint)) {
      // Individual events are not needed here; state is updated in-place
    }
    return this.state;
  }

  /**
   * Cancel the running agent.
   */
  cancel(): void {
    logger.info("[AgentExecutor] Cancelling agent", {
      sessionId: this.state.sessionId,
    });
    this.abortController.abort();
    this.state.status = "cancelled";
    this.state.updatedAt = Date.now();
    this.emit("cancelled", this.state);
  }

  /**
   * Get the current state.
   */
  getState(): AgentState {
    return { ...this.state };
  }

  /**
   * Approve pending tool calls.
   */
  approvePendingTools(approved: boolean): void {
    if (this.state.status !== "waiting_approval") {
      logger.warn("[AgentExecutor] No pending approvals");
      return;
    }

    logger.info("[AgentExecutor] Approval received", { approved });

    for (const toolCall of this.state.pendingToolCalls) {
      toolCall.status = approved ? "approved" : "denied";
    }

    this.state.status = "running";
    this.emit("approval:received", this.state, approved);
  }

  // Provider Options (Effort / Thinking)

  /**
   * Build provider-specific options based on agent config.
   * For Anthropic models with effort set, enables extended thinking.
   */
  private buildProviderOptions(providerHint?: string): ExecutorProviderOptions | undefined {
    const effort = this.config.effort;
    if (!effort) return undefined;

    // Only apply thinking options for Anthropic provider
    const isAnthropic = providerHint === 'anthropic' || !providerHint;
    if (!isAnthropic) return undefined;

    const budgetTokens = EFFORT_BUDGET_MAP[effort];
    logger.info("[AgentExecutor] Enabling extended thinking", {
      effort,
      budgetTokens,
      provider: providerHint || 'auto',
    });

    return {
      anthropic: {
        thinking: { type: 'enabled', budgetTokens },
      },
    };
  }

  // Tool Wrapping

  /**
   * Wrap tools with execute functions so the AI SDK can auto-execute them.
   * This is the key change: instead of us manually processing tool calls
   * after each step, the SDK calls execute() and feeds results back.
   */
  private wrapToolsWithExecute(
    tools: ExecutorTools,
    onToolExecute?: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<unknown>,
  ): ExecutorTools {
    if (!onToolExecute) return tools;

    const wrapped: ExecutorTools = {};
    for (const [name, toolDef] of Object.entries(tools)) {
      wrapped[name] = {
        ...toolDef,
        execute: async (args: Record<string, unknown>, opts?: { toolCallId?: string }) => {
          // Circuit breaker check — prevent repeated calls to a failing tool
          const cbCheck = this.circuitBreaker.canExecute(name);
          if (!cbCheck.allowed) {
            logger.warn("[AgentExecutor] Circuit breaker blocked tool call", {
              tool: name,
              reason: cbCheck.reason,
            });
            return {
              error: cbCheck.reason ?? `Circuit breaker open for ${name}`,
              success: false,
              canRetry: false,
              suggestion: "Try an alternative approach",
            };
          }

          const toolCallId = opts?.toolCallId ?? randomUUID();
          const timeoutMs = this.config.stepTimeoutMs;

          // Update summary tracker — tool is now executing
          const summaryTracker = getAgentSummaryTracker();
          const currentAction = summaryTracker.summarizeToolCall(this.state.sessionId, name, args);
          summaryTracker.update(this.state.sessionId, {
            status: 'executing',
            currentAction,
            lastToolName: name,
            lastToolArgs: JSON.stringify(args).substring(0, 100),
          });

          let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
              reject(new Error(`__TOOL_TIMEOUT__:${timeoutMs}`));
            }, timeoutMs);
          });

          try {
            const raw = await Promise.race([
              onToolExecute(name, args),
              timeoutPromise,
            ]);
            clearTimeout(timeoutHandle);
            this.circuitBreaker.recordSuccess(name);
            const stored = await this.resultStore.store(toolCallId, raw);
            // Return the inline representation (summary or full result)
            return JSON.parse(stored.inline) as unknown;
          } catch (error) {
            clearTimeout(timeoutHandle);

            const errorMsg =
              error instanceof Error ? error.message : "Unknown error";

            // Timeout path
            if (errorMsg.startsWith("__TOOL_TIMEOUT__:")) {
              const ms = errorMsg.split(":")[1];
              logger.warn("[AgentExecutor] Tool execution timed out", {
                tool: name,
                timeoutMs,
              });
              this.circuitBreaker.recordFailure(name);
              return {
                error: `Tool execution timed out after ${ms}ms`,
                success: false,
                canRetry: true,
              };
            }

            // Regular error path
            const isPermError =
              errorMsg.toLowerCase().includes("permission") ||
              errorMsg.toLowerCase().includes("unauthorized") ||
              errorMsg.toLowerCase().includes("forbidden") ||
              errorMsg.toLowerCase().includes("not allowed");

            logger.warn("[AgentExecutor] Tool execution failed", {
              tool: name,
              error: errorMsg,
            });

            this.circuitBreaker.recordFailure(name);

            return {
              error: errorMsg,
              success: false,
              suggestion:
                "This tool failed. Consider trying a different approach or asking the user for help.",
              canRetry: !isPermError,
            };
          }
        },
      } as ExecutorTools[string];
    }
    return wrapped;
  }

  /**
   * Like wrapToolsWithExecute, but additionally pushes tool:call, tool:result,
   * and tool:error AgentEvents via the provided push callback so that the
   * stream() generator can yield them in real time.
   */
  private wrapToolsWithExecuteAndEvents(
    tools: ExecutorTools,
    onToolExecute: ToolExecuteHandler | undefined,
    push: (event: AgentEvent) => void,
  ): ExecutorTools {
    if (!onToolExecute) return tools;

    const wrapped: ExecutorTools = {};
    for (const [name, toolDef] of Object.entries(tools)) {
      wrapped[name] = {
        ...toolDef,
        execute: async (args: Record<string, unknown>, opts?: { toolCallId?: string }) => {
          const toolCallId = opts?.toolCallId ?? randomUUID();

          // Circuit breaker check
          const cbCheck = this.circuitBreaker.canExecute(name);
          if (!cbCheck.allowed) {
            const reason = cbCheck.reason ?? `Circuit breaker open for ${name}`;
            logger.warn("[AgentExecutor] Circuit breaker blocked tool call", {
              tool: name,
              reason,
            });
            // Emit circuit:open so the consumer knows the breaker tripped
            push({ type: 'circuit:open', toolName: name, cooldownMs: 0 });
            push({ type: 'tool:error', toolCallId, error: reason });
            return {
              error: reason,
              success: false,
              canRetry: false,
              suggestion: "Try an alternative approach",
            };
          }

          const timeoutMs = this.config.stepTimeoutMs;

          // Update summary tracker — tool is now executing
          const summaryTracker = getAgentSummaryTracker();
          const currentAction = summaryTracker.summarizeToolCall(this.state.sessionId, name, args);
          summaryTracker.update(this.state.sessionId, {
            status: 'executing',
            currentAction,
            lastToolName: name,
            lastToolArgs: JSON.stringify(args).substring(0, 100),
          });

          // beforeToolCall hook — may abort tool execution
          const beforeResult = await this.hooks.run('beforeToolCall', {
            hookPoint: 'beforeToolCall',
            sessionId: this.state.sessionId,
            toolName: name,
            toolArgs: args,
            metadata: {},
          });

          if (!beforeResult.proceed) {
            const blockReason = `Tool "${name}" blocked by hook`;
            logger.info("[AgentExecutor] Tool blocked by beforeToolCall hook", {
              tool: name,
            });
            push({ type: 'tool:error', toolCallId, error: blockReason });
            const blockedResult = {
              error: blockReason,
              success: false,
              canRetry: false,
              suggestion: 'A lifecycle hook prevented this tool from running.',
            };
            push({
              type: 'tool:result',
              toolCallId,
              result: blockedResult,
              duration: 0,
              success: false,
            });
            return blockedResult;
          }

          // Use potentially modified args from the hook
          const effectiveArgs =
            beforeResult.modified !== undefined && typeof beforeResult.modified === 'object' && beforeResult.modified !== null
              ? (beforeResult.modified as Record<string, unknown>)
              : args;

          // Push tool:call event before execution
          push({ type: 'tool:call', toolName: name, args: effectiveArgs, toolCallId });

          let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
              reject(new Error(`__TOOL_TIMEOUT__:${timeoutMs}`));
            }, timeoutMs);
          });

          const startedAt = Date.now();

          try {
            const raw = await Promise.race([
              onToolExecute(name, effectiveArgs),
              timeoutPromise,
            ]);
            clearTimeout(timeoutHandle);
            this.circuitBreaker.recordSuccess(name);
            const stored = await this.resultStore.store(toolCallId, raw);
            const inlineResult = JSON.parse(stored.inline) as unknown;
            const duration = Date.now() - startedAt;

            // afterToolCall hook — receives the result
            await this.hooks.run('afterToolCall', {
              hookPoint: 'afterToolCall',
              sessionId: this.state.sessionId,
              toolName: name,
              toolArgs: effectiveArgs,
              toolResult: inlineResult,
              metadata: {},
            });

            push({
              type: 'tool:result',
              toolCallId,
              result: inlineResult,
              duration,
              success: true,
            });
            return inlineResult;
          } catch (error) {
            clearTimeout(timeoutHandle);

            const errorMsg =
              error instanceof Error ? error.message : "Unknown error";
            const duration = Date.now() - startedAt;

            // Timeout path
            if (errorMsg.startsWith("__TOOL_TIMEOUT__:")) {
              const ms = errorMsg.split(":")[1];
              logger.warn("[AgentExecutor] Tool execution timed out", {
                tool: name,
                timeoutMs,
              });
              this.circuitBreaker.recordFailure(name);
              const timeoutResult = {
                error: `Tool execution timed out after ${ms}ms`,
                success: false,
                canRetry: true,
              };
              push({ type: 'tool:error', toolCallId, error: timeoutResult.error });
              push({
                type: 'tool:result',
                toolCallId,
                result: timeoutResult,
                duration,
                success: false,
              });
              return timeoutResult;
            }

            // Regular error path
            const isPermError =
              errorMsg.toLowerCase().includes("permission") ||
              errorMsg.toLowerCase().includes("unauthorized") ||
              errorMsg.toLowerCase().includes("forbidden") ||
              errorMsg.toLowerCase().includes("not allowed");

            logger.warn("[AgentExecutor] Tool execution failed", {
              tool: name,
              error: errorMsg,
            });

            this.circuitBreaker.recordFailure(name);
            push({ type: 'tool:error', toolCallId, error: errorMsg });

            const errorResult = {
              error: errorMsg,
              success: false,
              suggestion:
                "This tool failed. Consider trying a different approach or asking the user for help.",
              canRetry: !isPermError,
            };
            push({
              type: 'tool:result',
              toolCallId,
              result: errorResult,
              duration,
              success: false,
            });
            return errorResult;
          }
        },
      } as ExecutorTools[string];
    }
    return wrapped;
  }

  // Custom Stop Condition Checks (in onStepFinish)

  /**
   * Check custom stop conditions that can't be expressed via AI SDK's stopWhen.
   * These include consecutive failures, same tool repeated, budget, timeout, etc.
   * If triggered, we abort the generateText call.
   */
  private checkCustomStopConditions(step: Pick<ExecutorStep, "toolCalls">): void {
    const history = this.state.toolCallHistory;

    // Consecutive failures check
    if (history.length >= 3) {
      const lastThree = history.slice(-3);
      if (lastThree.every((t) => t.status === "failed")) {
        logger.info("[AgentExecutor] 3 consecutive failures, aborting");
        this.state.status = "completed";
        this.abortController.abort();
        return;
      }
    }

    // Same tool repeated with same args check
    if (history.length >= 3) {
      const lastThree = history.slice(-3);
      const firstName = lastThree[0].name;
      const firstArgs = JSON.stringify(lastThree[0].args);
      if (
        lastThree.every(
          (t) => t.name === firstName && JSON.stringify(t.args) === firstArgs,
        )
      ) {
        logger.info(
          "[AgentExecutor] Same tool+args repeated 3 times, aborting",
        );
        this.state.status = "completed";
        this.abortController.abort();
        return;
      }
    }

    // Timeout check
    if (Date.now() - this.state.createdAt >= 5 * 60 * 1000) {
      logger.info("[AgentExecutor] 5 minute timeout exceeded, aborting");
      this.state.status = "completed";
      this.abortController.abort();
      return;
    }

    // Text-only response: if no tools were ever executed and this step has no tool calls,
    // the AI just wants to respond with text — abort to complete
    if (
      !history.some((t) => t.status === "executed") &&
      (!step.toolCalls || step.toolCalls.length === 0)
    ) {
      logger.info(
        "[AgentExecutor] Text-only response with no tool history, completing",
      );
      this.state.status = "completed";
      this.abortController.abort();
      return;
    }
  }

  // Failure Escalation

  /**
   * If the same tool has failed consecutively, inject a system hint
   * telling the AI to try a different approach.
   */
  private injectFailureHint(messages: ModelMessage[]): void {
    const history = this.state.toolCallHistory;
    if (history.length < FAILURE_ESCALATION_THRESHOLD) return;

    const lastTool = history[history.length - 1];
    if (lastTool.status !== "failed") return;

    let consecutiveCount = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].name === lastTool.name && history[i].status === "failed") {
        consecutiveCount++;
      } else {
        break;
      }
    }

    if (consecutiveCount >= FAILURE_ESCALATION_THRESHOLD) {
      messages.push({
        role: "system" as const,
        content: `Tool "${lastTool.name}" has failed ${consecutiveCount} times consecutively. Do NOT retry it with the same parameters. Either try a different approach or inform the user about the issue.`,
      });
      logger.warn("[AgentExecutor] Injecting failure escalation hint", {
        tool: lastTool.name,
        consecutiveFailures: consecutiveCount,
      });
    }
  }

  // Context Extraction

  private extractContext(record: ToolCallRecord): void {
    if (!record.result || typeof record.result !== "object") {
      return;
    }

    const result = record.result as Record<string, unknown>;

    // Store hints from tools
    const hint = getString(result.hint);
    if (hint) {
      this.state.context.lastHint = hint;
    }

    // Store data from tool results
    if (result.data && typeof result.data === "object") {
      const data = result.data as Record<string, unknown>;

      // Projects from list_projects
      if (record.name === "list_projects" && data.projects) {
        this.state.context.availableProjects = getRecordArray(data.projects)
          .map(toContextProject)
          .filter((project): project is ContextProject => project !== null);
      }

      // Tickets from create_ticket
      if (record.name === "create_ticket" && data.id) {
        const ticket = toContextTicket(data);
        if (!ticket) {
          return;
        }
        const tickets = [...(this.state.context.createdTickets ?? [])];
        tickets.push(ticket);
        this.state.context.createdTickets = tickets;
      }

      // Projects from create_project
      if (record.name === "create_project" && data.id) {
        const project = toContextProject(data);
        if (!project) {
          return;
        }
        const projects = [...(this.state.context.availableProjects ?? [])];
        projects.push(project);
        this.state.context.availableProjects = projects;
      }
    }
  }

  // Finalization

  private finalize(): void {
    // Clean up any temp files written by the result store (fire-and-forget)
    this.resultStore.cleanup().catch((err: unknown) => {
      logger.warn("[AgentExecutor] ResultStore cleanup failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // Remove this session from the summary tracker
    getAgentSummaryTracker().end(this.state.sessionId);
    const completedViaTask = this.state.toolCallHistory.some(
      (t) => t.name === "complete_task" && t.status === "executed",
    );

    // Check if agent completed via text response (no tool calls)
    const completedViaTextResponse =
      this.state.toolCallHistory.length === 0 ||
      !this.state.toolCallHistory.some(
        (t) => t.status === "executed" && t.name !== "complete_task",
      );

    // Extract summary with 3-tier priority:
    // 1. complete_task tool summary (most explicit)
    // 2. AI's lastTextResponse (always available for text-only responses)
    // 3. Descriptive fallback from tool history
    let summary: string | undefined;

    // Priority 1: complete_task tool result
    const completionCall = this.state.toolCallHistory.find(
      (t) => t.name === "complete_task" && t.status === "executed",
    );
    if (completionCall?.result) {
      const result = completionCall.result as Record<string, unknown>;
      if (result.data && typeof result.data === "object") {
        const data = result.data as Record<string, unknown>;
        if (data.summary && typeof data.summary === "string") {
          summary = data.summary;
        }
      }
    }

    // Priority 2: AI's text response
    if (!summary) {
      const textResponse = getString(this.state.context.lastTextResponse);
      if (textResponse) {
        summary = textResponse;
      }
    }

    // Priority 3: Descriptive fallback from tool history
    if (!summary) {
      const executedTools = this.state.toolCallHistory.filter(
        (t) => t.status === "executed" && t.name !== "complete_task",
      );
      if (executedTools.length > 0) {
        const uniqueNames = [...new Set(executedTools.map((t) => t.name))];
        summary = `Executed ${executedTools.length} tool call${executedTools.length === 1 ? "" : "s"} (${uniqueNames.join(", ")}) in ${this.state.currentStep} step${this.state.currentStep === 1 ? "" : "s"}.`;
      } else {
        summary = `Agent completed after ${this.state.currentStep} step${this.state.currentStep === 1 ? "" : "s"}.`;
      }
    }

    // Determine stop reason
    let stopReason = "maxSteps";
    if (completedViaTask) {
      stopReason = "taskCompleted";
    } else if (completedViaTextResponse) {
      stopReason = "textResponse";
    }

    this.state.finalResult = {
      success:
        completedViaTask ||
        completedViaTextResponse ||
        this.state.status === "completed",
      summary,
      artifacts: this.collectArtifacts(),
      nextSteps: this.collectNextSteps(),
      stopReason,
      totalSteps: this.state.currentStep,
      totalTokens: this.state.usedBudget,
      inputTokens: this.state.inputTokensUsed,
      outputTokens: this.state.outputTokensUsed,
    };

    // Set status to completed if not already set (e.g. cancelled)
    if (this.state.status === "running") {
      this.state.status = "completed";
    }
    this.state.updatedAt = Date.now();

    logger.info("[AgentExecutor] Agent finalized", {
      sessionId: this.state.sessionId,
      status: this.state.status,
      steps: this.state.currentStep,
      tokens: this.state.usedBudget,
      success: this.state.finalResult.success,
      stopReason,
    });
  }

  private collectArtifacts(): AgentResult["artifacts"] {
    const artifacts: AgentResult["artifacts"] = [];

    // Collect from created tickets
    const tickets = this.state.context.createdTickets;
    if (tickets) {
      for (const ticket of tickets) {
        artifacts.push({
          type: "ticket",
          id: ticket.key ?? ticket.id,
          description: ticket.title,
        });
      }
    }

    // Collect from complete_task call
    const completionCall = this.state.toolCallHistory.find(
      (t) => t.name === "complete_task" && t.status === "executed",
    );
    if (completionCall?.result) {
      const result = completionCall.result as Record<string, unknown>;
      if (result.data && typeof result.data === "object") {
        const data = result.data as Record<string, unknown>;
        const taskArtifacts = getRecordArray(data.artifacts)
          .map(toAgentArtifact)
          .filter((artifact): artifact is AgentArtifact => artifact !== null);
        if (taskArtifacts.length > 0) {
          for (const artifact of taskArtifacts) {
            if (!artifacts.some((a) => a.id === artifact.id)) {
              artifacts.push(artifact);
            }
          }
        }
      }
    }

    return artifacts;
  }

  private collectNextSteps(): string[] {
    const completionCall = this.state.toolCallHistory.find(
      (t) => t.name === "complete_task" && t.status === "executed",
    );
    if (completionCall?.result) {
      const result = completionCall.result as Record<string, unknown>;
      if (result.data && typeof result.data === "object") {
        const data = result.data as Record<string, unknown>;
        return getStringArray(data.nextSteps);
      }
    }
    return [];
  }

  // Error Handling

  private handleError(error: Error): void {
    this.state.status = "failed";
    this.state.updatedAt = Date.now();
    this.state.finalResult = {
      success: false,
      summary: `Agent failed: ${error.message}`,
      artifacts: this.collectArtifacts(),
      stopReason: "error",
      totalSteps: this.state.currentStep,
      totalTokens: this.state.usedBudget,
      inputTokens: this.state.inputTokensUsed,
      outputTokens: this.state.outputTokensUsed,
    };
    this.emit("error", error, this.state);

    logger.error("[AgentExecutor] Agent failed", error);
  }
}

// Factory Functions

/**
 * Create an agent executor with default configuration.
 */
export function createAgent(
  sessionId: string,
  conversationId: string,
  goal: string,
  config?: Partial<AgentConfig>,
): AgentExecutor {
  return new AgentExecutor(sessionId, conversationId, goal, config);
}

/**
 * Create an agent executor for simple tasks with lower limits.
 */
export function createSimpleAgent(
  sessionId: string,
  conversationId: string,
  goal: string,
): AgentExecutor {
  return new AgentExecutor(sessionId, conversationId, goal, {
    maxSteps: 20,
    maxBudget: 20000,
  });
}

/**
 * Create an agent executor for complex tasks with higher limits.
 */
export function createComplexAgent(
  sessionId: string,
  conversationId: string,
  goal: string,
): AgentExecutor {
  return new AgentExecutor(sessionId, conversationId, goal, {
    maxSteps: 200,
    maxBudget: 200000,
  });
}
