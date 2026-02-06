import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../secrets.js', () => ({
  isSecretsDetectionEnabled: vi.fn(() => false),
  hasSecrets: vi.fn(() => false),
  redactSecrets: vi.fn((t: string) => t.replace(/secret/g, '***')),
}));

vi.mock('../sandbox.js', () => ({
  getSandboxManager: vi.fn(() => ({
    destroySessionContainer: vi.fn(() => Promise.resolve()),
  })),
}));

import { ToolSessionManager } from '../session-manager.js';
import type { ToolSession } from '../types.js';

describe('ToolSessionManager', () => {
  let manager: ToolSessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new ToolSessionManager();
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
  });

  // ===========================================================================
  // create
  // ===========================================================================

  describe('create', () => {
    it('creates a session with a unique id and timestamp', () => {
      const session = manager.create({
        toolName: 'exec',
        conversationId: 'conv-1',
        toolCallId: 'tc-1',
        status: 'pending',
        stdout: '',
        stderr: '',
        truncated: false,
        backgrounded: false,
        notifyOnExit: false,
        exitCode: null,
        exitSignal: null,
        completedAt: null,
        startedAt: null,
        pid: null,
      });

      expect(session.id).toHaveLength(8);
      expect(session.createdAt).toBeGreaterThan(0);
      expect(session.toolName).toBe('exec');
      expect(session.conversationId).toBe('conv-1');
    });

    it('enforces max sessions limit by cleaning oldest', () => {
      // Create 500 sessions
      for (let i = 0; i < 500; i++) {
        const s = manager.create({
          toolName: 'exec',
          conversationId: `conv-${i}`,
          toolCallId: `tc-${i}`,
          status: 'completed',
          stdout: '',
          stderr: '',
          truncated: false,
          backgrounded: false,
          notifyOnExit: false,
          exitCode: null,
          exitSignal: null,
          completedAt: null,
          startedAt: null,
          pid: null,
        });
        // Mark as completed so they're eligible for cleanup
        manager.update(s.id, { status: 'completed' });
      }

      // 501st session should trigger cleanup
      const session = manager.create({
        toolName: 'exec',
        conversationId: 'conv-new',
        toolCallId: 'tc-new',
        status: 'pending',
        stdout: '',
        stderr: '',
        truncated: false,
        backgrounded: false,
        notifyOnExit: false,
        exitCode: null,
        exitSignal: null,
        completedAt: null,
        startedAt: null,
        pid: null,
      });

      expect(session).toBeDefined();
      // After cleanup of 50 oldest + the new one added, total should be <= 500
      expect(manager.list().length).toBeLessThanOrEqual(500);
    });
  });

  // ===========================================================================
  // get / update
  // ===========================================================================

  describe('get and update', () => {
    it('returns undefined for unknown session', () => {
      expect(manager.get('nonexistent')).toBeUndefined();
    });

    it('gets a session by id', () => {
      const created = manager.create({
        toolName: 'exec',
        conversationId: 'conv-1',
        toolCallId: 'tc-1',
        status: 'pending',
        stdout: '',
        stderr: '',
        truncated: false,
        backgrounded: false,
        notifyOnExit: false,
        exitCode: null,
        exitSignal: null,
        completedAt: null,
        startedAt: null,
        pid: null,
      });

      const fetched = manager.get(created.id);
      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(created.id);
    });

    it('updates session fields', () => {
      const session = manager.create({
        toolName: 'exec',
        conversationId: 'conv-1',
        toolCallId: 'tc-1',
        status: 'pending',
        stdout: '',
        stderr: '',
        truncated: false,
        backgrounded: false,
        notifyOnExit: false,
        exitCode: null,
        exitSignal: null,
        completedAt: null,
        startedAt: null,
        pid: null,
      });

      manager.update(session.id, { status: 'running', pid: 1234 });

      const updated = manager.get(session.id);
      expect(updated!.status).toBe('running');
      expect(updated!.pid).toBe(1234);
    });

    it('update is no-op for unknown session', () => {
      // Should not throw
      manager.update('nonexistent', { status: 'running' });
    });
  });

  // ===========================================================================
  // list with filters
  // ===========================================================================

  describe('list', () => {
    function createSession(overrides: Partial<ToolSession> = {}): ToolSession {
      return manager.create({
        toolName: overrides.toolName ?? 'exec',
        conversationId: overrides.conversationId ?? 'conv-1',
        toolCallId: overrides.toolCallId ?? 'tc-1',
        status: overrides.status ?? 'pending',
        stdout: '',
        stderr: '',
        truncated: false,
        backgrounded: false,
        notifyOnExit: false,
        exitCode: null,
        exitSignal: null,
        completedAt: null,
        startedAt: null,
        pid: null,
      });
    }

    it('returns all sessions without filter', () => {
      createSession();
      createSession();
      expect(manager.list()).toHaveLength(2);
    });

    it('filters by conversationId', () => {
      createSession({ conversationId: 'conv-a' });
      createSession({ conversationId: 'conv-b' });

      const result = manager.list({ conversationId: 'conv-a' });
      expect(result).toHaveLength(1);
      expect(result[0].conversationId).toBe('conv-a');
    });

    it('filters by toolName', () => {
      createSession({ toolName: 'exec' });
      createSession({ toolName: 'file-ops' });

      const result = manager.list({ toolName: 'exec' });
      expect(result).toHaveLength(1);
      expect(result[0].toolName).toBe('exec');
    });

    it('filters by status', () => {
      const s1 = createSession();
      const s2 = createSession();
      manager.update(s1.id, { status: 'running' });
      manager.update(s2.id, { status: 'completed' });

      const result = manager.list({ status: ['running'] });
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('running');
    });

    it('filters by since timestamp', () => {
      createSession();
      vi.advanceTimersByTime(10_000);
      const laterSession = createSession();

      const since = laterSession.createdAt - 1;
      const result = manager.list({ since });
      expect(result).toHaveLength(1);
    });
  });

  // ===========================================================================
  // appendOutput
  // ===========================================================================

  describe('appendOutput', () => {
    it('appends stdout to session', () => {
      const session = manager.create({
        toolName: 'exec',
        conversationId: 'conv-1',
        toolCallId: 'tc-1',
        status: 'running',
        stdout: '',
        stderr: '',
        truncated: false,
        backgrounded: false,
        notifyOnExit: false,
        exitCode: null,
        exitSignal: null,
        completedAt: null,
        startedAt: null,
        pid: null,
      });

      manager.appendOutput(session.id, 'stdout', 'hello ');
      manager.appendOutput(session.id, 'stdout', 'world');

      const updated = manager.get(session.id);
      expect(updated!.stdout).toBe('hello world');
    });

    it('appends stderr to session', () => {
      const session = manager.create({
        toolName: 'exec',
        conversationId: 'conv-1',
        toolCallId: 'tc-1',
        status: 'running',
        stdout: '',
        stderr: '',
        truncated: false,
        backgrounded: false,
        notifyOnExit: false,
        exitCode: null,
        exitSignal: null,
        completedAt: null,
        startedAt: null,
        pid: null,
      });

      manager.appendOutput(session.id, 'stderr', 'error line');

      expect(manager.get(session.id)!.stderr).toBe('error line');
    });

    it('truncates when output exceeds max', () => {
      const session = manager.create({
        toolName: 'exec',
        conversationId: 'conv-1',
        toolCallId: 'tc-1',
        status: 'running',
        stdout: '',
        stderr: '',
        truncated: false,
        backgrounded: false,
        notifyOnExit: false,
        maxOutputChars: 100,
        exitCode: null,
        exitSignal: null,
        completedAt: null,
        startedAt: null,
        pid: null,
      });

      // Write enough to exceed maxOutputChars and trigger tail truncation
      // TAIL_CHARS is 10_000 so stdout needs to exceed that after total > maxOutputChars
      manager.appendOutput(session.id, 'stdout', 'A'.repeat(50));
      manager.appendOutput(session.id, 'stderr', 'B'.repeat(60));

      const updated = manager.get(session.id);
      expect(updated!.truncated).toBe(true);
    });

    it('notifies listeners on output', () => {
      const session = manager.create({
        toolName: 'exec',
        conversationId: 'conv-1',
        toolCallId: 'tc-1',
        status: 'running',
        stdout: '',
        stderr: '',
        truncated: false,
        backgrounded: false,
        notifyOnExit: false,
        exitCode: null,
        exitSignal: null,
        completedAt: null,
        startedAt: null,
        pid: null,
      });

      const events: Array<{ stream: string; data: string }> = [];
      manager.subscribe(session.id, (event) => {
        events.push({ stream: event.stream, data: event.data });
      });

      manager.appendOutput(session.id, 'stdout', 'line1');
      manager.appendOutput(session.id, 'stderr', 'err1');

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ stream: 'stdout', data: 'line1' });
      expect(events[1]).toEqual({ stream: 'stderr', data: 'err1' });
    });

    it('is no-op for unknown session', () => {
      // Should not throw
      manager.appendOutput('nonexistent', 'stdout', 'data');
    });
  });

  // ===========================================================================
  // subscribe / unsubscribe
  // ===========================================================================

  describe('subscribe', () => {
    it('returns unsubscribe function', () => {
      const session = manager.create({
        toolName: 'exec',
        conversationId: 'conv-1',
        toolCallId: 'tc-1',
        status: 'running',
        stdout: '',
        stderr: '',
        truncated: false,
        backgrounded: false,
        notifyOnExit: false,
        exitCode: null,
        exitSignal: null,
        completedAt: null,
        startedAt: null,
        pid: null,
      });

      const events: unknown[] = [];
      const unsub = manager.subscribe(session.id, (e) => events.push(e));

      manager.appendOutput(session.id, 'stdout', 'before');
      unsub();
      manager.appendOutput(session.id, 'stdout', 'after');

      expect(events).toHaveLength(1);
    });

    it('returns no-op unsubscribe for unknown session', () => {
      const unsub = manager.subscribe('nonexistent', () => {});
      expect(typeof unsub).toBe('function');
      unsub(); // should not throw
    });
  });

  // ===========================================================================
  // getOutput / getTail
  // ===========================================================================

  describe('getOutput and getTail', () => {
    it('returns combined output with stderr prefix', () => {
      const session = manager.create({
        toolName: 'exec',
        conversationId: 'conv-1',
        toolCallId: 'tc-1',
        status: 'running',
        stdout: '',
        stderr: '',
        truncated: false,
        backgrounded: false,
        notifyOnExit: false,
        exitCode: null,
        exitSignal: null,
        completedAt: null,
        startedAt: null,
        pid: null,
      });

      manager.appendOutput(session.id, 'stdout', 'output line');
      manager.appendOutput(session.id, 'stderr', 'error line');

      const output = manager.getOutput(session.id);
      expect(output).toContain('output line');
      expect(output).toContain('stderr: error line');
    });

    it('returns empty string for unknown session', () => {
      expect(manager.getOutput('nonexistent')).toBe('');
    });

    it('getTail returns last N chars', () => {
      const session = manager.create({
        toolName: 'exec',
        conversationId: 'conv-1',
        toolCallId: 'tc-1',
        status: 'running',
        stdout: '',
        stderr: '',
        truncated: false,
        backgrounded: false,
        notifyOnExit: false,
        exitCode: null,
        exitSignal: null,
        completedAt: null,
        startedAt: null,
        pid: null,
      });

      manager.appendOutput(session.id, 'stdout', 'A'.repeat(100));

      const tail = manager.getTail(session.id, 20);
      expect(tail).toContain('[...]');
      expect(tail.length).toBeLessThan(100);
    });
  });

  // ===========================================================================
  // background
  // ===========================================================================

  describe('background', () => {
    it('sets backgrounded flag', () => {
      const session = manager.create({
        toolName: 'exec',
        conversationId: 'conv-1',
        toolCallId: 'tc-1',
        status: 'running',
        stdout: '',
        stderr: '',
        truncated: false,
        backgrounded: false,
        notifyOnExit: false,
        exitCode: null,
        exitSignal: null,
        completedAt: null,
        startedAt: null,
        pid: null,
      });

      manager.background(session.id);
      expect(manager.get(session.id)!.backgrounded).toBe(true);
    });
  });

  // ===========================================================================
  // cleanup
  // ===========================================================================

  describe('cleanup', () => {
    it('removes completed sessions older than max age', () => {
      const session = manager.create({
        toolName: 'exec',
        conversationId: 'conv-1',
        toolCallId: 'tc-1',
        status: 'completed',
        stdout: '',
        stderr: '',
        truncated: false,
        backgrounded: false,
        notifyOnExit: false,
        exitCode: null,
        exitSignal: null,
        completedAt: null,
        startedAt: null,
        pid: null,
      });

      // Advance past 1 hour
      vi.advanceTimersByTime(3600_001);
      manager.cleanup();

      expect(manager.get(session.id)).toBeUndefined();
    });

    it('removes very old pending sessions', () => {
      const session = manager.create({
        toolName: 'exec',
        conversationId: 'conv-1',
        toolCallId: 'tc-1',
        status: 'pending',
        stdout: '',
        stderr: '',
        truncated: false,
        backgrounded: false,
        notifyOnExit: false,
        exitCode: null,
        exitSignal: null,
        completedAt: null,
        startedAt: null,
        pid: null,
      });

      // Advance past 2 hours
      vi.advanceTimersByTime(7200_001);
      manager.cleanup();

      expect(manager.get(session.id)).toBeUndefined();
    });

    it('keeps running sessions', () => {
      const session = manager.create({
        toolName: 'exec',
        conversationId: 'conv-1',
        toolCallId: 'tc-1',
        status: 'running',
        stdout: '',
        stderr: '',
        truncated: false,
        backgrounded: false,
        notifyOnExit: false,
        exitCode: null,
        exitSignal: null,
        completedAt: null,
        startedAt: null,
        pid: null,
      });

      vi.advanceTimersByTime(3600_001);
      manager.cleanup();

      expect(manager.get(session.id)).toBeDefined();
    });

    it('runs automatically via interval', () => {
      const session = manager.create({
        toolName: 'exec',
        conversationId: 'conv-1',
        toolCallId: 'tc-1',
        status: 'completed',
        stdout: '',
        stderr: '',
        truncated: false,
        backgrounded: false,
        notifyOnExit: false,
        exitCode: null,
        exitSignal: null,
        completedAt: null,
        startedAt: null,
        pid: null,
      });

      // Advance past max age + cleanup interval
      vi.advanceTimersByTime(3600_000 + 60_001);

      expect(manager.get(session.id)).toBeUndefined();
    });
  });

  // ===========================================================================
  // destroy
  // ===========================================================================

  describe('destroy', () => {
    it('clears all sessions', () => {
      manager.create({
        toolName: 'exec',
        conversationId: 'conv-1',
        toolCallId: 'tc-1',
        status: 'pending',
        stdout: '',
        stderr: '',
        truncated: false,
        backgrounded: false,
        notifyOnExit: false,
        exitCode: null,
        exitSignal: null,
        completedAt: null,
        startedAt: null,
        pid: null,
      });

      manager.destroy();
      expect(manager.list()).toHaveLength(0);
    });
  });
});
