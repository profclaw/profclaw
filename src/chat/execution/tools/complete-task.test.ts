import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext, ToolSession } from '../types.js';

const { mockCompleteTaskDeps } = vi.hoisted(() => ({
  mockCompleteTaskDeps: {
    logger: {
      info: vi.fn(),
    },
  },
}));

vi.mock('../../../utils/logger.js', () => ({
  logger: mockCompleteTaskDeps.logger,
}));

import { completeTaskTool } from './complete-task.js';

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

describe('complete task tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a completion payload with defaults and logs the summary', async () => {
    const result = await completeTaskTool.execute(createContext(), {
      summary: 'Created ticket PC-42 and linked the repro steps',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      complete: true,
      summary: 'Created ticket PC-42 and linked the repro steps',
      artifacts: [],
      nextSteps: [],
      confidence: 'high',
    });
    expect(result.data?.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(mockCompleteTaskDeps.logger.info).toHaveBeenCalledWith(
      '[Agent] Task marked as complete:',
      expect.objectContaining({
        summary: 'Created ticket PC-42 and linked the repro steps',
        artifactCount: 0,
        confidence: 'high',
      }),
    );
  });
});
