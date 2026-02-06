import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext, ToolSession } from '../types.js';

const { mockSessionsSendDeps } = vi.hoisted(() => ({
  mockSessionsSendDeps: {
    getConversation: vi.fn(),
    getConversationMessages: vi.fn(),
    addMessage: vi.fn(),
    aiProvider: {
      chat: vi.fn(),
      getDefaultProvider: vi.fn(() => 'anthropic'),
      resolveModel: vi.fn((model?: string) => {
        if (model === 'openai/gpt-4o-mini') {
          return { provider: 'openai', model: 'gpt-4o-mini' };
        }
        return { provider: 'anthropic', model: 'claude-sonnet-4-6' };
      }),
    },
    buildSystemPrompt: vi.fn(() => Promise.resolve('system prompt')),
    getSessionModel: vi.fn(() => null),
  },
}));

vi.mock('../../conversations.js', () => ({
  getConversation: mockSessionsSendDeps.getConversation,
  getConversationMessages: mockSessionsSendDeps.getConversationMessages,
  addMessage: mockSessionsSendDeps.addMessage,
}));

vi.mock('../../../providers/index.js', () => ({
  aiProvider: mockSessionsSendDeps.aiProvider,
}));

vi.mock('../../system-prompts.js', () => ({
  buildSystemPrompt: mockSessionsSendDeps.buildSystemPrompt,
}));

vi.mock('./session-status.js', () => ({
  getSessionModel: mockSessionsSendDeps.getSessionModel,
}));

import { sessionsSendTool } from './sessions-send.js';

function createContext(): ToolExecutionContext {
  return {
    toolCallId: 'tool-call-1',
    conversationId: 'conv-root',
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

describe('sessions send tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionsSendDeps.getConversation.mockReset();
    mockSessionsSendDeps.getConversationMessages.mockReset();
    mockSessionsSendDeps.addMessage.mockReset();
    mockSessionsSendDeps.aiProvider.chat.mockReset();
    mockSessionsSendDeps.aiProvider.getDefaultProvider.mockReset();
    mockSessionsSendDeps.aiProvider.resolveModel.mockReset();
    mockSessionsSendDeps.buildSystemPrompt.mockReset();
    mockSessionsSendDeps.getSessionModel.mockReset();
    mockSessionsSendDeps.getConversation.mockResolvedValue({
      id: 'conv-target',
      title: 'Target Session',
      presetId: 'profclaw-assistant',
      createdAt: '2026-03-12T00:00:00Z',
      updatedAt: '2026-03-12T00:00:00Z',
    });
    mockSessionsSendDeps.getConversationMessages.mockResolvedValue([
      {
        id: 'msg-existing',
        role: 'user',
        content: 'Earlier request',
        createdAt: '2026-03-12T00:00:00Z',
      },
      {
        id: 'msg-user',
        role: 'user',
        content: 'Current request',
        createdAt: '2026-03-12T00:01:00Z',
      },
    ]);
    mockSessionsSendDeps.aiProvider.getDefaultProvider.mockReturnValue('anthropic');
    mockSessionsSendDeps.aiProvider.resolveModel.mockImplementation((model?: string) => {
      if (model === 'openai/gpt-4o-mini') {
        return { provider: 'openai', model: 'gpt-4o-mini' };
      }
      return { provider: 'anthropic', model: 'claude-sonnet-4-6' };
    });
    mockSessionsSendDeps.buildSystemPrompt.mockResolvedValue('system prompt');
    mockSessionsSendDeps.getSessionModel.mockReturnValue(null);
    mockSessionsSendDeps.addMessage
      .mockResolvedValueOnce({
        id: 'msg-user',
        createdAt: '2026-03-12T00:01:00Z',
      })
      .mockResolvedValueOnce({
        id: 'msg-assistant',
        createdAt: '2026-03-12T00:02:00Z',
      });
    mockSessionsSendDeps.aiProvider.chat.mockResolvedValue({
      content: 'Tool layer looks good.',
      model: 'gpt-4o-mini',
      provider: 'openai',
      usage: {
        promptTokens: 10,
        completionTokens: 15,
        totalTokens: 25,
      },
    });
  });

  it('returns SESSION_NOT_FOUND for unknown sessions', async () => {
    mockSessionsSendDeps.getConversation.mockResolvedValue(null);

    const result = await sessionsSendTool.execute(createContext(), {
      sessionId: 'missing',
      message: 'Hello',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: 'SESSION_NOT_FOUND',
      message: 'Session missing not found',
    });
  });

  it('supports fire-and-forget sends without calling the AI provider', async () => {
    const result = await sessionsSendTool.execute(createContext(), {
      sessionId: 'conv-target',
      message: 'Kick off the test run',
      waitForResponse: false,
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      sessionId: 'conv-target',
      userMessageId: 'msg-user',
    });
    expect(mockSessionsSendDeps.aiProvider.chat).not.toHaveBeenCalled();
    expect(result.output).toContain('Response not awaited');
  });

  it('uses the session model override for the AI request', async () => {
    mockSessionsSendDeps.getSessionModel.mockReturnValue('openai/gpt-4o-mini');

    const result = await sessionsSendTool.execute(createContext(), {
      sessionId: 'conv-target',
      message: 'Summarize the audit',
      model: 'anthropic/claude-sonnet-4-6',
      temperature: 0.2,
    });

    expect(result.success).toBe(true);
    expect(mockSessionsSendDeps.aiProvider.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'openai/gpt-4o-mini',
        temperature: 0.2,
      }),
    );
    expect(mockSessionsSendDeps.buildSystemPrompt).toHaveBeenCalledWith(
      'profclaw-assistant',
      expect.objectContaining({
        runtime: expect.objectContaining({
          model: 'openai/gpt-4o-mini',
          provider: 'openai',
          sessionOverride: 'openai/gpt-4o-mini',
        }),
      }),
    );
    expect(result.data).toMatchObject({
      assistantMessageId: 'msg-assistant',
      provider: 'openai',
      model: 'gpt-4o-mini',
    });
  });
});
