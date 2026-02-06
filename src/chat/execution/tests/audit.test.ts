import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { AuditLogger, getAuditLogger, initAuditLogger, type AuditEntry } from '../audit.js';

describe('AuditLogger', () => {
  let audit: AuditLogger;

  beforeEach(() => {
    audit = new AuditLogger();
  });

  // ===========================================================================
  // logExecution
  // ===========================================================================

  describe('logExecution', () => {
    it('records a successful execution', () => {
      const entry = audit.logExecution({
        toolName: 'exec',
        toolCallId: 'tc-1',
        conversationId: 'conv-1',
        userId: 'user-1',
        success: true,
        durationMs: 250,
        exitCode: 0,
      });

      expect(entry.id).toBeDefined();
      expect(entry.eventType).toBe('tool_execution');
      expect(entry.toolName).toBe('exec');
      expect(entry.success).toBe(true);
      expect(entry.durationMs).toBe(250);
      expect(entry.timestamp).toBeGreaterThan(0);
    });

    it('records a failed execution', () => {
      const entry = audit.logExecution({
        toolName: 'exec',
        toolCallId: 'tc-2',
        conversationId: 'conv-1',
        success: false,
        error: 'Process exited with code 1',
        exitCode: 1,
      });

      expect(entry.success).toBe(false);
      expect(entry.exitCode).toBe(1);
    });

    it('truncates output for storage', () => {
      const entry = audit.logExecution({
        toolName: 'exec',
        toolCallId: 'tc-3',
        conversationId: 'conv-1',
        success: true,
        output: 'X'.repeat(1000),
      });

      expect(entry.outputPreview).toBeDefined();
      // 500 chars + '...[truncated]' suffix
      expect(entry.outputPreview!.length).toBeLessThanOrEqual(520);
    });

    it('stores short output without truncation', () => {
      const shortOutput = 'hello world';
      const entry = audit.logExecution({
        toolName: 'exec',
        toolCallId: 'tc-4',
        conversationId: 'conv-1',
        success: true,
        output: shortOutput,
      });

      expect(entry.outputPreview).toBe(shortOutput);
    });

    it('does not set outputPreview when no output provided', () => {
      const entry = audit.logExecution({
        toolName: 'exec',
        toolCallId: 'tc-5',
        conversationId: 'conv-1',
        success: true,
      });

      expect(entry.outputPreview).toBeUndefined();
    });

    it('stores command field when provided', () => {
      const entry = audit.logExecution({
        toolName: 'exec',
        toolCallId: 'tc-6',
        conversationId: 'conv-1',
        success: true,
        command: 'ls -la',
      });

      expect(entry.command).toBe('ls -la');
    });

    it('stores exitCode null when process was killed', () => {
      const entry = audit.logExecution({
        toolName: 'exec',
        toolCallId: 'tc-7',
        conversationId: 'conv-1',
        success: false,
        exitCode: null,
        error: 'Process killed',
      });

      expect(entry.exitCode).toBeNull();
    });

    it('increments the entry count', () => {
      expect(audit.count).toBe(0);
      audit.logExecution({ toolName: 'exec', toolCallId: 'tc-1', conversationId: 'conv-1', success: true });
      audit.logExecution({ toolName: 'exec', toolCallId: 'tc-2', conversationId: 'conv-1', success: true });
      expect(audit.count).toBe(2);
    });

    it('assigns unique ids to each entry', () => {
      const a = audit.logExecution({ toolName: 'exec', toolCallId: 'tc-1', conversationId: 'conv-1', success: true });
      const b = audit.logExecution({ toolName: 'exec', toolCallId: 'tc-2', conversationId: 'conv-1', success: true });
      expect(a.id).not.toBe(b.id);
    });
  });

  // ===========================================================================
  // Param sanitization
  // ===========================================================================

  describe('param sanitization', () => {
    it('redacts password fields', () => {
      const entry = audit.logExecution({
        toolName: 'exec',
        toolCallId: 'tc-1',
        conversationId: 'conv-1',
        success: true,
        params: { password: 'super-secret', username: 'alice' },
      });

      expect(entry.params!['password']).toBe('[REDACTED]');
      expect(entry.params!['username']).toBe('alice');
    });

    it('redacts token fields', () => {
      const entry = audit.logExecution({
        toolName: 'exec',
        toolCallId: 'tc-1',
        conversationId: 'conv-1',
        success: true,
        params: { authToken: 'Bearer xyz', data: 'ok' },
      });

      expect(entry.params!['authToken']).toBe('[REDACTED]');
      expect(entry.params!['data']).toBe('ok');
    });

    it('redacts secret fields', () => {
      const entry = audit.logExecution({
        toolName: 'exec',
        toolCallId: 'tc-1',
        conversationId: 'conv-1',
        success: true,
        params: { apiSecret: 'abc123', name: 'tool' },
      });

      expect(entry.params!['apiSecret']).toBe('[REDACTED]');
    });

    it('truncates very long string param values', () => {
      const entry = audit.logExecution({
        toolName: 'exec',
        toolCallId: 'tc-1',
        conversationId: 'conv-1',
        success: true,
        params: { body: 'Y'.repeat(2000) },
      });

      const body = entry.params!['body'] as string;
      expect(body.length).toBeLessThan(2000);
      expect(body).toContain('...[truncated]');
    });

    it('preserves params when none are provided', () => {
      const entry = audit.logExecution({
        toolName: 'exec',
        toolCallId: 'tc-1',
        conversationId: 'conv-1',
        success: true,
      });

      expect(entry.params).toBeUndefined();
    });
  });

  // ===========================================================================
  // logApprovalRequested / logApprovalDecision
  // ===========================================================================

  describe('approval logging', () => {
    it('logs approval request', () => {
      const entry = audit.logApprovalRequested({
        toolName: 'exec',
        toolCallId: 'tc-1',
        conversationId: 'conv-1',
        approvalId: 'apr-1',
        securityLevel: 'moderate',
      });

      expect(entry.eventType).toBe('approval_requested');
      expect(entry.approvalId).toBe('apr-1');
      expect(entry.securityLevel).toBe('moderate');
    });

    it('logs approval granted', () => {
      const entry = audit.logApprovalDecision({
        toolName: 'exec',
        toolCallId: 'tc-1',
        conversationId: 'conv-1',
        approvalId: 'apr-1',
        decision: 'allow-once',
      });

      expect(entry.eventType).toBe('approval_granted');
      expect(entry.approvalDecision).toBe('allow-once');
    });

    it('logs allow-always as approval granted', () => {
      const entry = audit.logApprovalDecision({
        toolName: 'exec',
        toolCallId: 'tc-1',
        conversationId: 'conv-1',
        approvalId: 'apr-2',
        decision: 'allow-always',
      });

      expect(entry.eventType).toBe('approval_granted');
      expect(entry.approvalDecision).toBe('allow-always');
    });

    it('logs approval denied', () => {
      const entry = audit.logApprovalDecision({
        toolName: 'exec',
        toolCallId: 'tc-1',
        conversationId: 'conv-1',
        approvalId: 'apr-1',
        decision: 'deny',
      });

      expect(entry.eventType).toBe('approval_denied');
    });

    it('logs approval expired', () => {
      const entry = audit.logApprovalExpired({
        toolName: 'exec',
        toolCallId: 'tc-1',
        conversationId: 'conv-1',
        approvalId: 'apr-1',
      });

      expect(entry.eventType).toBe('approval_expired');
    });

    it('stores approvalId on expired entry', () => {
      const entry = audit.logApprovalExpired({
        toolName: 'exec',
        toolCallId: 'tc-1',
        conversationId: 'conv-1',
        approvalId: 'apr-99',
      });

      expect(entry.approvalId).toBe('apr-99');
    });
  });

  // ===========================================================================
  // logSecurityDenied / logRateLimited / logTimeout / logError
  // ===========================================================================

  describe('security and rate limit logging', () => {
    it('logs security denial', () => {
      const entry = audit.logSecurityDenied({
        toolName: 'exec',
        toolCallId: 'tc-1',
        conversationId: 'conv-1',
        securityMode: 'deny',
        reason: 'Tool execution disabled',
      });

      expect(entry.eventType).toBe('security_denied');
      expect(entry.denialReason).toBe('Tool execution disabled');
      expect(entry.securityMode).toBe('deny');
    });

    it('logs security denial with command context', () => {
      const entry = audit.logSecurityDenied({
        toolName: 'exec',
        toolCallId: 'tc-1',
        conversationId: 'conv-1',
        securityMode: 'restricted',
        reason: 'Pattern blocked',
        command: 'rm -rf /',
      });

      expect(entry.command).toBe('rm -rf /');
      expect(entry.denialReason).toBe('Pattern blocked');
    });

    it('logs rate limiting', () => {
      const entry = audit.logRateLimited({
        toolName: 'exec',
        toolCallId: 'tc-1',
        conversationId: 'conv-1',
        limit: 100,
        remaining: 0,
        resetAt: Date.now() + 60000,
      });

      expect(entry.eventType).toBe('rate_limited');
      expect(entry.rateLimit).toBeDefined();
      expect(entry.rateLimit!.limit).toBe(100);
      expect(entry.rateLimit!.remaining).toBe(0);
    });

    it('stores resetAt on rate limit entry', () => {
      const resetAt = Date.now() + 30_000;
      const entry = audit.logRateLimited({
        toolName: 'exec',
        toolCallId: 'tc-1',
        conversationId: 'conv-1',
        limit: 50,
        remaining: 0,
        resetAt,
      });

      expect(entry.rateLimit!.resetAt).toBe(resetAt);
    });

    it('logs timeout', () => {
      const entry = audit.logTimeout({
        toolName: 'exec',
        toolCallId: 'tc-1',
        conversationId: 'conv-1',
        durationMs: 300_000,
      });

      expect(entry.eventType).toBe('timeout');
      expect(entry.durationMs).toBe(300_000);
    });

    it('logs error', () => {
      const entry = audit.logError({
        toolName: 'exec',
        toolCallId: 'tc-1',
        conversationId: 'conv-1',
        error: 'Spawn failed',
      });

      expect(entry.eventType).toBe('error');
      expect(entry.error).toBe('Spawn failed');
    });

    it('stores userId on error entry when provided', () => {
      const entry = audit.logError({
        toolName: 'exec',
        toolCallId: 'tc-1',
        conversationId: 'conv-1',
        userId: 'user-99',
        error: 'Internal error',
      });

      expect(entry.userId).toBe('user-99');
    });
  });

  // ===========================================================================
  // query
  // ===========================================================================

  describe('query', () => {
    beforeEach(() => {
      audit.logExecution({
        toolName: 'exec',
        toolCallId: 'tc-1',
        conversationId: 'conv-1',
        userId: 'user-1',
        success: true,
      });
      audit.logExecution({
        toolName: 'file-ops',
        toolCallId: 'tc-2',
        conversationId: 'conv-2',
        userId: 'user-2',
        success: false,
      });
      audit.logSecurityDenied({
        toolName: 'exec',
        toolCallId: 'tc-3',
        conversationId: 'conv-1',
        securityMode: 'deny',
        reason: 'disabled',
      });
    });

    it('returns all entries without filter', () => {
      const results = audit.query();
      expect(results).toHaveLength(3);
    });

    it('filters by event type', () => {
      const results = audit.query({ eventTypes: ['tool_execution'] });
      expect(results).toHaveLength(2);
    });

    it('filters by multiple event types', () => {
      const results = audit.query({ eventTypes: ['tool_execution', 'security_denied'] });
      expect(results).toHaveLength(3);
    });

    it('filters by tool name', () => {
      const results = audit.query({ toolName: 'exec' });
      expect(results).toHaveLength(2);
    });

    it('filters by conversation', () => {
      const results = audit.query({ conversationId: 'conv-1' });
      expect(results).toHaveLength(2);
    });

    it('filters by user', () => {
      const results = audit.query({ userId: 'user-2' });
      expect(results).toHaveLength(1);
      expect(results[0].userId).toBe('user-2');
    });

    it('filters by success', () => {
      const results = audit.query({ success: true });
      expect(results).toHaveLength(1);
    });

    it('filters by success false', () => {
      const results = audit.query({ success: false });
      expect(results).toHaveLength(1);
      expect(results[0].toolName).toBe('file-ops');
    });

    it('sorts by timestamp descending', () => {
      const results = audit.query();
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].timestamp).toBeGreaterThanOrEqual(results[i].timestamp);
      }
    });

    it('applies pagination with offset and limit', () => {
      const page1 = audit.query({ limit: 2, offset: 0 });
      const page2 = audit.query({ limit: 2, offset: 2 });

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(1);
    });

    it('returns empty array when offset exceeds total', () => {
      const results = audit.query({ offset: 100, limit: 10 });
      expect(results).toHaveLength(0);
    });

    it('filters by since timestamp', () => {
      const future = Date.now() + 999_999;
      const results = audit.query({ since: future });
      expect(results).toHaveLength(0);
    });

    it('filters by until timestamp', () => {
      const past = Date.now() - 999_999;
      const results = audit.query({ until: past });
      expect(results).toHaveLength(0);
    });

    it('returns entries within since-until range', () => {
      const before = Date.now() - 1000;
      const after = Date.now() + 1000;
      const results = audit.query({ since: before, until: after });
      expect(results).toHaveLength(3);
    });
  });

  // ===========================================================================
  // getEntry
  // ===========================================================================

  describe('getEntry', () => {
    it('returns entry by id', () => {
      const created = audit.logExecution({
        toolName: 'exec',
        toolCallId: 'tc-1',
        conversationId: 'conv-1',
        success: true,
      });

      const found = audit.get(created.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
    });

    it('returns undefined for unknown id', () => {
      expect(audit.get('nonexistent')).toBeUndefined();
    });
  });

  // ===========================================================================
  // getStats
  // ===========================================================================

  describe('getStats', () => {
    it('computes statistics over entries', () => {
      audit.logExecution({
        toolName: 'exec',
        toolCallId: 'tc-1',
        conversationId: 'conv-1',
        success: true,
        durationMs: 100,
      });
      audit.logExecution({
        toolName: 'exec',
        toolCallId: 'tc-2',
        conversationId: 'conv-1',
        success: true,
        durationMs: 200,
      });
      audit.logExecution({
        toolName: 'file-ops',
        toolCallId: 'tc-3',
        conversationId: 'conv-1',
        success: false,
        durationMs: 50,
      });

      const stats = audit.getStats();
      expect(stats.totalEvents).toBe(3);
      expect(stats.byTool['exec']).toBe(2);
      expect(stats.byTool['file-ops']).toBe(1);
      expect(stats.byEventType['tool_execution']).toBe(3);
    });

    it('computes correct success rate', () => {
      audit.logExecution({ toolName: 'exec', toolCallId: 'tc-1', conversationId: 'conv-1', success: true });
      audit.logExecution({ toolName: 'exec', toolCallId: 'tc-2', conversationId: 'conv-1', success: true });
      audit.logExecution({ toolName: 'exec', toolCallId: 'tc-3', conversationId: 'conv-1', success: false });

      const stats = audit.getStats();
      // 2 of 3 succeeded
      expect(stats.successRate).toBeCloseTo(66.67, 1);
    });

    it('returns zero success rate with no executions', () => {
      audit.logSecurityDenied({
        toolName: 'exec',
        toolCallId: 'tc-1',
        conversationId: 'conv-1',
        securityMode: 'deny',
        reason: 'blocked',
      });

      const stats = audit.getStats();
      expect(stats.successRate).toBe(0);
    });

    it('computes average duration', () => {
      audit.logExecution({ toolName: 'exec', toolCallId: 'tc-1', conversationId: 'conv-1', success: true, durationMs: 100 });
      audit.logExecution({ toolName: 'exec', toolCallId: 'tc-2', conversationId: 'conv-1', success: true, durationMs: 300 });

      const stats = audit.getStats();
      expect(stats.avgDurationMs).toBe(200);
    });

    it('returns zero avg duration when no executions have duration', () => {
      audit.logExecution({ toolName: 'exec', toolCallId: 'tc-1', conversationId: 'conv-1', success: true });

      const stats = audit.getStats();
      expect(stats.avgDurationMs).toBe(0);
    });

    it('returns zeroed timeRange when no entries exist', () => {
      const stats = audit.getStats();
      expect(stats.timeRange.earliest).toBe(0);
      expect(stats.timeRange.latest).toBe(0);
    });

    it('computes timeRange correctly', () => {
      audit.logExecution({ toolName: 'exec', toolCallId: 'tc-1', conversationId: 'conv-1', success: true });
      audit.logExecution({ toolName: 'exec', toolCallId: 'tc-2', conversationId: 'conv-1', success: true });

      const stats = audit.getStats();
      expect(stats.timeRange.earliest).toBeGreaterThan(0);
      expect(stats.timeRange.latest).toBeGreaterThanOrEqual(stats.timeRange.earliest);
    });

    it('filters stats by since timestamp', () => {
      audit.logExecution({ toolName: 'exec', toolCallId: 'tc-1', conversationId: 'conv-1', success: true });

      const stats = audit.getStats({ since: Date.now() + 999_999 });
      expect(stats.totalEvents).toBe(0);
    });

    it('counts non-execution events in byEventType', () => {
      audit.logSecurityDenied({ toolName: 'exec', toolCallId: 'tc-1', conversationId: 'conv-1', securityMode: 'deny', reason: 'blocked' });
      audit.logRateLimited({ toolName: 'exec', toolCallId: 'tc-2', conversationId: 'conv-1', limit: 100, remaining: 0, resetAt: Date.now() + 1000 });

      const stats = audit.getStats();
      expect(stats.byEventType['security_denied']).toBe(1);
      expect(stats.byEventType['rate_limited']).toBe(1);
    });
  });

  // ===========================================================================
  // exportCsv
  // ===========================================================================

  describe('exportCsv', () => {
    it('produces a CSV with header row', () => {
      audit.logExecution({ toolName: 'exec', toolCallId: 'tc-1', conversationId: 'conv-1', success: true });

      const csv = audit.exportCsv();
      const lines = csv.split('\n');
      expect(lines[0]).toContain('id');
      expect(lines[0]).toContain('eventType');
      expect(lines[0]).toContain('toolName');
    });

    it('includes one data row per entry', () => {
      audit.logExecution({ toolName: 'exec', toolCallId: 'tc-1', conversationId: 'conv-1', success: true });
      audit.logExecution({ toolName: 'file-ops', toolCallId: 'tc-2', conversationId: 'conv-1', success: false });

      const csv = audit.exportCsv();
      const lines = csv.split('\n');
      // header + 2 data rows
      expect(lines).toHaveLength(3);
    });

    it('escapes commas in error messages', () => {
      audit.logError({ toolName: 'exec', toolCallId: 'tc-1', conversationId: 'conv-1', error: 'Failed: bad,input' });

      const csv = audit.exportCsv();
      expect(csv).toContain('"Failed: bad,input"');
    });

    it('returns only header when no entries', () => {
      const csv = audit.exportCsv();
      const lines = csv.split('\n');
      expect(lines).toHaveLength(1);
    });

    it('respects filter when exporting', () => {
      audit.logExecution({ toolName: 'exec', toolCallId: 'tc-1', conversationId: 'conv-1', success: true });
      audit.logSecurityDenied({ toolName: 'exec', toolCallId: 'tc-2', conversationId: 'conv-1', securityMode: 'deny', reason: 'blocked' });

      const csv = audit.exportCsv({ eventTypes: ['tool_execution'] });
      const lines = csv.split('\n');
      expect(lines).toHaveLength(2); // header + 1 row
    });
  });

  // ===========================================================================
  // subscribe / unsubscribe
  // ===========================================================================

  describe('subscribe', () => {
    it('notifies listeners on new entries', () => {
      const entries: AuditEntry[] = [];
      const unsub = audit.subscribe((entry) => entries.push(entry));

      audit.logExecution({
        toolName: 'exec',
        toolCallId: 'tc-1',
        conversationId: 'conv-1',
        success: true,
      });

      expect(entries).toHaveLength(1);
      expect(entries[0].eventType).toBe('tool_execution');

      unsub();

      audit.logExecution({
        toolName: 'exec',
        toolCallId: 'tc-2',
        conversationId: 'conv-1',
        success: true,
      });

      // Should not receive second event
      expect(entries).toHaveLength(1);
    });

    it('notifies multiple listeners', () => {
      const a: string[] = [];
      const b: string[] = [];

      const unsubA = audit.subscribe((e) => a.push(e.eventType));
      const unsubB = audit.subscribe((e) => b.push(e.eventType));

      audit.logExecution({ toolName: 'exec', toolCallId: 'tc-1', conversationId: 'conv-1', success: true });
      audit.logSecurityDenied({ toolName: 'exec', toolCallId: 'tc-2', conversationId: 'conv-1', securityMode: 'deny', reason: 'blocked' });

      expect(a).toHaveLength(2);
      expect(b).toHaveLength(2);

      unsubA();
      unsubB();
    });

    it('continues notifying other listeners when one throws', () => {
      const received: string[] = [];

      audit.subscribe(() => { throw new Error('listener error'); });
      audit.subscribe((e) => received.push(e.id));

      audit.logExecution({ toolName: 'exec', toolCallId: 'tc-1', conversationId: 'conv-1', success: true });

      // Second listener should still have received the event
      expect(received).toHaveLength(1);
    });

    it('unsubscribing twice does not throw', () => {
      const unsub = audit.subscribe(() => {});
      unsub();
      expect(() => unsub()).not.toThrow();
    });
  });

  // ===========================================================================
  // Automatic cleanup when entries exceed threshold
  // ===========================================================================

  describe('entry count limit and cleanup', () => {
    it('removes oldest entries once threshold is exceeded', () => {
      // CLEANUP_THRESHOLD = 11_000, ENTRIES_TO_REMOVE = 2_000
      const THRESHOLD = 11_000;
      const REMOVE = 2_000;

      for (let i = 0; i < THRESHOLD + 1; i++) {
        audit.logExecution({
          toolName: 'exec',
          toolCallId: `tc-${i}`,
          conversationId: 'conv-1',
          success: true,
        });
      }

      // After cleanup, count should be threshold + 1 - REMOVE
      expect(audit.count).toBe(THRESHOLD + 1 - REMOVE);
    });

    it('preserves newest entries after cleanup', () => {
      const THRESHOLD = 11_000;
      const REMOVE = 2_000;

      for (let i = 0; i < THRESHOLD; i++) {
        audit.logExecution({
          toolName: `tool-${i}`,
          toolCallId: `tc-${i}`,
          conversationId: 'conv-1',
          success: true,
        });
      }

      // Push one more to trigger cleanup
      const last = audit.logExecution({
        toolName: 'tool-last',
        toolCallId: `tc-last`,
        conversationId: 'conv-1',
        success: true,
      });

      // The last entry must still be accessible
      expect(audit.get(last.id)).toBeDefined();
      expect(audit.count).toBe(THRESHOLD + 1 - REMOVE);
    });
  });

  // ===========================================================================
  // clear
  // ===========================================================================

  describe('clear', () => {
    it('removes all entries', () => {
      audit.logExecution({
        toolName: 'exec',
        toolCallId: 'tc-1',
        conversationId: 'conv-1',
        success: true,
      });

      audit.clear();
      expect(audit.query()).toHaveLength(0);
    });

    it('resets count to zero', () => {
      audit.logExecution({ toolName: 'exec', toolCallId: 'tc-1', conversationId: 'conv-1', success: true });
      audit.clear();
      expect(audit.count).toBe(0);
    });
  });

  // ===========================================================================
  // Singleton helpers
  // ===========================================================================

  describe('getAuditLogger / initAuditLogger', () => {
    it('getAuditLogger returns same instance on repeated calls', () => {
      const a = getAuditLogger();
      const b = getAuditLogger();
      expect(a).toBe(b);
    });

    it('initAuditLogger returns a fresh instance each time', () => {
      const a = initAuditLogger();
      const b = initAuditLogger();
      expect(a).not.toBe(b);
    });

    it('fresh instance from initAuditLogger starts empty', () => {
      const fresh = initAuditLogger();
      fresh.logExecution({ toolName: 'exec', toolCallId: 'tc-1', conversationId: 'conv-1', success: true });
      const another = initAuditLogger();
      expect(another.count).toBe(0);
    });
  });
});
