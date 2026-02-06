import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetStatus,
  mockListTools,
  mockConnect,
  mockDisconnect,
  mockAdaptToolsToMCP,
  clientModuleLoads,
  adapterModuleLoads,
} = vi.hoisted(() => ({
  mockGetStatus: vi.fn(() => []),
  mockListTools: vi.fn(() => []),
  mockConnect: vi.fn(() => Promise.resolve()),
  mockDisconnect: vi.fn(() => Promise.resolve()),
  mockAdaptToolsToMCP: vi.fn(() => []),
  clientModuleLoads: { count: 0 },
  adapterModuleLoads: { count: 0 },
}));

vi.mock('../../mcp/client.js', () => {
  clientModuleLoads.count += 1;
  return {
    mcpClientManager: {
      getStatus: mockGetStatus,
      listTools: mockListTools,
      connect: mockConnect,
      disconnect: mockDisconnect,
    },
  };
});

vi.mock('../../mcp/tool-adapter.js', () => {
  adapterModuleLoads.count += 1;
  return {
    adaptToolsToMCP: mockAdaptToolsToMCP,
  };
});

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { Hono } from 'hono';
import { mcpRoutes } from '../mcp.js';

function makeApp() {
  const app = new Hono();
  app.route('/api/mcp', mcpRoutes);
  return app;
}

describe('mcp route lazy runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not load MCP runtime modules on route import', () => {
    expect(clientModuleLoads.count).toBe(0);
    expect(adapterModuleLoads.count).toBe(0);
  });

  it('loads MCP runtime once on first request', async () => {
    const app = makeApp();

    const first = await app.fetch(new Request('http://localhost/api/mcp/status'));
    const second = await app.fetch(new Request('http://localhost/api/mcp/status'));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(clientModuleLoads.count).toBe(1);
    expect(adapterModuleLoads.count).toBe(1);
    expect(mockGetStatus).toHaveBeenCalledTimes(2);
    expect(mockAdaptToolsToMCP).toHaveBeenCalledTimes(2);
  });
});
