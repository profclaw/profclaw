/**
 * DingTalk Provider - webhook-based robot integration.
 * Outbound: POST text to robot webhook URL (optional HMAC-SHA256 signing).
 * Inbound: parse callback payloads for direct and group messages.
 * API base: https://oapi.dingtalk.com
 */

import { createHmac } from 'node:crypto';
import { z } from 'zod';
import type {
  ChatProvider,
  DingTalkAccountConfig,
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

// --- types ---

const DingTalkMsgType = {
  TEXT: 'text',
  IMAGE: 'image',
  AUDIO: 'audio',
  VIDEO: 'video',
  FILE: 'file',
} as const;

type DingTalkMsgTypeValue = (typeof DingTalkMsgType)[keyof typeof DingTalkMsgType];

interface DingTalkInboundPayload {
  msgtype: DingTalkMsgTypeValue;
  text?: { content: string };
  msgId?: string;
  senderNick: string;
  senderId: string;
  conversationType: '1' | '2'; // '1' = direct, '2' = group
  conversationId: string;
  conversationTitle?: string;
}

interface DingTalkWebhookBody { msgtype: 'text'; text: { content: string }; }
interface DingTalkApiResponse { errcode: number; errmsg: string; }

// --- config ---

export const DingTalkAccountConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().optional(),
  provider: z.literal('dingtalk'),
  appKey: z.string().optional(),
  appSecret: z.string().optional(),
  robotCode: z.string().optional(),
  webhookUrl: z.string().url().optional(),
  webhookSecret: z.string().optional(),
}) satisfies z.ZodType<DingTalkAccountConfig>;

type DingTalkConfig = z.infer<typeof DingTalkAccountConfigSchema>;

// --- metadata ---

const meta: ChatProviderMeta = {
  id: 'dingtalk',
  name: 'DingTalk',
  description: 'DingTalk robot webhook integration for direct and group chat',
  icon: 'DingTalk icon',
  docsUrl: 'https://open.dingtalk.com/document/robots/custom-robot-access',
  order: 13,
  color: '#0089FF',
};

const capabilities: ChatProviderCapabilities = {
  chatTypes: ['direct', 'group'],
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

// --- state and helpers ---

let currentConfig: DingTalkConfig | null = null;

function buildSignedUrl(webhookUrl: string, secret: string): string {
  const timestamp = Date.now();
  const sign = encodeURIComponent(
    createHmac('sha256', secret).update(`${timestamp}\n${secret}`, 'utf8').digest('base64')
  );
  return `${webhookUrl}&timestamp=${timestamp}&sign=${sign}`;
}

async function postWebhook(
  webhookUrl: string,
  body: DingTalkWebhookBody,
  secret?: string
): Promise<{ ok: boolean; error?: string }> {
  const url = secret ? buildSignedUrl(webhookUrl, secret) : webhookUrl;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json() as DingTalkApiResponse;
    if (data.errcode !== 0) {
      logger.warn('[DingTalk] Webhook error:', { errcode: data.errcode, errmsg: data.errmsg });
      return { ok: false, error: `DingTalk error ${data.errcode}: ${data.errmsg}` };
    }
    return { ok: true };
  } catch (error) {
    logger.error('[DingTalk] Webhook call failed:', error instanceof Error ? error : undefined);
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// --- auth adapter ---

const authAdapter: AuthAdapter = {
  getAuthUrl(_state: string, _scopes?: string[]): string {
    throw new Error('DingTalk does not use OAuth. Configure a custom robot and supply webhookUrl in config.');
  },

  async exchangeCode(_code: string): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
    throw new Error('DingTalk webhook integration does not use OAuth authorization codes.');
  },

  verifyWebhook(signature: string, timestamp: string, _body: string): boolean {
    const secret = currentConfig?.webhookSecret ?? currentConfig?.appSecret;
    if (!secret) {
      logger.warn('[DingTalk] verifyWebhook: no secret configured, skipping verification');
      return false;
    }
    const ts = parseInt(timestamp, 10);
    if (isNaN(ts) || Math.abs(Date.now() - ts) > 3_600_000) {
      logger.warn('[DingTalk] verifyWebhook: timestamp out of allowed range');
      return false;
    }
    try {
      const expected = createHmac('sha256', secret)
        .update(`${timestamp}\n${secret}`, 'utf8')
        .digest('base64');
      return signature === expected;
    } catch (error) {
      logger.error('[DingTalk] verifyWebhook failed:', error instanceof Error ? error : undefined);
      return false;
    }
  },
};

// --- outbound adapter ---

const outboundAdapter: OutboundAdapter = {
  async send(message: OutgoingMessage): Promise<SendResult> {
    const cfg = currentConfig;
    if (!cfg?.webhookUrl) {
      return { success: false, error: 'webhookUrl is required for DingTalk outbound messages' };
    }
    const result = await postWebhook(
      cfg.webhookUrl,
      { msgtype: 'text', text: { content: message.text ?? '' } },
      cfg.webhookSecret
    );
    return result.ok
      ? { success: true }
      : { success: false, error: result.error ?? 'Failed to send message' };
  },
};

// --- inbound adapter ---

const MEDIA_TYPES: DingTalkMsgTypeValue[] = [DingTalkMsgType.IMAGE, DingTalkMsgType.AUDIO, DingTalkMsgType.VIDEO, DingTalkMsgType.FILE];
const MEDIA_TYPE_MAP: Partial<Record<DingTalkMsgTypeValue, 'image' | 'video' | 'audio' | 'file'>> = {
  image: 'image', video: 'video', audio: 'audio', file: 'file',
};

const inboundAdapter: InboundAdapter = {
  parseMessage(payload: unknown): IncomingMessage | null {
    if (payload === null || typeof payload !== 'object') return null;
    const raw = payload as DingTalkInboundPayload;
    if (!raw.msgtype || !raw.conversationId) {
      logger.debug('[DingTalk] parseMessage: missing required fields, skipping');
      return null;
    }
    if (![DingTalkMsgType.TEXT, ...MEDIA_TYPES].includes(raw.msgtype)) {
      logger.debug(`[DingTalk] parseMessage: unsupported type '${raw.msgtype}', skipping`);
      return null;
    }
    const attachments: IncomingMessage['attachments'] = [];
    if (MEDIA_TYPES.includes(raw.msgtype)) {
      const attachType = MEDIA_TYPE_MAP[raw.msgtype];
      if (attachType) attachments.push({ type: attachType });
    }
    return {
      id: raw.msgId ?? `dt-${Date.now()}`,
      provider: 'dingtalk',
      accountId: currentConfig?.id ?? 'default',
      senderId: raw.senderId,
      senderName: raw.senderNick,
      senderUsername: raw.senderId,
      chatType: raw.conversationType === '1' ? 'direct' : 'group',
      chatId: raw.conversationId,
      chatName: raw.conversationTitle,
      threadId: undefined,
      replyToId: undefined,
      text: raw.text?.content ?? '',
      rawContent: raw,
      timestamp: new Date(),
      attachments: attachments.length > 0 ? attachments : undefined,
    };
  },

  parseCommand(_payload: unknown): SlashCommand | null { return null; },
  parseAction(_payload: unknown): InteractiveAction | null { return null; },

  buildCommandResponse(response: CommandResponse): unknown {
    return { msgtype: DingTalkMsgType.TEXT, text: { content: response.text ?? '' } };
  },

  buildActionResponse(response: CommandResponse): unknown {
    return { msgtype: DingTalkMsgType.TEXT, text: { content: response.text ?? '' } };
  },
};

// --- status adapter ---

const statusAdapter: StatusAdapter = {
  isConfigured(config: DingTalkAccountConfig): boolean {
    return !!config.webhookUrl;
  },

  async checkHealth(config: DingTalkAccountConfig): Promise<{ connected: boolean; latencyMs?: number; error?: string; details?: Record<string, unknown> }> {
    if (!config.webhookUrl) {
      return { connected: false, error: 'webhookUrl is required' };
    }
    const start = Date.now();
    try {
      const response = await fetch('https://oapi.dingtalk.com/', { method: 'HEAD' });
      return {
        connected: response.status < 500,
        latencyMs: Date.now() - start,
        details: {
          webhookConfigured: true,
          signingEnabled: !!config.webhookSecret,
          appKeyConfigured: !!config.appKey,
          robotCodeConfigured: !!config.robotCode,
        },
      };
    } catch (error) {
      return {
        connected: false,
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : 'Network error reaching DingTalk API',
      };
    }
  },
};

// --- config helpers and provider export ---

export function setDingTalkConfig(config: DingTalkConfig): void { currentConfig = config; }
export function clearDingTalkConfig(): void { currentConfig = null; }

export const dingtalkProvider: ChatProvider<DingTalkAccountConfig> = {
  meta,
  capabilities,
  defaultConfig: { provider: 'dingtalk', enabled: true },
  configSchema: DingTalkAccountConfigSchema as z.ZodType<DingTalkAccountConfig>,
  auth: authAdapter,
  outbound: outboundAdapter,
  inbound: inboundAdapter,
  status: statusAdapter,
};

export type { DingTalkConfig, DingTalkInboundPayload };
export { DingTalkMsgType };
