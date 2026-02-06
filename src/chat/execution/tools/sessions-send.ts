/**
 * Sessions Send Tool
 *
 * Sends a message to an existing session and optionally waits for response.
 * Inspired by OpenClaw's sessions_send tool for cross-session messaging.
 */

import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import {
  getConversation,
  getConversationMessages,
  addMessage,
} from '../../conversations.js';
import { aiProvider, type ChatMessage } from '../../../providers/index.js';
import { buildSystemPrompt, type ChatContext } from '../../system-prompts.js';
import { getSessionModel } from './session-status.js';

// =============================================================================
// Schema
// =============================================================================

const SessionsSendParamsSchema = z.object({
  sessionId: z.string()
    .describe('ID of the target session to send the message to'),
  message: z.string()
    .describe('The message content to send'),
  waitForResponse: z.boolean().optional().default(true)
    .describe('Wait for AI response before returning (default: true)'),
  model: z.string().optional()
    .describe('Override the model for this message'),
  temperature: z.number().min(0).max(2).optional()
    .describe('Temperature for response generation'),
  maxTokens: z.number().positive().optional()
    .describe('Maximum tokens for response'),
});

export type SessionsSendParams = z.infer<typeof SessionsSendParamsSchema>;

// =============================================================================
// Types
// =============================================================================

export interface SessionsSendResult {
  sessionId: string;
  userMessageId: string;
  assistantMessageId?: string;
  response?: string;
  model?: string;
  provider?: string;
  tokenUsage?: {
    prompt: number;
    completion: number;
    total: number;
  };
  message: string;
}

// =============================================================================
// Tool Definition
// =============================================================================

export const sessionsSendTool: ToolDefinition<SessionsSendParams, SessionsSendResult> = {
  name: 'sessions_send',
  description: `Send a message to an existing chat session.

Use this tool to:
- Continue work in a spawned session
- Delegate tasks to other sessions
- Coordinate between parallel sessions
- Query results from other sessions

By default, waits for the AI response. Set waitForResponse=false to send
without waiting (useful for fire-and-forget tasks).`,
  category: 'system',
  securityLevel: 'moderate', // Can trigger AI responses
  allowedHosts: ['gateway', 'local'],
  parameters: SessionsSendParamsSchema,
  examples: [
    {
      description: 'Send message and wait for response',
      params: {
        sessionId: 'abc123...',
        message: 'What is the status of the code review?',
      }
    },
    {
      description: 'Fire-and-forget task delegation',
      params: {
        sessionId: 'def456...',
        message: 'Start running the test suite',
        waitForResponse: false,
      }
    },
    {
      description: 'Query with specific model',
      params: {
        sessionId: 'ghi789...',
        message: 'Analyze this error log and suggest fixes',
        model: 'claude-sonnet-4-5-20250929',
      }
    },
  ],

  async execute(context: ToolExecutionContext, params: SessionsSendParams): Promise<ToolResult<SessionsSendResult>> {
    try {
      // Get the target conversation
      const conversation = await getConversation(params.sessionId);
      if (!conversation) {
        return {
          success: false,
          error: {
            code: 'SESSION_NOT_FOUND',
            message: `Session ${params.sessionId} not found`,
          },
        };
      }

      // Add user message to the conversation
      const userMessage = await addMessage({
        conversationId: params.sessionId,
        role: 'user',
        content: params.message,
      });

      // If not waiting for response, return immediately
      if (!params.waitForResponse) {
        const lines = [
          '## Message Sent\n',
          `**Session**: \`${params.sessionId.slice(0, 8)}...\``,
          `**Message ID**: \`${userMessage.id}\``,
          `**Content**: "${params.message.slice(0, 100)}${params.message.length > 100 ? '...' : ''}"`,
          '\n*Response not awaited (fire-and-forget mode)*',
        ];

        return {
          success: true,
          data: {
            sessionId: params.sessionId,
            userMessageId: userMessage.id,
            message: lines.join('\n'),
          },
          output: lines.join('\n'),
        };
      }

      // Get existing messages for context
      const existingMessages = await getConversationMessages(params.sessionId);

      // Build chat messages array (excluding the user message we just added since it's already there)
      const chatMessages: ChatMessage[] = existingMessages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.createdAt,
      }));

      // Build context
      const chatContext: ChatContext = {};

      // Add runtime info
      const sessionOverride = getSessionModel(params.sessionId);
      const defaultProvider = aiProvider.getDefaultProvider();
      const resolvedRef = aiProvider.resolveModel(sessionOverride || params.model || defaultProvider);
      chatContext.runtime = {
        model: `${resolvedRef.provider}/${resolvedRef.model}`,
        provider: resolvedRef.provider,
        defaultModel: `${defaultProvider}/${resolvedRef.model}`,
        conversationId: params.sessionId,
        sessionOverride,
      };

      // Build system prompt
      const systemPrompt = await buildSystemPrompt(conversation.presetId, chatContext);

      // Send to AI
      const response = await aiProvider.chat({
        messages: chatMessages,
        model: params.model,
        systemPrompt,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
      });

      // Save assistant response
      const assistantMessage = await addMessage({
        conversationId: params.sessionId,
        role: 'assistant',
        content: response.content,
        model: response.model,
        provider: response.provider,
        tokenUsage: response.usage
          ? {
              prompt: response.usage.promptTokens,
              completion: response.usage.completionTokens,
              total: response.usage.totalTokens,
            }
          : undefined,
        cost: response.usage?.cost,
      });

      // Build human-readable output
      const lines = [
        '## Message Sent & Response Received\n',
        `**Session**: \`${params.sessionId.slice(0, 8)}...\` (${conversation.title})`,
        `**Model**: ${response.provider}/${response.model}`,
        '',
        '### Your Message',
        `> ${params.message.slice(0, 200)}${params.message.length > 200 ? '...' : ''}`,
        '',
        '### Response',
        response.content.length > 500
          ? response.content.slice(0, 500) + '\n\n*[truncated - full response saved to session]*'
          : response.content,
      ];

      if (response.usage) {
        lines.push('', `*Tokens: ${response.usage.totalTokens}*`);
      }

      return {
        success: true,
        data: {
          sessionId: params.sessionId,
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
          response: response.content,
          model: response.model,
          provider: response.provider,
          tokenUsage: response.usage
            ? {
                prompt: response.usage.promptTokens,
                completion: response.usage.completionTokens,
                total: response.usage.totalTokens,
              }
            : undefined,
          message: lines.join('\n'),
        },
        output: lines.join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'SEND_MESSAGE_ERROR',
          message: `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  },
};
