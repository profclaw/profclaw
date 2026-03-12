/**
 * iMessage Provider - iMessage via BlueBubbles REST API
 * API base: {blueBubblesUrl}/api/v1
 */

import { z } from 'zod';
import type {
  ChatProvider, IMessageAccountConfig, ChatProviderMeta, ChatProviderCapabilities,
  AuthAdapter, OutboundAdapter, InboundAdapter, StatusAdapter,
  SendResult, IncomingMessage, SlashCommand, InteractiveAction, CommandResponse, OutgoingMessage,
} from '../types.js';
import { logger } from '../../../utils/logger.js';

// --- API types ---

interface BBHandle { address: string; displayName?: string }
interface BBChat { guid: string; displayName?: string; isGroup?: boolean }
interface BBMessage {
  guid: string;
  text?: string;
  handle?: BBHandle;
  chats?: BBChat[];
  isFromMe?: boolean;
  dateCreated?: number;
}

export interface BBWebhookPayload { type: string; data: BBMessage }

interface BBServerInfo {
  status: number;
  data?: { os_version?: string; server_version?: string; private_api?: boolean; helper_connected?: boolean };
}

interface BBSendResponse { status: number; data?: { guid?: string } }

// --- Schema ---

export const IMessageAccountConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().optional(),
  provider: z.literal('imessage'),
  blueBubblesUrl: z.string().url().optional(),
  blueBubblesPassword: z.string().optional(),
  allowedAddresses: z.array(z.string()).optional(),
}) satisfies z.ZodType<IMessageAccountConfig>;

type IMessageConfig = z.infer<typeof IMessageAccountConfigSchema>;

// --- State ---

let currentConfig: IMessageConfig | null = null;

// --- HTTP helper ---

function buildBBUrl(path: string, config: IMessageConfig): string {
  const base = config.blueBubblesUrl?.replace(/\/$/, '') ?? '';
  const password = encodeURIComponent(config.blueBubblesPassword ?? '');
  const sep = path.includes('?') ? '&' : '?';
  return `${base}/api/v1${path}${sep}password=${password}`;
}

async function callBBApi<T>(
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: Record<string, unknown>,
  config?: IMessageConfig | null
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const cfg = config ?? currentConfig;
  if (!cfg?.blueBubblesUrl) return { ok: false, error: 'blueBubblesUrl not configured' };
  if (!cfg.blueBubblesPassword) return { ok: false, error: 'blueBubblesPassword not configured' };

  try {
    const res = await fetch(buildBBUrl(path, cfg), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json() as T;
    if (!res.ok) return { ok: false, error: (data as { message?: string }).message ?? `HTTP ${res.status}` };
    return { ok: true, data };
  } catch (error) {
    logger.error('[iMessage] BlueBubbles API call failed:', error instanceof Error ? error : undefined);
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// --- Adapters ---

const authAdapter: AuthAdapter = {
  getAuthUrl(_state: string, _scopes?: string[]): string {
    throw new Error('iMessage via BlueBubbles uses password-based auth. Supply blueBubblesUrl and blueBubblesPassword.');
  },
  async exchangeCode(_code: string): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
    throw new Error('BlueBubbles does not use OAuth code flow.');
  },
  verifyWebhook(_signature: string, _timestamp: string, _body: string): boolean {
    // BlueBubbles webhook auth is handled by the password query param at the route level.
    return true;
  },
};

const outboundAdapter: OutboundAdapter = {
  async send(message: OutgoingMessage): Promise<SendResult> {
    if (!currentConfig?.blueBubblesUrl || !currentConfig.blueBubblesPassword) {
      return { success: false, error: 'blueBubblesUrl and blueBubblesPassword are required' };
    }
    if (!message.to) return { success: false, error: 'chatGuid (to) is required' };

    const result = await callBBApi<BBSendResponse>('/message/text', 'POST', {
      chatGuid: message.to,
      message: message.text ?? '',
      method: 'apple-script',
    });
    return result.ok
      ? { success: true, messageId: result.data?.data?.guid }
      : { success: false, error: result.error ?? 'Failed to send iMessage' };
  },
};

const inboundAdapter: InboundAdapter = {
  parseMessage(payload: unknown): IncomingMessage | null {
    const event = payload as BBWebhookPayload;
    if (!event || event.type !== 'new-message') return null;
    const msg = event.data;
    if (!msg?.guid || msg.isFromMe) return null;
    const address = msg.handle?.address;
    if (!address) return null;

    const allowed = currentConfig?.allowedAddresses;
    if (allowed && allowed.length > 0 && !allowed.includes(address)) {
      logger.debug(`[iMessage] parseMessage: address ${address} not in allowedAddresses, skipping`);
      return null;
    }

    const firstChat = msg.chats?.[0];
    return {
      id: msg.guid,
      provider: 'imessage',
      accountId: currentConfig?.id ?? 'default',
      senderId: address,
      senderName: msg.handle?.displayName ?? address,
      senderUsername: address,
      chatType: firstChat?.isGroup ? 'group' : 'direct',
      chatId: firstChat?.guid ?? address,
      chatName: firstChat?.displayName,
      threadId: undefined,
      replyToId: undefined,
      text: msg.text ?? '',
      rawContent: event,
      timestamp: msg.dateCreated ? new Date(msg.dateCreated) : new Date(),
      attachments: undefined,
    };
  },
  parseCommand(_payload: unknown): SlashCommand | null { return null; },
  parseAction(_payload: unknown): InteractiveAction | null { return null; },
  buildCommandResponse(response: CommandResponse): unknown { return { message: response.text ?? '' }; },
  buildActionResponse(response: CommandResponse): unknown { return { message: response.text ?? '' }; },
};

const statusAdapter: StatusAdapter = {
  isConfigured(config: IMessageAccountConfig): boolean {
    return !!(config.blueBubblesUrl && config.blueBubblesPassword);
  },
  async checkHealth(config: IMessageAccountConfig): Promise<{ connected: boolean; latencyMs?: number; error?: string; details?: Record<string, unknown> }> {
    if (!config.blueBubblesUrl || !config.blueBubblesPassword) {
      return { connected: false, error: 'blueBubblesUrl and blueBubblesPassword are required' };
    }
    const bbConfig: IMessageConfig = { ...config, provider: 'imessage', enabled: config.enabled ?? true };
    const start = Date.now();
    const result = await callBBApi<BBServerInfo>('/server/info', 'GET', undefined, bbConfig);
    const latencyMs = Date.now() - start;

    if (result.ok && result.data) {
      const info = (result.data as BBServerInfo).data;
      return {
        connected: true, latencyMs,
        details: { serverUrl: config.blueBubblesUrl, osVersion: info?.os_version, serverVersion: info?.server_version, privateApi: info?.private_api, helperConnected: info?.helper_connected },
      };
    }
    return { connected: false, latencyMs, error: result.error ?? 'Failed to connect to BlueBubbles server' };
  },
};

// --- Config management ---

export function setIMessageConfig(config: IMessageConfig): void { currentConfig = config; }
export function clearIMessageConfig(): void { currentConfig = null; }

// --- Provider export ---

export const imessageProvider: ChatProvider<IMessageAccountConfig> = {
  meta: {
    id: 'imessage', name: 'iMessage',
    description: 'iMessage integration via BlueBubbles self-hosted server',
    icon: 'iMessage icon',
    docsUrl: 'https://bluebubbles.app/',
    order: 21, color: '#34C759',
  } satisfies ChatProviderMeta,
  capabilities: {
    chatTypes: ['direct', 'group'],
    send: true, receive: true, slashCommands: false, interactiveComponents: false,
    reactions: false, edit: false, delete: false, threads: false,
    media: true, richBlocks: false, oauth: false, webhooks: true, realtime: false,
  } satisfies ChatProviderCapabilities,
  defaultConfig: { provider: 'imessage', enabled: true },
  configSchema: IMessageAccountConfigSchema as z.ZodType<IMessageAccountConfig>,
  auth: authAdapter,
  outbound: outboundAdapter,
  inbound: inboundAdapter,
  status: statusAdapter,
};

export type { IMessageConfig, BBMessage };
