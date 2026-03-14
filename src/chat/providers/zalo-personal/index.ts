/**
 * Zalo Personal Provider - Zalo Social API personal messaging
 * Separate from Zalo OA (Official Account).
 * API base: https://graph.zalo.me/v2.0/me
 */

import { createHmac } from 'node:crypto';
import { z } from 'zod';
import type {
  ChatProvider,
  ZaloPersonalAccountConfig,
  ChatProviderMeta,
  ChatProviderCapabilities,
  AuthAdapter,
  OutboundAdapter,
  InboundAdapter,
  StatusAdapter,
  SendResult,
  IncomingMessage,
  SlashCommand,
  InteractiveAction,
  CommandResponse,
  OutgoingMessage,
} from '../types.js';
import { logger } from '../../../utils/logger.js';

// --- API types ---

interface ZaloSocialProfile {
  id?: string;
  name?: string;
  picture?: { data?: { url?: string } };
  error?: { code?: number; message?: string };
}

interface ZaloSocialMessage {
  from: { id: string; name?: string };
  message?: { text?: string; msg_id?: string };
  timestamp?: number;
  event_name?: string;
}

interface ZaloSendResult {
  error?: number;
  message?: string;
  data?: { message_id?: string };
}

interface ZaloTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: number;
  error_name?: string;
}

// --- Schema ---

export const ZaloPersonalAccountConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().optional(),
  provider: z.literal('zalo-personal'),
  accessToken: z.string().optional(),
  secretKey: z.string().optional(),
  userId: z.string().optional(),
}) satisfies z.ZodType<ZaloPersonalAccountConfig>;

type ZaloPersonalConfig = z.infer<typeof ZaloPersonalAccountConfigSchema>;

// --- State ---

let currentConfig: ZaloPersonalConfig | null = null;
const ZALO_SOCIAL_API = 'https://graph.zalo.me/v2.0/me';

// --- HTTP helper ---

async function callZaloSocialApi<T>(
  endpoint: string,
  method: 'GET' | 'POST' = 'GET',
  body?: Record<string, unknown>,
  config?: ZaloPersonalConfig | null,
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const token = (config ?? currentConfig)?.accessToken;
  if (!token) return { ok: false, error: 'Access token not configured' };

  try {
    const url = `${ZALO_SOCIAL_API}${endpoint}`;
    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    type ApiResponse = T & { error?: { code?: number; message?: string } | number; message?: string };
    const data = await res.json() as ApiResponse;

    if (!res.ok) {
      const errMsg = typeof data.error === 'object' ? data.error?.message : data.message;
      return { ok: false, error: errMsg ?? `HTTP ${res.status}` };
    }
    if (typeof data.error === 'number' && data.error !== 0) {
      return { ok: false, error: data.message ?? `Zalo error ${data.error}` };
    }
    return { ok: true, data };
  } catch (error) {
    logger.error('[ZaloPersonal] API call failed:', error instanceof Error ? error : undefined);
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// --- Adapters ---

const authAdapter: AuthAdapter = {
  getAuthUrl(state: string, _scopes?: string[]): string {
    const appId = process.env['ZALO_PERSONAL_APP_ID'] ?? '';
    const redirectUri = encodeURIComponent(process.env['ZALO_PERSONAL_REDIRECT_URI'] ?? '');
    return `https://oauth.zaloapp.com/v4/permission?app_id=${appId}&redirect_uri=${redirectUri}&state=${state}`;
  },
  async exchangeCode(code: string): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
    const appId = process.env['ZALO_PERSONAL_APP_ID'];
    const appSecret = process.env['ZALO_PERSONAL_APP_SECRET'];
    if (!appId || !appSecret) {
      throw new Error('ZALO_PERSONAL_APP_ID and ZALO_PERSONAL_APP_SECRET required');
    }

    const res = await fetch('https://oauth.zaloapp.com/v4/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'secret_key': appSecret,
      },
      body: `code=${code}&app_id=${appId}&grant_type=authorization_code`,
    });

    const data = await res.json() as ZaloTokenResponse;
    if (data.error || !data.access_token) {
      throw new Error(data.error_name ?? 'Token exchange failed');
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  },
  verifyWebhook(signature: string, _timestamp: string, body: string): boolean {
    const secret = currentConfig?.secretKey;
    if (!secret) {
      logger.warn('[ZaloPersonal] verifyWebhook: secretKey not configured');
      return false;
    }
    try {
      const expected = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
      return signature === expected;
    } catch (error) {
      logger.error('[ZaloPersonal] verifyWebhook failed:', error instanceof Error ? error : undefined);
      return false;
    }
  },
};

const outboundAdapter: OutboundAdapter = {
  async send(message: OutgoingMessage): Promise<SendResult> {
    if (!currentConfig?.accessToken) return { success: false, error: 'Access token not configured' };
    if (!message.to) return { success: false, error: 'Recipient user ID (to) is required' };

    const result = await callZaloSocialApi<ZaloSendResult>('/message', 'POST', {
      recipient: { user_id: message.to },
      message: { text: message.text ?? '' },
    });

    return result.ok
      ? { success: true, messageId: result.data?.data?.message_id }
      : { success: false, error: result.error ?? 'Failed to send message' };
  },
};

const inboundAdapter: InboundAdapter = {
  parseMessage(payload: unknown): IncomingMessage | null {
    const event = payload as ZaloSocialMessage;
    if (!event?.from?.id || !event?.message?.text) return null;
    if (event.event_name && event.event_name !== 'user_send_text') return null;

    return {
      id: event.message.msg_id ?? `zp-${Date.now()}`,
      provider: 'zalo-personal',
      accountId: currentConfig?.id ?? 'default',
      senderId: event.from.id,
      senderName: event.from.name ?? event.from.id,
      senderUsername: event.from.id,
      chatType: 'direct',
      chatId: event.from.id,
      chatName: undefined,
      threadId: undefined,
      replyToId: undefined,
      text: event.message.text,
      rawContent: event,
      timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
      attachments: undefined,
    };
  },
  parseCommand(_payload: unknown): SlashCommand | null { return null; },
  parseAction(_payload: unknown): InteractiveAction | null { return null; },
  buildCommandResponse(response: CommandResponse): unknown { return { text: response.text ?? '' }; },
  buildActionResponse(response: CommandResponse): unknown { return { text: response.text ?? '' }; },
};

const statusAdapter: StatusAdapter = {
  isConfigured(config: ZaloPersonalAccountConfig): boolean {
    return !!config.accessToken;
  },
  async checkHealth(config: ZaloPersonalAccountConfig): Promise<{
    connected: boolean;
    latencyMs?: number;
    error?: string;
    details?: Record<string, unknown>;
  }> {
    if (!config.accessToken) return { connected: false, error: 'accessToken is required' };

    const personalConfig: ZaloPersonalConfig = {
      ...config,
      provider: 'zalo-personal',
      enabled: config.enabled ?? true,
    };
    const start = Date.now();
    const result = await callZaloSocialApi<ZaloSocialProfile>('/info', 'GET', undefined, personalConfig);
    const latencyMs = Date.now() - start;

    if (result.ok && result.data) {
      const profile = result.data;
      return {
        connected: true,
        latencyMs,
        details: { userId: profile.id, name: profile.name },
      };
    }
    return { connected: false, latencyMs, error: result.error ?? 'Failed to connect' };
  },
};

// --- Config ---

export function setZaloPersonalConfig(config: ZaloPersonalConfig): void {
  currentConfig = config;
}

export function clearZaloPersonalConfig(): void {
  currentConfig = null;
}

// --- Provider export ---

export const zaloPersonalProvider: ChatProvider<ZaloPersonalAccountConfig> = {
  meta: {
    id: 'zalo-personal',
    name: 'Zalo Personal',
    description: 'Zalo Social API for personal messaging in Vietnam',
    icon: 'Zalo icon',
    docsUrl: 'https://developers.zalo.me/docs/social-api/',
    order: 24,
    color: '#0068FF',
  } satisfies ChatProviderMeta,
  capabilities: {
    chatTypes: ['direct'],
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
    oauth: true,
    webhooks: true,
    realtime: false,
  } satisfies ChatProviderCapabilities,
  defaultConfig: { provider: 'zalo-personal', enabled: true },
  configSchema: ZaloPersonalAccountConfigSchema as z.ZodType<ZaloPersonalAccountConfig>,
  auth: authAdapter,
  outbound: outboundAdapter,
  inbound: inboundAdapter,
  status: statusAdapter,
};

export type { ZaloPersonalConfig, ZaloSocialMessage };
