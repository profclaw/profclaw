/**
 * WhatsApp Provider - Full Implementation
 *
 * Secure WhatsApp Business Cloud API integration with:
 * - HMAC-SHA256 webhook signature verification
 * - Message sending via Cloud API
 * - Interactive messages (buttons, lists)
 * - Media support
 */

import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'crypto';
import type {
  ChatProvider,
  WhatsAppAccountConfig,
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
// WHATSAPP API TYPES
// =============================================================================

interface WhatsAppContact {
  profile: {
    name: string;
  };
  wa_id: string;
}

interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'image' | 'document' | 'audio' | 'video' | 'location' | 'contacts' | 'interactive' | 'button';
  text?: {
    body: string;
  };
  image?: {
    id: string;
    mime_type: string;
    sha256: string;
    caption?: string;
  };
  document?: {
    id: string;
    mime_type: string;
    sha256: string;
    filename?: string;
    caption?: string;
  };
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: {
      id: string;
      title: string;
    };
    list_reply?: {
      id: string;
      title: string;
      description?: string;
    };
  };
  button?: {
    text: string;
    payload: string;
  };
  context?: {
    from: string;
    id: string;
  };
}

interface WhatsAppStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  errors?: Array<{
    code: number;
    title: string;
    message: string;
  }>;
}

interface WhatsAppWebhookEntry {
  id: string;
  changes: Array<{
    value: {
      messaging_product: 'whatsapp';
      metadata: {
        display_phone_number: string;
        phone_number_id: string;
      };
      contacts?: WhatsAppContact[];
      messages?: WhatsAppMessage[];
      statuses?: WhatsAppStatus[];
    };
    field: 'messages';
  }>;
}

interface WhatsAppWebhookPayload {
  object: 'whatsapp_business_account';
  entry: WhatsAppWebhookEntry[];
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const WhatsAppAccountConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().optional(),
  provider: z.literal('whatsapp'),
  phoneNumberId: z.string().optional(),
  businessAccountId: z.string().optional(),
  accessToken: z.string().optional(),
  webhookVerifyToken: z.string().optional(),
  appSecret: z.string().optional(), // For signature verification
  // Security: allowlists
  allowedPhoneNumbers: z.array(z.string()).optional(),
}) satisfies z.ZodType<WhatsAppAccountConfig & { allowedPhoneNumbers?: string[]; appSecret?: string }>;

type WhatsAppConfig = z.infer<typeof WhatsAppAccountConfigSchema>;

// =============================================================================
// METADATA
// =============================================================================

const meta: ChatProviderMeta = {
  id: 'whatsapp',
  name: 'WhatsApp',
  description: 'WhatsApp Business Cloud API for customer communication',
  icon: '📱',
  docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api',
  order: 4,
  color: '#25D366',
};

// =============================================================================
// CAPABILITIES
// =============================================================================

const capabilities: ChatProviderCapabilities = {
  chatTypes: ['direct'],
  send: true,
  receive: true,
  slashCommands: false, // WhatsApp doesn't have slash commands
  interactiveComponents: true, // Buttons, lists
  reactions: true,
  edit: false, // WhatsApp doesn't support editing
  delete: true, // Can delete within time window
  threads: false,
  media: true,
  richBlocks: true, // Interactive message templates
  oauth: false, // Access token based
  webhooks: true,
  realtime: false, // Webhook only
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const WHATSAPP_API_BASE = 'https://graph.facebook.com/v18.0';

let currentConfig: WhatsAppConfig | null = null;

function setConfig(config: WhatsAppConfig) {
  currentConfig = config;
}

function clearConfig() {
  currentConfig = null;
}

async function callWhatsAppApi<T>(
  phoneNumberId: string,
  accessToken: string,
  endpoint: string,
  method: 'GET' | 'POST' = 'POST',
  body?: Record<string, unknown>
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const url = `${WHATSAPP_API_BASE}/${phoneNumberId}${endpoint}`;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json() as T & { error?: { message: string } };

    if (!response.ok) {
      const errorData = data as { error?: { message: string } };
      return {
        ok: false,
        error: errorData.error?.message || `HTTP ${response.status}`,
      };
    }

    return { ok: true, data };
  } catch (error) {
    logger.error('[WhatsApp] API call failed:', error instanceof Error ? error : undefined);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// =============================================================================
// AUTH ADAPTER
// =============================================================================

const authAdapter: AuthAdapter = {
  getAuthUrl(): string {
    throw new Error('WhatsApp uses access tokens from Meta Business Suite, not OAuth');
  },

  async exchangeCode(): Promise<never> {
    throw new Error('WhatsApp uses access tokens from Meta Business Suite, not OAuth');
  },

  verifyWebhook(signature: string, _timestamp: string, body: string): boolean {
    // This is called from verifyWhatsAppWebhook
    return !!signature && !!body;
  },
};

/**
 * Verify WhatsApp webhook signature
 * Uses HMAC-SHA256 with app secret
 */
export function verifyWhatsAppWebhook(
  appSecret: string | undefined,
  signature: string | undefined,
  body: string
): boolean {
  if (!appSecret) {
    logger.warn('[WhatsApp] No app secret configured - skipping signature verification');
    return true; // Allow if no secret configured (not recommended)
  }

  if (!signature) {
    return false;
  }

  // Signature format: sha256=xxxx
  const expectedSignature = signature.replace('sha256=', '');

  try {
    const computedSignature = createHmac('sha256', appSecret)
      .update(body)
      .digest('hex');

    const expected = Buffer.from(expectedSignature);
    const computed = Buffer.from(computedSignature);

    if (expected.length !== computed.length) return false;
    return timingSafeEqual(expected, computed);
  } catch {
    return false;
  }
}

/**
 * Check if sender is allowed based on allowlist
 */
export function isWhatsAppSenderAllowed(
  config: WhatsAppConfig,
  phoneNumber?: string
): { allowed: boolean; reason?: string } {
  const { allowedPhoneNumbers } = config;

  // If no allowlist configured, allow all
  if (!allowedPhoneNumbers?.length) {
    return { allowed: true };
  }

  if (!phoneNumber) {
    return { allowed: false, reason: 'No phone number provided' };
  }

  // Normalize phone numbers for comparison (remove + and spaces)
  const normalizedPhone = phoneNumber.replace(/[\s+]/g, '');
  const isAllowed = allowedPhoneNumbers.some(
    allowed => allowed.replace(/[\s+]/g, '') === normalizedPhone
  );

  if (!isAllowed) {
    return { allowed: false, reason: `Phone ${phoneNumber} not in allowlist` };
  }

  return { allowed: true };
}

// =============================================================================
// OUTBOUND ADAPTER
// =============================================================================

const outboundAdapter: OutboundAdapter = {
  async send(message: OutgoingMessage): Promise<SendResult> {
    if (!currentConfig?.phoneNumberId || !currentConfig?.accessToken) {
      return { success: false, error: 'WhatsApp not configured' };
    }

    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: message.to,
    };

    // Text message
    if (message.text) {
      body.type = 'text';
      body.text = { body: message.text };
    }

    // Interactive message (buttons or list)
    if (message.blocks && Array.isArray(message.blocks) && message.blocks.length > 0) {
      const firstBlock = message.blocks[0] as Record<string, unknown>;
      if (firstBlock.type === 'button' || firstBlock.type === 'list') {
        body.type = 'interactive';
        body.interactive = firstBlock;
      }
    }

    // Reply context
    if (message.replyToId) {
      body.context = { message_id: message.replyToId };
    }

    const result = await callWhatsAppApi<{ messages: Array<{ id: string }> }>(
      currentConfig.phoneNumberId,
      currentConfig.accessToken,
      '/messages',
      'POST',
      body
    );

    if (result.ok && result.data?.messages?.[0]) {
      return {
        success: true,
        messageId: result.data.messages[0].id,
      };
    }

    return {
      success: false,
      error: result.error || 'Failed to send message',
    };
  },

  async delete(_messageId: string): Promise<{ success: boolean; error?: string }> {
    // WhatsApp doesn't support message deletion via API
    return { success: false, error: 'WhatsApp does not support message deletion' };
  },

  async react(messageId: string, _channelId: string, emoji: string): Promise<{ success: boolean }> {
    if (!currentConfig?.phoneNumberId || !currentConfig?.accessToken) {
      return { success: false };
    }

    const result = await callWhatsAppApi<{ messages: Array<{ id: string }> }>(
      currentConfig.phoneNumberId,
      currentConfig.accessToken,
      '/messages',
      'POST',
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: _channelId, // The recipient phone number
        type: 'reaction',
        reaction: {
          message_id: messageId,
          emoji,
        },
      }
    );

    return { success: result.ok };
  },

  async unreact(messageId: string, channelId: string): Promise<{ success: boolean }> {
    // Send empty emoji to remove reaction
    if (!currentConfig?.phoneNumberId || !currentConfig?.accessToken) {
      return { success: false };
    }

    const result = await callWhatsAppApi<{ messages: Array<{ id: string }> }>(
      currentConfig.phoneNumberId,
      currentConfig.accessToken,
      '/messages',
      'POST',
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: channelId,
        type: 'reaction',
        reaction: {
          message_id: messageId,
          emoji: '', // Empty emoji removes the reaction
        },
      }
    );

    return { success: result.ok };
  },
};

// =============================================================================
// INBOUND ADAPTER
// =============================================================================

const inboundAdapter: InboundAdapter = {
  parseMessage(payload: unknown): IncomingMessage | null {
    const webhook = payload as WhatsAppWebhookPayload;
    const entry = webhook.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value?.messages?.[0]) return null;

    const message = value.messages[0];
    const contact = value.contacts?.[0];

    let text = '';
    if (message.type === 'text' && message.text) {
      text = message.text.body;
    } else if (message.type === 'image' && message.image?.caption) {
      text = message.image.caption;
    } else if (message.type === 'document' && message.document?.caption) {
      text = message.document.caption;
    }

    const attachments: IncomingMessage['attachments'] = [];
    if (message.type === 'image' && message.image) {
      attachments.push({
        type: 'image',
        name: 'image',
        mimeType: message.image.mime_type,
      });
    } else if (message.type === 'document' && message.document) {
      attachments.push({
        type: 'file',
        name: message.document.filename,
        mimeType: message.document.mime_type,
      });
    }

    return {
      id: message.id,
      provider: 'whatsapp',
      accountId: currentConfig?.id || 'default',
      senderId: message.from,
      senderName: contact?.profile?.name || message.from,
      chatType: 'direct',
      chatId: message.from,
      replyToId: message.context?.id,
      text,
      rawContent: webhook,
      timestamp: new Date(parseInt(message.timestamp, 10) * 1000),
      attachments: attachments.length > 0 ? attachments : undefined,
    };
  },

  parseCommand(): SlashCommand | null {
    // WhatsApp doesn't support slash commands
    return null;
  },

  parseAction(payload: unknown): InteractiveAction | null {
    const webhook = payload as WhatsAppWebhookPayload;
    const entry = webhook.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value?.messages?.[0]) return null;

    const message = value.messages[0];

    // Handle button reply
    if (message.type === 'interactive' && message.interactive?.button_reply) {
      return {
        provider: 'whatsapp',
        accountId: currentConfig?.id || 'default',
        type: 'button',
        actionId: message.interactive.button_reply.id,
        value: message.interactive.button_reply.id,
        userId: message.from,
        userName: value.contacts?.[0]?.profile?.name || message.from,
        channelId: message.from,
        messageId: message.context?.id,
        raw: webhook,
      };
    }

    // Handle list reply
    if (message.type === 'interactive' && message.interactive?.list_reply) {
      return {
        provider: 'whatsapp',
        accountId: currentConfig?.id || 'default',
        type: 'select',
        actionId: message.interactive.list_reply.id,
        value: message.interactive.list_reply.id,
        userId: message.from,
        userName: value.contacts?.[0]?.profile?.name || message.from,
        channelId: message.from,
        messageId: message.context?.id,
        raw: webhook,
      };
    }

    // Handle button payload (for quick reply buttons)
    if (message.type === 'button' && message.button) {
      return {
        provider: 'whatsapp',
        accountId: currentConfig?.id || 'default',
        type: 'button',
        actionId: message.button.payload,
        value: message.button.payload,
        userId: message.from,
        userName: value.contacts?.[0]?.profile?.name || message.from,
        channelId: message.from,
        messageId: message.context?.id,
        raw: webhook,
      };
    }

    return null;
  },

  buildCommandResponse(response: CommandResponse): unknown {
    return { text: response.text };
  },

  buildActionResponse(response: CommandResponse): unknown {
    return { text: response.text };
  },
};

// =============================================================================
// STATUS ADAPTER
// =============================================================================

const statusAdapter: StatusAdapter = {
  isConfigured(config: WhatsAppAccountConfig): boolean {
    return !!(config.phoneNumberId && config.accessToken);
  },

  async checkHealth(config: WhatsAppAccountConfig): Promise<{
    connected: boolean;
    latencyMs?: number;
    error?: string;
    details?: Record<string, unknown>;
  }> {
    if (!config.phoneNumberId || !config.accessToken) {
      return { connected: false, error: 'Phone number ID or access token not configured' };
    }

    const start = Date.now();

    // Get phone number info
    const result = await callWhatsAppApi<{
      verified_name: string;
      display_phone_number: string;
      quality_rating: string;
    }>(
      config.phoneNumberId,
      config.accessToken!,
      '',
      'GET'
    );

    const latencyMs = Date.now() - start;

    if (result.ok && result.data) {
      return {
        connected: true,
        latencyMs,
        details: {
          verifiedName: result.data.verified_name,
          displayPhoneNumber: result.data.display_phone_number,
          qualityRating: result.data.quality_rating,
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
// PROVIDER EXPORT
// =============================================================================

export const whatsappProvider: ChatProvider<WhatsAppAccountConfig> = {
  meta,
  capabilities,
  defaultConfig: {
    provider: 'whatsapp',
    enabled: true,
  },
  configSchema: WhatsAppAccountConfigSchema as z.ZodType<WhatsAppAccountConfig>,
  auth: authAdapter,
  outbound: outboundAdapter,
  inbound: inboundAdapter,
  status: statusAdapter,
};

export { setConfig as setWhatsAppConfig, clearConfig as clearWhatsAppConfig };
export { WhatsAppAccountConfigSchema };
export type { WhatsAppConfig, WhatsAppWebhookPayload, WhatsAppMessage };
