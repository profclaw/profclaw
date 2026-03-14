/**
 * Discord Integration Routes
 *
 * Handles:
 * - Interactions endpoint (slash commands, buttons, selects)
 * - Ed25519 signature verification
 * - OAuth bot installation flow
 * - Bot status and health checks
 * - Configuration management
 */

import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import {
  discordProvider,
  verifyDiscordSignature,
  isDiscordSenderAllowed,
  setDiscordConfig,
  clearDiscordConfig,
  buildPingResponse,
  isPingInteraction,
  buildDeferredResponse,
  registerSlashCommands,
  InteractionType,
  type DiscordConfig,
  type DiscordInteraction,
} from '../chat/providers/discord/index.js';
import { getChatRegistry } from '../chat/providers/registry.js';
import type { DiscordAccountConfig } from '../chat/providers/types.js';
import { logger } from '../utils/logger.js';
import { isDuplicateWebhookEvent } from './webhook-dedup.js';

// Re-export formatToolResult for channel response formatting
// Usage: formatToolResult(toolName, result, 'discord') → { summary, detail, fields }
export { formatToolResult } from '../chat/format/index.js';

const discord = new Hono();

// CONFIGURATION

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const DISCORD_APPLICATION_ID = process.env.DISCORD_APPLICATION_ID || '';
const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY || '';
const DISCORD_ALLOWED_GUILDS = (process.env.DISCORD_ALLOWED_GUILDS || '')
  .split(',')
  .map(v => v.trim())
  .filter(v => v.length > 0);
const DISCORD_ALLOWED_CHANNELS = (process.env.DISCORD_ALLOWED_CHANNELS || '')
  .split(',')
  .map(v => v.trim())
  .filter(v => v.length > 0);
const DISCORD_ALLOWED_ROLES = (process.env.DISCORD_ALLOWED_ROLES || '')
  .split(',')
  .map(v => v.trim())
  .filter(v => v.length > 0);

// Build config from environment
function getEnvConfig(): DiscordConfig {
  return {
    id: 'discord-env',
    name: 'Discord (Environment)',
    enabled: true,
    isDefault: true,
    provider: 'discord',
    botToken: DISCORD_BOT_TOKEN,
    applicationId: DISCORD_APPLICATION_ID,
    publicKey: DISCORD_PUBLIC_KEY,
    allowedGuildIds: DISCORD_ALLOWED_GUILDS,
    allowedChannelIds: DISCORD_ALLOWED_CHANNELS,
    allowedRoleIds: DISCORD_ALLOWED_ROLES,
  };
}

// Get config from registry or env
function getConfig(): DiscordConfig | null {
  // Try registry first (for multi-account support)
  const registryAccount = getChatRegistry().getDefaultAccount('discord');
  if (registryAccount && registryAccount.provider === 'discord') {
    return registryAccount as unknown as DiscordConfig;
  }

  // Fall back to environment variables
  if (DISCORD_BOT_TOKEN && DISCORD_APPLICATION_ID && DISCORD_PUBLIC_KEY) {
    return getEnvConfig();
  }

  return null;
}

// INTERACTIONS ENDPOINT

/**
 * POST /interactions - Main Discord interactions endpoint
 *
 * This is the only endpoint Discord sends interactions to:
 * - PING (type 1) - Endpoint verification
 * - APPLICATION_COMMAND (type 2) - Slash commands
 * - MESSAGE_COMPONENT (type 3) - Button/select interactions
 * - APPLICATION_COMMAND_AUTOCOMPLETE (type 4) - Command autocomplete
 * - MODAL_SUBMIT (type 5) - Modal form submissions
 *
 * Security:
 * - Verifies Ed25519 signature
 * - Checks guild/channel/role allowlists
 */
discord.post('/interactions', async (c) => {
  const config = getConfig();

  if (!config || !config.publicKey) {
    logger.warn('[Discord] Interactions received but bot not configured');
    return c.json({ error: 'Bot not configured' }, 503);
  }

  // Get raw body and headers for verification
  const rawBody = await c.req.text();
  const signature = c.req.header('X-Signature-Ed25519');
  const timestamp = c.req.header('X-Signature-Timestamp');

  // Verify Ed25519 signature
  const isValid = await verifyDiscordSignature(
    config.publicKey,
    signature,
    timestamp,
    rawBody
  );

  if (!isValid) {
    logger.warn('[Discord] Signature verification failed');
    return c.json({ error: 'Invalid signature' }, 401);
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    logger.error('[Discord] Invalid JSON in interactions request');
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  // Handle PING (required for Discord endpoint verification)
  if (isPingInteraction(interaction)) {
    logger.debug('[Discord] PING received, responding with PONG');
    return c.json(buildPingResponse());
  }

  if (isDuplicateWebhookEvent('discord:interaction', interaction.id)) {
    return c.json(buildDeferredResponse());
  }

  // Check allowlists
  const roleIds = interaction.member?.roles || [];
  const allowCheck = isDiscordSenderAllowed(
    config,
    interaction.guild_id,
    interaction.channel_id,
    roleIds
  );

  if (!allowCheck.allowed) {
    logger.info(`[Discord] Sender blocked: ${allowCheck.reason}`);
    // Return ephemeral message for blocked users
    return c.json({
      type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
      data: {
        content: 'You do not have permission to use this bot.',
        flags: 64, // EPHEMERAL
      },
    });
  }

  // Set config for outbound adapter
  setDiscordConfig(config);

  try {
    // Handle slash commands
    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      const command = discordProvider.inbound.parseCommand(interaction);
      if (command) {
        await getChatRegistry().emit({
          type: 'command',
          provider: 'discord',
          accountId: config.id,
          timestamp: new Date(),
          payload: command,
        });

        // For now, return a deferred response
        // The actual response will come via followup
        return c.json(buildDeferredResponse());
      }
    }

    // Handle button/select interactions
    if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
      const action = discordProvider.inbound.parseAction(interaction);
      if (action) {
        await getChatRegistry().emit({
          type: 'action',
          provider: 'discord',
          accountId: config.id,
          timestamp: new Date(),
          payload: action,
        });

        // Acknowledge the interaction
        return c.json({
          type: 6, // DEFERRED_UPDATE_MESSAGE
        });
      }
    }

    // Handle autocomplete
    if (interaction.type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE) {
      // Return empty choices for now
      // TODO: Implement autocomplete handlers
      return c.json({
        type: 8, // APPLICATION_COMMAND_AUTOCOMPLETE_RESULT
        data: { choices: [] },
      });
    }

    // Handle modal submissions
    if (interaction.type === InteractionType.MODAL_SUBMIT) {
      const action = discordProvider.inbound.parseAction(interaction);
      if (action) {
        await getChatRegistry().emit({
          type: 'action',
          provider: 'discord',
          accountId: config.id,
          timestamp: new Date(),
          payload: { ...action, type: 'modal_submit' },
        });
      }

      return c.json(buildDeferredResponse());
    }

    // Unknown interaction type
    logger.warn('[Discord] Unknown interaction type:', { type: interaction.type });
    return c.json({ error: 'Unknown interaction type' }, 400);
  } catch (error) {
    logger.error('[Discord] Error processing interaction:', error instanceof Error ? error : undefined);
    // Return a user-friendly error
    return c.json({
      type: 4,
      data: {
        content: 'An error occurred while processing your request.',
        flags: 64,
      },
    });
  }
});

// OAUTH ROUTES

/**
 * GET /oauth/url - Get OAuth authorization URL for adding bot to server
 */
discord.get('/oauth/url', async (c) => {
  const config = getConfig();

  if (!config?.applicationId) {
    return c.json({ error: 'Application ID not configured' }, 400);
  }

  const state = randomUUID();
  const scopes = ['bot', 'applications.commands'];
  const permissions = '2147485696'; // Send Messages, Use Slash Commands, Embed Links

  const params = new URLSearchParams({
    client_id: config.applicationId,
    permissions,
    scope: scopes.join(' '),
    response_type: 'code',
    state,
  });

  const url = `https://discord.com/oauth2/authorize?${params}`;

  return c.json({ url, state });
});

/**
 * GET /oauth/callback - OAuth callback (optional, for tracking installations)
 */
discord.get('/oauth/callback', async (c) => {
  const code = c.req.query('code');
  const guildId = c.req.query('guild_id');
  const state = c.req.query('state');

  if (!code) {
    return c.json({ error: 'No authorization code provided' }, 400);
  }

  // Log the installation
  logger.info('[Discord] Bot added to guild', { guildId, state });

  // Redirect to success page or return JSON
  const redirectUrl = c.req.query('redirect_uri');
  if (redirectUrl) {
    // Validate redirect URL to prevent open redirect attacks
    // Only allow relative paths or same-origin redirects
    try {
      // If it starts with / it's a relative path - safe
      if (redirectUrl.startsWith('/') && !redirectUrl.startsWith('//')) {
        return c.redirect(redirectUrl);
      }
      
      // Parse as URL and check if it's the same origin
      const requestUrl = new URL(c.req.url);
      const targetUrl = new URL(redirectUrl, requestUrl.origin);
      
      // Only allow redirect to same origin
      if (targetUrl.origin === requestUrl.origin) {
        return c.redirect(redirectUrl);
      }
      
      // Block external redirects
      logger.warn('[Discord] Blocked open redirect attempt', { redirectUrl });
      return c.json({ error: 'Invalid redirect URL' }, 400);
    } catch {
      return c.json({ error: 'Invalid redirect URL format' }, 400);
    }
  }

  return c.json({
    success: true,
    guildId,
    message: 'Bot successfully added to your server!',
  });
});

// STATUS & HEALTH

/**
 * GET /status - Bot status and health check
 */
discord.get('/status', async (c) => {
  const config = getConfig();

  if (!config) {
    return c.json({
      configured: false,
      connected: false,
      message: 'Discord bot not configured. Set DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, and DISCORD_PUBLIC_KEY.',
    });
  }

  const isConfigured = discordProvider.status.isConfigured(config);

  if (!isConfigured) {
    return c.json({
      configured: false,
      connected: false,
      message: 'Missing required configuration (token, application ID, or public key)',
    });
  }

  const health = await discordProvider.status.checkHealth(config);

  return c.json({
    configured: true,
    connected: health.connected,
    latencyMs: health.latencyMs,
    error: health.error,
    bot: health.details
      ? {
          id: health.details.botId,
          username: health.details.botUsername,
          discriminator: health.details.botDiscriminator,
          verified: health.details.verified,
        }
      : null,
    allowlists: {
      guilds: config.allowedGuildIds?.length || 0,
      channels: config.allowedChannelIds?.length || 0,
      roles: config.allowedRoleIds?.length || 0,
    },
  });
});

/**
 * POST /test - Send a test message
 *
 * Body: { channel_id: string, text: string }
 */
discord.post('/test', async (c) => {
  const config = getConfig();

  if (!config?.botToken) {
    return c.json({ error: 'Bot token not configured' }, 400);
  }

  let body: { channel_id: string; text: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (!body.channel_id || !body.text) {
    return c.json({ error: 'Missing channel_id or text parameter' }, 400);
  }

  // Set config for outbound adapter
  setDiscordConfig(config);

  const result = await discordProvider.outbound.send({
    provider: 'discord',
    to: body.channel_id,
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

// SLASH COMMAND MANAGEMENT

/**
 * POST /commands/register - Register slash commands
 *
 * Body: {
 *   commands: Array<{ name, description, options? }>,
 *   guild_id?: string (optional, for guild-specific commands)
 * }
 */
discord.post('/commands/register', async (c) => {
  const config = getConfig();

  if (!config?.botToken || !config?.applicationId) {
    return c.json({ error: 'Bot token or application ID not configured' }, 400);
  }

  let body: {
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
    }>;
    guild_id?: string;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (!body.commands || !Array.isArray(body.commands)) {
    return c.json({ error: 'Missing commands array' }, 400);
  }

  const result = await registerSlashCommands(
    config.applicationId,
    config.botToken,
    body.commands,
    body.guild_id
  );

  if (result.success) {
    logger.info('[Discord] Slash commands registered', {
      count: body.commands.length,
      guildId: body.guild_id || 'global',
    });
    return c.json({
      success: true,
      message: `Registered ${body.commands.length} command(s)`,
      scope: body.guild_id ? `guild:${body.guild_id}` : 'global',
    });
  }

  return c.json({ error: result.error || 'Failed to register commands' }, 500);
});

/**
 * GET /commands - List registered commands
 */
discord.get('/commands', async (c) => {
  const config = getConfig();

  if (!config?.botToken || !config?.applicationId) {
    return c.json({ error: 'Bot token or application ID not configured' }, 400);
  }

  const guildId = c.req.query('guild_id');
  const endpoint = guildId
    ? `https://discord.com/api/v10/applications/${config.applicationId}/guilds/${guildId}/commands`
    : `https://discord.com/api/v10/applications/${config.applicationId}/commands`;

  try {
    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bot ${config.botToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.json() as { message?: string };
      return c.json({ error: error.message || `HTTP ${response.status}` }, 500);
    }

    const commands = await response.json();
    return c.json({ commands, scope: guildId ? `guild:${guildId}` : 'global' });
  } catch {
    return c.json({ error: 'Failed to fetch commands' }, 500);
  }
});

// CONFIGURATION MANAGEMENT

/**
 * GET /config - Get current configuration (redacted)
 */
discord.get('/config', async (c) => {
  const config = getConfig();

  if (!config) {
    return c.json({
      configured: false,
      source: null,
    });
  }

  return c.json({
    configured: true,
    source: config.id === 'discord-env' ? 'environment' : 'database',
    accountId: config.id,
    accountName: config.name,
    enabled: config.enabled,
    isDefault: config.isDefault,
    applicationId: config.applicationId,
    hasPublicKey: !!config.publicKey,
    hasToken: !!config.botToken,
    allowedGuilds: config.allowedGuildIds?.length || 0,
    allowedChannels: config.allowedChannelIds?.length || 0,
    allowedRoles: config.allowedRoleIds?.length || 0,
  });
});

/**
 * POST /config - Update configuration (stores in registry)
 *
 * Body: {
 *   botToken: string,
 *   applicationId: string,
 *   publicKey: string,
 *   allowedGuildIds?: string[],
 *   allowedChannelIds?: string[],
 *   allowedRoleIds?: string[],
 *   name?: string,
 *   enabled?: boolean
 * }
 */
discord.post('/config', async (c) => {
  let body: Partial<DiscordAccountConfig & {
    allowedGuildIds?: string[];
    allowedChannelIds?: string[];
    allowedRoleIds?: string[];
  }>;

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (!body.botToken || !body.applicationId || !body.publicKey) {
    return c.json({ error: 'Missing botToken, applicationId, or publicKey' }, 400);
  }

  const config: DiscordConfig = {
    id: body.id || `discord-${Date.now()}`,
    name: body.name || 'Discord Bot',
    enabled: body.enabled ?? true,
    isDefault: true,
    provider: 'discord',
    botToken: body.botToken,
    applicationId: body.applicationId,
    publicKey: body.publicKey,
    guildId: body.guildId,
    allowedGuildIds: body.allowedGuildIds || [],
    allowedChannelIds: body.allowedChannelIds || [],
    allowedRoleIds: body.allowedRoleIds || [],
  };

  // Validate by checking health
  setDiscordConfig(config);
  const health = await discordProvider.status.checkHealth(config);

  if (!health.connected) {
    return c.json({ error: health.error || 'Invalid configuration - could not connect' }, 400);
  }

  // Register the account
  try {
    getChatRegistry().registerAccount(config);

    logger.info('[Discord] Account configured', {
      id: config.id,
      botUsername: health.details?.botUsername,
    });

    return c.json({
      success: true,
      account: {
        id: config.id,
        name: config.name,
        botId: health.details?.botId,
        botUsername: health.details?.botUsername,
      },
    });
  } catch (error) {
    logger.error('[Discord] Failed to register account:', error instanceof Error ? error : undefined);
    return c.json({ error: 'Failed to save configuration' }, 500);
  }
});

/**
 * DELETE /config - Disconnect the bot
 */
discord.delete('/config', async (c) => {
  try {
    const accounts = getChatRegistry().listAccounts('discord');
    for (const account of accounts) {
      getChatRegistry().removeAccount('discord', account.id);
    }
    clearDiscordConfig();
    logger.info('[Discord] Bot disconnected');
    return c.json({ success: true });
  } catch (error) {
    logger.error('[Discord] Failed to disconnect:', error instanceof Error ? error : undefined);
    return c.json({ error: 'Failed to disconnect' }, 500);
  }
});

export { discord as discordRoutes };
