import { describe, it, expect, beforeEach } from 'vitest';
import { AgentSummaryTracker, getAgentSummaryTracker } from '../agent-summary.js';

describe('AgentSummaryTracker', () => {
  let tracker: AgentSummaryTracker;

  beforeEach(() => {
    tracker = new AgentSummaryTracker();
  });

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('start creates a new summary with idle status', () => {
      tracker.start('session-1');
      const summary = tracker.get('session-1');
      expect(summary).toBeDefined();
      expect(summary?.sessionId).toBe('session-1');
      expect(summary?.status).toBe('idle');
      expect(summary?.currentAction).toBe('Starting');
      expect(summary?.stepCount).toBe(0);
      expect(summary?.tokensUsed).toBe(0);
      expect(summary?.startedAt).toBeGreaterThan(0);
      expect(summary?.updatedAt).toBeGreaterThan(0);
    });

    it('start records a timestamp for startedAt and updatedAt', () => {
      const before = Date.now();
      tracker.start('session-ts');
      const after = Date.now();
      const summary = tracker.get('session-ts');
      expect(summary?.startedAt).toBeGreaterThanOrEqual(before);
      expect(summary?.startedAt).toBeLessThanOrEqual(after);
    });

    it('update modifies existing fields', () => {
      tracker.start('session-2');
      tracker.update('session-2', { status: 'executing', currentAction: 'Reading auth.ts', stepCount: 3 });
      const summary = tracker.get('session-2');
      expect(summary?.status).toBe('executing');
      expect(summary?.currentAction).toBe('Reading auth.ts');
      expect(summary?.stepCount).toBe(3);
    });

    it('update always preserves the original sessionId', () => {
      tracker.start('session-3');
      // @ts-expect-error — intentionally try to overwrite sessionId
      tracker.update('session-3', { sessionId: 'hijacked' });
      const summary = tracker.get('session-3');
      expect(summary?.sessionId).toBe('session-3');
    });

    it('update does nothing when session does not exist', () => {
      // Should not throw
      expect(() => tracker.update('non-existent', { stepCount: 5 })).not.toThrow();
      expect(tracker.get('non-existent')).toBeUndefined();
    });

    it('update refreshes updatedAt', async () => {
      tracker.start('session-4');
      const before = tracker.get('session-4')?.updatedAt ?? 0;
      // Small pause to ensure timestamp differs
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      tracker.update('session-4', { stepCount: 1 });
      const after = tracker.get('session-4')?.updatedAt ?? 0;
      expect(after).toBeGreaterThanOrEqual(before);
    });

    it('end removes the session from the tracker', () => {
      tracker.start('session-end');
      expect(tracker.get('session-end')).toBeDefined();
      tracker.end('session-end');
      expect(tracker.get('session-end')).toBeUndefined();
    });

    it('end does not throw when session does not exist', () => {
      expect(() => tracker.end('does-not-exist')).not.toThrow();
    });
  });

  // ─── getAll ───────────────────────────────────────────────────────────────

  describe('getAll', () => {
    it('returns all active sessions', () => {
      tracker.start('s1');
      tracker.start('s2');
      tracker.start('s3');
      const all = tracker.getAll();
      expect(all).toHaveLength(3);
      const ids = all.map((s) => s.sessionId).sort();
      expect(ids).toEqual(['s1', 's2', 's3']);
    });

    it('returns empty array when no sessions are active', () => {
      expect(tracker.getAll()).toEqual([]);
    });

    it('does not include ended sessions', () => {
      tracker.start('active');
      tracker.start('ended');
      tracker.end('ended');
      const all = tracker.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].sessionId).toBe('active');
    });
  });

  // ─── summarizeToolCall ────────────────────────────────────────────────────

  describe('summarizeToolCall', () => {
    const sessionId = 'test-session';

    beforeEach(() => {
      tracker.start(sessionId);
    });

    it('read_file with path → "Reading <filename>"', () => {
      expect(tracker.summarizeToolCall(sessionId, 'read_file', { path: '/src/auth.ts' }))
        .toBe('Reading auth.ts');
    });

    it('Read with file_path → "Reading <filename>"', () => {
      expect(tracker.summarizeToolCall(sessionId, 'Read', { file_path: '/deep/path/index.ts' }))
        .toBe('Reading index.ts');
    });

    it('write_file with path → "Writing <filename>"', () => {
      expect(tracker.summarizeToolCall(sessionId, 'write_file', { path: '/src/fix.ts' }))
        .toBe('Writing fix.ts');
    });

    it('Write tool → "Writing <filename>"', () => {
      expect(tracker.summarizeToolCall(sessionId, 'Write', { file_path: '/src/output.json' }))
        .toBe('Writing output.json');
    });

    it('edit_file → "Editing <filename>"', () => {
      expect(tracker.summarizeToolCall(sessionId, 'edit_file', { path: '/src/component.tsx' }))
        .toBe('Editing component.tsx');
    });

    it('bash with command → "Running <command>"', () => {
      expect(tracker.summarizeToolCall(sessionId, 'bash', { command: 'npm test' }))
        .toBe('Running npm test');
    });

    it('Bash tool → "Running <command>"', () => {
      expect(tracker.summarizeToolCall(sessionId, 'Bash', { command: 'npx tsc --noEmit' }))
        .toBe('Running npx tsc --noEmit');
    });

    it('bash truncates long commands', () => {
      const longCmd = 'npm run build && npm run test && npm run lint && npm run format';
      const result = tracker.summarizeToolCall(sessionId, 'bash', { command: longCmd });
      expect(result).toContain('Running');
      expect(result.length).toBeLessThan(60);
      expect(result).toContain('…');
    });

    it('search_files with query → "Searching for \'<query>\'"', () => {
      expect(tracker.summarizeToolCall(sessionId, 'search_files', { query: 'login' }))
        .toBe("Searching for 'login'");
    });

    it('Glob with pattern → "Searching for \'<pattern>\'"', () => {
      expect(tracker.summarizeToolCall(sessionId, 'Glob', { pattern: '**/*.ts' }))
        .toBe("Searching for '**/*.ts'");
    });

    it('Grep with pattern → "Searching for \'<pattern>\'"', () => {
      expect(tracker.summarizeToolCall(sessionId, 'Grep', { pattern: 'useEffect' }))
        .toBe("Searching for 'useEffect'");
    });

    it('git_commit → "Committing changes"', () => {
      expect(tracker.summarizeToolCall(sessionId, 'git_commit', { message: 'fix: auth' }))
        .toBe('Committing changes');
    });

    it('git_push → "Committing changes"', () => {
      expect(tracker.summarizeToolCall(sessionId, 'git_push', {}))
        .toBe('Committing changes');
    });

    it('git_status → "Checking git status"', () => {
      expect(tracker.summarizeToolCall(sessionId, 'git_status', {}))
        .toBe('Checking git status');
    });

    it('git_diff → "Reviewing changes"', () => {
      expect(tracker.summarizeToolCall(sessionId, 'git_diff', {}))
        .toBe('Reviewing changes');
    });

    it('complete_task → "Completing task"', () => {
      expect(tracker.summarizeToolCall(sessionId, 'complete_task', {}))
        .toBe('Completing task');
    });

    it('web_fetch with valid URL → "Fetching <hostname>"', () => {
      expect(tracker.summarizeToolCall(sessionId, 'web_fetch', { url: 'https://api.github.com/repos' }))
        .toBe('Fetching api.github.com');
    });

    it('WebFetch with invalid URL falls back gracefully', () => {
      expect(tracker.summarizeToolCall(sessionId, 'WebFetch', { url: 'not-a-url' }))
        .toBe('Fetching URL');
    });

    it('Task tool → "Spawning agent"', () => {
      expect(tracker.summarizeToolCall(sessionId, 'Task', { subagent_type: 'claude-router:fast-executor' }))
        .toBe('Spawning agent');
    });

    it('unknown snake_case tool → "Using <humanized name>"', () => {
      expect(tracker.summarizeToolCall(sessionId, 'list_tickets', {}))
        .toBe('Using list tickets');
    });

    it('unknown camelCase tool → "Using <humanized name>"', () => {
      expect(tracker.summarizeToolCall(sessionId, 'fetchData', {}))
        .toBe('Using fetch data');
    });

    it('read_file with no path falls back gracefully', () => {
      expect(tracker.summarizeToolCall(sessionId, 'read_file', {}))
        .toBe('Reading file');
    });

    it('bash with no command falls back gracefully', () => {
      expect(tracker.summarizeToolCall(sessionId, 'bash', {}))
        .toBe('Running command');
    });

    it('search_files with no query falls back gracefully', () => {
      expect(tracker.summarizeToolCall(sessionId, 'search_files', {}))
        .toBe('Searching files');
    });
  });

  // ─── SSE broadcaster ──────────────────────────────────────────────────────

  describe('SSE broadcaster', () => {
    it('broadcasts on start when broadcaster is registered', () => {
      const calls: Array<[string, Record<string, unknown>]> = [];
      tracker.registerSSEBroadcaster((eventType, data) => {
        calls.push([eventType, data]);
      });

      tracker.start('broadcast-session');
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toBe('agent:summary');
      expect(calls[0][1]['sessionId']).toBe('broadcast-session');
    });

    it('broadcasts on update', () => {
      const calls: Array<[string, Record<string, unknown>]> = [];
      tracker.registerSSEBroadcaster((eventType, data) => {
        calls.push([eventType, data]);
      });

      tracker.start('upd-session');
      tracker.update('upd-session', { status: 'executing', currentAction: 'Running tests' });

      // start + update
      expect(calls).toHaveLength(2);
      expect(calls[1][1]['currentAction']).toBe('Running tests');
    });

    it('broadcasts ended:true on end', () => {
      const calls: Array<[string, Record<string, unknown>]> = [];
      tracker.registerSSEBroadcaster((eventType, data) => {
        calls.push([eventType, data]);
      });

      tracker.start('end-session');
      tracker.end('end-session');

      const lastCall = calls[calls.length - 1];
      expect(lastCall[0]).toBe('agent:summary');
      expect(lastCall[1]['ended']).toBe(true);
    });

    it('does not throw when no broadcaster is registered', () => {
      expect(() => {
        tracker.start('no-bc');
        tracker.update('no-bc', { status: 'thinking' });
        tracker.end('no-bc');
      }).not.toThrow();
    });
  });
});

// ─── Singleton ──────────────────────────────────────────────────────────────

describe('getAgentSummaryTracker', () => {
  it('returns the same instance on repeated calls', () => {
    const a = getAgentSummaryTracker();
    const b = getAgentSummaryTracker();
    expect(a).toBe(b);
  });

  it('returns an AgentSummaryTracker instance', () => {
    expect(getAgentSummaryTracker()).toBeInstanceOf(AgentSummaryTracker);
  });
});
