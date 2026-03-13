/**
 * Google Chat Provider - Full Implementation
 *
 * Google Chat integration supporting:
 * - Outbound via incoming webhook (simple, no auth required)
 * - Outbound via Google Chat REST API v1 (requires service account)
 * - Inbound event parsing (MESSAGE, CARD_CLICKED events)
 * - Cards v2 format for interactive components
 * - Space (group) and direct message support
 * - Thread support via threadKey / thread.name
 *
 * Auth model: Service account (no OAuth flow needed for bots).
 * Webhook-only mode available for send-only use cases.
 *
 * API reference: https://developers.google.com/workspace/chat/api/reference/rest
 */

import { z } from 'zod';
import type {
  ChatProvider,
  GoogleChatAccountConfig,
  ChatProviderMeta,
  ChatProviderCapabilities,
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

// GOOGLE CHAT API TYPES

/** Google Chat event types delivered via HTTP */
const GoogleChatEventType = {
  MESSAGE: 'MESSAGE',
  CARD_CLICKED: 'CARD_CLICKED',
  ADDED_TO_SPACE: 'ADDED_TO_SPACE',
  REMOVED_FROM_SPACE: 'REMOVED_FROM_SPACE',
} as const;

type GoogleChatEventTypeValue = typeof GoogleChatEventType[keyof typeof GoogleChatEventType];

/** Space types */
const GoogleChatSpaceType = {
  ROOM: 'ROOM',
  DM: 'DM',
  GROUP_CHAT: 'GROUP_CHAT',
} as const;

interface GoogleChatUser {
  name: string;          // e.g. "users/12345"
  displayName?: string;
  avatarUrl?: string;
  email?: string;
  type?: 'HUMAN' | 'BOT';
  domainId?: string;
}

interface GoogleChatSpace {
  name: string;          // e.g. "spaces/AAAA"
  type?: string;         // ROOM | DM | GROUP_CHAT
  displayName?: string;
  singleUserBotDm?: boolean;
}

interface GoogleChatThread {
  name: string;          // e.g. "spaces/AAAA/threads/BBBB"
  retentionSettings?: unknown;
}

interface GoogleChatAttachment {
  name?: string;
  contentName?: string;
  contentType?: string;
  thumbnailUri?: string;
  downloadUri?: string;
  source?: string;
  attachmentDataRef?: { resourceName: string };
  driveDataRef?: { driveFileId: string };
}

interface GoogleChatAnnotation {
  type?: string;
  startIndex?: number;
  length?: number;
  userMention?: { user: GoogleChatUser; type: string };
  slashCommand?: {
    bot: GoogleChatUser;
    type: string;
    commandName: string;
    commandId: string;
    triggersDialog?: boolean;
  };
}

interface GoogleChatMessage {
  name: string;          // e.g. "spaces/AAAA/messages/CCCC"
  sender: GoogleChatUser;
  createTime: string;    // RFC3339 timestamp
  lastUpdateTime?: string;
  text?: string;
  thread?: GoogleChatThread;
  space?: GoogleChatSpace;
  fallbackText?: string;
  annotations?: GoogleChatAnnotation[];
  argumentText?: string; // Text after slash command name
  attachment?: GoogleChatAttachment[];
  slashCommand?: { commandId: string };
}

interface GoogleChatActionResponse {
  type: string;          // NEW_MESSAGE | UPDATE_MESSAGE | UPDATE_USER_MESSAGE_CARDS | REQUEST_CONFIG | DIALOG
  url?: string;          // for REQUEST_CONFIG
  dialogAction?: unknown;
}

interface GoogleChatCardAction {
  actionMethodName?: string;
  parameters?: Array<{ key: string; value: string }>;
}

interface GoogleChatInteraction {
  type: GoogleChatEventTypeValue;
  eventTime: string;
  space: GoogleChatSpace;
  message?: GoogleChatMessage;
  user?: GoogleChatUser;
  action?: GoogleChatCardAction;
  configCompleteRedirectUrl?: string;
}

/** Google Chat Cards v2 types */
interface GoogleChatCardSection {
  header?: string;
  widgets: GoogleChatWidget[];
  collapsible?: boolean;
  uncollapsibleWidgetsCount?: number;
}

interface GoogleChatWidget {
  textParagraph?: { text: string };
  image?: { imageUrl: string; altText?: string; onClick?: unknown };
  buttonList?: {
    buttons: Array<{
      text: string;
      onClick?: { action?: { function: string; parameters?: Array<{ key: string; value: string }> } };
      disabled?: boolean;
    }>;
  };
  decoratedText?: {
    icon?: { knownIcon?: string; iconUrl?: string };
    topLabel?: string;
    text: string;
    bottomLabel?: string;
    button?: unknown;
  };
  selectionInput?: {
    type: 'CHECK_BOX' | 'RADIO_BUTTON' | 'SWITCH' | 'DROPDOWN';
    label?: string;
    name: string;
    items: Array<{ text: string; value: string; selected?: boolean }>;
    onChangeAction?: { function: string };
  };
  textInput?: {
    label?: string;
    hintText?: string;
    value?: string;
    name: string;
    type?: 'SINGLE_LINE' | 'MULTIPLE_LINE';
    onChangeAction?: { function: string };
  };
}

interface GoogleChatCard {
  cardId?: string;
  card: {
    header?: {
      title?: string;
      subtitle?: string;
      imageUrl?: string;
      imageType?: 'SQUARE' | 'CIRCLE';
    };
    sections?: GoogleChatCardSection[];
    fixedFooter?: unknown;
    name?: string;
    peek_card_header?: unknown;
  };
}

/** Outbound message body for Google Chat REST API */
interface GoogleChatMessageBody {
  text?: string;
  cardsV2?: GoogleChatCard[];
  thread?: { name?: string; threadKey?: string };
  fallbackText?: string;
  actionResponse?: GoogleChatActionResponse;
}

/** API response for creating a message */
interface GoogleChatMessageResponse {
  name: string;
  sender: GoogleChatUser;
  createTime: string;
  text?: string;
  thread?: GoogleChatThread;
  space?: GoogleChatSpace;
}

// CONFIGURATION

export const GoogleChatAccountConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().optional(),
  provider: z.literal('googlechat'),
  serviceAccountKey: z.string().optional(),
  projectId: z.string().optional(),
  webhookUrl: z.string().url().optional(),
  allowedSpaceIds: z.array(z.string()).optional(),
}) satisfies z.ZodType<GoogleChatAccountConfig>;

type GoogleChatConfig = z.infer<typeof GoogleChatAccountConfigSchema>;

// METADATA

const meta: ChatProviderMeta = {
  id: 'googlechat',
  name: 'Google Chat',
  description: 'Google Chat bot using service account or incoming webhooks',
  icon: '💬',
  docsUrl: 'https://developers.google.com/workspace/chat/api/reference/rest',
  order: 7,
  color: '#00AC47',
};

// CAPABILITIES

const capabilities: ChatProviderCapabilities = {
  chatTypes: ['direct', 'group', 'thread'],
  send: true,
  receive: true,
  slashCommands: false,   // Limited slash command support via annotations
  interactiveComponents: true,  // Cards v2
  reactions: false,
  edit: true,
  delete: true,
  threads: true,
  media: true,
  richBlocks: true,       // Cards v2
  oauth: false,           // Service account, no OAuth flow
  webhooks: true,
  realtime: false,
};

// MODULE STATE

const GOOGLE_CHAT_API_BASE = 'https://chat.googleapis.com/v1';

let currentConfig: GoogleChatConfig | null = null;

export function setGoogleChatConfig(config: GoogleChatConfig): void {
  currentConfig = config;
}

export function clearGoogleChatConfig(): void {
  currentConfig = null;
}

// HELPER FUNCTIONS

/**
 * Extract a Bearer token from a service account key JSON string.
 *
 * Google service account auth requires signing a JWT and exchanging it for an
 * access token via https://oauth2.googleapis.com/token.  This implementation
 * uses the Web Crypto API (SubtleCrypto) which is available in Node 18+ /
 * Cloudflare Workers / Deno without any third-party library.
 *
 * Scope required: https://www.googleapis.com/auth/chat.bot
 */
async function getAccessToken(serviceAccountKeyJson: string): Promise<string | null> {
  try {
    const key = JSON.parse(serviceAccountKeyJson) as {
      client_email: string;
      private_key: string;
      token_uri?: string;
    };

    const now = Math.floor(Date.now() / 1000);
    const tokenUri = key.token_uri || 'https://oauth2.googleapis.com/token';
    const scope = 'https://www.googleapis.com/auth/chat.bot';

    // Build JWT header + payload
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      iss: key.client_email,
      scope,
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    };

    const encode = (obj: object): string =>
      btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const signingInput = `${encode(header)}.${encode(payload)}`;

    // Strip PEM headers and decode
    const pemBody = key.private_key
      .replace(/-----BEGIN PRIVATE KEY-----/g, '')
      .replace(/-----END PRIVATE KEY-----/g, '')
      .replace(/\s+/g, '');

    const binaryDer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      binaryDer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      new TextEncoder().encode(signingInput)
    );

    const base64Sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const jwt = `${signingInput}.${base64Sig}`;

    // Exchange JWT for access token
    const tokenResponse = await fetch(tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });

    if (!tokenResponse.ok) {
      const err = await tokenResponse.text();
      logger.error('[GoogleChat] Token exchange failed:', new Error(err));
      return null;
    }

    const tokenData = await tokenResponse.json() as { access_token: string };
    return tokenData.access_token;
  } catch (error) {
    logger.error('[GoogleChat] getAccessToken failed:', error instanceof Error ? error : undefined);
    return null;
  }
}

/**
 * Call the Google Chat REST API.
 */
async function callGoogleChatApi<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  body?: Record<string, unknown>,
  accessToken?: string
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const token = accessToken;
  if (!token) {
    return { ok: false, error: 'No access token available' };
  }

  const url = `${GOOGLE_CHAT_API_BASE}${endpoint}`;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 204) {
      return { ok: true };
    }

    const data = await response.json() as T & { error?: { message?: string; status?: string } };

    if (!response.ok) {
      const apiErr = (data as { error?: { message?: string } }).error;
      return {
        ok: false,
        error: apiErr?.message || `HTTP ${response.status}`,
      };
    }

    return { ok: true, data };
  } catch (error) {
    logger.error('[GoogleChat] API call failed:', error instanceof Error ? error : undefined);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Send via incoming webhook URL (simple, text or cards).
 */
async function sendViaWebhook(
  webhookUrl: string,
  body: GoogleChatMessageBody
): Promise<SendResult> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      return { success: false, error: err || `HTTP ${response.status}` };
    }

    const data = await response.json() as { name?: string; thread?: { name?: string } };
    return {
      success: true,
      messageId: data.name,
      threadId: data.thread?.name,
    };
  } catch (error) {
    logger.error('[GoogleChat] Webhook send failed:', error instanceof Error ? error : undefined);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Extract the space ID portion from a space resource name.
 * e.g. "spaces/AAAA" → "AAAA"
 */
function spaceIdFromName(name: string): string {
  return name.startsWith('spaces/') ? name.slice('spaces/'.length) : name;
}

/**
 * Extract a user display name from a GoogleChatUser.
 */
function getDisplayName(user: GoogleChatUser): string {
  return user.displayName || user.email || user.name;
}

/**
 * Determine chat type from space.
 */
function getChatType(space?: GoogleChatSpace): 'direct' | 'group' | 'thread' {
  if (!space) return 'group';

  switch (space.type) {
    case GoogleChatSpaceType.DM:
      return 'direct';
    case GoogleChatSpaceType.ROOM:
    case GoogleChatSpaceType.GROUP_CHAT:
    default:
      return 'group';
  }
}

/**
 * Build request body from an OutgoingMessage.
 */
function buildMessageBody(message: OutgoingMessage): GoogleChatMessageBody {
  const body: GoogleChatMessageBody = {};

  if (message.text) {
    body.text = message.text;
  }

  // Blocks are expected to be GoogleChatCard[] when using Google Chat
  if (message.blocks && Array.isArray(message.blocks) && message.blocks.length > 0) {
    body.cardsV2 = message.blocks as GoogleChatCard[];
  }

  // Thread support: threadId is the thread resource name ("spaces/X/threads/Y")
  if (message.threadId) {
    body.thread = { name: message.threadId };
  }

  return body;
}

// OUTBOUND ADAPTER

const outboundAdapter: OutboundAdapter = {
  async send(message: OutgoingMessage): Promise<SendResult> {
    const config = currentConfig;
    if (!config) {
      return { success: false, error: 'Google Chat not configured' };
    }

    const body = buildMessageBody(message);

    // Prefer webhook for simple sends when no API auth is needed
    if (config.webhookUrl && !config.serviceAccountKey) {
      return sendViaWebhook(config.webhookUrl, body);
    }

    // Use API with service account
    if (config.serviceAccountKey) {
      const accessToken = await getAccessToken(config.serviceAccountKey);
      if (!accessToken) {
        // Fall back to webhook if available
        if (config.webhookUrl) {
          logger.error('[GoogleChat] API auth failed, falling back to webhook');
          return sendViaWebhook(config.webhookUrl, body);
        }
        return { success: false, error: 'Failed to obtain access token' };
      }

      // `message.to` is expected to be the space resource name, e.g. "spaces/AAAA"
      const spaceName = message.to.startsWith('spaces/')
        ? message.to
        : `spaces/${message.to}`;

      const result = await callGoogleChatApi<GoogleChatMessageResponse>(
        `/${spaceName}/messages`,
        'POST',
        body as unknown as Record<string, unknown>,
        accessToken
      );

      if (result.ok && result.data) {
        return {
          success: true,
          messageId: result.data.name,
          threadId: result.data.thread?.name,
        };
      }

      return { success: false, error: result.error || 'Failed to send message' };
    }

    return { success: false, error: 'No webhook URL or service account key configured' };
  },

  async edit(
    messageId: string,
    _channelId: string,
    content: OutgoingMessage
  ): Promise<SendResult> {
    const config = currentConfig;
    if (!config?.serviceAccountKey) {
      return { success: false, error: 'Service account required to edit messages' };
    }

    const accessToken = await getAccessToken(config.serviceAccountKey);
    if (!accessToken) {
      return { success: false, error: 'Failed to obtain access token' };
    }

    // messageId should be the full resource name "spaces/.../messages/..."
    const resourceName = messageId.startsWith('spaces/') ? messageId : `spaces/${messageId}`;

    const body = buildMessageBody(content);
    // PATCH with updateMask
    const updateMask = [
      content.text !== undefined ? 'text' : null,
      content.blocks !== undefined ? 'cardsV2' : null,
    ].filter(Boolean).join(',');

    const result = await callGoogleChatApi<GoogleChatMessageResponse>(
      `/${resourceName}?updateMask=${encodeURIComponent(updateMask)}`,
      'PATCH',
      body as unknown as Record<string, unknown>,
      accessToken
    );

    return {
      success: result.ok,
      messageId: result.ok ? messageId : undefined,
      error: result.error,
    };
  },

  async delete(
    messageId: string,
    _channelId: string
  ): Promise<{ success: boolean; error?: string }> {
    const config = currentConfig;
    if (!config?.serviceAccountKey) {
      return { success: false, error: 'Service account required to delete messages' };
    }

    const accessToken = await getAccessToken(config.serviceAccountKey);
    if (!accessToken) {
      return { success: false, error: 'Failed to obtain access token' };
    }

    const resourceName = messageId.startsWith('spaces/') ? messageId : `spaces/${messageId}`;

    const result = await callGoogleChatApi<void>(
      `/${resourceName}`,
      'DELETE',
      undefined,
      accessToken
    );

    return { success: result.ok, error: result.error };
  },
};

// INBOUND ADAPTER

const inboundAdapter: InboundAdapter = {
  parseMessage(payload: unknown): IncomingMessage | null {
    const event = payload as GoogleChatInteraction;

    if (event.type !== GoogleChatEventType.MESSAGE) return null;

    const message = event.message;
    if (!message) return null;

    const sender = message.sender;
    if (!sender) return null;

    // Filter by allowed space IDs if configured
    const spaceId = spaceIdFromName(event.space.name);
    if (currentConfig?.allowedSpaceIds?.length) {
      if (!currentConfig.allowedSpaceIds.includes(spaceId)) {
        logger.error(
          `[GoogleChat] Message from disallowed space ${spaceId}, ignoring`
        );
        return null;
      }
    }

    const attachments: IncomingMessage['attachments'] = message.attachment?.map(a => ({
      type: a.contentType?.startsWith('image/') ? 'image' as const
          : a.contentType?.startsWith('video/') ? 'video' as const
          : a.contentType?.startsWith('audio/') ? 'audio' as const
          : 'file' as const,
      url: a.downloadUri || a.thumbnailUri,
      name: a.contentName,
      mimeType: a.contentType,
    })) ?? [];

    return {
      id: message.name,
      provider: 'googlechat',
      accountId: currentConfig?.id || 'default',
      senderId: sender.name,
      senderName: getDisplayName(sender),
      senderUsername: sender.email,
      chatType: getChatType(event.space),
      chatId: event.space.name,
      chatName: event.space.displayName,
      threadId: message.thread?.name,
      text: message.text ?? message.argumentText ?? '',
      rawContent: event,
      timestamp: new Date(message.createTime),
      editedAt: message.lastUpdateTime ? new Date(message.lastUpdateTime) : undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
    };
  },

  parseCommand(payload: unknown): SlashCommand | null {
    // Google Chat delivers slash commands as MESSAGE events with annotation type SLASH_COMMAND
    const event = payload as GoogleChatInteraction;

    if (event.type !== GoogleChatEventType.MESSAGE) return null;

    const message = event.message;
    if (!message?.annotations) return null;

    const slashAnnotation = message.annotations.find(
      a => a.type === 'SLASH_COMMAND' && a.slashCommand
    );

    if (!slashAnnotation?.slashCommand) return null;

    const slash = slashAnnotation.slashCommand;
    const sender = message.sender;
    if (!sender) return null;

    return {
      provider: 'googlechat',
      accountId: currentConfig?.id || 'default',
      command: `/${slash.commandName}`,
      text: message.argumentText ?? '',
      userId: sender.name,
      userName: getDisplayName(sender),
      channelId: event.space.name,
      channelName: event.space.displayName,
      chatType: getChatType(event.space),
      triggerId: undefined,
      responseUrl: undefined,
      raw: event,
    };
  },

  parseAction(payload: unknown): InteractiveAction | null {
    const event = payload as GoogleChatInteraction;

    if (event.type !== GoogleChatEventType.CARD_CLICKED) return null;
    if (!event.action?.actionMethodName) return null;

    const sender = event.user;
    if (!sender) return null;

    // Extract value from parameters (first parameter's value, or the method name)
    const parameters = event.action.parameters ?? [];
    const value = parameters.length > 0
      ? parameters[0].value
      : event.action.actionMethodName;

    return {
      provider: 'googlechat',
      accountId: currentConfig?.id || 'default',
      type: 'button',
      actionId: event.action.actionMethodName,
      value,
      userId: sender.name,
      userName: getDisplayName(sender),
      channelId: event.space?.name,
      messageId: event.message?.name,
      threadId: event.message?.thread?.name,
      triggerId: undefined,
      raw: event,
    };
  },

  buildCommandResponse(response: CommandResponse): unknown {
    const body: GoogleChatMessageBody = {};

    if (response.text) {
      body.text = response.text;
    }

    if (response.blocks && Array.isArray(response.blocks) && response.blocks.length > 0) {
      body.cardsV2 = response.blocks as GoogleChatCard[];
    }

    // Google Chat ephemeral: use actionResponse with type EPHEMERAL
    if (response.responseType === 'ephemeral') {
      body.actionResponse = { type: 'EPHEMERAL' };
    } else {
      body.actionResponse = { type: 'NEW_MESSAGE' };
    }

    return body;
  },

  buildActionResponse(response: CommandResponse): unknown {
    const body: GoogleChatMessageBody = {};

    if (response.text) {
      body.text = response.text;
    }

    if (response.blocks && Array.isArray(response.blocks) && response.blocks.length > 0) {
      body.cardsV2 = response.blocks as GoogleChatCard[];
    }

    // Update the existing card message
    body.actionResponse = { type: 'UPDATE_MESSAGE' };

    return body;
  },
};

// STATUS ADAPTER

const statusAdapter: StatusAdapter = {
  isConfigured(config: GoogleChatAccountConfig): boolean {
    return !!(config.serviceAccountKey || config.webhookUrl);
  },

  async checkHealth(config: GoogleChatAccountConfig): Promise<{
    connected: boolean;
    latencyMs?: number;
    error?: string;
    details?: Record<string, unknown>;
  }> {
    const start = Date.now();

    // Webhook-only mode: do a HEAD request to the webhook URL to verify it's reachable
    if (config.webhookUrl && !config.serviceAccountKey) {
      try {
        const response = await fetch(config.webhookUrl, { method: 'HEAD' });
        const latencyMs = Date.now() - start;

        // Google Chat webhooks return 405 Method Not Allowed for HEAD
        // (they only accept POST), which means the URL is reachable.
        if (response.ok || response.status === 405 || response.status === 400) {
          return {
            connected: true,
            latencyMs,
            details: {
              mode: 'webhook',
              status: response.status,
            },
          };
        }

        return {
          connected: false,
          latencyMs,
          error: `Webhook URL returned HTTP ${response.status}`,
        };
      } catch (error) {
        return {
          connected: false,
          latencyMs: Date.now() - start,
          error: error instanceof Error ? error.message : 'Webhook URL unreachable',
        };
      }
    }

    // Service account mode: obtain a token and call the Spaces list endpoint
    if (config.serviceAccountKey) {
      const accessToken = await getAccessToken(config.serviceAccountKey);
      if (!accessToken) {
        return {
          connected: false,
          latencyMs: Date.now() - start,
          error: 'Failed to obtain access token from service account',
        };
      }

      const result = await callGoogleChatApi<{
        spaces?: Array<{ name: string; displayName?: string; type?: string }>;
      }>(
        '/spaces',
        'GET',
        undefined,
        accessToken
      );

      const latencyMs = Date.now() - start;

      if (result.ok) {
        return {
          connected: true,
          latencyMs,
          details: {
            mode: 'service_account',
            spaceCount: result.data?.spaces?.length ?? 0,
          },
        };
      }

      return {
        connected: false,
        latencyMs,
        error: result.error || 'Failed to connect to Google Chat API',
      };
    }

    return {
      connected: false,
      error: 'No webhook URL or service account key configured',
    };
  },
};

// UTILITY EXPORTS

/**
 * Build a simple text card for Google Chat (Cards v2 format).
 */
export function buildTextCard(title: string, body: string, cardId?: string): GoogleChatCard {
  return {
    cardId: cardId || 'text_card',
    card: {
      header: { title },
      sections: [
        {
          widgets: [{ textParagraph: { text: body } }],
        },
      ],
    },
  };
}

/**
 * Build a button list card for Google Chat.
 */
export function buildButtonCard(
  title: string,
  buttons: Array<{ label: string; actionMethodName: string; parameters?: Array<{ key: string; value: string }> }>,
  cardId?: string
): GoogleChatCard {
  return {
    cardId: cardId || 'button_card',
    card: {
      header: { title },
      sections: [
        {
          widgets: [
            {
              buttonList: {
                buttons: buttons.map(b => ({
                  text: b.label,
                  onClick: {
                    action: {
                      function: b.actionMethodName,
                      parameters: b.parameters,
                    },
                  },
                })),
              },
            },
          ],
        },
      ],
    },
  };
}

/**
 * Verify that a Google Chat event originates from Google's servers by checking
 * the Bearer token in the Authorization header against the project number.
 *
 * For production use, validate the token with Google's tokeninfo endpoint.
 * https://developers.google.com/workspace/chat/authorize-import#validate-http-request-from-chat
 */
export async function verifyGoogleChatToken(
  authorizationHeader: string | undefined,
  expectedAudience: string
): Promise<boolean> {
  if (!authorizationHeader?.startsWith('Bearer ')) {
    return false;
  }

  const token = authorizationHeader.slice(7);

  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`
    );

    if (!response.ok) return false;

    const info = await response.json() as {
      aud?: string;
      email?: string;
      email_verified?: string;
    };

    // Verify audience matches the project number / app
    if (info.aud !== expectedAudience) return false;

    // Verify the caller is the Chat service account
    if (!info.email?.endsWith('@system.gserviceaccount.com')) return false;

    return info.email_verified === 'true';
  } catch (error) {
    logger.error('[GoogleChat] Token verification failed:', error instanceof Error ? error : undefined);
    return false;
  }
}

// PROVIDER EXPORT

export const googlechatProvider: ChatProvider<GoogleChatAccountConfig> = {
  meta,
  capabilities,
  defaultConfig: {
    provider: 'googlechat',
    enabled: true,
  },
  configSchema: GoogleChatAccountConfigSchema as z.ZodType<GoogleChatAccountConfig>,
  outbound: outboundAdapter,
  inbound: inboundAdapter,
  status: statusAdapter,
};

export type {
  GoogleChatConfig,
  GoogleChatInteraction,
  GoogleChatMessage,
  GoogleChatCard,
  GoogleChatCardSection,
  GoogleChatWidget,
  GoogleChatMessageBody,
  GoogleChatUser,
  GoogleChatSpace,
};
export { GoogleChatEventType, GoogleChatSpaceType };
