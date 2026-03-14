import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext, ToolSession } from '../types.js';

const { mockSessionsSpawnDeps } = vi.hoisted(() => ({
  mockSessionsSpawnDeps: {
    createConversation: vi.fn(),
    addMessage: vi.fn(),
  },
}));

vi.mock('../../conversations.js', () => ({
  createConversation: mockSessionsSpawnDeps.createConversation,
  addMessage: mockSessionsSpawnDeps.addMessage,
}));

import { sessionsSpawnTool } from './sessions-spawn.js';

function createContext(): ToolExecutionContext {
  return {
    toolCallId: 'tool-call-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    workdir: '/tmp',
    env: {},
    securityPolicy: { mode: 'ask' },
    sessionManager: {
      create(session: Omit<ToolSession, 'id' | 'createdAt'>): ToolSession {
        return {
          ...session,
          id: 'session-1',
          createdAt: Date.now(),
        };
      },
      get() {
        return undefined;
      },
      update() {},
      list() {
        return [];
      },
      async kill() {},
      cleanup() {},
    },
  };
}

describe('sessions spawn tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionsSpawnDeps.createConversation.mockResolvedValue({
      id: 'conv-child',
      title: 'Generated title',
      presetId: 'code-assistant',
      projectId: 'proj-1',
      ticketId: 'PC-99',
      taskId: 'task-1',
      createdAt: '2026-03-12T00:00:00Z',
      updatedAt: '2026-03-12T00:00:00Z',
    });
    mockSessionsSpawnDeps.addMessage.mockResolvedValue({
      id: 'msg-init',
      createdAt: '2026-03-12T00:01:00Z',
    });
  });

  it('generates a title from the task and records the initial message', async () => {
    const result = await sessionsSpawnTool.execute(createContext(), {
      task: 'Investigate why session model overrides are ignored by the message route',
      presetId: 'code-assistant',
      projectId: 'proj-1',
      ticketId: 'PC-99',
      taskId: 'task-1',
      mode: 'agentic',
    });

    expect(result.success).toBe(true);
    expect(mockSessionsSpawnDeps.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Investigate why session model overrides are ignore...',
        presetId: 'code-assistant',
        projectId: 'proj-1',
        ticketId: 'PC-99',
        taskId: 'task-1',
      }),
    );
    expect(mockSessionsSpawnDeps.addMessage).toHaveBeenCalledWith({
      conversationId: 'conv-child',
      role: 'user',
      content: 'Investigate why session model overrides are ignored by the message route',
    });
    expect(result.data).toMatchObject({
      sessionId: 'conv-child',
      mode: 'agentic',
      initialMessageId: 'msg-init',
    });
  });

  it('returns SPAWN_SESSION_ERROR when conversation creation fails', async () => {
    mockSessionsSpawnDeps.createConversation.mockRejectedValue(new Error('db offline'));

    const result = await sessionsSpawnTool.execute(createContext(), {
      title: 'Broken spawn',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: 'SPAWN_SESSION_ERROR',
      message: 'Failed to spawn session: db offline',
    });
  });
});
