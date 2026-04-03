import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ToolExecutionContext, ToolSession } from '../../types.js';

import {
  todoWriteTool,
  todoReadTool,
  clearTodos,
  getTodos,
  type TodoItem,
} from '../todo-tool.js';

// ---- Context helper ----

function createContext(conversationId = 'conv-todo-1'): ToolExecutionContext {
  return {
    toolCallId: 'tc-todo-1',
    conversationId,
    userId: 'user-1',
    workdir: '/tmp',
    env: {},
    securityPolicy: { mode: 'ask' },
    sessionManager: {
      create(session: Omit<ToolSession, 'id' | 'createdAt'>): ToolSession {
        return { ...session, id: 'session-1', createdAt: Date.now() };
      },
      get() { return undefined; },
      update() {},
      list() { return []; },
      async kill() {},
      cleanup() {},
    },
  };
}

const SAMPLE_ITEMS: TodoItem[] = [
  { id: '1', description: 'Read existing code', status: 'completed', priority: 'high' },
  { id: '2', description: 'Write new feature', status: 'in_progress', priority: 'high' },
  { id: '3', description: 'Write tests', status: 'pending', priority: 'medium' },
  { id: '4', description: 'Update docs', status: 'blocked', priority: 'low' },
];

// ---- Tests ----

describe('todoWriteTool', () => {
  beforeEach(() => {
    clearTodos('conv-todo-1');
  });

  afterEach(() => {
    clearTodos('conv-todo-1');
  });

  it('writes a todo list and returns a formatted summary', async () => {
    const ctx = createContext();

    const result = await todoWriteTool.execute(ctx, { items: SAMPLE_ITEMS });

    expect(result.success).toBe(true);
    expect(result.data?.count).toBe(4);
    expect(result.data?.items).toHaveLength(4);
    expect(result.data?.summary).toMatch(/1 pending/);
    expect(result.data?.summary).toMatch(/1 in progress/);
    expect(result.data?.summary).toMatch(/1 completed/);
    expect(result.data?.summary).toMatch(/1 blocked/);
    // Check persisted
    expect(getTodos('conv-todo-1')).toHaveLength(4);
  });

  it('output includes rendered item lines', async () => {
    const ctx = createContext();
    const result = await todoWriteTool.execute(ctx, {
      items: [
        { id: 'a', description: 'Do something', status: 'pending' },
        { id: 'b', description: 'Do more', status: 'completed' },
      ],
    });

    expect(result.output).toContain('[ ] [a] Do something');
    expect(result.output).toContain('[x] [b] Do more');
  });
});

describe('todoReadTool', () => {
  beforeEach(() => {
    clearTodos('conv-todo-1');
  });

  afterEach(() => {
    clearTodos('conv-todo-1');
  });

  it('reads an empty list when no todos have been written', async () => {
    const ctx = createContext();

    const result = await todoReadTool.execute(ctx, {});

    expect(result.success).toBe(true);
    expect(result.data?.count).toBe(0);
    expect(result.data?.items).toHaveLength(0);
    expect(result.output).toBe('No todos.');
  });

  it('reads back the list previously written by todoWriteTool', async () => {
    const ctx = createContext();

    await todoWriteTool.execute(ctx, { items: SAMPLE_ITEMS });
    const result = await todoReadTool.execute(ctx, {});

    expect(result.success).toBe(true);
    expect(result.data?.count).toBe(4);
    expect(result.data?.items[0].id).toBe('1');
    expect(result.data?.items[1].status).toBe('in_progress');
  });

  it('updating status via todoWrite is reflected in todoRead', async () => {
    const ctx = createContext();

    // Initial write
    await todoWriteTool.execute(ctx, { items: SAMPLE_ITEMS });

    // Update: mark item 3 as completed
    const updated: TodoItem[] = SAMPLE_ITEMS.map((item) =>
      item.id === '3' ? { ...item, status: 'completed' } : item,
    );
    await todoWriteTool.execute(ctx, { items: updated });

    const readResult = await todoReadTool.execute(ctx, {});
    const item3 = readResult.data?.items.find((i) => i.id === '3');

    expect(item3?.status).toBe('completed');
    expect(readResult.data?.summary).toMatch(/2 completed/);
  });

  it('todos are scoped per conversationId (no cross-contamination)', async () => {
    const ctx1 = createContext('conv-A');
    const ctx2 = createContext('conv-B');

    await todoWriteTool.execute(ctx1, {
      items: [{ id: 'x', description: 'Task in A', status: 'pending' }],
    });

    const result = await todoReadTool.execute(ctx2, {});

    expect(result.data?.count).toBe(0);

    // Clean up
    clearTodos('conv-A');
    clearTodos('conv-B');
  });
});
