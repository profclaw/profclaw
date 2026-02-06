/**
 * LINE Provider - Full Implementation
 *
 * LINE Messaging API integration using:
 * - Channel access token authentication (Bearer)
 * - HMAC-SHA256 signature verification (channelSecret)
 * - Push messages to user/group/room IDs
 * - Reply messages via replyToken (within 30s of event)
 * - Media support: images, video, audio, files
 * - Health check via GET /v2/bot/info
 * - Webhook events: message, follow, unfollow, join, leave, etc.
 *
 * API base: https://api.line.me/v2/bot
 * Docs: https://developers.line.biz/en/docs/messaging-api/
 */

import { createHmac } from 'node:crypto';
import { z } from 'zod';
import type {
  ChatProvider,
  LINEAccountConfig,
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

// LINE API TYPES

/** LINE message types */
const LINEMsgType = {
  TEXT: 'text',
  IMAGE: 'image',
  VIDEO: 'video',
  AUDIO: 'audio',
  FILE: 'file',
  LOCATION: 'location',
  STICKER: 'sticker',
  FLEX: 'flex',
} as const;

type LINEMsgTypeValue = (typeof LINEMsgType)[keyof typeof LINEMsgType];

/** LINE event source types */
const LINESourceType = {
  USER: 'user',
  GROUP: 'group',
  ROOM: 'room',
} as const;

interface LINESource {
  type: 'user' | 'group' | 'room';
  userId?: string;
  groupId?: string;
  roomId?: string;
}

interface LINEMessageContent {
  id: string;
  type: LINEMsgTypeValue;
  text?: string;
  fileName?: string;
  fileSize?: number;
  duration?: number;
  originalContentUrl?: string;
  previewImageUrl?: string;
}

interface LINEEvent {
  type: string;
  message?: LINEMessageContent;
  timestamp: number;
  source: LINESource;
  replyToken?: string;
  mode: 'active' | 'standby';
  webhookEventId?: string;
  deliveryContext?: { isRedelivery: boolean };
}

interface LINEWebhookBody {
  destination: string;
  events: LINEEvent[];
}

interface LINEPushMessageBody {
  to: string;
  messages: LINEOutboundMessage[];
}

interface LINEReplyMessageBody {
  replyToken: string;
  messages: LINEOutboundMessage[];
}

interface LINEOutboundMessage {
  type: string;
  text?: string;
}

interface LINEBotInfo {
  userId: string;
  basicId: string;
  displayName: string;
  pictureUrl?: string;
  chatMode?: string;
  markAsReadMode?: string;
}

interface LINEApiResponse {
  message?: string;
  sentMessages?: Array<{ id: string; quoteToken?: string }>;
}

// CONFIGURATION

export const LINEAccountConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().optional(),
  provider: z.literal('line'),
  channelAccessToken: z.string().optional(),
  channelSecret: z.string().optional(),
  webhookUrl: z.string().url().optional(),
}) satisfies z.ZodType<LINEAccountConfig>;

type LINEConfig = z.infer<typeof LINEAccountConfigSchema>;

// METADATA

const meta: ChatProviderMeta = {
  id: 'line',
  name: 'LINE',
  description: 'LINE Messaging API with push and reply message support',
  icon: 'LINE icon',
  docsUrl: 'https://developers.line.biz/en/docs/messaging-api/',
  order: 11,
  color: '#06C755',
};

// CAPABILITIES

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
  richBlocks: false, // Flex Messages deferred
  oauth: false,
  webhooks: true,
  realtime: false,
};

// STATE

let currentConfig: LINEConfig | null = null;

const LINE_API_BASE = 'https://api.line.me/v2/bot';

// HELPER FUNCTIONS

function getAuthHeaders(config?: LINEConfig | null): Record<string, string> {
  const token = (config ?? currentConfig)?.channelAccessToken;
  return {
    'Authorization': token ? `Bearer ${token}` : '',
    'Content-Type': 'application/json',
  };
}

async function callLINEApi<T>(
  endpoint: string,
  method: 'GET' | 'POST' = 'GET',
  body?: Record<string, unknown>,
  config?: LINEConfig | null
): Promise<{ ok: boolean; data?: T; error?: string; status?: number }> {
  const headers = getAuthHeaders(config);

  if (!headers['Authorization'] || headers['Authorization'] === 'Bearer ') {
    return { ok: false, error: 'Channel access token not configured' };
  }

  const url = `${LINE_API_BASE}${endpoint}`;

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (response.status === 200 && method === 'POST') {
      // LINE push/reply returns 200 with an empty body or sentMessages
      const text = await response.text();
      if (!text || text === '{}') {
        return { ok: true, status: 200 };
      }
      try {
        const data = JSON.parse(text) as T;
        return { ok: true, data, status: 200 };
      } catch {
        return { ok: true, status: 200 };
      }
    }

    const data = await response.json() as T & { message?: string };

    if (!response.ok) {
      const errData = data as { message?: string };
      return {
        ok: false,
        status: response.status,
        error: errData.message ?? `HTTP ${response.status}`,
      };
    }

    return { ok: true, data, status: response.status };
  } catch (error) {
    logger.error('[LINE] API call failed:', error instanceof Error ? error : undefined);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Derive the chat type from a LINE event source.
 * Group and room sources map to 'group'; user sources map to 'direct'.
 */
function getLineChatType(source: LINESource): 'direct' | 'group' {
  if (source.type === LINESourceType.GROUP || source.type === LINESourceType.ROOM) {
    return 'group';
  }
  return 'direct';
}

/**
 * Resolve the chat ID from a LINE event source.
 * Groups use groupId, rooms use roomId, direct uses userId.
 */
function getChatId(source: LINESource): string {
  if (source.type === LINESourceType.GROUP && source.groupId) {
    return source.groupId;
  }
  if (source.type === LINESourceType.ROOM && source.roomId) {
    return source.roomId;
  }
  return source.userId ?? '';
}

/**
 * Map LINE message type to attachment type for media messages.
 */
function lineTypeToAttachmentType(
  msgType: LINEMsgTypeValue
): 'image' | 'video' | 'audio' | 'file' | null {
  const map: Partial<Record<LINEMsgTypeValue, 'image' | 'video' | 'audio' | 'file'>> = {
    [LINEMsgType.IMAGE]: 'image',
    [LINEMsgType.VIDEO]: 'video',
    [LINEMsgType.AUDIO]: 'audio',
    [LINEMsgType.FILE]: 'file',
  };
  return map[msgType] ?? null;
}

// AUTH ADAPTER

const authAdapter: AuthAdapter = {
  getAuthUrl(_state: string, _scopes?: string[]): string {
    // LINE Messaging API does not use OAuth for bot authentication.
    // Channel access tokens are issued via the LINE Developers Console
    // or via the Channel Access Token API.
    throw new Error(
      'LINE does not use OAuth for bot authentication. ' +
      'Issue a channel access token via the LINE Developers Console ' +
      'and supply it in the configuration.'
    );
  },

  async exchangeCode(_code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  }> {
    throw new Error(
      'LINE does not use OAuth authorization codes for bot authentication. ' +
      'Use the LINE Channel Access Token API or the Developers Console.'
    );
  },

  verifyWebhook(signature: string, _timestamp: string, body: string): boolean {
    // LINE uses HMAC-SHA256 of the raw request body with the channelSecret.
    // The resulting digest is base64-encoded and sent in the X-Line-Signature header.
    const secret = currentConfig?.channelSecret;
    if (!secret) {
      logger.warn('[LINE] verifyWebhook: channelSecret not configured, skipping verification');
      return false;
    }

    try {
      const expected = createHmac('sha256', secret)
        .update(body, 'utf8')
        .digest('base64');
      return signature === expected;
    } catch (error) {
      logger.error('[LINE] verifyWebhook: HMAC computation failed:', error instanceof Error ? error : undefined);
      return false;
    }
  },
};

// OUTBOUND ADAPTER

const outboundAdapter: OutboundAdapter = {
  async send(message: OutgoingMessage): Promise<SendResult> {
    if (!currentConfig?.channelAccessToken) {
      return { success: false, error: 'Channel access token not configured' };
    }

    if (!message.to) {
      return { success: false, error: 'Target user ID or group ID (to) is required' };
    }

    const lineMessage: LINEOutboundMessage = {
      type: LINEMsgType.TEXT,
      text: message.text ?? '',
    };

    // LINE push message: send to any user/group/room at any time
    const pushBody: LINEPushMessageBody = {
      to: message.to,
      messages: [lineMessage],
    };

    const result = await callLINEApi<LINEApiResponse>(
      '/message/push',
      'POST',
      pushBody as unknown as Record<string, unknown>
    );

    if (result.ok) {
      const messageId = result.data?.sentMessages?.[0]?.id;
      return {
        success: true,
        messageId,
      };
    }

    return {
      success: false,
      error: result.error ?? 'Failed to send message',
    };
  },
};

// INBOUND ADAPTER

const inboundAdapter: InboundAdapter = {
  parseMessage(payload: unknown): IncomingMessage | null {
    // Accepts a single LINEEvent or a LINEWebhookBody with events[].
    // The webhook body has { destination, events[] }; individual event dispatch
    // is handled by parseLINEWebhook() below. Here we accept either form.

    let event: LINEEvent;

    if (
      payload !== null &&
      typeof payload === 'object' &&
      'events' in (payload as Record<string, unknown>)
    ) {
      // Full webhook body - parse first message event only
      const webhookBody = payload as LINEWebhookBody;
      const first = webhookBody.events.find((e) => e.type === 'message');
      if (!first) return null;
      event = first;
    } else {
      event = payload as LINEEvent;
    }

    if (!event || event.type !== 'message') return null;

    const msg = event.message;
    if (!msg) return null;

    // Supported message types for normalization
    const supportedTypes: LINEMsgTypeValue[] = [
      LINEMsgType.TEXT,
      LINEMsgType.IMAGE,
      LINEMsgType.VIDEO,
      LINEMsgType.AUDIO,
      LINEMsgType.FILE,
    ];

    if (!supportedTypes.includes(msg.type)) {
      logger.debug(`[LINE] parseMessage: unsupported message type '${msg.type}', skipping`);
      return null;
    }

    const source = event.source;
    const senderId = source.userId ?? '';
    const chatType = getLineChatType(source);
    const chatId = getChatId(source);

    const attachments: IncomingMessage['attachments'] = [];
    const attachType = lineTypeToAttachmentType(msg.type);
    if (attachType) {
      // LINE media content is fetched via GET /v2/bot/message/{messageId}/content
      // We record the content endpoint URL as the attachment URL for downstream fetching.
      attachments.push({
        type: attachType,
        url: `${LINE_API_BASE}/message/${msg.id}/content`,
        name: msg.fileName,
        size: msg.fileSize,
      });
    }

    return {
      id: msg.id,
      provider: 'line',
      accountId: currentConfig?.id ?? 'default',
      senderId,
      senderName: senderId, // Display name requires separate GET /v2/bot/profile/{userId}
      senderUsername: senderId,
      chatType,
      chatId,
      chatName: undefined, // Resolved separately via LINE group/room profile API
      threadId: undefined, // LINE does not support threads
      replyToId: undefined,
      text: msg.text ?? '',
      rawContent: event,
      timestamp: new Date(event.timestamp),
      attachments: attachments.length > 0 ? attachments : undefined,
    };
  },

  parseCommand(_payload: unknown): SlashCommand | null {
    // LINE does not have native slash commands.
    // Command-like behavior is implemented at the application layer
    // by inspecting message text for prefix patterns (e.g., "/command").
    return null;
  },

  parseAction(_payload: unknown): InteractiveAction | null {
    // LINE postback actions (button taps) are handled as separate event types
    // ('postback') and are not normalized here. Full postback support is deferred.
    return null;
  },

  buildCommandResponse(response: CommandResponse): unknown {
    // Returns a LINE message object ready for use in a push or reply body.
    return {
      type: LINEMsgType.TEXT,
      text: response.text ?? '',
    };
  },

  buildActionResponse(response: CommandResponse): unknown {
    return {
      type: LINEMsgType.TEXT,
      text: response.text ?? '',
    };
  },
};

// STATUS ADAPTER

const statusAdapter: StatusAdapter = {
  isConfigured(config: LINEAccountConfig): boolean {
    return !!(config.channelAccessToken && config.channelSecret);
  },

  async checkHealth(config: LINEAccountConfig): Promise<{
    connected: boolean;
    latencyMs?: number;
    error?: string;
    details?: Record<string, unknown>;
  }> {
    if (!config.channelAccessToken) {
      return { connected: false, error: 'channelAccessToken is required' };
    }

    const lineConfig: LINEConfig = {
      id: config.id,
      name: config.name,
      enabled: config.enabled ?? true,
      isDefault: config.isDefault,
      provider: 'line',
      channelAccessToken: config.channelAccessToken,
      channelSecret: config.channelSecret,
      webhookUrl: config.webhookUrl,
    };

    const start = Date.now();

    const result = await callLINEApi<LINEBotInfo>(
      '/info',
      'GET',
      undefined,
      lineConfig
    );

    const latencyMs = Date.now() - start;

    if (result.ok && result.data) {
      return {
        connected: true,
        latencyMs,
        details: {
          userId: result.data.userId,
          basicId: result.data.basicId,
          displayName: result.data.displayName,
          chatMode: result.data.chatMode,
          webhookConfigured: !!config.webhookUrl,
          signatureVerificationEnabled: !!config.channelSecret,
        },
      };
    }

    return {
      connected: false,
      latencyMs,
      error: result.error ?? 'Failed to connect to LINE Messaging API',
    };
  },
};

// EXPORTED HELPERS

/**
 * Parse all message events from a LINE webhook body.
 * Returns normalized IncomingMessage objects for supported event types.
 */
export function parseLINEWebhook(webhookBody: LINEWebhookBody): IncomingMessage[] {
  const messages: IncomingMessage[] = [];

  for (const event of webhookBody.events) {
    if (event.type !== 'message') continue;

    const parsed = inboundAdapter.parseMessage(event);
    if (parsed) {
      messages.push(parsed);
    }
  }

  return messages;
}

/**
 * Send a reply message using a replyToken from a LINE webhook event.
 * Reply tokens are valid for 30 seconds after the event is received.
 * Using reply tokens is more cost-efficient than push messages.
 */
export async function replyMessage(
  replyToken: string,
  text: string,
  config?: LINEConfig | null
): Promise<SendResult> {
  const effectiveConfig = config ?? currentConfig;
  if (!effectiveConfig?.channelAccessToken) {
    return { success: false, error: 'Channel access token not configured' };
  }

  const replyBody: LINEReplyMessageBody = {
    replyToken,
    messages: [{ type: LINEMsgType.TEXT, text }],
  };

  const result = await callLINEApi<LINEApiResponse>(
    '/message/reply',
    'POST',
    replyBody as unknown as Record<string, unknown>,
    effectiveConfig
  );

  if (result.ok) {
    const messageId = result.data?.sentMessages?.[0]?.id;
    return { success: true, messageId };
  }

  return {
    success: false,
    error: result.error ?? 'Failed to send reply message',
  };
}

// CONFIG MANAGEMENT

export function setLINEConfig(config: LINEConfig): void {
  currentConfig = config;
}

export function clearLINEConfig(): void {
  currentConfig = null;
}

// PROVIDER EXPORT

export const lineProvider: ChatProvider<LINEAccountConfig> = {
  meta,
  capabilities,
  defaultConfig: {
    provider: 'line',
    enabled: true,
  },
  configSchema: LINEAccountConfigSchema as z.ZodType<LINEAccountConfig>,
  auth: authAdapter,
  outbound: outboundAdapter,
  inbound: inboundAdapter,
  status: statusAdapter,
};

export type { LINEConfig, LINEEvent, LINESource, LINEMessageContent, LINEWebhookBody };
export { LINEMsgType, LINESourceType };
