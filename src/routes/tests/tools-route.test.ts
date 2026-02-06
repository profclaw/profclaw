import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockInitializeToolExecution,
  mockList,
} = vi.hoisted(() => ({
  mockInitializeToolExecution: vi.fn(() => Promise.resolve()),
  mockList: vi.fn(() => []),
}));

vi.mock('../../chat/execution/index.js', () => ({
  getToolExecutor: vi.fn(() => ({
    getPendingApprovals: vi.fn(() => []),
  })),
  getToolRegistry: vi.fn(() => ({
    list: mockList,
    getForAI: vi.fn(() => []),
    getDescriptions: vi.fn(() => []),
  })),
  getSecurityManager: vi.fn(() => ({
    getPolicy: vi.fn(() => ({ mode: 'ask', allowlist: [] })),
  })),
  getSessionManager: vi.fn(() => ({
    list: vi.fn(() => []),
  })),
  initializeToolExecution: mockInitializeToolExecution,
  getAuditLogger: vi.fn(() => ({
    query: vi.fn(() => []),
    count: 0,
  })),
  getProcessPool: vi.fn(() => ({
    getStatus: vi.fn(() => ({ config: {} })),
    getMetrics: vi.fn(() => ({})),
  })),
  getSandboxManager: vi.fn(() => ({
    getStatus: vi.fn(() => ({})),
  })),
  getRateLimiter: vi.fn(() => ({
    getConfig: vi.fn(() => ({})),
    getStatus: vi.fn(() => ({})),
  })),
}));

vi.mock('../../chat/execution/secrets.js', () => ({
  hasSecrets: vi.fn(() => false),
  isSecretsDetectionEnabled: vi.fn(() => false),
  redactSecrets: vi.fn((value) => value),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

import { Hono } from 'hono';
import toolsRoutes from '../tools.js';

function makeApp() {
  const app = new Hono();
  app.route('/api/tools', toolsRoutes);
  return app;
}

describe('tools route lazy initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not initialize tool execution on import', () => {
    expect(mockInitializeToolExecution).not.toHaveBeenCalled();
  });

  it('initializes tool execution once on first request', async () => {
    const app = makeApp();

    const first = await app.fetch(new Request('http://localhost/api/tools/list'));
    const second = await app.fetch(new Request('http://localhost/api/tools/list'));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mockInitializeToolExecution).toHaveBeenCalledTimes(1);
    expect(mockList).toHaveBeenCalledTimes(2);
  });
});
