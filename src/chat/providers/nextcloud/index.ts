/**
 * Nextcloud Talk Provider - Nextcloud Talk team messaging
 * API base: {serverUrl}/ocs/v2.php/apps/spreed/api/v4
 */

import { z } from 'zod';
import type {
  ChatProvider, NextcloudAccountConfig, ChatProviderMeta, ChatProviderCapabilities,
  AuthAdapter, OutboundAdapter, InboundAdapter, StatusAdapter,
  SendResult, IncomingMessage, SlashCommand, InteractiveAction, CommandResponse, OutgoingMessage,
} from '../types.js';
import { logger } from '../../../utils/logger.js';

// --- API types ---

export interface NextcloudChatMessage {
  id: number;
  token: string;
  actorId: string;
  actorDisplayName: string;
  message: string;
  messageType?: string;
  timestamp: number;
}

interface OCSResponse<T> {
  ocs: { meta: { status: string; statuscode: number; message?: string }; data: T };
}

interface NCRoom { token: string; displayName: string; type: number }

// --- Schema ---

export const NextcloudAccountConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().optional(),
  provider: z.literal('nextcloud'),
  serverUrl: z.string().url().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  token: z.string().optional(),
}) satisfies z.ZodType<NextcloudAccountConfig>;

type NextcloudConfig = z.infer<typeof NextcloudAccountConfigSchema>;

// --- State ---

let currentConfig: NextcloudConfig | null = null;

// --- HTTP helper ---

async function callNcApi<T>(
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: Record<string, unknown>,
  config?: NextcloudConfig | null
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const cfg = config ?? currentConfig;
  if (!cfg?.serverUrl) return { ok: false, error: 'serverUrl not configured' };
  if (!cfg.username || !cfg.password) return { ok: false, error: 'username and password are required' };

  const base = cfg.serverUrl.replace(/\/$/, '');
  const creds = Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
  const url = `${base}/ocs/v2.php/apps/spreed/api/v4${path}?format=json`;

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Basic ${creds}`,
        'OCS-APIRequest': 'true',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json() as T;
    if (!res.ok) {
      const ocsData = data as OCSResponse<unknown>;
      return { ok: false, error: ocsData?.ocs?.meta?.message ?? `HTTP ${res.status}` };
    }
    return { ok: true, data };
  } catch (error) {
    logger.error('[Nextcloud] API call failed:', error instanceof Error ? error : undefined);
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// --- Adapters ---

const authAdapter: AuthAdapter = {
  getAuthUrl(_state: string, _scopes?: string[]): string {
    throw new Error('Nextcloud Talk uses Basic auth. Supply serverUrl, username, and password.');
  },
  async exchangeCode(_code: string): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
    throw new Error('Nextcloud Talk does not use OAuth code flow. Use an app password from Nextcloud Security settings.');
  },
  verifyWebhook(_signature: string, _timestamp: string, _body: string): boolean {
    // Nextcloud Talk webhook verification relies on network-level access control.
    return true;
  },
};

const outboundAdapter: OutboundAdapter = {
  async send(message: OutgoingMessage): Promise<SendResult> {
    if (!currentConfig?.serverUrl) return { success: false, error: 'serverUrl not configured' };
    const roomToken = message.to ?? currentConfig.token;
    if (!roomToken) return { success: false, error: 'Room token (to or config.token) is required' };

    const result = await callNcApi<OCSResponse<NextcloudChatMessage>>(
      `/chat/${roomToken}`, 'POST', { message: message.text ?? '' }
    );
    return result.ok
      ? { success: true, messageId: result.data?.ocs?.data?.id !== undefined ? String(result.data.ocs.data.id) : undefined }
      : { success: false, error: result.error ?? 'Failed to send message' };
  },
};

const inboundAdapter: InboundAdapter = {
  parseMessage(payload: unknown): IncomingMessage | null {
    const msg = payload as NextcloudChatMessage;
    if (!msg || !msg.token || !msg.actorId || !msg.message) return null;
    if (msg.messageType && msg.messageType !== 'comment') return null;

    return {
      id: String(msg.id),
      provider: 'nextcloud',
      accountId: currentConfig?.id ?? 'default',
      senderId: msg.actorId,
      senderName: msg.actorDisplayName ?? msg.actorId,
      senderUsername: msg.actorId,
      chatType: 'group',
      chatId: msg.token,
      chatName: undefined,
      threadId: undefined,
      replyToId: undefined,
      text: msg.message,
      rawContent: msg,
      timestamp: msg.timestamp ? new Date(msg.timestamp * 1000) : new Date(),
      attachments: undefined,
    };
  },
  parseCommand(_payload: unknown): SlashCommand | null { return null; },
  parseAction(_payload: unknown): InteractiveAction | null { return null; },
  buildCommandResponse(response: CommandResponse): unknown { return { message: response.text ?? '' }; },
  buildActionResponse(response: CommandResponse): unknown { return { message: response.text ?? '' }; },
};

const statusAdapter: StatusAdapter = {
  isConfigured(config: NextcloudAccountConfig): boolean {
    return !!(config.serverUrl && config.username && config.password);
  },
  async checkHealth(config: NextcloudAccountConfig): Promise<{ connected: boolean; latencyMs?: number; error?: string; details?: Record<string, unknown> }> {
    if (!config.serverUrl || !config.username || !config.password) {
      return { connected: false, error: 'serverUrl, username, and password are required' };
    }
    const ncConfig: NextcloudConfig = { ...config, provider: 'nextcloud', enabled: config.enabled ?? true };
    const start = Date.now();
    const result = await callNcApi<OCSResponse<NCRoom[]>>('/room', 'GET', undefined, ncConfig);
    const latencyMs = Date.now() - start;

    if (result.ok) {
      return {
        connected: true, latencyMs,
        details: { serverUrl: config.serverUrl, username: config.username, roomCount: result.data?.ocs?.data?.length ?? 0 },
      };
    }
    return { connected: false, latencyMs, error: result.error ?? 'Failed to connect to Nextcloud Talk API' };
  },
};

// --- Config management ---

export function setNextcloudConfig(config: NextcloudConfig): void { currentConfig = config; }
export function clearNextcloudConfig(): void { currentConfig = null; }

// --- Provider export ---

export const nextcloudProvider: ChatProvider<NextcloudAccountConfig> = {
  meta: {
    id: 'nextcloud', name: 'Nextcloud Talk',
    description: 'Nextcloud Talk self-hosted team messaging and video calls',
    icon: 'Nextcloud icon',
    docsUrl: 'https://nextcloud-talk.readthedocs.io/en/latest/',
    order: 20, color: '#0082C9',
  } satisfies ChatProviderMeta,
  capabilities: {
    chatTypes: ['direct', 'group'],
    send: true, receive: true, slashCommands: false, interactiveComponents: false,
    reactions: false, edit: false, delete: false, threads: false,
    media: true, richBlocks: false, oauth: false, webhooks: true, realtime: false,
  } satisfies ChatProviderCapabilities,
  defaultConfig: { provider: 'nextcloud', enabled: true },
  configSchema: NextcloudAccountConfigSchema as z.ZodType<NextcloudAccountConfig>,
  auth: authAdapter,
  outbound: outboundAdapter,
  inbound: inboundAdapter,
  status: statusAdapter,
};

export type { NextcloudConfig };
