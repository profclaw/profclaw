/**
 * Tool Execution Routes
 *
 * API endpoints for AI tool execution, approvals, and security settings.
 */

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  getToolExecutor,
  getToolRegistry,
  getSecurityManager,
  getSessionManager,
  initializeToolExecution,
  getAuditLogger,
  getProcessPool,
  getSandboxManager,
  getRateLimiter,
  type SecurityMode,
  type ApprovalDecision,
  type AuditEventType,
} from "../chat/execution/index.js";
import { logger } from "../utils/logger.js";
import {
  hasSecrets,
  isSecretsDetectionEnabled,
  redactSecrets,
} from "../chat/execution/secrets.js";

// Initialize on module load (async)
initializeToolExecution({ registerBuiltins: true }).catch((err) => {
  logger.error("[ToolRoutes] Failed to initialize tool execution", err);
});

const tools = new Hono();

// =============================================================================
// Schemas
// =============================================================================

const ExecuteToolSchema = z.object({
  toolCall: z.object({
    id: z.string().optional(),
    name: z.string(),
    arguments: z.record(z.unknown()),
  }),
  conversationId: z.string(),
  workdir: z.string().optional(),
});

const ApprovalResponseSchema = z.object({
  approvalId: z.string(),
  decision: z.enum(["allow-once", "allow-always", "deny"]),
});

const SecurityPolicySchema = z.object({
  mode: z.enum(["deny", "sandbox", "allowlist", "ask", "full"]),
  askTimeout: z.number().optional(),
});

const AllowlistEntrySchema = z.object({
  pattern: z.string(),
  type: z.enum(["command", "path", "url"]),
  description: z.string().optional(),
});

// =============================================================================
// Tool Execution
// =============================================================================

/**
 * Execute a tool call
 */
tools.post("/execute", zValidator("json", ExecuteToolSchema), async (c) => {
  const { toolCall, conversationId, workdir } = c.req.valid("json");

  logger.info(`[ToolRoutes] Execute tool: ${toolCall.name}`, {
    component: "ToolRoutes",
  });

  try {
    const executor = getToolExecutor();
    const result = await executor.execute(toolCall, {
      conversationId,
      workdir: workdir ?? process.cwd(),
      env: {},
    });

    // If approval required, return the approval request
    if (result.approvalRequired && result.approvalId) {
      const pendingApprovals = executor.getPendingApprovals(conversationId);
      const approval = pendingApprovals.find((a) => a.id === result.approvalId);

      return c.json({
        success: false,
        approvalRequired: true,
        approval: approval
          ? {
              id: approval.id,
              toolName: approval.toolName,
              command: approval.command,
              params: approval.params,
              securityLevel: approval.securityLevel,
              expiresAt: approval.expiresAt,
            }
          : null,
        result: result.result,
      });
    }

    return c.json({
      success: result.result.success,
      result: result.result,
      toolCallId: result.toolCallId,
    });
  } catch (error) {
    logger.error(
      `[ToolRoutes] Execute failed`,
      error instanceof Error ? error : undefined,
    );
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * Handle approval response
 */
tools.post(
  "/approval",
  zValidator("json", ApprovalResponseSchema),
  async (c) => {
    const { approvalId, decision } = c.req.valid("json");

    logger.info(
      `[ToolRoutes] Approval response: ${approvalId} -> ${decision}`,
      { component: "ToolRoutes" },
    );

    try {
      const securityManager = getSecurityManager();
      const executor = getToolExecutor();

      // Find the approval
      const pendingApprovals = securityManager.getPendingApprovals();
      const approval = pendingApprovals.find((a) => a.id === approvalId);

      if (!approval) {
        return c.json(
          { success: false, error: "Approval not found or expired" },
          404,
        );
      }

      // Execute after approval
      const result = await executor.executeAfterApproval(
        approvalId,
        decision as ApprovalDecision,
        {
          conversationId: approval.conversationId,
          workdir: process.cwd(),
          env: {},
        },
      );

      if (!result) {
        return c.json(
          { success: false, error: "Failed to execute after approval" },
          500,
        );
      }

      return c.json({
        success: result.result.success,
        result: result.result,
        toolCallId: result.toolCallId,
      });
    } catch (error) {
      logger.error(
        `[ToolRoutes] Approval handler failed`,
        error instanceof Error ? error : undefined,
      );
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        500,
      );
    }
  },
);

/**
 * Get pending approvals for a conversation
 */
tools.get("/approvals/:conversationId", (c) => {
  const conversationId = c.req.param("conversationId");
  const executor = getToolExecutor();
  const approvals = executor.getPendingApprovals(conversationId);

  return c.json({
    approvals: approvals.map((a) => ({
      id: a.id,
      toolName: a.toolName,
      command: a.command,
      params: a.params,
      securityLevel: a.securityLevel,
      createdAt: a.createdAt,
      expiresAt: a.expiresAt,
    })),
  });
});

// =============================================================================
// Security Settings
// =============================================================================

/**
 * Get current security policy
 */
tools.get("/security", (c) => {
  const securityManager = getSecurityManager();
  const policy = securityManager.getPolicy();

  return c.json({
    policy: {
      mode: policy.mode,
      askTimeout: policy.askTimeout,
      allowlistCount: policy.allowlist?.length ?? 0,
      sandboxEnabled: policy.sandboxConfig?.enabled ?? false,
    },
    allowlist: policy.allowlist ?? [],
  });
});

/**
 * Update security policy
 */
tools.put("/security", zValidator("json", SecurityPolicySchema), (c) => {
  const updates = c.req.valid("json");

  logger.info(`[ToolRoutes] Update security policy: mode=${updates.mode}`, {
    component: "ToolRoutes",
  });

  const securityManager = getSecurityManager();
  securityManager.updatePolicy(updates);

  return c.json({
    success: true,
    policy: securityManager.getPolicy(),
  });
});

/**
 * Add to allowlist
 */
tools.post(
  "/security/allowlist",
  zValidator("json", AllowlistEntrySchema),
  (c) => {
    const entry = c.req.valid("json");

    const securityManager = getSecurityManager();
    securityManager.addToAllowlist({
      ...entry,
      addedAt: new Date().toISOString(),
    });

    return c.json({
      success: true,
      allowlist: securityManager.getPolicy().allowlist,
    });
  },
);

/**
 * Remove from allowlist
 */
tools.delete("/security/allowlist/:pattern", (c) => {
  const pattern = decodeURIComponent(c.req.param("pattern"));

  const securityManager = getSecurityManager();
  const removed = securityManager.removeFromAllowlist(pattern);

  return c.json({
    success: removed,
    allowlist: securityManager.getPolicy().allowlist,
  });
});

// =============================================================================
// Tool Registry
// =============================================================================

/**
 * List available tools
 */
tools.get("/list", (c) => {
  const registry = getToolRegistry();
  const toolList = registry.list();

  return c.json({
    tools: toolList.map((t) => ({
      name: t.name,
      description: t.description,
      category: t.category,
      securityLevel: t.securityLevel,
      requiresApproval: t.requiresApproval,
    })),
    total: toolList.length,
  });
});

/**
 * List tools with availability status
 * Used by Settings UI to show which tools need configuration
 */
tools.get("/list/availability", (c) => {
  const registry = getToolRegistry();
  const toolList = registry.list();

  interface ToolWithAvailability {
    name: string;
    description: string;
    category: string;
    securityLevel: string;
    requiresApproval?: boolean;
    availability: {
      available: boolean;
      reason?: string;
    };
  }

  const toolsWithAvailability: ToolWithAvailability[] = toolList.map((t) => {
    // Check if tool has isAvailable function
    const availability = t.isAvailable
      ? t.isAvailable()
      : { available: true };

    return {
      name: t.name,
      description: t.description,
      category: t.category,
      securityLevel: t.securityLevel,
      requiresApproval: t.requiresApproval,
      availability,
    };
  });

  // Group by category for easier UI rendering
  const byCategory = toolsWithAvailability.reduce(
    (acc, tool) => {
      if (!acc[tool.category]) {
        acc[tool.category] = [];
      }
      acc[tool.category].push(tool);
      return acc;
    },
    {} as Record<string, ToolWithAvailability[]>
  );

  // Summary statistics
  const availableCount = toolsWithAvailability.filter(
    (t) => t.availability.available
  ).length;
  const unavailableCount = toolsWithAvailability.filter(
    (t) => !t.availability.available
  ).length;

  return c.json({
    tools: toolsWithAvailability,
    byCategory,
    summary: {
      total: toolsWithAvailability.length,
      available: availableCount,
      unavailable: unavailableCount,
    },
  });
});

/**
 * Get tools for AI (function calling format)
 */
tools.get("/ai-schema", (c) => {
  const registry = getToolRegistry();
  const schemas = registry.getForAI();

  return c.json({ tools: schemas });
});

/**
 * Get tool descriptions for system prompt
 */
tools.get("/descriptions", (c) => {
  const registry = getToolRegistry();
  const descriptions = registry.getDescriptions();

  return c.json({ descriptions });
});

// =============================================================================
// Session Management
// =============================================================================

/**
 * List sessions
 */
tools.get("/sessions", (c) => {
  const conversationId = c.req.query("conversationId");
  const sessionManager = getSessionManager();

  const sessions = sessionManager.list(
    conversationId ? { conversationId } : undefined,
  );

  return c.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      toolName: s.toolName,
      status: s.status,
      pid: s.pid,
      command: s.command,
      createdAt: s.createdAt,
      completedAt: s.completedAt,
      exitCode: s.exitCode,
      backgrounded: s.backgrounded,
    })),
  });
});

/**
 * Get session output
 */
tools.get("/sessions/:sessionId", (c) => {
  const sessionId = c.req.param("sessionId");
  const sessionManager = getSessionManager();
  const session = sessionManager.get(sessionId);

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  return c.json({
    session: {
      id: session.id,
      toolName: session.toolName,
      status: session.status,
      command: session.command,
      workdir: session.workdir,
      pid: session.pid,
      createdAt: session.createdAt,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      exitCode: session.exitCode,
      exitSignal: session.exitSignal,
      backgrounded: session.backgrounded,
      truncated: session.truncated,
    },
    output: sessionManager.getOutput(sessionId),
    tail: sessionManager.getTail(sessionId, 5000),
  });
});

/**
 * Kill a session
 */
tools.post("/sessions/:sessionId/kill", async (c) => {
  const sessionId = c.req.param("sessionId");
  const sessionManager = getSessionManager();

  await sessionManager.kill(sessionId);

  return c.json({ success: true });
});

// =============================================================================
// Audit Logging
// =============================================================================

/**
 * Query audit logs
 */
tools.get("/audit", (c) => {
  const query = c.req.query();
  const auditLogger = getAuditLogger();

  const filter = {
    eventTypes: query.eventTypes?.split(",") as AuditEventType[] | undefined,
    toolName: query.toolName,
    conversationId: query.conversationId,
    userId: query.userId,
    success:
      query.success === "true"
        ? true
        : query.success === "false"
          ? false
          : undefined,
    since: query.since ? parseInt(query.since, 10) : undefined,
    until: query.until ? parseInt(query.until, 10) : undefined,
    limit: query.limit ? parseInt(query.limit, 10) : 100,
    offset: query.offset ? parseInt(query.offset, 10) : 0,
  };

  const entries = auditLogger.query(filter);

  return c.json({
    entries,
    total: auditLogger.count,
    filter,
  });
});

/**
 * Get audit statistics
 */
tools.get("/audit/stats", (c) => {
  const query = c.req.query();
  const auditLogger = getAuditLogger();

  const stats = auditLogger.getStats({
    since: query.since ? parseInt(query.since, 10) : undefined,
    until: query.until ? parseInt(query.until, 10) : undefined,
  });

  return c.json({ stats });
});

/**
 * Export audit logs as CSV
 */
tools.get("/audit/export", (c) => {
  const query = c.req.query();
  const auditLogger = getAuditLogger();

  const filter = {
    eventTypes: query.eventTypes?.split(",") as AuditEventType[] | undefined,
    toolName: query.toolName,
    conversationId: query.conversationId,
    since: query.since ? parseInt(query.since, 10) : undefined,
    until: query.until ? parseInt(query.until, 10) : undefined,
  };

  const csv = auditLogger.exportCsv(filter);

  c.header("Content-Type", "text/csv");
  c.header(
    "Content-Disposition",
    `attachment; filename="audit-log-${Date.now()}.csv"`,
  );
  return c.body(csv);
});

// =============================================================================
// System Status
// =============================================================================

/**
 * Get full execution system status
 */
tools.get("/status", (c) => {
  const executor = getToolExecutor();
  const status = executor.getStatus();

  return c.json({
    sandbox: status.sandboxStatus,
    pool: status.poolStatus,
    rateLimit: status.rateLimitConfig,
    audit: status.auditStats,
  });
});

/**
 * Get process pool status
 */
tools.get("/pool/status", (c) => {
  const pool = getProcessPool();
  return c.json(pool.getStatus());
});

/**
 * Get process pool metrics
 */
tools.get("/pool/metrics", (c) => {
  const pool = getProcessPool();
  return c.json(pool.getMetrics());
});

/**
 * Update process pool configuration
 */
tools.put(
  "/pool/config",
  zValidator(
    "json",
    z.object({
      maxConcurrent: z.number().min(1).max(100).optional(),
      maxQueueSize: z.number().min(1).max(1000).optional(),
      defaultTimeout: z.number().min(1000).max(600000).optional(),
    }),
  ),
  (c) => {
    const updates = c.req.valid("json");
    const pool = getProcessPool();
    pool.updateConfig(updates);
    return c.json({ success: true, config: pool.getStatus().config });
  },
);

/**
 * Clear the execution queue
 */
tools.post("/pool/clear-queue", (c) => {
  const pool = getProcessPool();
  const cleared = pool.clearQueue();
  return c.json({ success: true, cleared });
});

// =============================================================================
// Sandbox Management
// =============================================================================

/**
 * Get sandbox status
 */
tools.get("/sandbox/status", (c) => {
  const sandbox = getSandboxManager();
  return c.json(sandbox.getStatus());
});

/**
 * Update sandbox configuration
 */
tools.put(
  "/sandbox/config",
  zValidator(
    "json",
    z.object({
      image: z.string().optional(),
      workdir: z.string().optional(),
      networkMode: z.enum(["none", "bridge", "host"]).optional(),
      memoryLimit: z.string().optional(),
      cpuLimit: z.string().optional(),
    }),
  ),
  (c) => {
    const updates = c.req.valid("json");
    const sandbox = getSandboxManager();
    sandbox.updateConfig(updates);
    return c.json({ success: true, status: sandbox.getStatus() });
  },
);

// =============================================================================
// Rate Limiting
// =============================================================================

/**
 * Get rate limit configuration
 */
tools.get("/ratelimit/config", (c) => {
  const limiter = getRateLimiter();
  return c.json(limiter.getConfig());
});

/**
 * Update rate limit configuration
 */
tools.put(
  "/ratelimit/config",
  zValidator(
    "json",
    z.object({
      enabled: z.boolean().optional(),
      userLimit: z.number().min(1).optional(),
      userWindowMs: z.number().min(1000).optional(),
      conversationLimit: z.number().min(1).optional(),
      conversationWindowMs: z.number().min(1000).optional(),
      defaultToolLimit: z.number().min(1).optional(),
      defaultToolWindowMs: z.number().min(1000).optional(),
      globalLimit: z.number().min(1).optional(),
      globalWindowMs: z.number().min(1000).optional(),
    }),
  ),
  (c) => {
    const updates = c.req.valid("json");
    const limiter = getRateLimiter();
    limiter.updateConfig(updates);
    return c.json({ success: true, config: limiter.getConfig() });
  },
);

/**
 * Get rate limit status for a context
 */
tools.get("/ratelimit/status", (c) => {
  const query = c.req.query();
  const limiter = getRateLimiter();

  if (!query.conversationId || !query.toolName) {
    return c.json({ error: "conversationId and toolName are required" }, 400);
  }

  const status = limiter.getStatus({
    userId: query.userId,
    conversationId: query.conversationId,
    toolName: query.toolName,
  });

  return c.json(status);
});

/**
 * Set tool-specific rate limit
 */
tools.post(
  "/ratelimit/tool/:toolName",
  zValidator(
    "json",
    z.object({
      limit: z.number().min(1),
      windowMs: z.number().min(1000).optional(),
    }),
  ),
  (c) => {
    const toolName = c.req.param("toolName");
    const { limit, windowMs } = c.req.valid("json");

    const limiter = getRateLimiter();
    limiter.setToolLimit(toolName, limit, windowMs);

    return c.json({ success: true, toolName, limit, windowMs });
  },
);

/**
 * Reset all rate limits (for testing/admin)
 */
tools.post("/ratelimit/reset", (c) => {
  const limiter = getRateLimiter();
  limiter.reset();
  return c.json({ success: true });
});

// =============================================================================
// SSE Streaming
// =============================================================================

// Store SSE connections per session
const sseConnections = new Map<
  string,
  Set<ReadableStreamDefaultController<Uint8Array>>
>();

/**
 * Broadcast event to all SSE connections for a session
 */
function broadcastToSession(sessionId: string, event: string, data: unknown) {
  const connections = sseConnections.get(sessionId);
  if (!connections) return;

  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const encoder = new TextEncoder();
  const encoded = encoder.encode(message);

  for (const controller of connections) {
    try {
      controller.enqueue(encoded);
    } catch {
      // Connection closed, remove it
      connections.delete(controller);
    }
  }

  // Clean up empty sets
  if (connections.size === 0) {
    sseConnections.delete(sessionId);
  }
}

/**
 * SSE stream for tool execution output
 * Subscribe to real-time output from a running tool session
 */
tools.get("/sessions/:sessionId/stream", (c) => {
  const sessionId = c.req.param("sessionId");
  const sessionManager = getSessionManager();
  const session = sessionManager.get(sessionId);

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const redactStreamOutput = (text: string): string => {
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

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;

      // Add to session connections
      if (!sseConnections.has(sessionId)) {
        sseConnections.set(sessionId, new Set());
      }
      sseConnections.get(sessionId)!.add(controller);

      // Send initial session state
      const initEvent = `event: init\ndata: ${JSON.stringify({
        sessionId: session.id,
        toolName: session.toolName,
        status: session.status,
        command: session.command,
        createdAt: session.createdAt,
        startedAt: session.startedAt,
      })}\n\n`;
      controller.enqueue(encoder.encode(initEvent));

      // Send existing output if any
      if (session.stdout) {
        const outputEvent = `event: stdout\ndata: ${JSON.stringify({ content: redactStreamOutput(session.stdout) })}\n\n`;
        controller.enqueue(encoder.encode(outputEvent));
      }
      if (session.stderr) {
        const stderrEvent = `event: stderr\ndata: ${JSON.stringify({ content: redactStreamOutput(session.stderr) })}\n\n`;
        controller.enqueue(encoder.encode(stderrEvent));
      }

      // If already completed, send completion event
      if (
        session.status === "completed" ||
        session.status === "failed" ||
        session.status === "killed"
      ) {
        const doneEvent = `event: done\ndata: ${JSON.stringify({
          status: session.status,
          exitCode: session.exitCode,
          exitSignal: session.exitSignal,
          completedAt: session.completedAt,
        })}\n\n`;
        controller.enqueue(encoder.encode(doneEvent));
      }
    },
    cancel() {
      // Remove from session connections
      const connections = sseConnections.get(sessionId);
      if (connections) {
        connections.delete(controller);
        if (connections.size === 0) {
          sseConnections.delete(sessionId);
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

/**
 * Execute a tool with SSE streaming output
 * Returns a stream of execution events
 */
tools.post(
  "/execute/stream",
  zValidator("json", ExecuteToolSchema),
  async (c) => {
    const { toolCall, conversationId, workdir } = c.req.valid("json");

    logger.info(`[ToolRoutes] Execute tool (streaming): ${toolCall.name}`, {
      component: "ToolRoutes",
    });

    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array>;
    let sessionId: string | undefined;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        streamController = controller;

        try {
          const executor = getToolExecutor();

          // Send start event
          const startEvent = `event: start\ndata: ${JSON.stringify({
            toolName: toolCall.name,
            timestamp: Date.now(),
          })}\n\n`;
          controller.enqueue(encoder.encode(startEvent));

          // Execute with progress callback
          const result = await executor.execute(toolCall, {
            conversationId,
            workdir: workdir ?? process.cwd(),
            env: {},
            onProgress: (update) => {
              // Stream progress updates
              const progressEvent = `event: progress\ndata: ${JSON.stringify(update)}\n\n`;
              try {
                controller.enqueue(encoder.encode(progressEvent));
              } catch {
                // Stream closed
              }
            },
          });

          // Track session ID if available
          if (result.result.sessionId) {
            sessionId = result.result.sessionId;
          }

          // If approval required, send approval event
          if (result.approvalRequired && result.approvalId) {
            const pendingApprovals =
              executor.getPendingApprovals(conversationId);
            const approval = pendingApprovals.find(
              (a) => a.id === result.approvalId,
            );

            const approvalEvent = `event: approval-required\ndata: ${JSON.stringify(
              {
                approvalId: result.approvalId,
                approval: approval
                  ? {
                      id: approval.id,
                      toolName: approval.toolName,
                      command: approval.command,
                      params: approval.params,
                      securityLevel: approval.securityLevel,
                      expiresAt: approval.expiresAt,
                    }
                  : null,
              },
            )}\n\n`;
            controller.enqueue(encoder.encode(approvalEvent));
          } else {
            // Send result
            const resultEvent = `event: result\ndata: ${JSON.stringify({
              success: result.result.success,
              output: result.result.output,
              data: result.result.data,
              error: result.result.error,
              durationMs: result.result.durationMs,
              sessionId: result.result.sessionId,
              isBackgrounded: result.result.isBackgrounded,
            })}\n\n`;
            controller.enqueue(encoder.encode(resultEvent));
          }

          // Send done event
          const doneEvent = `event: done\ndata: ${JSON.stringify({
            toolCallId: result.toolCallId,
            success: result.result.success,
            timestamp: Date.now(),
          })}\n\n`;
          controller.enqueue(encoder.encode(doneEvent));
        } catch (error) {
          logger.error(
            `[ToolRoutes] Stream execute failed`,
            error instanceof Error ? error : undefined,
          );

          const errorEvent = `event: error\ndata: ${JSON.stringify({
            error: error instanceof Error ? error.message : "Unknown error",
            timestamp: Date.now(),
          })}\n\n`;
          controller.enqueue(encoder.encode(errorEvent));
        } finally {
          controller.close();
        }
      },
      cancel() {
        // Cleanup if needed
        if (sessionId) {
          const connections = sseConnections.get(sessionId);
          if (connections) {
            connections.delete(streamController);
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  },
);

// Export the broadcast function for use by session manager
export { broadcastToSession };

export default tools;
