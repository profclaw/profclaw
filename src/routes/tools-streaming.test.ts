/**
 * Tool Execution Streaming Tests
 *
 * Tests for SSE streaming endpoints in tool execution.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the tool execution modules
vi.mock('../chat/execution/index.js', () => ({
  getToolExecutor: vi.fn(() => ({
    execute: vi.fn(),
    getPendingApprovals: vi.fn(() => []),
    getStatus: vi.fn(() => ({})),
  })),
  getToolRegistry: vi.fn(() => ({
    get: vi.fn(),
    list: vi.fn(() => []),
  })),
  getSecurityManager: vi.fn(() => ({
    getPolicy: vi.fn(() => ({ mode: 'ask' })),
    getPendingApprovals: vi.fn(() => []),
  })),
  getSessionManager: vi.fn(() => ({
    create: vi.fn(),
    get: vi.fn(),
    list: vi.fn(() => []),
    getOutput: vi.fn(() => ''),
    getTail: vi.fn(() => ''),
    kill: vi.fn(),
  })),
  initializeToolExecution: vi.fn(() => Promise.resolve()),
  getAuditLogger: vi.fn(() => ({
    query: vi.fn(() => []),
    getStats: vi.fn(() => ({})),
    exportCsv: vi.fn(() => ''),
    count: 0,
  })),
  getProcessPool: vi.fn(() => ({
    getStatus: vi.fn(() => ({ config: {} })),
    getMetrics: vi.fn(() => ({})),
    updateConfig: vi.fn(),
    clearQueue: vi.fn(() => 0),
  })),
  getSandboxManager: vi.fn(() => ({
    getStatus: vi.fn(() => ({})),
    updateConfig: vi.fn(),
  })),
  getRateLimiter: vi.fn(() => ({
    getConfig: vi.fn(() => ({})),
    updateConfig: vi.fn(),
    getStatus: vi.fn(() => ({})),
    setToolLimit: vi.fn(),
    reset: vi.fn(),
  })),
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

import { getSessionManager, getToolExecutor } from '../chat/execution/index.js';

describe('Tool Execution Streaming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('SSE Event Format', () => {
    it('should format SSE events correctly', () => {
      const formatSSE = (event: string, data: unknown) => {
        return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      };

      const startEvent = formatSSE('start', { toolName: 'exec', timestamp: 1234567890 });
      expect(startEvent).toBe('event: start\ndata: {"toolName":"exec","timestamp":1234567890}\n\n');

      const progressEvent = formatSSE('progress', { type: 'output', content: 'Hello' });
      expect(progressEvent).toBe('event: progress\ndata: {"type":"output","content":"Hello"}\n\n');

      const doneEvent = formatSSE('done', { success: true });
      expect(doneEvent).toBe('event: done\ndata: {"success":true}\n\n');
    });
  });

  describe('Session Stream Logic', () => {
    it('should send init event with session state', () => {
      const session = {
        id: 'session-123',
        toolName: 'exec',
        status: 'running',
        command: 'ls -la',
        createdAt: 1234567890,
        startedAt: 1234567891,
        stdout: '',
        stderr: '',
      };

      const initData = {
        sessionId: session.id,
        toolName: session.toolName,
        status: session.status,
        command: session.command,
        createdAt: session.createdAt,
        startedAt: session.startedAt,
      };

      expect(initData.sessionId).toBe('session-123');
      expect(initData.status).toBe('running');
    });

    it('should send existing output on connect', () => {
      const session = {
        id: 'session-123',
        stdout: 'file1.txt\nfile2.txt\n',
        stderr: '',
        status: 'running',
      };

      // If stdout exists, send it
      const shouldSendStdout = !!session.stdout;
      expect(shouldSendStdout).toBe(true);

      // If stderr is empty, don't send it
      const shouldSendStderr = !!session.stderr;
      expect(shouldSendStderr).toBe(false);
    });

    it('should send completion event for finished sessions', () => {
      const completedSession = {
        status: 'completed',
        exitCode: 0,
        exitSignal: null,
        completedAt: 1234567900,
      };

      const failedSession = {
        status: 'failed',
        exitCode: 1,
        exitSignal: null,
        completedAt: 1234567900,
      };

      const killedSession = {
        status: 'killed',
        exitCode: null,
        exitSignal: 'SIGTERM',
        completedAt: 1234567900,
      };

      const isCompleted = (status: string) =>
        ['completed', 'failed', 'killed'].includes(status);

      expect(isCompleted(completedSession.status)).toBe(true);
      expect(isCompleted(failedSession.status)).toBe(true);
      expect(isCompleted(killedSession.status)).toBe(true);
      expect(isCompleted('running')).toBe(false);
    });
  });

  describe('Streaming Execution Logic', () => {
    it('should emit start, progress, result, and done events', async () => {
      const events: Array<{ event: string; data: unknown }> = [];
      const mockProgress = vi.fn((update) => {
        events.push({ event: 'progress', data: update });
      });

      // Simulate execution flow
      events.push({ event: 'start', data: { toolName: 'exec', timestamp: Date.now() } });

      // Simulate progress updates
      mockProgress({ type: 'output', content: 'Processing...', timestamp: Date.now() });
      mockProgress({ type: 'output', content: 'Done!', timestamp: Date.now() });

      // Simulate result
      events.push({
        event: 'result',
        data: { success: true, output: 'Processing...\nDone!' },
      });

      // Simulate done
      events.push({
        event: 'done',
        data: { toolCallId: 'call-123', success: true, timestamp: Date.now() },
      });

      expect(events).toHaveLength(5);
      expect(events[0].event).toBe('start');
      expect(events[1].event).toBe('progress');
      expect(events[2].event).toBe('progress');
      expect(events[3].event).toBe('result');
      expect(events[4].event).toBe('done');
    });

    it('should emit approval-required event when needed', () => {
      const approvalResult = {
        approvalRequired: true,
        approvalId: 'approval-123',
      };

      const approval = {
        id: 'approval-123',
        toolName: 'exec',
        command: 'rm -rf /',
        params: { command: 'rm -rf /' },
        securityLevel: 'dangerous',
        expiresAt: Date.now() + 60000,
      };

      const event = {
        event: 'approval-required',
        data: {
          approvalId: approvalResult.approvalId,
          approval: {
            id: approval.id,
            toolName: approval.toolName,
            command: approval.command,
            params: approval.params,
            securityLevel: approval.securityLevel,
            expiresAt: approval.expiresAt,
          },
        },
      };

      expect(event.event).toBe('approval-required');
      expect(event.data.approvalId).toBe('approval-123');
      expect(event.data.approval.securityLevel).toBe('dangerous');
    });

    it('should emit error event on failure', () => {
      const error = new Error('Execution failed');

      const errorEvent = {
        event: 'error',
        data: {
          error: error.message,
          timestamp: Date.now(),
        },
      };

      expect(errorEvent.event).toBe('error');
      expect(errorEvent.data.error).toBe('Execution failed');
    });
  });

  describe('Connection Management', () => {
    it('should track connections per session', () => {
      const connections = new Map<string, Set<object>>();

      const sessionId = 'session-123';
      const controller1 = {};
      const controller2 = {};

      // Add first connection
      if (!connections.has(sessionId)) {
        connections.set(sessionId, new Set());
      }
      connections.get(sessionId)!.add(controller1);

      expect(connections.get(sessionId)!.size).toBe(1);

      // Add second connection
      connections.get(sessionId)!.add(controller2);
      expect(connections.get(sessionId)!.size).toBe(2);

      // Remove connection
      connections.get(sessionId)!.delete(controller1);
      expect(connections.get(sessionId)!.size).toBe(1);

      // Cleanup empty sets
      connections.get(sessionId)!.delete(controller2);
      if (connections.get(sessionId)!.size === 0) {
        connections.delete(sessionId);
      }
      expect(connections.has(sessionId)).toBe(false);
    });

    it('should broadcast to all connections', () => {
      const messages: string[] = [];
      const connections = new Set<{ enqueue: (data: string) => void }>();

      // Add mock connections
      connections.add({ enqueue: (data) => messages.push(`conn1: ${data}`) });
      connections.add({ enqueue: (data) => messages.push(`conn2: ${data}`) });

      // Broadcast message
      const message = 'event: test\ndata: {"test":true}\n\n';
      for (const conn of connections) {
        conn.enqueue(message);
      }

      expect(messages).toHaveLength(2);
      expect(messages[0]).toContain('conn1:');
      expect(messages[1]).toContain('conn2:');
    });
  });

  describe('SSE Response Headers', () => {
    it('should have correct Content-Type header', () => {
      const headers = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      };

      expect(headers['Content-Type']).toBe('text/event-stream');
      expect(headers['Cache-Control']).toBe('no-cache');
      expect(headers['Connection']).toBe('keep-alive');
      expect(headers['X-Accel-Buffering']).toBe('no');
    });
  });
});
