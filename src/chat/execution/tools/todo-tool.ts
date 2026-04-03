/**
 * Todo Tools
 *
 * Session-scoped todo list management for agents working through multi-step tasks.
 * Stored in module-level Maps keyed by conversationId so each conversation
 * has its own isolated list.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';

// Types

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';
export type TodoPriority = 'high' | 'medium' | 'low';

export interface TodoItem {
  id: string;
  description: string;
  status: TodoStatus;
  priority?: TodoPriority;
}

export interface TodoWriteResult {
  count: number;
  summary: string;
  items: TodoItem[];
}

export interface TodoReadResult {
  count: number;
  items: TodoItem[];
  summary: string;
}

// Module-level store: conversationId -> TodoItem[]

const todoStore = new Map<string, TodoItem[]>();

// Helpers

function getStoreKey(context: ToolExecutionContext): string {
  return context.conversationId;
}

function formatSummary(items: TodoItem[]): string {
  if (items.length === 0) return 'No todos.';

  const counts: Record<TodoStatus, number> = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    blocked: 0,
  };

  for (const item of items) {
    counts[item.status]++;
  }

  const parts: string[] = [];
  if (counts.pending > 0) parts.push(`${counts.pending} pending`);
  if (counts.in_progress > 0) parts.push(`${counts.in_progress} in progress`);
  if (counts.completed > 0) parts.push(`${counts.completed} completed`);
  if (counts.blocked > 0) parts.push(`${counts.blocked} blocked`);

  return parts.join(', ');
}

function renderItemsText(items: TodoItem[]): string {
  if (items.length === 0) return 'No todos.';

  return items
    .map((item) => {
      const statusIcon =
        item.status === 'completed'
          ? '[x]'
          : item.status === 'in_progress'
          ? '[~]'
          : item.status === 'blocked'
          ? '[!]'
          : '[ ]';

      const priorityTag = item.priority ? ` (${item.priority})` : '';
      return `${statusIcon} [${item.id}] ${item.description}${priorityTag}`;
    })
    .join('\n');
}

// Schemas

const TodoItemSchema = z.object({
  id: z.string().min(1).describe('Unique identifier for the todo item'),
  description: z.string().min(1).describe('Description of the work to do'),
  status: z.enum(['pending', 'in_progress', 'completed', 'blocked']).describe('Current status'),
  priority: z.enum(['high', 'medium', 'low']).optional().describe('Priority level'),
});

const TodoWriteParamsSchema = z.object({
  items: z.array(TodoItemSchema).min(1).describe('Full todo list to write (replaces existing list)'),
});

const TodoReadParamsSchema = z.object({});

export type TodoWriteParams = z.infer<typeof TodoWriteParamsSchema>;
export type TodoReadParams = z.infer<typeof TodoReadParamsSchema>;

// todo_write Tool

export const todoWriteTool: ToolDefinition<TodoWriteParams, TodoWriteResult> = {
  name: 'todo_write',
  description: `Create or update a structured todo list to track multi-step work. The todo list persists for the session and helps coordinate complex tasks.

Pass the complete desired list on every call — this replaces the existing list. To update an item's status, include all items with the updated status values.

Status values:
- pending: not started
- in_progress: actively being worked on (use for at most one item at a time)
- completed: done
- blocked: waiting on something

Use todo_read to retrieve the current list without modifying it.`,
  category: 'profclaw',
  securityLevel: 'safe',
  parameters: TodoWriteParamsSchema,
  examples: [
    {
      description: 'Create a todo list',
      params: {
        items: [
          { id: '1', description: 'Read existing code', status: 'completed', priority: 'high' },
          { id: '2', description: 'Write new feature', status: 'in_progress', priority: 'high' },
          { id: '3', description: 'Write tests', status: 'pending', priority: 'medium' },
        ],
      },
    },
  ],

  async execute(context: ToolExecutionContext, params: TodoWriteParams): Promise<ToolResult<TodoWriteResult>> {
    const key = getStoreKey(context);
    todoStore.set(key, params.items);

    const summary = formatSummary(params.items);
    const result: TodoWriteResult = {
      count: params.items.length,
      summary,
      items: params.items,
    };

    return {
      success: true,
      data: result,
      output: `Todo list updated (${params.items.length} items: ${summary})\n\n${renderItemsText(params.items)}`,
    };
  },
};

// todo_read Tool

export const todoReadTool: ToolDefinition<TodoReadParams, TodoReadResult> = {
  name: 'todo_read',
  description: 'Read the current todo list for this session. Returns all items with their current status.',
  category: 'profclaw',
  securityLevel: 'safe',
  parameters: TodoReadParamsSchema,
  examples: [
    { description: 'Check current todos', params: {} },
  ],

  async execute(context: ToolExecutionContext, _params: TodoReadParams): Promise<ToolResult<TodoReadResult>> {
    const key = getStoreKey(context);
    const items = todoStore.get(key) ?? [];

    const summary = formatSummary(items);
    const result: TodoReadResult = {
      count: items.length,
      items,
      summary,
    };

    return {
      success: true,
      data: result,
      output: items.length === 0
        ? 'No todos.'
        : `Todo list (${items.length} items: ${summary})\n\n${renderItemsText(items)}`,
    };
  },
};

// Exported helpers for testing

/** Clear todos for a given conversation key */
export function clearTodos(conversationId: string): void {
  todoStore.delete(conversationId);
}

/** Get todos for a conversation key (for testing) */
export function getTodos(conversationId: string): TodoItem[] {
  return todoStore.get(conversationId) ?? [];
}

/** Exposed for tests */
export function getTodoStore(): Map<string, TodoItem[]> {
  return todoStore;
}
