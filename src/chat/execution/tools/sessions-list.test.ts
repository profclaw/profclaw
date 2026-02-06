import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext, ToolSession } from '../types.js';

const { mockSessionsListDeps } = vi.hoisted(() => ({
  mockSessionsListDeps: {
    getRecentConversationsWithPreview: vi.fn(),
    listConversations: vi.fn(),
  },
}));

vi.mock('../../conversations.js', () => ({
  getRecentConversationsWithPreview: mockSessionsListDeps.getRecentConversationsWithPreview,
  listConversations: mockSessionsListDeps.listConversations,
  getConversationMessages: vi.fn(),
}));

import { sessionsListTool } from './sessions-list.js';

function createContext(conversationId = 'conv-current'): ToolExecutionContext {
  return {
    toolCallId: 'tool-call-1',
    conversationId,
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

describe('sessions list tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists preview sessions, filters by project, and marks the current session', async () => {
    mockSessionsListDeps.getRecentConversationsWithPreview.mockResolvedValue([
      {
        id: 'conv-current',
        title: 'Current Work',
        preview: 'Investigating tool failures',
        messageCount: 4,
        projectId: 'proj-1',
        ticketId: 'PC-12',
        createdAt: '2026-03-12T00:00:00Z',
        updatedAt: '2026-03-12T00:10:00Z',
      },
      {
        id: 'conv-other',
        title: 'Other Work',
        preview: 'Should be filtered out',
        messageCount: 2,
        projectId: 'proj-2',
        ticketId: 'PC-13',
        createdAt: '2026-03-12T00:00:00Z',
        updatedAt: '2026-03-12T00:12:00Z',
      },
    ]);

    const result = await sessionsListTool.execute(createContext(), {
      includePreview: true,
      projectId: 'proj-1',
      limit: 10,
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      total: 1,
      currentSessionId: 'conv-current',
      sessions: [
        expect.objectContaining({
          id: 'conv-current',
          title: 'Current Work',
          preview: 'Investigating tool failures',
          projectId: 'proj-1',
        }),
      ],
    });
    expect(result.output).toContain('current');
    expect(result.output).not.toContain('Other Work');
  });

  it('keeps total aligned with filtered sessions for non-preview listings', async () => {
    mockSessionsListDeps.listConversations.mockResolvedValue({
      total: 2,
      conversations: [
        {
          id: 'conv-a',
          title: 'Project A',
          presetId: 'profclaw-assistant',
          projectId: 'proj-a',
          ticketId: undefined,
          createdAt: '2026-03-12T00:00:00Z',
          updatedAt: '2026-03-12T00:05:00Z',
        },
        {
          id: 'conv-b',
          title: 'Project B',
          presetId: 'profclaw-assistant',
          projectId: 'proj-b',
          ticketId: undefined,
          createdAt: '2026-03-12T00:00:00Z',
          updatedAt: '2026-03-12T00:06:00Z',
        },
      ],
    });

    const result = await sessionsListTool.execute(createContext('conv-a'), {
      includePreview: false,
      projectId: 'proj-a',
      limit: 10,
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      total: 1,
      sessions: [
        expect.objectContaining({
          id: 'conv-a',
          projectId: 'proj-a',
        }),
      ],
    });
    expect(result.output).toContain('Showing 1 of 1 sessions');
  });

  it('returns LIST_SESSIONS_ERROR when the query fails', async () => {
    mockSessionsListDeps.getRecentConversationsWithPreview.mockRejectedValue(
      new Error('database busy'),
    );

    const result = await sessionsListTool.execute(createContext(), {
      includePreview: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: 'LIST_SESSIONS_ERROR',
      message: 'Failed to list sessions: database busy',
    });
  });
});
