/**
 * Matrix Provider - Full Implementation
 *
 * Matrix Client-Server API v1.x integration using:
 * - Bearer token authentication (access token)
 * - Room-based messaging (direct, group, channel)
 * - Thread support via m.thread relation
 * - Message send via PUT (idempotent transaction IDs)
 * - Health via GET /account/whoami
 * - Room allowlist for security scoping
 * - E2EE flag (placeholder; actual Olm/Megolm crypto deferred)
 *
 * API base: {homeserverUrl}/_matrix/client/v3
 * Spec: https://spec.matrix.org/v1.9/client-server-api/
 */

import { z } from 'zod';
import type {
  ChatProvider,
  MatrixAccountConfig,
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

// MATRIX API TYPES

/** Matrix event types for m.room.message */
const MatrixMsgType = {
  TEXT: 'm.text',
  NOTICE: 'm.notice',
  EMOTE: 'm.emote',
  IMAGE: 'm.image',
  VIDEO: 'm.video',
  AUDIO: 'm.audio',
  FILE: 'm.file',
} as const;

/** Matrix room join rules */
const MatrixRoomType = {
  DIRECT: 'm.direct',
  GROUP: 'group',
} as const;

type MatrixMsgTypeValue = (typeof MatrixMsgType)[keyof typeof MatrixMsgType];

interface MatrixEventContent {
  msgtype?: MatrixMsgTypeValue;
  body?: string;
  format?: string;
  formatted_body?: string;
  url?: string;
  info?: {
    mimetype?: string;
    size?: number;
    w?: number;
    h?: number;
    duration?: number;
  };
  /** Relation metadata (m.thread, m.replace, m.annotation, m.in_reply_to) */
  'm.relates_to'?: {
    rel_type?: string;
    event_id?: string;
    is_falling_back?: boolean;
    /** Annotation reaction key (emoji) for m.annotation rel_type */
    key?: string;
    'm.in_reply_to'?: { event_id: string };
  };
  'm.new_content'?: {
    msgtype?: MatrixMsgTypeValue;
    body?: string;
  };
}

interface MatrixEvent {
  event_id: string;
  type: string;
  room_id: string;
  sender: string;
  origin_server_ts: number;
  content: MatrixEventContent;
  unsigned?: {
    age?: number;
    transaction_id?: string;
    'm.relations'?: Record<string, unknown>;
  };
}

interface MatrixSendResponse {
  event_id: string;
}

interface MatrixWhoAmIResponse {
  user_id: string;
  device_id?: string;
  is_guest?: boolean;
}

interface MatrixRoomInfo {
  room_id: string;
  name?: string;
  canonical_alias?: string;
  is_direct?: boolean;
}

interface MatrixSyncRoomsJoined {
  timeline?: {
    events: MatrixEvent[];
    limited?: boolean;
    prev_batch?: string;
  };
  state?: { events: MatrixEvent[] };
  account_data?: { events: MatrixEvent[] };
}

interface MatrixSyncResponse {
  next_batch: string;
  rooms?: {
    join?: Record<string, MatrixSyncRoomsJoined>;
    invite?: Record<string, unknown>;
    leave?: Record<string, unknown>;
  };
}

// CONFIGURATION

export const MatrixAccountConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().optional(),
  provider: z.literal('matrix'),
  homeserverUrl: z.string().url().optional(),
  accessToken: z.string().optional(),
  userId: z.string().optional(),
  deviceId: z.string().optional(),
  enableEncryption: z.boolean().default(false),
  allowedRoomIds: z.array(z.string()).optional(),
}) satisfies z.ZodType<MatrixAccountConfig>;

type MatrixConfig = z.infer<typeof MatrixAccountConfigSchema>;

// METADATA

const meta: ChatProviderMeta = {
  id: 'matrix',
  name: 'Matrix',
  description: 'Matrix protocol rooms with thread and media support',
  icon: '🔐',
  docsUrl: 'https://spec.matrix.org/v1.9/client-server-api/',
  order: 6,
  color: '#0DBD8B',
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
  webhooks: false,
  realtime: false, // Polling via /sync or Application Service; no built-in push
};

// STATE

let currentConfig: MatrixConfig | null = null;

/** Monotonic transaction ID counter for idempotent PUT sends */
let txnCounter = Date.now();

function nextTxnId(): string {
  return `profclaw_${++txnCounter}`;
}

// HELPER FUNCTIONS

function getApiBase(config?: MatrixConfig | null): string {
  const url = (config ?? currentConfig)?.homeserverUrl ?? '';
  return `${url.replace(/\/$/, '')}/_matrix/client/v3`;
}

function getAuthHeaders(config?: MatrixConfig | null): Record<string, string> {
  const token = (config ?? currentConfig)?.accessToken;
  return {
    'Authorization': token ? `Bearer ${token}` : '',
    'Content-Type': 'application/json',
  };
}

async function callMatrixApi<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: Record<string, unknown>,
  config?: MatrixConfig | null
): Promise<{ ok: boolean; data?: T; error?: string; status?: number }> {
  const base = getApiBase(config);
  const headers = getAuthHeaders(config);

  if (!headers['Authorization'] || headers['Authorization'] === 'Bearer ') {
    return { ok: false, error: 'Access token not configured' };
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

    const data = await response.json() as T & {
      errcode?: string;
      error?: string;
    };

    if (!response.ok) {
      const errData = data as { errcode?: string; error?: string };
      return {
        ok: false,
        status: response.status,
        error: errData.error || errData.errcode || `HTTP ${response.status}`,
      };
    }

    return { ok: true, data, status: response.status };
  } catch (error) {
    logger.error('[Matrix] API call failed:', error instanceof Error ? error : undefined);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Determine chat type from Matrix room membership.
 * Matrix rooms are always rooms; direct rooms are tagged in account_data.
 * We use a heuristic: if room_id starts with a known DM prefix it's direct,
 * otherwise check if userId pattern suggests a DM alias.
 */
function getRoomChatType(
  roomId: string,
  isDirect: boolean,
  threadEventId?: string
): 'direct' | 'group' | 'channel' | 'thread' {
  if (threadEventId) return 'thread';
  if (isDirect) return 'direct';
  // Matrix has no native concept of "channel" vs "group"; we use room id as hint
  // Rooms with a #alias are treated as channels, others as groups
  return roomId.startsWith('#') ? 'channel' : 'group';
}

/**
 * Extract the thread root event_id from a Matrix event's m.relates_to,
 * if rel_type is m.thread.
 */
function extractThreadId(content: MatrixEventContent): string | undefined {
  const rel = content['m.relates_to'];
  if (rel?.rel_type === 'm.thread' && rel.event_id) {
    return rel.event_id;
  }
  return undefined;
}

/**
 * Extract the in-reply-to event_id from a Matrix event.
 */
function extractReplyToId(content: MatrixEventContent): string | undefined {
  const rel = content['m.relates_to'];
  return rel?.['m.in_reply_to']?.event_id;
}

/**
 * Check whether a room is in the configured allowlist.
 * If no allowlist is configured, all rooms are allowed.
 */
function isRoomAllowed(roomId: string, config: MatrixConfig | null): boolean {
  const list = config?.allowedRoomIds;
  if (!list || list.length === 0) return true;
  return list.includes(roomId);
}

/**
 * Derive a human-readable sender display name from a Matrix user ID.
 * Format: @localpart:homeserver  →  localpart
 */
function displayNameFromUserId(userId: string): string {
  const match = /^@([^:]+):/.exec(userId);
  return match ? match[1] : userId;
}

// AUTH ADAPTER

const authAdapter: AuthAdapter = {
  getAuthUrl(_state: string, _scopes?: string[]): string {
    // Matrix does not use OAuth; authentication is via access tokens
    // obtained through /login or registration on the homeserver.
    throw new Error(
      'Matrix does not use OAuth. Obtain an access token via the homeserver ' +
      '/login endpoint or element.io, and supply it in the configuration.'
    );
  },

  async exchangeCode(_code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  }> {
    throw new Error(
      'Matrix does not use OAuth authorization codes. ' +
      'Use the Matrix /login endpoint to get an access token.'
    );
  },

  verifyWebhook(_signature: string, _timestamp: string, _body: string): boolean {
    // Matrix Application Services use a hs_token / as_token pair for auth,
    // not HMAC signatures. Return true as a pass-through; callers should
    // verify the Authorization header against the configured as_token instead.
    return true;
  },
};

// OUTBOUND ADAPTER

const outboundAdapter: OutboundAdapter = {
  async send(message: OutgoingMessage): Promise<SendResult> {
    if (!currentConfig?.accessToken) {
      return { success: false, error: 'Access token not configured' };
    }

    if (!message.to) {
      return { success: false, error: 'Target room ID (to) is required' };
    }

    if (!isRoomAllowed(message.to, currentConfig)) {
      return { success: false, error: `Room ${message.to} is not in the allowlist` };
    }

    const content: MatrixEventContent = {
      msgtype: MatrixMsgType.TEXT,
      body: message.text ?? '',
    };

    // Thread relation
    if (message.threadId) {
      content['m.relates_to'] = {
        rel_type: 'm.thread',
        event_id: message.threadId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: message.replyToId ?? message.threadId },
      };
    } else if (message.replyToId) {
      // Plain reply (not in a thread)
      content['m.relates_to'] = {
        'm.in_reply_to': { event_id: message.replyToId },
      };
    }

    const txnId = nextTxnId();
    const result = await callMatrixApi<MatrixSendResponse>(
      `/rooms/${encodeURIComponent(message.to)}/send/m.room.message/${txnId}`,
      'PUT',
      content as unknown as Record<string, unknown>
    );

    if (result.ok && result.data) {
      return {
        success: true,
        messageId: result.data.event_id,
        threadId: message.threadId,
      };
    }

    return {
      success: false,
      error: result.error ?? 'Failed to send message',
    };
  },

  async edit(
    messageId: string,
    channelId: string,
    content: OutgoingMessage
  ): Promise<SendResult> {
    if (!currentConfig?.accessToken) {
      return { success: false, error: 'Access token not configured' };
    }

    if (!isRoomAllowed(channelId, currentConfig)) {
      return { success: false, error: `Room ${channelId} is not in the allowlist` };
    }

    const newText = content.text ?? '';

    // Matrix edits use m.replace relation
    const eventContent: MatrixEventContent = {
      msgtype: MatrixMsgType.TEXT,
      body: `* ${newText}`,
      'm.new_content': {
        msgtype: MatrixMsgType.TEXT,
        body: newText,
      },
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: messageId,
      },
    };

    const txnId = nextTxnId();
    const result = await callMatrixApi<MatrixSendResponse>(
      `/rooms/${encodeURIComponent(channelId)}/send/m.room.message/${txnId}`,
      'PUT',
      eventContent as unknown as Record<string, unknown>
    );

    if (result.ok && result.data) {
      return {
        success: true,
        messageId: result.data.event_id,
      };
    }

    return {
      success: false,
      error: result.error ?? 'Failed to edit message',
    };
  },

  async delete(
    messageId: string,
    channelId: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!currentConfig?.accessToken) {
      return { success: false, error: 'Access token not configured' };
    }

    if (!isRoomAllowed(channelId, currentConfig)) {
      return { success: false, error: `Room ${channelId} is not in the allowlist` };
    }

    // Matrix redacts (soft-deletes) events via PUT /redact
    const txnId = nextTxnId();
    const result = await callMatrixApi<{ event_id: string }>(
      `/rooms/${encodeURIComponent(channelId)}/redact/${encodeURIComponent(messageId)}/${txnId}`,
      'PUT',
      {}
    );

    return {
      success: result.ok,
      error: result.error,
    };
  },

  async react(
    messageId: string,
    channelId: string,
    emoji: string
  ): Promise<{ success: boolean }> {
    if (!currentConfig?.accessToken) {
      return { success: false };
    }

    if (!isRoomAllowed(channelId, currentConfig)) {
      logger.warn(`[Matrix] react: room ${channelId} not in allowlist`);
      return { success: false };
    }

    // Matrix reactions use m.reaction event type with m.annotation relation
    const content = {
      'm.relates_to': {
        rel_type: 'm.annotation',
        event_id: messageId,
        key: emoji,
      },
    };

    const txnId = nextTxnId();
    const result = await callMatrixApi<MatrixSendResponse>(
      `/rooms/${encodeURIComponent(channelId)}/send/m.reaction/${txnId}`,
      'PUT',
      content
    );

    return { success: result.ok };
  },

  async unreact(
    messageId: string,
    channelId: string,
    emoji: string
  ): Promise<{ success: boolean }> {
    if (!currentConfig?.accessToken) {
      return { success: false };
    }

    if (!isRoomAllowed(channelId, currentConfig)) {
      logger.warn(`[Matrix] unreact: room ${channelId} not in allowlist`);
      return { success: false };
    }

    // To remove a reaction we must find and redact the m.reaction event.
    // First, fetch the relations for the target event.
    const relResult = await callMatrixApi<{
      chunk: Array<{ event_id: string; content: MatrixEventContent; sender: string }>;
    }>(
      `/rooms/${encodeURIComponent(channelId)}/relations/${encodeURIComponent(messageId)}/m.annotation/m.reaction`
    );

    if (!relResult.ok || !relResult.data) {
      return { success: false };
    }

    const botUserId = currentConfig?.userId;
    const reactionEvent = relResult.data.chunk.find(
      (e) =>
        e.content['m.relates_to']?.key === emoji &&
        (!botUserId || e.sender === botUserId)
    );

    if (!reactionEvent) {
      // Reaction not found; treat as success (idempotent)
      return { success: true };
    }

    const txnId = nextTxnId();
    const redactResult = await callMatrixApi<{ event_id: string }>(
      `/rooms/${encodeURIComponent(channelId)}/redact/${encodeURIComponent(reactionEvent.event_id)}/${txnId}`,
      'PUT',
      {}
    );

    return { success: redactResult.ok };
  },
};

// INBOUND ADAPTER

const inboundAdapter: InboundAdapter = {
  parseMessage(payload: unknown): IncomingMessage | null {
    // Accepts either a raw MatrixEvent or a sync-style wrapper:
    // { event: MatrixEvent, roomId: string, isDirect?: boolean }
    let event: MatrixEvent;
    let roomId: string;
    let isDirect = false;

    if (
      payload !== null &&
      typeof payload === 'object' &&
      'event' in (payload as Record<string, unknown>) &&
      'roomId' in (payload as Record<string, unknown>)
    ) {
      const wrapped = payload as {
        event: MatrixEvent;
        roomId: string;
        isDirect?: boolean;
      };
      event = wrapped.event;
      roomId = wrapped.roomId;
      isDirect = wrapped.isDirect ?? false;
    } else {
      event = payload as MatrixEvent;
      roomId = event.room_id;
    }

    if (!event || event.type !== 'm.room.message') return null;

    const content = event.content;
    if (!content.body) return null;

    // Ignore non-text message types for now (images, files etc. still parsed below)
    const supportedMsgTypes: string[] = [
      MatrixMsgType.TEXT,
      MatrixMsgType.NOTICE,
      MatrixMsgType.EMOTE,
      MatrixMsgType.IMAGE,
      MatrixMsgType.VIDEO,
      MatrixMsgType.AUDIO,
      MatrixMsgType.FILE,
    ];

    if (content.msgtype && !supportedMsgTypes.includes(content.msgtype)) {
      return null;
    }

    if (!isRoomAllowed(roomId, currentConfig)) {
      logger.debug(`[Matrix] parseMessage: ignoring event from non-allowlisted room ${roomId}`);
      return null;
    }

    const threadId = extractThreadId(content);
    const replyToId = extractReplyToId(content);
    const chatType = getRoomChatType(roomId, isDirect, threadId);

    const attachments: IncomingMessage['attachments'] = [];
    if (content.url && content.msgtype) {
      const typeMap: Record<string, 'image' | 'video' | 'audio' | 'file'> = {
        [MatrixMsgType.IMAGE]: 'image',
        [MatrixMsgType.VIDEO]: 'video',
        [MatrixMsgType.AUDIO]: 'audio',
        [MatrixMsgType.FILE]: 'file',
      };
      const attachType = typeMap[content.msgtype] ?? 'file';
      attachments.push({
        type: attachType,
        url: content.url,
        name: content.body,
        mimeType: content.info?.mimetype,
        size: content.info?.size,
      });
    }

    return {
      id: event.event_id,
      provider: 'matrix',
      accountId: currentConfig?.id ?? 'default',
      senderId: event.sender,
      senderName: displayNameFromUserId(event.sender),
      senderUsername: event.sender,
      chatType,
      chatId: roomId,
      chatName: undefined, // Resolved separately via /rooms/{roomId}/state/m.room.name
      threadId,
      replyToId,
      text: content.body,
      rawContent: event,
      timestamp: new Date(event.origin_server_ts),
      attachments: attachments.length > 0 ? attachments : undefined,
    };
  },

  parseCommand(_payload: unknown): SlashCommand | null {
    // Matrix does not have native slash commands.
    // Slash-command-like behavior can be implemented by inspecting message text,
    // but that is handled at the application layer, not the provider layer.
    return null;
  },

  parseAction(_payload: unknown): InteractiveAction | null {
    // Matrix does not have native interactive components.
    return null;
  },

  buildCommandResponse(response: CommandResponse): unknown {
    // Used when the application layer processes a text-based command.
    // Return a Matrix event content object ready for PUT /send.
    return {
      msgtype: response.responseType === 'ephemeral' ? MatrixMsgType.NOTICE : MatrixMsgType.TEXT,
      body: response.text ?? '',
    };
  },

  buildActionResponse(response: CommandResponse): unknown {
    return {
      msgtype: MatrixMsgType.TEXT,
      body: response.text ?? '',
    };
  },
};

// STATUS ADAPTER

const statusAdapter: StatusAdapter = {
  isConfigured(config: MatrixAccountConfig): boolean {
    return !!(config.homeserverUrl && config.accessToken && config.userId);
  },

  async checkHealth(config: MatrixAccountConfig): Promise<{
    connected: boolean;
    latencyMs?: number;
    error?: string;
    details?: Record<string, unknown>;
  }> {
    if (!config.homeserverUrl || !config.accessToken) {
      return { connected: false, error: 'homeserverUrl and accessToken are required' };
    }

    const matrixConfig: MatrixConfig = {
      id: config.id,
      name: config.name,
      enabled: config.enabled ?? true,
      isDefault: config.isDefault,
      provider: 'matrix',
      homeserverUrl: config.homeserverUrl,
      accessToken: config.accessToken,
      userId: config.userId,
      deviceId: config.deviceId,
      enableEncryption: config.enableEncryption ?? false,
      allowedRoomIds: config.allowedRoomIds,
    };

    const start = Date.now();

    const result = await callMatrixApi<MatrixWhoAmIResponse>(
      '/account/whoami',
      'GET',
      undefined,
      matrixConfig
    );

    const latencyMs = Date.now() - start;

    if (result.ok && result.data) {
      const encryptionNote = config.enableEncryption
        ? 'E2EE flag set (crypto implementation deferred)'
        : 'E2EE disabled';

      return {
        connected: true,
        latencyMs,
        details: {
          userId: result.data.user_id,
          deviceId: result.data.device_id,
          isGuest: result.data.is_guest ?? false,
          homeserverUrl: config.homeserverUrl,
          encryptionStatus: encryptionNote,
          allowedRoomsCount: config.allowedRoomIds?.length ?? 'unrestricted',
        },
      };
    }

    return {
      connected: false,
      latencyMs,
      error: result.error ?? 'Failed to connect to homeserver',
    };
  },
};

// EXPORTED HELPERS

/**
 * Parse incoming events from a Matrix /sync response.
 * Yields normalized IncomingMessage objects for all m.room.message events
 * in joined rooms that pass the allowlist filter.
 */
export function parseSyncResponse(
  syncResponse: MatrixSyncResponse,
  directRoomIds: Set<string> = new Set()
): IncomingMessage[] {
  const messages: IncomingMessage[] = [];
  const joinedRooms = syncResponse.rooms?.join ?? {};

  for (const [roomId, roomData] of Object.entries(joinedRooms)) {
    const events = roomData.timeline?.events ?? [];
    const isDirect = directRoomIds.has(roomId);

    for (const event of events) {
      if (event.type !== 'm.room.message') continue;

      const parsed = inboundAdapter.parseMessage({ event, roomId, isDirect });
      if (parsed) {
        messages.push(parsed);
      }
    }
  }

  return messages;
}

/**
 * Fetch joined room info for a specific room.
 * Returns room name and whether it's a direct message.
 */
export async function getRoomInfo(
  roomId: string,
  config?: MatrixConfig | null
): Promise<{ ok: boolean; data?: MatrixRoomInfo; error?: string }> {
  const result = await callMatrixApi<{
    name?: string;
    canonical_alias?: string;
    is_direct?: boolean;
  }>(
    `/rooms/${encodeURIComponent(roomId)}/state/m.room.name/`,
    'GET',
    undefined,
    config ?? currentConfig
  );

  if (result.ok && result.data) {
    return {
      ok: true,
      data: {
        room_id: roomId,
        name: result.data.name,
        canonical_alias: result.data.canonical_alias,
        is_direct: result.data.is_direct,
      },
    };
  }

  return { ok: false, error: result.error };
}

// CONFIG MANAGEMENT

export function setMatrixConfig(config: MatrixConfig): void {
  currentConfig = config;
}

export function clearMatrixConfig(): void {
  currentConfig = null;
}

// PROVIDER EXPORT

export const matrixProvider: ChatProvider<MatrixAccountConfig> = {
  meta,
  capabilities,
  defaultConfig: {
    provider: 'matrix',
    enabled: true,
    enableEncryption: false,
  },
  configSchema: MatrixAccountConfigSchema as z.ZodType<MatrixAccountConfig>,
  auth: authAdapter,
  outbound: outboundAdapter,
  inbound: inboundAdapter,
  status: statusAdapter,
};

export type { MatrixConfig, MatrixEvent, MatrixEventContent, MatrixSyncResponse };
export { MatrixMsgType, MatrixRoomType };
