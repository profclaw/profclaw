/**
 * Session Spawn Tools
 *
 * Tools for spawning child sessions and inter-session messaging.
 * Enables parallel work through hierarchical agent sessions.
 *
 * Configuration is loaded from config/settings.yml with environment variable overrides.
 * See docs/SESSION_SPAWN.md for full documentation.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import { getAgentSessionManager } from '../session-spawn/manager.js';
import { getSessionSpawnConfig } from '../session-spawn/config.js';
import type {
  AgentSession,
  SessionMessage,
  MessageType,
} from '../session-spawn/types.js';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// spawn_session Tool
// =============================================================================

// Get config for schema defaults (loaded once at module init)
const config = getSessionSpawnConfig();

const SpawnSessionParamsSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .describe('Short name for the child session (e.g., "File Analyzer")'),
  goal: z
    .string()
    .min(1)
    .max(1000)
    .describe('Clear description of what this session should accomplish'),
  description: z
    .string()
    .max(500)
    .optional()
    .describe('Optional longer description of the session purpose'),
  maxSteps: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(config.defaultSteps)
    .describe(`Maximum number of tool calls allowed (default: ${config.defaultSteps})`),
  maxBudget: z
    .number()
    .int()
    .min(1000)
    .max(100_000)
    .default(config.defaultBudget)
    .describe(`Maximum token budget for this session (default: ${config.defaultBudget.toLocaleString()})`),
  allowedTools: z
    .array(z.string())
    .optional()
    .describe('List of tool names this session can use (null = all tools)'),
  disallowedTools: z
    .array(z.string())
    .optional()
    .describe('List of tool names this session cannot use'),
});

type SpawnSessionParams = z.infer<typeof SpawnSessionParamsSchema>;

interface SpawnSessionResult {
  sessionId: string;
  name: string;
  depth: number;
  maxSteps: number;
  maxBudget: number;
  status: string;
}

export const spawnSessionTool: ToolDefinition<SpawnSessionParams, SpawnSessionResult> = {
  name: 'spawn_session',
  description: `Create a child session to work on a subtask in parallel.

**USE CASES:**
- Analyze different parts of a codebase simultaneously
- Run independent investigations in parallel
- Delegate subtasks while continuing with other work

**CONSTRAINTS (configurable in settings.yml):**
- Max spawn depth: ${config.maxDepth} levels
- Max children per session: ${config.maxChildrenPerSession}
- Default budget: ${config.defaultBudget.toLocaleString()} tokens
- Default steps: ${config.defaultSteps}

**EXAMPLE:**
\`\`\`json
{
  "name": "Route Analyzer",
  "goal": "Analyze all route handlers in src/routes/ and report API patterns",
  "maxSteps": 15,
  "allowedTools": ["read_file", "search_files", "grep"]
}
\`\`\`

**AFTER SPAWNING:**
- The child session starts working autonomously
- Use \`list_sessions\` to check progress
- Use \`receive_messages\` to get results when child completes`,

  category: 'profclaw',
  securityLevel: 'moderate',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: SpawnSessionParamsSchema,
  examples: [
    {
      description: 'Spawn a session to analyze routes',
      params: {
        name: 'Route Analyzer',
        goal: 'Analyze src/routes/ directory and identify all API endpoints',
        maxSteps: 15,
      },
    },
    {
      description: 'Spawn a session with tool restrictions',
      params: {
        name: 'Code Reader',
        goal: 'Read and summarize the authentication implementation',
        allowedTools: ['read_file', 'search_files', 'grep'],
        disallowedTools: ['exec', 'write_file'],
      },
    },
  ],

  async execute(
    context: ToolExecutionContext,
    params: SpawnSessionParams
  ): Promise<ToolResult<SpawnSessionResult>> {
    try {
      const manager = getAgentSessionManager();

      // Get or create a root session for this conversation
      let parentSessionId = (context as any).sessionId;

      if (!parentSessionId) {
        // Create a root session if none exists
        const rootSession = await manager.createRootSession(
          context.conversationId,
          'Root Session',
          'Main conversation session'
        );
        parentSessionId = rootSession.id;
        // Store for future tool calls
        (context as any).sessionId = parentSessionId;
      }

      const session = await manager.spawn({
        parentSessionId,
        name: params.name,
        goal: params.goal,
        description: params.description,
        maxSteps: params.maxSteps,
        maxBudget: params.maxBudget,
        allowedTools: params.allowedTools,
        disallowedTools: params.disallowedTools,
      });

      logger.info(`[spawn_session] Created child session`, {
        sessionId: session.id,
        parentId: parentSessionId,
        name: params.name,
      });

      return {
        success: true,
        data: {
          sessionId: session.id,
          name: session.name,
          depth: session.depth,
          maxSteps: session.maxSteps,
          maxBudget: session.maxBudget,
          status: session.status,
        },
        output: `Created child session "${params.name}" (ID: ${session.id}) at depth ${session.depth}`,
      };
    } catch (error) {
      logger.error('[spawn_session] Failed to spawn session', error as Error);
      return {
        success: false,
        error: {
          code: 'SPAWN_FAILED',
          message: error instanceof Error ? error.message : 'Failed to spawn session',
          retryable: false,
        },
      };
    }
  },
};

// =============================================================================
// send_message Tool
// =============================================================================

const SendMessageParamsSchema = z.object({
  target: z
    .string()
    .describe('Target: "parent", "children", "siblings", or a specific session ID'),
  type: z
    .enum(['message', 'result', 'request', 'notification', 'error'])
    .default('message')
    .describe('Message type'),
  subject: z.string().max(200).optional().describe('Optional message subject'),
  content: z
    .record(z.any())
    .describe('Message content (JSON object with your data)'),
  priority: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(5)
    .describe('Priority 1-10 (10 = highest, default: 5)'),
  ttlMs: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Time-to-live in milliseconds (optional)'),
  replyToMessageId: z
    .string()
    .optional()
    .describe('ID of message this is replying to'),
});

type SendMessageParams = z.infer<typeof SendMessageParamsSchema>;

interface SendMessageResult {
  messagesSent: number;
  recipients: string[];
}

export const sendMessageTool: ToolDefinition<SendMessageParams, SendMessageResult> = {
  name: 'send_message',
  description: `Send a message to other sessions (parent, children, siblings, or specific ID).

**TARGETS:**
- \`"parent"\` - Send to parent session
- \`"children"\` - Broadcast to all child sessions
- \`"siblings"\` - Send to all sibling sessions
- \`"<session-id>"\` - Send to a specific session

**MESSAGE TYPES:**
- \`message\` - General communication
- \`result\` - Send task results back to parent
- \`request\` - Request information or action
- \`notification\` - Informational update
- \`error\` - Report an error

**EXAMPLE:**
\`\`\`json
{
  "target": "parent",
  "type": "result",
  "subject": "Analysis Complete",
  "content": {
    "filesAnalyzed": 15,
    "issues": ["Missing error handling in routes/auth.ts"],
    "summary": "Found 15 route handlers with 3 potential issues"
  },
  "priority": 8
}
\`\`\``,

  category: 'profclaw',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: SendMessageParamsSchema,
  examples: [
    {
      description: 'Send results to parent',
      params: {
        target: 'parent',
        type: 'result',
        subject: 'Task Complete',
        content: { summary: 'Analyzed 10 files', findings: [] },
      },
    },
    {
      description: 'Request help from siblings',
      params: {
        target: 'siblings',
        type: 'request',
        content: { need: 'analysis of test files', urgency: 'medium' },
        priority: 7,
      },
    },
  ],

  async execute(
    context: ToolExecutionContext,
    params: SendMessageParams
  ): Promise<ToolResult<SendMessageResult>> {
    try {
      const manager = getAgentSessionManager();
      const sessionId = (context as any).sessionId;

      if (!sessionId) {
        return {
          success: false,
          error: {
            code: 'NO_SESSION',
            message: 'No active session found. Spawn a session first.',
            retryable: false,
          },
        };
      }

      const messages = await manager.send({
        fromSessionId: sessionId,
        target: params.target as 'parent' | 'children' | 'siblings' | string,
        type: params.type as MessageType,
        subject: params.subject,
        content: params.content,
        priority: params.priority,
        ttlMs: params.ttlMs,
        replyToMessageId: params.replyToMessageId,
      });

      const recipients = messages.map((m) => m.toSessionId);

      return {
        success: true,
        data: {
          messagesSent: messages.length,
          recipients,
        },
        output:
          messages.length > 0
            ? `Sent ${messages.length} message(s) to: ${recipients.join(', ')}`
            : `No recipients found for target "${params.target}"`,
      };
    } catch (error) {
      logger.error('[send_message] Failed to send message', error as Error);
      return {
        success: false,
        error: {
          code: 'SEND_FAILED',
          message: error instanceof Error ? error.message : 'Failed to send message',
          retryable: true,
        },
      };
    }
  },
};

// =============================================================================
// receive_messages Tool
// =============================================================================

const ReceiveMessagesParamsSchema = z.object({
  types: z
    .array(z.enum(['message', 'result', 'request', 'notification', 'error']))
    .optional()
    .describe('Filter by message types (default: all types)'),
  fromSessionId: z.string().optional().describe('Filter by sender session ID'),
  minPriority: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe('Only get messages with priority >= this value'),
  markAsRead: z
    .boolean()
    .default(true)
    .describe('Mark fetched messages as read (default: true)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('Maximum messages to return (default: 20)'),
});

type ReceiveMessagesParams = z.infer<typeof ReceiveMessagesParamsSchema>;

interface ReceiveMessagesResult {
  messages: Array<{
    id: string;
    fromSessionId: string;
    type: string;
    subject?: string;
    content: Record<string, any>;
    priority: number;
    createdAt: string;
  }>;
  unreadCount: number;
}

export const receiveMessagesTool: ToolDefinition<
  ReceiveMessagesParams,
  ReceiveMessagesResult
> = {
  name: 'receive_messages',
  description: `Poll your mailbox for messages from other sessions.

**FILTERS:**
- \`types\` - Only get specific message types
- \`fromSessionId\` - Only from a specific sender
- \`minPriority\` - Only high-priority messages

**EXAMPLE:**
\`\`\`json
{
  "types": ["result"],
  "markAsRead": true,
  "limit": 10
}
\`\`\`

Returns messages sorted by priority (highest first), then by creation time.`,

  category: 'profclaw',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: ReceiveMessagesParamsSchema,
  examples: [
    {
      description: 'Get all unread results from children',
      params: {
        types: ['result'],
        markAsRead: true,
      },
    },
    {
      description: 'Peek at high-priority messages without marking read',
      params: {
        minPriority: 8,
        markAsRead: false,
        limit: 5,
      },
    },
  ],

  async execute(
    context: ToolExecutionContext,
    params: ReceiveMessagesParams
  ): Promise<ToolResult<ReceiveMessagesResult>> {
    try {
      const manager = getAgentSessionManager();
      const sessionId = (context as any).sessionId;

      if (!sessionId) {
        return {
          success: false,
          error: {
            code: 'NO_SESSION',
            message: 'No active session found.',
            retryable: false,
          },
        };
      }

      const messages = await manager.receive({
        sessionId,
        types: params.types as MessageType[] | undefined,
        fromSessionId: params.fromSessionId,
        minPriority: params.minPriority,
        markAsRead: params.markAsRead,
        limit: params.limit,
      });

      const unreadCount = await manager.getUnreadCount(sessionId);

      const formattedMessages = messages.map((m) => ({
        id: m.id,
        fromSessionId: m.fromSessionId,
        type: m.type,
        subject: m.subject,
        content: m.content,
        priority: m.priority,
        createdAt: m.createdAt.toISOString(),
      }));

      return {
        success: true,
        data: {
          messages: formattedMessages,
          unreadCount,
        },
        output:
          messages.length > 0
            ? `Received ${messages.length} message(s). ${unreadCount} unread remaining.`
            : `No messages found. ${unreadCount} unread in mailbox.`,
      };
    } catch (error) {
      logger.error('[receive_messages] Failed to receive messages', error as Error);
      return {
        success: false,
        error: {
          code: 'RECEIVE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to receive messages',
          retryable: true,
        },
      };
    }
  },
};

// =============================================================================
// list_sessions Tool
// =============================================================================

const ListSessionsParamsSchema = z.object({
  scope: z
    .enum(['children', 'siblings', 'all'])
    .default('children')
    .describe('Which sessions to list (default: children)'),
  includeCompleted: z
    .boolean()
    .default(true)
    .describe('Include completed sessions (default: true)'),
});

type ListSessionsParams = z.infer<typeof ListSessionsParamsSchema>;

interface ListSessionsResult {
  sessions: Array<{
    id: string;
    name: string;
    status: string;
    depth: number;
    currentStep: number;
    maxSteps: number;
    usedBudget: number;
    maxBudget: number;
    createdAt: string;
    completedAt?: string;
    stopReason?: string;
  }>;
  summary: {
    total: number;
    running: number;
    completed: number;
    failed: number;
  };
}

export const listSessionsTool: ToolDefinition<ListSessionsParams, ListSessionsResult> = {
  name: 'list_sessions',
  description: `List child or sibling sessions to check their status and progress.

**SCOPES:**
- \`"children"\` - Your spawned child sessions (default)
- \`"siblings"\` - Sessions spawned by the same parent
- \`"all"\` - All sessions in this conversation

**USE CASES:**
- Monitor progress of child sessions
- Wait for child tasks to complete
- Get session IDs for direct messaging`,

  category: 'profclaw',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: ListSessionsParamsSchema,
  examples: [
    {
      description: 'List all child sessions',
      params: {
        scope: 'children',
        includeCompleted: true,
      },
    },
    {
      description: 'List only active siblings',
      params: {
        scope: 'siblings',
        includeCompleted: false,
      },
    },
  ],

  async execute(
    context: ToolExecutionContext,
    params: ListSessionsParams
  ): Promise<ToolResult<ListSessionsResult>> {
    try {
      const manager = getAgentSessionManager();
      const sessionId = (context as any).sessionId;

      if (!sessionId) {
        return {
          success: false,
          error: {
            code: 'NO_SESSION',
            message: 'No active session found.',
            retryable: false,
          },
        };
      }

      let sessions: AgentSession[];

      switch (params.scope) {
        case 'children':
          sessions = await manager.getChildren(sessionId);
          break;
        case 'siblings':
          sessions = await manager.getSiblings(sessionId);
          break;
        case 'all':
          sessions = await manager.getByConversation(context.conversationId);
          break;
        default:
          sessions = await manager.getChildren(sessionId);
      }

      // Filter completed if requested
      if (!params.includeCompleted) {
        sessions = sessions.filter(
          (s) => !['completed', 'failed', 'cancelled'].includes(s.status)
        );
      }

      const formattedSessions = sessions.map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        depth: s.depth,
        currentStep: s.currentStep,
        maxSteps: s.maxSteps,
        usedBudget: s.usedBudget,
        maxBudget: s.maxBudget,
        createdAt: s.createdAt.toISOString(),
        completedAt: s.completedAt?.toISOString(),
        stopReason: s.stopReason,
      }));

      const summary = {
        total: sessions.length,
        running: sessions.filter((s) => s.status === 'running').length,
        completed: sessions.filter((s) => s.status === 'completed').length,
        failed: sessions.filter((s) => ['failed', 'cancelled'].includes(s.status))
          .length,
      };

      return {
        success: true,
        data: {
          sessions: formattedSessions,
          summary,
        },
        output: `Found ${summary.total} session(s): ${summary.running} running, ${summary.completed} completed, ${summary.failed} failed`,
      };
    } catch (error) {
      logger.error('[list_sessions] Failed to list sessions', error as Error);
      return {
        success: false,
        error: {
          code: 'LIST_FAILED',
          message: error instanceof Error ? error.message : 'Failed to list sessions',
          retryable: true,
        },
      };
    }
  },
};

// =============================================================================
// Export all tools
// =============================================================================

export const sessionSpawnTools: ToolDefinition<any, any>[] = [
  spawnSessionTool,
  sendMessageTool,
  receiveMessagesTool,
  listSessionsTool,
];
