/**
 * Chat Provider Types
 *
 * Unified abstraction for chat integrations (Slack, WhatsApp, Telegram, Discord, etc.)
 * Inspired by OpenClaw's plugin architecture.
 *
 * Key concepts:
 * - Providers implement adapters for different concerns (outbound, inbound, auth, etc.)
 * - Capabilities advertise what a provider supports
 * - Multi-account support from day one
 * - Configuration-driven behavior
 */

import { z } from 'zod';

// =============================================================================
// PROVIDER IDENTITY
// =============================================================================

export type ChatProviderId =
  | 'slack'
  | 'discord'
  | 'telegram'
  | 'whatsapp'
  | 'msteams'
  | 'mattermost'
  | 'custom';

export interface ChatProviderMeta {
  id: ChatProviderId;
  name: string;                    // Display name: "Slack"
  description: string;             // Short description
  icon: string;                    // Emoji or icon class
  docsUrl?: string;                // Link to setup docs
  order: number;                   // Sort order in UI
  color?: string;                  // Brand color
}

// =============================================================================
// CAPABILITIES
// =============================================================================

export interface ChatProviderCapabilities {
  /** Supported chat types */
  chatTypes: Array<'direct' | 'group' | 'channel' | 'thread'>;

  /** Can send messages */
  send: boolean;

  /** Can receive messages (webhooks/events) */
  receive: boolean;

  /** Supports slash commands */
  slashCommands: boolean;

  /** Supports interactive components (buttons, menus) */
  interactiveComponents: boolean;

  /** Supports emoji reactions */
  reactions: boolean;

  /** Supports message editing */
  edit: boolean;

  /** Supports message deletion */
  delete: boolean;

  /** Supports threaded replies */
  threads: boolean;

  /** Supports file/media attachments */
  media: boolean;

  /** Supports rich blocks (Block Kit, Adaptive Cards) */
  richBlocks: boolean;

  /** Supports OAuth installation */
  oauth: boolean;

  /** Supports webhooks for outbound */
  webhooks: boolean;

  /** Supports real-time socket connections */
  realtime: boolean;
}

// =============================================================================
// ACCOUNT CONFIGURATION
// =============================================================================

/** Base account config shared by all providers */
export interface ChatAccountConfigBase {
  id: string;                      // Account identifier
  name?: string;                   // Display name
  enabled?: boolean;               // Whether account is active (default: true)
  isDefault?: boolean;             // Default account for this provider
}

/** Provider-specific account configs */
export interface SlackAccountConfig extends ChatAccountConfigBase {
  provider: 'slack';
  mode?: 'socket' | 'http';        // Socket Mode or HTTP webhooks (default: http)
  botToken?: string;               // xoxb-...
  appToken?: string;               // xapp-... (for Socket Mode)
  signingSecret?: string;          // For webhook verification
  webhookUrl?: string;             // Incoming webhook URL
  teamId?: string;                 // Workspace ID
  teamName?: string;               // Workspace name
}

export interface DiscordAccountConfig extends ChatAccountConfigBase {
  provider: 'discord';
  botToken?: string;               // Bot token
  applicationId?: string;          // Application ID
  publicKey?: string;              // For webhook verification
  guildId?: string;                // Server ID (optional, for single-guild)
}

export interface TelegramAccountConfig extends ChatAccountConfigBase {
  provider: 'telegram';
  botToken?: string;               // Bot token from BotFather
  webhookUrl?: string;             // Webhook URL
  webhookSecret?: string;          // Secret for verification
}

export interface WhatsAppAccountConfig extends ChatAccountConfigBase {
  provider: 'whatsapp';
  phoneNumberId?: string;          // Phone number ID
  businessAccountId?: string;      // Business account ID
  accessToken?: string;            // Access token
  webhookVerifyToken?: string;     // Verify token for webhooks
}

export type ChatAccountConfig =
  | SlackAccountConfig
  | DiscordAccountConfig
  | TelegramAccountConfig
  | WhatsAppAccountConfig;

// =============================================================================
// MESSAGE TYPES
// =============================================================================

export type ChatType = 'direct' | 'group' | 'channel' | 'thread';

/** Normalized incoming message */
export interface IncomingMessage {
  id: string;                      // Provider-specific message ID
  provider: ChatProviderId;
  accountId: string;

  // Sender info
  senderId: string;                // Provider user ID
  senderName: string;              // Display name
  senderUsername?: string;         // Username/handle

  // Channel/conversation info
  chatType: ChatType;
  chatId: string;                  // Channel/DM/group ID
  chatName?: string;               // Channel name

  // Threading
  threadId?: string;               // Parent thread ID
  replyToId?: string;              // Specific message being replied to

  // Content
  text: string;                    // Plain text content
  rawContent?: unknown;            // Provider-specific raw payload

  // Metadata
  timestamp: Date;
  editedAt?: Date;

  // Attachments
  attachments?: MessageAttachment[];
}

export interface MessageAttachment {
  type: 'file' | 'image' | 'video' | 'audio' | 'link';
  url?: string;
  name?: string;
  mimeType?: string;
  size?: number;
}

/** Outgoing message */
export interface OutgoingMessage {
  provider: ChatProviderId;
  accountId?: string;              // Use default if not specified

  // Target
  to: string;                      // Channel ID, user ID, etc.
  chatType?: ChatType;

  // Threading
  threadId?: string;               // Reply in thread
  replyToId?: string;              // Quote specific message

  // Content (at least one required)
  text?: string;
  blocks?: unknown[];              // Provider-specific blocks
  attachments?: OutgoingAttachment[];

  // Options
  ephemeral?: boolean;             // Only visible to recipient
}

export interface OutgoingAttachment {
  type: 'file' | 'image';
  url?: string;                    // URL to file
  data?: Buffer;                   // Raw file data
  filename?: string;
  mimeType?: string;
}

// =============================================================================
// COMMAND TYPES
// =============================================================================

/** Slash command from a chat provider */
export interface SlashCommand {
  provider: ChatProviderId;
  accountId: string;

  // Command info
  command: string;                 // e.g., "/glinr"
  text: string;                    // Arguments after command

  // Sender info
  userId: string;
  userName: string;

  // Channel info
  channelId: string;
  channelName?: string;
  chatType: ChatType;

  // Response hooks
  responseUrl?: string;            // For async responses
  triggerId?: string;              // For opening modals

  // Raw payload
  raw: unknown;
}

/** Interactive component action (button click, menu select) */
export interface InteractiveAction {
  provider: ChatProviderId;
  accountId: string;

  type: 'button' | 'select' | 'overflow' | 'datepicker' | 'modal_submit';
  actionId: string;
  value?: string;

  userId: string;
  userName: string;

  channelId?: string;
  messageId?: string;
  threadId?: string;

  responseUrl?: string;
  triggerId?: string;

  raw: unknown;
}

// =============================================================================
// RESULT TYPES
// =============================================================================

export interface SendResult {
  success: boolean;
  messageId?: string;
  threadId?: string;
  error?: string;
  raw?: unknown;
}

export interface CommandResponse {
  responseType: 'ephemeral' | 'in_channel';
  text?: string;
  blocks?: unknown[];
  attachments?: unknown[];
}

// =============================================================================
// ADAPTERS (Provider implements these)
// =============================================================================

/** Authentication adapter */
export interface AuthAdapter {
  /** Get OAuth authorization URL */
  getAuthUrl(state: string, scopes?: string[]): string;

  /** Exchange code for tokens */
  exchangeCode(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
    teamId?: string;
    teamName?: string;
    botUserId?: string;
  }>;

  /** Refresh access token */
  refreshToken?(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  }>;

  /** Verify webhook signature */
  verifyWebhook(signature: string, timestamp: string, body: string): boolean;
}

/** Outbound message adapter */
export interface OutboundAdapter {
  /** Send a message */
  send(message: OutgoingMessage): Promise<SendResult>;

  /** Edit a message */
  edit?(messageId: string, channelId: string, content: OutgoingMessage): Promise<SendResult>;

  /** Delete a message */
  delete?(messageId: string, channelId: string): Promise<{ success: boolean; error?: string }>;

  /** Add a reaction */
  react?(messageId: string, channelId: string, emoji: string): Promise<{ success: boolean }>;

  /** Remove a reaction */
  unreact?(messageId: string, channelId: string, emoji: string): Promise<{ success: boolean }>;
}

/** Inbound message adapter */
export interface InboundAdapter {
  /** Parse webhook payload to normalized message */
  parseMessage(payload: unknown): IncomingMessage | null;

  /** Parse slash command payload */
  parseCommand(payload: unknown): SlashCommand | null;

  /** Parse interactive action payload */
  parseAction(payload: unknown): InteractiveAction | null;

  /** Build response for slash command */
  buildCommandResponse(response: CommandResponse): unknown;

  /** Build response for interactive action */
  buildActionResponse?(response: CommandResponse): unknown;
}

/** Status/health adapter */
export interface StatusAdapter {
  /** Check if provider is configured */
  isConfigured(config: ChatAccountConfig): boolean;

  /** Check if provider is connected/healthy */
  checkHealth(config: ChatAccountConfig): Promise<{
    connected: boolean;
    latencyMs?: number;
    error?: string;
    details?: Record<string, unknown>;
  }>;
}

// =============================================================================
// PROVIDER PLUGIN INTERFACE
// =============================================================================

export interface ChatProvider<TConfig extends ChatAccountConfig = ChatAccountConfig> {
  /** Provider metadata */
  meta: ChatProviderMeta;

  /** Declared capabilities */
  capabilities: ChatProviderCapabilities;

  /** Default configuration */
  defaultConfig: Partial<TConfig>;

  /** Configuration schema (Zod) */
  configSchema: z.ZodType<TConfig>;

  // Adapters (providers implement what they support)
  auth?: AuthAdapter;
  outbound: OutboundAdapter;
  inbound: InboundAdapter;
  status: StatusAdapter;
}

// =============================================================================
// REGISTRY TYPES
// =============================================================================

export interface ProviderRegistry {
  /** Register a provider */
  register(provider: ChatProvider): void;

  /** Get provider by ID */
  get(id: ChatProviderId): ChatProvider | undefined;

  /** List all registered providers */
  list(): ChatProvider[];

  /** Get providers with specific capability */
  withCapability(capability: keyof ChatProviderCapabilities): ChatProvider[];
}

// =============================================================================
// CONTEXT TYPES
// =============================================================================

/** Context passed to handlers */
export interface ChatContext {
  provider: ChatProviderId;
  accountId: string;
  config: ChatAccountConfig;

  // Conversation context
  chatId?: string;
  chatType?: ChatType;
  threadId?: string;

  // User context
  userId?: string;
  userName?: string;
}

// =============================================================================
// EVENT TYPES
// =============================================================================

export type ChatEventType =
  | 'message'
  | 'command'
  | 'action'
  | 'reaction_added'
  | 'reaction_removed'
  | 'member_joined'
  | 'member_left'
  | 'channel_created'
  | 'channel_deleted';

export interface ChatEvent {
  type: ChatEventType;
  provider: ChatProviderId;
  accountId: string;
  timestamp: Date;
  payload: IncomingMessage | SlashCommand | InteractiveAction | unknown;
}

export type ChatEventHandler = (event: ChatEvent, context: ChatContext) => Promise<void>;
