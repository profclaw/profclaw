import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  gatewayImports: 0,
}));

vi.mock('../../gateway/index.js', () => {
  state.gatewayImports += 1;
  return {
    getGateway: vi.fn(() => ({
      getWorkflowTemplates: vi.fn(() => []),
      execute: vi.fn(),
      getStatus: vi.fn(),
      getAgents: vi.fn(() => []),
      getAgentHealth: vi.fn(),
      getWorkflow: vi.fn(),
      getConfig: vi.fn(() => ({})),
      updateConfig: vi.fn(),
    })),
  };
});

import { Hono } from 'hono';
import { gatewayRoutes } from '../gateway.js';

function makeApp() {
  const app = new Hono();
  app.route('/api/gateway', gatewayRoutes);
  return app;
}

describe('gateway route lazy runtime loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.gatewayImports = 0;
  });

  it('does not load gateway runtime on import', () => {
    expect(state.gatewayImports).toBe(0);
  });

  it('loads gateway runtime once on first request', async () => {
    const app = makeApp();

    const first = await app.fetch(new Request('http://localhost/api/gateway/workflows'));
    const second = await app.fetch(new Request('http://localhost/api/gateway/workflows'));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(state.gatewayImports).toBe(1);
  });
});
