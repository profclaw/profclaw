/**
 * Slack Actions Tool
 *
 * Perform Slack channel management actions via the Slack Web API.
 * Requires SLACK_BOT_TOKEN environment variable.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import { logger } from '../../../utils/logger.js';

// Schema

const SlackActionsParamsSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('add_reaction'),
    channel: z.string().describe('Channel ID or name'),
    timestamp: z.string().describe('Message timestamp (ts) to react to'),
    name: z.string().describe('Emoji name without colons (e.g. "thumbsup")'),
  }),
  z.object({
    action: z.literal('pin_message'),
    channel: z.string().describe('Channel ID'),
    timestamp: z.string().describe('Message timestamp (ts) to pin'),
  }),
  z.object({
    action: z.literal('create_channel'),
    name: z.string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9-_]+$/, 'Channel names must be lowercase, no spaces (use - or _)')
      .describe('Channel name (lowercase, no spaces)'),
    is_private: z.boolean().optional().default(false).describe('Create as private channel'),
  }),
  z.object({
    action: z.literal('set_topic'),
    channel: z.string().describe('Channel ID'),
    topic: z.string().max(250).describe('New channel topic (max 250 chars)'),
  }),
  z.object({
    action: z.literal('invite_user'),
    channel: z.string().describe('Channel ID'),
    users: z
      .array(z.string())
      .min(1)
      .max(30)
      .describe('Array of user IDs to invite'),
  }),
  z.object({
    action: z.literal('archive_channel'),
    channel: z.string().describe('Channel ID to archive'),
  }),
]);

export type SlackActionsParams = z.infer<typeof SlackActionsParamsSchema>;

// Types

export interface SlackActionsResult {
  action: string;
  ok: boolean;
  details: Record<string, unknown>;
}

// Helpers

const SLACK_API_BASE = 'https://slack.com/api';

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  channel?: { id: string; name: string };
  [key: string]: unknown;
}

async function slackRequest(
  method: string,
  endpoint: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<SlackApiResponse> {
  const botToken = token ?? process.env.SLACK_BOT_TOKEN ?? '';

  const response = await fetch(`${SLACK_API_BASE}/${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${botToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });

  const data = (await response.json()) as SlackApiResponse;
  return data;
}

function slackErrorMessage(data: SlackApiResponse): string {
  return `Slack API error: ${data.error ?? 'unknown_error'}`;
}

// Tool Definition

export const slackActionsTool: ToolDefinition<SlackActionsParams, SlackActionsResult> = {
  name: 'slack_actions',
  description: `Perform Slack channel management actions.

Available actions:
- **add_reaction**: Add an emoji reaction to a message
- **pin_message**: Pin a message in a channel
- **create_channel**: Create a new public or private channel
- **set_topic**: Update a channel's topic
- **invite_user**: Invite one or more users to a channel
- **archive_channel**: Archive a channel (cannot be undone easily)

Requires SLACK_BOT_TOKEN environment variable with appropriate OAuth scopes.`,
  category: 'custom',
  securityLevel: 'moderate',
  requiresApproval: true,
  parameters: SlackActionsParamsSchema,

  isAvailable() {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) {
      return {
        available: false,
        reason: 'SLACK_BOT_TOKEN is not set. Configure Slack integration in Settings.',
      };
    }
    return { available: true };
  },

  examples: [
    {
      description: 'Add a thumbsup reaction to a message',
      params: {
        action: 'add_reaction',
        channel: 'C12345678',
        timestamp: '1234567890.123456',
        name: 'thumbsup',
      },
    },
    {
      description: 'Create a new project channel',
      params: {
        action: 'create_channel',
        name: 'project-phoenix',
        is_private: false,
      },
    },
    {
      description: 'Invite team members to a channel',
      params: {
        action: 'invite_user',
        channel: 'C12345678',
        users: ['U111AAA', 'U222BBB'],
      },
    },
  ],

  async execute(context: ToolExecutionContext, params: SlackActionsParams): Promise<ToolResult<SlackActionsResult>> {
    const token = process.env.SLACK_BOT_TOKEN;

    if (!token) {
      return {
        success: false,
        error: {
          code: 'NOT_CONFIGURED',
          message: 'SLACK_BOT_TOKEN is not set. Configure Slack integration in Settings.',
        },
      };
    }

    logger.info(`[SlackActions] Executing action: ${params.action}`, {
      component: 'SlackActions',
    });

    try {
      switch (params.action) {
        case 'add_reaction': {
          const res = await slackRequest(
            'POST',
            'reactions.add',
            { channel: params.channel, timestamp: params.timestamp, name: params.name },
            token,
          );

          if (!res.ok) {
            return {
              success: false,
              error: { code: 'SLACK_API_ERROR', message: slackErrorMessage(res) },
            };
          }

          return {
            success: true,
            data: {
              action: 'add_reaction',
              ok: true,
              details: { channel: params.channel, timestamp: params.timestamp, emoji: params.name },
            },
            output: `Reaction :${params.name}: added to message ${params.timestamp} in ${params.channel}`,
          };
        }

        case 'pin_message': {
          const res = await slackRequest(
            'POST',
            'pins.add',
            { channel: params.channel, timestamp: params.timestamp },
            token,
          );

          if (!res.ok) {
            return {
              success: false,
              error: { code: 'SLACK_API_ERROR', message: slackErrorMessage(res) },
            };
          }

          return {
            success: true,
            data: {
              action: 'pin_message',
              ok: true,
              details: { channel: params.channel, timestamp: params.timestamp },
            },
            output: `Message ${params.timestamp} pinned in channel ${params.channel}`,
          };
        }

        case 'create_channel': {
          const res = await slackRequest(
            'POST',
            'conversations.create',
            { name: params.name, is_private: params.is_private ?? false },
            token,
          );

          if (!res.ok) {
            return {
              success: false,
              error: { code: 'SLACK_API_ERROR', message: slackErrorMessage(res) },
            };
          }

          const channelId = res.channel?.id ?? 'unknown';
          const channelName = res.channel?.name ?? params.name;

          return {
            success: true,
            data: {
              action: 'create_channel',
              ok: true,
              details: {
                channel_id: channelId,
                name: channelName,
                is_private: params.is_private ?? false,
              },
            },
            output: `Channel #${channelName} created (ID: ${channelId}, ${params.is_private ? 'private' : 'public'})`,
          };
        }

        case 'set_topic': {
          const res = await slackRequest(
            'POST',
            'conversations.setTopic',
            { channel: params.channel, topic: params.topic },
            token,
          );

          if (!res.ok) {
            return {
              success: false,
              error: { code: 'SLACK_API_ERROR', message: slackErrorMessage(res) },
            };
          }

          return {
            success: true,
            data: {
              action: 'set_topic',
              ok: true,
              details: { channel: params.channel, topic: params.topic },
            },
            output: `Topic updated for channel ${params.channel}: "${params.topic}"`,
          };
        }

        case 'invite_user': {
          const res = await slackRequest(
            'POST',
            'conversations.invite',
            { channel: params.channel, users: params.users.join(',') },
            token,
          );

          if (!res.ok) {
            return {
              success: false,
              error: { code: 'SLACK_API_ERROR', message: slackErrorMessage(res) },
            };
          }

          return {
            success: true,
            data: {
              action: 'invite_user',
              ok: true,
              details: { channel: params.channel, users: params.users },
            },
            output: `Invited ${params.users.length} user(s) to channel ${params.channel}: ${params.users.join(', ')}`,
          };
        }

        case 'archive_channel': {
          const res = await slackRequest(
            'POST',
            'conversations.archive',
            { channel: params.channel },
            token,
          );

          if (!res.ok) {
            return {
              success: false,
              error: { code: 'SLACK_API_ERROR', message: slackErrorMessage(res) },
            };
          }

          logger.warn(`[SlackActions] Channel archived: ${params.channel}`, {
            component: 'SlackActions',
          });

          return {
            success: true,
            data: {
              action: 'archive_channel',
              ok: true,
              details: { channel: params.channel },
            },
            output: `Channel ${params.channel} has been archived`,
          };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[SlackActions] Failed: ${message}`, { component: 'SlackActions' });

      return {
        success: false,
        error: {
          code: 'SLACK_ACTION_FAILED',
          message: `Slack action failed: ${message}`,
          retryable: true,
        },
      };
    }
  },
};
