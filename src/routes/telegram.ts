/**
 * Telegram Integration Routes
 *
 * Handles:
 * - Webhook updates (messages, commands, callback queries)
 * - Webhook configuration (set/delete/info)
 * - Bot status and health checks
 * - Security: Secret token verification, allowlist checks
 */

import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import {
  telegramProvider,
  verifyTelegramWebhook,
  isTelegramSenderAllowed,
  setTelegramWebhook,
  deleteTelegramWebhook,
  getTelegramWebhookInfo,
  answerTelegramCallbackQuery,
  setTelegramConfig,
  clearTelegramConfig,
  type TelegramUpdate,
  type TelegramConfig,
} from '../chat/providers/telegram/index.js';
import { getChatRegistry } from '../chat/providers/registry.js';
import type { TelegramAccountConfig } from '../chat/providers/types.js';
import { logger } from '../utils/logger.js';
import { isDuplicateWebhookEvent } from './webhook-dedup.js';

// Re-export formatToolResult for channel response formatting
// Usage: formatToolResult(toolName, result, 'html') → { summary, detail }
export { formatToolResult } from '../chat/format/index.js';

const telegram = new Hono();

// CONFIGURATION

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const TELEGRAM_ALLOWED_USERS = (process.env.TELEGRAM_ALLOWED_USERS || '')
  .split(',')
  .map((v) => parseInt(v.trim(), 10))
  .filter((v) => !isNaN(v));
const TELEGRAM_ALLOWED_CHATS = (process.env.TELEGRAM_ALLOWED_CHATS || '')
  .split(',')
  .map((v) => parseInt(v.trim(), 10))
  .filter((v) => !isNaN(v));

// Build config from environment
function getEnvConfig(): TelegramConfig {
  return {
    id: 'telegram-env',
    name: 'Telegram (Environment)',
    enabled: true,
    isDefault: true,
    provider: 'telegram',
    botToken: TELEGRAM_BOT_TOKEN,
    webhookSecret: TELEGRAM_WEBHOOK_SECRET,
    allowedUserIds: TELEGRAM_ALLOWED_USERS,
    allowedChatIds: TELEGRAM_ALLOWED_CHATS,
  };
}

// Get config from registry or env
function getConfig(): TelegramConfig | null {
  // Try registry first (for multi-account support)
  const registryAccount = getChatRegistry().getDefaultAccount('telegram');
  if (registryAccount && registryAccount.provider === 'telegram') {
    // The account config IS the TelegramAccountConfig, with potential additional fields
    return registryAccount as unknown as TelegramConfig;
  }

  // Fall back to environment variables
  if (TELEGRAM_BOT_TOKEN) {
    return getEnvConfig();
  }

  return null;
}

// WEBHOOK ROUTES

/**
 * POST /webhook - Receive updates from Telegram
 *
 * Security:
 * - Verifies X-Telegram-Bot-Api-Secret-Token header
 * - Checks user/chat allowlists
 * - Logs all webhook events for audit
 */
telegram.post('/webhook', async (c) => {
  const config = getConfig();

  if (!config || !config.botToken) {
    logger.warn('[Telegram] Webhook received but bot not configured');
    return c.json({ error: 'Bot not configured' }, 503);
  }

  // Verify secret token
  const secretToken = c.req.header('X-Telegram-Bot-Api-Secret-Token');
  if (!verifyTelegramWebhook(config.webhookSecret, secretToken)) {
    logger.warn('[Telegram] Webhook signature verification failed');
    return c.json({ error: 'Unauthorized' }, 401);
  }

  let update: TelegramUpdate;
  try {
    update = await c.req.json();
  } catch {
    logger.error('[Telegram] Invalid JSON in webhook request');
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (isDuplicateWebhookEvent('telegram:update', update.update_id)) {
    return c.json({ ok: true });
  }

  // Extract sender info for allowlist check
  const message = update.message || update.edited_message;
  const callbackQuery = update.callback_query;
  const userId = message?.from?.id ?? callbackQuery?.from?.id;
  const chatId = message?.chat?.id ?? callbackQuery?.message?.chat?.id;

  // Check allowlists
  const allowCheck = isTelegramSenderAllowed(config, userId, chatId);
  if (!allowCheck.allowed) {
    logger.info(`[Telegram] Sender blocked: ${allowCheck.reason}`);
    // Return 200 to acknowledge receipt (don't expose allowlist)
    return c.json({ ok: true });
  }

  // Set config for outbound adapter
  setTelegramConfig(config);

  // Process the update
  try {
    // Handle callback queries (button clicks)
    if (callbackQuery) {
      const action = telegramProvider.inbound.parseAction(update);
      if (action) {
        // Emit event to registry for handling
        await getChatRegistry().emit({
          type: 'action',
          provider: 'telegram',
          accountId: config.id,
          timestamp: new Date(),
          payload: action,
        });

        // Answer the callback query to remove loading state
        if (config.botToken) {
          await answerTelegramCallbackQuery(config.botToken, callbackQuery.id);
        }
      }
    }

    // Handle commands
    const command = telegramProvider.inbound.parseCommand(update);
    if (command) {
      await getChatRegistry().emit({
        type: 'command',
        provider: 'telegram',
        accountId: config.id,
        timestamp: new Date(),
        payload: command,
      });
    }

    // Handle regular messages
    const incomingMessage = telegramProvider.inbound.parseMessage(update);
    if (incomingMessage && !command) {
      await getChatRegistry().emit({
        type: 'message',
        provider: 'telegram',
        accountId: config.id,
        timestamp: new Date(),
        payload: incomingMessage,
      });
    }

    logger.debug('[Telegram] Update processed', { updateId: update.update_id });
    return c.json({ ok: true });
  } catch (error) {
    logger.error('[Telegram] Error processing update:', error instanceof Error ? error : undefined);
    // Return 200 to prevent Telegram from retrying
    return c.json({ ok: true });
  }
});

/**
 * POST /set-webhook - Configure webhook URL
 *
 * Body: { url: string, secret?: string }
 */
telegram.post('/set-webhook', async (c) => {
  const config = getConfig();

  if (!config?.botToken) {
    return c.json({ error: 'Bot token not configured' }, 400);
  }

  let body: { url: string; secret?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (!body.url) {
    return c.json({ error: 'Missing url parameter' }, 400);
  }

  // Validate URL
  try {
    new URL(body.url);
  } catch {
    return c.json({ error: 'Invalid URL format' }, 400);
  }

  // Use provided secret or generate one
  const secret = body.secret || config.webhookSecret || randomUUID();

  const result = await setTelegramWebhook(config.botToken, body.url, secret);

  if (result.success) {
    logger.info('[Telegram] Webhook configured', { url: body.url });
    return c.json({
      success: true,
      webhookUrl: body.url,
      secretToken: secret,
      message: 'Webhook configured. Store the secret token securely.',
    });
  }

  logger.error('[Telegram] Failed to set webhook:', { error: result.error });
  return c.json({ error: result.error || 'Failed to set webhook' }, 500);
});

/**
 * DELETE /webhook - Remove webhook (switch to polling)
 */
telegram.delete('/webhook', async (c) => {
  const config = getConfig();

  if (!config?.botToken) {
    return c.json({ error: 'Bot token not configured' }, 400);
  }

  const result = await deleteTelegramWebhook(config.botToken);

  if (result.success) {
    logger.info('[Telegram] Webhook deleted');
    return c.json({ success: true, message: 'Webhook removed' });
  }

  return c.json({ error: result.error || 'Failed to delete webhook' }, 500);
});

/**
 * GET /webhook - Get webhook info
 */
telegram.get('/webhook', async (c) => {
  const config = getConfig();

  if (!config?.botToken) {
    return c.json({ error: 'Bot token not configured' }, 400);
  }

  const info = await getTelegramWebhookInfo(config.botToken);

  if (!info) {
    return c.json({ error: 'Failed to get webhook info' }, 500);
  }

  return c.json({
    url: info.url || null,
    pendingUpdateCount: info.pendingUpdateCount,
    hasCustomCertificate: info.hasCustomCertificate,
    lastError: info.lastErrorMessage
      ? {
          date: info.lastErrorDate,
          message: info.lastErrorMessage,
        }
      : null,
  });
});

// STATUS & HEALTH

/**
 * GET /status - Bot status and health check
 */
telegram.get('/status', async (c) => {
  const config = getConfig();

  if (!config) {
    return c.json({
      configured: false,
      connected: false,
      message: 'Telegram bot not configured. Set TELEGRAM_BOT_TOKEN environment variable.',
    });
  }

  const isConfigured = telegramProvider.status.isConfigured(config);

  if (!isConfigured) {
    return c.json({
      configured: false,
      connected: false,
      message: 'Bot token not set',
    });
  }

  const health = await telegramProvider.status.checkHealth(config);

  return c.json({
    configured: true,
    connected: health.connected,
    latencyMs: health.latencyMs,
    error: health.error,
    bot: health.details
      ? {
          id: health.details.botId,
          username: health.details.botUsername,
          name: health.details.botName,
        }
      : null,
    allowlists: {
      users: config.allowedUserIds?.length || 0,
      chats: config.allowedChatIds?.length || 0,
    },
  });
});

/**
 * POST /test - Send a test message
 *
 * Body: { chat_id: string, text: string }
 */
telegram.post('/test', async (c) => {
  const config = getConfig();

  if (!config?.botToken) {
    return c.json({ error: 'Bot token not configured' }, 400);
  }

  let body: { chat_id: string; text: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (!body.chat_id || !body.text) {
    return c.json({ error: 'Missing chat_id or text parameter' }, 400);
  }

  // Set config for outbound adapter
  setTelegramConfig(config);

  const result = await telegramProvider.outbound.send({
    provider: 'telegram',
    to: body.chat_id,
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

// CONFIGURATION MANAGEMENT

/**
 * GET /config - Get current configuration (redacted)
 */
telegram.get('/config', async (c) => {
  const config = getConfig();

  if (!config) {
    return c.json({
      configured: false,
      source: null,
    });
  }

  return c.json({
    configured: true,
    source: config.id === 'telegram-env' ? 'environment' : 'database',
    accountId: config.id,
    accountName: config.name,
    enabled: config.enabled,
    isDefault: config.isDefault,
    hasWebhookSecret: !!config.webhookSecret,
    allowedUsers: config.allowedUserIds?.length || 0,
    allowedChats: config.allowedChatIds?.length || 0,
  });
});

/**
 * POST /config - Update configuration (stores in registry)
 *
 * Body: {
 *   botToken: string,
 *   webhookSecret?: string,
 *   allowedUserIds?: number[],
 *   allowedChatIds?: number[],
 *   name?: string,
 *   enabled?: boolean
 * }
 */
telegram.post('/config', async (c) => {
  let body: Partial<TelegramAccountConfig & { allowedUserIds?: number[]; allowedChatIds?: number[] }>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (!body.botToken) {
    return c.json({ error: 'Missing botToken' }, 400);
  }

  const config: TelegramConfig = {
    id: body.id || `telegram-${Date.now()}`,
    name: body.name || 'Telegram Bot',
    enabled: body.enabled ?? true,
    isDefault: true,
    provider: 'telegram',
    botToken: body.botToken,
    webhookSecret: body.webhookSecret || randomUUID(),
    allowedUserIds: body.allowedUserIds || [],
    allowedChatIds: body.allowedChatIds || [],
  };

  // Validate the token by calling getMe
  setTelegramConfig(config);
  const health = await telegramProvider.status.checkHealth(config);

  if (!health.connected) {
    return c.json({ error: health.error || 'Invalid bot token' }, 400);
  }

  // Register the account
  try {
    getChatRegistry().registerAccount(config);

    logger.info('[Telegram] Account configured', {
      id: config.id,
      botUsername: health.details?.botUsername,
    });

    return c.json({
      success: true,
      account: {
        id: config.id,
        name: config.name,
        botUsername: health.details?.botUsername,
        botName: health.details?.botName,
      },
      webhookSecret: config.webhookSecret,
    });
  } catch (error) {
    logger.error('[Telegram] Failed to register account:', error instanceof Error ? error : undefined);
    return c.json({ error: 'Failed to save configuration' }, 500);
  }
});

// DELETE /config — Disconnect the bot
telegram.delete('/config', async (c) => {
  try {
    // Try to delete webhook and clean up accounts
    const accounts = getChatRegistry().listAccounts('telegram');
    for (const account of accounts) {
      if ('botToken' in account && account.botToken) {
        await deleteTelegramWebhook(account.botToken as string).catch(() => {});
      }
      getChatRegistry().removeAccount('telegram', account.id);
    }

    clearTelegramConfig();

    logger.info('[Telegram] Bot disconnected');
    return c.json({ success: true });
  } catch (error) {
    logger.error('[Telegram] Failed to disconnect:', error instanceof Error ? error : undefined);
    return c.json({ error: 'Failed to disconnect' }, 500);
  }
});

export { telegram as telegramRoutes };
