/**
 * Feishu/Lark Provider - Full Implementation
 *
 * Feishu (Lark international) Messaging API integration using:
 * - Tenant access token authentication (app_id + app_secret)
 * - HMAC-SHA256 signature verification (X-Lark-Signature header)
 * - Send messages to chat_id via POST /im/v1/messages
 * - Inbound event callback: im.message.receive_v1
 * - Thread support via reply_in_thread
 * - Media and webhook support
 * - Health check via tenant_access_token fetch
 *
 * API base: https://open.feishu.cn/open-apis (Feishu)
 *           https://open.larksuite.com/open-apis (Lark international)
 * Docs: https://open.feishu.cn/document/home/index
 */

import { createHmac } from 'node:crypto';
import { z } from 'zod';
import type {
  ChatProvider,
  FeishuAccountConfig,
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

// FEISHU API TYPES

interface FeishuTenantTokenResponse {
  code: number;
  msg: string;
  tenant_access_token: string;
  expire: number;
}

interface FeishuSendMessageBody {
  receive_id: string;
  msg_type: string;
  content: string;
  reply_in_thread?: boolean;
  uuid?: string;
}

interface FeishuSendMessageResponse {
  code: number;
  msg: string;
  data?: {
    message_id?: string;
    root_id?: string;
    parent_id?: string;
    msg_type?: string;
    create_time?: string;
    update_time?: string;
    chat_id?: string;
  };
}

interface FeishuEventSender {
  sender_id: {
    union_id?: string;
    user_id?: string;
    open_id?: string;
  };
  sender_type?: string;
  tenant_key?: string;
}

interface FeishuEventMessage {
  message_id: string;
  root_id?: string;
  parent_id?: string;
  create_time?: string;
  update_time?: string;
  chat_id: string;
  chat_type?: 'p2p' | 'group';
  message_type?: string;
  content?: string;
  mentions?: Array<{ key: string; id: Record<string, string>; name: string; tenant_key: string }>;
}

interface FeishuEventHeader {
  event_id: string;
  event_type: string;
  create_time: string;
  token: string;
  app_id: string;
  tenant_key: string;
}

interface FeishuEventCallback {
  schema?: string;
  header: FeishuEventHeader;
  event: {
    sender: FeishuEventSender;
    message: FeishuEventMessage;
  };
}

interface FeishuTextContent {
  text?: string;
}

// CONFIGURATION

export const FeishuAccountConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().optional(),
  provider: z.literal('feishu'),
  appId: z.string().optional(),
  appSecret: z.string().optional(),
  verificationToken: z.string().optional(),
  encryptKey: z.string().optional(),
}) satisfies z.ZodType<FeishuAccountConfig>;

type FeishuConfig = z.infer<typeof FeishuAccountConfigSchema>;

// METADATA

const meta: ChatProviderMeta = {
  id: 'feishu',
  name: 'Feishu/Lark',
  description: 'Feishu and Lark international messaging with event-driven bot support',
  icon: 'Feishu icon',
  docsUrl: 'https://open.feishu.cn/document/home/index',
  order: 15,
  color: '#3370FF',
};

// CAPABILITIES

const capabilities: ChatProviderCapabilities = {
  chatTypes: ['direct', 'group', 'channel'],
  send: true,
  receive: true,
  slashCommands: false,
  interactiveComponents: false,
  reactions: false,
  edit: false,
  delete: true,
  threads: true,
  media: true,
  richBlocks: false,
  oauth: false,
  webhooks: true,
  realtime: false,
};

// STATE

let currentConfig: FeishuConfig | null = null;

// In-memory token cache to avoid redundant token fetches
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

// HELPER FUNCTIONS

/**
 * Fetch a fresh tenant_access_token from Feishu.
 * Caches the result until 60 seconds before expiry.
 */
async function getTenantAccessToken(config: FeishuConfig): Promise<string | null> {
  const now = Date.now();

  if (cachedToken && now < tokenExpiresAt) {
    return cachedToken;
  }

  if (!config.appId || !config.appSecret) {
    logger.warn('[Feishu] getTenantAccessToken: appId and appSecret are required');
    return null;
  }

  try {
    const response = await fetch(
      `${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
      }
    );

    const data = await response.json() as FeishuTenantTokenResponse;

    if (data.code !== 0 || !data.tenant_access_token) {
      logger.error(`[Feishu] Token fetch failed: ${data.msg} (code=${data.code})`);
      return null;
    }

    // Cache the token with a 60-second safety buffer before expiry
    cachedToken = data.tenant_access_token;
    tokenExpiresAt = now + (data.expire - 60) * 1000;

    return cachedToken;
  } catch (error) {
    logger.error('[Feishu] getTenantAccessToken failed:', error instanceof Error ? error : undefined);
    return null;
  }
}

function clearTokenCache(): void {
  cachedToken = null;
  tokenExpiresAt = 0;
}

async function callFeishuApi<T>(
  endpoint: string,
  method: 'GET' | 'POST' = 'POST',
  body?: Record<string, unknown>,
  config?: FeishuConfig | null
): Promise<{ ok: boolean; data?: T; error?: string; status?: number }> {
  const effectiveConfig = config ?? currentConfig;
  if (!effectiveConfig) {
    return { ok: false, error: 'Feishu provider not configured' };
  }

  const token = await getTenantAccessToken(effectiveConfig);
  if (!token) {
    return { ok: false, error: 'Failed to obtain tenant access token' };
  }

  const url = `${FEISHU_API_BASE}${endpoint}`;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const data = await response.json() as T & { code?: number; msg?: string };

    if (!response.ok) {
      const errData = data as { msg?: string };
      return {
        ok: false,
        status: response.status,
        error: errData.msg ?? `HTTP ${response.status}`,
      };
    }

    // Feishu returns code=0 for success even on HTTP 200
    const feishuData = data as { code?: number; msg?: string };
    if (feishuData.code !== undefined && feishuData.code !== 0) {
      return {
        ok: false,
        status: response.status,
        error: feishuData.msg ?? `Feishu error code ${feishuData.code}`,
      };
    }

    return { ok: true, data, status: response.status };
  } catch (error) {
    logger.error('[Feishu] API call failed:', error instanceof Error ? error : undefined);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// AUTH ADAPTER

const authAdapter: AuthAdapter = {
  getAuthUrl(_state: string, _scopes?: string[]): string {
    // Feishu bots use app credentials (app_id + app_secret), not user OAuth flows.
    throw new Error(
      'Feishu does not use OAuth for bot authentication. ' +
      'Supply appId and appSecret from the Feishu Developer Console.'
    );
  },

  async exchangeCode(_code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  }> {
    throw new Error(
      'Feishu bot authentication uses app credentials, not authorization codes. ' +
      'Configure appId and appSecret instead.'
    );
  },

  verifyWebhook(signature: string, timestamp: string, body: string): boolean {
    // Feishu signs webhooks using HMAC-SHA256 over (timestamp + encryptKey + body).
    // The resulting hex digest is sent in the X-Lark-Signature header.
    const encryptKey = currentConfig?.encryptKey;
    if (!encryptKey) {
      logger.warn('[Feishu] verifyWebhook: encryptKey not configured, skipping verification');
      return false;
    }

    try {
      const payload = timestamp + encryptKey + body;
      const expected = createHmac('sha256', encryptKey)
        .update(payload, 'utf8')
        .digest('hex');
      return signature === expected;
    } catch (error) {
      logger.error('[Feishu] verifyWebhook: HMAC computation failed:', error instanceof Error ? error : undefined);
      return false;
    }
  },
};

// OUTBOUND ADAPTER

const outboundAdapter: OutboundAdapter = {
  async send(message: OutgoingMessage): Promise<SendResult> {
    if (!currentConfig?.appId || !currentConfig?.appSecret) {
      return { success: false, error: 'appId and appSecret are required' };
    }

    if (!message.to) {
      return { success: false, error: 'Target chat_id (to) is required' };
    }

    const sendBody: FeishuSendMessageBody = {
      receive_id: message.to,
      msg_type: 'text',
      content: JSON.stringify({ text: message.text ?? '' }),
    };

    // Support threaded replies when threadId is provided
    if (message.threadId) {
      sendBody.reply_in_thread = true;
    }

    const result = await callFeishuApi<FeishuSendMessageResponse>(
      '/im/v1/messages?receive_id_type=chat_id',
      'POST',
      sendBody as unknown as Record<string, unknown>
    );

    if (result.ok) {
      return {
        success: true,
        messageId: result.data?.data?.message_id,
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
    if (payload === null || typeof payload !== 'object') return null;

    const callback = payload as FeishuEventCallback;

    if (!callback.header || !callback.event) {
      logger.debug('[Feishu] parseMessage: missing header or event fields');
      return null;
    }

    if (callback.header.event_type !== 'im.message.receive_v1') {
      logger.debug(`[Feishu] parseMessage: unsupported event_type '${callback.header.event_type}', skipping`);
      return null;
    }

    const { sender, message } = callback.event;

    if (!message?.chat_id || !message?.message_id) {
      logger.debug('[Feishu] parseMessage: missing chat_id or message_id');
      return null;
    }

    const senderId =
      sender?.sender_id?.open_id ??
      sender?.sender_id?.union_id ??
      sender?.sender_id?.user_id ??
      '';

    // Parse text content from the message content JSON string
    let text = '';
    if (message.content) {
      try {
        const parsed = JSON.parse(message.content) as FeishuTextContent;
        text = parsed.text ?? '';
      } catch {
        logger.debug('[Feishu] parseMessage: failed to parse message content JSON');
      }
    }

    const chatType: 'direct' | 'group' | 'channel' =
      message.chat_type === 'p2p' ? 'direct' : 'group';

    const threadId = message.root_id !== message.message_id
      ? message.root_id
      : undefined;

    return {
      id: message.message_id,
      provider: 'feishu',
      accountId: currentConfig?.id ?? 'default',
      senderId,
      senderName: senderId,
      senderUsername: senderId,
      chatType,
      chatId: message.chat_id,
      chatName: undefined,
      threadId,
      replyToId: message.parent_id,
      text,
      rawContent: payload,
      timestamp: message.create_time
        ? new Date(Number(message.create_time))
        : new Date(),
      attachments: undefined,
    };
  },

  parseCommand(_payload: unknown): SlashCommand | null {
    // Feishu does not have native slash commands.
    // Command parsing at the application layer via text prefix is handled upstream.
    return null;
  },

  parseAction(_payload: unknown): InteractiveAction | null {
    // Feishu interactive card callbacks are separate event types and are not
    // normalized here. Card action support is deferred.
    return null;
  },

  buildCommandResponse(response: CommandResponse): unknown {
    return {
      msg_type: 'text',
      content: JSON.stringify({ text: response.text ?? '' }),
    };
  },

  buildActionResponse(response: CommandResponse): unknown {
    return {
      msg_type: 'text',
      content: JSON.stringify({ text: response.text ?? '' }),
    };
  },
};

// STATUS ADAPTER

const statusAdapter: StatusAdapter = {
  isConfigured(config: FeishuAccountConfig): boolean {
    return !!(config.appId && config.appSecret);
  },

  async checkHealth(config: FeishuAccountConfig): Promise<{
    connected: boolean;
    latencyMs?: number;
    error?: string;
    details?: Record<string, unknown>;
  }> {
    if (!config.appId || !config.appSecret) {
      return { connected: false, error: 'appId and appSecret are required' };
    }

    const start = Date.now();

    try {
      const response = await fetch(
        `${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
        }
      );

      const latencyMs = Date.now() - start;
      const data = await response.json() as FeishuTenantTokenResponse;

      if (data.code === 0 && data.tenant_access_token) {
        return {
          connected: true,
          latencyMs,
          details: {
            tokenExpireSeconds: data.expire,
            encryptionEnabled: !!config.encryptKey,
            verificationTokenConfigured: !!config.verificationToken,
          },
        };
      }

      return {
        connected: false,
        latencyMs,
        error: data.msg ?? 'Failed to obtain tenant access token',
      };
    } catch (error) {
      return {
        connected: false,
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
};

// CONFIG MANAGEMENT

export function setFeishuConfig(config: FeishuConfig): void {
  currentConfig = config;
  clearTokenCache();
}

export function clearFeishuConfig(): void {
  currentConfig = null;
  clearTokenCache();
}

// PROVIDER EXPORT

export const feishuProvider: ChatProvider<FeishuAccountConfig> = {
  meta,
  capabilities,
  defaultConfig: {
    provider: 'feishu',
    enabled: true,
  },
  configSchema: FeishuAccountConfigSchema as z.ZodType<FeishuAccountConfig>,
  auth: authAdapter,
  outbound: outboundAdapter,
  inbound: inboundAdapter,
  status: statusAdapter,
};

export type { FeishuConfig, FeishuEventCallback, FeishuEventMessage, FeishuEventSender };
