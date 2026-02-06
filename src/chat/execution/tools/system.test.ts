import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext, ToolSession } from '../types.js';

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

const { mockSystemDeps } = vi.hoisted(() => ({
  mockSystemDeps: {
    spawn: vi.fn(),
  },
}));

vi.mock('child_process', () => ({
  spawn: mockSystemDeps.spawn,
}));

import { envTool, processListTool } from './system.js';

function createContext(): ToolExecutionContext {
  return {
    toolCallId: 'tool-call-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    workdir: '/tmp',
    env: {
      APP_MODE: 'prod',
      APP_SECRET: 'hidden',
      OTHER_VAR: 'nope',
    },
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

describe('system tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns INVALID_FILTER for bad env regex input', async () => {
    const result = await envTool.execute(createContext(), {
      filter: '[',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: 'INVALID_FILTER',
      message: 'Invalid filter pattern: [',
    });
  });

  it('filters environment variables by pattern', async () => {
    const result = await envTool.execute(createContext(), {
      filter: '^APP_',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      count: 2,
      variables: {
        APP_MODE: 'prod',
        APP_SECRET: 'hidden',
      },
    });
    expect(result.output).toContain('APP_MODE=prod');
    expect(result.output).toContain('APP_SECRET=hidden');
    expect(result.output).not.toContain('OTHER_VAR');
  });

  it('sorts process_list results by requested field', async () => {
    const proc = new FakeChildProcess();
    mockSystemDeps.spawn.mockReturnValue(proc);

    const resultPromise = processListTool.execute(createContext(), {
      limit: 10,
      sortBy: 'memory',
    });

    proc.stdout.emit(
      'data',
      Buffer.from(
        [
          'USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND',
          'alice      101 12.0  3.0  1234   456 ?        S    00:00   0:01 node server.js',
          'bob        102  9.0  9.5  1234   456 ?        S    00:00   0:01 python worker.py',
          'carl       103 25.0  1.0  1234   456 ?        S    00:00   0:01 git status',
        ].join('\n'),
      ),
    );
    proc.emit('close', 0);

    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.data?.processes.map((p) => p.pid)).toEqual([102, 101, 103]);
  });

  it('returns INVALID_FILTER for bad process regex input', async () => {
    const proc = new FakeChildProcess();
    mockSystemDeps.spawn.mockReturnValue(proc);

    const resultPromise = processListTool.execute(createContext(), {
      filter: '(',
      limit: 10,
      sortBy: 'cpu',
    });

    proc.stdout.emit(
      'data',
      Buffer.from(
        [
          'USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND',
          'alice      101 12.0  3.0  1234   456 ?        S    00:00   0:01 node server.js',
        ].join('\n'),
      ),
    );
    proc.emit('close', 0);

    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: 'INVALID_FILTER',
      message: 'Invalid filter pattern: (',
    });
  });
});
