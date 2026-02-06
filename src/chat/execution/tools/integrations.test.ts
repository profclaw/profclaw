import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext, ToolSession } from '../types.js';

class FakeClipboardProcess extends EventEmitter {
  stdin = {
    write: vi.fn(),
    end: vi.fn(),
  };
}

const { mockIntegrationDeps } = vi.hoisted(() => ({
  mockIntegrationDeps: {
    spawn: vi.fn(),
    execFile: vi.fn(),
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

vi.mock('child_process', () => ({
  spawn: mockIntegrationDeps.spawn,
  execFile: mockIntegrationDeps.execFile,
}));

vi.mock('../../../utils/logger.js', () => ({
  logger: mockIntegrationDeps.logger,
}));

import { clipboardWriteTool } from './integrations.js';

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

describe('integration tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes clipboard content through spawn without relying on require', async () => {
    const proc = new FakeClipboardProcess();
    mockIntegrationDeps.spawn.mockReturnValue(proc);

    const resultPromise = clipboardWriteTool.execute(createContext(), {
      content: 'hello clipboard',
      format: 'text',
    });

    proc.emit('close', 0);
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(proc.stdin.write).toHaveBeenCalledWith('hello clipboard', 'utf-8');
    expect(proc.stdin.end).toHaveBeenCalled();
    expect(mockIntegrationDeps.spawn).toHaveBeenCalled();
  });

  it('returns CLIPBOARD_WRITE_ERROR when the clipboard process fails', async () => {
    const proc = new FakeClipboardProcess();
    mockIntegrationDeps.spawn.mockReturnValue(proc);

    const resultPromise = clipboardWriteTool.execute(createContext(), {
      content: 'broken clipboard',
      format: 'text',
    });

    proc.emit('error', new Error('clipboard unavailable'));
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: 'CLIPBOARD_WRITE_ERROR',
      message: 'Failed to write clipboard: clipboard unavailable',
    });
  });
});
