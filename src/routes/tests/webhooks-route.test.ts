import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const { mockWebhookRouteDeps } = vi.hoisted(() => ({
  mockWebhookRouteDeps: {
    handleGitHubWebhook: vi.fn(),
    handleJiraWebhook: vi.fn(),
    handleLinearWebhook: vi.fn(),
    addTask: vi.fn(),
  },
}));

vi.mock('../../integrations/github.js', () => ({
  handleGitHubWebhook: mockWebhookRouteDeps.handleGitHubWebhook,
}));

vi.mock('../../integrations/jira.js', () => ({
  handleJiraWebhook: mockWebhookRouteDeps.handleJiraWebhook,
}));

vi.mock('../../integrations/linear.js', () => ({
  handleLinearWebhook: mockWebhookRouteDeps.handleLinearWebhook,
}));

vi.mock('../../queue/index.js', () => ({
  addTask: mockWebhookRouteDeps.addTask,
}));

import { webhooksRoutes } from '../webhooks.js';

function buildApp(): Hono {
  const app = new Hono();
  app.route('/webhooks', webhooksRoutes);
  return app;
}

describe('webhooksRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWebhookRouteDeps.addTask.mockResolvedValue({ id: 'task-1' });
  });

  it('returns a no-op response when GitHub webhook creates no task', async () => {
    const app = buildApp();
    mockWebhookRouteDeps.handleGitHubWebhook.mockResolvedValue(null);

    const response = await app.fetch(new Request('http://localhost/webhooks/github', {
      method: 'POST',
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: 'Webhook received, no task created',
    });
    expect(mockWebhookRouteDeps.addTask).not.toHaveBeenCalled();
  });

  it('creates a task from a GitHub webhook task input', async () => {
    const app = buildApp();
    mockWebhookRouteDeps.handleGitHubWebhook.mockResolvedValue({
      title: 'Investigate issue',
    });

    const response = await app.fetch(new Request('http://localhost/webhooks/github', {
      method: 'POST',
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: 'Task created from GitHub webhook',
      task: { id: 'task-1' },
    });
    expect(mockWebhookRouteDeps.addTask).toHaveBeenCalledWith({ title: 'Investigate issue' });
  });

  it('maps Jira token failures to 401', async () => {
    const app = buildApp();
    mockWebhookRouteDeps.handleJiraWebhook.mockRejectedValue(new Error('invalid token'));

    const response = await app.fetch(new Request('http://localhost/webhooks/jira', {
      method: 'POST',
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Webhook processing failed',
      message: 'invalid token',
    });
  });

  it('maps Linear signature failures to 401', async () => {
    const app = buildApp();
    mockWebhookRouteDeps.handleLinearWebhook.mockRejectedValue(new Error('bad signature'));

    const response = await app.fetch(new Request('http://localhost/webhooks/linear', {
      method: 'POST',
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Webhook processing failed',
      message: 'bad signature',
    });
  });
});
