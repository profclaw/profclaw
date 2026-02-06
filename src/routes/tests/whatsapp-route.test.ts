import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const { mockWhatsAppRouteDeps } = vi.hoisted(() => ({
  mockWhatsAppRouteDeps: {
    emit: vi.fn(),
    getDefaultAccount: vi.fn(),
    verifyWhatsAppWebhook: vi.fn(),
    isWhatsAppSenderAllowed: vi.fn(),
    parseAction: vi.fn(),
    parseMessage: vi.fn((payload: any) => {
      const message = payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      const contact = payload.entry?.[0]?.changes?.[0]?.value?.contacts?.[0];

      if (!message) return null;

      return {
        id: message.id,
        provider: 'whatsapp',
        accountId: 'whatsapp-env',
        senderId: message.from,
        senderName: contact?.profile?.name ?? message.from,
        chatType: 'direct',
        chatId: message.from,
        text: message.text?.body ?? '',
        timestamp: new Date(Number(message.timestamp) * 1000),
        rawContent: payload,
      };
    }),
    setWhatsAppConfig: vi.fn(),
    clearWhatsAppConfig: vi.fn(),
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
    getDefaultAccount: mockWhatsAppRouteDeps.getDefaultAccount,
    emit: mockWhatsAppRouteDeps.emit,
    listAccounts: vi.fn(() => []),
    removeAccount: vi.fn(),
    registerAccount: vi.fn(),
  }),
}));

vi.mock('../../chat/providers/whatsapp/index.js', () => ({
  whatsappProvider: {
    inbound: {
      parseAction: mockWhatsAppRouteDeps.parseAction,
      parseMessage: mockWhatsAppRouteDeps.parseMessage,
    },
    outbound: { send: vi.fn() },
    status: {
      isConfigured: vi.fn(() => true),
      checkHealth: vi.fn(),
    },
  },
  verifyWhatsAppWebhook: mockWhatsAppRouteDeps.verifyWhatsAppWebhook,
  isWhatsAppSenderAllowed: mockWhatsAppRouteDeps.isWhatsAppSenderAllowed,
  setWhatsAppConfig: mockWhatsAppRouteDeps.setWhatsAppConfig,
  clearWhatsAppConfig: mockWhatsAppRouteDeps.clearWhatsAppConfig,
}));

vi.mock('../../utils/logger.js', () => ({
  logger: mockWhatsAppRouteDeps.logger,
}));

async function buildApp(): Promise<Hono> {
  const { clearWebhookDedupCache } = await import('../webhook-dedup.js');
  clearWebhookDedupCache();
  const { whatsappRoutes } = await import('../whatsapp.js');
  const app = new Hono();
  app.route('/api/whatsapp', whatsappRoutes);
  return app;
}

describe('whatsappRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockWhatsAppRouteDeps.getDefaultAccount.mockReturnValue(null);
    mockWhatsAppRouteDeps.verifyWhatsAppWebhook.mockReturnValue(true);
    mockWhatsAppRouteDeps.isWhatsAppSenderAllowed.mockReturnValue({ allowed: true });
    mockWhatsAppRouteDeps.parseAction.mockReturnValue(null);
    process.env.WHATSAPP_ACCESS_TOKEN = 'wa-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
    process.env.WHATSAPP_APP_SECRET = 'wa-secret';
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'wa-verify-token';
  });

  afterEach(async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_APP_SECRET;
    delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    const { clearWebhookDedupCache } = await import('../webhook-dedup.js');
    clearWebhookDedupCache();
  });

  it('returns the verification challenge for valid subscribe requests', async () => {
    const app = await buildApp();

    const response = await app.fetch(new Request(
      'http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wa-verify-token&hub.challenge=challenge-123',
    ));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('challenge-123');
  });

  it('returns 401 when webhook signature verification fails', async () => {
    mockWhatsAppRouteDeps.verifyWhatsAppWebhook.mockReturnValue(false);
    const app = await buildApp();

    const response = await app.fetch(new Request('http://localhost/api/whatsapp/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': 'sha256=bad',
      },
      body: JSON.stringify({ object: 'whatsapp_business_account', entry: [] }),
    }));

    expect(response.status).toBe(401);
    expect(mockWhatsAppRouteDeps.emit).not.toHaveBeenCalled();
  });

  it('emits each inbound message once and ignores duplicate webhook retries', async () => {
    const app = await buildApp();
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'entry-1',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '+15555550123',
              phone_number_id: '1234567890',
            },
            contacts: [
              { wa_id: '15551230001', profile: { name: 'Alice' } },
              { wa_id: '15551230002', profile: { name: 'Bob' } },
            ],
            messages: [
              {
                from: '15551230001',
                id: 'wamid-1',
                timestamp: '1710000000',
                type: 'text',
                text: { body: 'hello' },
              },
              {
                from: '15551230002',
                id: 'wamid-2',
                timestamp: '1710000001',
                type: 'text',
                text: { body: 'second' },
              },
            ],
          },
        }],
      }],
    });

    const headers = {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': 'sha256=valid',
    };

    const first = await app.fetch(new Request('http://localhost/api/whatsapp/webhook', {
      method: 'POST',
      headers,
      body,
    }));
    const second = await app.fetch(new Request('http://localhost/api/whatsapp/webhook', {
      method: 'POST',
      headers,
      body,
    }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mockWhatsAppRouteDeps.emit).toHaveBeenCalledTimes(2);
    expect(mockWhatsAppRouteDeps.emit.mock.calls.map(([event]) => event.payload.id)).toEqual([
      'wamid-1',
      'wamid-2',
    ]);
  });
});
