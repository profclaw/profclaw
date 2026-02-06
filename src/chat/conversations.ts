/**
 * Conversation Storage
 *
 * Persists chat conversations for history and context.
 */

import { randomUUID } from 'node:crypto';
import { getClient } from '../storage/index.js';

// === Types ===

export interface Conversation {
  id: string;
  title: string;
  presetId: string;
  createdAt: string;
  updatedAt: string;
  // Context links
  taskId?: string;
  ticketId?: string;
  projectId?: string;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  status?: 'pending' | 'running' | 'success' | 'error';
  duration?: number;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  provider?: string;
  tokenUsage?: {
    prompt: number;
    completion: number;
    total: number;
  };
  cost?: number;
  toolCalls?: ToolCallRecord[];
  createdAt: string;
}

// === Database Setup ===

export async function initConversationTables(): Promise<void> {
  const client = getClient();

  await client.execute(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      preset_id TEXT NOT NULL DEFAULT 'glinr-assistant',
      task_id TEXT,
      ticket_id TEXT,
      project_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      provider TEXT,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      total_tokens INTEGER,
      cost REAL,
      tool_calls TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )
  `);

  // Migration: Add tool_calls column if it doesn't exist (for existing tables)
  try {
    await client.execute(`ALTER TABLE conversation_messages ADD COLUMN tool_calls TEXT`);
  } catch {
    // Column already exists, ignore
  }

  // Index for fast conversation message lookup
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_conv_messages_conv_id
    ON conversation_messages(conversation_id)
  `);
}

// === Conversation CRUD ===

export async function createConversation(params: {
  title?: string;
  presetId?: string;
  taskId?: string;
  ticketId?: string;
  projectId?: string;
}): Promise<Conversation> {
  const client = getClient();
  const id = randomUUID();
  const now = new Date().toISOString();
  const title = params.title || 'New conversation';
  const presetId = params.presetId || 'glinr-assistant';

  await client.execute({
    sql: `INSERT INTO conversations (id, title, preset_id, task_id, ticket_id, project_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, title, presetId, params.taskId || null, params.ticketId || null, params.projectId || null, now, now],
  });

  return {
    id,
    title,
    presetId,
    taskId: params.taskId,
    ticketId: params.ticketId,
    projectId: params.projectId,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const client = getClient();
  const result = await client.execute({
    sql: `SELECT id, title, preset_id, task_id, ticket_id, project_id, created_at, updated_at
          FROM conversations WHERE id = ?`,
    args: [id],
  });

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id as string,
    title: row.title as string,
    presetId: row.preset_id as string,
    taskId: row.task_id as string | undefined,
    ticketId: row.ticket_id as string | undefined,
    projectId: row.project_id as string | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function listConversations(params?: {
  limit?: number;
  offset?: number;
  taskId?: string;
  ticketId?: string;
}): Promise<{ conversations: Conversation[]; total: number }> {
  const client = getClient();
  const limit = params?.limit || 20;
  const offset = params?.offset || 0;

  // Build WHERE clause and args
  const conditions: string[] = ['1=1'];
  const args: (string | number)[] = [];

  if (params?.taskId) {
    conditions.push('task_id = ?');
    args.push(params.taskId);
  }
  if (params?.ticketId) {
    conditions.push('ticket_id = ?');
    args.push(params.ticketId);
  }

  const whereClause = conditions.join(' AND ');

  const countResult = await client.execute({
    sql: `SELECT COUNT(*) as total FROM conversations WHERE ${whereClause}`,
    args,
  });
  const total = Number(countResult.rows[0].total);

  const result = await client.execute({
    sql: `SELECT id, title, preset_id, task_id, ticket_id, project_id, created_at, updated_at
          FROM conversations
          WHERE ${whereClause}
          ORDER BY updated_at DESC
          LIMIT ? OFFSET ?`,
    args: [...args, limit, offset],
  });

  const conversations = result.rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    title: row.title as string,
    presetId: row.preset_id as string,
    taskId: row.task_id as string | undefined,
    ticketId: row.ticket_id as string | undefined,
    projectId: row.project_id as string | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }));

  return { conversations, total };
}

export async function updateConversationTitle(id: string, title: string): Promise<void> {
  const client = getClient();
  const now = new Date().toISOString();
  await client.execute({
    sql: `UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?`,
    args: [title, now, id],
  });
}

export async function deleteConversation(id: string): Promise<void> {
  const client = getClient();
  await client.execute({
    sql: `DELETE FROM conversation_messages WHERE conversation_id = ?`,
    args: [id],
  });
  await client.execute({
    sql: `DELETE FROM conversations WHERE id = ?`,
    args: [id],
  });
}

// === Message CRUD ===

export async function addMessage(params: {
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  provider?: string;
  tokenUsage?: { prompt: number; completion: number; total: number };
  cost?: number;
  toolCalls?: ToolCallRecord[];
}): Promise<ConversationMessage> {
  const client = getClient();
  const id = randomUUID();
  const now = new Date().toISOString();

  // Serialize toolCalls to JSON if present
  const toolCallsJson = params.toolCalls && params.toolCalls.length > 0
    ? JSON.stringify(params.toolCalls)
    : null;

  await client.execute({
    sql: `INSERT INTO conversation_messages (
            id, conversation_id, role, content, model, provider,
            prompt_tokens, completion_tokens, total_tokens, cost, tool_calls, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      params.conversationId,
      params.role,
      params.content,
      params.model || null,
      params.provider || null,
      params.tokenUsage?.prompt || null,
      params.tokenUsage?.completion || null,
      params.tokenUsage?.total || null,
      params.cost || null,
      toolCallsJson,
      now,
    ],
  });

  // Update conversation timestamp
  await client.execute({
    sql: `UPDATE conversations SET updated_at = ? WHERE id = ?`,
    args: [now, params.conversationId],
  });

  // Auto-generate title from first user message
  const countResult = await client.execute({
    sql: `SELECT COUNT(*) as count FROM conversation_messages WHERE conversation_id = ?`,
    args: [params.conversationId],
  });
  const messageCount = Number(countResult.rows[0].count);

  if (messageCount === 1 && params.role === 'user') {
    // Generate title from first message
    const title = params.content.slice(0, 50) + (params.content.length > 50 ? '...' : '');
    await updateConversationTitle(params.conversationId, title);
  }

  return {
    id,
    conversationId: params.conversationId,
    role: params.role,
    content: params.content,
    model: params.model,
    provider: params.provider,
    tokenUsage: params.tokenUsage,
    cost: params.cost,
    toolCalls: params.toolCalls,
    createdAt: now,
  };
}

export async function getConversationMessages(conversationId: string): Promise<ConversationMessage[]> {
  const client = getClient();
  const result = await client.execute({
    sql: `SELECT id, conversation_id, role, content, model, provider,
                 prompt_tokens, completion_tokens, total_tokens, cost, tool_calls, created_at
          FROM conversation_messages
          WHERE conversation_id = ?
          ORDER BY created_at ASC`,
    args: [conversationId],
  });

  return result.rows.map((row: Record<string, unknown>) => {
    // Parse toolCalls from JSON if present
    let toolCalls: ToolCallRecord[] | undefined;
    if (row.tool_calls) {
      try {
        toolCalls = JSON.parse(row.tool_calls as string) as ToolCallRecord[];
      } catch {
        // Invalid JSON, ignore
      }
    }

    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      role: row.role as 'user' | 'assistant' | 'system',
      content: row.content as string,
      model: row.model as string | undefined,
      provider: row.provider as string | undefined,
      tokenUsage:
        row.total_tokens != null
          ? {
              prompt: row.prompt_tokens as number,
              completion: row.completion_tokens as number,
              total: row.total_tokens as number,
            }
          : undefined,
      cost: row.cost as number | undefined,
      toolCalls,
      createdAt: row.created_at as string,
    };
  });
}

export async function getRecentConversationsWithPreview(
  limit = 10
): Promise<Array<Conversation & { preview: string; messageCount: number }>> {
  const client = getClient();
  const result = await client.execute({
    sql: `SELECT
            c.id, c.title, c.preset_id, c.task_id, c.ticket_id, c.project_id,
            c.created_at, c.updated_at,
            (SELECT content FROM conversation_messages
             WHERE conversation_id = c.id
             ORDER BY created_at DESC LIMIT 1) as preview,
            (SELECT COUNT(*) FROM conversation_messages
             WHERE conversation_id = c.id) as message_count
          FROM conversations c
          ORDER BY c.updated_at DESC
          LIMIT ?`,
    args: [limit],
  });

  return result.rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    title: row.title as string,
    presetId: row.preset_id as string,
    taskId: row.task_id as string | undefined,
    ticketId: row.ticket_id as string | undefined,
    projectId: row.project_id as string | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    preview: ((row.preview as string | null) || '').slice(0, 100),
    messageCount: Number(row.message_count),
  }));
}

export default {
  initConversationTables,
  createConversation,
  getConversation,
  listConversations,
  updateConversationTitle,
  deleteConversation,
  addMessage,
  getConversationMessages,
  getRecentConversationsWithPreview,
};
