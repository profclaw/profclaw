import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const { mockTelegramRouteDeps } = vi.hoisted(() => ({
  mockTelegramRouteDeps: {
    emit: vi.fn(),
    getDefaultAccount: vi.fn(),
    verifyTelegramWebhook: vi.fn(),
    isTelegramSenderAllowed: vi.fn(),
    parseAction: vi.fn(),
    parseCommand: vi.fn(),
    parseMessage: vi.fn(),
    answerTelegramCallbackQuery: vi.fn(),
    setTelegramConfig: vi.fn(),
    clearTelegramConfig: vi.fn(),
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
    getDefaultAccount: mockTelegramRouteDeps.getDefaultAccount,
    emit: mockTelegramRouteDeps.emit,
  }),
}));

vi.mock('../../chat/providers/telegram/index.js', () => ({
  telegramProvider: {
    inbound: {
      parseAction: mockTelegramRouteDeps.parseAction,
      parseCommand: mockTelegramRouteDeps.parseCommand,
      parseMessage: mockTelegramRouteDeps.parseMessage,
    },
    outbound: { send: vi.fn() },
    status: {
      isConfigured: vi.fn(() => true),
      checkHealth: vi.fn(),
    },
  },
  verifyTelegramWebhook: mockTelegramRouteDeps.verifyTelegramWebhook,
  isTelegramSenderAllowed: mockTelegramRouteDeps.isTelegramSenderAllowed,
  setTelegramWebhook: vi.fn(),
  deleteTelegramWebhook: vi.fn(),
  getTelegramWebhookInfo: vi.fn(),
  answerTelegramCallbackQuery: mockTelegramRouteDeps.answerTelegramCallbackQuery,
  setTelegramConfig: mockTelegramRouteDeps.setTelegramConfig,
  clearTelegramConfig: mockTelegramRouteDeps.clearTelegramConfig,
}));

vi.mock('../../utils/logger.js', () => ({
  logger: mockTelegramRouteDeps.logger,
}));

async function buildApp(): Promise<Hono> {
  const { clearWebhookDedupCache } = await import('../webhook-dedup.js');
  clearWebhookDedupCache();
  const { telegramRoutes } = await import('../telegram.js');
  const app = new Hono();
  app.route('/api/telegram', telegramRoutes);
  return app;
}

describe('telegramRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTelegramRouteDeps.getDefaultAccount.mockReturnValue({
      id: 'telegram-default',
      provider: 'telegram',
      botToken: 'telegram-token',
      webhookSecret: 'telegram-secret',
      enabled: true,
    });
    mockTelegramRouteDeps.verifyTelegramWebhook.mockImplementation(
      (expected: string | undefined, actual: string | undefined) => expected === actual,
    );
    mockTelegramRouteDeps.isTelegramSenderAllowed.mockReturnValue({ allowed: true });
    mockTelegramRouteDeps.parseAction.mockReturnValue(null);
    mockTelegramRouteDeps.parseCommand.mockReturnValue(null);
    mockTelegramRouteDeps.parseMessage.mockReturnValue({
      id: 'message-1',
      provider: 'telegram',
      accountId: 'telegram-default',
      senderId: '123',
      senderName: 'Alice',
      chatType: 'direct',
      chatId: '456',
      text: 'hello',
      timestamp: new Date('2026-03-12T00:00:00Z'),
      rawContent: {},
    });
  });

  afterEach(async () => {
    const { clearWebhookDedupCache } = await import('../webhook-dedup.js');
    clearWebhookDedupCache();
  });

  it('returns 401 when the webhook secret is invalid', async () => {
    const app = await buildApp();

    const response = await app.fetch(new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret',
      },
      body: JSON.stringify({ update_id: 1 }),
    }));

    expect(response.status).toBe(401);
    expect(mockTelegramRouteDeps.emit).not.toHaveBeenCalled();
  });

  it('emits a message once and ignores duplicate update deliveries', async () => {
    const app = await buildApp();
    const body = JSON.stringify({
      update_id: 4242,
      message: {
        message_id: 10,
        from: { id: 123, first_name: 'Alice', is_bot: false },
        chat: { id: 456, type: 'private' },
        date: 1710000000,
        text: 'hello',
      },
    });

    const headers = {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': 'telegram-secret',
    };

    const first = await app.fetch(new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers,
      body,
    }));
    const second = await app.fetch(new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers,
      body,
    }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mockTelegramRouteDeps.emit).toHaveBeenCalledTimes(1);
    expect(mockTelegramRouteDeps.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'message',
      provider: 'telegram',
      accountId: 'telegram-default',
    }));
  });
});
