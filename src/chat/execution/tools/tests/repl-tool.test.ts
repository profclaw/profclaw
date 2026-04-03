import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolExecutionContext, ToolSession } from '../../types.js';

// ---- Fake ChildProcess ----

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { write: vi.fn() };
  pid = 1234;
  killed = false;

  kill = vi.fn(() => {
    this.killed = true;
    this.emit('close', 0, null);
    return true;
  });
}

// Spawn mock: returns a FakeChildProcess; allows test control of output
let fakeProc: FakeChildProcess;

const { mockSpawn, mockLogger } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('../../../../utils/logger.js', () => ({
  logger: mockLogger,
}));

import {
  replTool,
  getReplSessionsMap,
  closeReplSession,
  listReplSessions,
} from '../repl-tool.js';

// ---- Context helper ----

function createContext(conversationId = 'conv-repl-1'): ToolExecutionContext {
  return {
    toolCallId: 'tc-1',
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

// ---- Tests ----

describe('replTool', () => {
  beforeEach(() => {
    // Clear all active REPL sessions between tests
    for (const id of listReplSessions()) {
      closeReplSession(id);
    }

    fakeProc = new FakeChildProcess();
    mockSpawn.mockReturnValue(fakeProc);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new session when no sessionId is provided', async () => {
    const ctx = createContext();

    // Simulate the REPL prompt arriving after input
    fakeProc.stdin.write.mockImplementation(() => {
      // Emit output + node prompt asynchronously
      setImmediate(() => {
        fakeProc.stdout.emit('data', Buffer.from('42\n> '));
      });
    });

    const result = await replTool.execute(ctx, {
      code: '21 * 2',
      language: 'node',
    });

    expect(result.success).toBe(true);
    expect(result.sessionId).toBeTruthy();
    expect(result.data?.output).toContain('42');
    // Session should now be in the map
    expect(getReplSessionsMap().has(result.sessionId as string)).toBe(true);
  });

  it('executes code and returns output', async () => {
    const ctx = createContext();

    fakeProc.stdin.write.mockImplementation(() => {
      setImmediate(() => {
        fakeProc.stdout.emit('data', Buffer.from("'hello world'\n> "));
      });
    });

    const result = await replTool.execute(ctx, {
      code: "'hello world'",
      language: 'node',
    });

    expect(result.success).toBe(true);
    expect(result.data?.output).toContain('hello world');
    expect(result.data?.language).toBe('node');
    // stdin.write should have been called with the code
    expect(fakeProc.stdin.write).toHaveBeenCalledWith(expect.stringContaining("'hello world'"));
  });

  it('persists state across calls using the same sessionId', async () => {
    const ctx = createContext();

    // First call: define x = 100
    fakeProc.stdin.write.mockImplementationOnce(() => {
      setImmediate(() => {
        fakeProc.stdout.emit('data', Buffer.from('undefined\n> '));
      });
    });

    const first = await replTool.execute(ctx, {
      code: 'const x = 100',
      language: 'node',
    });

    expect(first.success).toBe(true);
    const sessionId = first.sessionId as string;
    expect(sessionId).toBeTruthy();

    // Second call: use x — same proc is reused
    fakeProc.stdin.write.mockImplementationOnce(() => {
      setImmediate(() => {
        fakeProc.stdout.emit('data', Buffer.from('200\n> '));
      });
    });

    const second = await replTool.execute(ctx, {
      code: 'x * 2',
      language: 'node',
      sessionId,
    });

    expect(second.success).toBe(true);
    expect(second.data?.output).toContain('200');
    expect(second.sessionId).toBe(sessionId);

    // spawn should only have been called once (same session reused)
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });
});
