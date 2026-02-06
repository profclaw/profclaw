import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const { mockSyncRouteDeps } = vi.hoisted(() => ({
  mockSyncRouteDeps: {
    handleSyncWebhook: vi.fn(),
    pushTicketToExternal: vi.fn(),
    getSyncStatus: vi.fn(),
    hasSyncEngine: vi.fn(),
    getSyncEngine: vi.fn(),
    loadSyncConfig: vi.fn(),
    processGitHubWebhookForTicketSync: vi.fn(),
  },
}));

vi.mock('../../sync/integration.js', () => ({
  handleSyncWebhook: mockSyncRouteDeps.handleSyncWebhook,
  pushTicketToExternal: mockSyncRouteDeps.pushTicketToExternal,
  getSyncStatus: mockSyncRouteDeps.getSyncStatus,
}));

vi.mock('../../sync/engine.js', () => ({
  hasSyncEngine: mockSyncRouteDeps.hasSyncEngine,
  getSyncEngine: mockSyncRouteDeps.getSyncEngine,
}));

vi.mock('../../sync/config.js', () => ({
  loadSyncConfig: mockSyncRouteDeps.loadSyncConfig,
}));

vi.mock('../../integrations/github-ticket-sync.js', () => ({
  processGitHubWebhookForTicketSync: mockSyncRouteDeps.processGitHubWebhookForTicketSync,
}));

import syncRoutes from '../sync.js';

function buildApp(): Hono {
  const app = new Hono();
  app.route('/api/sync', syncRoutes);
  return app;
}

function sign(secret: string, body: string, prefix = ''): string {
  return `${prefix}${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('syncRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSyncRouteDeps.loadSyncConfig.mockReturnValue({
      platforms: {
        linear: { enabled: true, webhookSecret: 'linear-secret' },
        github: { enabled: true, webhookSecret: 'github-secret' },
      },
    });
    mockSyncRouteDeps.handleSyncWebhook.mockResolvedValue({
      success: true,
      message: 'processed',
    });
    mockSyncRouteDeps.processGitHubWebhookForTicketSync.mockResolvedValue({
      action: 'ignored',
    });
    mockSyncRouteDeps.getSyncStatus.mockReturnValue({ enabled: true });
    mockSyncRouteDeps.hasSyncEngine.mockReturnValue(false);
    mockSyncRouteDeps.getSyncEngine.mockReturnValue({
      syncPlatform: vi.fn().mockResolvedValue({ synced: 1 }),
      syncAll: vi.fn().mockResolvedValue({ synced: 2 }),
      getPendingConflicts: vi.fn().mockReturnValue([]),
      resolvePendingConflict: vi.fn(),
    });
  });

  it('returns 401 for invalid Linear webhook signatures instead of throwing', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/sync/webhook/linear', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'linear-signature': 'bad',
      },
      body: JSON.stringify({ type: 'Issue' }),
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid signature' });
    expect(mockSyncRouteDeps.handleSyncWebhook).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON on Linear webhook after valid signature', async () => {
    const app = buildApp();
    const body = '{"type":"Issue"';

    const response = await app.fetch(new Request('http://localhost/api/sync/webhook/linear', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'linear-signature': sign('linear-secret', body),
      },
      body,
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON' });
  });

  it('ignores unsupported GitHub event types after valid signature verification', async () => {
    const app = buildApp();
    const body = JSON.stringify({ action: 'opened' });

    const response = await app.fetch(new Request('http://localhost/api/sync/webhook/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': sign('github-secret', body, 'sha256='),
        'x-github-event': 'pull_request',
      },
      body,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ message: 'Ignored event type: pull_request' });
    expect(mockSyncRouteDeps.processGitHubWebhookForTicketSync).not.toHaveBeenCalled();
    expect(mockSyncRouteDeps.handleSyncWebhook).not.toHaveBeenCalled();
  });

  it('returns ticket sync results before falling back to the legacy GitHub sync handler', async () => {
    const app = buildApp();
    const body = JSON.stringify({ action: 'opened' });
    mockSyncRouteDeps.processGitHubWebhookForTicketSync.mockResolvedValue({
      action: 'updated',
      ticketId: 'ticket-1',
      commentId: 'comment-1',
    });

    const response = await app.fetch(new Request('http://localhost/api/sync/webhook/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': sign('github-secret', body, 'sha256='),
        'x-github-event': 'issues',
      },
      body,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: 'Ticket sync: updated',
      ticketId: 'ticket-1',
      commentId: 'comment-1',
    });
    expect(mockSyncRouteDeps.handleSyncWebhook).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON on manual trigger', async () => {
    const app = buildApp();
    mockSyncRouteDeps.hasSyncEngine.mockReturnValue(true);

    const response = await app.fetch(new Request('http://localhost/api/sync/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"platform":"github"',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 when conflict resolution body is not a JSON object', async () => {
    const app = buildApp();
    mockSyncRouteDeps.hasSyncEngine.mockReturnValue(true);

    const response = await app.fetch(new Request('http://localhost/api/sync/conflicts/ticket-1/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(['local']),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Request body must be a JSON object',
    });
  });
});
