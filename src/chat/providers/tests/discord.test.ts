import { generateKeyPairSync, sign } from 'node:crypto';
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
  clearDiscordConfig,
  discordProvider,
  setDiscordConfig,
  verifyDiscordSignature,
} from '../discord/index.js';

describe('Discord Provider', () => {
  beforeEach(() => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setDiscordConfig({
      id: 'discord-test',
      provider: 'discord',
      enabled: true,
      botToken: 'discord-token',
      applicationId: 'app-123',
      publicKey: 'unused-in-send-test',
    });
  });

  afterEach(() => {
    clearDiscordConfig();
    vi.unstubAllGlobals();
  });

  it('verifies a valid Discord Ed25519 signature', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const body = '{"type":1}';
    const timestamp = String(Date.now());
    const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString('hex');
    const jwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;
    const publicKeyHex = Buffer.from(jwk.x || '', 'base64url').toString('hex');

    expect(await verifyDiscordSignature(publicKeyHex, signature, timestamp, body)).toBe(true);
    expect(await verifyDiscordSignature(publicKeyHex, 'deadbeef', timestamp, body)).toBe(false);
  });

  it('chunks long outbound text and replies continuation chunks to the first message', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'msg-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'msg-2' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'msg-3' }),
      });

    const result = await discordProvider.outbound.send({
      provider: 'discord',
      to: 'channel-123',
      text: 'C'.repeat(4500),
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('msg-1');
    expect(result.raw).toMatchObject({ chunkCount: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const firstPayload = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as Record<string, unknown>;
    const secondPayload = JSON.parse(fetchMock.mock.calls[1][1]?.body as string) as Record<string, unknown>;
    const thirdPayload = JSON.parse(fetchMock.mock.calls[2][1]?.body as string) as Record<string, unknown>;

    expect((firstPayload.content as string).length).toBeLessThanOrEqual(2000);
    expect((secondPayload.content as string).length).toBeLessThanOrEqual(2000);
    expect((thirdPayload.content as string).length).toBeLessThanOrEqual(2000);
    expect((secondPayload.message_reference as { message_id: string }).message_id).toBe('msg-1');
    expect((thirdPayload.message_reference as { message_id: string }).message_id).toBe('msg-1');
  });
});
