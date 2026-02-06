import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext, ToolSession } from '../types.js';

class FakeGhProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

const { mockGithubDeps } = vi.hoisted(() => ({
  mockGithubDeps: {
    spawn: vi.fn(),
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

vi.mock('child_process', () => ({
  spawn: mockGithubDeps.spawn,
}));

vi.mock('../../../utils/logger.js', () => ({
  logger: mockGithubDeps.logger,
}));

import { githubPrTool } from './github.js';

function createContext(): ToolExecutionContext {
  return {
    toolCallId: 'tool-call-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    workdir: '/tmp/repo',
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

describe('github pr tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns INVALID_PARAMS for actions missing required inputs', async () => {
    const result = await githubPrTool.execute(createContext(), {
      action: 'get',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: 'INVALID_PARAMS',
      message: 'pr_number is required for get action',
    });
    expect(mockGithubDeps.spawn).not.toHaveBeenCalled();
  });

  it('returns GH_NOT_FOUND when gh is missing', async () => {
    const proc = new FakeGhProcess();
    mockGithubDeps.spawn.mockReturnValue(proc);

    const resultPromise = githubPrTool.execute(createContext(), {
      action: 'list',
    });

    const err = new Error('spawn gh ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    proc.emit('error', err);

    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: 'GH_NOT_FOUND',
    });
  });

  it('returns GH_AUTH_REQUIRED when gh reports auth failure', async () => {
    const proc = new FakeGhProcess();
    mockGithubDeps.spawn.mockReturnValue(proc);

    const resultPromise = githubPrTool.execute(createContext(), {
      action: 'list',
    });

    proc.stderr.emit('data', Buffer.from('auth required'));
    proc.emit('close', 1);

    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: 'GH_AUTH_REQUIRED',
      message: 'GitHub CLI requires authentication. Run: gh auth login',
    });
  });

  it('returns command output for successful gh operations', async () => {
    const proc = new FakeGhProcess();
    mockGithubDeps.spawn.mockReturnValue(proc);

    const resultPromise = githubPrTool.execute(createContext(), {
      action: 'list',
      repo: 'acme/test',
    });

    proc.stdout.emit('data', Buffer.from('[{"number":42}]'));
    proc.emit('close', 0);

    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(mockGithubDeps.spawn).toHaveBeenCalledWith(
      'gh',
      ['pr', 'list', '--json', 'number,title,state,author,updatedAt,headRefName', '-R', 'acme/test'],
      expect.objectContaining({ cwd: '/tmp/repo' }),
    );
    expect(result.output).toBe('[{"number":42}]');
  });
});
