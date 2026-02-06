/**
 * Unified Channel Management Routes
 *
 * Provides a single API for managing all chat channel providers
 * (Telegram, Discord, WhatsApp, Slack, etc.).
 *
 * Delegates to individual provider modules for health checks
 * and reads from the chat provider registry for status.
 */

import { Hono } from 'hono';
import type { ChatProviderId } from '../chat/providers/types.js';

export const channelsRoutes = new Hono();

const KNOWN_PROVIDERS: ChatProviderId[] = [
  'slack', 'discord', 'telegram', 'whatsapp', 'webchat',
  'matrix', 'googlechat', 'msteams', 'mattermost',
];

function isKnownProvider(provider: string): provider is ChatProviderId {
  return KNOWN_PROVIDERS.includes(provider as ChatProviderId);
}

/**
 * GET /
 * List all channel providers with their status
 */
channelsRoutes.get('/', async (c) => {
  const { getChatRegistry } = await import('../chat/providers/registry.js');
  const registry = getChatRegistry();
  const status = await registry.getStatus();

  const channels = KNOWN_PROVIDERS.map((id) => {
    const providerStatus = status.providers.find((p) => p.id === id);
    const hasAccounts = providerStatus && providerStatus.accounts.length > 0;
    const anyEnabled = providerStatus?.accounts.some((a) => a.enabled) ?? false;
    const anyConfigured = providerStatus?.accounts.some((a) => a.configured) ?? false;
    const anyConnected = providerStatus?.accounts.some((a) => a.connected) ?? false;

    return {
      provider: id,
      registered: providerStatus?.registered ?? false,
      enabled: anyEnabled,
      configured: anyConfigured,
      healthy: hasAccounts ? anyConnected : undefined,
      accounts: providerStatus?.accounts ?? [],
    };
  });

  return c.json({ channels });
});

/**
 * POST /:provider/enable
 * Enable a channel provider account
 */
channelsRoutes.post('/:provider/enable', async (c) => {
  const provider = c.req.param('provider');
  if (!isKnownProvider(provider)) {
    return c.json({ error: `Unknown provider: ${provider}` }, 400);
  }

  const { getChatRegistry } = await import('../chat/providers/registry.js');
  const registry = getChatRegistry();

  const account = registry.getDefaultAccount(provider as ChatProviderId);
  if (!account) {
    return c.json({ error: `No account configured for ${provider}` }, 404);
  }

  account.enabled = true;
  registry.registerAccount(account);

  return c.json({
    provider,
    enabled: true,
    message: `${provider} enabled`,
  });
});

/**
 * POST /:provider/disable
 * Disable a channel provider account
 */
channelsRoutes.post('/:provider/disable', async (c) => {
  const provider = c.req.param('provider');
  if (!isKnownProvider(provider)) {
    return c.json({ error: `Unknown provider: ${provider}` }, 400);
  }

  const { getChatRegistry } = await import('../chat/providers/registry.js');
  const registry = getChatRegistry();

  const account = registry.getDefaultAccount(provider as ChatProviderId);
  if (!account) {
    return c.json({ error: `No account configured for ${provider}` }, 404);
  }

  account.enabled = false;
  registry.registerAccount(account);

  return c.json({
    provider,
    enabled: false,
    message: `${provider} disabled`,
  });
});

/**
 * GET /:provider/config
 * Get provider configuration (secrets redacted)
 */
channelsRoutes.get('/:provider/config', async (c) => {
  const provider = c.req.param('provider');
  if (!isKnownProvider(provider)) {
    return c.json({ error: `Unknown provider: ${provider}` }, 400);
  }

  const { getChatRegistry } = await import('../chat/providers/registry.js');
  const registry = getChatRegistry();

  const accounts = registry.listAccounts(provider as ChatProviderId);
  if (accounts.length === 0) {
    return c.json({ error: `No accounts configured for ${provider}` }, 404);
  }

  // Redact secrets from config
  const redacted = accounts.map((account) => {
    const safe: Record<string, unknown> = {
      id: account.id,
      name: account.name,
      provider: account.provider,
      enabled: account.enabled,
    };
    // Copy non-secret fields from config
    if (account && typeof account === 'object') {
      for (const [key, val] of Object.entries(account)) {
        if (['id', 'name', 'provider', 'enabled'].includes(key)) continue;
        // Redact anything that looks like a token/secret/key/password
        if (typeof val === 'string' && /token|secret|key|password|api_key/i.test(key)) {
          safe[key] = val.length > 4 ? `${val.slice(0, 4)}...` : '***';
        } else {
          safe[key] = val;
        }
      }
    }
    return safe;
  });

  return c.json({ provider, config: redacted });
});

/**
 * POST /:provider/test
 * Health check a provider connection
 */
channelsRoutes.post('/:provider/test', async (c) => {
  const provider = c.req.param('provider');
  if (!isKnownProvider(provider)) {
    return c.json({ error: `Unknown provider: ${provider}` }, 400);
  }

  const { getChatRegistry } = await import('../chat/providers/registry.js');
  const registry = getChatRegistry();

  const chatProvider = registry.get(provider as ChatProviderId);
  if (!chatProvider) {
    return c.json({ provider, healthy: false, message: `Provider ${provider} not registered` });
  }

  const account = registry.getDefaultAccount(provider as ChatProviderId);
  if (!account) {
    return c.json({ provider, healthy: false, message: `No account configured for ${provider}` });
  }

  try {
    const health = await chatProvider.status.checkHealth(account);
    return c.json({
      provider,
      healthy: health.connected,
      message: health.error ?? (health.connected ? 'Connected' : 'Disconnected'),
    });
  } catch (err) {
    return c.json({
      provider,
      healthy: false,
      message: err instanceof Error ? err.message : 'Health check failed',
    });
  }
});
