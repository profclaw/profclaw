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
export { webchatProvider } from './webchat/index.js';
export { matrixProvider, MatrixAccountConfigSchema } from './matrix/index.js';
export { googlechatProvider, GoogleChatAccountConfigSchema } from './googlechat/index.js';
export { msteamsProvider, MSTeamsAccountConfigSchema } from './msteams/index.js';
export { signalProvider, SignalAccountConfigSchema } from './signal/index.js';
export { ircProvider, IRCAccountConfigSchema } from './irc/index.js';
export { lineProvider, LINEAccountConfigSchema } from './line/index.js';
export { mattermostProvider, MattermostAccountConfigSchema } from './mattermost/index.js';
export { dingtalkProvider, DingTalkAccountConfigSchema } from './dingtalk/index.js';
export { wecomProvider, WeComAccountConfigSchema } from './wecom/index.js';
export { feishuProvider, FeishuAccountConfigSchema } from './feishu/index.js';
export { qqProvider, QQAccountConfigSchema } from './qq/index.js';
export { nostrProvider, NostrAccountConfigSchema } from './nostr/index.js';
export { twitchProvider, TwitchAccountConfigSchema } from './twitch/index.js';
export { zaloProvider, ZaloAccountConfigSchema } from './zalo/index.js';
export { nextcloudProvider, NextcloudAccountConfigSchema } from './nextcloud/index.js';
export { imessageProvider, IMessageAccountConfigSchema } from './imessage/index.js';
export { synologyProvider, SynologyAccountConfigSchema } from './synology/index.js';
export { tlonProvider, TlonAccountConfigSchema } from './tlon/index.js';
export { zaloPersonalProvider, ZaloPersonalAccountConfigSchema } from './zalo-personal/index.js';

// INITIALIZATION

import { getChatRegistry } from './registry.js';
import { slackProvider } from './slack/index.js';
import { discordProvider } from './discord/index.js';
import { telegramProvider } from './telegram/index.js';
import { whatsappProvider } from './whatsapp/index.js';
import { webchatProvider } from './webchat/index.js';
import { matrixProvider } from './matrix/index.js';
import { googlechatProvider } from './googlechat/index.js';
import { msteamsProvider } from './msteams/index.js';
import { signalProvider } from './signal/index.js';
import { ircProvider } from './irc/index.js';
import { lineProvider } from './line/index.js';
import { mattermostProvider } from './mattermost/index.js';
import { dingtalkProvider } from './dingtalk/index.js';
import { wecomProvider } from './wecom/index.js';
import { feishuProvider } from './feishu/index.js';
import { qqProvider } from './qq/index.js';
import { nostrProvider } from './nostr/index.js';
import { twitchProvider } from './twitch/index.js';
import { zaloProvider } from './zalo/index.js';
import { nextcloudProvider } from './nextcloud/index.js';
import { imessageProvider } from './imessage/index.js';
import { synologyProvider } from './synology/index.js';
import { tlonProvider } from './tlon/index.js';
import { zaloPersonalProvider } from './zalo-personal/index.js';

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
  registry.register(webchatProvider);
  registry.register(matrixProvider);
  registry.register(googlechatProvider);
  registry.register(msteamsProvider);
  registry.register(signalProvider);
  registry.register(ircProvider);
  registry.register(lineProvider);
  registry.register(mattermostProvider);
  registry.register(dingtalkProvider);
  registry.register(wecomProvider);
  registry.register(feishuProvider);
  registry.register(qqProvider);
  registry.register(nostrProvider);
  registry.register(twitchProvider);
  registry.register(zaloProvider);
  registry.register(nextcloudProvider);
  registry.register(imessageProvider);
  registry.register(synologyProvider);
  registry.register(tlonProvider);
  registry.register(zaloPersonalProvider);

  // WebChat is always available with default account
  registry.registerAccount({
    id: 'default',
    provider: 'webchat',
    name: 'WebChat',
    enabled: true,
    isDefault: true,
    allowAnonymous: true,
  });

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

  // Matrix account from environment
  if (process.env.MATRIX_HOMESERVER_URL && process.env.MATRIX_ACCESS_TOKEN) {
    registry.registerAccount({
      id: 'default',
      provider: 'matrix',
      name: 'Matrix',
      enabled: true,
      isDefault: true,
      homeserverUrl: process.env.MATRIX_HOMESERVER_URL,
      accessToken: process.env.MATRIX_ACCESS_TOKEN,
      userId: process.env.MATRIX_USER_ID,
    });
  }

  // Google Chat account from environment
  if (process.env.GOOGLE_CHAT_WEBHOOK_URL || process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_KEY) {
    registry.registerAccount({
      id: 'default',
      provider: 'googlechat',
      name: 'Google Chat',
      enabled: true,
      isDefault: true,
      webhookUrl: process.env.GOOGLE_CHAT_WEBHOOK_URL,
      serviceAccountKey: process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_KEY,
      projectId: process.env.GOOGLE_CHAT_PROJECT_ID,
    });
  }

  // MS Teams account from environment
  if (process.env.MSTEAMS_APP_ID && process.env.MSTEAMS_APP_PASSWORD) {
    registry.registerAccount({
      id: 'default',
      provider: 'msteams',
      name: 'Microsoft Teams',
      enabled: true,
      isDefault: true,
      appId: process.env.MSTEAMS_APP_ID,
      appPassword: process.env.MSTEAMS_APP_PASSWORD,
      tenantId: process.env.MSTEAMS_TENANT_ID,
    });
  }

  // Signal account from environment
  if (process.env.SIGNAL_PHONE_NUMBER) {
    registry.registerAccount({
      id: 'default',
      provider: 'signal',
      name: 'Signal',
      enabled: true,
      isDefault: true,
      phoneNumber: process.env.SIGNAL_PHONE_NUMBER,
      signaldSocketPath: process.env.SIGNALD_SOCKET_PATH,
      allowedNumbers: process.env.SIGNAL_ALLOWED_NUMBERS
        ? process.env.SIGNAL_ALLOWED_NUMBERS.split(',').map((n) => n.trim())
        : undefined,
    });
  }

  // IRC account from environment
  if (process.env.IRC_SERVER && process.env.IRC_NICK) {
    registry.registerAccount({
      id: 'default',
      provider: 'irc',
      name: 'IRC',
      enabled: true,
      isDefault: true,
      server: process.env.IRC_SERVER,
      port: process.env.IRC_PORT ? parseInt(process.env.IRC_PORT, 10) : 6697,
      nick: process.env.IRC_NICK,
      password: process.env.IRC_PASSWORD,
      channels: process.env.IRC_CHANNELS?.split(',').map((c) => c.trim()),
      useTLS: process.env.IRC_USE_TLS !== 'false',
    });
  }

  // LINE account from environment
  if (process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_CHANNEL_SECRET) {
    registry.registerAccount({
      id: 'default',
      provider: 'line',
      name: 'LINE',
      enabled: true,
      isDefault: true,
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
      channelSecret: process.env.LINE_CHANNEL_SECRET,
    });
  }

  // Mattermost account from environment
  if (process.env.MATTERMOST_SERVER_URL && process.env.MATTERMOST_BOT_TOKEN) {
    registry.registerAccount({
      id: 'default',
      provider: 'mattermost',
      name: 'Mattermost',
      enabled: true,
      isDefault: true,
      serverUrl: process.env.MATTERMOST_SERVER_URL,
      botToken: process.env.MATTERMOST_BOT_TOKEN,
      teamId: process.env.MATTERMOST_TEAM_ID,
    });
  }

  // DingTalk account from environment
  if (process.env.DINGTALK_WEBHOOK_URL) {
    registry.registerAccount({
      id: 'default',
      provider: 'dingtalk',
      name: 'DingTalk',
      enabled: true,
      isDefault: true,
      webhookUrl: process.env.DINGTALK_WEBHOOK_URL,
      webhookSecret: process.env.DINGTALK_WEBHOOK_SECRET,
      appKey: process.env.DINGTALK_APP_KEY,
      appSecret: process.env.DINGTALK_APP_SECRET,
    });
  }

  // WeCom account from environment
  if (process.env.WECOM_WEBHOOK_URL || (process.env.WECOM_CORP_ID && process.env.WECOM_SECRET)) {
    registry.registerAccount({
      id: 'default',
      provider: 'wecom',
      name: 'WeCom',
      enabled: true,
      isDefault: true,
      corpId: process.env.WECOM_CORP_ID,
      agentId: process.env.WECOM_AGENT_ID,
      secret: process.env.WECOM_SECRET,
      token: process.env.WECOM_TOKEN,
      encodingAESKey: process.env.WECOM_ENCODING_AES_KEY,
      webhookUrl: process.env.WECOM_WEBHOOK_URL,
    });
  }

  // Feishu/Lark account from environment
  if (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET) {
    registry.registerAccount({
      id: 'default',
      provider: 'feishu',
      name: 'Feishu',
      enabled: true,
      isDefault: true,
      appId: process.env.FEISHU_APP_ID,
      appSecret: process.env.FEISHU_APP_SECRET,
      verificationToken: process.env.FEISHU_VERIFICATION_TOKEN,
      encryptKey: process.env.FEISHU_ENCRYPT_KEY,
    });
  }

  // QQ Bot account from environment
  if (process.env.QQ_APP_ID && process.env.QQ_SECRET) {
    registry.registerAccount({
      id: 'default',
      provider: 'qq',
      name: 'QQ',
      enabled: true,
      isDefault: true,
      appId: process.env.QQ_APP_ID,
      token: process.env.QQ_TOKEN,
      secret: process.env.QQ_SECRET,
      sandboxMode: process.env.QQ_SANDBOX === 'true',
    });
  }

  // Twitch account from environment
  if (process.env.TWITCH_OAUTH_TOKEN && process.env.TWITCH_CLIENT_ID) {
    registry.registerAccount({
      id: 'default',
      provider: 'twitch',
      name: 'Twitch',
      enabled: true,
      isDefault: true,
      oauthToken: process.env.TWITCH_OAUTH_TOKEN,
      clientId: process.env.TWITCH_CLIENT_ID,
      nick: process.env.TWITCH_NICK,
      channels: process.env.TWITCH_CHANNELS?.split(',').map((c) => c.trim()),
    });
  }

  // Zalo account from environment
  if (process.env.ZALO_ACCESS_TOKEN) {
    registry.registerAccount({
      id: 'default',
      provider: 'zalo',
      name: 'Zalo',
      enabled: true,
      isDefault: true,
      accessToken: process.env.ZALO_ACCESS_TOKEN,
      refreshToken: process.env.ZALO_REFRESH_TOKEN,
      oaId: process.env.ZALO_OA_ID,
      secretKey: process.env.ZALO_SECRET_KEY,
    });
  }

  // Nextcloud Talk account from environment
  if (process.env.NEXTCLOUD_SERVER_URL && process.env.NEXTCLOUD_USERNAME) {
    registry.registerAccount({
      id: 'default',
      provider: 'nextcloud',
      name: 'Nextcloud Talk',
      enabled: true,
      isDefault: true,
      serverUrl: process.env.NEXTCLOUD_SERVER_URL,
      username: process.env.NEXTCLOUD_USERNAME,
      password: process.env.NEXTCLOUD_PASSWORD,
      token: process.env.NEXTCLOUD_TALK_TOKEN,
    });
  }

  // iMessage (BlueBubbles) account from environment
  if (process.env.BLUEBUBBLES_URL && process.env.BLUEBUBBLES_PASSWORD) {
    registry.registerAccount({
      id: 'default',
      provider: 'imessage',
      name: 'iMessage',
      enabled: true,
      isDefault: true,
      blueBubblesUrl: process.env.BLUEBUBBLES_URL,
      blueBubblesPassword: process.env.BLUEBUBBLES_PASSWORD,
      allowedAddresses: process.env.IMESSAGE_ALLOWED_ADDRESSES?.split(',').map((a) => a.trim()),
    });
  }

  // Synology Chat account from environment
  if (process.env.SYNOLOGY_INCOMING_WEBHOOK_URL) {
    registry.registerAccount({
      id: 'default',
      provider: 'synology',
      name: 'Synology Chat',
      enabled: true,
      isDefault: true,
      serverUrl: process.env.SYNOLOGY_SERVER_URL,
      incomingWebhookUrl: process.env.SYNOLOGY_INCOMING_WEBHOOK_URL,
      outgoingWebhookToken: process.env.SYNOLOGY_OUTGOING_WEBHOOK_TOKEN,
    });
  }

  // Nostr account from environment
  if (process.env.NOSTR_PRIVATE_KEY) {
    registry.registerAccount({
      id: 'default',
      provider: 'nostr',
      name: 'Nostr',
      enabled: true,
      isDefault: true,
      privateKey: process.env.NOSTR_PRIVATE_KEY,
      relayUrls: process.env.NOSTR_RELAY_URLS?.split(',').map((u) => u.trim()),
      allowedPubkeys: process.env.NOSTR_ALLOWED_PUBKEYS?.split(',').map((p) => p.trim()),
    });
  }

  // Tlon/Urbit account from environment
  if (process.env['TLON_SHIP_URL'] && process.env['TLON_SHIP_CODE']) {
    registry.registerAccount({
      id: 'default',
      provider: 'tlon',
      name: 'Tlon',
      enabled: true,
      isDefault: true,
      shipUrl: process.env['TLON_SHIP_URL'],
      shipCode: process.env['TLON_SHIP_CODE'],
      shipName: process.env['TLON_SHIP_NAME'],
      channelPath: process.env['TLON_CHANNEL_PATH'],
    });
  }

  // Zalo Personal account from environment
  if (process.env['ZALO_PERSONAL_ACCESS_TOKEN']) {
    registry.registerAccount({
      id: 'default',
      provider: 'zalo-personal',
      name: 'Zalo Personal',
      enabled: true,
      isDefault: true,
      accessToken: process.env['ZALO_PERSONAL_ACCESS_TOKEN'],
      secretKey: process.env['ZALO_PERSONAL_SECRET_KEY'],
      userId: process.env['ZALO_PERSONAL_USER_ID'],
    });
  }

  // Future: Load additional providers from database or config file
}

// CONVENIENCE FUNCTIONS

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
