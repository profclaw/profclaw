/**
 * Tool Executor
 *
 * Main execution engine for AI tool calls.
 * Coordinates security checks, approvals, rate limiting, and execution.
 * Integrates sandbox, process pool, and audit logging.
 */

import type {
  ToolDefinition,
  ToolResult,
  ToolExecutionContext,
  ToolProgressUpdate,
  AIToolCall,
  ToolCallResult,
  ApprovalRequest,
  ApprovalDecision,
} from "./types.js";
import { getToolRegistry } from "./registry.js";
import { getSecurityManager, type SecurityCheckResult } from "./security.js";
import { getSessionManager } from "./session-manager.js";
import { getSandboxManager } from "./sandbox.js";
import {
  getProcessPool,
  PoolFullError,
  TimeoutError,
  QueueTimeoutError,
} from "./process-pool.js";
import { getAuditLogger } from "./audit.js";
import { getRateLimiter } from "./rate-limiter.js";
import { logger } from "../../utils/logger.js";
import { randomUUID } from "crypto";
import {
  hasSecrets,
  isSecretsDetectionEnabled,
  redactSecrets,
} from "./secrets.js";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
const PROGRESS_THROTTLE_MS = 100; // Throttle progress updates

const redactToolText = (text?: string): string | undefined => {
  if (!text) {
    return text;
  }
  if (!isSecretsDetectionEnabled()) {
    return text;
  }
  if (!hasSecrets(text)) {
    return text;
  }
  return redactSecrets(text);
};

// =============================================================================
// Tool Executor
// =============================================================================

export class ToolExecutor {
  private abortControllers: Map<string, AbortController> = new Map();

  /**
   * Execute a single tool call
   */
  async execute(
    toolCall: AIToolCall,
    context: Omit<
      ToolExecutionContext,
      "toolCallId" | "sessionManager" | "securityPolicy"
    >,
  ): Promise<ToolCallResult> {
    const toolCallId = toolCall.id || randomUUID();
    const startTime = Date.now();
    const auditLogger = getAuditLogger();
    const rateLimiter = getRateLimiter();

    // Get tool definition
    const tool = getToolRegistry().get(toolCall.name);
    if (!tool) {
      auditLogger.logError({
        toolName: toolCall.name,
        toolCallId,
        conversationId: context.conversationId,
        userId: context.userId,
        error: `Tool "${toolCall.name}" not found`,
      });

      return {
        toolCallId,
        toolName: toolCall.name,
        result: {
          success: false,
          error: {
            code: "TOOL_NOT_FOUND",
            message: `Tool "${toolCall.name}" not found`,
          },
        },
      };
    }

    // Check rate limits
    const rateLimitResult = rateLimiter.check({
      userId: context.userId,
      conversationId: context.conversationId,
      toolName: toolCall.name,
    });

    if (!rateLimitResult.allowed) {
      auditLogger.logRateLimited({
        toolName: toolCall.name,
        toolCallId,
        conversationId: context.conversationId,
        userId: context.userId,
        limit: rateLimitResult.limit,
        remaining: rateLimitResult.remaining,
        resetAt: rateLimitResult.resetAt,
      });

      return {
        toolCallId,
        toolName: toolCall.name,
        result: {
          success: false,
          error: {
            code: "RATE_LIMITED",
            message: `Rate limit exceeded. Try again in ${rateLimitResult.retryAfter} seconds.`,
            details: {
              limit: rateLimitResult.limit,
              remaining: rateLimitResult.remaining,
              resetAt: rateLimitResult.resetAt,
              retryAfter: rateLimitResult.retryAfter,
              limitType: rateLimitResult.limitType,
            },
          },
        },
      };
    }

    // Validate parameters
    const parseResult = tool.parameters.safeParse(toolCall.arguments);
    if (!parseResult.success) {
      const missingFields = parseResult.error.issues
        .filter(
          (issue) =>
            issue.code === "invalid_type" && issue.received === "undefined",
        )
        .map((issue) => issue.path.join("."))
        .filter((path) => path.length > 0);

      const missingMessage = missingFields.length
        ? `Missing required parameter${missingFields.length > 1 ? "s" : ""}: ${missingFields.join(", ")}`
        : `Invalid parameters: ${parseResult.error.message}`;

      auditLogger.logError({
        toolName: toolCall.name,
        toolCallId,
        conversationId: context.conversationId,
        userId: context.userId,
        error: missingMessage,
      });

      return {
        toolCallId,
        toolName: toolCall.name,
        result: {
          success: false,
          error: {
            code:
              missingFields.length > 0 ? "MISSING_PARAMS" : "INVALID_PARAMS",
            message: missingMessage,
            details: parseResult.error.issues,
          },
        },
      };
    }

    const params = parseResult.data as Record<string, unknown>;

    // Check security
    const securityManager = getSecurityManager();
    const securityPolicy = securityManager.getPolicy();
    const securityCheck = await securityManager.checkPermission(tool, params, {
      conversationId: context.conversationId,
      toolCallId,
    });

    // Handle approval required
    if (!securityCheck.allowed && securityCheck.requiresApproval) {
      const approvalRequest = securityManager.createApprovalRequest(
        tool,
        params,
        { conversationId: context.conversationId, toolCallId },
        securityCheck.securityLevel ?? "moderate",
      );

      auditLogger.logApprovalRequested({
        toolName: toolCall.name,
        toolCallId,
        conversationId: context.conversationId,
        userId: context.userId,
        approvalId: approvalRequest.id,
        command: this.extractCommand(params),
        securityLevel: securityCheck.securityLevel ?? "moderate",
      });

      return {
        toolCallId,
        toolName: toolCall.name,
        result: {
          success: false,
          error: {
            code: "APPROVAL_REQUIRED",
            message: "This action requires your approval",
          },
        },
        approvalRequired: true,
        approvalId: approvalRequest.id,
      };
    }

    // Handle denied
    if (!securityCheck.allowed) {
      auditLogger.logSecurityDenied({
        toolName: toolCall.name,
        toolCallId,
        conversationId: context.conversationId,
        userId: context.userId,
        command: this.extractCommand(params),
        securityMode: securityPolicy.mode,
        reason: securityCheck.reason ?? "Denied by security policy",
      });

      return {
        toolCallId,
        toolName: toolCall.name,
        result: {
          success: false,
          error: {
            code: "DENIED",
            message:
              securityCheck.reason ??
              "Tool execution denied by security policy",
          },
        },
      };
    }

    // Execute the tool through process pool
    const processPool = getProcessPool();

    try {
      const result = await processPool.submit(
        toolCallId,
        toolCall.name,
        context.conversationId,
        async () => {
          // Check if sandbox execution is required
          if (
            securityCheck.sandboxRequired &&
            securityPolicy.mode === "sandbox"
          ) {
            return this.executeInSandbox(tool, params, context, toolCallId);
          }

          // Normal execution
          return this.executeWithTimeout(
            tool,
            params,
            {
              ...context,
              toolCallId,
              sessionManager: getSessionManager(),
              securityPolicy,
            },
            DEFAULT_TIMEOUT_MS,
          );
        },
        {
          userId: context.userId,
          priority: tool.securityLevel === "safe" ? 1 : 0,
          timeout: DEFAULT_TIMEOUT_MS,
        },
      );

      const durationMs = Date.now() - startTime;
      const sanitizedOutput = redactToolText(result.output);
      const sanitizedResult: ToolResult =
        sanitizedOutput === result.output
          ? result
          : {
              ...result,
              output: sanitizedOutput,
            };

      // Log successful execution
      auditLogger.logExecution({
        toolName: toolCall.name,
        toolCallId,
        conversationId: context.conversationId,
        userId: context.userId,
        params,
        command: this.extractCommand(params),
        securityMode: securityPolicy.mode,
        success: sanitizedResult.success,
        durationMs,
        exitCode: (sanitizedResult.data as { exitCode?: number })?.exitCode,
        output: sanitizedResult.output,
        error: sanitizedResult.error?.message,
      });

      logger.info(
        `[Executor] Tool ${toolCall.name} completed in ${durationMs}ms`,
        { component: "ToolExecutor" },
      );

      return {
        toolCallId,
        toolName: toolCall.name,
        result: {
          ...sanitizedResult,
          durationMs,
        },
        rateLimitInfo: {
          remaining: rateLimitResult.remaining - 1,
          resetAt: rateLimitResult.resetAt,
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      // Handle specific error types
      if (error instanceof PoolFullError) {
        auditLogger.logError({
          toolName: toolCall.name,
          toolCallId,
          conversationId: context.conversationId,
          userId: context.userId,
          error: "Execution pool is full",
        });

        return {
          toolCallId,
          toolName: toolCall.name,
          result: {
            success: false,
            error: {
              code: "POOL_FULL",
              message:
                "Too many concurrent executions. Please try again later.",
              retryable: true,
            },
            durationMs,
          },
        };
      }

      if (error instanceof TimeoutError || error instanceof QueueTimeoutError) {
        auditLogger.logTimeout({
          toolName: toolCall.name,
          toolCallId,
          conversationId: context.conversationId,
          userId: context.userId,
          durationMs,
        });

        return {
          toolCallId,
          toolName: toolCall.name,
          result: {
            success: false,
            error: {
              code: "TIMEOUT",
              message: error.message,
              retryable: true,
            },
            durationMs,
          },
        };
      }

      // Generic error
      auditLogger.logExecution({
        toolName: toolCall.name,
        toolCallId,
        conversationId: context.conversationId,
        userId: context.userId,
        params,
        securityMode: securityPolicy.mode,
        success: false,
        durationMs,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      logger.error(
        `[Executor] Tool ${toolCall.name} failed`,
        error instanceof Error ? error : undefined,
      );

      return {
        toolCallId,
        toolName: toolCall.name,
        result: {
          success: false,
          error: {
            code: "EXECUTION_ERROR",
            message: error instanceof Error ? error.message : "Unknown error",
          },
          durationMs,
        },
      };
    }
  }

  /**
   * Execute multiple tool calls (parallel or sequential)
   */
  async executeMany(
    toolCalls: AIToolCall[],
    context: Omit<
      ToolExecutionContext,
      "toolCallId" | "sessionManager" | "securityPolicy"
    >,
    options: { parallel?: boolean } = {},
  ): Promise<ToolCallResult[]> {
    if (options.parallel) {
      return Promise.all(toolCalls.map((tc) => this.execute(tc, context)));
    }

    const results: ToolCallResult[] = [];
    for (const toolCall of toolCalls) {
      results.push(await this.execute(toolCall, context));
    }
    return results;
  }

  /**
   * Execute after approval is granted
   */
  async executeAfterApproval(
    approvalId: string,
    decision: ApprovalDecision,
    context: Omit<
      ToolExecutionContext,
      "toolCallId" | "sessionManager" | "securityPolicy"
    >,
  ): Promise<ToolCallResult | null> {
    const securityManager = getSecurityManager();
    const auditLogger = getAuditLogger();
    const pendingApprovals = securityManager.getPendingApprovals();
    const approval = pendingApprovals.find((a) => a.id === approvalId);

    if (!approval) {
      logger.warn(`[Executor] Approval not found: ${approvalId}`, {
        component: "ToolExecutor",
      });
      return null;
    }

    // Log approval decision
    auditLogger.logApprovalDecision({
      toolName: approval.toolName,
      toolCallId: approval.toolCallId,
      conversationId: approval.conversationId,
      userId: context.userId,
      approvalId,
      decision,
    });

    // Handle user response
    securityManager.handleApprovalResponse({
      requestId: approvalId,
      decision,
      userId: context.userId,
    });

    // If denied, return denial result
    if (decision === "deny") {
      return {
        toolCallId: approval.toolCallId,
        toolName: approval.toolName,
        result: {
          success: false,
          error: {
            code: "USER_DENIED",
            message: "User denied the tool execution",
          },
        },
      };
    }

    // Execute the tool
    const tool = getToolRegistry().get(approval.toolName);
    if (!tool) {
      return {
        toolCallId: approval.toolCallId,
        toolName: approval.toolName,
        result: {
          success: false,
          error: {
            code: "TOOL_NOT_FOUND",
            message: `Tool "${approval.toolName}" not found`,
          },
        },
      };
    }

    const startTime = Date.now();
    const processPool = getProcessPool();

    try {
      const result = await processPool.submit(
        approval.toolCallId,
        approval.toolName,
        context.conversationId,
        async () => {
          return this.executeWithTimeout(
            tool,
            approval.params,
            {
              ...context,
              toolCallId: approval.toolCallId,
              sessionManager: getSessionManager(),
              securityPolicy: securityManager.getPolicy(),
            },
            DEFAULT_TIMEOUT_MS,
          );
        },
        {
          userId: context.userId,
          priority: 1, // Approved tasks get higher priority
        },
      );

      const durationMs = Date.now() - startTime;
      const sanitizedOutput = redactToolText(result.output);
      const sanitizedResult: ToolResult =
        sanitizedOutput === result.output
          ? result
          : {
              ...result,
              output: sanitizedOutput,
            };

      auditLogger.logExecution({
        toolName: approval.toolName,
        toolCallId: approval.toolCallId,
        conversationId: context.conversationId,
        userId: context.userId,
        params: approval.params,
        command: approval.command,
        securityMode: securityManager.getPolicy().mode,
        success: sanitizedResult.success,
        durationMs,
        output: sanitizedResult.output,
        error: sanitizedResult.error?.message,
      });

      return {
        toolCallId: approval.toolCallId,
        toolName: approval.toolName,
        result: {
          ...sanitizedResult,
          durationMs,
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      auditLogger.logExecution({
        toolName: approval.toolName,
        toolCallId: approval.toolCallId,
        conversationId: context.conversationId,
        userId: context.userId,
        params: approval.params,
        securityMode: securityManager.getPolicy().mode,
        success: false,
        durationMs,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        toolCallId: approval.toolCallId,
        toolName: approval.toolName,
        result: {
          success: false,
          error: {
            code: "EXECUTION_ERROR",
            message: error instanceof Error ? error.message : "Unknown error",
          },
          durationMs,
        },
      };
    }
  }

  /**
   * Abort a running tool execution
   */
  abort(toolCallId: string): boolean {
    const controller = this.abortControllers.get(toolCallId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(toolCallId);
      return true;
    }

    // Also try to cancel in process pool
    return getProcessPool().cancel(toolCallId);
  }

  /**
   * Get pending approvals
   */
  getPendingApprovals(conversationId?: string): ApprovalRequest[] {
    return getSecurityManager().getPendingApprovals(conversationId);
  }

  /**
   * Get execution status
   */
  getStatus() {
    return {
      poolStatus: getProcessPool().getStatus(),
      sandboxStatus: getSandboxManager().getStatus(),
      rateLimitConfig: getRateLimiter().getConfig(),
      auditStats: getAuditLogger().getStats(),
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private async executeInSandbox(
    tool: ToolDefinition,
    params: Record<string, unknown>,
    context: Omit<
      ToolExecutionContext,
      "toolCallId" | "sessionManager" | "securityPolicy"
    >,
    toolCallId: string,
  ): Promise<ToolResult> {
    const sandbox = getSandboxManager();

    if (!sandbox.isAvailable()) {
      logger.warn(
        "[Executor] Sandbox not available, falling back to normal execution",
        { component: "ToolExecutor" },
      );
      // Fall back to normal execution
      return this.executeWithTimeout(
        tool,
        params,
        {
          ...context,
          toolCallId,
          sessionManager: getSessionManager(),
          securityPolicy: getSecurityManager().getPolicy(),
        },
        DEFAULT_TIMEOUT_MS,
      );
    }

    // For exec-type tools, run command in sandbox
    if (tool.name === "exec" && params.command) {
      const result = await sandbox.execute({
        command: params.command as string,
        workdir: context.workdir,
        env: context.env,
        timeout: DEFAULT_TIMEOUT_MS,
      });

      return {
        success: result.success,
        output: result.stdout + (result.stderr ? `\n${result.stderr}` : ""),
        data: {
          exitCode: result.exitCode,
          containerId: result.containerId,
        },
        error: result.error
          ? {
              code: "SANDBOX_ERROR",
              message: result.error,
            }
          : undefined,
      };
    }

    // For other tools, execute normally (they don't need sandboxing)
    return this.executeWithTimeout(
      tool,
      params,
      {
        ...context,
        toolCallId,
        sessionManager: getSessionManager(),
        securityPolicy: getSecurityManager().getPolicy(),
      },
      DEFAULT_TIMEOUT_MS,
    );
  }

  private async executeWithTimeout(
    tool: ToolDefinition,
    params: Record<string, unknown>,
    context: ToolExecutionContext,
    timeoutMs: number,
  ): Promise<ToolResult> {
    // Create abort controller
    const abortController = new AbortController();
    this.abortControllers.set(context.toolCallId, abortController);

    // Create progress handler with throttling
    let lastProgressTime = 0;
    const throttledProgress = context.onProgress
      ? (update: ToolProgressUpdate) => {
          const now = Date.now();
          if (now - lastProgressTime >= PROGRESS_THROTTLE_MS) {
            lastProgressTime = now;
            const sanitizedUpdate =
              update.type === "output"
                ? {
                    ...update,
                    content: redactToolText(update.content) ?? "",
                  }
                : update;
            context.onProgress!(sanitizedUpdate);
          }
        }
      : undefined;

    // Set up timeout
    const timeoutPromise = new Promise<ToolResult>((_, reject) => {
      setTimeout(() => {
        abortController.abort();
        reject(
          new TimeoutError(`Tool execution timed out after ${timeoutMs}ms`),
        );
      }, timeoutMs);
    });

    // Execute tool
    const executionPromise = tool.execute(
      {
        ...context,
        onProgress: throttledProgress,
        signal: abortController.signal,
      },
      params,
    );

    try {
      const result = await Promise.race([executionPromise, timeoutPromise]);
      return result;
    } finally {
      this.abortControllers.delete(context.toolCallId);
    }
  }

  private extractCommand(params: Record<string, unknown>): string | undefined {
    if (typeof params.command === "string") {
      return params.command;
    }
    return undefined;
  }
}

// =============================================================================
// Singleton
// =============================================================================

let toolExecutor: ToolExecutor | null = null;

export function getToolExecutor(): ToolExecutor {
  if (!toolExecutor) {
    toolExecutor = new ToolExecutor();
  }
  return toolExecutor;
}

export function initToolExecutor(): ToolExecutor {
  toolExecutor = new ToolExecutor();
  return toolExecutor;
}
