import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const { mockDiscordRouteDeps } = vi.hoisted(() => ({
  mockDiscordRouteDeps: {
    emit: vi.fn(),
    getDefaultAccount: vi.fn(),
    verifyDiscordSignature: vi.fn(),
    isDiscordSenderAllowed: vi.fn(),
    parseCommand: vi.fn(),
    parseAction: vi.fn(),
    buildPingResponse: vi.fn(() => ({ type: 1 })),
    isPingInteraction: vi.fn(),
    buildDeferredResponse: vi.fn(() => ({ type: 5 })),
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

vi.mock('../../chat/providers/registry.js', () => ({
  getChatRegistry: () => ({
    getDefaultAccount: mockDiscordRouteDeps.getDefaultAccount,
    emit: mockDiscordRouteDeps.emit,
  }),
}));

vi.mock('../../chat/providers/discord/index.js', () => ({
  discordProvider: {
    inbound: {
      parseCommand: mockDiscordRouteDeps.parseCommand,
      parseAction: mockDiscordRouteDeps.parseAction,
    },
    outbound: { send: vi.fn() },
    status: {
      isConfigured: vi.fn(() => true),
      checkHealth: vi.fn(),
    },
  },
  verifyDiscordSignature: mockDiscordRouteDeps.verifyDiscordSignature,
  isDiscordSenderAllowed: mockDiscordRouteDeps.isDiscordSenderAllowed,
  setDiscordConfig: vi.fn(),
  clearDiscordConfig: vi.fn(),
  buildPingResponse: mockDiscordRouteDeps.buildPingResponse,
  isPingInteraction: mockDiscordRouteDeps.isPingInteraction,
  buildDeferredResponse: mockDiscordRouteDeps.buildDeferredResponse,
  sendFollowupMessage: vi.fn(),
  registerSlashCommands: vi.fn(),
  InteractionType: {
    PING: 1,
    APPLICATION_COMMAND: 2,
    MESSAGE_COMPONENT: 3,
    APPLICATION_COMMAND_AUTOCOMPLETE: 4,
    MODAL_SUBMIT: 5,
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: mockDiscordRouteDeps.logger,
}));

async function buildApp(): Promise<Hono> {
  const { clearWebhookDedupCache } = await import('../webhook-dedup.js');
  clearWebhookDedupCache();
  const { discordRoutes } = await import('../discord.js');
  const app = new Hono();
  app.route('/api/discord', discordRoutes);
  return app;
}

describe('discordRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscordRouteDeps.getDefaultAccount.mockReturnValue({
      id: 'discord-default',
      provider: 'discord',
      botToken: 'discord-token',
      applicationId: 'app-1',
      publicKey: 'public-key',
      enabled: true,
    });
    mockDiscordRouteDeps.verifyDiscordSignature.mockResolvedValue(true);
    mockDiscordRouteDeps.isDiscordSenderAllowed.mockReturnValue({ allowed: true });
    mockDiscordRouteDeps.isPingInteraction.mockReturnValue(false);
    mockDiscordRouteDeps.parseCommand.mockReturnValue({
      provider: 'discord',
      accountId: 'discord-default',
      command: '/status',
      text: '',
      userId: 'user-1',
      userName: 'Alice',
      channelId: 'channel-1',
      chatType: 'channel',
      raw: {},
    });
    mockDiscordRouteDeps.parseAction.mockReturnValue(null);
  });

  afterEach(async () => {
    const { clearWebhookDedupCache } = await import('../webhook-dedup.js');
    clearWebhookDedupCache();
  });

  it('returns 401 when signature verification fails', async () => {
    mockDiscordRouteDeps.verifyDiscordSignature.mockResolvedValue(false);
    const app = await buildApp();

    const response = await app.fetch(new Request('http://localhost/api/discord/interactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature-Ed25519': 'bad',
        'X-Signature-Timestamp': '123',
      },
      body: JSON.stringify({ id: 'interaction-1', type: 2 }),
    }));

    expect(response.status).toBe(401);
    expect(mockDiscordRouteDeps.emit).not.toHaveBeenCalled();
  });

  it('returns PONG for ping interactions', async () => {
    mockDiscordRouteDeps.isPingInteraction.mockReturnValue(true);
    const app = await buildApp();

    const response = await app.fetch(new Request('http://localhost/api/discord/interactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature-Ed25519': 'sig',
        'X-Signature-Timestamp': '123',
      },
      body: JSON.stringify({ id: 'ping-1', type: 1 }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ type: 1 });
    expect(mockDiscordRouteDeps.emit).not.toHaveBeenCalled();
  });

  it('emits a command once and ignores duplicate interaction deliveries', async () => {
    const app = await buildApp();
    const body = JSON.stringify({
      id: 'interaction-42',
      type: 2,
      channel_id: 'channel-1',
      guild_id: 'guild-1',
      token: 'token',
      version: 1,
      member: {
        roles: [],
        user: {
          id: 'user-1',
          username: 'alice',
          discriminator: '0001',
        },
      },
      data: { name: 'status' },
    });

    const headers = {
      'Content-Type': 'application/json',
      'X-Signature-Ed25519': 'sig',
      'X-Signature-Timestamp': '123',
    };

    const first = await app.fetch(new Request('http://localhost/api/discord/interactions', {
      method: 'POST',
      headers,
      body,
    }));
    const second = await app.fetch(new Request('http://localhost/api/discord/interactions', {
      method: 'POST',
      headers,
      body,
    }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mockDiscordRouteDeps.emit).toHaveBeenCalledTimes(1);
    expect(mockDiscordRouteDeps.buildDeferredResponse).toHaveBeenCalledTimes(2);
  });
});
