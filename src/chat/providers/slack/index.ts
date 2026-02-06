/**
 * Slack Provider
 *
 * Full implementation of the ChatProvider interface for Slack.
 * Supports slash commands, interactive components, webhooks, and OAuth.
 */

import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'crypto';
import { logger } from '../../../utils/logger.js';
import type {
  ChatProvider,
  SlackAccountConfig,
  ChatProviderMeta,
  ChatProviderCapabilities,
  AuthAdapter,
  OutboundAdapter,
  InboundAdapter,
  StatusAdapter,
  OutgoingMessage,
  SendResult,
  IncomingMessage,
  SlashCommand,
  InteractiveAction,
  CommandResponse,
} from '../types.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const SlackAccountConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().optional(),
  provider: z.literal('slack'),
  mode: z.enum(['socket', 'http']).default('http'),
  botToken: z.string().optional(),
  appToken: z.string().optional(),
  signingSecret: z.string().optional(),
  webhookUrl: z.string().optional(),
  teamId: z.string().optional(),
  teamName: z.string().optional(),
}) satisfies z.ZodType<SlackAccountConfig>;

// =============================================================================
// CONSTANTS
// =============================================================================

const SLACK_API_BASE = 'https://slack.com/api';
const SLACK_OAUTH_AUTHORIZE = 'https://slack.com/oauth/v2/authorize';
const SLACK_OAUTH_TOKEN = 'https://slack.com/api/oauth.v2.access';

// Environment variables
const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID || '';
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET || '';
const SLACK_REDIRECT_URI = process.env.SLACK_REDIRECT_URI || '';
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || '';

// =============================================================================
// SLACK API RESPONSE TYPES
// =============================================================================

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  // OAuth response fields
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  bot_user_id?: string;
  team?: { id?: string; name?: string };
  // Message response fields
  ts?: string;
  message?: { thread_ts?: string };
  // Auth test response fields
  team_id?: string;
  user?: string;
  user_id?: string;
  bot_id?: string;
}

// =============================================================================
// METADATA
// =============================================================================

const meta: ChatProviderMeta = {
  id: 'slack',
  name: 'Slack',
  description: 'Slack workspace integration with slash commands and interactive components',
  icon: '💬',
  docsUrl: 'https://api.slack.com/docs',
  order: 1,
  color: '#4A154B',
};

// =============================================================================
// CAPABILITIES
// =============================================================================

const capabilities: ChatProviderCapabilities = {
  chatTypes: ['direct', 'channel', 'thread'],
  send: true,
  receive: true,
  slashCommands: true,
  interactiveComponents: true,
  reactions: true,
  edit: true,
  delete: true,
  threads: true,
  media: true,
  richBlocks: true,
  oauth: true,
  webhooks: true,
  realtime: true, // Socket Mode
};

// =============================================================================
// AUTH ADAPTER
// =============================================================================

const authAdapter: AuthAdapter = {
  getAuthUrl(state: string, scopes?: string[]): string {
    if (!SLACK_CLIENT_ID) {
      throw new Error('SLACK_CLIENT_ID not configured');
    }

    const defaultScopes = [
      'commands',
      'chat:write',
      'chat:write.public',
      'channels:read',
      'groups:read',
      'im:read',
      'mpim:read',
      'users:read',
      'reactions:write',
      'reactions:read',
    ];

    const params = new URLSearchParams({
      client_id: SLACK_CLIENT_ID,
      scope: (scopes || defaultScopes).join(','),
      redirect_uri: SLACK_REDIRECT_URI,
      state,
    });

    return `${SLACK_OAUTH_AUTHORIZE}?${params}`;
  },

  async exchangeCode(code: string) {
    if (!SLACK_CLIENT_ID || !SLACK_CLIENT_SECRET) {
      throw new Error('Slack OAuth not configured');
    }

    const response = await fetch(SLACK_OAUTH_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: SLACK_CLIENT_ID,
        client_secret: SLACK_CLIENT_SECRET,
        code,
        redirect_uri: SLACK_REDIRECT_URI,
      }),
    });

    const data = (await response.json()) as SlackApiResponse;

    if (!data.ok) {
      throw new Error(`Slack OAuth error: ${data.error}`);
    }

    return {
      accessToken: data.access_token || '',
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      teamId: data.team?.id,
      teamName: data.team?.name,
      botUserId: data.bot_user_id,
    };
  },

  verifyWebhook(signature: string, timestamp: string, body: string): boolean {
    const signingSecret = SLACK_SIGNING_SECRET;
    if (!signingSecret || !signature || !timestamp) {
      return false;
    }

    // Check timestamp is within 5 minutes
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
    if (parseInt(timestamp, 10) < fiveMinutesAgo) {
      logger.warn('[Slack] Request timestamp too old');
      return false;
    }

    const sigBasestring = `v0:${timestamp}:${body}`;
    const expectedSignature = `v0=${createHmac('sha256', signingSecret)
      .update(sigBasestring)
      .digest('hex')}`;

    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    } catch {
      return false;
    }
  },
};

// =============================================================================
// OUTBOUND ADAPTER
// =============================================================================

const outboundAdapter: OutboundAdapter = {
  async send(message: OutgoingMessage): Promise<SendResult> {
    const botToken = SLACK_BOT_TOKEN;
    if (!botToken) {
      return { success: false, error: 'Slack bot token not configured' };
    }

    try {
      const payload: Record<string, unknown> = {
        channel: message.to,
      };

      // Add text content
      if (message.text) {
        payload.text = message.text;
      }

      // Add blocks
      if (message.blocks) {
        payload.blocks = message.blocks;
      }

      // Add thread
      if (message.threadId) {
        payload.thread_ts = message.threadId;
      }

      // Ephemeral messages use different endpoint
      const endpoint = message.ephemeral
        ? `${SLACK_API_BASE}/chat.postEphemeral`
        : `${SLACK_API_BASE}/chat.postMessage`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as SlackApiResponse;

      if (!data.ok) {
        return { success: false, error: data.error, raw: data };
      }

      return {
        success: true,
        messageId: data.ts,
        threadId: data.message?.thread_ts,
        raw: data,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[Slack] Failed to send message', { error: message });
      return { success: false, error: message };
    }
  },

  async edit(messageId: string, channelId: string, content: OutgoingMessage): Promise<SendResult> {
    const botToken = SLACK_BOT_TOKEN;
    if (!botToken) {
      return { success: false, error: 'Slack bot token not configured' };
    }

    try {
      const payload: Record<string, unknown> = {
        channel: channelId,
        ts: messageId,
      };

      if (content.text) {
        payload.text = content.text;
      }
      if (content.blocks) {
        payload.blocks = content.blocks;
      }

      const response = await fetch(`${SLACK_API_BASE}/chat.update`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as SlackApiResponse;

      if (!data.ok) {
        return { success: false, error: data.error, raw: data };
      }

      return { success: true, messageId: data.ts, raw: data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  async delete(messageId: string, channelId: string) {
    const botToken = SLACK_BOT_TOKEN;
    if (!botToken) {
      return { success: false, error: 'Slack bot token not configured' };
    }

    try {
      const response = await fetch(`${SLACK_API_BASE}/chat.delete`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channel: channelId, ts: messageId }),
      });

      const data = (await response.json()) as SlackApiResponse;
      return { success: data.ok, error: data.error };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  async react(messageId: string, channelId: string, emoji: string) {
    const botToken = SLACK_BOT_TOKEN;
    if (!botToken) {
      return { success: false };
    }

    try {
      const response = await fetch(`${SLACK_API_BASE}/reactions.add`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: channelId,
          timestamp: messageId,
          name: emoji.replace(/:/g, ''),
        }),
      });

      const data = (await response.json()) as SlackApiResponse;
      return { success: data.ok };
    } catch {
      return { success: false };
    }
  },

  async unreact(messageId: string, channelId: string, emoji: string) {
    const botToken = SLACK_BOT_TOKEN;
    if (!botToken) {
      return { success: false };
    }

    try {
      const response = await fetch(`${SLACK_API_BASE}/reactions.remove`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: channelId,
          timestamp: messageId,
          name: emoji.replace(/:/g, ''),
        }),
      });

      const data = (await response.json()) as SlackApiResponse;
      return { success: data.ok };
    } catch {
      return { success: false };
    }
  },
};

// =============================================================================
// INBOUND ADAPTER
// =============================================================================

const inboundAdapter: InboundAdapter = {
  parseMessage(payload: unknown): IncomingMessage | null {
    const data = payload as Record<string, unknown>;

    // Handle event callback
    if (data.type === 'event_callback') {
      const event = data.event as Record<string, unknown>;
      if (event?.type !== 'message' || event.subtype) {
        return null; // Not a regular message
      }

      return {
        id: event.ts as string,
        provider: 'slack',
        accountId: (data.team_id as string) || 'default',
        senderId: event.user as string,
        senderName: '', // Would need API call to resolve
        chatType: event.channel_type === 'im' ? 'direct' : 'channel',
        chatId: event.channel as string,
        threadId: event.thread_ts as string | undefined,
        text: event.text as string,
        timestamp: new Date(parseFloat(event.ts as string) * 1000),
        rawContent: payload,
      };
    }

    return null;
  },

  parseCommand(payload: unknown): SlashCommand | null {
    const data = payload as Record<string, unknown>;

    // Slack sends slash commands as form-encoded data
    if (!data.command) {
      return null;
    }

    const channelType =
      (data.channel_name as string) === 'directmessage'
        ? 'direct'
        : (data.channel_name as string)?.startsWith('G')
          ? 'group'
          : 'channel';

    return {
      provider: 'slack',
      accountId: (data.team_id as string) || 'default',
      command: data.command as string,
      text: (data.text as string) || '',
      userId: data.user_id as string,
      userName: data.user_name as string,
      channelId: data.channel_id as string,
      channelName: data.channel_name as string,
      chatType: channelType,
      responseUrl: data.response_url as string,
      triggerId: data.trigger_id as string,
      raw: payload,
    };
  },

  parseAction(payload: unknown): InteractiveAction | null {
    const data = payload as Record<string, unknown>;

    if (data.type !== 'block_actions' && data.type !== 'view_submission') {
      return null;
    }

    const actions = data.actions as Array<Record<string, unknown>> | undefined;
    const action = actions?.[0];
    const user = data.user as Record<string, unknown>;
    const channel = data.channel as Record<string, unknown> | undefined;
    const message = data.message as Record<string, unknown> | undefined;

    return {
      provider: 'slack',
      accountId: (data.team as Record<string, unknown>)?.id as string || 'default',
      type: action?.type === 'button' ? 'button' : 'select',
      actionId: action?.action_id as string,
      value: action?.value as string,
      userId: user?.id as string,
      userName: user?.name as string || user?.username as string,
      channelId: channel?.id as string,
      messageId: message?.ts as string,
      threadId: message?.thread_ts as string,
      responseUrl: data.response_url as string,
      triggerId: data.trigger_id as string,
      raw: payload,
    };
  },

  buildCommandResponse(response: CommandResponse): unknown {
    const slackResponse: Record<string, unknown> = {
      response_type: response.responseType,
    };

    if (response.text) {
      slackResponse.text = response.text;
    }

    if (response.blocks) {
      slackResponse.blocks = response.blocks;
    }

    if (response.attachments) {
      slackResponse.attachments = response.attachments;
    }

    return slackResponse;
  },

  buildActionResponse(response: CommandResponse): unknown {
    return this.buildCommandResponse(response);
  },
};

// =============================================================================
// STATUS ADAPTER
// =============================================================================

const statusAdapter: StatusAdapter = {
  isConfigured(config: SlackAccountConfig): boolean {
    // Need either bot token or OAuth configured
    return !!(
      config.botToken ||
      SLACK_BOT_TOKEN ||
      (SLACK_CLIENT_ID && SLACK_CLIENT_SECRET)
    );
  },

  async checkHealth(config: SlackAccountConfig) {
    const botToken = config.botToken || SLACK_BOT_TOKEN;
    if (!botToken) {
      return { connected: false, error: 'No bot token configured' };
    }

    const startTime = Date.now();

    try {
      const response = await fetch(`${SLACK_API_BASE}/auth.test`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json',
        },
      });

      const latencyMs = Date.now() - startTime;
      const data = (await response.json()) as SlackApiResponse;

      if (!data.ok) {
        return {
          connected: false,
          latencyMs,
          error: data.error,
          details: { team: data.team, user: data.user },
        };
      }

      return {
        connected: true,
        latencyMs,
        details: {
          team: data.team,
          teamId: data.team_id,
          user: data.user,
          userId: data.user_id,
          botId: data.bot_id,
        },
      };
    } catch (error) {
      return {
        connected: false,
        latencyMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

// =============================================================================
// PROVIDER EXPORT
// =============================================================================

export const slackProvider: ChatProvider<SlackAccountConfig> = {
  meta,
  capabilities,
  defaultConfig: {
    provider: 'slack',
    mode: 'http',
    enabled: true,
  },
  configSchema: SlackAccountConfigSchema,
  auth: authAdapter,
  outbound: outboundAdapter,
  inbound: inboundAdapter,
  status: statusAdapter,
};

// =============================================================================
// HELPER EXPORTS
// =============================================================================

export { SlackAccountConfigSchema };
export type { SlackAccountConfig };
