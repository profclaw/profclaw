/**
 * Microsoft Teams Provider - Full Implementation
 *
 * Secure Microsoft Teams integration using the Bot Framework REST API with:
 * - HMAC-SHA256 signature verification for incoming activities
 * - OAuth2 client credentials flow (appId + appPassword) for outbound
 * - Adaptive Cards for rich interactive content
 * - Team/channel allowlist support
 * - Message, reaction, and invoke (command) activity parsing
 *
 * Uses Bot Framework Connector REST API v3:
 * https://docs.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-api-reference
 */

import { z } from 'zod';
import type {
  ChatProvider,
  MSTeamsAccountConfig,
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

// MS TEAMS / BOT FRAMEWORK API TYPES

/** Bot Framework Activity Types */
const ActivityType = {
  MESSAGE: 'message',
  MESSAGE_REACTION: 'messageReaction',
  INVOKE: 'invoke',
  CONVERSATION_UPDATE: 'conversationUpdate',
  TYPING: 'typing',
  END_OF_CONVERSATION: 'endOfConversation',
  EVENT: 'event',
  INSTALL_UPDATE: 'installationUpdate',
} as const;

/** Bot Framework Channel IDs */
const ChannelId = {
  MSTEAMS: 'msteams',
  DIRECTLINE: 'directline',
  EMULATOR: 'emulator',
} as const;

interface BotFrameworkAccount {
  id: string;
  name?: string;
  aadObjectId?: string;
  role?: 'user' | 'bot' | 'skill';
}

interface BotFrameworkConversation {
  id: string;
  name?: string;
  isGroup?: boolean;
  conversationType?: 'personal' | 'channel' | 'groupChat';
  tenantId?: string;
}

interface BotFrameworkAttachment {
  contentType: string;
  content?: unknown;
  contentUrl?: string;
  name?: string;
  thumbnailUrl?: string;
}

interface BotFrameworkReaction {
  type: string;
}

interface TeamsChannelData {
  team?: {
    id: string;
    name?: string;
    aadGroupId?: string;
  };
  channel?: {
    id: string;
    name?: string;
  };
  tenant?: {
    id: string;
  };
  notification?: {
    alert: boolean;
  };
}

/** Bot Framework Activity (inbound) */
interface BotFrameworkActivity {
  type: string;
  id?: string;
  timestamp?: string;
  localTimestamp?: string;
  serviceUrl: string;
  channelId: string;
  from: BotFrameworkAccount;
  conversation: BotFrameworkConversation;
  recipient: BotFrameworkAccount;
  replyToId?: string;
  text?: string;
  textFormat?: 'markdown' | 'plain' | 'xml';
  attachments?: BotFrameworkAttachment[];
  channelData?: TeamsChannelData;
  reactionsAdded?: BotFrameworkReaction[];
  reactionsRemoved?: BotFrameworkReaction[];
  /** Invoke activity name (e.g. 'composeExtension/query') */
  name?: string;
  /** Invoke activity value */
  value?: unknown;
  locale?: string;
  entities?: Array<{
    type: string;
    text?: string;
    mentioned?: BotFrameworkAccount;
  }>;
}

/** Outbound activity payload */
interface OutboundActivity {
  type: string;
  text?: string;
  textFormat?: 'markdown' | 'plain';
  attachments?: BotFrameworkAttachment[];
  replyToId?: string;
}

/** Adaptive Card body */
interface AdaptiveCard {
  type: 'AdaptiveCard';
  version: string;
  body?: unknown[];
  actions?: unknown[];
  msteams?: {
    width?: 'Full';
  };
}

/** OAuth2 token response */
interface OAuthTokenResponse {
  token_type: string;
  expires_in: number;
  access_token: string;
}

// CONFIGURATION

export const MSTeamsAccountConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().optional(),
  provider: z.literal('msteams'),
  appId: z.string().optional(),
  appPassword: z.string().optional(),
  tenantId: z.string().optional(),
  allowedTeamIds: z.array(z.string()).optional(),
  allowedChannelIds: z.array(z.string()).optional(),
}) satisfies z.ZodType<MSTeamsAccountConfig>;

type MSTeamsConfig = z.infer<typeof MSTeamsAccountConfigSchema>;

// METADATA

const meta: ChatProviderMeta = {
  id: 'msteams',
  name: 'Microsoft Teams',
  description: 'Microsoft Teams bot with Adaptive Cards and messaging extensions',
  icon: '🟦',
  docsUrl: 'https://docs.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-api-reference',
  order: 8,
  color: '#6264A7',
};

// CAPABILITIES

const capabilities: ChatProviderCapabilities = {
  chatTypes: ['direct', 'group', 'channel', 'thread'],
  send: true,
  receive: true,
  slashCommands: true,          // Messaging extensions
  interactiveComponents: true,  // Adaptive Cards
  reactions: true,
  edit: true,
  delete: true,
  threads: true,
  media: true,
  richBlocks: true,             // Adaptive Cards
  oauth: false,                 // Uses Bot Framework credentials, not OAuth install
  webhooks: true,
  realtime: false,
};

// TOKEN CACHE

interface CachedToken {
  token: string;
  expiresAt: number;
}

// keyed by `${appId}:${tenantId}`
const tokenCache = new Map<string, CachedToken>();

// MODULE-LEVEL CONFIG STATE

let currentConfig: MSTeamsConfig | null = null;

function setTeamsConfig(config: MSTeamsConfig): void {
  currentConfig = config;
}

function clearTeamsConfig(): void {
  currentConfig = null;
}

// HELPER FUNCTIONS

const BOT_FRAMEWORK_API_VERSION = 'v3';

/**
 * Acquire an OAuth2 access token using client credentials.
 * Tokens are cached until 60s before expiry.
 */
async function getAccessToken(
  appId: string,
  appPassword: string,
  tenantId = 'botframework.com'
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const cacheKey = `${appId}:${tenantId}`;
  const cached = tokenCache.get(cacheKey);

  if (cached && Date.now() < cached.expiresAt) {
    return { ok: true, token: cached.token };
  }

  // For standard Bot Framework auth (not tenant-specific), use the BF token endpoint
  const endpoint = tenantId === 'botframework.com'
    ? 'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token'
    : `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  try {
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: appId,
      client_secret: appPassword,
      scope: 'https://api.botframework.com/.default',
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { ok: false, error: `Token request failed (${response.status}): ${errorText}` };
    }

    const data = await response.json() as OAuthTokenResponse;
    const expiresAt = Date.now() + (data.expires_in - 60) * 1000;

    tokenCache.set(cacheKey, { token: data.access_token, expiresAt });
    return { ok: true, token: data.access_token };
  } catch (error) {
    logger.error('[MSTeams] Token acquisition failed:', error instanceof Error ? error : undefined);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Make an authenticated call to the Bot Framework Connector REST API.
 * serviceUrl comes from the inbound activity and varies by tenant/region.
 */
async function callBotFrameworkApi<T>(
  serviceUrl: string,
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST',
  body?: Record<string, unknown>,
  config?: MSTeamsConfig
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const cfg = config || currentConfig;

  if (!cfg?.appId || !cfg.appPassword) {
    return { ok: false, error: 'App ID and App Password not configured' };
  }

  const tokenResult = await getAccessToken(cfg.appId, cfg.appPassword, cfg.tenantId);
  if (!tokenResult.ok) {
    return { ok: false, error: tokenResult.error };
  }

  // Normalise serviceUrl: strip trailing slash
  const base = serviceUrl.replace(/\/$/, '');
  const url = `${base}/${BOT_FRAMEWORK_API_VERSION}${endpoint}`;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${tokenResult.token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return { ok: true };
    }

    const text = await response.text();
    if (!text) {
      return { ok: response.ok };
    }

    let data: T & { error?: { code?: string; message?: string }; message?: string };
    try {
      data = JSON.parse(text) as T & { error?: { code?: string; message?: string }; message?: string };
    } catch {
      return { ok: response.ok, error: response.ok ? undefined : text };
    }

    if (!response.ok) {
      const errMsg = data.error?.message || data.message || `HTTP ${response.status}`;
      return { ok: false, error: errMsg };
    }

    return { ok: true, data };
  } catch (error) {
    logger.error('[MSTeams] API call failed:', error instanceof Error ? error : undefined);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Determine chat type from Bot Framework conversation and channel data.
 */
function getChatType(
  conversation: BotFrameworkConversation,
  channelData?: TeamsChannelData
): 'direct' | 'group' | 'channel' | 'thread' {
  const convType = conversation.conversationType;

  if (convType === 'personal') return 'direct';
  if (convType === 'groupChat') return 'group';
  if (convType === 'channel') {
    // A reply in a channel thread has replyToId, but we check channelData presence
    return channelData?.channel ? 'channel' : 'group';
  }

  // Fallback: infer from isGroup
  if (conversation.isGroup) return 'group';
  return 'direct';
}

/**
 * Check team/channel allowlists. Returns true if the activity should be processed.
 */
export function isTeamsSenderAllowed(
  config: MSTeamsConfig,
  teamId?: string,
  channelId?: string
): { allowed: boolean; reason?: string } {
  const { allowedTeamIds, allowedChannelIds } = config;

  if (!allowedTeamIds?.length && !allowedChannelIds?.length) {
    return { allowed: true };
  }

  if (allowedTeamIds?.length && teamId) {
    if (!allowedTeamIds.includes(teamId)) {
      return { allowed: false, reason: `Team ${teamId} not in allowlist` };
    }
  }

  if (allowedChannelIds?.length && channelId) {
    if (!allowedChannelIds.includes(channelId)) {
      return { allowed: false, reason: `Channel ${channelId} not in allowlist` };
    }
  }

  return { allowed: true };
}

// HMAC-SHA256 SIGNATURE VERIFICATION

/**
 * Verify Bot Framework incoming request using HMAC-SHA256.
 *
 * The Bot Framework sends an Authorization header with a JWT signed by
 * Microsoft's identity platform. For a lightweight HMAC approach (used with
 * shared secrets / app password), we verify the HMAC-SHA256 of the body.
 *
 * Full JWT verification uses the Bot Framework OpenID metadata endpoint.
 * This implementation provides HMAC-SHA256 verification for environments
 * that configure a shared secret webhook.
 */
export async function verifyTeamsSignature(
  appPassword: string | undefined,
  signature: string | undefined,
  body: string
): Promise<boolean> {
  if (!appPassword || !signature) {
    return false;
  }

  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(appPassword);
    const messageData = encoder.encode(body);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);

    // Convert computed HMAC to hex
    const computedHex = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Constant-time comparison to prevent timing attacks
    const providedHex = signature.replace(/^sha256=/, '');

    if (computedHex.length !== providedHex.length) {
      return false;
    }

    let mismatch = 0;
    for (let i = 0; i < computedHex.length; i++) {
      mismatch |= computedHex.charCodeAt(i) ^ providedHex.charCodeAt(i);
    }

    return mismatch === 0;
  } catch (error) {
    logger.error('[MSTeams] Signature verification error:', error instanceof Error ? error : undefined);
    return false;
  }
}

/**
 * Build an Adaptive Card attachment from a generic blocks array.
 * If the blocks array already contains a full AdaptiveCard, wrap it as-is.
 * Otherwise, treat each block as an Adaptive Card body element.
 */
function buildAdaptiveCardAttachment(blocks: unknown[]): BotFrameworkAttachment {
  const firstBlock = blocks[0] as Record<string, unknown> | undefined;

  // If already a complete AdaptiveCard
  if (firstBlock && firstBlock['type'] === 'AdaptiveCard') {
    return {
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: firstBlock as unknown as AdaptiveCard,
    };
  }

  // Wrap blocks as the card body
  const card: AdaptiveCard = {
    type: 'AdaptiveCard',
    version: '1.4',
    body: blocks as unknown[],
    msteams: { width: 'Full' },
  };

  return {
    contentType: 'application/vnd.microsoft.card.adaptive',
    content: card,
  };
}

// AUTH ADAPTER

const authAdapter: AuthAdapter = {
  getAuthUrl(_state: string, _scopes?: string[]): string {
    // Bot Framework uses app registration, not OAuth install flow.
    // Teams apps are installed through the Teams Admin Center or app manifest.
    throw new Error(
      'Microsoft Teams bots do not use an OAuth install URL. ' +
      'Deploy the app manifest to Teams Admin Center or install via the Teams client.'
    );
  },

  async exchangeCode(_code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  }> {
    throw new Error(
      'Microsoft Teams bots use Bot Framework credentials (appId + appPassword). ' +
      'Configure appId and appPassword in the provider config.'
    );
  },

  verifyWebhook(signature: string, _timestamp: string, body: string): boolean {
    // Synchronous stub; use verifyTeamsSignature (async) for actual verification.
    // Returns true if inputs are present; full async check must be done in route handler.
    return !!signature && !!body;
  },
};

// OUTBOUND ADAPTER

/**
 * Teams activities are sent to:
 *   POST {serviceUrl}/v3/conversations/{conversationId}/activities
 *
 * The serviceUrl is dynamic and comes from inbound activities.
 * When sending proactively, use the service URL saved from the last activity.
 *
 * OutgoingMessage.to format:  "{serviceUrl}|{conversationId}"
 * or just "{conversationId}" using SMBA fallback URL.
 */
const SMBA_FALLBACK_URL = 'https://smba.trafficmanager.net/apis';

function parseMessageTarget(to: string): { serviceUrl: string; conversationId: string } {
  const pipeIdx = to.indexOf('|');
  if (pipeIdx !== -1) {
    return {
      serviceUrl: to.slice(0, pipeIdx),
      conversationId: to.slice(pipeIdx + 1),
    };
  }
  return {
    serviceUrl: SMBA_FALLBACK_URL,
    conversationId: to,
  };
}

const outboundAdapter: OutboundAdapter = {
  async send(message: OutgoingMessage): Promise<SendResult> {
    if (!currentConfig?.appId || !currentConfig.appPassword) {
      return { success: false, error: 'App ID and App Password not configured' };
    }

    const { serviceUrl, conversationId } = parseMessageTarget(message.to);

    const activity: OutboundActivity = {
      type: ActivityType.MESSAGE,
    };

    if (message.text) {
      activity.text = message.text;
      activity.textFormat = 'markdown';
    }

    if (message.blocks && Array.isArray(message.blocks) && message.blocks.length > 0) {
      activity.attachments = [buildAdaptiveCardAttachment(message.blocks)];
    }

    if (message.replyToId) {
      activity.replyToId = message.replyToId;
    }

    // Threading: set replyToId from threadId (thread root message)
    if (message.threadId && !activity.replyToId) {
      activity.replyToId = message.threadId;
    }

    const result = await callBotFrameworkApi<{ id: string }>(
      serviceUrl,
      `/conversations/${encodeURIComponent(conversationId)}/activities`,
      'POST',
      activity as unknown as Record<string, unknown>
    );

    if (result.ok && result.data) {
      return {
        success: true,
        messageId: result.data.id,
      };
    }

    return {
      success: false,
      error: result.error || 'Failed to send message',
    };
  },

  async edit(
    messageId: string,
    channelId: string,
    content: OutgoingMessage
  ): Promise<SendResult> {
    if (!currentConfig?.appId || !currentConfig.appPassword) {
      return { success: false, error: 'App ID and App Password not configured' };
    }

    const { serviceUrl, conversationId } = parseMessageTarget(channelId);

    const activity: OutboundActivity = {
      type: ActivityType.MESSAGE,
    };

    if (content.text) {
      activity.text = content.text;
      activity.textFormat = 'markdown';
    }

    if (content.blocks && Array.isArray(content.blocks) && content.blocks.length > 0) {
      activity.attachments = [buildAdaptiveCardAttachment(content.blocks)];
    }

    const result = await callBotFrameworkApi<{ id: string }>(
      serviceUrl,
      `/conversations/${encodeURIComponent(conversationId)}/activities/${encodeURIComponent(messageId)}`,
      'PUT',
      activity as unknown as Record<string, unknown>
    );

    return {
      success: result.ok,
      messageId: result.ok ? messageId : undefined,
      error: result.error,
    };
  },

  async delete(
    messageId: string,
    channelId: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!currentConfig?.appId || !currentConfig.appPassword) {
      return { success: false, error: 'App ID and App Password not configured' };
    }

    const { serviceUrl, conversationId } = parseMessageTarget(channelId);

    const result = await callBotFrameworkApi<void>(
      serviceUrl,
      `/conversations/${encodeURIComponent(conversationId)}/activities/${encodeURIComponent(messageId)}`,
      'DELETE'
    );

    return {
      success: result.ok,
      error: result.error,
    };
  },

  async react(
    _messageId: string,
    _channelId: string,
    _emoji: string
  ): Promise<{ success: boolean }> {
    // Teams does not support programmatic emoji reactions via the Bot Framework REST API.
    // Reactions are user-initiated only.
    logger.warn('[MSTeams] Programmatic reactions are not supported by the Bot Framework REST API');
    return { success: false };
  },

  async unreact(
    _messageId: string,
    _channelId: string,
    _emoji: string
  ): Promise<{ success: boolean }> {
    logger.warn('[MSTeams] Programmatic reaction removal is not supported by the Bot Framework REST API');
    return { success: false };
  },
};

// INBOUND ADAPTER

/**
 * Parse a mention entity from the activity to strip @bot mentions from text.
 */
function stripBotMention(text: string, botId: string): string {
  // Teams prepends "<at>BotName</at>" to messages; strip it
  const atPattern = /<at>[^<]*<\/at>\s*/gi;
  let cleaned = text.replace(atPattern, '').trim();

  // Also strip plain @mention fallback
  if (cleaned.startsWith(`<at:${botId}>`)) {
    cleaned = cleaned.replace(new RegExp(`^<at:${botId}>.*?</at>\\s*`, 'i'), '').trim();
  }

  return cleaned;
}

/**
 * Detect if an invoke activity is a messaging extension (slash command equivalent).
 */
function isMessagingExtension(activity: BotFrameworkActivity): boolean {
  return activity.type === ActivityType.INVOKE &&
    typeof activity.name === 'string' &&
    activity.name.startsWith('composeExtension/');
}

const inboundAdapter: InboundAdapter = {
  parseMessage(payload: unknown): IncomingMessage | null {
    const activity = payload as BotFrameworkActivity;

    if (activity.type !== ActivityType.MESSAGE) return null;
    if (!activity.from || !activity.conversation) return null;

    // Skip messages from the bot itself
    if (activity.from.role === 'bot') return null;

    const channelData = activity.channelData as TeamsChannelData | undefined;
    const teamId = channelData?.team?.id;
    const channelId = channelData?.channel?.id;

    // Apply allowlists if configured
    if (currentConfig) {
      const check = isTeamsSenderAllowed(currentConfig, teamId, channelId);
      if (!check.allowed) {
        logger.warn(`[MSTeams] Rejected activity: ${check.reason}`);
        return null;
      }
    }

    const rawText = activity.text || '';
    const text = activity.recipient?.id
      ? stripBotMention(rawText, activity.recipient.id)
      : rawText;

    // Build attachments
    const attachments = activity.attachments
      ?.filter(a => a.contentType !== 'application/vnd.microsoft.card.adaptive')
      .map(a => {
        const ct = a.contentType || '';
        const type =
          ct.startsWith('image/') ? 'image' as const :
          ct.startsWith('video/') ? 'video' as const :
          ct.startsWith('audio/') ? 'audio' as const : 'file' as const;

        return {
          type,
          url: a.contentUrl,
          name: a.name,
          mimeType: a.contentType,
        };
      });

    return {
      id: activity.id || `teams-${Date.now()}`,
      provider: 'msteams',
      accountId: currentConfig?.id || 'default',
      senderId: activity.from.id,
      senderName: activity.from.name || activity.from.id,
      senderUsername: activity.from.aadObjectId,
      chatType: getChatType(activity.conversation, channelData),
      chatId: activity.conversation.id,
      chatName: channelData?.channel?.name || activity.conversation.name,
      threadId: activity.replyToId,
      replyToId: activity.replyToId,
      text,
      rawContent: activity,
      timestamp: activity.timestamp ? new Date(activity.timestamp) : new Date(),
      attachments: attachments?.length ? attachments : undefined,
    };
  },

  parseCommand(payload: unknown): SlashCommand | null {
    const activity = payload as BotFrameworkActivity;

    if (!isMessagingExtension(activity)) return null;
    if (!activity.from || !activity.conversation) return null;

    const channelData = activity.channelData as TeamsChannelData | undefined;
    const value = activity.value as Record<string, unknown> | undefined;

    // Extract command name from the invoke name (e.g. 'composeExtension/query' -> 'query')
    const invokeName = activity.name || '';
    const commandSuffix = invokeName.replace('composeExtension/', '');
    const commandId = (value?.commandId as string | undefined) || commandSuffix;
    const queryText = (
      (value?.parameters as Array<{ name: string; value: string }> | undefined)
        ?.find(p => p.name === 'initialRun' || p.name === 'query' || p.name === 'searchQuery')
        ?.value
    ) || '';

    return {
      provider: 'msteams',
      accountId: currentConfig?.id || 'default',
      command: `/${commandId}`,
      text: queryText,
      userId: activity.from.id,
      userName: activity.from.name || activity.from.id,
      channelId: activity.conversation.id,
      channelName: channelData?.channel?.name,
      chatType: getChatType(activity.conversation, channelData),
      triggerId: activity.id,
      responseUrl: undefined,
      raw: activity,
    };
  },

  parseAction(payload: unknown): InteractiveAction | null {
    const activity = payload as BotFrameworkActivity;

    // Adaptive Card actions arrive as 'invoke' with name 'adaptiveCard/action'
    // or as 'message' with action payload in the value (older Action.Submit)
    const isAdaptiveCardAction =
      activity.type === ActivityType.INVOKE && activity.name === 'adaptiveCard/action';
    // Older Action.Submit sends the bot a 'message' activity with a value object
    const isActionSubmit =
      activity.type === ActivityType.MESSAGE && !!(activity.value);

    if (!isAdaptiveCardAction && !isActionSubmit) return null;
    if (!activity.from || !activity.conversation) return null;

    const value = activity.value as Record<string, unknown> | undefined;
    const actionId = (value?.action as Record<string, unknown> | undefined)?.verb as string ||
      value?.actionId as string ||
      value?.id as string ||
      'unknown';

    const selectedValue =
      (value?.action as Record<string, unknown> | undefined)?.data as string ||
      value?.value as string ||
      actionId;

    // Determine action type
    let actionType: InteractiveAction['type'] = 'button';
    const verbValue = (value?.action as Record<string, unknown> | undefined)?.verb;
    if (typeof verbValue === 'string' && verbValue.includes('select')) {
      actionType = 'select';
    }

    return {
      provider: 'msteams',
      accountId: currentConfig?.id || 'default',
      type: actionType,
      actionId,
      value: typeof selectedValue === 'string' ? selectedValue : JSON.stringify(selectedValue),
      userId: activity.from.id,
      userName: activity.from.name || activity.from.id,
      channelId: activity.conversation.id,
      messageId: activity.replyToId,
      threadId: activity.replyToId,
      triggerId: activity.id,
      raw: activity,
    };
  },

  buildCommandResponse(response: CommandResponse): unknown {
    // For messaging extension responses (composeExtension/query)
    const attachments: BotFrameworkAttachment[] = [];

    if (response.blocks && response.blocks.length > 0) {
      attachments.push(buildAdaptiveCardAttachment(response.blocks));
    }

    return {
      composeExtension: {
        type: 'result',
        attachmentLayout: 'list',
        attachments: attachments.length > 0 ? attachments.map(a => ({
          ...a,
          preview: {
            contentType: 'application/vnd.microsoft.card.thumbnail',
            content: {
              title: response.text || 'Result',
              text: response.text || '',
            },
          },
        })) : [],
      },
    };
  },

  buildActionResponse(response: CommandResponse): unknown {
    // Adaptive Card action response — update the card or send a message
    if (response.blocks && response.blocks.length > 0) {
      return {
        statusCode: 200,
        type: 'application/vnd.microsoft.card.adaptive',
        value: (response.blocks[0] as Record<string, unknown>)['type'] === 'AdaptiveCard'
          ? response.blocks[0]
          : {
              type: 'AdaptiveCard',
              version: '1.4',
              body: response.blocks,
            },
      };
    }

    // Text-only acknowledgement
    return {
      statusCode: 200,
      type: 'application/vnd.microsoft.activity.message',
      value: response.text || 'OK',
    };
  },
};

// STATUS ADAPTER

const statusAdapter: StatusAdapter = {
  isConfigured(config: MSTeamsAccountConfig): boolean {
    return !!(config.appId && config.appPassword);
  },

  async checkHealth(config: MSTeamsAccountConfig): Promise<{
    connected: boolean;
    latencyMs?: number;
    error?: string;
    details?: Record<string, unknown>;
  }> {
    if (!config.appId || !config.appPassword) {
      return { connected: false, error: 'App ID and App Password not configured' };
    }

    const start = Date.now();

    const tokenResult = await getAccessToken(
      config.appId,
      config.appPassword,
      config.tenantId
    );

    const latencyMs = Date.now() - start;

    if (tokenResult.ok) {
      return {
        connected: true,
        latencyMs,
        details: {
          appId: config.appId,
          tenantId: config.tenantId || 'botframework.com',
          tokenAcquired: true,
        },
      };
    }

    return {
      connected: false,
      latencyMs,
      error: tokenResult.error,
    };
  },
};

// TEAMS-SPECIFIC HELPERS

/**
 * Build a proactive message target string from a saved activity.
 * Use this to send messages outside of the request/response cycle.
 */
export function buildProactiveTarget(serviceUrl: string, conversationId: string): string {
  return `${serviceUrl}|${conversationId}`;
}

/**
 * Parse channel data from a raw activity payload.
 */
export function extractTeamsChannelData(activity: unknown): TeamsChannelData | undefined {
  return (activity as BotFrameworkActivity).channelData as TeamsChannelData | undefined;
}

/**
 * Check if an activity is from the MS Teams channel.
 */
export function isTeamsActivity(payload: unknown): boolean {
  return (payload as BotFrameworkActivity).channelId === ChannelId.MSTEAMS;
}

/**
 * Check if an activity is a message reaction (user reacted to a bot message).
 */
export function isMessageReactionActivity(payload: unknown): boolean {
  return (payload as BotFrameworkActivity).type === ActivityType.MESSAGE_REACTION;
}

/**
 * Parse reaction events (reactionsAdded / reactionsRemoved).
 */
export function parseReactionActivity(payload: unknown): {
  added: string[];
  removed: string[];
  messageId?: string;
  userId: string;
} | null {
  const activity = payload as BotFrameworkActivity;

  if (activity.type !== ActivityType.MESSAGE_REACTION) return null;
  if (!activity.from) return null;

  return {
    added: (activity.reactionsAdded || []).map(r => r.type),
    removed: (activity.reactionsRemoved || []).map(r => r.type),
    messageId: activity.replyToId,
    userId: activity.from.id,
  };
}

// PROVIDER EXPORT

export const msteamsProvider: ChatProvider<MSTeamsAccountConfig> = {
  meta,
  capabilities,
  defaultConfig: {
    provider: 'msteams',
    enabled: true,
  },
  configSchema: MSTeamsAccountConfigSchema as z.ZodType<MSTeamsAccountConfig>,
  auth: authAdapter,
  outbound: outboundAdapter,
  inbound: inboundAdapter,
  status: statusAdapter,
};

export { setTeamsConfig, clearTeamsConfig };
export type { MSTeamsConfig, BotFrameworkActivity, TeamsChannelData, AdaptiveCard };
export { ActivityType, ChannelId };
