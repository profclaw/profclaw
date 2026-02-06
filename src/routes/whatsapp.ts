/**
 * WhatsApp Business Cloud API Routes
 *
 * Handles:
 * - Webhook verification (GET challenge)
 * - Webhook updates (messages, status updates)
 * - Health checks
 * - Security: HMAC-SHA256 signature verification, phone allowlist
 */

import { Hono } from 'hono';
import {
  whatsappProvider,
  verifyWhatsAppWebhook,
  isWhatsAppSenderAllowed,
  setWhatsAppConfig,
  clearWhatsAppConfig,
  type WhatsAppConfig,
  type WhatsAppWebhookPayload,
} from '../chat/providers/whatsapp/index.js';
import { getChatRegistry } from '../chat/providers/registry.js';
import type { WhatsAppAccountConfig } from '../chat/providers/types.js';
import { logger } from '../utils/logger.js';

// Re-export formatToolResult for channel response formatting
// Usage: formatToolResult(toolName, result, 'plain') → { summary, detail }
export { formatToolResult } from '../chat/format/index.js';

const whatsapp = new Hono();

// =============================================================================
// CONFIGURATION
// =============================================================================

const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '';
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || '';
const WHATSAPP_WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '';
const WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET || '';
const WHATSAPP_ALLOWED_PHONES = (process.env.WHATSAPP_ALLOWED_PHONES || '')
  .split(',')
  .map((v) => v.trim())
  .filter((v) => v.length > 0);

// Build config from environment
function getEnvConfig(): WhatsAppConfig {
  return {
    id: 'whatsapp-env',
    name: 'WhatsApp (Environment)',
    enabled: true,
    isDefault: true,
    provider: 'whatsapp',
    phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: WHATSAPP_BUSINESS_ACCOUNT_ID,
    accessToken: WHATSAPP_ACCESS_TOKEN,
    webhookVerifyToken: WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    appSecret: WHATSAPP_APP_SECRET,
    allowedPhoneNumbers: WHATSAPP_ALLOWED_PHONES,
  };
}

// Get config from registry or env
function getConfig(): WhatsAppConfig | null {
  // Try registry first (for multi-account support)
  const registryAccount = getChatRegistry().getDefaultAccount('whatsapp');
  if (registryAccount && registryAccount.provider === 'whatsapp') {
    return registryAccount as unknown as WhatsAppConfig;
  }

  // Fall back to environment variables
  if (WHATSAPP_ACCESS_TOKEN && WHATSAPP_PHONE_NUMBER_ID) {
    return getEnvConfig();
  }

  return null;
}

// =============================================================================
// WEBHOOK ROUTES
// =============================================================================

/**
 * GET /webhook - Webhook verification challenge
 *
 * Meta sends this to verify webhook ownership:
 * - hub.mode = 'subscribe'
 * - hub.verify_token = your configured token
 * - hub.challenge = random string to echo back
 */
whatsapp.get('/webhook', async (c) => {
  const config = getConfig();

  const mode = c.req.query('hub.mode');
  const token = c.req.query('hub.verify_token');
  const challenge = c.req.query('hub.challenge');

  logger.debug('[WhatsApp] Webhook verification request', { mode, hasToken: !!token });

  if (mode === 'subscribe') {
    // Check verify token
    const expectedToken = config?.webhookVerifyToken || WHATSAPP_WEBHOOK_VERIFY_TOKEN;

    if (!expectedToken) {
      logger.warn('[WhatsApp] No verify token configured');
      return c.text('Forbidden - No verify token configured', 403);
    }

    if (token === expectedToken) {
      logger.info('[WhatsApp] Webhook verified successfully');
      return c.text(challenge || '', 200);
    }

    logger.warn('[WhatsApp] Webhook verification failed - token mismatch');
    return c.text('Forbidden - Token mismatch', 403);
  }

  return c.text('Bad Request - Invalid mode', 400);
});

/**
 * POST /webhook - Receive updates from WhatsApp
 *
 * Security:
 * - Verifies X-Hub-Signature-256 header (HMAC-SHA256)
 * - Checks phone number allowlist
 * - Logs all webhook events for audit
 */
whatsapp.post('/webhook', async (c) => {
  const config = getConfig();

  if (!config || !config.accessToken || !config.phoneNumberId) {
    logger.warn('[WhatsApp] Webhook received but not configured');
    return c.json({ error: 'WhatsApp not configured' }, 503);
  }

  // Get raw body for signature verification
  const rawBody = await c.req.text();
  const signature = c.req.header('X-Hub-Signature-256');

  // Verify signature
  if (!verifyWhatsAppWebhook(config.appSecret, signature, rawBody)) {
    logger.warn('[WhatsApp] Webhook signature verification failed');
    return c.json({ error: 'Unauthorized' }, 401);
  }

  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    logger.error('[WhatsApp] Invalid JSON in webhook request');
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  // Verify this is a WhatsApp Business Account event
  if (payload.object !== 'whatsapp_business_account') {
    logger.debug('[WhatsApp] Non-WhatsApp event received', { object: payload.object });
    return c.json({ ok: true });
  }

  // Set config for outbound adapter
  setWhatsAppConfig(config);

  // Process each entry
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;

      // Handle status updates (log only - not a chat event)
      if (value.statuses) {
        for (const status of value.statuses) {
          logger.debug('[WhatsApp] Message status update', {
            messageId: status.id,
            status: status.status,
            recipientId: status.recipient_id,
          });
        }
      }

      // Handle incoming messages
      if (value.messages) {
        for (const message of value.messages) {
          // Check phone allowlist
          const allowCheck = isWhatsAppSenderAllowed(config, message.from);
          if (!allowCheck.allowed) {
            logger.info(`[WhatsApp] Sender blocked: ${allowCheck.reason}`);
            continue;
          }

          // Parse as action (button/list reply)
          const action = whatsappProvider.inbound.parseAction(payload);
          if (action) {
            await getChatRegistry().emit({
              type: 'action',
              provider: 'whatsapp',
              accountId: config.id,
              timestamp: new Date(),
              payload: action,
            });
            continue;
          }

          // Parse as regular message
          const incomingMessage = whatsappProvider.inbound.parseMessage(payload);
          if (incomingMessage) {
            await getChatRegistry().emit({
              type: 'message',
              provider: 'whatsapp',
              accountId: config.id,
              timestamp: new Date(),
              payload: incomingMessage,
            });
          }
        }
      }
    }
  }

  logger.debug('[WhatsApp] Webhook processed');
  return c.json({ ok: true });
});

// =============================================================================
// STATUS & HEALTH
// =============================================================================

/**
 * GET /status - WhatsApp status and health check
 */
whatsapp.get('/status', async (c) => {
  const config = getConfig();

  if (!config) {
    return c.json({
      configured: false,
      connected: false,
      message: 'WhatsApp not configured. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID.',
    });
  }

  const isConfigured = whatsappProvider.status.isConfigured(config);

  if (!isConfigured) {
    return c.json({
      configured: false,
      connected: false,
      message: 'Access token or phone number ID not set',
    });
  }

  const health = await whatsappProvider.status.checkHealth(config);

  return c.json({
    configured: true,
    connected: health.connected,
    latencyMs: health.latencyMs,
    error: health.error,
    phone: health.details
      ? {
          verifiedName: health.details.verifiedName,
          displayPhoneNumber: health.details.displayPhoneNumber,
          qualityRating: health.details.qualityRating,
        }
      : null,
    allowlist: {
      phones: config.allowedPhoneNumbers?.length || 0,
    },
  });
});

/**
 * POST /test - Send a test message
 *
 * Body: { to: string, text: string }
 */
whatsapp.post('/test', async (c) => {
  const config = getConfig();

  if (!config?.accessToken || !config?.phoneNumberId) {
    return c.json({ error: 'WhatsApp not configured' }, 400);
  }

  let body: { to: string; text: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (!body.to || !body.text) {
    return c.json({ error: 'Missing to or text parameter' }, 400);
  }

  // Set config for outbound adapter
  setWhatsAppConfig(config);

  const result = await whatsappProvider.outbound.send({
    provider: 'whatsapp',
    to: body.to,
    text: body.text,
  });

  if (result.success) {
    return c.json({
      success: true,
      messageId: result.messageId,
    });
  }

  return c.json({ error: result.error || 'Failed to send message' }, 500);
});

// =============================================================================
// CONFIGURATION MANAGEMENT
// =============================================================================

/**
 * GET /config - Get current configuration (redacted)
 */
whatsapp.get('/config', async (c) => {
  const config = getConfig();

  if (!config) {
    return c.json({
      configured: false,
      source: null,
    });
  }

  return c.json({
    configured: true,
    source: config.id === 'whatsapp-env' ? 'environment' : 'database',
    accountId: config.id,
    accountName: config.name,
    enabled: config.enabled,
    isDefault: config.isDefault,
    hasAppSecret: !!config.appSecret,
    hasVerifyToken: !!config.webhookVerifyToken,
    allowedPhones: config.allowedPhoneNumbers?.length || 0,
    phoneNumberId: config.phoneNumberId ? `****${config.phoneNumberId.slice(-4)}` : null,
  });
});

/**
 * POST /config - Update configuration (stores in registry)
 *
 * Body: {
 *   phoneNumberId: string,
 *   businessAccountId?: string,
 *   accessToken: string,
 *   webhookVerifyToken?: string,
 *   appSecret?: string,
 *   allowedPhoneNumbers?: string[],
 *   name?: string,
 *   enabled?: boolean
 * }
 */
whatsapp.post('/config', async (c) => {
  let body: Partial<WhatsAppAccountConfig & {
    appSecret?: string;
    allowedPhoneNumbers?: string[];
  }>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (!body.phoneNumberId || !body.accessToken) {
    return c.json({ error: 'Missing phoneNumberId or accessToken' }, 400);
  }

  const config: WhatsAppConfig = {
    id: body.id || `whatsapp-${Date.now()}`,
    name: body.name || 'WhatsApp Business',
    enabled: body.enabled ?? true,
    isDefault: true,
    provider: 'whatsapp',
    phoneNumberId: body.phoneNumberId,
    businessAccountId: body.businessAccountId,
    accessToken: body.accessToken,
    webhookVerifyToken: body.webhookVerifyToken || crypto.randomUUID(),
    appSecret: body.appSecret,
    allowedPhoneNumbers: body.allowedPhoneNumbers || [],
  };

  // Validate by checking health
  setWhatsAppConfig(config);
  const health = await whatsappProvider.status.checkHealth(config);

  if (!health.connected) {
    return c.json({ error: health.error || 'Invalid configuration - could not connect' }, 400);
  }

  // Register the account
  try {
    getChatRegistry().registerAccount(config);

    logger.info('[WhatsApp] Account configured', {
      id: config.id,
      phoneNumber: health.details?.displayPhoneNumber,
    });

    return c.json({
      success: true,
      account: {
        id: config.id,
        name: config.name,
        phoneNumber: health.details?.displayPhoneNumber,
        verifiedName: health.details?.verifiedName,
      },
      webhookVerifyToken: config.webhookVerifyToken,
    });
  } catch (error) {
    logger.error('[WhatsApp] Failed to register account:', error instanceof Error ? error : undefined);
    return c.json({ error: 'Failed to save configuration' }, 500);
  }
});

/**
 * DELETE /config - Disconnect WhatsApp
 */
whatsapp.delete('/config', async (c) => {
  try {
    const accounts = getChatRegistry().listAccounts('whatsapp');
    for (const account of accounts) {
      getChatRegistry().removeAccount('whatsapp', account.id);
    }
    clearWhatsAppConfig();
    logger.info('[WhatsApp] Disconnected');
    return c.json({ success: true });
  } catch (error) {
    logger.error('[WhatsApp] Failed to disconnect:', error instanceof Error ? error : undefined);
    return c.json({ error: 'Failed to disconnect' }, 500);
  }
});

export { whatsapp as whatsappRoutes };
