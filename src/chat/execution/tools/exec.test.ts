import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext, ToolSession } from '../types.js';

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { write: vi.fn() };
  pid = 4321;
  exitCode: number | null = null;
  killed = false;

  kill = vi.fn((signal?: NodeJS.Signals | number) => {
    this.killed = true;
    this.exitCode = typeof signal === 'number' ? signal : null;
    this.emit('close', null, signal ?? null);
    return true;
  });
}

const { mockExecDeps } = vi.hoisted(() => ({
  mockExecDeps: {
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
  spawn: mockExecDeps.spawn,
}));

vi.mock('../../../utils/logger.js', () => ({
  logger: mockExecDeps.logger,
}));

import { execTool } from './exec.js';

type SessionManagerStub = ToolExecutionContext['sessionManager'] & {
  attachProcess: ReturnType<typeof vi.fn>;
  background: ReturnType<typeof vi.fn>;
};

function createSessionManager(): SessionManagerStub {
  return {
    create: vi.fn((session: Omit<ToolSession, 'id' | 'createdAt'>) => ({
      ...session,
      id: 'session-1',
      createdAt: Date.now(),
    })),
    get: vi.fn(),
    update: vi.fn(),
    list: vi.fn(() => []),
    kill: vi.fn(),
    cleanup: vi.fn(),
    attachProcess: vi.fn(),
    background: vi.fn(),
  };
}

function createContext(sessionManager: SessionManagerStub): ToolExecutionContext {
  return {
    toolCallId: 'tool-call-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    workdir: '/tmp/project',
    env: { BASE_ENV: '1' },
    securityPolicy: { mode: 'ask' },
    sessionManager,
    onProgress: vi.fn(),
  };
}

describe('exec tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns immediately when background=true', async () => {
    const proc = new FakeChildProcess();
    mockExecDeps.spawn.mockReturnValue(proc);
    const sessionManager = createSessionManager();

    const result = await execTool.execute(createContext(sessionManager), {
      command: 'sleep 5',
      background: true,
    });

    expect(result).toMatchObject({
      success: true,
      isRunning: true,
      isBackgrounded: true,
      sessionId: 'session-1',
      data: {
        status: 'running',
        sessionId: 'session-1',
        pid: 4321,
      },
    });
    expect(result.output).toContain('Command running in background');
    expect(sessionManager.attachProcess).toHaveBeenCalledWith('session-1', proc);
    expect(sessionManager.background).toHaveBeenCalledWith('session-1');
  });

  it('captures stdout and stderr for a foreground command', async () => {
    const proc = new FakeChildProcess();
    mockExecDeps.spawn.mockReturnValue(proc);
    const sessionManager = createSessionManager();
    const context = createContext(sessionManager);

    const resultPromise = execTool.execute(context, {
      command: 'echo hello',
      env: { CHILD_ENV: '2' },
    });

    proc.stdout.emit('data', Buffer.from('hello\n'));
    proc.stderr.emit('data', Buffer.from('warning\n'));
    proc.exitCode = 0;
    proc.emit('close', 0, null);

    const result = await resultPromise;

    expect(mockExecDeps.spawn).toHaveBeenCalledWith(
      '/bin/bash',
      ['-c', 'echo hello'],
      expect.objectContaining({
        cwd: '/tmp/project',
        env: expect.objectContaining({
          BASE_ENV: '1',
          CHILD_ENV: '2',
          PWD: '/tmp/project',
        }),
      }),
    );
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      status: 'completed',
      exitCode: 0,
      stdout: 'hello\n',
      stderr: 'warning\n',
      timedOut: false,
    });
    expect(result.output).toContain('hello');
    expect(result.output).toContain('--- stderr ---');
    expect(context.onProgress).toHaveBeenCalledTimes(2);
  });

  it('returns EXIT_ERROR for non-zero exits', async () => {
    const proc = new FakeChildProcess();
    mockExecDeps.spawn.mockReturnValue(proc);
    const sessionManager = createSessionManager();

    const resultPromise = execTool.execute(createContext(sessionManager), {
      command: 'exit 2',
    });

    proc.stderr.emit('data', Buffer.from('boom\n'));
    proc.exitCode = 2;
    proc.emit('close', 2, null);

    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: 'EXIT_ERROR',
      message: 'Command exited with code 2',
    });
    expect(result.output).toContain('Command exited with code 2');
  });

  it('returns SPAWN_ERROR when process creation fails', async () => {
    const proc = new FakeChildProcess();
    mockExecDeps.spawn.mockReturnValue(proc);
    const sessionManager = createSessionManager();

    const resultPromise = execTool.execute(createContext(sessionManager), {
      command: 'bad-command',
    });

    proc.emit('error', new Error('spawn exploded'));

    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: 'SPAWN_ERROR',
      message: 'spawn exploded',
    });
  });

  it('backgrounds long-running foreground commands after the yield window', async () => {
    vi.useFakeTimers();
    const proc = new FakeChildProcess();
    mockExecDeps.spawn.mockReturnValue(proc);
    const sessionManager = createSessionManager();

    const resultPromise = execTool.execute(createContext(sessionManager), {
      command: 'sleep 20',
    });

    await vi.advanceTimersByTimeAsync(10_000);
    const result = await resultPromise;

    expect(result).toMatchObject({
      success: true,
      isRunning: true,
      isBackgrounded: true,
      sessionId: 'session-1',
    });
    expect(sessionManager.background).toHaveBeenCalledWith('session-1');
  });
});
