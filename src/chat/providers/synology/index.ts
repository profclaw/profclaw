/**
 * Synology Chat Provider - Synology Chat via incoming and outgoing webhooks
 * Docs: https://kb.synology.com/en-global/DSM/help/Chat/chat_integration
 */

import { z } from 'zod';
import type {
  ChatProvider, SynologyAccountConfig, ChatProviderMeta, ChatProviderCapabilities,
  AuthAdapter, OutboundAdapter, InboundAdapter, StatusAdapter,
  SendResult, IncomingMessage, SlashCommand, InteractiveAction, CommandResponse, OutgoingMessage,
} from '../types.js';
import { logger } from '../../../utils/logger.js';

// --- API types ---

export interface SynologyOutgoingWebhook {
  token: string;
  user_id: string;
  username: string;
  text: string;
  channel_id: string;
  channel_name?: string;
  timestamp: number;
  trigger_word?: string;
}

// --- Schema ---

export const SynologyAccountConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().optional(),
  provider: z.literal('synology'),
  serverUrl: z.string().url().optional(),
  incomingWebhookUrl: z.string().url().optional(),
  outgoingWebhookToken: z.string().optional(),
}) satisfies z.ZodType<SynologyAccountConfig>;

type SynologyConfig = z.infer<typeof SynologyAccountConfigSchema>;

// --- State ---

let currentConfig: SynologyConfig | null = null;

// --- HTTP helper ---

async function postToWebhook(webhookUrl: string, text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const payload = JSON.stringify({ text });
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `payload=${encodeURIComponent(payload)}`,
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (error) {
    logger.error('[Synology] Incoming webhook POST failed:', error instanceof Error ? error : undefined);
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// --- Adapters ---

const authAdapter: AuthAdapter = {
  getAuthUrl(_state: string, _scopes?: string[]): string {
    throw new Error('Synology Chat uses webhook URLs from the Synology Chat integration settings.');
  },
  async exchangeCode(_code: string): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
    throw new Error('Synology Chat does not use OAuth. Configure incomingWebhookUrl in the settings.');
  },
  verifyWebhook(token: string, _timestamp: string, _body: string): boolean {
    const expected = currentConfig?.outgoingWebhookToken;
    if (!expected) {
      logger.warn('[Synology] verifyWebhook: outgoingWebhookToken not configured');
      return false;
    }
    return token === expected;
  },
};

const outboundAdapter: OutboundAdapter = {
  async send(message: OutgoingMessage): Promise<SendResult> {
    const webhookUrl = currentConfig?.incomingWebhookUrl;
    if (!webhookUrl) return { success: false, error: 'incomingWebhookUrl not configured' };

    const result = await postToWebhook(webhookUrl, message.text ?? '');
    return result.ok
      ? { success: true }
      : { success: false, error: result.error ?? 'Failed to post to Synology webhook' };
  },
};

const inboundAdapter: InboundAdapter = {
  parseMessage(payload: unknown): IncomingMessage | null {
    const event = payload as SynologyOutgoingWebhook;
    if (!event || !event.user_id || !event.text) return null;

    return {
      id: `synology-${event.user_id}-${event.timestamp}`,
      provider: 'synology',
      accountId: currentConfig?.id ?? 'default',
      senderId: event.user_id,
      senderName: event.username ?? event.user_id,
      senderUsername: event.username ?? event.user_id,
      chatType: event.channel_id ? 'channel' : 'direct',
      chatId: event.channel_id ?? event.user_id,
      chatName: event.channel_name,
      threadId: undefined,
      replyToId: undefined,
      text: event.text,
      rawContent: event,
      timestamp: event.timestamp ? new Date(event.timestamp * 1000) : new Date(),
      attachments: undefined,
    };
  },
  parseCommand(_payload: unknown): SlashCommand | null { return null; },
  parseAction(_payload: unknown): InteractiveAction | null { return null; },
  buildCommandResponse(response: CommandResponse): unknown { return { text: response.text ?? '' }; },
  buildActionResponse(response: CommandResponse): unknown { return { text: response.text ?? '' }; },
};

const statusAdapter: StatusAdapter = {
  isConfigured(config: SynologyAccountConfig): boolean {
    return !!(config.incomingWebhookUrl);
  },
  async checkHealth(config: SynologyAccountConfig): Promise<{ connected: boolean; latencyMs?: number; error?: string; details?: Record<string, unknown> }> {
    if (!config.incomingWebhookUrl) {
      return { connected: false, error: 'incomingWebhookUrl is required' };
    }
    // Synology incoming webhooks have no ping endpoint - verify config presence only.
    return {
      connected: true,
      details: {
        incomingWebhookConfigured: true,
        outgoingTokenConfigured: !!(config.outgoingWebhookToken),
        serverUrl: config.serverUrl ?? 'not set',
      },
    };
  },
};

// --- Config management ---

export function setSynologyConfig(config: SynologyConfig): void { currentConfig = config; }
export function clearSynologyConfig(): void { currentConfig = null; }

// --- Provider export ---

export const synologyProvider: ChatProvider<SynologyAccountConfig> = {
  meta: {
    id: 'synology', name: 'Synology Chat',
    description: 'Synology Chat self-hosted messaging via incoming and outgoing webhooks',
    icon: 'Synology icon',
    docsUrl: 'https://kb.synology.com/en-global/DSM/help/Chat/chat_integration',
    order: 22, color: '#4B8EC6',
  } satisfies ChatProviderMeta,
  capabilities: {
    chatTypes: ['direct', 'channel'],
    send: true, receive: true, slashCommands: false, interactiveComponents: false,
    reactions: false, edit: false, delete: false, threads: false,
    media: false, richBlocks: false, oauth: false, webhooks: true, realtime: false,
  } satisfies ChatProviderCapabilities,
  defaultConfig: { provider: 'synology', enabled: true },
  configSchema: SynologyAccountConfigSchema as z.ZodType<SynologyAccountConfig>,
  auth: authAdapter,
  outbound: outboundAdapter,
  inbound: inboundAdapter,
  status: statusAdapter,
};

export type { SynologyConfig };
