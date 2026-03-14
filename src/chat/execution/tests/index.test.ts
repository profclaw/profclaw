import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecutionDeps } = vi.hoisted(() => ({
  mockExecutionDeps: {
    initSecurityManager: vi.fn(),
    initSandboxManager: vi.fn(),
    getSandboxManager: vi.fn(),
    initProcessPool: vi.fn(),
    getProcessPool: vi.fn(),
    initAuditLogger: vi.fn(),
    getAuditLogger: vi.fn(),
    initRateLimiter: vi.fn(),
    getRateLimiter: vi.fn(),
    registerBuiltinTools: vi.fn(),
  },
}));

vi.mock('../security.js', () => ({
  initSecurityManager: mockExecutionDeps.initSecurityManager,
  getSecurityManager: vi.fn(),
  SecurityPolicyManager: class {},
}));

vi.mock('../sandbox.js', () => ({
  initSandboxManager: mockExecutionDeps.initSandboxManager,
  getSandboxManager: mockExecutionDeps.getSandboxManager,
  SandboxManager: class {},
}));

vi.mock('../process-pool.js', () => ({
  initProcessPool: mockExecutionDeps.initProcessPool,
  getProcessPool: mockExecutionDeps.getProcessPool,
  ProcessPool: class {},
  PoolFullError: class PoolFullError extends Error {},
  TimeoutError: class TimeoutError extends Error {},
  QueueTimeoutError: class QueueTimeoutError extends Error {},
}));

vi.mock('../audit.js', () => ({
  initAuditLogger: mockExecutionDeps.initAuditLogger,
  getAuditLogger: mockExecutionDeps.getAuditLogger,
  AuditLogger: class {},
}));

vi.mock('../rate-limiter.js', () => ({
  initRateLimiter: mockExecutionDeps.initRateLimiter,
  getRateLimiter: mockExecutionDeps.getRateLimiter,
  RateLimiter: class {},
}));

vi.mock('../tools/index.js', () => ({
  registerBuiltinTools: mockExecutionDeps.registerBuiltinTools,
  builtinTools: [],
  execTool: {},
  webFetchTool: {},
  readFileTool: {},
  writeFileTool: {},
  searchFilesTool: {},
  grepTool: {},
}));

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  createContextualLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('chat execution index', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockExecutionDeps.initSandboxManager.mockResolvedValue({
      isAvailable: () => true,
    });
    mockExecutionDeps.getSandboxManager.mockReturnValue({
      getStatus: () => ({ available: true }),
    });
    mockExecutionDeps.getProcessPool.mockReturnValue({
      getStatus: () => ({ active: 0, queued: 0 }),
    });
    mockExecutionDeps.getRateLimiter.mockReturnValue({
      getConfig: () => ({ userPerMinute: 30 }),
    });
    mockExecutionDeps.getAuditLogger.mockReturnValue({
      getStats: () => ({ totalExecutions: 0 }),
    });
  });

  it('initializes subsystems and registers builtins once', async () => {
    const mod = await import('../index.js');

    await mod.initializeToolExecution({ registerBuiltins: true });
    await mod.initializeToolExecution({ registerBuiltins: true });

    expect(mockExecutionDeps.initAuditLogger).toHaveBeenCalledOnce();
    expect(mockExecutionDeps.initRateLimiter).toHaveBeenCalledOnce();
    expect(mockExecutionDeps.initProcessPool).toHaveBeenCalledOnce();
    expect(mockExecutionDeps.initSecurityManager).toHaveBeenCalledOnce();
    expect(mockExecutionDeps.registerBuiltinTools).toHaveBeenCalledOnce();
    expect(mod.isInitialized()).toBe(true);
  });

  it('returns execution status through imported getters without require()', async () => {
    const mod = await import('../index.js');

    const status = mod.getExecutionStatus();

    expect(status).toEqual({
      initialized: false,
      sandbox: { available: true },
      pool: { active: 0, queued: 0 },
      rateLimit: { userPerMinute: 30 },
      audit: { totalExecutions: 0 },
    });
  });
});
