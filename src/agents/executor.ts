/**
 * Agent Executor
 *
 * The main orchestrator for the GLINR agentic loop system.
 * Uses AI SDK's native multi-step execution (stopWhen + onStepFinish)
 * instead of a manual loop. Tools have execute functions and the SDK
 * handles message accumulation, tool result feeding, and step chaining.
 */

import {
  generateText,
  stepCountIs as sdkStepCountIs,
  hasToolCall as sdkHasToolCall,
} from "ai";
import type { StopCondition as AiSdkStopCondition } from "ai";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type {
  AgentState,
  AgentConfig,
  AgentResult,
  AgentEvents,
  ToolCallRecord,
  ThinkingEffort,
} from "./types.js";
import { EFFORT_BUDGET_MAP } from "./types.js";
import { defaultStopConditions, taskCompleted } from "./stop-conditions.js";
import { logger } from "../utils/logger.js";

// =============================================================================
// Default Configuration
// =============================================================================

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

// =============================================================================
// Agent Executor Class
// =============================================================================

export class AgentExecutor extends EventEmitter<AgentEvents> {
  private state: AgentState;
  private config: Required<AgentConfig>;
  private abortController: AbortController;
  private isRunning: boolean = false;

  constructor(
    sessionId: string,
    conversationId: string,
    goal: string,
    config: Partial<AgentConfig> = {},
  ) {
    super();
    this.abortController = new AbortController();
    this.config = { ...DEFAULT_CONFIG, ...config };

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
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Run the agent until completion or stop condition.
   * Uses AI SDK's native multi-step execution — a single generateText call
   * with stopWhen + onStepFinish replaces the old manual loop.
   */
  async run(
    model: any,
    messages: any[],
    tools: Record<string, any>,
    onToolExecute?: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<unknown>,
    providerHint?: string,
  ): Promise<AgentState> {
    if (this.isRunning) {
      throw new Error("Agent is already running");
    }

    this.isRunning = true;
    this.state.status = "running";
    this.state.updatedAt = Date.now();
    this.emit("start", this.state);

    logger.info("[AgentExecutor] Starting agent run", {
      sessionId: this.state.sessionId,
      goal: this.state.goal,
    });

    try {
      // Inject failure hint if applicable (from prior runs / retries)
      this.injectFailureHint(messages);

      // Wire execute functions into tools so the SDK can auto-execute them
      const executableTools = this.wrapToolsWithExecute(tools, onToolExecute);

      const hasTools = Object.keys(executableTools).length > 0;

      // Build provider-specific options (e.g. Anthropic thinking/effort)
      const providerOptions = this.buildProviderOptions(providerHint);

      // Single generateText call — the SDK handles multi-step chaining
      const result = await generateText({
        model,
        messages,
        tools: hasTools ? executableTools : undefined,
        ...(providerOptions ? { providerOptions } : {}),
        stopWhen: [
          sdkStepCountIs(this.config.maxSteps),
          sdkHasToolCall("complete_task"),
        ] as AiSdkStopCondition<any>[],
        abortSignal: this.abortController.signal,
        onStepFinish: (step: any) => {
          this.state.currentStep++;
          this.state.updatedAt = Date.now();

          // Track token budget (AI SDK v6 uses inputTokens/outputTokens)
          const stepInput = step.usage?.inputTokens ?? step.usage?.promptTokens ?? 0;
          const stepOutput = step.usage?.outputTokens ?? step.usage?.completionTokens ?? 0;
          const tokensUsed = stepInput + stepOutput;
          this.state.usedBudget += tokensUsed;
          this.state.inputTokensUsed += stepInput;
          this.state.outputTokensUsed += stepOutput;

          // Store text response for summary extraction
          if (step.text) {
            this.state.context.lastTextResponse = step.text;
          }

          // Record tool calls in history
          for (const tc of step.toolCalls ?? []) {
            const record: ToolCallRecord = {
              id: tc.toolCallId ?? randomUUID(),
              name: tc.toolName,
              args: (tc as any).input ?? (tc as any).args ?? {},
              status: "pending",
              startedAt: Date.now(),
            };

            // Find the matching tool result
            const tr = (step.toolResults ?? []).find(
              (r: any) => r.toolCallId === tc.toolCallId,
            );

            if (tr) {
              record.result = tr.result;
              record.completedAt = Date.now();

              // Check if the tool result indicates a failure
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

            // Extract context from tool results (projects, tickets, etc.)
            this.extractContext(record);

            if (record.status === "executed") {
              this.emit("tool:result", this.state, record);
            }
          }

          // Emit step events
          this.emit("step:start", this.state);
          this.emit("step:complete", this.state, step);

          logger.debug("[AgentExecutor] Step completed", {
            step: this.state.currentStep,
            toolCalls: step.toolCalls?.length ?? 0,
            tokensUsed,
            text: step.text?.substring(0, 100),
          });

          // Check custom stop conditions (consecutive failures, same tool repeated, etc.)
          this.checkCustomStopConditions(step);

          // Budget abort
          if (this.state.usedBudget >= this.state.maxBudget) {
            logger.info("[AgentExecutor] Budget exceeded, aborting", {
              used: this.state.usedBudget,
              max: this.state.maxBudget,
            });
            this.abortController.abort();
          }
        },
      } as any);

      // Update budget from total usage (AI SDK v6 uses inputTokens/outputTokens)
      const totalUsage = (result as any).totalUsage;
      if (totalUsage) {
        const totalInput = totalUsage.inputTokens ?? totalUsage.promptTokens ?? 0;
        const totalOutput = totalUsage.outputTokens ?? totalUsage.completionTokens ?? 0;
        // totalUsage is the authoritative sum; overwrite our step-by-step estimate
        this.state.usedBudget = totalInput + totalOutput;
        this.state.inputTokensUsed = totalInput;
        this.state.outputTokensUsed = totalOutput;
      }

      // Store final text from the result (last step's text)
      if (result.text) {
        this.state.context.lastTextResponse = result.text;
      }

      // Finalize
      this.finalize();
      return this.state;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        // Aborted by budget or cancellation — still finalize
        logger.info("[AgentExecutor] Agent aborted");
        this.finalize();
        return this.state;
      }
      this.handleError(error as Error);
      throw error;
    } finally {
      this.isRunning = false;
    }
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

  // ===========================================================================
  // Provider Options (Effort / Thinking)
  // ===========================================================================

  /**
   * Build provider-specific options based on agent config.
   * For Anthropic models with effort set, enables extended thinking.
   */
  private buildProviderOptions(providerHint?: string): Record<string, unknown> | undefined {
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

  // ===========================================================================
  // Tool Wrapping
  // ===========================================================================

  /**
   * Wrap tools with execute functions so the AI SDK can auto-execute them.
   * This is the key change: instead of us manually processing tool calls
   * after each step, the SDK calls execute() and feeds results back.
   */
  private wrapToolsWithExecute(
    tools: Record<string, any>,
    onToolExecute?: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<unknown>,
  ): Record<string, any> {
    if (!onToolExecute) return tools;

    const wrapped: Record<string, any> = {};
    for (const [name, toolDef] of Object.entries(tools)) {
      wrapped[name] = {
        ...toolDef,
        execute: async (args: Record<string, unknown>) => {
          try {
            const result = await onToolExecute(name, args);
            return result;
          } catch (error) {
            // Return error as a structured result so the AI can see it and adjust
            const errorMsg =
              error instanceof Error ? error.message : "Unknown error";
            const isPermError =
              errorMsg.toLowerCase().includes("permission") ||
              errorMsg.toLowerCase().includes("unauthorized") ||
              errorMsg.toLowerCase().includes("forbidden") ||
              errorMsg.toLowerCase().includes("not allowed");

            logger.warn("[AgentExecutor] Tool execution failed", {
              tool: name,
              error: errorMsg,
            });

            return {
              error: errorMsg,
              success: false,
              suggestion:
                "This tool failed. Consider trying a different approach or asking the user for help.",
              canRetry: !isPermError,
            };
          }
        },
      };
    }
    return wrapped;
  }

  // ===========================================================================
  // Custom Stop Condition Checks (in onStepFinish)
  // ===========================================================================

  /**
   * Check custom stop conditions that can't be expressed via AI SDK's stopWhen.
   * These include consecutive failures, same tool repeated, budget, timeout, etc.
   * If triggered, we abort the generateText call.
   */
  private checkCustomStopConditions(step: any): void {
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

  // ===========================================================================
  // Failure Escalation
  // ===========================================================================

  /**
   * If the same tool has failed consecutively, inject a system hint
   * telling the AI to try a different approach.
   */
  private injectFailureHint(messages: any[]): void {
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

  // ===========================================================================
  // Context Extraction
  // ===========================================================================

  private extractContext(record: ToolCallRecord): void {
    if (!record.result || typeof record.result !== "object") {
      return;
    }

    const result = record.result as Record<string, unknown>;

    // Store hints from tools
    if (result.hint) {
      this.state.context.lastHint = result.hint as string;
    }

    // Store data from tool results
    if (result.data && typeof result.data === "object") {
      const data = result.data as Record<string, unknown>;

      // Projects from list_projects
      if (record.name === "list_projects" && data.projects) {
        this.state.context.availableProjects = (data.projects as any[]).map(
          (p) => ({
            key: p.key,
            name: p.name,
            id: p.id,
          }),
        );
      }

      // Tickets from create_ticket
      if (record.name === "create_ticket" && data.id) {
        const tickets = (this.state.context.createdTickets ?? []) as any[];
        tickets.push({
          id: data.id as string,
          key: data.key as string,
          title: data.title as string,
          type: data.type as string,
        });
        this.state.context.createdTickets = tickets;
      }

      // Projects from create_project
      if (record.name === "create_project" && data.id) {
        const projects = (this.state.context.availableProjects ?? []) as any[];
        projects.push({
          id: data.id as string,
          key: data.key as string,
          name: data.name as string,
        });
        this.state.context.availableProjects = projects;
      }
    }
  }

  // ===========================================================================
  // Finalization
  // ===========================================================================

  private finalize(): void {
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
      const textResponse = this.state.context.lastTextResponse as
        | string
        | undefined;
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
    const tickets = this.state.context.createdTickets as any[];
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
        const taskArtifacts = data.artifacts as any[];
        if (taskArtifacts) {
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
        return (data.nextSteps as string[]) ?? [];
      }
    }
    return [];
  }

  // ===========================================================================
  // Error Handling
  // ===========================================================================

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

// =============================================================================
// Factory Functions
// =============================================================================

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
