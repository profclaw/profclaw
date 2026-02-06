import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const { mockSlackRouteDeps } = vi.hoisted(() => ({
  mockSlackRouteDeps: {
    getDb: vi.fn(),
  },
}));

vi.mock('../../storage/index.js', () => ({
  getDb: mockSlackRouteDeps.getDb,
}));

vi.mock('../../storage/schema.js', () => ({
  tickets: {},
  projects: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  desc: vi.fn(),
  and: vi.fn(),
  like: vi.fn(),
}));

async function buildApp(): Promise<Hono> {
  const { clearWebhookDedupCache } = await import('../webhook-dedup.js');
  clearWebhookDedupCache();
  const { slackRoutes } = await import('../slack.js');
  const app = new Hono();
  app.route('/api/slack', slackRoutes);
  return app;
}

function signSlackBody(secret: string, timestamp: string, body: string): string {
  return `v0=${createHmac('sha256', secret)
    .update(`v0:${timestamp}:${body}`)
    .digest('hex')}`;
}

describe('slackRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockSlackRouteDeps.getDb.mockReturnValue(null);
    process.env.SLACK_SIGNING_SECRET = 'slack-secret';
    process.env.SLACK_BOT_TOKEN = 'xoxb-test';
    process.env.SLACK_COMMAND_NAME = 'profclaw';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, ts: '1710000000.123' }),
    }));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    delete process.env.SLACK_SIGNING_SECRET;
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_COMMAND_NAME;
    const { clearWebhookDedupCache } = await import('../webhook-dedup.js');
    clearWebhookDedupCache();
  });

  it('returns 401 for invalid slash command signatures', async () => {
    const app = await buildApp();
    const body = new URLSearchParams({
      command: '/profclaw',
      text: 'help',
      channel_id: 'C123',
      channel_name: 'general',
      user_id: 'U123',
      user_name: 'alice',
      team_id: 'T123',
      team_domain: 'example',
      response_url: 'https://example.com',
      trigger_id: 'trigger-1',
      api_app_id: 'app-1',
      token: 'token',
    }).toString();

    const response = await app.fetch(new Request('http://localhost/api/slack/commands', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-slack-signature': 'v0=bad',
        'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)),
      },
      body,
    }));

    expect(response.status).toBe(401);
  });

  it('returns the URL verification challenge for events', async () => {
    const app = await buildApp();
    const body = JSON.stringify({
      type: 'url_verification',
      challenge: 'challenge-token',
    });
    const timestamp = String(Math.floor(Date.now() / 1000));

    const response = await app.fetch(new Request('http://localhost/api/slack/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signSlackBody('slack-secret', timestamp, body),
      },
      body,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ challenge: 'challenge-token' });
  });

  it('deduplicates repeated slash-command deliveries', async () => {
    const app = await buildApp();
    const body = new URLSearchParams({
      command: '/profclaw',
      text: 'status',
      channel_id: 'C123',
      channel_name: 'general',
      user_id: 'U123',
      user_name: 'alice',
      team_id: 'T123',
      team_domain: 'example',
      response_url: 'https://example.com',
      trigger_id: 'trigger-1',
      api_app_id: 'app-1',
      token: 'token',
    }).toString();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': signSlackBody('slack-secret', timestamp, body),
    };

    const first = await app.fetch(new Request('http://localhost/api/slack/commands', {
      method: 'POST',
      headers,
      body,
    }));
    const second = await app.fetch(new Request('http://localhost/api/slack/commands', {
      method: 'POST',
      headers,
      body,
    }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual(await second.json());
    expect(mockSlackRouteDeps.getDb).toHaveBeenCalledTimes(1);
  });

  it('deduplicates repeated inline-command events', async () => {
    const app = await buildApp();
    const body = JSON.stringify({
      type: 'event_callback',
      event_id: 'Ev123',
      event: {
        type: 'message',
        text: 'show me /status',
        user: 'U123',
        channel: 'C123',
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = {
      'Content-Type': 'application/json',
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': signSlackBody('slack-secret', timestamp, body),
    };

    const first = await app.fetch(new Request('http://localhost/api/slack/events', {
      method: 'POST',
      headers,
      body,
    }));
    const second = await app.fetch(new Request('http://localhost/api/slack/events', {
      method: 'POST',
      headers,
      body,
    }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
