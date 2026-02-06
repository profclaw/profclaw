/**
 * Sessions List Tool
 *
 * Lists active chat sessions with filtering and stats.
 * Inspired by OpenClaw's sessions_list tool.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import {
  listConversations,
  getRecentConversationsWithPreview,
  getConversationMessages,
  type Conversation,
} from '../../conversations.js';

// Chat mode type (for future use)
type ChatMode = 'chat' | 'agentic';

// =============================================================================
// Schema
// =============================================================================

const SessionsListParamsSchema = z.object({
  limit: z.number().min(1).max(50).optional().default(10)
    .describe('Maximum number of sessions to return (1-50, default 10)'),
  includePreview: z.boolean().optional().default(true)
    .describe('Include last message preview for each session'),
  mode: z.enum(['chat', 'agentic', 'all']).optional().default('all')
    .describe('Filter by session mode: chat (conversational), agentic (autonomous), or all'),
  projectId: z.string().optional()
    .describe('Filter sessions by project ID'),
  ticketId: z.string().optional()
    .describe('Filter sessions by ticket ID'),
});

export type SessionsListParams = z.infer<typeof SessionsListParamsSchema>;

// =============================================================================
// Tool Definition
// =============================================================================

export interface SessionInfo {
  id: string;
  title: string;
  mode: ChatMode;
  messageCount: number;
  preview?: string;
  projectId?: string;
  ticketId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionsListResult {
  sessions: SessionInfo[];
  total: number;
  currentSessionId?: string;
  message: string;
}

export const sessionsListTool: ToolDefinition<SessionsListParams, SessionsListResult> = {
  name: 'sessions_list',
  description: `List active chat sessions with optional filtering.

Use this tool to:
- See all recent conversations
- Find sessions by project or ticket
- Get session counts and previews
- Help users navigate between conversations

Returns session IDs that can be used with other session tools.`,
  category: 'system',
  securityLevel: 'safe',
  allowedHosts: ['gateway', 'local'],
  parameters: SessionsListParamsSchema,
  examples: [
    { description: 'List recent sessions', params: {} },
    { description: 'List agentic sessions only', params: { mode: 'agentic', limit: 5 } },
    { description: 'Find sessions for a project', params: { projectId: 'proj_123' } },
  ],

  async execute(context: ToolExecutionContext, params: SessionsListParams): Promise<ToolResult<SessionsListResult>> {
    try {
      const currentSessionId = context.conversationId;

      // Fetch sessions based on filters
      let sessions: SessionInfo[];
      let total: number;

      if (params.includePreview) {
        // Use the preview query for better performance
        const result = await getRecentConversationsWithPreview(params.limit);

        // Apply additional filters
        let filtered = result;

        // Mode filter disabled - conversations don't have mode property yet
        if (params.projectId) {
          filtered = filtered.filter(s => s.projectId === params.projectId);
        }
        if (params.ticketId) {
          filtered = filtered.filter(s => s.ticketId === params.ticketId);
        }

        sessions = filtered.map(s => ({
          id: s.id,
          title: s.title,
          mode: 'chat' as ChatMode, // Default mode until conversations support it
          messageCount: s.messageCount,
          preview: s.preview,
          projectId: s.projectId,
          ticketId: s.ticketId,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        }));
        total = sessions.length;
      } else {
        // Use basic list query
        const result = await listConversations({
          limit: params.limit,
          ticketId: params.ticketId,
        });

        // Apply filters
        let filtered = result.conversations;
        // Mode filter disabled - conversations don't have mode property yet
        if (params.projectId) {
          filtered = filtered.filter(s => s.projectId === params.projectId);
        }

        sessions = filtered.map(s => ({
          id: s.id,
          title: s.title,
          mode: 'chat' as ChatMode, // Default mode until conversations support it
          messageCount: 0, // Not available without preview query
          projectId: s.projectId,
          ticketId: s.ticketId,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        }));
        total = result.total;
      }

      // Build human-readable output
      const lines: string[] = ['## Active Sessions\n'];

      if (sessions.length === 0) {
        lines.push('No sessions found matching your criteria.');
      } else {
        // Mark current session
        for (const session of sessions) {
          const isCurrent = session.id === currentSessionId;
          const modeEmoji = session.mode === 'agentic' ? '🤖' : '💬';
          const currentMarker = isCurrent ? ' ← **current**' : '';

          lines.push(`### ${modeEmoji} ${session.title}${currentMarker}`);
          lines.push(`- **ID**: \`${session.id.slice(0, 8)}...\``);
          lines.push(`- **Mode**: ${session.mode}`);
          if (session.messageCount > 0) {
            lines.push(`- **Messages**: ${session.messageCount}`);
          }
          if (session.preview) {
            const truncated = session.preview.length > 60
              ? session.preview.slice(0, 60) + '...'
              : session.preview;
            lines.push(`- **Last**: "${truncated}"`);
          }
          if (session.projectId) {
            lines.push(`- **Project**: ${session.projectId}`);
          }
          if (session.ticketId) {
            lines.push(`- **Ticket**: ${session.ticketId}`);
          }
          lines.push(`- **Updated**: ${new Date(session.updatedAt).toLocaleString()}`);
          lines.push('');
        }

        lines.push(`---\n*Showing ${sessions.length} of ${total} sessions*`);
      }

      return {
        success: true,
        data: {
          sessions,
          total,
          currentSessionId,
          message: lines.join('\n'),
        },
        output: lines.join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'LIST_SESSIONS_ERROR',
          message: `Failed to list sessions: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  },
};
