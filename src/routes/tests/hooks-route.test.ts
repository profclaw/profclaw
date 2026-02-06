import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const { mockHookRouteDeps } = vi.hoisted(() => ({
  mockHookRouteDeps: {
    handlePostToolUse: vi.fn(),
    handleSessionEnd: vi.fn(),
    handlePromptSubmit: vi.fn(),
    handleOpenClawWebhook: vi.fn(),
    handleGenericAgentWebhook: vi.fn(),
    getSessionEvents: vi.fn(),
    getSessionSummary: vi.fn(),
    getRecentSessions: vi.fn(),
    getRecentReports: vi.fn(),
    getTaskReports: vi.fn(),
  },
}));

vi.mock('../../hooks/index.js', () => ({
  handlePostToolUse: mockHookRouteDeps.handlePostToolUse,
  handleSessionEnd: mockHookRouteDeps.handleSessionEnd,
  handlePromptSubmit: mockHookRouteDeps.handlePromptSubmit,
  handleOpenClawWebhook: mockHookRouteDeps.handleOpenClawWebhook,
  handleGenericAgentWebhook: mockHookRouteDeps.handleGenericAgentWebhook,
  getSessionEvents: mockHookRouteDeps.getSessionEvents,
  getSessionSummary: mockHookRouteDeps.getSessionSummary,
  getRecentSessions: mockHookRouteDeps.getRecentSessions,
  getRecentReports: mockHookRouteDeps.getRecentReports,
  getTaskReports: mockHookRouteDeps.getTaskReports,
}));

import { hooksRoutes } from '../hooks.js';

function buildApp(): Hono {
  const app = new Hono();
  app.route('/api/hook', hooksRoutes);
  return app;
}

describe('hooksRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHookRouteDeps.getSessionEvents.mockReturnValue([{ id: 'event-1' }]);
    mockHookRouteDeps.getSessionSummary.mockReturnValue({ total: 1 });
    mockHookRouteDeps.getRecentSessions.mockReturnValue([{ id: 'session-1' }]);
    mockHookRouteDeps.getRecentReports.mockReturnValue([{ id: 'report-1', agent: 'openclaw' }]);
    mockHookRouteDeps.getTaskReports.mockReturnValue([{ id: 'report-2' }]);
  });

  it('returns 400 when /tool-use hook processing fails gracefully', async () => {
    const app = buildApp();
    mockHookRouteDeps.handlePostToolUse.mockResolvedValue({
      success: false,
      error: 'missing payload',
    });

    const response = await app.fetch(new Request('http://localhost/api/hook/tool-use', {
      method: 'POST',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Hook processing failed',
      message: 'missing payload',
    });
  });

  it('maps OpenClaw signature failures to 401', async () => {
    const app = buildApp();
    mockHookRouteDeps.handleOpenClawWebhook.mockRejectedValue(new Error('invalid signature'));

    const response = await app.fetch(new Request('http://localhost/api/hook/webhook/openclaw', {
      method: 'POST',
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Webhook processing failed',
      message: 'invalid signature',
    });
  });

  it('returns generic agent completion payloads', async () => {
    const app = buildApp();
    mockHookRouteDeps.handleGenericAgentWebhook.mockResolvedValue({
      id: 'report-1',
      agent: 'codex',
      status: 'completed',
    });

    const response = await app.fetch(new Request('http://localhost/api/hook/webhook/agent', {
      method: 'POST',
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: 'Agent completion recorded',
      reportId: 'report-1',
      agent: 'codex',
      status: 'completed',
    });
  });

  it('returns session events for a session id', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/hook/sessions/session-1/events'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sessionId: 'session-1',
      events: [{ id: 'event-1' }],
      count: 1,
    });
  });
});
