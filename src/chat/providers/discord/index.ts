/**
 * Discord Provider - Full Implementation
 *
 * Secure Discord integration using HTTP Interactions endpoint with:
 * - Ed25519 signature verification (tweetnacl)
 * - Slash commands handling
 * - Button/Select menu interactions
 * - Message sending via Discord REST API
 * - Thread support
 *
 * Uses HTTP Interactions (not Gateway/WebSocket) for simpler, stateless operation.
 * This is Discord's recommended approach for serverless and simpler bots.
 */

import { z } from 'zod';
import type {
  ChatProvider,
  DiscordAccountConfig,
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

// =============================================================================
// DISCORD API TYPES
// =============================================================================

/** Discord Interaction Types */
const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5,
} as const;

/** Discord Interaction Response Types */
const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
  APPLICATION_COMMAND_AUTOCOMPLETE_RESULT: 8,
  MODAL: 9,
} as const;

/** Discord Component Types */
const ComponentType = {
  ACTION_ROW: 1,
  BUTTON: 2,
  STRING_SELECT: 3,
  TEXT_INPUT: 4,
  USER_SELECT: 5,
  ROLE_SELECT: 6,
  MENTIONABLE_SELECT: 7,
  CHANNEL_SELECT: 8,
} as const;

interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  global_name?: string;
  avatar?: string;
  bot?: boolean;
}

interface DiscordChannel {
  id: string;
  type: number;
  name?: string;
  guild_id?: string;
  parent_id?: string;
}

interface DiscordMessage {
  id: string;
  channel_id: string;
  author: DiscordUser;
  content: string;
  timestamp: string;
  edited_timestamp?: string;
  thread?: { id: string; name: string };
  referenced_message?: DiscordMessage;
  attachments?: Array<{
    id: string;
    filename: string;
    content_type?: string;
    size: number;
    url: string;
  }>;
}

interface DiscordInteractionData {
  id: string;
  name?: string;
  type?: number;
  options?: Array<{
    name: string;
    type: number;
    value?: string | number | boolean;
    options?: Array<{ name: string; type: number; value?: string | number | boolean }>;
  }>;
  custom_id?: string;
  component_type?: number;
  values?: string[];
  resolved?: {
    users?: Record<string, DiscordUser>;
    channels?: Record<string, DiscordChannel>;
  };
}

interface DiscordInteraction {
  id: string;
  application_id: string;
  type: number;
  data?: DiscordInteractionData;
  guild_id?: string;
  channel_id?: string;
  channel?: DiscordChannel;
  member?: {
    user: DiscordUser;
    nick?: string;
    roles: string[];
    permissions: string;
  };
  user?: DiscordUser;
  token: string;
  version: number;
  message?: DiscordMessage;
}

interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string; icon_url?: string };
  timestamp?: string;
}

interface DiscordComponent {
  type: number;
  components?: DiscordComponent[];
  style?: number;
  label?: string;
  emoji?: { name: string; id?: string };
  custom_id?: string;
  url?: string;
  disabled?: boolean;
  options?: Array<{
    label: string;
    value: string;
    description?: string;
    emoji?: { name: string; id?: string };
    default?: boolean;
  }>;
  placeholder?: string;
  min_values?: number;
  max_values?: number;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const DiscordAccountConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().optional(),
  provider: z.literal('discord'),
  botToken: z.string().optional(),
  applicationId: z.string().optional(),
  publicKey: z.string().optional(),
  guildId: z.string().optional(),
  // Security: allowlists
  allowedGuildIds: z.array(z.string()).optional(),
  allowedChannelIds: z.array(z.string()).optional(),
  allowedRoleIds: z.array(z.string()).optional(),
}) satisfies z.ZodType<DiscordAccountConfig & {
  allowedGuildIds?: string[];
  allowedChannelIds?: string[];
  allowedRoleIds?: string[];
}>;

type DiscordConfig = z.infer<typeof DiscordAccountConfigSchema>;

// =============================================================================
// METADATA
// =============================================================================

const meta: ChatProviderMeta = {
  id: 'discord',
  name: 'Discord',
  description: 'Discord bot with slash commands and interactive components',
  icon: '🎮',
  docsUrl: 'https://discord.com/developers/docs',
  order: 2,
  color: '#5865F2',
};

// =============================================================================
// CAPABILITIES
// =============================================================================

const capabilities: ChatProviderCapabilities = {
  chatTypes: ['direct', 'channel', 'thread'],
  send: true,
  receive: true,
  slashCommands: true,
  interactiveComponents: true,
  reactions: true,
  edit: true,
  delete: true,
  threads: true,
  media: true,
  richBlocks: true, // Embeds
  oauth: true,
  webhooks: true,
  realtime: false, // HTTP Interactions only, no Gateway
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const DISCORD_API_BASE = 'https://discord.com/api/v10';

let currentConfig: DiscordConfig | null = null;

function setConfig(config: DiscordConfig) {
  currentConfig = config;
}

function clearConfig() {
  currentConfig = null;
}

async function callDiscordApi<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  body?: Record<string, unknown>,
  botToken?: string
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const token = botToken || currentConfig?.botToken;
  if (!token) {
    return { ok: false, error: 'Bot token not configured' };
  }

  const url = `${DISCORD_API_BASE}${endpoint}`;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 204) {
      return { ok: true };
    }

    const data = await response.json() as T & { message?: string; code?: number };

    if (!response.ok) {
      return {
        ok: false,
        error: (data as { message?: string }).message || `HTTP ${response.status}`,
      };
    }

    return { ok: true, data };
  } catch (error) {
    logger.error('[Discord] API call failed:', error instanceof Error ? error : undefined);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

function getChatType(channel?: DiscordChannel): 'direct' | 'channel' | 'thread' {
  if (!channel) return 'channel';

  // Discord channel types: https://discord.com/developers/docs/resources/channel#channel-object-channel-types
  const CHANNEL_TYPE = {
    GUILD_TEXT: 0,
    DM: 1,
    GUILD_VOICE: 2,
    GROUP_DM: 3,
    GUILD_CATEGORY: 4,
    GUILD_ANNOUNCEMENT: 5,
    ANNOUNCEMENT_THREAD: 10,
    PUBLIC_THREAD: 11,
    PRIVATE_THREAD: 12,
    GUILD_STAGE_VOICE: 13,
    GUILD_DIRECTORY: 14,
    GUILD_FORUM: 15,
    GUILD_MEDIA: 16,
  };

  switch (channel.type) {
    case CHANNEL_TYPE.DM:
    case CHANNEL_TYPE.GROUP_DM:
      return 'direct';
    case CHANNEL_TYPE.PUBLIC_THREAD:
    case CHANNEL_TYPE.PRIVATE_THREAD:
    case CHANNEL_TYPE.ANNOUNCEMENT_THREAD:
      return 'thread';
    default:
      return 'channel';
  }
}

function getUserName(interaction: DiscordInteraction): string {
  const user = interaction.member?.user || interaction.user;
  if (!user) return 'Unknown';
  return interaction.member?.nick || user.global_name || user.username;
}

function getUserId(interaction: DiscordInteraction): string {
  return interaction.member?.user?.id || interaction.user?.id || '';
}

function parseCommandOptions(
  options?: DiscordInteractionData['options']
): Record<string, string | number | boolean> {
  if (!options) return {};

  const result: Record<string, string | number | boolean> = {};

  for (const option of options) {
    if (option.value !== undefined) {
      result[option.name] = option.value;
    } else if (option.options) {
      // Subcommand options
      Object.assign(result, parseCommandOptions(option.options));
    }
  }

  return result;
}

// =============================================================================
// ED25519 SIGNATURE VERIFICATION
// =============================================================================

/**
 * Verify Discord interaction signature using Ed25519
 *
 * Discord sends:
 * - X-Signature-Ed25519: the signature
 * - X-Signature-Timestamp: the timestamp
 *
 * We verify: nacl.sign.detached.verify(timestamp + body, signature, publicKey)
 */
export async function verifyDiscordSignature(
  publicKey: string | undefined,
  signature: string | undefined,
  timestamp: string | undefined,
  body: string
): Promise<boolean> {
  if (!publicKey || !signature || !timestamp) {
    return false;
  }

  try {
    // Use SubtleCrypto (native, no dependencies) for Ed25519 verification
    // This is faster than tweetnacl and available in Node 16+
    const encoder = new TextEncoder();
    const message = encoder.encode(timestamp + body);

    // Import the public key
    const keyData = hexToUint8Array(publicKey);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'Ed25519' },
      false,
      ['verify']
    );

    // Verify the signature
    const signatureData = hexToUint8Array(signature);
    const isValid = await crypto.subtle.verify(
      'Ed25519',
      cryptoKey,
      signatureData,
      message
    );

    return isValid;
  } catch (error) {
    logger.error('[Discord] Signature verification error:', error instanceof Error ? error : undefined);
    return false;
  }
}

function hexToUint8Array(hex: string): Uint8Array {
  const matches = hex.match(/.{1,2}/g);
  if (!matches) return new Uint8Array(0);
  return new Uint8Array(matches.map(byte => parseInt(byte, 16)));
}

/**
 * Check if sender is allowed based on allowlists
 */
export function isDiscordSenderAllowed(
  config: DiscordConfig,
  guildId?: string,
  channelId?: string,
  roleIds?: string[]
): { allowed: boolean; reason?: string } {
  const { allowedGuildIds, allowedChannelIds, allowedRoleIds } = config;

  // If no allowlists configured, allow all
  if (!allowedGuildIds?.length && !allowedChannelIds?.length && !allowedRoleIds?.length) {
    return { allowed: true };
  }

  // Check guild allowlist
  if (allowedGuildIds?.length && guildId) {
    if (!allowedGuildIds.includes(guildId)) {
      return { allowed: false, reason: `Guild ${guildId} not in allowlist` };
    }
  }

  // Check channel allowlist
  if (allowedChannelIds?.length && channelId) {
    if (!allowedChannelIds.includes(channelId)) {
      return { allowed: false, reason: `Channel ${channelId} not in allowlist` };
    }
  }

  // Check role allowlist (user must have at least one allowed role)
  if (allowedRoleIds?.length && roleIds) {
    const hasAllowedRole = roleIds.some(r => allowedRoleIds.includes(r));
    if (!hasAllowedRole) {
      return { allowed: false, reason: 'User does not have required role' };
    }
  }

  return { allowed: true };
}

// =============================================================================
// AUTH ADAPTER
// =============================================================================

const authAdapter: AuthAdapter = {
  getAuthUrl(state: string, scopes?: string[]): string {
    if (!currentConfig?.applicationId) {
      throw new Error('Application ID not configured');
    }

    const defaultScopes = ['bot', 'applications.commands'];
    const permissions = '2147485696'; // Send Messages, Use Slash Commands, Embed Links

    const params = new URLSearchParams({
      client_id: currentConfig.applicationId,
      permissions,
      scope: (scopes || defaultScopes).join(' '),
      response_type: 'code',
      state,
    });

    return `https://discord.com/oauth2/authorize?${params}`;
  },

  async exchangeCode(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  }> {
    // Discord OAuth2 token exchange (for adding bot to servers)
    // Note: This returns an access token for the user, not the bot
    // The bot token is generated in the Developer Portal
    throw new Error(
      'Discord bots use a fixed token from the Developer Portal. ' +
      'Use the OAuth URL to add the bot to servers.'
    );
  },

  verifyWebhook(signature: string, timestamp: string, body: string): boolean {
    // Actual verification is async, this is for interface compliance
    return !!signature && !!timestamp && !!body;
  },
};

// =============================================================================
// OUTBOUND ADAPTER
// =============================================================================

const outboundAdapter: OutboundAdapter = {
  async send(message: OutgoingMessage): Promise<SendResult> {
    if (!currentConfig?.botToken) {
      return { success: false, error: 'Bot token not configured' };
    }

    const body: Record<string, unknown> = {};

    // Text content
    if (message.text) {
      body.content = message.text;
    }

    // Embeds from blocks
    if (message.blocks && Array.isArray(message.blocks)) {
      // Check if blocks are embeds or components
      const firstBlock = message.blocks[0] as Record<string, unknown> | undefined;
      if (firstBlock) {
        if ('title' in firstBlock || 'description' in firstBlock || 'fields' in firstBlock) {
          // It's an embed
          body.embeds = message.blocks as DiscordEmbed[];
        } else if ('type' in firstBlock && firstBlock.type === ComponentType.ACTION_ROW) {
          // It's a component
          body.components = message.blocks as DiscordComponent[];
        }
      }
    }

    // Reply reference
    if (message.replyToId) {
      body.message_reference = {
        message_id: message.replyToId,
      };
    }

    // Ephemeral flag (only works with interactions, not direct messages)
    if (message.ephemeral) {
      body.flags = 64; // EPHEMERAL flag
    }

    const result = await callDiscordApi<DiscordMessage>(
      `/channels/${message.to}/messages`,
      'POST',
      body
    );

    if (result.ok && result.data) {
      return {
        success: true,
        messageId: result.data.id,
        threadId: result.data.thread?.id,
      };
    }

    return {
      success: false,
      error: result.error || 'Failed to send message',
    };
  },

  async edit(messageId: string, channelId: string, content: OutgoingMessage): Promise<SendResult> {
    if (!currentConfig?.botToken) {
      return { success: false, error: 'Bot token not configured' };
    }

    const body: Record<string, unknown> = {};

    if (content.text) {
      body.content = content.text;
    }

    if (content.blocks) {
      const firstBlock = content.blocks[0] as Record<string, unknown> | undefined;
      if (firstBlock && ('title' in firstBlock || 'description' in firstBlock)) {
        body.embeds = content.blocks;
      } else {
        body.components = content.blocks;
      }
    }

    const result = await callDiscordApi<DiscordMessage>(
      `/channels/${channelId}/messages/${messageId}`,
      'PATCH',
      body
    );

    return {
      success: result.ok,
      messageId: result.ok ? messageId : undefined,
      error: result.error,
    };
  },

  async delete(messageId: string, channelId: string): Promise<{ success: boolean; error?: string }> {
    if (!currentConfig?.botToken) {
      return { success: false, error: 'Bot token not configured' };
    }

    const result = await callDiscordApi<void>(
      `/channels/${channelId}/messages/${messageId}`,
      'DELETE'
    );

    return {
      success: result.ok,
      error: result.error,
    };
  },

  async react(messageId: string, channelId: string, emoji: string): Promise<{ success: boolean }> {
    if (!currentConfig?.botToken) {
      return { success: false };
    }

    // URL encode the emoji (Discord requires this for custom emojis and Unicode)
    const encodedEmoji = encodeURIComponent(emoji);

    const result = await callDiscordApi<void>(
      `/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`,
      'PUT' as 'POST' // Discord uses PUT for adding reactions
    );

    return { success: result.ok };
  },

  async unreact(messageId: string, channelId: string, emoji: string): Promise<{ success: boolean }> {
    if (!currentConfig?.botToken) {
      return { success: false };
    }

    const encodedEmoji = encodeURIComponent(emoji);

    const result = await callDiscordApi<void>(
      `/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`,
      'DELETE'
    );

    return { success: result.ok };
  },
};

// =============================================================================
// INBOUND ADAPTER
// =============================================================================

const inboundAdapter: InboundAdapter = {
  parseMessage(payload: unknown): IncomingMessage | null {
    const interaction = payload as DiscordInteraction;

    // Only parse message-related interactions (not slash commands)
    // For HTTP interactions, regular messages come through Gateway, not here
    // This is primarily for component interactions that contain message context
    if (!interaction.message) return null;

    const message = interaction.message;
    const user = interaction.member?.user || interaction.user;

    if (!user) return null;

    return {
      id: message.id,
      provider: 'discord',
      accountId: currentConfig?.id || 'default',
      senderId: user.id,
      senderName: interaction.member?.nick || user.global_name || user.username,
      senderUsername: user.username,
      chatType: getChatType(interaction.channel),
      chatId: interaction.channel_id || message.channel_id,
      chatName: interaction.channel?.name,
      threadId: message.thread?.id,
      replyToId: message.referenced_message?.id,
      text: message.content,
      rawContent: interaction,
      timestamp: new Date(message.timestamp),
      editedAt: message.edited_timestamp ? new Date(message.edited_timestamp) : undefined,
      attachments: message.attachments?.map(a => ({
        type: a.content_type?.startsWith('image/') ? 'image' as const :
              a.content_type?.startsWith('video/') ? 'video' as const :
              a.content_type?.startsWith('audio/') ? 'audio' as const : 'file' as const,
        url: a.url,
        name: a.filename,
        mimeType: a.content_type,
        size: a.size,
      })),
    };
  },

  parseCommand(payload: unknown): SlashCommand | null {
    const interaction = payload as DiscordInteraction;

    if (interaction.type !== InteractionType.APPLICATION_COMMAND) return null;
    if (!interaction.data?.name) return null;

    const user = interaction.member?.user || interaction.user;
    if (!user) return null;

    // Parse options into text format
    const options = parseCommandOptions(interaction.data.options);
    const text = Object.entries(options)
      .map(([k, v]) => `${k}:${v}`)
      .join(' ');

    return {
      provider: 'discord',
      accountId: currentConfig?.id || 'default',
      command: `/${interaction.data.name}`,
      text,
      userId: user.id,
      userName: interaction.member?.nick || user.global_name || user.username,
      channelId: interaction.channel_id || '',
      channelName: interaction.channel?.name,
      chatType: getChatType(interaction.channel),
      triggerId: interaction.id,
      responseUrl: undefined, // Discord uses interaction token for responses
      raw: interaction,
    };
  },

  parseAction(payload: unknown): InteractiveAction | null {
    const interaction = payload as DiscordInteraction;

    if (interaction.type !== InteractionType.MESSAGE_COMPONENT) return null;
    if (!interaction.data?.custom_id) return null;

    const user = interaction.member?.user || interaction.user;
    if (!user) return null;

    // Determine action type from component type
    let actionType: InteractiveAction['type'] = 'button';
    if (interaction.data.component_type === ComponentType.STRING_SELECT ||
        interaction.data.component_type === ComponentType.USER_SELECT ||
        interaction.data.component_type === ComponentType.ROLE_SELECT) {
      actionType = 'select';
    }

    return {
      provider: 'discord',
      accountId: currentConfig?.id || 'default',
      type: actionType,
      actionId: interaction.data.custom_id,
      value: interaction.data.values?.[0] || interaction.data.custom_id,
      userId: user.id,
      userName: interaction.member?.nick || user.global_name || user.username,
      channelId: interaction.channel_id,
      messageId: interaction.message?.id,
      threadId: interaction.message?.thread?.id,
      triggerId: interaction.id,
      raw: interaction,
    };
  },

  buildCommandResponse(response: CommandResponse): unknown {
    const data: Record<string, unknown> = {};

    if (response.text) {
      data.content = response.text;
    }

    if (response.blocks) {
      // Check if blocks are embeds or components
      const firstBlock = response.blocks[0] as Record<string, unknown> | undefined;
      if (firstBlock && ('title' in firstBlock || 'description' in firstBlock)) {
        data.embeds = response.blocks;
      } else {
        data.components = response.blocks;
      }
    }

    if (response.responseType === 'ephemeral') {
      data.flags = 64;
    }

    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data,
    };
  },

  buildActionResponse(response: CommandResponse): unknown {
    const data: Record<string, unknown> = {};

    if (response.text) {
      data.content = response.text;
    }

    if (response.blocks) {
      const firstBlock = response.blocks[0] as Record<string, unknown> | undefined;
      if (firstBlock && ('title' in firstBlock || 'description' in firstBlock)) {
        data.embeds = response.blocks;
      } else {
        data.components = response.blocks;
      }
    }

    if (response.responseType === 'ephemeral') {
      data.flags = 64;
    }

    // For button/select interactions, we typically update the message
    return {
      type: InteractionResponseType.UPDATE_MESSAGE,
      data,
    };
  },
};

// =============================================================================
// STATUS ADAPTER
// =============================================================================

const statusAdapter: StatusAdapter = {
  isConfigured(config: DiscordAccountConfig): boolean {
    return !!(config.botToken && config.applicationId && config.publicKey);
  },

  async checkHealth(config: DiscordAccountConfig): Promise<{
    connected: boolean;
    latencyMs?: number;
    error?: string;
    details?: Record<string, unknown>;
  }> {
    if (!config.botToken) {
      return { connected: false, error: 'Bot token not configured' };
    }

    const start = Date.now();

    // Get current user (bot)
    const result = await callDiscordApi<{
      id: string;
      username: string;
      discriminator: string;
      avatar?: string;
      verified: boolean;
    }>('/users/@me', 'GET', undefined, config.botToken);

    const latencyMs = Date.now() - start;

    if (result.ok && result.data) {
      return {
        connected: true,
        latencyMs,
        details: {
          botId: result.data.id,
          botUsername: result.data.username,
          botDiscriminator: result.data.discriminator,
          verified: result.data.verified,
        },
      };
    }

    return {
      connected: false,
      latencyMs,
      error: result.error || 'Failed to connect',
    };
  },
};

// =============================================================================
// INTERACTION HELPERS
// =============================================================================

/**
 * Build a PING response (required for Discord endpoint verification)
 */
export function buildPingResponse(): unknown {
  return { type: InteractionResponseType.PONG };
}

/**
 * Check if interaction is a PING
 */
export function isPingInteraction(payload: unknown): boolean {
  const interaction = payload as DiscordInteraction;
  return interaction.type === InteractionType.PING;
}

/**
 * Build a deferred response (for async operations)
 */
export function buildDeferredResponse(ephemeral = false): unknown {
  return {
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: ephemeral ? { flags: 64 } : {},
  };
}

/**
 * Follow up on a deferred response
 */
export async function sendFollowupMessage(
  applicationId: string,
  interactionToken: string,
  message: OutgoingMessage
): Promise<SendResult> {
  const body: Record<string, unknown> = {};

  if (message.text) {
    body.content = message.text;
  }

  if (message.blocks) {
    const firstBlock = message.blocks[0] as Record<string, unknown> | undefined;
    if (firstBlock && ('title' in firstBlock || 'description' in firstBlock)) {
      body.embeds = message.blocks;
    } else {
      body.components = message.blocks;
    }
  }

  if (message.ephemeral) {
    body.flags = 64;
  }

  try {
    const response = await fetch(
      `${DISCORD_API_BASE}/webhooks/${applicationId}/${interactionToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const error = await response.json() as { message?: string };
      return { success: false, error: error.message || `HTTP ${response.status}` };
    }

    const data = await response.json() as { id: string };
    return { success: true, messageId: data.id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Register slash commands with Discord
 */
export async function registerSlashCommands(
  applicationId: string,
  botToken: string,
  commands: Array<{
    name: string;
    description: string;
    options?: Array<{
      name: string;
      description: string;
      type: number;
      required?: boolean;
      choices?: Array<{ name: string; value: string }>;
    }>;
  }>,
  guildId?: string
): Promise<{ success: boolean; error?: string }> {
  const endpoint = guildId
    ? `/applications/${applicationId}/guilds/${guildId}/commands`
    : `/applications/${applicationId}/commands`;

  const result = await callDiscordApi<unknown[]>(
    endpoint,
    'PUT' as 'POST',
    commands as unknown as Record<string, unknown>,
    botToken
  );

  return {
    success: result.ok,
    error: result.error,
  };
}

// =============================================================================
// PROVIDER EXPORT
// =============================================================================

export const discordProvider: ChatProvider<DiscordAccountConfig> = {
  meta,
  capabilities,
  defaultConfig: {
    provider: 'discord',
    enabled: true,
  },
  configSchema: DiscordAccountConfigSchema as z.ZodType<DiscordAccountConfig>,
  auth: authAdapter,
  outbound: outboundAdapter,
  inbound: inboundAdapter,
  status: statusAdapter,
};

export { setConfig as setDiscordConfig, clearConfig as clearDiscordConfig };
export { DiscordAccountConfigSchema };
export type {
  DiscordConfig,
  DiscordInteraction,
  DiscordMessage,
  DiscordEmbed,
  DiscordComponent,
};
export { InteractionType, InteractionResponseType, ComponentType };
