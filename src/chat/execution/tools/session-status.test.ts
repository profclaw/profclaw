import { afterEach, describe, expect, it } from 'vitest';

import {
  clearSessionModel,
  getSessionModel,
  sessionStatusTool,
} from './session-status.js';
import type { ToolExecutionContext, ToolSession } from '../types.js';

function createContext(conversationId = 'conv-1'): ToolExecutionContext {
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

describe('session status tool', () => {
  afterEach(() => {
    clearSessionModel('conv-1');
    clearSessionModel('conv-2');
  });

  it('reports runtime model details when no override is set', async () => {
    const context = Object.assign(createContext('conv-1'), {
      runtimeInfo: {
        model: 'anthropic/claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        defaultModel: 'anthropic/claude-sonnet-4-5-20250929',
      },
    });

    const result = await sessionStatusTool.execute(context, {
      action: 'status',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      action: 'status',
      currentModel: 'anthropic/claude-sonnet-4-5-20250929',
      currentProvider: 'anthropic',
    });
  });

  it('stores session model overrides when switching via alias', async () => {
    const result = await sessionStatusTool.execute(createContext('conv-1'), {
      action: 'set_model',
      model: 'opus',
    });

    expect(result.success).toBe(true);
    expect(getSessionModel('conv-1')).toBe('anthropic/claude-opus-4-6');
    expect(result.output).toContain('claude-opus-4-6');
  });

  it('returns UNKNOWN_MODEL for unsupported model names', async () => {
    const result = await sessionStatusTool.execute(createContext('conv-1'), {
      action: 'set_model',
      model: 'made-up-model',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: 'UNKNOWN_MODEL',
    });
  });

  it('lists model aliases grouped for chat display', async () => {
    const result = await sessionStatusTool.execute(createContext('conv-2'), {
      action: 'list_models',
    });

    expect(result.success).toBe(true);
    expect(result.data?.models?.length).toBeGreaterThan(0);
    expect(result.output).toContain('## Available Models');
    expect(result.output).toContain('`opus`');
  });
});
