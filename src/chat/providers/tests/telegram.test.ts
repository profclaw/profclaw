import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  clearTelegramConfig,
  setTelegramConfig,
  telegramProvider,
  verifyTelegramWebhook,
} from '../telegram/index.js';

describe('Telegram Provider', () => {
  beforeEach(() => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setTelegramConfig({
      id: 'telegram-test',
      provider: 'telegram',
      enabled: true,
      botToken: 'telegram-token',
      webhookSecret: 'telegram-secret',
    });
  });

  afterEach(() => {
    clearTelegramConfig();
    vi.unstubAllGlobals();
  });

  it('verifies webhook secret tokens with timing-safe comparison', () => {
    expect(verifyTelegramWebhook('telegram-secret', 'telegram-secret')).toBe(true);
    expect(verifyTelegramWebhook('telegram-secret', 'wrong-secret')).toBe(false);
  });

  it('chunks long outbound text and replies continuation chunks to the first message', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        json: async () => ({ ok: true, result: { message_id: 101 } }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ ok: true, result: { message_id: 102 } }),
      });

    const result = await telegramProvider.outbound.send({
      provider: 'telegram',
      to: '123456',
      text: 'B'.repeat(5000),
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('101');
    expect(result.raw).toMatchObject({ chunkCount: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstPayload = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as Record<string, unknown>;
    const secondPayload = JSON.parse(fetchMock.mock.calls[1][1]?.body as string) as Record<string, unknown>;

    expect((firstPayload.text as string).length).toBeLessThanOrEqual(4096);
    expect((secondPayload.text as string).length).toBeLessThanOrEqual(4096);
    expect(secondPayload.reply_to_message_id).toBe(101);
  });
});
