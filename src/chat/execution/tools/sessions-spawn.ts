/**
 * Sessions Spawn Tool
 *
 * Spawns a new chat session (conversation) with optional initial task.
 * Inspired by OpenClaw's sessions_spawn tool for cross-session orchestration.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import {
  createConversation,
  addMessage,
} from '../../conversations.js';

// Schema

const SessionsSpawnParamsSchema = z.object({
  title: z.string().optional()
    .describe('Title for the new session (auto-generated from task if not provided)'),
  task: z.string().optional()
    .describe('Initial task or message to send to the new session'),
  presetId: z.string().optional().default('profclaw-assistant')
    .describe('Preset ID for the session (profclaw-assistant, code-assistant, etc.)'),
  projectId: z.string().optional()
    .describe('Link session to a project'),
  ticketId: z.string().optional()
    .describe('Link session to a ticket'),
  taskId: z.string().optional()
    .describe('Link session to a task'),
  mode: z.enum(['chat', 'agentic']).optional().default('chat')
    .describe('Session mode: chat (conversational) or agentic (autonomous)'),
  metadata: z.record(z.string()).optional()
    .describe('Additional metadata to attach to the session'),
});

export type SessionsSpawnParams = z.infer<typeof SessionsSpawnParamsSchema>;

// Types

export interface SessionsSpawnResult {
  sessionId: string;
  title: string;
  mode: string;
  projectId?: string;
  ticketId?: string;
  taskId?: string;
  createdAt: string;
  initialMessageId?: string;
  message: string;
}

// Tool Definition

export const sessionsSpawnTool: ToolDefinition<SessionsSpawnParams, SessionsSpawnResult> = {
  name: 'sessions_spawn',
  description: `Spawn a new chat session for parallel or delegated work.

Use this tool to:
- Create a dedicated session for a subtask
- Delegate work to a parallel conversation
- Organize work into separate contexts
- Spawn agentic sessions for autonomous tasks

The new session can optionally start with an initial task/message.
Returns the session ID for use with sessions_send or sessions_list.`,
  category: 'system',
  securityLevel: 'safe',
  allowedHosts: ['gateway', 'local'],
  parameters: SessionsSpawnParamsSchema,
  examples: [
    {
      description: 'Spawn a basic session',
      params: { title: 'Code Review Session' }
    },
    {
      description: 'Spawn with initial task',
      params: {
        title: 'Bug Investigation',
        task: 'Investigate the memory leak in the worker process',
        mode: 'agentic',
      }
    },
    {
      description: 'Spawn linked to ticket',
      params: {
        ticketId: 'PC-123',
        task: 'Implement the feature described in this ticket',
      }
    },
  ],

  async execute(context: ToolExecutionContext, params: SessionsSpawnParams): Promise<ToolResult<SessionsSpawnResult>> {
    try {
      // Generate title from task if not provided
      const title = params.title || (params.task
        ? params.task.slice(0, 50) + (params.task.length > 50 ? '...' : '')
        : 'New Session');

      // Create the conversation
      const conversation = await createConversation({
        title,
        presetId: params.presetId,
        projectId: params.projectId,
        ticketId: params.ticketId,
        taskId: params.taskId,
      });

      let initialMessageId: string | undefined;

      // Add initial task as a user message if provided
      if (params.task) {
        const message = await addMessage({
          conversationId: conversation.id,
          role: 'user',
          content: params.task,
        });
        initialMessageId = message.id;
      }

      // Build human-readable output
      const lines: string[] = [
        '## Session Spawned\n',
        `**Session ID**: \`${conversation.id}\``,
        `**Title**: ${title}`,
        `**Mode**: ${params.mode || 'chat'}`,
      ];

      if (params.projectId) {
        lines.push(`**Project**: ${params.projectId}`);
      }
      if (params.ticketId) {
        lines.push(`**Ticket**: ${params.ticketId}`);
      }
      if (params.taskId) {
        lines.push(`**Task**: ${params.taskId}`);
      }
      if (params.task) {
        lines.push(`\n**Initial Task**: "${params.task.slice(0, 100)}${params.task.length > 100 ? '...' : ''}"`);
      }

      lines.push(`\n*Use \`sessions_send\` with session ID \`${conversation.id.slice(0, 8)}...\` to send messages to this session.*`);

      return {
        success: true,
        data: {
          sessionId: conversation.id,
          title,
          mode: params.mode || 'chat',
          projectId: params.projectId,
          ticketId: params.ticketId,
          taskId: params.taskId,
          createdAt: conversation.createdAt,
          initialMessageId,
          message: lines.join('\n'),
        },
        output: lines.join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'SPAWN_SESSION_ERROR',
          message: `Failed to spawn session: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  },
};
