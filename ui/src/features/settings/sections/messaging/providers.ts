/**
 * Messaging Provider Definitions
 *
 * Configuration schemas for all 22 supported messaging providers.
 */

export interface ProviderField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url' | 'textarea' | 'toggle';
  placeholder?: string;
  required?: boolean;
  helpText?: string;
}

export interface ProviderDefinition {
  id: string;
  name: string;
  color: string;
  description: string;
  docsUrl?: string;
  fields: ProviderField[];
  category: 'popular' | 'enterprise' | 'asian' | 'specialized';
  /** If true, this provider uses a rich custom config component instead of ProviderConfigCard */
  hasCustomConfig?: boolean;
  /** Short hint shown on unconfigured cards about what's needed to set up */
  prerequisite?: string;
  /** If true, this provider needs a public HTTPS URL for webhook delivery */
  requiresWebhook?: boolean;
  /** Webhook path appended to the tunnel URL (e.g. /webhook/telegram) */
  webhookPath?: string;
}

export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  // ---- Popular ----
  {
    id: 'telegram',
    name: 'Telegram',
    color: '#0088CC',
    description: 'Connect a Telegram bot via Bot API',
    docsUrl: 'https://core.telegram.org/bots',
    fields: [
      { key: 'botToken', label: 'Bot Token', type: 'password', required: true, placeholder: '123456:ABC-DEF...' },
    ],
    category: 'popular',
    hasCustomConfig: true,
    prerequisite: 'Create bot via @BotFather',
    requiresWebhook: true,
    webhookPath: '/webhook/telegram',
  },
  {
    id: 'discord',
    name: 'Discord',
    color: '#5865F2',
    description: 'Slash commands and interactions via Discord Bot',
    docsUrl: 'https://discord.com/developers/docs',
    fields: [
      { key: 'botToken', label: 'Bot Token', type: 'password', required: true, placeholder: 'MTI...abc' },
      { key: 'applicationId', label: 'Application ID', type: 'text', required: true, placeholder: '123456789012345678' },
    ],
    category: 'popular',
    hasCustomConfig: true,
    prerequisite: 'Create app at discord.com/developers',
    requiresWebhook: true,
    webhookPath: '/webhook/discord',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    color: '#25D366',
    description: 'Connect via WhatsApp Business Cloud API',
    docsUrl: 'https://developers.facebook.com/docs/whatsapp',
    fields: [
      { key: 'phoneNumberId', label: 'Phone Number ID', type: 'text', required: true, placeholder: '123456789012345' },
      { key: 'accessToken', label: 'Access Token', type: 'password', required: true },
      { key: 'verifyToken', label: 'Webhook Verify Token', type: 'text', required: true },
    ],
    category: 'popular',
    hasCustomConfig: true,
    prerequisite: 'WhatsApp Business account required',
    requiresWebhook: true,
    webhookPath: '/webhook/whatsapp',
  },
  {
    id: 'slack',
    name: 'Slack',
    color: '#4A154B',
    description: 'Connect via Slack Bolt SDK with slash commands',
    docsUrl: 'https://api.slack.com/',
    fields: [
      { key: 'botToken', label: 'Bot Token', type: 'password', required: true, placeholder: 'xoxb-...' },
      { key: 'signingSecret', label: 'Signing Secret', type: 'password', required: true },
      { key: 'appToken', label: 'App Token (Socket Mode)', type: 'password', placeholder: 'xapp-...' },
    ],
    category: 'popular',
    hasCustomConfig: true,
    prerequisite: 'Create app at api.slack.com',
    requiresWebhook: true,
    webhookPath: '/webhook/slack',
  },
  {
    id: 'webchat',
    name: 'WebChat',
    color: '#6366F1',
    description: 'Built-in web chat widget - no configuration needed',
    fields: [],
    category: 'popular',
    prerequisite: 'Built-in - no setup needed',
  },
  // ---- Enterprise ----
  {
    id: 'msteams',
    name: 'MS Teams',
    color: '#5059C9',
    description: 'Bot Framework with Adaptive Cards',
    docsUrl: 'https://learn.microsoft.com/en-us/microsoftteams/platform/',
    fields: [
      { key: 'appId', label: 'App ID', type: 'text', required: true },
      { key: 'appPassword', label: 'App Password', type: 'password', required: true },
    ],
    category: 'enterprise',
    hasCustomConfig: true,
    prerequisite: 'Azure Bot registration required',
    requiresWebhook: true,
    webhookPath: '/webhook/msteams',
  },
  {
    id: 'googlechat',
    name: 'Google Chat',
    color: '#00AC47',
    description: 'Google Workspace integration via Chat API',
    docsUrl: 'https://developers.google.com/chat',
    fields: [
      { key: 'serviceAccountKey', label: 'Service Account JSON', type: 'textarea', required: true, helpText: 'Paste the full JSON service account key' },
      { key: 'spaceId', label: 'Space ID', type: 'text', placeholder: 'spaces/AAAA...' },
    ],
    category: 'enterprise',
    hasCustomConfig: true,
    prerequisite: 'Google Workspace service account',
    requiresWebhook: true,
    webhookPath: '/webhook/googlechat',
  },
  {
    id: 'matrix',
    name: 'Matrix',
    color: '#0DBD8B',
    description: 'Decentralized messaging with optional E2EE',
    docsUrl: 'https://spec.matrix.org/',
    fields: [
      { key: 'homeserverUrl', label: 'Homeserver URL', type: 'url', required: true, placeholder: 'https://matrix.org' },
      { key: 'accessToken', label: 'Access Token', type: 'password', required: true },
      { key: 'userId', label: 'User ID', type: 'text', required: true, placeholder: '@bot:matrix.org' },
    ],
    category: 'enterprise',
    hasCustomConfig: true,
    prerequisite: 'Homeserver access token needed',
  },
  {
    id: 'mattermost',
    name: 'Mattermost',
    color: '#0058CC',
    description: 'Self-hosted team messaging platform',
    docsUrl: 'https://developers.mattermost.com/',
    fields: [
      { key: 'serverUrl', label: 'Server URL', type: 'url', required: true, placeholder: 'https://mattermost.example.com' },
      { key: 'accessToken', label: 'Access Token', type: 'password', required: true, helpText: 'Bot account personal access token' },
    ],
    category: 'enterprise',
    prerequisite: 'Bot account access token needed',
  },
  // ---- Asian Markets ----
  {
    id: 'line',
    name: 'LINE',
    color: '#00B900',
    description: 'LINE Messaging API for bot interactions',
    docsUrl: 'https://developers.line.biz/en/docs/messaging-api/',
    fields: [
      { key: 'channelAccessToken', label: 'Channel Access Token', type: 'password', required: true },
      { key: 'channelSecret', label: 'Channel Secret', type: 'password', required: true },
    ],
    category: 'asian',
    prerequisite: 'LINE Developers console channel',
    requiresWebhook: true,
    webhookPath: '/webhook/line',
  },
  {
    id: 'dingtalk',
    name: 'DingTalk',
    color: '#0089FF',
    description: 'Alibaba enterprise messaging and automation',
    docsUrl: 'https://open.dingtalk.com/document/',
    fields: [
      { key: 'appKey', label: 'App Key', type: 'text', required: true },
      { key: 'appSecret', label: 'App Secret', type: 'password', required: true },
      { key: 'robotToken', label: 'Robot Token', type: 'password', required: true, helpText: 'Custom robot webhook token' },
    ],
    category: 'asian',
    prerequisite: 'DingTalk Open Platform app',
    requiresWebhook: true,
    webhookPath: '/webhook/dingtalk',
  },
  {
    id: 'wecom',
    name: 'WeCom',
    color: '#2B7CEA',
    description: 'Tencent enterprise messaging (WeChat Work)',
    docsUrl: 'https://developer.work.weixin.qq.com/',
    fields: [
      { key: 'corpId', label: 'Corp ID', type: 'text', required: true },
      { key: 'agentId', label: 'Agent ID', type: 'text', required: true },
      { key: 'secret', label: 'Secret', type: 'password', required: true },
      { key: 'token', label: 'Callback Token', type: 'text', required: true },
      { key: 'encodingAESKey', label: 'Encoding AES Key', type: 'password', required: true },
    ],
    category: 'asian',
    prerequisite: 'WeCom admin console agent',
    requiresWebhook: true,
    webhookPath: '/webhook/wecom',
  },
  {
    id: 'feishu',
    name: 'Feishu / Lark',
    color: '#3370FF',
    description: 'ByteDance collaboration platform',
    docsUrl: 'https://open.feishu.cn/document/',
    fields: [
      { key: 'appId', label: 'App ID', type: 'text', required: true },
      { key: 'appSecret', label: 'App Secret', type: 'password', required: true },
      { key: 'verificationToken', label: 'Verification Token', type: 'text', required: true },
      { key: 'encryptKey', label: 'Encrypt Key', type: 'password', helpText: 'Required if encryption is enabled' },
    ],
    category: 'asian',
    prerequisite: 'Create app at open.feishu.cn',
    requiresWebhook: true,
    webhookPath: '/webhook/feishu',
  },
  {
    id: 'qq',
    name: 'QQ',
    color: '#12B7F5',
    description: 'Tencent QQ bot via official API',
    docsUrl: 'https://bot.q.qq.com/wiki/',
    fields: [
      { key: 'appId', label: 'App ID', type: 'text', required: true },
      { key: 'token', label: 'Token', type: 'password', required: true },
      { key: 'secret', label: 'Secret', type: 'password', required: true },
    ],
    category: 'asian',
    prerequisite: 'QQ Bot Platform registration',
    requiresWebhook: true,
    webhookPath: '/webhook/qq',
  },
  {
    id: 'zalo',
    name: 'Zalo',
    color: '#0068FF',
    description: 'Vietnamese messaging platform OA API',
    docsUrl: 'https://developers.zalo.me/',
    fields: [
      { key: 'appId', label: 'App ID', type: 'text', required: true },
      { key: 'secretKey', label: 'Secret Key', type: 'password', required: true },
      { key: 'accessToken', label: 'Access Token', type: 'password', required: true },
      { key: 'refreshToken', label: 'Refresh Token', type: 'password', required: true, helpText: 'Required for automatic token renewal' },
    ],
    category: 'asian',
    prerequisite: 'Zalo Official Account needed',
    requiresWebhook: true,
    webhookPath: '/webhook/zalo',
  },
  // ---- Specialized ----
  {
    id: 'signal',
    name: 'Signal',
    color: '#3A76F0',
    description: 'Private messaging via signald bridge',
    docsUrl: 'https://signald.org',
    fields: [
      { key: 'socketPath', label: 'signald Socket Path', type: 'text', required: true, placeholder: '/var/run/signald/signald.sock' },
      { key: 'phoneNumber', label: 'Phone Number', type: 'text', required: true, placeholder: '+1234567890' },
    ],
    category: 'specialized',
    prerequisite: 'Requires signald bridge running',
  },
  {
    id: 'irc',
    name: 'IRC',
    color: '#6B7280',
    description: 'Classic Internet Relay Chat protocol',
    fields: [
      { key: 'server', label: 'Server', type: 'text', required: true, placeholder: 'irc.libera.chat' },
      { key: 'port', label: 'Port', type: 'text', required: true, placeholder: '6697' },
      { key: 'nick', label: 'Nickname', type: 'text', required: true, placeholder: 'profclaw-bot' },
      { key: 'channels', label: 'Channels', type: 'text', required: true, placeholder: '#general, #dev', helpText: 'Comma-separated list of channels' },
      { key: 'useTLS', label: 'Use TLS', type: 'toggle' },
      { key: 'password', label: 'Server Password', type: 'password', helpText: 'Optional NickServ or server password' },
    ],
    category: 'specialized',
    prerequisite: 'Server address and nickname',
  },
  {
    id: 'nostr',
    name: 'Nostr',
    color: '#8B5CF6',
    description: 'Decentralized social protocol',
    docsUrl: 'https://nostr.com/',
    fields: [
      { key: 'privateKey', label: 'Private Key', type: 'password', required: true, helpText: 'Hex or nsec format' },
      { key: 'relayUrls', label: 'Relay URLs', type: 'textarea', required: true, placeholder: 'wss://relay.damus.io\nwss://nos.lol', helpText: 'One relay URL per line' },
    ],
    category: 'specialized',
    prerequisite: 'Nostr private key (nsec)',
  },
  {
    id: 'twitch',
    name: 'Twitch',
    color: '#9146FF',
    description: 'Twitch chat bot for live streams',
    docsUrl: 'https://dev.twitch.tv/docs/',
    fields: [
      { key: 'clientId', label: 'Client ID', type: 'text', required: true },
      { key: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
      { key: 'botUsername', label: 'Bot Username', type: 'text', required: true },
      { key: 'channels', label: 'Channels', type: 'text', required: true, placeholder: 'channel1, channel2', helpText: 'Comma-separated channel names' },
    ],
    category: 'specialized',
    prerequisite: 'Twitch Developer application',
    requiresWebhook: true,
    webhookPath: '/webhook/twitch',
  },
  {
    id: 'imessage',
    name: 'iMessage',
    color: '#34C759',
    description: 'Apple iMessage via BlueBubbles bridge',
    docsUrl: 'https://bluebubbles.app/',
    fields: [
      { key: 'serverUrl', label: 'BlueBubbles Server URL', type: 'url', required: true, placeholder: 'http://localhost:1234' },
      { key: 'password', label: 'Password', type: 'password', required: true },
    ],
    category: 'specialized',
    prerequisite: 'Requires BlueBubbles on macOS',
  },
  {
    id: 'nextcloud',
    name: 'Nextcloud Talk',
    color: '#0082C9',
    description: 'Self-hosted collaboration messaging',
    docsUrl: 'https://nextcloud-talk.readthedocs.io/',
    fields: [
      { key: 'serverUrl', label: 'Server URL', type: 'url', required: true, placeholder: 'https://nextcloud.example.com' },
      { key: 'username', label: 'Username', type: 'text', required: true },
      { key: 'password', label: 'Password', type: 'password', required: true },
    ],
    category: 'specialized',
    prerequisite: 'Nextcloud server with Talk app',
  },
  {
    id: 'synology',
    name: 'Synology Chat',
    color: '#4B8BBE',
    description: 'Synology NAS built-in team messaging',
    fields: [
      { key: 'serverUrl', label: 'Server URL', type: 'url', required: true, placeholder: 'https://nas.example.com:5001' },
      { key: 'botToken', label: 'Bot Token', type: 'password', required: true },
    ],
    category: 'specialized',
    prerequisite: 'Synology NAS with Chat package',
  },
];

export const CATEGORIES: Record<string, { label: string; ids: string[] }> = {
  popular: {
    label: 'Popular',
    ids: ['telegram', 'discord', 'whatsapp', 'slack', 'webchat'],
  },
  enterprise: {
    label: 'Enterprise',
    ids: ['msteams', 'googlechat', 'matrix', 'mattermost'],
  },
  asian: {
    label: 'Asian Markets',
    ids: ['line', 'dingtalk', 'wecom', 'feishu', 'qq', 'zalo'],
  },
  specialized: {
    label: 'Specialized',
    ids: ['signal', 'irc', 'nostr', 'twitch', 'imessage', 'nextcloud', 'synology'],
  },
};
