/**
 * Telegram Actions Tool
 *
 * Perform Telegram admin commands via the Telegram Bot API.
 * Requires TELEGRAM_BOT_TOKEN environment variable.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import { logger } from '../../../utils/logger.js';

// Schema

const TelegramActionsParamsSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('pin_message'),
    chat_id: z.union([z.string(), z.number()]).describe('Chat ID (group, channel, or user)'),
    message_id: z.number().int().describe('Message ID to pin'),
    disable_notification: z.boolean().optional().default(false).describe('Pin silently without notification'),
  }),
  z.object({
    action: z.literal('create_poll'),
    chat_id: z.union([z.string(), z.number()]).describe('Chat ID to send poll to'),
    question: z.string().min(1).max(300).describe('Poll question'),
    options: z
      .array(z.string().min(1).max(100))
      .min(2)
      .max(10)
      .describe('Poll answer options (2-10)'),
    is_anonymous: z.boolean().optional().default(true).describe('Whether the poll is anonymous'),
    allows_multiple_answers: z.boolean().optional().default(false).describe('Allow multiple choice'),
    open_period: z
      .number()
      .int()
      .min(5)
      .max(600)
      .optional()
      .describe('Seconds the poll will be active (5-600)'),
  }),
  z.object({
    action: z.literal('ban_user'),
    chat_id: z.union([z.string(), z.number()]).describe('Chat/group ID'),
    user_id: z.number().int().describe('User ID to ban'),
    until_date: z
      .number()
      .int()
      .optional()
      .describe('Unix timestamp for ban expiry (0 or empty = permanent)'),
    revoke_messages: z.boolean().optional().default(false).describe('Delete all user messages'),
  }),
  z.object({
    action: z.literal('restrict_user'),
    chat_id: z.union([z.string(), z.number()]).describe('Chat/group ID'),
    user_id: z.number().int().describe('User ID to restrict'),
    until_date: z.number().int().optional().describe('Unix timestamp when restriction ends'),
    can_send_messages: z.boolean().optional().default(false),
    can_send_media: z.boolean().optional().default(false),
    can_send_polls: z.boolean().optional().default(false),
    can_add_web_page_previews: z.boolean().optional().default(false),
  }),
  z.object({
    action: z.literal('set_chat_title'),
    chat_id: z.union([z.string(), z.number()]).describe('Chat/group/channel ID'),
    title: z.string().min(1).max(255).describe('New chat title'),
  }),
  z.object({
    action: z.literal('set_chat_description'),
    chat_id: z.union([z.string(), z.number()]).describe('Chat/group/channel ID'),
    description: z.string().max(255).describe('New chat description (empty string to remove)'),
  }),
]);

export type TelegramActionsParams = z.infer<typeof TelegramActionsParamsSchema>;

// Types

export interface TelegramActionsResult {
  action: string;
  ok: boolean;
  details: Record<string, unknown>;
}

// Helpers

interface TelegramApiResponse {
  ok: boolean;
  result?: unknown;
  error_code?: number;
  description?: string;
}

async function telegramRequest(
  method: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<TelegramApiResponse> {
  const botToken = token ?? process.env.TELEGRAM_BOT_TOKEN ?? '';

  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as TelegramApiResponse;
  return data;
}

function telegramErrorMessage(res: TelegramApiResponse): string {
  return `Telegram API error ${res.error_code ?? 0}: ${res.description ?? 'Unknown error'}`;
}

// Tool Definition

export const telegramActionsTool: ToolDefinition<TelegramActionsParams, TelegramActionsResult> = {
  name: 'telegram_actions',
  description: `Perform Telegram admin commands in groups and channels.

Available actions:
- **pin_message**: Pin a message in a chat
- **create_poll**: Send a poll to a chat
- **ban_user**: Ban a user from a group (dangerous - requires approval)
- **restrict_user**: Restrict user permissions (mute, limit media, etc.)
- **set_chat_title**: Change the title of a group or channel
- **set_chat_description**: Update the group/channel description

Requires TELEGRAM_BOT_TOKEN environment variable and bot must be an admin.`,
  category: 'custom',
  securityLevel: 'dangerous',
  requiresApproval: true,
  parameters: TelegramActionsParamsSchema,

  isAvailable() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      return {
        available: false,
        reason: 'TELEGRAM_BOT_TOKEN is not set. Configure Telegram integration in Settings.',
      };
    }
    return { available: true };
  },

  examples: [
    {
      description: 'Pin an important announcement',
      params: {
        action: 'pin_message',
        chat_id: '-100123456789',
        message_id: 42,
        disable_notification: false,
      },
    },
    {
      description: 'Create a vote poll',
      params: {
        action: 'create_poll',
        chat_id: '-100123456789',
        question: 'When should we schedule the next team sync?',
        options: ['Monday 10am', 'Tuesday 2pm', 'Wednesday 11am', 'Thursday 3pm'],
        is_anonymous: false,
      },
    },
    {
      description: 'Temporarily mute a user',
      params: {
        action: 'restrict_user',
        chat_id: '-100123456789',
        user_id: 987654321,
        can_send_messages: false,
        until_date: 1735689600,
      },
    },
  ],

  async execute(context: ToolExecutionContext, params: TelegramActionsParams): Promise<ToolResult<TelegramActionsResult>> {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token) {
      return {
        success: false,
        error: {
          code: 'NOT_CONFIGURED',
          message: 'TELEGRAM_BOT_TOKEN is not set. Configure Telegram integration in Settings.',
        },
      };
    }

    logger.info(`[TelegramActions] Executing action: ${params.action}`, {
      component: 'TelegramActions',
    });

    try {
      switch (params.action) {
        case 'pin_message': {
          const res = await telegramRequest(
            'pinChatMessage',
            {
              chat_id: params.chat_id,
              message_id: params.message_id,
              disable_notification: params.disable_notification ?? false,
            },
            token,
          );

          if (!res.ok) {
            return {
              success: false,
              error: { code: 'TELEGRAM_API_ERROR', message: telegramErrorMessage(res) },
            };
          }

          return {
            success: true,
            data: {
              action: 'pin_message',
              ok: true,
              details: { chat_id: params.chat_id, message_id: params.message_id },
            },
            output: `Message ${params.message_id} pinned in chat ${params.chat_id}${params.disable_notification ? ' (silent)' : ''}`,
          };
        }

        case 'create_poll': {
          const res = await telegramRequest(
            'sendPoll',
            {
              chat_id: params.chat_id,
              question: params.question,
              options: params.options,
              is_anonymous: params.is_anonymous ?? true,
              allows_multiple_answers: params.allows_multiple_answers ?? false,
              ...(params.open_period !== undefined && { open_period: params.open_period }),
            },
            token,
          );

          if (!res.ok) {
            return {
              success: false,
              error: { code: 'TELEGRAM_API_ERROR', message: telegramErrorMessage(res) },
            };
          }

          const resultData = res.result as Record<string, unknown> | undefined;

          return {
            success: true,
            data: {
              action: 'create_poll',
              ok: true,
              details: {
                chat_id: params.chat_id,
                question: params.question,
                options: params.options,
                message_id: resultData?.message_id,
              },
            },
            output: `Poll created in chat ${params.chat_id}: "${params.question}" (${params.options.length} options)`,
          };
        }

        case 'ban_user': {
          const res = await telegramRequest(
            'banChatMember',
            {
              chat_id: params.chat_id,
              user_id: params.user_id,
              ...(params.until_date !== undefined && { until_date: params.until_date }),
              revoke_messages: params.revoke_messages ?? false,
            },
            token,
          );

          if (!res.ok) {
            return {
              success: false,
              error: { code: 'TELEGRAM_API_ERROR', message: telegramErrorMessage(res) },
            };
          }

          logger.warn(`[TelegramActions] User banned: ${params.user_id} from chat ${params.chat_id}`, {
            component: 'TelegramActions',
          });

          const banUntil = params.until_date
            ? new Date(params.until_date * 1000).toISOString()
            : 'permanent';

          return {
            success: true,
            data: {
              action: 'ban_user',
              ok: true,
              details: {
                chat_id: params.chat_id,
                user_id: params.user_id,
                until_date: params.until_date,
                revoke_messages: params.revoke_messages ?? false,
              },
            },
            output: `User ${params.user_id} banned from chat ${params.chat_id} (${banUntil})${params.revoke_messages ? ', messages revoked' : ''}`,
          };
        }

        case 'restrict_user': {
          const permissions = {
            can_send_messages: params.can_send_messages ?? false,
            can_send_audios: params.can_send_media ?? false,
            can_send_documents: params.can_send_media ?? false,
            can_send_photos: params.can_send_media ?? false,
            can_send_videos: params.can_send_media ?? false,
            can_send_video_notes: params.can_send_media ?? false,
            can_send_voice_notes: params.can_send_media ?? false,
            can_send_polls: params.can_send_polls ?? false,
            can_add_web_page_previews: params.can_add_web_page_previews ?? false,
          };

          const res = await telegramRequest(
            'restrictChatMember',
            {
              chat_id: params.chat_id,
              user_id: params.user_id,
              permissions,
              ...(params.until_date !== undefined && { until_date: params.until_date }),
            },
            token,
          );

          if (!res.ok) {
            return {
              success: false,
              error: { code: 'TELEGRAM_API_ERROR', message: telegramErrorMessage(res) },
            };
          }

          const restrictUntil = params.until_date
            ? new Date(params.until_date * 1000).toISOString()
            : 'indefinitely';

          return {
            success: true,
            data: {
              action: 'restrict_user',
              ok: true,
              details: {
                chat_id: params.chat_id,
                user_id: params.user_id,
                permissions,
                until_date: params.until_date,
              },
            },
            output: `User ${params.user_id} restricted in chat ${params.chat_id} (until: ${restrictUntil})`,
          };
        }

        case 'set_chat_title': {
          const res = await telegramRequest(
            'setChatTitle',
            { chat_id: params.chat_id, title: params.title },
            token,
          );

          if (!res.ok) {
            return {
              success: false,
              error: { code: 'TELEGRAM_API_ERROR', message: telegramErrorMessage(res) },
            };
          }

          return {
            success: true,
            data: {
              action: 'set_chat_title',
              ok: true,
              details: { chat_id: params.chat_id, title: params.title },
            },
            output: `Chat ${params.chat_id} title updated to: "${params.title}"`,
          };
        }

        case 'set_chat_description': {
          const res = await telegramRequest(
            'setChatDescription',
            { chat_id: params.chat_id, description: params.description },
            token,
          );

          if (!res.ok) {
            return {
              success: false,
              error: { code: 'TELEGRAM_API_ERROR', message: telegramErrorMessage(res) },
            };
          }

          return {
            success: true,
            data: {
              action: 'set_chat_description',
              ok: true,
              details: { chat_id: params.chat_id, description: params.description },
            },
            output: params.description
              ? `Chat ${params.chat_id} description updated`
              : `Chat ${params.chat_id} description cleared`,
          };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[TelegramActions] Failed: ${message}`, { component: 'TelegramActions' });

      return {
        success: false,
        error: {
          code: 'TELEGRAM_ACTION_FAILED',
          message: `Telegram action failed: ${message}`,
          retryable: true,
        },
      };
    }
  },
};
