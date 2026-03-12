/**
 * ToolExecutor Tests
 *
 * Tests for the main tool execution engine in src/chat/execution/executor.ts.
 * Covers: tool lookup, rate limiting, param validation, security checks,
 * approval flow, sandbox execution, timeout/error handling, and the singleton helpers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Mock all external dependencies before importing the module under test
// ---------------------------------------------------------------------------

vi.mock("../registry.js", () => ({
  getToolRegistry: vi.fn(),
}));

vi.mock("../security.js", () => ({
  getSecurityManager: vi.fn(),
}));

vi.mock("../session-manager.js", () => ({
  getSessionManager: vi.fn(),
}));

vi.mock("../sandbox.js", () => ({
  getSandboxManager: vi.fn(),
}));

vi.mock("../process-pool.js", () => ({
  getProcessPool: vi.fn(),
  PoolFullError: class PoolFullError extends Error {
    constructor(msg?: string) {
      super(msg ?? "Pool is full");
      this.name = "PoolFullError";
    }
  },
  TimeoutError: class TimeoutError extends Error {
    constructor(msg?: string) {
      super(msg ?? "Timed out");
      this.name = "TimeoutError";
    }
  },
  QueueTimeoutError: class QueueTimeoutError extends Error {
    constructor(msg?: string) {
      super(msg ?? "Queue timed out");
      this.name = "QueueTimeoutError";
    }
  },
}));

vi.mock("../audit.js", () => ({
  getAuditLogger: vi.fn(),
}));

vi.mock("../rate-limiter.js", () => ({
  getRateLimiter: vi.fn(),
}));

vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../secrets.js", () => ({
  hasSecrets: vi.fn(() => false),
  isSecretsDetectionEnabled: vi.fn(() => false),
  redactSecrets: vi.fn((t: string) => t),
}));

// ---------------------------------------------------------------------------
// Imports after mocks are registered
// ---------------------------------------------------------------------------

import {
  ToolExecutor,
  getToolExecutor,
  initToolExecutor,
} from "../executor.js";

import { getToolRegistry } from "../registry.js";
import { getSecurityManager } from "../security.js";
import { getSessionManager } from "../session-manager.js";
import { getSandboxManager } from "../sandbox.js";
import {
  getProcessPool,
  PoolFullError,
  TimeoutError,
  QueueTimeoutError,
} from "../process-pool.js";
import { getAuditLogger } from "../audit.js";
import { getRateLimiter } from "../rate-limiter.js";
import { logger } from "../../../utils/logger.js";
import { hasSecrets, isSecretsDetectionEnabled, redactSecrets } from "../secrets.js";

import type {
  AIToolCall,
  ToolDefinition,
  ApprovalRequest,
} from "../types.js";

// ---------------------------------------------------------------------------
// Shared test helpers / factories
// ---------------------------------------------------------------------------

/** Build a minimal mock ToolDefinition with a zod schema. */
function makeTool(
  overrides: Partial<ToolDefinition> = {},
): ToolDefinition {
  return {
    name: "test_tool",
    description: "A test tool",
    category: "execution",
    securityLevel: "safe",
    parameters: z.object({ value: z.string() }),
    execute: vi.fn().mockResolvedValue({ success: true, output: "done" }),
    ...overrides,
  } as unknown as ToolDefinition;
}

/** Build a minimal AIToolCall. */
function makeToolCall(overrides: Partial<AIToolCall> = {}): AIToolCall {
  return {
    id: "call-1",
    name: "test_tool",
    arguments: { value: "hello" },
    ...overrides,
  };
}

/** Base execution context (without the fields the executor injects). */
const baseContext = {
  conversationId: "conv-abc",
  userId: "user-xyz",
  workdir: "/tmp",
  env: {},
} as const;

// ---------------------------------------------------------------------------
// Reusable mock factories
// ---------------------------------------------------------------------------

function makeAuditLogger() {
  return {
    logError: vi.fn(),
    logRateLimited: vi.fn(),
    logApprovalRequested: vi.fn(),
    logApprovalDecision: vi.fn(),
    logSecurityDenied: vi.fn(),
    logExecution: vi.fn(),
    logTimeout: vi.fn(),
    getStats: vi.fn().mockReturnValue({}),
  };
}

function makeRateLimiter(allowed = true) {
  return {
    check: vi.fn().mockReturnValue({
      allowed,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
      retryAfter: allowed ? undefined : 30,
      limitType: "user",
    }),
    getConfig: vi.fn().mockReturnValue({}),
  };
}

function makeSecurityManager(
  opts: {
    allowed?: boolean;
    requiresApproval?: boolean;
    sandboxRequired?: boolean;
    pendingApprovals?: ApprovalRequest[];
  } = {},
) {
  const {
    allowed = true,
    requiresApproval = false,
    sandboxRequired = false,
    pendingApprovals = [],
  } = opts;

  return {
    checkPermission: vi.fn().mockResolvedValue({
      allowed,
      requiresApproval,
      sandboxRequired,
      securityLevel: "moderate",
      reason: allowed ? undefined : "Denied by policy",
    }),
    getPolicy: vi.fn().mockReturnValue({ mode: "allowlist" }),
    createApprovalRequest: vi.fn().mockReturnValue({
      id: "approval-1",
      toolCallId: "call-1",
      toolName: "test_tool",
      conversationId: baseContext.conversationId,
      params: {},
      securityLevel: "moderate",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      status: "pending",
    } satisfies ApprovalRequest),
    getPendingApprovals: vi.fn().mockReturnValue(pendingApprovals),
    handleApprovalResponse: vi.fn(),
  };
}

function makeProcessPool(result: object = { success: true, output: "done" }) {
  return {
    submit: vi.fn().mockImplementation(
      async (_id: string, _name: string, _convId: string, fn: () => Promise<unknown>) =>
        fn(),
    ),
    cancel: vi.fn().mockReturnValue(false),
    getStatus: vi.fn().mockReturnValue({ active: 0, queued: 0 }),
  };
}

function makeSandboxManager(available = true) {
  return {
    isAvailable: vi.fn().mockReturnValue(available),
    execute: vi.fn().mockResolvedValue({
      success: true,
      stdout: "sandbox output",
      stderr: "",
      exitCode: 0,
      containerId: "container-1",
    }),
    getStatus: vi.fn().mockReturnValue({ available }),
  };
}

function makeSessionManager() {
  return {
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    kill: vi.fn(),
    cleanup: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Wire up mocks before each test
// ---------------------------------------------------------------------------

let auditLogger: ReturnType<typeof makeAuditLogger>;
let rateLimiter: ReturnType<typeof makeRateLimiter>;
let securityManager: ReturnType<typeof makeSecurityManager>;
let processPool: ReturnType<typeof makeProcessPool>;
let sandboxManager: ReturnType<typeof makeSandboxManager>;
let sessionManager: ReturnType<typeof makeSessionManager>;
let toolRegistry: { get: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> };

function wireDefaults(
  opts: Parameters<typeof makeSecurityManager>[0] = {},
  tool?: ToolDefinition,
) {
  auditLogger = makeAuditLogger();
  rateLimiter = makeRateLimiter();
  securityManager = makeSecurityManager(opts);
  processPool = makeProcessPool();
  sandboxManager = makeSandboxManager();
  sessionManager = makeSessionManager();
  toolRegistry = {
    get: vi.fn().mockReturnValue(tool ?? makeTool()),
    list: vi.fn().mockReturnValue([]),
  };

  vi.mocked(getAuditLogger).mockReturnValue(auditLogger as ReturnType<typeof getAuditLogger>);
  vi.mocked(getRateLimiter).mockReturnValue(rateLimiter as ReturnType<typeof getRateLimiter>);
  vi.mocked(getSecurityManager).mockReturnValue(securityManager as ReturnType<typeof getSecurityManager>);
  vi.mocked(getProcessPool).mockReturnValue(processPool as ReturnType<typeof getProcessPool>);
  vi.mocked(getSandboxManager).mockReturnValue(sandboxManager as ReturnType<typeof getSandboxManager>);
  vi.mocked(getSessionManager).mockReturnValue(sessionManager as ReturnType<typeof getSessionManager>);
  vi.mocked(getToolRegistry).mockReturnValue(toolRegistry as ReturnType<typeof getToolRegistry>);
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe("ToolExecutor", () => {
  let executor: ToolExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSecretsDetectionEnabled).mockReturnValue(false);
    vi.mocked(hasSecrets).mockReturnValue(false);
    vi.mocked(redactSecrets).mockImplementation((text: string) => text);
    wireDefaults();
    executor = new ToolExecutor();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Tool not found
  // -------------------------------------------------------------------------

  describe("execute – tool not found", () => {
    it("returns TOOL_NOT_FOUND error when registry returns undefined", async () => {
      toolRegistry.get.mockReturnValue(undefined);

      const result = await executor.execute(makeToolCall({ name: "missing_tool" }), baseContext);

      expect(result.result.success).toBe(false);
      expect(result.result.error?.code).toBe("TOOL_NOT_FOUND");
      expect(result.toolName).toBe("missing_tool");
      expect(auditLogger.logError).toHaveBeenCalledWith(
        expect.objectContaining({ toolName: "missing_tool" }),
      );
    });

    it("sets toolCallId from the AIToolCall.id when provided", async () => {
      toolRegistry.get.mockReturnValue(undefined);

      const result = await executor.execute(
        makeToolCall({ id: "explicit-id", name: "nope" }),
        baseContext,
      );

      expect(result.toolCallId).toBe("explicit-id");
    });

    it("generates a UUID toolCallId when AIToolCall.id is absent", async () => {
      toolRegistry.get.mockReturnValue(undefined);

      const result = await executor.execute(
        makeToolCall({ id: undefined, name: "nope" }),
        baseContext,
      );

      expect(result.toolCallId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------

  describe("execute – rate limiting", () => {
    it("returns RATE_LIMITED error when rate limiter denies", async () => {
      vi.mocked(getRateLimiter).mockReturnValue(
        makeRateLimiter(false) as ReturnType<typeof getRateLimiter>,
      );

      const result = await executor.execute(makeToolCall(), baseContext);

      expect(result.result.success).toBe(false);
      expect(result.result.error?.code).toBe("RATE_LIMITED");
      expect(result.result.error?.message).toContain("30 seconds");
      expect(auditLogger.logRateLimited).toHaveBeenCalled();
    });

    it("includes rate-limit details in the error", async () => {
      vi.mocked(getRateLimiter).mockReturnValue(
        makeRateLimiter(false) as ReturnType<typeof getRateLimiter>,
      );

      const result = await executor.execute(makeToolCall(), baseContext);

      const details = result.result.error?.details as Record<string, unknown>;
      expect(details).toBeDefined();
      expect(details.retryAfter).toBe(30);
    });
  });

  // -------------------------------------------------------------------------
  // Parameter validation
  // -------------------------------------------------------------------------

  describe("execute – parameter validation", () => {
    it("returns MISSING_PARAMS when a required field is absent", async () => {
      const tool = makeTool({
        parameters: z.object({ required_field: z.string() }),
      });
      toolRegistry.get.mockReturnValue(tool);

      const result = await executor.execute(
        makeToolCall({ arguments: {} }),
        baseContext,
      );

      expect(result.result.success).toBe(false);
      expect(result.result.error?.code).toBe("MISSING_PARAMS");
      expect(result.result.error?.message).toContain("required_field");
      expect(auditLogger.logError).toHaveBeenCalled();
    });

    it("returns INVALID_PARAMS when a field has the wrong type", async () => {
      const tool = makeTool({
        parameters: z.object({ count: z.number() }),
      });
      toolRegistry.get.mockReturnValue(tool);

      const result = await executor.execute(
        makeToolCall({ arguments: { count: "not-a-number" } }),
        baseContext,
      );

      expect(result.result.success).toBe(false);
      expect(result.result.error?.code).toBe("INVALID_PARAMS");
    });

    it("pluralises 'parameters' in the error message when multiple fields are missing", async () => {
      const tool = makeTool({
        parameters: z.object({ a: z.string(), b: z.string() }),
      });
      toolRegistry.get.mockReturnValue(tool);

      const result = await executor.execute(
        makeToolCall({ arguments: {} }),
        baseContext,
      );

      expect(result.result.error?.message).toContain("parameters");
    });
  });

  // -------------------------------------------------------------------------
  // Security checks
  // -------------------------------------------------------------------------

  describe("execute – security checks", () => {
    it("returns APPROVAL_REQUIRED when security requires approval", async () => {
      wireDefaults({ allowed: false, requiresApproval: true });

      const result = await executor.execute(makeToolCall(), baseContext);

      expect(result.result.success).toBe(false);
      expect(result.result.error?.code).toBe("APPROVAL_REQUIRED");
      expect(result.approvalRequired).toBe(true);
      expect(result.approvalId).toBe("approval-1");
      expect(auditLogger.logApprovalRequested).toHaveBeenCalledWith(
        expect.objectContaining({ approvalId: "approval-1" }),
      );
    });

    it("returns DENIED when security blocks without approval", async () => {
      wireDefaults({ allowed: false, requiresApproval: false });

      const result = await executor.execute(makeToolCall(), baseContext);

      expect(result.result.success).toBe(false);
      expect(result.result.error?.code).toBe("DENIED");
      expect(auditLogger.logSecurityDenied).toHaveBeenCalled();
    });

    it("includes the security denial reason from the check result", async () => {
      wireDefaults({ allowed: false, requiresApproval: false });

      const result = await executor.execute(makeToolCall(), baseContext);

      expect(result.result.error?.message).toBe("Denied by policy");
    });
  });

  // -------------------------------------------------------------------------
  // Successful execution
  // -------------------------------------------------------------------------

  describe("execute – successful execution", () => {
    it("returns success result and logs execution", async () => {
      const result = await executor.execute(makeToolCall(), baseContext);

      expect(result.result.success).toBe(true);
      expect(result.result.output).toBe("done");
      expect(auditLogger.logExecution).toHaveBeenCalledWith(
        expect.objectContaining({ success: true }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("test_tool"),
        expect.any(Object),
      );
    });

    it("attaches durationMs to the result", async () => {
      const result = await executor.execute(makeToolCall(), baseContext);

      expect(typeof result.result.durationMs).toBe("number");
      expect(result.result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("attaches rateLimitInfo with decremented remaining", async () => {
      const result = await executor.execute(makeToolCall(), baseContext);

      // rateLimiter returns remaining=99, executor decrements by 1
      expect(result.rateLimitInfo?.remaining).toBe(98);
    });

    it("submits to process pool with correct toolCallId, name, and conversationId", async () => {
      await executor.execute(makeToolCall({ id: "tc-42" }), baseContext);

      expect(processPool.submit).toHaveBeenCalledWith(
        "tc-42",
        "test_tool",
        "conv-abc",
        expect.any(Function),
        expect.any(Object),
      );
    });

    it("redacts secrets in output when secrets are detected", async () => {
      vi.mocked(isSecretsDetectionEnabled).mockReturnValue(true);
      vi.mocked(hasSecrets).mockReturnValue(true);
      vi.mocked(redactSecrets).mockReturnValue("[REDACTED]");

      const tool = makeTool({
        execute: vi.fn().mockResolvedValue({
          success: true,
          output: "sk-secret-token-12345",
        }),
      });
      toolRegistry.get.mockReturnValue(tool);

      const result = await executor.execute(makeToolCall(), baseContext);

      expect(result.result.output).toBe("[REDACTED]");
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("execute – error handling", () => {
    it("returns POOL_FULL error when PoolFullError is thrown", async () => {
      processPool.submit.mockRejectedValue(new PoolFullError());

      const result = await executor.execute(makeToolCall(), baseContext);

      expect(result.result.success).toBe(false);
      expect(result.result.error?.code).toBe("POOL_FULL");
      expect(result.result.error?.retryable).toBe(true);
      expect(auditLogger.logError).toHaveBeenCalled();
    });

    it("returns TIMEOUT error when TimeoutError is thrown", async () => {
      processPool.submit.mockRejectedValue(new TimeoutError("timed out after 300000ms"));

      const result = await executor.execute(makeToolCall(), baseContext);

      expect(result.result.success).toBe(false);
      expect(result.result.error?.code).toBe("TIMEOUT");
      expect(result.result.error?.retryable).toBe(true);
      expect(auditLogger.logTimeout).toHaveBeenCalled();
    });

    it("returns TIMEOUT error when QueueTimeoutError is thrown", async () => {
      processPool.submit.mockRejectedValue(new QueueTimeoutError("queue timed out"));

      const result = await executor.execute(makeToolCall(), baseContext);

      expect(result.result.success).toBe(false);
      expect(result.result.error?.code).toBe("TIMEOUT");
      expect(auditLogger.logTimeout).toHaveBeenCalled();
    });

    it("returns EXECUTION_ERROR for generic thrown Error", async () => {
      processPool.submit.mockRejectedValue(new Error("something exploded"));

      const result = await executor.execute(makeToolCall(), baseContext);

      expect(result.result.success).toBe(false);
      expect(result.result.error?.code).toBe("EXECUTION_ERROR");
      expect(result.result.error?.message).toBe("something exploded");
      expect(logger.error).toHaveBeenCalled();
    });

    it("returns EXECUTION_ERROR with 'Unknown error' for non-Error throws", async () => {
      processPool.submit.mockRejectedValue("string error");

      const result = await executor.execute(makeToolCall(), baseContext);

      expect(result.result.error?.code).toBe("EXECUTION_ERROR");
      expect(result.result.error?.message).toBe("Unknown error");
    });

    it("attaches durationMs even when execution fails", async () => {
      processPool.submit.mockRejectedValue(new Error("fail"));

      const result = await executor.execute(makeToolCall(), baseContext);

      expect(typeof result.result.durationMs).toBe("number");
    });
  });

  // -------------------------------------------------------------------------
  // Sandbox execution
  // -------------------------------------------------------------------------

  describe("execute – sandbox execution", () => {
    beforeEach(() => {
      // Security says sandbox is required and mode is sandbox
      wireDefaults({ allowed: true, sandboxRequired: true });
      securityManager.getPolicy.mockReturnValue({ mode: "sandbox" });
    });

    it("uses sandbox for exec tool when sandbox is available", async () => {
      const execTool = makeTool({
        name: "exec",
        parameters: z.object({
          command: z.string(),
          value: z.string(),
        }),
        execute: vi.fn(),
      });
      toolRegistry.get.mockReturnValue(execTool);

      await executor.execute(
        makeToolCall({ name: "exec", arguments: { command: "ls -la", value: "x" } }),
        baseContext,
      );

      expect(sandboxManager.execute).toHaveBeenCalledWith(
        expect.objectContaining({ command: "ls -la" }),
      );
    });

    it("falls back to normal execution when sandbox is unavailable", async () => {
      sandboxManager.isAvailable.mockReturnValue(false);

      const tool = makeTool({ name: "exec" });
      tool.execute = vi.fn().mockResolvedValue({ success: true, output: "fallback" });
      toolRegistry.get.mockReturnValue(tool);

      processPool.submit.mockImplementation(
        async (_id: string, _name: string, _cid: string, fn: () => Promise<unknown>) => fn(),
      );

      await executor.execute(
        makeToolCall({ name: "exec", arguments: { command: "echo hi", value: "x" } }),
        baseContext,
      );

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Sandbox not available"),
        expect.any(Object),
      );
      expect(tool.execute).toHaveBeenCalled();
    });

    it("maps sandbox stdout+stderr into output string", async () => {
      const execTool = makeTool({
        name: "exec",
        parameters: z.object({
          command: z.string(),
          value: z.string(),
        }),
      });
      toolRegistry.get.mockReturnValue(execTool);

      sandboxManager.execute.mockResolvedValue({
        success: true,
        stdout: "hello",
        stderr: "warning",
        exitCode: 0,
        containerId: "ctr-1",
      });

      const result = await executor.execute(
        makeToolCall({ name: "exec", arguments: { command: "cmd", value: "x" } }),
        baseContext,
      );

      expect(result.result.output).toBe("hello\nwarning");
    });

    it("non-exec tools in sandbox mode fall through to normal execution", async () => {
      const normalTool = makeTool({ name: "read_file" });
      normalTool.execute = vi.fn().mockResolvedValue({ success: true, output: "content" });
      toolRegistry.get.mockReturnValue(normalTool);

      const result = await executor.execute(
        makeToolCall({ name: "read_file", arguments: { value: "x" } }),
        baseContext,
      );

      expect(sandboxManager.execute).not.toHaveBeenCalled();
      expect(result.result.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // executeMany
  // -------------------------------------------------------------------------

  describe("executeMany", () => {
    it("executes all calls sequentially by default", async () => {
      const order: string[] = [];
      processPool.submit.mockImplementation(
        async (id: string, _name: string, _cid: string, fn: () => Promise<unknown>) => {
          order.push(id);
          return fn();
        },
      );

      const calls = [
        makeToolCall({ id: "a" }),
        makeToolCall({ id: "b" }),
        makeToolCall({ id: "c" }),
      ];

      const results = await executor.executeMany(calls, baseContext);

      expect(results).toHaveLength(3);
      expect(order).toEqual(["a", "b", "c"]);
    });

    it("executes all calls in parallel when parallel=true", async () => {
      const calls = [
        makeToolCall({ id: "x" }),
        makeToolCall({ id: "y" }),
      ];

      const results = await executor.executeMany(calls, baseContext, { parallel: true });

      expect(results).toHaveLength(2);
      expect(processPool.submit).toHaveBeenCalledTimes(2);
    });

    it("returns empty array for empty input", async () => {
      const results = await executor.executeMany([], baseContext);
      expect(results).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // executeAfterApproval
  // -------------------------------------------------------------------------

  describe("executeAfterApproval", () => {
    const pendingApproval: ApprovalRequest = {
      id: "approval-99",
      toolCallId: "tc-99",
      toolName: "test_tool",
      conversationId: "conv-abc",
      params: { value: "approved-value" },
      securityLevel: "moderate",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      status: "pending",
    };

    beforeEach(() => {
      wireDefaults({ pendingApprovals: [pendingApproval] });
    });

    it("returns null when approval ID is not found", async () => {
      const result = await executor.executeAfterApproval(
        "non-existent",
        "allow-once",
        baseContext,
      );

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("non-existent"),
        expect.any(Object),
      );
    });

    it("returns USER_DENIED result when decision is deny", async () => {
      const result = await executor.executeAfterApproval(
        "approval-99",
        "deny",
        baseContext,
      );

      expect(result?.result.success).toBe(false);
      expect(result?.result.error?.code).toBe("USER_DENIED");
      expect(auditLogger.logApprovalDecision).toHaveBeenCalledWith(
        expect.objectContaining({ decision: "deny", approvalId: "approval-99" }),
      );
    });

    it("executes the tool when decision is allow-once", async () => {
      const result = await executor.executeAfterApproval(
        "approval-99",
        "allow-once",
        baseContext,
      );

      expect(result?.result.success).toBe(true);
      expect(processPool.submit).toHaveBeenCalled();
      expect(auditLogger.logExecution).toHaveBeenCalledWith(
        expect.objectContaining({ success: true }),
      );
    });

    it("returns TOOL_NOT_FOUND if the tool disappears after approval", async () => {
      toolRegistry.get.mockReturnValue(undefined);

      const result = await executor.executeAfterApproval(
        "approval-99",
        "allow-once",
        baseContext,
      );

      expect(result?.result.error?.code).toBe("TOOL_NOT_FOUND");
    });

    it("handles execution errors after approval gracefully", async () => {
      processPool.submit.mockRejectedValue(new Error("post-approval failure"));

      const result = await executor.executeAfterApproval(
        "approval-99",
        "allow-once",
        baseContext,
      );

      expect(result?.result.success).toBe(false);
      expect(result?.result.error?.code).toBe("EXECUTION_ERROR");
      expect(result?.result.error?.message).toBe("post-approval failure");
    });
  });

  // -------------------------------------------------------------------------
  // abort
  // -------------------------------------------------------------------------

  describe("abort", () => {
    it("returns false when toolCallId is not active", () => {
      processPool.cancel.mockReturnValue(false);
      expect(executor.abort("unknown-id")).toBe(false);
    });

    it("delegates to process pool cancel when no local AbortController exists", () => {
      processPool.cancel.mockReturnValue(true);
      expect(executor.abort("pool-id")).toBe(true);
      expect(processPool.cancel).toHaveBeenCalledWith("pool-id");
    });
  });

  // -------------------------------------------------------------------------
  // getPendingApprovals
  // -------------------------------------------------------------------------

  describe("getPendingApprovals", () => {
    it("returns pending approvals from the security manager", () => {
      const approvals: ApprovalRequest[] = [
        {
          id: "a1",
          toolCallId: "tc-1",
          toolName: "tool",
          conversationId: "conv-1",
          params: {},
          securityLevel: "moderate",
          createdAt: Date.now(),
          expiresAt: Date.now() + 60_000,
          status: "pending",
        },
      ];
      securityManager.getPendingApprovals.mockReturnValue(approvals);

      const result = executor.getPendingApprovals("conv-1");

      expect(result).toEqual(approvals);
      expect(securityManager.getPendingApprovals).toHaveBeenCalledWith("conv-1");
    });

    it("returns empty array when there are no pending approvals", () => {
      securityManager.getPendingApprovals.mockReturnValue([]);
      expect(executor.getPendingApprovals()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getStatus
  // -------------------------------------------------------------------------

  describe("getStatus", () => {
    it("returns aggregated status from all sub-systems", () => {
      processPool.getStatus.mockReturnValue({ active: 3, queued: 1 });
      sandboxManager.getStatus.mockReturnValue({ available: true });
      const rateLimiterInst = makeRateLimiter();
      rateLimiterInst.getConfig.mockReturnValue({ maxCalls: 100 });
      vi.mocked(getRateLimiter).mockReturnValue(rateLimiterInst as ReturnType<typeof getRateLimiter>);
      auditLogger.getStats.mockReturnValue({ total: 42 });

      const status = executor.getStatus();

      expect(status.poolStatus).toEqual({ active: 3, queued: 1 });
      expect(status.sandboxStatus).toEqual({ available: true });
      expect(status.rateLimitConfig).toEqual({ maxCalls: 100 });
      expect(status.auditStats).toEqual({ total: 42 });
    });
  });
});

// ---------------------------------------------------------------------------
// Singleton helpers
// ---------------------------------------------------------------------------

describe("getToolExecutor / initToolExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wireDefaults();
  });

  it("getToolExecutor returns the same instance on repeated calls", () => {
    const a = getToolExecutor();
    const b = getToolExecutor();
    expect(a).toBe(b);
  });

  it("initToolExecutor creates a fresh ToolExecutor instance", () => {
    const first = getToolExecutor();
    const fresh = initToolExecutor();
    expect(fresh).not.toBe(first);
    expect(fresh).toBeInstanceOf(ToolExecutor);
  });

  it("after initToolExecutor, getToolExecutor returns the new instance", () => {
    initToolExecutor();
    const a = getToolExecutor();
    const b = getToolExecutor();
    expect(a).toBe(b);
  });
});
