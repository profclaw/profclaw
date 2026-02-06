/**
 * Chat Providers Module
 *
 * Unified chat provider system supporting Slack, Discord, Telegram, WhatsApp, and more.
 *
 * Usage:
 * ```ts
 * import { getChatRegistry, slackProvider } from './chat/providers';
 *
 * // Register providers
 * const registry = getChatRegistry();
 * registry.register(slackProvider);
 *
 * // Send a message
 * const provider = registry.get('slack');
 * await provider?.outbound.send({ provider: 'slack', to: 'C123', text: 'Hello!' });
 * ```
 */

// Core types
export * from './types.js';

// Registry
export { getChatRegistry, resetChatRegistry, ChatProviderRegistry } from './registry.js';

// Providers
export { slackProvider, SlackAccountConfigSchema } from './slack/index.js';
export { discordProvider, DiscordAccountConfigSchema } from './discord/index.js';
export { telegramProvider, TelegramAccountConfigSchema } from './telegram/index.js';
export { whatsappProvider, WhatsAppAccountConfigSchema } from './whatsapp/index.js';

// =============================================================================
// INITIALIZATION
// =============================================================================

import { getChatRegistry } from './registry.js';
import { slackProvider } from './slack/index.js';
import { discordProvider } from './discord/index.js';
import { telegramProvider } from './telegram/index.js';
import { whatsappProvider } from './whatsapp/index.js';

/**
 * Initialize chat providers with default configuration
 */
export function initializeChatProviders(): void {
  const registry = getChatRegistry();

  // Register built-in providers
  registry.register(slackProvider);
  registry.register(discordProvider);
  registry.register(telegramProvider);
  registry.register(whatsappProvider);

  // Register accounts from environment
  if (process.env.SLACK_BOT_TOKEN || process.env.SLACK_SIGNING_SECRET) {
    registry.registerAccount({
      id: 'default',
      provider: 'slack',
      name: process.env.SLACK_TEAM_NAME || 'Default Workspace',
      enabled: true,
      isDefault: true,
      mode: process.env.SLACK_MODE === 'socket' ? 'socket' : 'http',
      botToken: process.env.SLACK_BOT_TOKEN,
      appToken: process.env.SLACK_APP_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
      webhookUrl: process.env.SLACK_WEBHOOK_URL,
      teamId: process.env.SLACK_TEAM_ID,
      teamName: process.env.SLACK_TEAM_NAME,
    });
  }

  // Future: Load additional providers from database or config file
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

import type { OutgoingMessage, SendResult, ChatProviderId } from './types.js';

/**
 * Send a message via the appropriate provider
 */
export async function sendMessage(message: OutgoingMessage): Promise<SendResult> {
  const registry = getChatRegistry();
  const provider = registry.get(message.provider);

  if (!provider) {
    return { success: false, error: `Provider ${message.provider} not found` };
  }

  return provider.outbound.send(message);
}

/**
 * Get provider status
 */
export async function getProviderStatus(providerId: ChatProviderId) {
  const registry = getChatRegistry();
  const provider = registry.get(providerId);

  if (!provider) {
    return { configured: false, connected: false, error: 'Provider not found' };
  }

  const account = registry.getDefaultAccount(providerId);
  if (!account) {
    return { configured: false, connected: false, error: 'No account configured' };
  }

  const configured = provider.status.isConfigured(account);
  if (!configured) {
    return { configured: false, connected: false };
  }

  const health = await provider.status.checkHealth(account);
  return {
    configured: true,
    connected: health.connected,
    latencyMs: health.latencyMs,
    error: health.error,
    details: health.details,
  };
}
