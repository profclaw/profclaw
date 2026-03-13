/**
 * Signal Provider - Full Implementation
 *
 * Signal integration via signald bridge:
 * - signald exposes an HTTP API at localhost:15432 (configurable)
 * - No OAuth; authentication is phone-number based
 * - Supports direct messages and group chats
 * - Supports media attachments
 * - Does NOT support: threads, message editing, rich blocks, reactions,
 *   slash commands, or interactive components
 *
 * Signald HTTP API base: http://localhost:15432
 * Signald docs: https://signald.org/articles/
 *
 * Security level: moderate (phone number based allowlist)
 */

import { z } from 'zod';
import type {
  ChatProvider,
  SignalAccountConfig,
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

// SIGNALD API TYPES

/** Signald message data shape as received in webhook payloads */
interface SignaldDataMessage {
  timestamp?: number;
  message?: string;
  groupInfo?: {
    groupId?: string;
    name?: string;
    type?: string;
  };
  attachments?: SignaldAttachment[];
}

interface SignaldAttachment {
  contentType?: string;
  id?: string;
  size?: number;
  filename?: string;
  storedFilename?: string;
  width?: number;
  height?: number;
}

/** Top-level signald inbound envelope shape */
interface SignaldEnvelope {
  type?: string;
  source?: string;
  sourceDevice?: number;
  timestamp?: number;
  serverTimestamp?: number;
  dataMessage?: SignaldDataMessage;
  syncMessage?: unknown;
  callMessage?: unknown;
}

/** Signald webhook payload (wraps envelope) */
interface SignaldWebhookPayload {
  account?: string;
  envelope?: SignaldEnvelope;
}

/** Signald /v1/send request body */
interface SignaldSendRequest {
  account: string;
  recipientAddress?: {
    number: string;
  };
  recipientGroupId?: string;
  messageBody?: string;
  attachments?: Array<{
    filename?: string;
    url?: string;
    contentType?: string;
  }>;
}

/** Signald /v1/send response */
interface SignaldSendResponse {
  timestamp?: number;
  results?: Array<{
    address?: { number: string };
    success?: unknown;
    networkFailure?: boolean;
    unregisteredFailure?: boolean;
  }>;
}

/** Signald /v1/health response */
interface SignaldHealthResponse {
  version?: string;
  name?: string;
}

// CONFIGURATION

export const SignalAccountConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().optional(),
  provider: z.literal('signal'),
  signaldSocketPath: z.string().optional(),
  phoneNumber: z.string().optional(),
  allowedNumbers: z.array(z.string()).optional(),
}) satisfies z.ZodType<SignalAccountConfig>;

type SignalConfig = z.infer<typeof SignalAccountConfigSchema>;

// METADATA

const meta: ChatProviderMeta = {
  id: 'signal',
  name: 'Signal',
  description: 'Signal messenger via signald bridge for direct and group messaging',
  icon: 'signal icon',
  docsUrl: 'https://signald.org/articles/',
  order: 9,
  color: '#3A76F0',
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
  richBlocks: false,
  oauth: false,
  webhooks: true,
  realtime: false,
};

// STATE

let currentConfig: SignalConfig | null = null;

// HELPER FUNCTIONS

const SIGNALD_DEFAULT_BASE = 'http://localhost:15432';

/**
 * Resolve the signald HTTP API base URL.
 * signaldSocketPath is stored in config for UNIX socket mode,
 * but we always communicate via HTTP API in this implementation.
 */
function getApiBase(_config?: SignalConfig | null): string {
  return SIGNALD_DEFAULT_BASE;
}

async function callSignaldApi<T>(
  endpoint: string,
  method: 'GET' | 'POST' = 'GET',
  body?: Record<string, unknown>,
  config?: SignalConfig | null
): Promise<{ ok: boolean; data?: T; error?: string; status?: number }> {
  const base = getApiBase(config);
  const url = `${base}${endpoint}`;

  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (response.status === 204) {
      return { ok: true, status: 204 };
    }

    const text = await response.text();
    let data: T;
    try {
      data = JSON.parse(text) as T;
    } catch {
      return {
        ok: response.ok,
        status: response.status,
        error: response.ok ? undefined : text || `HTTP ${response.status}`,
      };
    }

    if (!response.ok) {
      const errData = data as { error?: string; message?: string };
      return {
        ok: false,
        status: response.status,
        error: errData.error ?? errData.message ?? `HTTP ${response.status}`,
      };
    }

    return { ok: true, data, status: response.status };
  } catch (error) {
    logger.error('[Signal] API call failed:', error instanceof Error ? error : undefined);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check whether an inbound sender number is in the configured allowlist.
 * If no allowlist is configured, all numbers are allowed.
 */
function isNumberAllowed(number: string, config: SignalConfig | null): boolean {
  const list = config?.allowedNumbers;
  if (!list || list.length === 0) return true;
  return list.includes(number);
}

/**
 * Determine chat type from a signald envelope.
 * If the message contains groupInfo, it is a group message; otherwise direct.
 */
function getChatType(dataMessage: SignaldDataMessage): 'direct' | 'group' {
  return dataMessage.groupInfo ? 'group' : 'direct';
}

/**
 * Derive a display name from a phone number.
 * Returns the number as-is since signald does not provide display names in webhooks.
 */
function displayNameFromNumber(number: string): string {
  return number;
}

/**
 * Map a signald attachment MIME type to our normalized attachment type.
 */
function mapAttachmentType(
  contentType?: string
): 'image' | 'video' | 'audio' | 'file' {
  if (!contentType) return 'file';
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('video/')) return 'video';
  if (contentType.startsWith('audio/')) return 'audio';
  return 'file';
}

// AUTH ADAPTER

const authAdapter: AuthAdapter = {
  getAuthUrl(_state: string, _scopes?: string[]): string {
    // Signal does not use OAuth. The bot phone number is registered
    // directly with signald using the register/verify flow.
    throw new Error(
      'Signal does not use OAuth. Register the bot phone number with signald ' +
      'using the signald register and verify commands.'
    );
  },

  async exchangeCode(_code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  }> {
    throw new Error(
      'Signal does not use OAuth authorization codes. ' +
      'Use the signald register/verify flow for phone number authentication.'
    );
  },

  verifyWebhook(_signature: string, _timestamp: string, _body: string): boolean {
    // signald webhooks are delivered from localhost; no HMAC signing is used.
    // Security is enforced at the network level (bind to loopback only).
    return true;
  },
};

// OUTBOUND ADAPTER

const outboundAdapter: OutboundAdapter = {
  async send(message: OutgoingMessage): Promise<SendResult> {
    if (!currentConfig?.phoneNumber) {
      return { success: false, error: 'Bot phone number not configured' };
    }

    if (!message.to) {
      return { success: false, error: 'Target (to) is required - phone number or group ID' };
    }

    const body: SignaldSendRequest = {
      account: currentConfig.phoneNumber,
      messageBody: message.text ?? '',
    };

    // Determine if target is a group ID or phone number.
    // Group IDs in Signal are base64-encoded byte arrays; phone numbers start with '+'.
    if (message.to.startsWith('+')) {
      body.recipientAddress = { number: message.to };
    } else {
      body.recipientGroupId = message.to;
    }

    // Map outgoing attachments if present
    if (message.attachments && message.attachments.length > 0) {
      body.attachments = message.attachments
        .filter((a) => a.url !== undefined || a.filename !== undefined)
        .map((a) => ({
          filename: a.filename,
          url: a.url,
          contentType: a.mimeType,
        }));
    }

    const result = await callSignaldApi<SignaldSendResponse>(
      '/v1/send',
      'POST',
      body as unknown as Record<string, unknown>
    );

    if (result.ok) {
      // signald returns a timestamp as the message identifier
      const ts = result.data?.timestamp;
      return {
        success: true,
        messageId: ts !== undefined ? String(ts) : undefined,
      };
    }

    return {
      success: false,
      error: result.error ?? 'Failed to send Signal message',
    };
  },

  // Signal via signald does not support message editing
  // edit is intentionally omitted

  // Signal via signald does not support message deletion
  // delete is intentionally omitted

  // Signal does not support reactions
  // react/unreact are intentionally omitted
};

// INBOUND ADAPTER

const inboundAdapter: InboundAdapter = {
  parseMessage(payload: unknown): IncomingMessage | null {
    if (payload === null || typeof payload !== 'object') return null;

    const raw = payload as SignaldWebhookPayload;
    const envelope = raw.envelope;

    if (!envelope) return null;

    // Only process incoming data messages; ignore sync, call, or receipt messages
    if (!envelope.dataMessage) return null;

    const dataMessage = envelope.dataMessage;
    const senderNumber = envelope.source;

    if (!senderNumber) return null;

    if (!isNumberAllowed(senderNumber, currentConfig)) {
      logger.debug(`[Signal] parseMessage: ignoring message from non-allowlisted number ${senderNumber}`);
      return null;
    }

    // Determine chat ID - group ID for groups, sender number for direct messages
    const groupId = dataMessage.groupInfo?.groupId;
    const chatId = groupId ?? senderNumber;
    const chatType = getChatType(dataMessage);
    const chatName = dataMessage.groupInfo?.name;

    // Build normalized attachments
    const attachments: IncomingMessage['attachments'] = [];
    if (dataMessage.attachments && dataMessage.attachments.length > 0) {
      for (const att of dataMessage.attachments) {
        attachments.push({
          type: mapAttachmentType(att.contentType),
          name: att.filename ?? att.storedFilename,
          mimeType: att.contentType,
          size: att.size,
        });
      }
    }

    // Use signald envelope timestamp (milliseconds since epoch) as message ID
    const msgId = envelope.timestamp !== undefined
      ? String(envelope.timestamp)
      : String(Date.now());

    const ts = envelope.serverTimestamp ?? envelope.timestamp ?? Date.now();

    return {
      id: msgId,
      provider: 'signal',
      accountId: currentConfig?.id ?? 'default',
      senderId: senderNumber,
      senderName: displayNameFromNumber(senderNumber),
      senderUsername: senderNumber,
      chatType,
      chatId,
      chatName,
      text: dataMessage.message ?? '',
      rawContent: payload,
      timestamp: new Date(ts),
      attachments: attachments.length > 0 ? attachments : undefined,
    };
  },

  parseCommand(_payload: unknown): SlashCommand | null {
    // Signal does not have native slash commands.
    return null;
  },

  parseAction(_payload: unknown): InteractiveAction | null {
    // Signal does not have interactive components.
    return null;
  },

  buildCommandResponse(response: CommandResponse): unknown {
    // Return a plain text string ready for use as the messageBody field
    // in a /v1/send request body.
    return { messageBody: response.text ?? '' };
  },

  buildActionResponse(response: CommandResponse): unknown {
    return { messageBody: response.text ?? '' };
  },
};

// STATUS ADAPTER

const statusAdapter: StatusAdapter = {
  isConfigured(config: SignalAccountConfig): boolean {
    return !!(config.phoneNumber);
  },

  async checkHealth(config: SignalAccountConfig): Promise<{
    connected: boolean;
    latencyMs?: number;
    error?: string;
    details?: Record<string, unknown>;
  }> {
    if (!config.phoneNumber) {
      return { connected: false, error: 'phoneNumber is required' };
    }

    const signalConfig: SignalConfig = {
      id: config.id,
      name: config.name,
      enabled: config.enabled ?? true,
      isDefault: config.isDefault,
      provider: 'signal',
      signaldSocketPath: config.signaldSocketPath,
      phoneNumber: config.phoneNumber,
      allowedNumbers: config.allowedNumbers,
    };

    const start = Date.now();

    const result = await callSignaldApi<SignaldHealthResponse>(
      '/v1/health',
      'GET',
      undefined,
      signalConfig
    );

    const latencyMs = Date.now() - start;

    if (result.ok) {
      return {
        connected: true,
        latencyMs,
        details: {
          signaldVersion: result.data?.version,
          signaldName: result.data?.name,
          phoneNumber: config.phoneNumber,
          allowedNumbersCount: config.allowedNumbers?.length ?? 'unrestricted',
          socketPath: config.signaldSocketPath ?? 'not configured (HTTP mode)',
        },
      };
    }

    return {
      connected: false,
      latencyMs,
      error: result.error ?? 'Failed to connect to signald',
    };
  },
};

// CONFIG MANAGEMENT

export function setSignalConfig(config: SignalConfig): void {
  currentConfig = config;
}

export function clearSignalConfig(): void {
  currentConfig = null;
}

// PROVIDER EXPORT

export const signalProvider: ChatProvider<SignalAccountConfig> = {
  meta,
  capabilities,
  defaultConfig: {
    provider: 'signal',
    enabled: true,
  },
  configSchema: SignalAccountConfigSchema as z.ZodType<SignalAccountConfig>,
  auth: authAdapter,
  outbound: outboundAdapter,
  inbound: inboundAdapter,
  status: statusAdapter,
};

export type { SignalConfig, SignaldEnvelope, SignaldDataMessage, SignaldWebhookPayload };
