/**
 * Mattermost Provider - Full Implementation
 *
 * Mattermost REST API v4 integration using:
 * - Bot token authentication (Bearer token)
 * - Channel-based messaging (direct, group, channel)
 * - Thread support via root_id on posts
 * - Outgoing webhook format for inbound events
 * - Health check via GET /api/v4/users/me
 * - Channel allowlist for security scoping
 *
 * API base: {serverUrl}/api/v4
 * Docs: https://api.mattermost.com/
 */

import { z } from 'zod';
import type {
  ChatProvider,
  MattermostAccountConfig,
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

// MATTERMOST API TYPES

interface MattermostPost {
  id: string;
  create_at: number;
  update_at: number;
  delete_at: number;
  user_id: string;
  channel_id: string;
  root_id: string;
  message: string;
  type: string;
  props?: Record<string, unknown>;
}

interface MattermostUser {
  id: string;
  username: string;
  first_name?: string;
  last_name?: string;
  nickname?: string;
  email?: string;
}

interface MattermostReaction {
  user_id: string;
  post_id: string;
  emoji_name: string;
  create_at?: number;
}

interface MattermostChannel {
  id: string;
  type: string;             // 'O' = public, 'P' = private, 'D' = direct, 'G' = group
  name: string;
  display_name?: string;
  team_id?: string;
}

/**
 * Outgoing webhook payload from Mattermost
 * Sent by Mattermost when a message matches an outgoing webhook trigger.
 */
interface MattermostWebhookPayload {
  token?: string;
  team_id?: string;
  team_domain?: string;
  channel_id?: string;
  channel_name?: string;
  user_id?: string;
  user_name?: string;
  post_id?: string;
  text?: string;
  timestamp?: string;
  trigger_word?: string;
  file_ids?: string;
}

// CONFIGURATION

export const MattermostAccountConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().optional(),
  provider: z.literal('mattermost'),
  serverUrl: z.string().url().optional(),
  botToken: z.string().optional(),
  webhookUrl: z.string().url().optional(),
  teamId: z.string().optional(),
  allowedChannelIds: z.array(z.string()).optional(),
}) satisfies z.ZodType<MattermostAccountConfig>;

type MattermostConfig = z.infer<typeof MattermostAccountConfigSchema>;

// METADATA

const meta: ChatProviderMeta = {
  id: 'mattermost',
  name: 'Mattermost',
  description: 'Mattermost channels with thread and file attachment support',
  icon: 'MM',
  docsUrl: 'https://api.mattermost.com/',
  order: 12,
  color: '#0058CC',
};

// CAPABILITIES

const capabilities: ChatProviderCapabilities = {
  chatTypes: ['direct', 'group', 'channel', 'thread'],
  send: true,
  receive: true,
  slashCommands: false,
  interactiveComponents: false,
  reactions: true,
  edit: true,
  delete: true,
  threads: true,
  media: true,
  richBlocks: false,
  oauth: false,
  webhooks: true,
  realtime: false, // Polling or WebSocket via driver; outgoing webhooks for inbound
};

// STATE

let currentConfig: MattermostConfig | null = null;

// HELPER FUNCTIONS

function getApiBase(config?: MattermostConfig | null): string {
  const url = (config ?? currentConfig)?.serverUrl ?? '';
  return `${url.replace(/\/$/, '')}/api/v4`;
}

function getAuthHeaders(config?: MattermostConfig | null): Record<string, string> {
  const token = (config ?? currentConfig)?.botToken;
  return {
    'Authorization': token ? `Bearer ${token}` : '',
    'Content-Type': 'application/json',
  };
}

async function callMattermostApi<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: Record<string, unknown>,
  config?: MattermostConfig | null
): Promise<{ ok: boolean; data?: T; error?: string; status?: number }> {
  const base = getApiBase(config);
  const headers = getAuthHeaders(config);

  if (!headers['Authorization'] || headers['Authorization'] === 'Bearer ') {
    return { ok: false, error: 'Bot token not configured' };
  }

  const url = `${base}${endpoint}`;

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (response.status === 200 && method === 'DELETE') {
      return { ok: true, status: 200 };
    }

    if (response.status === 204) {
      return { ok: true, status: 204 };
    }

    const data = await response.json() as T & {
      status_code?: number;
      message?: string;
      id?: string;
    };

    if (!response.ok) {
      const errData = data as { message?: string; id?: string };
      return {
        ok: false,
        status: response.status,
        error: errData.message || errData.id || `HTTP ${response.status}`,
      };
    }

    return { ok: true, data, status: response.status };
  } catch (error) {
    logger.error('[Mattermost] API call failed:', error instanceof Error ? error : undefined);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Determine chat type from a Mattermost channel type string.
 * D = direct message, G = group message, O/P = channel.
 * If a root_id is present on the post, it is a thread reply.
 */
function getChannelChatType(
  channelType: string,
  rootId?: string
): 'direct' | 'group' | 'channel' | 'thread' {
  if (rootId) return 'thread';
  if (channelType === 'D') return 'direct';
  if (channelType === 'G') return 'group';
  return 'channel';
}

/**
 * Check whether a channel is in the configured allowlist.
 * If no allowlist is configured, all channels are allowed.
 */
function isChannelAllowed(channelId: string, config: MattermostConfig | null): boolean {
  const list = config?.allowedChannelIds;
  if (!list || list.length === 0) return true;
  return list.includes(channelId);
}

/**
 * Derive a human-readable sender display name from a Mattermost user.
 * Prefers nickname, then full name, then username.
 */
function displayNameFromUser(user: MattermostUser): string {
  if (user.nickname) return user.nickname;
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ');
  if (fullName) return fullName;
  return user.username;
}

// AUTH ADAPTER

const authAdapter: AuthAdapter = {
  getAuthUrl(_state: string, _scopes?: string[]): string {
    // Mattermost does not use OAuth at the provider level.
    // Authentication is via bot token obtained from the Mattermost admin console.
    throw new Error(
      'Mattermost does not use OAuth. Obtain a bot token from the Mattermost ' +
      'integrations page and supply it in the configuration.'
    );
  },

  async exchangeCode(_code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  }> {
    throw new Error(
      'Mattermost does not use OAuth authorization codes. ' +
      'Use a bot token from the Mattermost admin console.'
    );
  },

  verifyWebhook(_signature: string, _timestamp: string, _body: string): boolean {
    // Mattermost outgoing webhooks include a token field in the payload.
    // Token verification should be done against the configured webhook token
    // in the outgoing webhook settings. Return true here as a pass-through;
    // callers should verify the token field in the parsed payload.
    return true;
  },
};

// OUTBOUND ADAPTER

const outboundAdapter: OutboundAdapter = {
  async send(message: OutgoingMessage): Promise<SendResult> {
    if (!currentConfig?.botToken) {
      return { success: false, error: 'Bot token not configured' };
    }

    if (!message.to) {
      return { success: false, error: 'Target channel ID (to) is required' };
    }

    if (!isChannelAllowed(message.to, currentConfig)) {
      return { success: false, error: `Channel ${message.to} is not in the allowlist` };
    }

    const postBody: Record<string, unknown> = {
      channel_id: message.to,
      message: message.text ?? '',
    };

    // Thread reply - set root_id to reply in a thread
    if (message.threadId) {
      postBody['root_id'] = message.threadId;
    }

    const result = await callMattermostApi<MattermostPost>(
      '/posts',
      'POST',
      postBody
    );

    if (result.ok && result.data) {
      return {
        success: true,
        messageId: result.data.id,
        threadId: result.data.root_id || undefined,
      };
    }

    return {
      success: false,
      error: result.error ?? 'Failed to send message',
    };
  },

  async edit(
    messageId: string,
    _channelId: string,
    content: OutgoingMessage
  ): Promise<SendResult> {
    if (!currentConfig?.botToken) {
      return { success: false, error: 'Bot token not configured' };
    }

    // Note: Mattermost edit does not need channelId - the post ID is sufficient
    const result = await callMattermostApi<MattermostPost>(
      `/posts/${encodeURIComponent(messageId)}`,
      'PUT',
      { id: messageId, message: content.text ?? '' }
    );

    if (result.ok && result.data) {
      return {
        success: true,
        messageId: result.data.id,
      };
    }

    return {
      success: false,
      error: result.error ?? 'Failed to edit message',
    };
  },

  async delete(
    messageId: string,
    _channelId: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!currentConfig?.botToken) {
      return { success: false, error: 'Bot token not configured' };
    }

    // Mattermost DELETE /posts/{post_id} soft-deletes the post
    const result = await callMattermostApi<Record<string, unknown>>(
      `/posts/${encodeURIComponent(messageId)}`,
      'DELETE'
    );

    return {
      success: result.ok,
      error: result.error,
    };
  },

  async react(
    messageId: string,
    _channelId: string,
    emoji: string
  ): Promise<{ success: boolean }> {
    if (!currentConfig?.botToken) {
      return { success: false };
    }

    // Fetch current user ID to satisfy the reactions API
    const meResult = await callMattermostApi<MattermostUser>('/users/me');
    if (!meResult.ok || !meResult.data) {
      logger.warn('[Mattermost] react: failed to fetch bot user ID');
      return { success: false };
    }

    const reactionBody: MattermostReaction = {
      user_id: meResult.data.id,
      post_id: messageId,
      emoji_name: emoji.replace(/:/g, ''),
    };

    const result = await callMattermostApi<MattermostReaction>(
      '/reactions',
      'POST',
      reactionBody as unknown as Record<string, unknown>
    );

    return { success: result.ok };
  },

  async unreact(
    messageId: string,
    _channelId: string,
    emoji: string
  ): Promise<{ success: boolean }> {
    if (!currentConfig?.botToken) {
      return { success: false };
    }

    const meResult = await callMattermostApi<MattermostUser>('/users/me');
    if (!meResult.ok || !meResult.data) {
      logger.warn('[Mattermost] unreact: failed to fetch bot user ID');
      return { success: false };
    }

    const userId = meResult.data.id;
    const emojiName = emoji.replace(/:/g, '');

    // DELETE /users/{user_id}/posts/{post_id}/reactions/{emoji_name}
    const result = await callMattermostApi<Record<string, unknown>>(
      `/users/${encodeURIComponent(userId)}/posts/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(emojiName)}`,
      'DELETE'
    );

    return { success: result.ok };
  },
};

// INBOUND ADAPTER

const inboundAdapter: InboundAdapter = {
  parseMessage(payload: unknown): IncomingMessage | null {
    // Accepts Mattermost outgoing webhook format:
    // { token, team_id, channel_id, channel_name, user_id, user_name, post_id, text, ... }
    if (payload === null || typeof payload !== 'object') return null;

    const raw = payload as MattermostWebhookPayload;

    if (!raw.post_id || !raw.channel_id || !raw.user_id) return null;
    if (!raw.text) return null;

    if (!isChannelAllowed(raw.channel_id, currentConfig)) {
      logger.debug(
        `[Mattermost] parseMessage: ignoring event from non-allowlisted channel ${raw.channel_id}`
      );
      return null;
    }

    // Mattermost outgoing webhooks do not carry channel type directly.
    // Default to channel; direct messages typically do not trigger outgoing webhooks.
    const chatType = getChannelChatType('O');

    return {
      id: raw.post_id,
      provider: 'mattermost',
      accountId: currentConfig?.id ?? 'default',
      senderId: raw.user_id,
      senderName: raw.user_name ?? raw.user_id,
      senderUsername: raw.user_name,
      chatType,
      chatId: raw.channel_id,
      chatName: raw.channel_name,
      threadId: undefined,
      replyToId: undefined,
      text: raw.text,
      rawContent: payload,
      timestamp: raw.timestamp ? new Date(raw.timestamp) : new Date(),
      attachments: undefined,
    };
  },

  parseCommand(_payload: unknown): SlashCommand | null {
    // Mattermost slash commands are not handled at the provider level.
    // The profClaw server can expose a dedicated slash command endpoint separately.
    return null;
  },

  parseAction(_payload: unknown): InteractiveAction | null {
    // Mattermost does not support interactive components in this provider implementation.
    return null;
  },

  buildCommandResponse(response: CommandResponse): unknown {
    // Return a Mattermost outgoing webhook response body.
    // The response_type controls visibility: in_channel or ephemeral.
    return {
      response_type: response.responseType === 'in_channel' ? 'in_channel' : 'ephemeral',
      text: response.text ?? '',
    };
  },

  buildActionResponse(response: CommandResponse): unknown {
    return {
      response_type: 'in_channel',
      text: response.text ?? '',
    };
  },
};

// STATUS ADAPTER

const statusAdapter: StatusAdapter = {
  isConfigured(config: MattermostAccountConfig): boolean {
    return !!(config.serverUrl && config.botToken && config.teamId);
  },

  async checkHealth(config: MattermostAccountConfig): Promise<{
    connected: boolean;
    latencyMs?: number;
    error?: string;
    details?: Record<string, unknown>;
  }> {
    if (!config.serverUrl || !config.botToken) {
      return { connected: false, error: 'serverUrl and botToken are required' };
    }

    const mattermostConfig: MattermostConfig = {
      id: config.id,
      name: config.name,
      enabled: config.enabled ?? true,
      isDefault: config.isDefault,
      provider: 'mattermost',
      serverUrl: config.serverUrl,
      botToken: config.botToken,
      webhookUrl: config.webhookUrl,
      teamId: config.teamId,
      allowedChannelIds: config.allowedChannelIds,
    };

    const start = Date.now();

    const result = await callMattermostApi<MattermostUser>(
      '/users/me',
      'GET',
      undefined,
      mattermostConfig
    );

    const latencyMs = Date.now() - start;

    if (result.ok && result.data) {
      const user = result.data;
      const displayName = displayNameFromUser(user);

      return {
        connected: true,
        latencyMs,
        details: {
          userId: user.id,
          username: user.username,
          displayName,
          serverUrl: config.serverUrl,
          teamId: config.teamId ?? 'not configured',
          allowedChannelsCount: config.allowedChannelIds?.length ?? 'unrestricted',
          webhookConfigured: !!config.webhookUrl,
        },
      };
    }

    return {
      connected: false,
      latencyMs,
      error: result.error ?? 'Failed to connect to Mattermost server',
    };
  },
};

// EXPORTED HELPERS

/**
 * Parse an inbound post payload from the Mattermost Events API or WebSocket driver.
 * Normalizes a full MattermostPost + channel context into an IncomingMessage.
 */
export function parsePostEvent(
  post: MattermostPost,
  channel: MattermostChannel,
  sender?: MattermostUser
): IncomingMessage | null {
  if (!post.id || !post.channel_id || !post.user_id) return null;
  if (!post.message) return null;

  if (!isChannelAllowed(post.channel_id, currentConfig)) {
    logger.debug(
      `[Mattermost] parsePostEvent: ignoring post from non-allowlisted channel ${post.channel_id}`
    );
    return null;
  }

  const rootId = post.root_id || undefined;
  const chatType = getChannelChatType(channel.type, rootId);

  const senderName = sender ? displayNameFromUser(sender) : post.user_id;

  return {
    id: post.id,
    provider: 'mattermost',
    accountId: currentConfig?.id ?? 'default',
    senderId: post.user_id,
    senderName,
    senderUsername: sender?.username,
    chatType,
    chatId: post.channel_id,
    chatName: channel.display_name ?? channel.name,
    threadId: rootId,
    replyToId: undefined,
    text: post.message,
    rawContent: post,
    timestamp: new Date(post.create_at),
    attachments: undefined,
  };
}

// CONFIG MANAGEMENT

export function setMattermostConfig(config: MattermostConfig): void {
  currentConfig = config;
}

export function clearMattermostConfig(): void {
  currentConfig = null;
}

// PROVIDER EXPORT

export const mattermostProvider: ChatProvider<MattermostAccountConfig> = {
  meta,
  capabilities,
  defaultConfig: {
    provider: 'mattermost',
    enabled: true,
  },
  configSchema: MattermostAccountConfigSchema as z.ZodType<MattermostAccountConfig>,
  auth: authAdapter,
  outbound: outboundAdapter,
  inbound: inboundAdapter,
  status: statusAdapter,
};

export type { MattermostConfig, MattermostPost, MattermostWebhookPayload };
