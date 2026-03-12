#!/usr/bin/env node
/**
 * profClaw MCP Server
 *
 * Model Context Protocol server for Claude Code integration.
 * Allows Claude Code to report task progress to profClaw with minimal token usage.
 *
 * Usage:
 *   npx @profclaw/task-manager-mcp
 *   OR
 *   node dist/mcp/server.js
 *
 * Claude Code settings.json:
 * {
 *   "mcpServers": {
 *     "profclaw": {
 *       "command": "npx",
 *       "args": ["@profclaw/task-manager-mcp"]
 *     }
 *   }
 * }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { BROWSER_TOOLS, handleBrowserTool } from './browser-tools.js';

// MCP Server configuration
const PROFCLAW_API_URL = process.env.PROFCLAW_API_URL || process.env.PROFCLAW_API_URL || 'http://localhost:3000';

// In-memory session state (MCP server is per-session)
interface SessionState {
  sessionId: string;
  startTime: Date;
  filesModified: string[];
  filesCreated: string[];
  tokenUsage: {
    input: number;
    output: number;
  };
  currentTask?: {
    id: string;
    title: string;
    startedAt: Date;
  };
}

const sessionState: SessionState = {
  sessionId: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  startTime: new Date(),
  filesModified: [],
  filesCreated: [],
  tokenUsage: {
    input: 0,
    output: 0,
  },
};

// Create MCP server
const server = new Server(
  {
    name: 'profclaw',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {
        listChanged: true,
      },
    },
  }
);

// Define available tools
const TOOLS = [
  {
    name: 'profclaw__log_task',
    description: 'Log current task progress to profClaw for tracking. Use this when starting work on a task or making significant progress.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taskId: {
          type: 'string',
          description: 'Optional task ID if tracking an existing task',
        },
        title: {
          type: 'string',
          description: 'Short title describing the current work',
        },
        summary: {
          type: 'string',
          description: 'Brief summary of what you are doing or have done',
        },
        filesChanged: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of files you have modified or created',
        },
      },
      required: ['title', 'summary'],
    },
  },
  {
    name: 'profclaw__complete_task',
    description: 'Mark a task as complete with a final summary. Use this when you finish working on a task.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taskId: {
          type: 'string',
          description: 'The task ID to complete',
        },
        summary: {
          type: 'string',
          description: 'Final summary of what was accomplished',
        },
        prUrl: {
          type: 'string',
          description: 'URL of the pull request if one was created',
        },
        filesChanged: {
          type: 'array',
          items: { type: 'string' },
          description: 'Final list of all files modified or created',
        },
      },
      required: ['summary'],
    },
  },
  {
    name: 'profclaw__report_usage',
    description: 'Report token usage for cost tracking. profClaw uses this to track AI costs.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        inputTokens: {
          type: 'number',
          description: 'Number of input tokens used',
        },
        outputTokens: {
          type: 'number',
          description: 'Number of output tokens used',
        },
        model: {
          type: 'string',
          description: 'Model name (e.g., claude-opus-4-5-20251101)',
        },
      },
      required: ['inputTokens', 'outputTokens', 'model'],
    },
  },
  {
    name: 'profclaw__get_context',
    description: 'Get relevant context from past tasks. Use this to find information about previous work on similar tasks.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query to find relevant past tasks',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 5)',
        },
      },
      required: ['query'],
    },
  },
  // --- Ticket Tools ---
  {
    name: 'profclaw__create_ticket',
    description: 'Create a new ticket in profClaw. Use this when you identify a new task, bug, or feature that needs to be tracked.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Title of the ticket',
        },
        description: {
          type: 'string',
          description: 'Detailed description of the ticket',
        },
        type: {
          type: 'string',
          enum: ['task', 'bug', 'feature', 'improvement', 'epic', 'story', 'subtask'],
          description: 'Type of ticket (default: task)',
        },
        priority: {
          type: 'string',
          enum: ['urgent', 'high', 'medium', 'low', 'none'],
          description: 'Priority level (default: medium)',
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Labels to categorize the ticket',
        },
        parentId: {
          type: 'string',
          description: 'Parent ticket ID for subtasks',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'profclaw__update_ticket',
    description: 'Update an existing ticket. Use this to modify ticket details.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ticketId: {
          type: 'string',
          description: 'The ticket ID to update (e.g., PC-123 or UUID)',
        },
        title: {
          type: 'string',
          description: 'New title for the ticket',
        },
        description: {
          type: 'string',
          description: 'New description for the ticket',
        },
        priority: {
          type: 'string',
          enum: ['urgent', 'high', 'medium', 'low', 'none'],
          description: 'New priority level',
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'New labels (replaces existing)',
        },
      },
      required: ['ticketId'],
    },
  },
  {
    name: 'profclaw__transition_ticket',
    description: 'Change the status of a ticket. Use this when starting, completing, or changing the state of work.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ticketId: {
          type: 'string',
          description: 'The ticket ID to transition',
        },
        status: {
          type: 'string',
          enum: ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'],
          description: 'New status for the ticket',
        },
      },
      required: ['ticketId', 'status'],
    },
  },
  {
    name: 'profclaw__get_ticket',
    description: 'Get details of a specific ticket. Use this to check ticket status or get context.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ticketId: {
          type: 'string',
          description: 'The ticket ID to retrieve',
        },
        include: {
          type: 'string',
          enum: ['comments', 'links', 'history', 'all'],
          description: 'Additional data to include (default: none)',
        },
      },
      required: ['ticketId'],
    },
  },
  {
    name: 'profclaw__list_tickets',
    description: 'List tickets with optional filtering. Use this to find tickets to work on or check progress.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          enum: ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'],
          description: 'Filter by status',
        },
        type: {
          type: 'string',
          enum: ['task', 'bug', 'feature', 'improvement', 'epic', 'story', 'subtask'],
          description: 'Filter by type',
        },
        priority: {
          type: 'string',
          enum: ['urgent', 'high', 'medium', 'low', 'none'],
          description: 'Filter by priority',
        },
        assignedToMe: {
          type: 'boolean',
          description: 'Only show tickets assigned to the current AI agent',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 20)',
        },
      },
    },
  },
  {
    name: 'profclaw__add_comment',
    description: 'Add a comment to a ticket. Use this to document progress, findings, or notes.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ticketId: {
          type: 'string',
          description: 'The ticket ID to comment on',
        },
        content: {
          type: 'string',
          description: 'The comment content (supports markdown)',
        },
      },
      required: ['ticketId', 'content'],
    },
  },
  {
    name: 'profclaw__assign_ticket',
    description: 'Assign a ticket to yourself (AI agent). Use this when starting work on a ticket.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ticketId: {
          type: 'string',
          description: 'The ticket ID to assign',
        },
        agent: {
          type: 'string',
          description: 'Agent ID to assign to (defaults to current session agent)',
        },
      },
      required: ['ticketId'],
    },
  },
];

// Combine all tools
const ALL_TOOLS = [...TOOLS, ...BROWSER_TOOLS];

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: ALL_TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'profclaw__log_task':
        return await handleLogTask(args as unknown as LogTaskArgs);

      case 'profclaw__complete_task':
        return await handleCompleteTask(args as unknown as CompleteTaskArgs);

      case 'profclaw__report_usage':
        return await handleReportUsage(args as unknown as ReportUsageArgs);

      case 'profclaw__get_context':
        return await handleGetContext(args as unknown as GetContextArgs);

      // Ticket tools
      case 'profclaw__create_ticket':
        return await handleCreateTicket(args as unknown as CreateTicketArgs);

      case 'profclaw__update_ticket':
        return await handleUpdateTicket(args as unknown as UpdateTicketArgs);

      case 'profclaw__transition_ticket':
        return await handleTransitionTicket(args as unknown as TransitionTicketArgs);

      case 'profclaw__get_ticket':
        return await handleGetTicket(args as unknown as GetTicketArgs);

      case 'profclaw__list_tickets':
        return await handleListTickets(args as unknown as ListTicketsArgs);

      case 'profclaw__add_comment':
        return await handleAddComment(args as unknown as AddCommentArgs);

      case 'profclaw__assign_ticket':
        return await handleAssignTicket(args as unknown as AssignTicketArgs);

      default: {
        // Try browser tools
        const browserResult = await handleBrowserTool(name, args);
        if (browserResult) {
          return browserResult;
        }

        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// Tool argument types
interface LogTaskArgs {
  taskId?: string;
  title: string;
  summary: string;
  filesChanged?: string[];
}

interface CompleteTaskArgs {
  taskId?: string;
  summary: string;
  prUrl?: string;
  filesChanged?: string[];
}

interface ReportUsageArgs {
  inputTokens: number;
  outputTokens: number;
  model: string;
}

interface GetContextArgs {
  query: string;
  limit?: number;
}

// Ticket argument types
interface CreateTicketArgs {
  title: string;
  description?: string;
  type?: 'task' | 'bug' | 'feature' | 'improvement' | 'epic' | 'story' | 'subtask';
  priority?: 'urgent' | 'high' | 'medium' | 'low' | 'none';
  labels?: string[];
  parentId?: string;
}

interface UpdateTicketArgs {
  ticketId: string;
  title?: string;
  description?: string;
  priority?: 'urgent' | 'high' | 'medium' | 'low' | 'none';
  labels?: string[];
}

interface TransitionTicketArgs {
  ticketId: string;
  status: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';
}

interface GetTicketArgs {
  ticketId: string;
  include?: 'comments' | 'links' | 'history' | 'all';
}

interface ListTicketsArgs {
  status?: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';
  type?: 'task' | 'bug' | 'feature' | 'improvement' | 'epic' | 'story' | 'subtask';
  priority?: 'urgent' | 'high' | 'medium' | 'low' | 'none';
  assignedToMe?: boolean;
  limit?: number;
}

interface AddCommentArgs {
  ticketId: string;
  content: string;
}

interface AssignTicketArgs {
  ticketId: string;
  agent?: string;
}

// Tool handlers
export async function handleLogTask(args: LogTaskArgs): Promise<CallToolResult> {
  // Update session state
  if (args.filesChanged) {
    for (const file of args.filesChanged) {
      if (!sessionState.filesModified.includes(file)) {
        sessionState.filesModified.push(file);
      }
    }
  }

  // Store current task
  sessionState.currentTask = {
    id: args.taskId || sessionState.sessionId,
    title: args.title,
    startedAt: new Date(),
  };

  // Try to report to profClaw API
  try {
    const response = await fetch(`${PROFCLAW_API_URL}/api/hook/tool-use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'PostToolUse',
        tool: 'profclaw__log_task',
        session_id: sessionState.sessionId,
        timestamp: new Date().toISOString(),
        input: args,
      }),
    });

    if (!response.ok) {
      console.error('[MCP] Failed to report to profClaw:', response.statusText);
    }
  } catch (error) {
    // Silently fail - don't block the agent
    console.error('[MCP] Failed to connect to profClaw:', error);
  }

  return {
    content: [
      {
        type: 'text',
        text: `Task logged: ${args.title}\nSession: ${sessionState.sessionId}\nFiles tracked: ${sessionState.filesModified.length}`,
      },
    ],
  };
}

export async function handleCompleteTask(args: CompleteTaskArgs): Promise<CallToolResult> {
  // Update session state
  if (args.filesChanged) {
    for (const file of args.filesChanged) {
      if (!sessionState.filesModified.includes(file)) {
        sessionState.filesModified.push(file);
      }
    }
  }

  const taskId = args.taskId || sessionState.currentTask?.id || sessionState.sessionId;

  // Try to report to profClaw API
  try {
    const response = await fetch(`${PROFCLAW_API_URL}/api/hook/session-end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'Stop',
        reason: 'completed',
        session_id: sessionState.sessionId,
        timestamp: new Date().toISOString(),
        summary: args.summary,
        files_changed: sessionState.filesModified,
        duration_ms: Date.now() - sessionState.startTime.getTime(),
      }),
    });

    if (!response.ok) {
      console.error('[MCP] Failed to report completion to profClaw:', response.statusText);
    }
  } catch (error) {
    console.error('[MCP] Failed to connect to profClaw:', error);
  }

  // Clear current task
  sessionState.currentTask = undefined;

  const prInfo = args.prUrl ? `\nPR: ${args.prUrl}` : '';
  return {
    content: [
      {
        type: 'text',
        text: `Task completed: ${taskId}\nSummary: ${args.summary}\nFiles modified: ${sessionState.filesModified.length}${prInfo}`,
      },
    ],
  };
}

async function handleReportUsage(args: ReportUsageArgs): Promise<CallToolResult> {
  // Accumulate token usage
  sessionState.tokenUsage.input += args.inputTokens;
  sessionState.tokenUsage.output += args.outputTokens;

  // Calculate approximate cost (simplified pricing)
  const cost = calculateCost(args.inputTokens, args.outputTokens, args.model);

  return {
    content: [
      {
        type: 'text',
        text: `Usage recorded:\nInput: ${args.inputTokens} tokens\nOutput: ${args.outputTokens} tokens\nModel: ${args.model}\nEstimated cost: $${cost.toFixed(4)}\n\nSession totals:\nInput: ${sessionState.tokenUsage.input} tokens\nOutput: ${sessionState.tokenUsage.output} tokens`,
      },
    ],
  };
}

async function handleGetContext(args: GetContextArgs): Promise<CallToolResult> {
  const limit = args.limit || 5;

  // Try to fetch context from profClaw API
  try {
    const response = await fetch(
      `${PROFCLAW_API_URL}/api/tasks?limit=${limit}&search=${encodeURIComponent(args.query)}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (response.ok) {
      const data = (await response.json()) as { tasks?: Array<{ title: string; description?: string; status: string }> };
      const tasks = data.tasks || [];

      if (tasks.length === 0) {
        return {
          content: [{ type: 'text', text: 'No relevant past tasks found.' }],
        };
      }

      const taskSummaries = tasks
        .map((t: { title: string; description?: string; status: string }) =>
          `- ${t.title} (${t.status}): ${t.description || 'No description'}`
        )
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Found ${tasks.length} relevant task(s):\n\n${taskSummaries}`,
          },
        ],
      };
    }
  } catch (error) {
    console.error('[MCP] Failed to fetch context from profClaw:', error);
  }

  // Fallback if API unavailable
  return {
    content: [
      {
        type: 'text',
        text: 'Could not fetch context from profClaw. The server may be unavailable.',
      },
    ],
  };
}

// --- Ticket Handlers ---

async function handleCreateTicket(args: CreateTicketArgs): Promise<CallToolResult> {
  try {
    const response = await fetch(`${PROFCLAW_API_URL}/api/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: args.title,
        description: args.description || '',
        type: args.type || 'task',
        priority: args.priority || 'medium',
        labels: args.labels || [],
        parentId: args.parentId,
        createdBy: 'ai',
        aiAgent: sessionState.sessionId,
        aiSessionId: sessionState.sessionId,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        content: [{ type: 'text', text: `Failed to create ticket: ${error}` }],
        isError: true,
      };
    }

    const data = (await response.json()) as { ticket: { id: string; sequence: number; title: string } };
    const ticket = data.ticket;

    return {
      content: [
        {
          type: 'text',
          text: `Ticket created: PC-${ticket.sequence}\nID: ${ticket.id}\nTitle: ${ticket.title}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error creating ticket: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      isError: true,
    };
  }
}

async function handleUpdateTicket(args: UpdateTicketArgs): Promise<CallToolResult> {
  try {
    const updates: Record<string, unknown> = {};
    if (args.title) updates.title = args.title;
    if (args.description) updates.description = args.description;
    if (args.priority) updates.priority = args.priority;
    if (args.labels) updates.labels = args.labels;

    const response = await fetch(`${PROFCLAW_API_URL}/api/tickets/${args.ticketId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        content: [{ type: 'text', text: `Failed to update ticket: ${error}` }],
        isError: true,
      };
    }

    const data = (await response.json()) as { ticket: { id: string; sequence: number; title: string } };
    const ticket = data.ticket;

    return {
      content: [
        {
          type: 'text',
          text: `Ticket updated: PC-${ticket.sequence}\nTitle: ${ticket.title}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error updating ticket: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      isError: true,
    };
  }
}

async function handleTransitionTicket(args: TransitionTicketArgs): Promise<CallToolResult> {
  try {
    const response = await fetch(`${PROFCLAW_API_URL}/api/tickets/${args.ticketId}/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: args.status }),
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        content: [{ type: 'text', text: `Failed to transition ticket: ${error}` }],
        isError: true,
      };
    }

    const data = (await response.json()) as { ticket: { id: string; sequence: number; status: string } };
    const ticket = data.ticket;

    return {
      content: [
        {
          type: 'text',
          text: `Ticket transitioned: PC-${ticket.sequence} → ${ticket.status}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error transitioning ticket: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      isError: true,
    };
  }
}

async function handleGetTicket(args: GetTicketArgs): Promise<CallToolResult> {
  try {
    const include = args.include ? `?include=${args.include}` : '';
    const response = await fetch(`${PROFCLAW_API_URL}/api/tickets/${args.ticketId}${include}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return {
          content: [{ type: 'text', text: `Ticket not found: ${args.ticketId}` }],
          isError: true,
        };
      }
      const error = await response.text();
      return {
        content: [{ type: 'text', text: `Failed to get ticket: ${error}` }],
        isError: true,
      };
    }

    const data = (await response.json()) as {
      ticket: {
        id: string;
        sequence: number;
        title: string;
        description: string;
        type: string;
        priority: string;
        status: string;
        labels: string[];
        assigneeAgent?: string;
        comments?: Array<{ content: string; authorName: string; createdAt: string }>;
      };
    };
    const ticket = data.ticket;

    let text = `PC-${ticket.sequence}: ${ticket.title}\n`;
    text += `Status: ${ticket.status} | Type: ${ticket.type} | Priority: ${ticket.priority}\n`;
    if (ticket.labels?.length) text += `Labels: ${ticket.labels.join(', ')}\n`;
    if (ticket.assigneeAgent) text += `Assigned to: ${ticket.assigneeAgent}\n`;
    if (ticket.description) text += `\nDescription:\n${ticket.description}\n`;

    if (ticket.comments?.length) {
      text += `\nComments (${ticket.comments.length}):\n`;
      for (const comment of ticket.comments.slice(-3)) {
        text += `- ${comment.authorName}: ${comment.content.slice(0, 100)}${comment.content.length > 100 ? '...' : ''}\n`;
      }
    }

    return {
      content: [{ type: 'text', text }],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error getting ticket: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      isError: true,
    };
  }
}

async function handleListTickets(args: ListTicketsArgs): Promise<CallToolResult> {
  try {
    const params = new URLSearchParams();
    if (args.status) params.set('status', args.status);
    if (args.type) params.set('type', args.type);
    if (args.priority) params.set('priority', args.priority);
    if (args.assignedToMe) params.set('assigneeAgent', sessionState.sessionId);
    params.set('limit', String(args.limit || 20));

    const response = await fetch(`${PROFCLAW_API_URL}/api/tickets?${params}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        content: [{ type: 'text', text: `Failed to list tickets: ${error}` }],
        isError: true,
      };
    }

    const data = (await response.json()) as {
      tickets: Array<{
        sequence: number;
        title: string;
        status: string;
        priority: string;
        type: string;
      }>;
      total: number;
    };

    if (data.tickets.length === 0) {
      return {
        content: [{ type: 'text', text: 'No tickets found matching the criteria.' }],
      };
    }

    let text = `Found ${data.total} tickets:\n\n`;
    for (const t of data.tickets) {
      text += `PC-${t.sequence}: ${t.title}\n`;
      text += `  Status: ${t.status} | Priority: ${t.priority} | Type: ${t.type}\n`;
    }

    return {
      content: [{ type: 'text', text }],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error listing tickets: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      isError: true,
    };
  }
}

async function handleAddComment(args: AddCommentArgs): Promise<CallToolResult> {
  try {
    const response = await fetch(`${PROFCLAW_API_URL}/api/tickets/${args.ticketId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: args.content,
        authorType: 'ai',
        authorId: sessionState.sessionId,
        authorName: `AI Agent (${sessionState.sessionId.slice(0, 8)})`,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        content: [{ type: 'text', text: `Failed to add comment: ${error}` }],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `Comment added to ticket ${args.ticketId}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error adding comment: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      isError: true,
    };
  }
}

async function handleAssignTicket(args: AssignTicketArgs): Promise<CallToolResult> {
  try {
    const agent = args.agent || sessionState.sessionId;

    const response = await fetch(`${PROFCLAW_API_URL}/api/tickets/${args.ticketId}/assign-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent }),
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        content: [{ type: 'text', text: `Failed to assign ticket: ${error}` }],
        isError: true,
      };
    }

    const data = (await response.json()) as { ticket: { sequence: number; assigneeAgent: string } };
    const ticket = data.ticket;

    return {
      content: [
        {
          type: 'text',
          text: `Ticket PC-${ticket.sequence} assigned to: ${ticket.assigneeAgent}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error assigning ticket: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      isError: true,
    };
  }
}

// Cost calculation (simplified)
export function calculateCost(input: number, output: number, model: string): number {
  // Pricing per 1M tokens (simplified)
  const pricing: Record<string, { input: number; output: number }> = {
    'claude-opus-4-6': { input: 5, output: 25 },
    'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
    'claude-haiku-4-5-20251001': { input: 0.25, output: 1.25 },
    default: { input: 3, output: 15 },
  };

  const rates = pricing[model] || pricing.default;
  return (input * rates.input + output * rates.output) / 1_000_000;
}

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log startup to stderr (stdout is for MCP protocol)
  console.error('[profClaw MCP] Server started');
  console.error(`[profClaw MCP] Session ID: ${sessionState.sessionId}`);
  console.error(`[profClaw MCP] API URL: ${PROFCLAW_API_URL}`);
}

main().catch((error) => {
  console.error('[profClaw MCP] Fatal error:', error);
  process.exit(1);
});
