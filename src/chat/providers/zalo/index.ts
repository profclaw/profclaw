/**
 * Zalo Provider - Zalo Official Account messaging API
 * API base: https://openapi.zalo.me/v3.0/oa
 */

import { createHmac } from 'node:crypto';
import { z } from 'zod';
import type {
  ChatProvider, ZaloAccountConfig, ChatProviderMeta, ChatProviderCapabilities,
  AuthAdapter, OutboundAdapter, InboundAdapter, StatusAdapter,
  SendResult, IncomingMessage, SlashCommand, InteractiveAction, CommandResponse, OutgoingMessage,
} from '../types.js';
import { logger } from '../../../utils/logger.js';

// --- API types ---

interface ZaloWebhookEvent {
  event_name: string;
  sender: { id: string };
  message?: { text: string; msg_id?: string };
  timestamp?: number;
}

interface ZaloOAData {
  oa_id?: string;
  name?: string;
  is_verified?: boolean;
  num_follower?: number;
}

interface ZaloOAInfo {
  error?: number;
  message?: string;
  data?: ZaloOAData;
}

interface ZaloSendResponse {
  error?: number;
  message?: string;
  data?: { message_id?: string };
}

// --- Schema ---

export const ZaloAccountConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().optional(),
  provider: z.literal('zalo'),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  oaId: z.string().optional(),
  secretKey: z.string().optional(),
}) satisfies z.ZodType<ZaloAccountConfig>;

type ZaloConfig = z.infer<typeof ZaloAccountConfigSchema>;

// --- State ---

let currentConfig: ZaloConfig | null = null;
const ZALO_API_BASE = 'https://openapi.zalo.me/v3.0/oa';

// --- HTTP helper ---

async function callZaloApi<T>(
  endpoint: string,
  method: 'GET' | 'POST' = 'GET',
  body?: Record<string, unknown>,
  config?: ZaloConfig | null
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const token = (config ?? currentConfig)?.accessToken;
  if (!token) return { ok: false, error: 'Access token not configured' };

  try {
    const res = await fetch(`${ZALO_API_BASE}${endpoint}`, {
      method,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json() as T & { error?: number; message?: string };
    if (!res.ok) return { ok: false, error: data.message ?? `HTTP ${res.status}` };
    if (data.error && data.error !== 0) return { ok: false, error: data.message ?? `Zalo error ${data.error}` };
    return { ok: true, data };
  } catch (error) {
    logger.error('[Zalo] API call failed:', error instanceof Error ? error : undefined);
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// --- Adapters ---

const authAdapter: AuthAdapter = {
  getAuthUrl(_state: string, _scopes?: string[]): string {
    throw new Error('Zalo OA uses access tokens from the Zalo Developer Console.');
  },
  async exchangeCode(_code: string): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
    throw new Error('Zalo OA does not use OAuth authorization code flow.');
  },
  verifyWebhook(signature: string, _timestamp: string, body: string): boolean {
    const secret = currentConfig?.secretKey;
    if (!secret) {
      logger.warn('[Zalo] verifyWebhook: secretKey not configured');
      return false;
    }
    try {
      const expected = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
      return signature === expected;
    } catch (error) {
      logger.error('[Zalo] verifyWebhook failed:', error instanceof Error ? error : undefined);
      return false;
    }
  },
};

const outboundAdapter: OutboundAdapter = {
  async send(message: OutgoingMessage): Promise<SendResult> {
    if (!currentConfig?.accessToken) return { success: false, error: 'Access token not configured' };
    if (!message.to) return { success: false, error: 'Target user ID (to) is required' };

    const result = await callZaloApi<ZaloSendResponse>('/message/cs', 'POST', {
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
    const event = payload as ZaloWebhookEvent;
    if (!event || event.event_name !== 'user_send_text') return null;
    if (!event.message?.text || !event.sender?.id) return null;

    return {
      id: event.message.msg_id ?? `zalo-${Date.now()}`,
      provider: 'zalo',
      accountId: currentConfig?.id ?? 'default',
      senderId: event.sender.id,
      senderName: event.sender.id,
      senderUsername: event.sender.id,
      chatType: 'direct',
      chatId: event.sender.id,
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
  isConfigured(config: ZaloAccountConfig): boolean {
    return !!(config.accessToken && config.oaId);
  },
  async checkHealth(config: ZaloAccountConfig): Promise<{ connected: boolean; latencyMs?: number; error?: string; details?: Record<string, unknown> }> {
    if (!config.accessToken) return { connected: false, error: 'accessToken is required' };

    const zaloConfig: ZaloConfig = { ...config, provider: 'zalo', enabled: config.enabled ?? true };
    const start = Date.now();
    const result = await callZaloApi<ZaloOAInfo>('/getoa', 'GET', undefined, zaloConfig);
    const latencyMs = Date.now() - start;

    if (result.ok && result.data) {
      const info = (result.data as ZaloOAInfo).data;
      return { connected: true, latencyMs, details: { oaId: info?.oa_id, name: info?.name, isVerified: info?.is_verified, numFollower: info?.num_follower } };
    }
    return { connected: false, latencyMs, error: result.error ?? 'Failed to connect to Zalo OA API' };
  },
};

// --- Config management ---

export function setZaloConfig(config: ZaloConfig): void { currentConfig = config; }
export function clearZaloConfig(): void { currentConfig = null; }

// --- Provider export ---

export const zaloProvider: ChatProvider<ZaloAccountConfig> = {
  meta: {
    id: 'zalo', name: 'Zalo',
    description: 'Zalo Official Account messaging API for Vietnam',
    icon: 'Zalo icon',
    docsUrl: 'https://developers.zalo.me/docs/official-account/',
    order: 19, color: '#0068FF',
  } satisfies ChatProviderMeta,
  capabilities: {
    chatTypes: ['direct', 'group'],
    send: true, receive: true, slashCommands: false, interactiveComponents: false,
    reactions: false, edit: false, delete: false, threads: false,
    media: true, richBlocks: false, oauth: false, webhooks: true, realtime: false,
  } satisfies ChatProviderCapabilities,
  defaultConfig: { provider: 'zalo', enabled: true },
  configSchema: ZaloAccountConfigSchema as z.ZodType<ZaloAccountConfig>,
  auth: authAdapter,
  outbound: outboundAdapter,
  inbound: inboundAdapter,
  status: statusAdapter,
};

export type { ZaloConfig, ZaloWebhookEvent };
