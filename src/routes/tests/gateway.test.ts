import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const { mockGatewayDeps } = vi.hoisted(() => ({
  mockGatewayDeps: {
    getGateway: vi.fn(),
    addTask: vi.fn(),
    tokenAuthMiddleware: vi.fn(),
    safeParse: vi.fn(),
  },
}));

vi.mock('../../gateway/index.js', () => ({
  getGateway: mockGatewayDeps.getGateway,
}));

vi.mock('../../queue/index.js', () => ({
  addTask: mockGatewayDeps.addTask,
}));

vi.mock('../../auth/api-tokens.js', () => ({
  tokenAuthMiddleware: vi.fn(() => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  }),
}));

vi.mock('../../types/task.js', () => ({
  CreateTaskSchema: {
    safeParse: mockGatewayDeps.safeParse,
  },
}));

import { gatewayRoutes } from '../gateway.js';

function buildApp(): Hono {
  const app = new Hono();
  app.route('/api/gateway', gatewayRoutes);
  return app;
}

describe('gatewayRoutes', () => {
  const gatewayMock = {
    execute: vi.fn(),
    getStatus: vi.fn(),
    getAgents: vi.fn(),
    getAgentHealth: vi.fn(),
    getWorkflowTemplates: vi.fn(),
    getWorkflow: vi.fn(),
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    gatewayMock.execute.mockResolvedValue({
      success: true,
      result: { output: 'done' },
      agent: 'claude',
      routing: { score: 1 },
      workflow: 'default',
      error: null,
      metrics: { durationMs: 25 },
    });
    gatewayMock.getConfig.mockReturnValue({ maxConcurrent: 5 });
    mockGatewayDeps.getGateway.mockReturnValue(gatewayMock);
    mockGatewayDeps.addTask.mockResolvedValue({
      id: 'task-1',
      title: 'Test task',
      description: 'Run something',
    });
    mockGatewayDeps.safeParse.mockReturnValue({
      success: true,
      data: {
        title: 'Test task',
        description: 'Run something',
      },
    });
  });

  it('returns 400 for malformed JSON on POST /execute', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/gateway/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"task":{"title":"Test task"}',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 when POST /execute body is not a JSON object', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/gateway/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(['bad']),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Request body must be a JSON object',
    });
  });

  it('creates a task and executes it on POST /execute', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/gateway/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: { title: 'Test task', description: 'Run something' },
        autonomous: true,
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      result: { output: 'done' },
    });
    expect(mockGatewayDeps.addTask).toHaveBeenCalledOnce();
    expect(gatewayMock.execute).toHaveBeenCalledOnce();
  });

  it('returns 400 for malformed JSON on POST /execute-secure', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/gateway/execute-secure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"task":{"title":"Test task"}',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 for malformed JSON on PATCH /config', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/gateway/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"maxConcurrent":10',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('updates config on valid PATCH /config', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/gateway/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxConcurrent: 10 }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: 'Gateway config updated',
      config: { maxConcurrent: 5 },
    });
    expect(gatewayMock.updateConfig).toHaveBeenCalledWith({ maxConcurrent: 10 });
  });
});
