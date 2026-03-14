import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Slack Provider', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_SIGNING_SECRET;
  });

  it('verifies a valid Slack webhook signature', async () => {
    process.env.SLACK_SIGNING_SECRET = 'slack-signing-secret';

    const body = 'token=test&team_id=T123&text=hello';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v0=${createHmac('sha256', process.env.SLACK_SIGNING_SECRET)
      .update(`v0:${timestamp}:${body}`)
      .digest('hex')}`;

    const { slackProvider } = await import('../slack/index.js');

    expect(slackProvider.auth?.verifyWebhook(signature, timestamp, body)).toBe(true);
    expect(slackProvider.auth?.verifyWebhook('v0=bad', timestamp, body)).toBe(false);
  });

  it('chunks long outbound text and threads continuation messages', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        json: async () => ({ ok: true, ts: '1710000000.100001' }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ ok: true, ts: '1710000000.100002' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { slackProvider } = await import('../slack/index.js');

    const result = await slackProvider.outbound.send({
      provider: 'slack',
      to: 'C123',
      text: 'A'.repeat(4500),
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('1710000000.100001');
    expect(result.raw).toMatchObject({ chunkCount: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstPayload = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as Record<string, unknown>;
    const secondPayload = JSON.parse(fetchMock.mock.calls[1][1]?.body as string) as Record<string, unknown>;

    expect((firstPayload.text as string).length).toBeLessThanOrEqual(4000);
    expect((secondPayload.text as string).length).toBeLessThanOrEqual(4000);
    expect(secondPayload.thread_ts).toBe('1710000000.100001');
  });
});
