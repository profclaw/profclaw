/**
 * WeCom Provider
 *
 * Two modes:
 * - Webhook: POST to webhookUrl with { msgtype: 'text', text: { content } }
 * - API: GET access_token via corpId+secret, POST to message/send
 *
 * Inbound callbacks are XML; callers pre-parse to WeComCallbackPayload.
 * Signature: SHA1(sort([token, timestamp, nonce])).join(''))
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  ChatProvider, WeComAccountConfig, ChatProviderMeta, ChatProviderCapabilities,
  AuthAdapter, OutboundAdapter, InboundAdapter, StatusAdapter,
  SendResult, IncomingMessage, SlashCommand, InteractiveAction, CommandResponse, OutgoingMessage,
} from '../types.js';
import { logger } from '../../../utils/logger.js';

// --- Internal API shapes ---

interface WeComApiSendBody {
  touser?: string;
  agentid: string | number;
  msgtype: 'text';
  text: { content: string };
}
interface WeComTokenResponse { errcode: number; errmsg: string; access_token?: string; }
interface WeComSendResponse { errcode: number; errmsg: string; msgid?: string; }

export interface WeComCallbackPayload {
  MsgType?: string;
  Content?: string;
  FromUserName?: string;
  CreateTime?: string | number;
  AgentID?: string | number;
  MsgId?: string;
}

// --- Config schema ---

export const WeComAccountConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().optional(),
  provider: z.literal('wecom'),
  corpId: z.string().optional(),
  agentId: z.string().optional(),
  secret: z.string().optional(),
  token: z.string().optional(),
  encodingAESKey: z.string().optional(),
  webhookUrl: z.string().url().optional(),
}) satisfies z.ZodType<WeComAccountConfig>;

export type WeComConfig = z.infer<typeof WeComAccountConfigSchema>;

// --- Meta + capabilities ---

const meta: ChatProviderMeta = {
  id: 'wecom',
  name: 'WeCom',
  description: 'WeCom (WeChat Work) messaging via webhook or API mode',
  icon: 'WeCom icon',
  docsUrl: 'https://developer.work.weixin.qq.com/document/path/90236',
  order: 14,
  color: '#07C160',
};

const capabilities: ChatProviderCapabilities = {
  chatTypes: ['direct', 'group'],
  send: true, receive: true, slashCommands: false, interactiveComponents: false,
  reactions: false, edit: false, delete: false, threads: false,
  media: true, richBlocks: false, oauth: false, webhooks: true, realtime: false,
};

// --- Module state ---

let currentConfig: WeComConfig | null = null;
const WECOM_API_BASE = 'https://qyapi.weixin.qq.com/cgi-bin';

// --- Helpers ---

async function getAccessToken(
  c: WeComConfig
): Promise<{ ok: boolean; token?: string; error?: string }> {
  if (!c.corpId || !c.secret) return { ok: false, error: 'corpId and secret required' };
  const url = `${WECOM_API_BASE}/gettoken?corpid=${encodeURIComponent(c.corpId)}&corpsecret=${encodeURIComponent(c.secret)}`;
  try {
    const data = (await (await fetch(url)).json()) as WeComTokenResponse;
    if (data.errcode !== 0 || !data.access_token)
      return { ok: false, error: data.errmsg ?? `WeCom token error ${data.errcode}` };
    return { ok: true, token: data.access_token };
  } catch (error) {
    logger.error('[WeCom] getAccessToken failed:', error instanceof Error ? error : undefined);
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

async function sendViaApi(
  token: string, body: WeComApiSendBody
): Promise<{ ok: boolean; msgId?: string; error?: string }> {
  const url = `${WECOM_API_BASE}/message/send?access_token=${encodeURIComponent(token)}`;
  try {
    const data = (await (await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })).json()) as WeComSendResponse;
    if (data.errcode !== 0) return { ok: false, error: data.errmsg ?? `WeCom send error ${data.errcode}` };
    return { ok: true, msgId: data.msgid };
  } catch (error) {
    logger.error('[WeCom] sendViaApi failed:', error instanceof Error ? error : undefined);
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

async function sendViaWebhook(
  webhookUrl: string, content: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const data = (await (await fetch(webhookUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content } }),
    })).json()) as WeComSendResponse;
    if (data.errcode !== 0) return { ok: false, error: data.errmsg ?? `WeCom webhook error ${data.errcode}` };
    return { ok: true };
  } catch (error) {
    logger.error('[WeCom] sendViaWebhook failed:', error instanceof Error ? error : undefined);
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// --- Auth adapter ---

const authAdapter: AuthAdapter = {
  getAuthUrl(_state: string, _scopes?: string[]): string {
    throw new Error('WeCom does not use OAuth. Use corpId+secret (API mode) or webhookUrl.');
  },
  async exchangeCode(_code: string): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
    throw new Error('WeCom does not use OAuth codes. Use corpId+secret to obtain access_token.');
  },
  // Third param is the nonce (passed as `body` by the AuthAdapter interface convention).
  // WeCom signature = SHA1 of sorted([token, timestamp, nonce]).join('')
  verifyWebhook(signature: string, timestamp: string, nonce: string): boolean {
    const token = currentConfig?.token;
    if (!token) {
      logger.warn('[WeCom] verifyWebhook: token not configured, skipping');
      return false;
    }
    try {
      const expected = createHash('sha1')
        .update([token, timestamp, nonce].sort().join(''))
        .digest('hex');
      return signature === expected;
    } catch (error) {
      logger.error('[WeCom] verifyWebhook failed:', error instanceof Error ? error : undefined);
      return false;
    }
  },
};

// --- Outbound adapter ---

const outboundAdapter: OutboundAdapter = {
  async send(message: OutgoingMessage): Promise<SendResult> {
    const config = currentConfig;
    if (!config) return { success: false, error: 'WeCom provider not configured' };

    const text = message.text ?? '';

    // Webhook mode when no API credentials present
    if (config.webhookUrl && (!config.corpId || !config.secret)) {
      const r = await sendViaWebhook(config.webhookUrl, text);
      return r.ok ? { success: true } : { success: false, error: r.error };
    }

    if (!config.corpId || !config.secret || !config.agentId)
      return { success: false, error: 'corpId, secret, and agentId required for API mode' };

    const tokenResult = await getAccessToken(config);
    if (!tokenResult.ok || !tokenResult.token)
      return { success: false, error: tokenResult.error ?? 'Failed to obtain access_token' };

    const r = await sendViaApi(tokenResult.token, {
      touser: message.to ?? '@all',
      agentid: config.agentId,
      msgtype: 'text',
      text: { content: text },
    });
    return r.ok ? { success: true, messageId: r.msgId } : { success: false, error: r.error ?? 'Send failed' };
  },
};

// --- Inbound adapter ---

const inboundAdapter: InboundAdapter = {
  parseMessage(payload: unknown): IncomingMessage | null {
    if (!payload || typeof payload !== 'object') return null;
    const raw = payload as WeComCallbackPayload;
    if (raw.MsgType !== 'text' || !raw.Content) {
      logger.debug(`[WeCom] parseMessage: unsupported MsgType '${raw.MsgType}', skipping`);
      return null;
    }
    const senderId = raw.FromUserName ?? '';
    const msgId = raw.MsgId ?? String(raw.CreateTime ?? Date.now());
    const ts = raw.CreateTime ? new Date(Number(raw.CreateTime) * 1000) : new Date();
    return {
      id: msgId,
      provider: 'wecom',
      accountId: currentConfig?.id ?? 'default',
      senderId,
      senderName: senderId,
      senderUsername: senderId,
      chatType: 'direct',
      chatId: senderId,
      chatName: undefined,
      threadId: undefined,
      replyToId: undefined,
      text: raw.Content,
      rawContent: raw,
      timestamp: ts,
      attachments: undefined,
    };
  },
  parseCommand(_payload: unknown): SlashCommand | null { return null; },
  parseAction(_payload: unknown): InteractiveAction | null { return null; },
  buildCommandResponse(r: CommandResponse): unknown {
    return { msgtype: 'text', text: { content: r.text ?? '' } };
  },
  buildActionResponse(r: CommandResponse): unknown {
    return { msgtype: 'text', text: { content: r.text ?? '' } };
  },
};

// --- Status adapter ---

const statusAdapter: StatusAdapter = {
  isConfigured(config: WeComAccountConfig): boolean {
    return !!(config.corpId && config.secret && config.agentId) || !!config.webhookUrl;
  },
  async checkHealth(config: WeComAccountConfig): Promise<{
    connected: boolean; latencyMs?: number; error?: string; details?: Record<string, unknown>;
  }> {
    if (config.webhookUrl && (!config.corpId || !config.secret))
      return { connected: true, details: { mode: 'webhook', webhookConfigured: true } };

    if (!config.corpId || !config.secret)
      return { connected: false, error: 'corpId and secret are required' };

    const wecomConfig: WeComConfig = {
      id: config.id, name: config.name, enabled: config.enabled ?? true,
      isDefault: config.isDefault, provider: 'wecom',
      corpId: config.corpId, agentId: config.agentId, secret: config.secret,
      token: config.token, encodingAESKey: config.encodingAESKey, webhookUrl: config.webhookUrl,
    };

    const start = Date.now();
    const result = await getAccessToken(wecomConfig);
    const latencyMs = Date.now() - start;

    return result.ok
      ? { connected: true, latencyMs, details: {
          mode: 'api', corpId: config.corpId, agentId: config.agentId,
          callbackConfigured: !!(config.token && config.encodingAESKey),
        }}
      : { connected: false, latencyMs, error: result.error };
  },
};

// --- Config management ---

export function setWeComConfig(config: WeComConfig): void { currentConfig = config; }
export function clearWeComConfig(): void { currentConfig = null; }

// --- Provider export ---

export const wecomProvider: ChatProvider<WeComAccountConfig> = {
  meta,
  capabilities,
  defaultConfig: { provider: 'wecom', enabled: true },
  configSchema: WeComAccountConfigSchema as z.ZodType<WeComAccountConfig>,
  auth: authAdapter,
  outbound: outboundAdapter,
  inbound: inboundAdapter,
  status: statusAdapter,
};
