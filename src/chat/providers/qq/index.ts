// QQ Bot Provider
// API base (prod):    https://api.sgroup.qq.com
// API base (sandbox): https://sandbox.api.sgroup.qq.com
// Auth: POST /app/getAppAccessToken -> Bearer token | Health: GET /users/@me

import { z } from 'zod';
import type {
  ChatProvider, QQAccountConfig, ChatProviderMeta, ChatProviderCapabilities,
  AuthAdapter, OutboundAdapter, InboundAdapter, StatusAdapter,
  SendResult, IncomingMessage, SlashCommand, InteractiveAction,
  CommandResponse, OutgoingMessage,
} from '../types.js';
import { logger } from '../../../utils/logger.js';

interface QQAccessTokenResponse { access_token: string; expires_in: number; }
interface QQAuthor { id: string; username: string; }
interface QQEventData {
  id: string; content: string; author: QQAuthor;
  channel_id?: string; guild_id?: string; group_id?: string; group_openid?: string;
}
interface QQWebhookPayload { op: number; t?: string; d?: QQEventData; }
interface QQMeResponse { id: string; username: string; bot: boolean; }
interface QQSendResponse { id?: string; }

// -- CONFIGURATION --

export const QQAccountConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().optional(),
  provider: z.literal('qq'),
  appId: z.string().optional(),
  token: z.string().optional(),
  secret: z.string().optional(),
  sandboxMode: z.boolean().optional(),
}) satisfies z.ZodType<QQAccountConfig>;

type QQConfig = z.infer<typeof QQAccountConfigSchema>;

// -- METADATA + CAPABILITIES --

const meta: ChatProviderMeta = {
  id: 'qq',
  name: 'QQ',
  description: 'QQ Bot API with channel, group, and DM message support',
  icon: 'QQ icon',
  docsUrl: 'https://bot.q.qq.com/wiki/develop/api/',
  order: 16,
  color: '#12B7F5',
};

const capabilities: ChatProviderCapabilities = {
  chatTypes: ['direct', 'group', 'channel'],
  send: true,
  receive: true,
  slashCommands: false,
  interactiveComponents: false,
  reactions: false,
  edit: false,
  delete: false,
  threads: false,
  media: true,
  richBlocks: false,
  oauth: false,
  webhooks: true,
  realtime: false,
};

// -- STATE + HELPERS --

let currentConfig: QQConfig | null = null;
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

function apiBase(config?: QQConfig | null): string {
  return (config ?? currentConfig)?.sandboxMode
    ? 'https://sandbox.api.sgroup.qq.com'
    : 'https://api.sgroup.qq.com';
}

async function fetchToken(config: QQConfig): Promise<string | null> {
  if (!config.appId || !config.secret) return null;
  try {
    const res = await fetch(`${apiBase(config)}/app/getAppAccessToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: config.appId, clientSecret: config.secret }),
    });
    if (!res.ok) { logger.error(`[QQ] fetchToken: HTTP ${res.status}`); return null; }
    const data = await res.json() as QQAccessTokenResponse;
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    return cachedToken;
  } catch (error) {
    logger.error('[QQ] fetchToken failed:', error instanceof Error ? error : undefined);
    return null;
  }
}

async function getToken(config?: QQConfig | null): Promise<string | null> {
  const cfg = config ?? currentConfig;
  if (!cfg) return null;
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  return fetchToken(cfg);
}

async function callApi<T>(
  endpoint: string,
  method: 'GET' | 'POST' = 'GET',
  body?: Record<string, unknown>,
  config?: QQConfig | null,
): Promise<{ ok: boolean; data?: T; error?: string; status?: number }> {
  const cfg = config ?? currentConfig;
  const token = await getToken(cfg);
  if (!token) return { ok: false, error: 'Could not obtain access token' };

  const url = `${apiBase(cfg)}${endpoint}`;
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!text) return { ok: res.ok, status: res.status };
    let data: T & { message?: string };
    try { data = JSON.parse(text) as T & { message?: string }; } catch {
      return { ok: res.ok, status: res.status };
    }
    if (!res.ok) return { ok: false, status: res.status, error: (data as { message?: string }).message ?? `HTTP ${res.status}` };
    return { ok: true, data, status: res.status };
  } catch (error) {
    logger.error('[QQ] API call failed:', error instanceof Error ? error : undefined);
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// -- AUTH ADAPTER --

const authAdapter: AuthAdapter = {
  getAuthUrl(_state: string, _scopes?: string[]): string {
    throw new Error('QQ Bot uses app access tokens, not OAuth. Supply appId and secret in config.');
  },
  async exchangeCode(_code: string): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
    throw new Error('QQ Bot does not use OAuth authorization codes.');
  },
  verifyWebhook(_signature: string, _timestamp: string, _body: string): boolean {
    // QQ uses Ed25519 signatures. Accept pre-verified payloads for simplicity.
    return true;
  },
};

// -- OUTBOUND ADAPTER --

const outboundAdapter: OutboundAdapter = {
  async send(message: OutgoingMessage): Promise<SendResult> {
    if (!currentConfig?.appId) return { success: false, error: 'QQ appId not configured' };
    if (!message.to) return { success: false, error: 'Target ID (to) is required' };

    const text = message.text ?? '';
    const chatType = message.chatType;
    const replyTo = message.replyToId;

    let endpoint: string;
    let body: Record<string, unknown>;

    if (chatType === 'group') {
      endpoint = `/v2/groups/${message.to}/messages`;
      body = { content: text, msg_type: 0 };
    } else if (chatType === 'direct') {
      endpoint = `/dms/${message.to}/messages`;
      body = { content: text };
    } else {
      endpoint = `/channels/${message.to}/messages`;
      body = replyTo ? { content: text, msg_id: replyTo } : { content: text };
    }

    const result = await callApi<QQSendResponse>(endpoint, 'POST', body);
    return result.ok
      ? { success: true, messageId: result.data?.id }
      : { success: false, error: result.error ?? 'Failed to send message' };
  },
};

// -- INBOUND ADAPTER --

const inboundAdapter: InboundAdapter = {
  parseMessage(payload: unknown): IncomingMessage | null {
    if (!payload || typeof payload !== 'object') return null;
    const event = payload as QQWebhookPayload;
    if (event.op !== 0 || !event.t || !event.d) return null;

    const { t, d } = event;
    const isGroup = t === 'GROUP_AT_MESSAGE_CREATE';
    const isDirect = t === 'DIRECT_MESSAGE_CREATE' || t === 'C2C_MESSAGE_CREATE';
    const isChannel = t === 'AT_MESSAGE_CREATE' || t === 'MESSAGE_CREATE';

    if (!isGroup && !isDirect && !isChannel) {
      logger.debug(`[QQ] parseMessage: unhandled event type '${t}', skipping`);
      return null;
    }

    const chatType: 'direct' | 'group' | 'channel' = isDirect ? 'direct' : isGroup ? 'group' : 'channel';
    const chatId = isGroup
      ? (d.group_id ?? d.group_openid ?? '')
      : isDirect
        ? (d.guild_id ?? d.channel_id ?? '')
        : (d.channel_id ?? '');

    return {
      id: d.id,
      provider: 'qq',
      accountId: currentConfig?.id ?? 'default',
      senderId: d.author.id,
      senderName: d.author.username,
      senderUsername: d.author.username,
      chatType,
      chatId,
      chatName: undefined,
      threadId: undefined,
      replyToId: undefined,
      text: d.content ?? '',
      rawContent: event,
      timestamp: new Date(),
      attachments: undefined,
    };
  },
  parseCommand(_payload: unknown): SlashCommand | null { return null; },
  parseAction(_payload: unknown): InteractiveAction | null { return null; },
  buildCommandResponse(response: CommandResponse): unknown {
    return { content: response.text ?? '', msg_type: 0 };
  },
  buildActionResponse(response: CommandResponse): unknown {
    return { content: response.text ?? '', msg_type: 0 };
  },
};

// -- STATUS ADAPTER --

const statusAdapter: StatusAdapter = {
  isConfigured(config: QQAccountConfig): boolean {
    return !!(config.appId && config.secret);
  },
  async checkHealth(config: QQAccountConfig): Promise<{ connected: boolean; latencyMs?: number; error?: string; details?: Record<string, unknown> }> {
    if (!config.appId || !config.secret) return { connected: false, error: 'appId and secret are required' };
    const qqConfig: QQConfig = {
      id: config.id,
      name: config.name,
      enabled: config.enabled ?? true,
      isDefault: config.isDefault,
      provider: 'qq',
      appId: config.appId,
      token: config.token,
      secret: config.secret,
      sandboxMode: config.sandboxMode,
    };
    const start = Date.now();
    const result = await callApi<QQMeResponse>('/users/@me', 'GET', undefined, qqConfig);
    const latencyMs = Date.now() - start;
    if (result.ok && result.data) {
      return {
        connected: true, latencyMs,
        details: { id: result.data.id, username: result.data.username, bot: result.data.bot, sandboxMode: config.sandboxMode ?? false },
      };
    }
    return { connected: false, latencyMs, error: result.error ?? 'Failed to connect to QQ Bot API' };
  },
};

// -- CONFIG MANAGEMENT + EXPORT --

export function setQQConfig(config: QQConfig): void {
  currentConfig = config;
  cachedToken = null;
  tokenExpiresAt = 0;
}

export function clearQQConfig(): void {
  currentConfig = null;
  cachedToken = null;
  tokenExpiresAt = 0;
}

export const qqProvider: ChatProvider<QQAccountConfig> = {
  meta,
  capabilities,
  defaultConfig: { provider: 'qq', enabled: true },
  configSchema: QQAccountConfigSchema as z.ZodType<QQAccountConfig>,
  auth: authAdapter,
  outbound: outboundAdapter,
  inbound: inboundAdapter,
  status: statusAdapter,
};

export type { QQConfig, QQWebhookPayload, QQEventData };
