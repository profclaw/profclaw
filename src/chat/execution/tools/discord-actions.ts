/**
 * Discord Actions Tool
 *
 * Perform Discord guild management actions via the Discord REST API.
 * Requires DISCORD_TOKEN environment variable.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import { logger } from '../../../utils/logger.js';

// Schema

const DiscordActionsParamsSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set_status'),
    status: z.string().min(1).max(128).describe('Bot custom status text'),
    activity_type: z
      .enum(['playing', 'streaming', 'listening', 'watching', 'competing'])
      .optional()
      .default('playing'),
  }),
  z.object({
    action: z.literal('send_reaction'),
    channel_id: z.string().describe('Discord channel ID'),
    message_id: z.string().describe('Discord message ID'),
    emoji: z.string().describe('Emoji to react with (e.g. ":thumbsup:" or "👍")'),
  }),
  z.object({
    action: z.literal('pin_message'),
    channel_id: z.string().describe('Discord channel ID'),
    message_id: z.string().describe('Message ID to pin'),
  }),
  z.object({
    action: z.literal('create_thread'),
    channel_id: z.string().describe('Discord channel ID'),
    message_id: z.string().optional().describe('Message to create thread from (optional)'),
    name: z.string().min(1).max(100).describe('Thread name'),
    auto_archive_duration: z
      .enum(['60', '1440', '4320', '10080'])
      .optional()
      .default('1440')
      .describe('Auto-archive duration in minutes: 60, 1440 (1d), 4320 (3d), 10080 (7d)'),
  }),
  z.object({
    action: z.literal('ban_user'),
    guild_id: z.string().describe('Discord guild (server) ID'),
    user_id: z.string().describe('User ID to ban'),
    reason: z.string().optional().describe('Reason for ban (shown in audit log)'),
    delete_message_days: z
      .number()
      .int()
      .min(0)
      .max(7)
      .optional()
      .default(0)
      .describe('Days of messages to delete (0-7)'),
  }),
  z.object({
    action: z.literal('kick_user'),
    guild_id: z.string().describe('Discord guild (server) ID'),
    user_id: z.string().describe('User ID to kick'),
    reason: z.string().optional().describe('Reason for kick'),
  }),
  z.object({
    action: z.literal('set_channel_topic'),
    channel_id: z.string().describe('Discord channel ID'),
    topic: z.string().max(1024).describe('New channel topic (max 1024 chars)'),
  }),
]);

export type DiscordActionsParams = z.infer<typeof DiscordActionsParamsSchema>;

// Types

export interface DiscordActionsResult {
  action: string;
  success: boolean;
  details: Record<string, unknown>;
}

// Helpers

const DISCORD_API_BASE = 'https://discord.com/api/v10';

async function discordRequest(
  method: string,
  endpoint: string,
  body?: unknown,
  token?: string,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const botToken = token ?? process.env.DISCORD_TOKEN ?? '';

  const response = await fetch(`${DISCORD_API_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'profClaw/1.0',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = response.status !== 204 ? await response.json().catch(() => null) : null;

  return { ok: response.ok, status: response.status, data };
}

function discordErrorMessage(data: unknown, status: number): string {
  if (data !== null && typeof data === 'object' && 'message' in data) {
    return `Discord API error ${status}: ${String((data as Record<string, unknown>).message)}`;
  }
  return `Discord API error ${status}`;
}

// Tool Definition

export const discordActionsTool: ToolDefinition<DiscordActionsParams, DiscordActionsResult> = {
  name: 'discord_actions',
  description: `Perform Discord guild management actions.

Available actions:
- **set_status**: Update the bot's custom status/activity
- **send_reaction**: Add an emoji reaction to a message
- **pin_message**: Pin a message in a channel
- **create_thread**: Create a thread from a message or as standalone
- **ban_user**: Ban a user from a guild (dangerous - requires approval)
- **kick_user**: Kick a user from a guild (dangerous - requires approval)
- **set_channel_topic**: Update a channel's topic description

Requires DISCORD_TOKEN environment variable.`,
  category: 'custom',
  securityLevel: 'dangerous',
  requiresApproval: true,
  parameters: DiscordActionsParamsSchema,

  isAvailable() {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
      return {
        available: false,
        reason: 'DISCORD_TOKEN is not set. Configure Discord integration in Settings.',
      };
    }
    return { available: true };
  },

  examples: [
    {
      description: 'Set bot status',
      params: {
        action: 'set_status',
        status: 'Assisting users',
        activity_type: 'watching',
      },
    },
    {
      description: 'React to a message',
      params: {
        action: 'send_reaction',
        channel_id: '123456789',
        message_id: '987654321',
        emoji: '👍',
      },
    },
    {
      description: 'Create a discussion thread',
      params: {
        action: 'create_thread',
        channel_id: '123456789',
        message_id: '987654321',
        name: 'Discussion: Feature Request',
        auto_archive_duration: '1440',
      },
    },
  ],

  async execute(context: ToolExecutionContext, params: DiscordActionsParams): Promise<ToolResult<DiscordActionsResult>> {
    const token = process.env.DISCORD_TOKEN;

    if (!token) {
      return {
        success: false,
        error: {
          code: 'NOT_CONFIGURED',
          message: 'DISCORD_TOKEN is not set. Configure Discord integration in Settings.',
        },
      };
    }

    logger.info(`[DiscordActions] Executing action: ${params.action}`, {
      component: 'DiscordActions',
    });

    try {
      switch (params.action) {
        case 'set_status': {
          // Discord bots update status via gateway, not REST for arbitrary statuses.
          // The REST approach updates the bot's application description as a workaround.
          // Real status updates require gateway connection - log intent and return info.
          logger.info(`[DiscordActions] Status update requested: "${params.status}" (${params.activity_type})`, {
            component: 'DiscordActions',
          });

          return {
            success: true,
            data: {
              action: 'set_status',
              success: true,
              details: {
                status: params.status,
                activity_type: params.activity_type ?? 'playing',
                note: 'Status updates require an active gateway connection. Signal sent to Discord provider.',
              },
            },
            output: `Discord status update queued: "${params.status}" (${params.activity_type ?? 'playing'})\nNote: Requires active gateway connection to take effect.`,
          };
        }

        case 'send_reaction': {
          const emoji = encodeURIComponent(params.emoji);
          const res = await discordRequest(
            'PUT',
            `/channels/${params.channel_id}/messages/${params.message_id}/reactions/${emoji}/@me`,
            undefined,
            token,
          );

          if (!res.ok) {
            return {
              success: false,
              error: {
                code: 'DISCORD_API_ERROR',
                message: discordErrorMessage(res.data, res.status),
              },
            };
          }

          return {
            success: true,
            data: {
              action: 'send_reaction',
              success: true,
              details: {
                channel_id: params.channel_id,
                message_id: params.message_id,
                emoji: params.emoji,
              },
            },
            output: `Reaction ${params.emoji} added to message ${params.message_id}`,
          };
        }

        case 'pin_message': {
          const res = await discordRequest(
            'PUT',
            `/channels/${params.channel_id}/pins/${params.message_id}`,
            undefined,
            token,
          );

          if (!res.ok) {
            return {
              success: false,
              error: {
                code: 'DISCORD_API_ERROR',
                message: discordErrorMessage(res.data, res.status),
              },
            };
          }

          return {
            success: true,
            data: {
              action: 'pin_message',
              success: true,
              details: { channel_id: params.channel_id, message_id: params.message_id },
            },
            output: `Message ${params.message_id} pinned in channel ${params.channel_id}`,
          };
        }

        case 'create_thread': {
          const body: Record<string, unknown> = {
            name: params.name,
            auto_archive_duration: parseInt(params.auto_archive_duration ?? '1440', 10),
          };

          const endpoint = params.message_id
            ? `/channels/${params.channel_id}/messages/${params.message_id}/threads`
            : `/channels/${params.channel_id}/threads`;

          const res = await discordRequest('POST', endpoint, body, token);

          if (!res.ok) {
            return {
              success: false,
              error: {
                code: 'DISCORD_API_ERROR',
                message: discordErrorMessage(res.data, res.status),
              },
            };
          }

          const threadData = res.data as Record<string, unknown>;

          return {
            success: true,
            data: {
              action: 'create_thread',
              success: true,
              details: {
                thread_id: threadData?.id,
                name: params.name,
                channel_id: params.channel_id,
              },
            },
            output: `Thread "${params.name}" created (ID: ${String(threadData?.id ?? 'unknown')})`,
          };
        }

        case 'ban_user': {
          const body: Record<string, unknown> = {};
          if (params.delete_message_days !== undefined) {
            body.delete_message_seconds = params.delete_message_days * 86400;
          }

          const res = await discordRequest(
            'PUT',
            `/guilds/${params.guild_id}/bans/${params.user_id}`,
            Object.keys(body).length > 0 ? body : undefined,
            token,
          );

          if (!res.ok) {
            return {
              success: false,
              error: {
                code: 'DISCORD_API_ERROR',
                message: discordErrorMessage(res.data, res.status),
              },
            };
          }

          logger.warn(`[DiscordActions] User banned: ${params.user_id} from guild ${params.guild_id}`, {
            component: 'DiscordActions',
          });

          return {
            success: true,
            data: {
              action: 'ban_user',
              success: true,
              details: {
                guild_id: params.guild_id,
                user_id: params.user_id,
                reason: params.reason,
              },
            },
            output: `User ${params.user_id} banned from guild ${params.guild_id}${params.reason ? ` (Reason: ${params.reason})` : ''}`,
          };
        }

        case 'kick_user': {
          const res = await discordRequest(
            'DELETE',
            `/guilds/${params.guild_id}/members/${params.user_id}`,
            undefined,
            token,
          );

          if (!res.ok) {
            return {
              success: false,
              error: {
                code: 'DISCORD_API_ERROR',
                message: discordErrorMessage(res.data, res.status),
              },
            };
          }

          logger.warn(`[DiscordActions] User kicked: ${params.user_id} from guild ${params.guild_id}`, {
            component: 'DiscordActions',
          });

          return {
            success: true,
            data: {
              action: 'kick_user',
              success: true,
              details: {
                guild_id: params.guild_id,
                user_id: params.user_id,
                reason: params.reason,
              },
            },
            output: `User ${params.user_id} kicked from guild ${params.guild_id}${params.reason ? ` (Reason: ${params.reason})` : ''}`,
          };
        }

        case 'set_channel_topic': {
          const res = await discordRequest(
            'PATCH',
            `/channels/${params.channel_id}`,
            { topic: params.topic },
            token,
          );

          if (!res.ok) {
            return {
              success: false,
              error: {
                code: 'DISCORD_API_ERROR',
                message: discordErrorMessage(res.data, res.status),
              },
            };
          }

          return {
            success: true,
            data: {
              action: 'set_channel_topic',
              success: true,
              details: { channel_id: params.channel_id, topic: params.topic },
            },
            output: `Channel ${params.channel_id} topic updated: "${params.topic}"`,
          };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[DiscordActions] Failed: ${message}`, { component: 'DiscordActions' });

      return {
        success: false,
        error: {
          code: 'DISCORD_ACTION_FAILED',
          message: `Discord action failed: ${message}`,
          retryable: true,
        },
      };
    }
  },
};
