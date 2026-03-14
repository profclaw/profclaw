/**
 * Telegram Provider - Full Implementation
 *
 * Secure Telegram Bot integration with:
 * - Webhook signature verification (X-Telegram-Bot-Api-Secret-Token)
 * - Message sending via Bot API
 * - Bot commands (/command syntax)
 * - Inline keyboards for interactive UI
 * - Reply-to for threaded conversations
 */

import { z } from 'zod';
import { timingSafeEqual } from 'crypto';
import type {
  ChatProvider,
  TelegramAccountConfig,
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
import { chunkForPlatform } from '../../format/chunk.js';

// TELEGRAM API TYPES

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  entities?: Array<{
    type: string;
    offset: number;
    length: number;
  }>;
  reply_to_message?: TelegramMessage;
  photo?: Array<{ file_id: string; width: number; height: number }>;
  document?: { file_id: string; file_name?: string; mime_type?: string };
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  chat_instance: string;
  data?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

// CONFIGURATION

const TelegramAccountConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().optional(),
  provider: z.literal('telegram'),
  botToken: z.string().optional(),
  webhookUrl: z.string().optional(),
  webhookSecret: z.string().optional(),
  // Security: allowlists
  allowedUserIds: z.array(z.number()).optional(),
  allowedChatIds: z.array(z.number()).optional(),
}) satisfies z.ZodType<TelegramAccountConfig & {
  allowedUserIds?: number[];
  allowedChatIds?: number[];
}>;

type TelegramConfig = z.infer<typeof TelegramAccountConfigSchema>;

// METADATA

const meta: ChatProviderMeta = {
  id: 'telegram',
  name: 'Telegram',
  description: 'Telegram Bot integration with commands and inline keyboards',
  icon: '✈️',
  docsUrl: 'https://core.telegram.org/bots/api',
  order: 3,
  color: '#0088CC',
};

// CAPABILITIES

const capabilities: ChatProviderCapabilities = {
  chatTypes: ['direct', 'group', 'channel'],
  send: true,
  receive: true,
  slashCommands: true,
  interactiveComponents: true,
  reactions: true,
  edit: true,
  delete: true,
  threads: false, // Telegram uses reply-to
  media: true,
  richBlocks: false, // Uses HTML/Markdown
  oauth: false,
  webhooks: true,
  realtime: true, // Long polling available
};

// HELPER FUNCTIONS

const TELEGRAM_API_BASE = 'https://api.telegram.org';

async function callTelegramApi<T>(
  botToken: string,
  method: string,
  params?: Record<string, unknown>
): Promise<{ ok: boolean; result?: T; description?: string }> {
  const url = `${TELEGRAM_API_BASE}/bot${botToken}/${method}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {}),
    });

    const data = await response.json() as { ok: boolean; result?: T; description?: string };
    return data;
  } catch (error) {
    logger.error('[Telegram] API call failed:', error instanceof Error ? error : undefined);
    return {
      ok: false,
      description: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

function getChatType(type: TelegramChat['type']): 'direct' | 'group' | 'channel' {
  switch (type) {
    case 'private':
      return 'direct';
    case 'group':
    case 'supergroup':
      return 'group';
    case 'channel':
      return 'channel';
    default:
      return 'group';
  }
}

function formatUserName(user: TelegramUser): string {
  if (user.username) return `@${user.username}`;
  const parts = [user.first_name, user.last_name].filter(Boolean);
  return parts.join(' ') || `User ${user.id}`;
}

// AUTH ADAPTER

const authAdapter: AuthAdapter = {
  getAuthUrl(): string {
    // Telegram bots don't use OAuth - token from BotFather
    throw new Error('Telegram uses bot tokens from @BotFather, not OAuth');
  },

  async exchangeCode(): Promise<never> {
    throw new Error('Telegram uses bot tokens from @BotFather, not OAuth');
  },

  /**
   * Verify webhook signature
   * Telegram uses X-Telegram-Bot-Api-Secret-Token header
   */
  verifyWebhook(signature: string, _timestamp: string, _body: string): boolean {
    // For Telegram, the signature IS the secret token
    // The caller should have already extracted it from the header
    // and should compare it against the configured secret
    // This adapter method is used for the interface, actual verification
    // is done in the route handler
    return !!signature;
  },
};

/**
 * Verify Telegram webhook request
 * Uses timing-safe comparison to prevent timing attacks
 */
export function verifyTelegramWebhook(
  secretToken: string | undefined,
  requestSecretToken: string | undefined
): boolean {
  if (!secretToken || !requestSecretToken) {
    return !secretToken; // If no secret configured, allow all (not recommended)
  }

  try {
    const expected = Buffer.from(secretToken);
    const received = Buffer.from(requestSecretToken);
    if (expected.length !== received.length) return false;
    return timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

/**
 * Check if sender is allowed based on allowlists
 */
export function isTelegramSenderAllowed(
  config: TelegramConfig,
  userId?: number,
  chatId?: number
): { allowed: boolean; reason?: string } {
  const { allowedUserIds, allowedChatIds } = config;

  // If no allowlists configured, allow all
  if (!allowedUserIds?.length && !allowedChatIds?.length) {
    return { allowed: true };
  }

  // Check user allowlist
  if (allowedUserIds?.length && userId) {
    if (!allowedUserIds.includes(userId)) {
      return { allowed: false, reason: `User ${userId} not in allowlist` };
    }
  }

  // Check chat allowlist
  if (allowedChatIds?.length && chatId) {
    if (!allowedChatIds.includes(chatId)) {
      return { allowed: false, reason: `Chat ${chatId} not in allowlist` };
    }
  }

  return { allowed: true };
}

// OUTBOUND ADAPTER

let currentConfig: TelegramConfig | null = null;

function setConfig(config: TelegramConfig) {
  currentConfig = config;
}

function clearConfig() {
  currentConfig = null;
}

const outboundAdapter: OutboundAdapter = {
  async send(message: OutgoingMessage): Promise<SendResult> {
    if (!currentConfig?.botToken) {
      return { success: false, error: 'Bot token not configured' };
    }

    const textChunks = message.text
      ? chunkForPlatform(message.text, 'telegram', { mode: 'newline' }).chunks
      : [];
    const chunks = textChunks.length > 0 ? textChunks : [undefined];
    let replyToId = message.replyToId ? parseInt(message.replyToId, 10) : undefined;
    let firstMessage: TelegramMessage | undefined;

    for (const [index, chunk] of chunks.entries()) {
      const params: Record<string, unknown> = {
        chat_id: message.to,
        parse_mode: 'HTML',
      };

      if (chunk !== undefined) {
        params.text = chunk;
      }
      if (replyToId) {
        params.reply_to_message_id = replyToId;
      }
      if (message.blocks && Array.isArray(message.blocks) && index === 0) {
        const firstBlock = message.blocks[0] as Record<string, unknown> | undefined;
        if (firstBlock && 'inline_keyboard' in firstBlock) {
          params.reply_markup = firstBlock as unknown as TelegramInlineKeyboardMarkup;
        }
      }

      const result = await callTelegramApi<TelegramMessage>(
        currentConfig.botToken,
        'sendMessage',
        params
      );

      if (!result.ok || !result.result) {
        return {
          success: false,
          error: result.description || 'Failed to send message',
        };
      }

      if (!firstMessage) {
        firstMessage = result.result;
        replyToId = result.result.message_id;
      }
    }

    return {
      success: true,
      messageId: firstMessage ? String(firstMessage.message_id) : undefined,
      raw: { chunkCount: chunks.length },
    };
  },

  async edit(messageId: string, channelId: string, content: OutgoingMessage): Promise<SendResult> {
    if (!currentConfig?.botToken) {
      return { success: false, error: 'Bot token not configured' };
    }

    const params: Record<string, unknown> = {
      chat_id: channelId,
      message_id: parseInt(messageId, 10),
      parse_mode: 'HTML',
    };

    if (content.text) {
      params.text = content.text;
    }

    if (content.blocks) {
      params.reply_markup = content.blocks;
    }

    const result = await callTelegramApi<TelegramMessage>(
      currentConfig.botToken,
      'editMessageText',
      params
    );

    return {
      success: result.ok,
      messageId: result.ok ? messageId : undefined,
      error: result.description,
    };
  },

  async delete(messageId: string, channelId: string): Promise<{ success: boolean; error?: string }> {
    if (!currentConfig?.botToken) {
      return { success: false, error: 'Bot token not configured' };
    }

    const result = await callTelegramApi<boolean>(
      currentConfig.botToken,
      'deleteMessage',
      {
        chat_id: channelId,
        message_id: parseInt(messageId, 10),
      }
    );

    return {
      success: result.ok,
      error: result.description,
    };
  },

  async react(messageId: string, channelId: string, emoji: string): Promise<{ success: boolean }> {
    if (!currentConfig?.botToken) {
      return { success: false };
    }

    // Telegram's setMessageReaction API
    const result = await callTelegramApi<boolean>(
      currentConfig.botToken,
      'setMessageReaction',
      {
        chat_id: channelId,
        message_id: parseInt(messageId, 10),
        reaction: [{ type: 'emoji', emoji }],
      }
    );

    return { success: result.ok };
  },

  async unreact(messageId: string, channelId: string): Promise<{ success: boolean }> {
    if (!currentConfig?.botToken) {
      return { success: false };
    }

    // Remove all reactions
    const result = await callTelegramApi<boolean>(
      currentConfig.botToken,
      'setMessageReaction',
      {
        chat_id: channelId,
        message_id: parseInt(messageId, 10),
        reaction: [],
      }
    );

    return { success: result.ok };
  },
};

// INBOUND ADAPTER

const inboundAdapter: InboundAdapter = {
  parseMessage(payload: unknown): IncomingMessage | null {
    const update = payload as TelegramUpdate;
    const message = update.message || update.edited_message;

    if (!message || !message.from) return null;

    return {
      id: String(message.message_id),
      provider: 'telegram',
      accountId: currentConfig?.id || 'default',
      senderId: String(message.from.id),
      senderName: formatUserName(message.from),
      senderUsername: message.from.username,
      chatType: getChatType(message.chat.type),
      chatId: String(message.chat.id),
      chatName: message.chat.title || message.chat.first_name,
      replyToId: message.reply_to_message
        ? String(message.reply_to_message.message_id)
        : undefined,
      text: message.text || '',
      rawContent: update,
      timestamp: new Date(message.date * 1000),
      editedAt: update.edited_message ? new Date() : undefined,
      attachments: parseAttachments(message),
    };
  },

  parseCommand(payload: unknown): SlashCommand | null {
    const update = payload as TelegramUpdate;
    const message = update.message;

    if (!message || !message.from || !message.text) return null;

    // Check for bot command entity
    const commandEntity = message.entities?.find(e => e.type === 'bot_command' && e.offset === 0);
    if (!commandEntity) return null;

    const fullCommand = message.text.slice(0, commandEntity.length);
    const text = message.text.slice(commandEntity.length).trim();

    // Handle commands like /help@BotName
    const [command] = fullCommand.split('@');

    return {
      provider: 'telegram',
      accountId: currentConfig?.id || 'default',
      command,
      text,
      userId: String(message.from.id),
      userName: formatUserName(message.from),
      channelId: String(message.chat.id),
      channelName: message.chat.title,
      chatType: getChatType(message.chat.type),
      raw: update,
    };
  },

  parseAction(payload: unknown): InteractiveAction | null {
    const update = payload as TelegramUpdate;
    const callbackQuery = update.callback_query;

    if (!callbackQuery) return null;

    return {
      provider: 'telegram',
      accountId: currentConfig?.id || 'default',
      type: 'button',
      actionId: callbackQuery.id,
      value: callbackQuery.data,
      userId: String(callbackQuery.from.id),
      userName: formatUserName(callbackQuery.from),
      channelId: callbackQuery.message ? String(callbackQuery.message.chat.id) : undefined,
      messageId: callbackQuery.message ? String(callbackQuery.message.message_id) : undefined,
      raw: update,
    };
  },

  buildCommandResponse(response: CommandResponse): unknown {
    const result: Record<string, unknown> = {
      method: 'sendMessage',
      parse_mode: 'HTML',
    };

    if (response.text) {
      result.text = response.text;
    }

    // Convert blocks to Telegram inline keyboard
    if (response.blocks && Array.isArray(response.blocks)) {
      result.reply_markup = {
        inline_keyboard: response.blocks,
      };
    }

    return result;
  },

  buildActionResponse(response: CommandResponse): unknown {
    // For callback queries, we can either answer the query
    // or edit the original message
    return {
      method: response.text ? 'answerCallbackQuery' : 'editMessageText',
      text: response.text,
      show_alert: response.responseType === 'ephemeral',
    };
  },
};

function parseAttachments(message: TelegramMessage) {
  const attachments: IncomingMessage['attachments'] = [];

  if (message.photo && message.photo.length > 0) {
    // Get highest resolution photo
    const photo = message.photo[message.photo.length - 1];
    attachments.push({
      type: 'image',
      name: `photo_${photo.file_id}`,
    });
  }

  if (message.document) {
    attachments.push({
      type: 'file',
      name: message.document.file_name,
      mimeType: message.document.mime_type,
    });
  }

  return attachments.length > 0 ? attachments : undefined;
}

// STATUS ADAPTER

const statusAdapter: StatusAdapter = {
  isConfigured(config: TelegramAccountConfig): boolean {
    return !!config.botToken;
  },

  async checkHealth(config: TelegramAccountConfig): Promise<{
    connected: boolean;
    latencyMs?: number;
    error?: string;
    details?: Record<string, unknown>;
  }> {
    if (!config.botToken) {
      return { connected: false, error: 'Bot token not configured' };
    }

    const start = Date.now();
    const result = await callTelegramApi<{
      id: number;
      is_bot: boolean;
      first_name: string;
      username: string;
    }>(config.botToken, 'getMe');

    const latencyMs = Date.now() - start;

    if (result.ok && result.result) {
      return {
        connected: true,
        latencyMs,
        details: {
          botId: result.result.id,
          botUsername: result.result.username,
          botName: result.result.first_name,
        },
      };
    }

    return {
      connected: false,
      latencyMs,
      error: result.description || 'Failed to connect',
    };
  },
};

// WEBHOOK MANAGEMENT

/**
 * Set webhook URL for the bot
 */
export async function setTelegramWebhook(
  botToken: string,
  webhookUrl: string,
  secretToken?: string
): Promise<{ success: boolean; error?: string }> {
  const params: Record<string, unknown> = {
    url: webhookUrl,
    allowed_updates: ['message', 'edited_message', 'callback_query'],
  };

  if (secretToken) {
    params.secret_token = secretToken;
  }

  const result = await callTelegramApi<boolean>(botToken, 'setWebhook', params);

  return {
    success: result.ok,
    error: result.description,
  };
}

/**
 * Remove webhook (switch to polling)
 */
export async function deleteTelegramWebhook(
  botToken: string
): Promise<{ success: boolean; error?: string }> {
  const result = await callTelegramApi<boolean>(botToken, 'deleteWebhook');
  return {
    success: result.ok,
    error: result.description,
  };
}

/**
 * Get webhook info
 */
export async function getTelegramWebhookInfo(
  botToken: string
): Promise<{
  url: string;
  hasCustomCertificate: boolean;
  pendingUpdateCount: number;
  lastErrorDate?: number;
  lastErrorMessage?: string;
} | null> {
  const result = await callTelegramApi<{
    url: string;
    has_custom_certificate: boolean;
    pending_update_count: number;
    last_error_date?: number;
    last_error_message?: string;
  }>(botToken, 'getWebhookInfo');

  if (result.ok && result.result) {
    return {
      url: result.result.url,
      hasCustomCertificate: result.result.has_custom_certificate,
      pendingUpdateCount: result.result.pending_update_count,
      lastErrorDate: result.result.last_error_date,
      lastErrorMessage: result.result.last_error_message,
    };
  }

  return null;
}

/**
 * Answer a callback query (inline keyboard button click)
 */
export async function answerTelegramCallbackQuery(
  botToken: string,
  callbackQueryId: string,
  text?: string,
  showAlert = false
): Promise<{ success: boolean }> {
  const result = await callTelegramApi<boolean>(botToken, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert,
  });

  return { success: result.ok };
}

// PROVIDER EXPORT

export const telegramProvider: ChatProvider<TelegramAccountConfig> = {
  meta,
  capabilities,
  defaultConfig: {
    provider: 'telegram',
    enabled: true,
  },
  configSchema: TelegramAccountConfigSchema as z.ZodType<TelegramAccountConfig>,
  auth: authAdapter,
  outbound: outboundAdapter,
  inbound: inboundAdapter,
  status: statusAdapter,
};

// Export helpers to set/clear config for outbound calls
export { setConfig as setTelegramConfig, clearConfig as clearTelegramConfig };

export { TelegramAccountConfigSchema };
export type { TelegramConfig, TelegramUpdate, TelegramMessage, TelegramCallbackQuery };
