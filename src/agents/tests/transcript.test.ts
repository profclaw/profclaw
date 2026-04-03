import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TranscriptStore, _resetTranscriptStoreSingleton, getTranscriptStore } from '../transcript.js';
import type { TranscriptEntry } from '../transcript.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'profclaw-transcript-test-'));
}

function makeEntry(
  overrides: Partial<TranscriptEntry> = {},
): TranscriptEntry {
  return {
    timestamp: Date.now(),
    sessionId: 'session-abc',
    type: 'user',
    content: 'Hello, world!',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// append / getSession
// ---------------------------------------------------------------------------

describe('TranscriptStore.append + getSession', () => {
  let tmpDir: string;
  let store: TranscriptStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new TranscriptStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appends an entry and reads it back', () => {
    const entry = makeEntry();
    store.append(entry);

    const entries = store.getSession('session-abc');
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe('Hello, world!');
    expect(entries[0].type).toBe('user');
  });

  it('appends multiple entries in order', () => {
    const base = Date.now();
    store.append(makeEntry({ timestamp: base, content: 'first' }));
    store.append(makeEntry({ timestamp: base + 1, content: 'second', type: 'assistant' }));
    store.append(makeEntry({ timestamp: base + 2, content: 'third', type: 'tool_call' }));

    const entries = store.getSession('session-abc');
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.content)).toEqual(['first', 'second', 'third']);
  });

  it('returns empty array for unknown session', () => {
    expect(store.getSession('nonexistent-session')).toEqual([]);
  });

  it('persists metadata: message count and tokensUsed', () => {
    store.append(makeEntry({ metadata: { tokensUsed: 100 } }));
    store.append(makeEntry({ metadata: { tokensUsed: 200 } }));

    const sessions = store.listSessions();
    expect(sessions[0].messageCount).toBe(2);
    expect(sessions[0].tokensUsed).toBe(300);
  });

  it('captures model from metadata on first entry with model', () => {
    store.append(makeEntry({ metadata: { model: 'claude-3' } }));
    store.append(makeEntry({ metadata: { model: 'claude-4' } })); // should not override

    const sessions = store.listSessions();
    expect(sessions[0].model).toBe('claude-3');
  });
});

// ---------------------------------------------------------------------------
// listSessions
// ---------------------------------------------------------------------------

describe('TranscriptStore.listSessions', () => {
  let tmpDir: string;
  let store: TranscriptStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new TranscriptStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns sessions sorted by lastActivityAt descending', () => {
    const now = Date.now();
    store.append(makeEntry({ sessionId: 'session-old', timestamp: now - 10000, content: 'old' }));
    store.append(makeEntry({ sessionId: 'session-new', timestamp: now, content: 'new' }));
    store.append(makeEntry({ sessionId: 'session-mid', timestamp: now - 5000, content: 'mid' }));

    const sessions = store.listSessions();
    expect(sessions.map((s) => s.sessionId)).toEqual(['session-new', 'session-mid', 'session-old']);
  });

  it('respects limit and offset', () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      store.append(makeEntry({ sessionId: `s-${i}`, timestamp: now + i }));
    }

    const page1 = store.listSessions({ limit: 2, offset: 0 });
    const page2 = store.listSessions({ limit: 2, offset: 2 });

    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1[0].sessionId).not.toBe(page2[0].sessionId);
  });

  it('returns all sessions when no options given', () => {
    for (let i = 0; i < 3; i++) {
      store.append(makeEntry({ sessionId: `sess-${i}` }));
    }
    expect(store.listSessions()).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe('TranscriptStore.search', () => {
  let tmpDir: string;
  let store: TranscriptStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new TranscriptStore(tmpDir);
    store.append(makeEntry({ sessionId: 's1', content: 'fix the login bug' }));
    store.append(makeEntry({ sessionId: 's1', content: 'done with the task', type: 'assistant' }));
    store.append(makeEntry({ sessionId: 's2', content: 'login page redesign request' }));
    store.append(makeEntry({ sessionId: 's2', content: 'unrelated message', type: 'assistant' }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds matching entries across all sessions', () => {
    const results = store.search('login');
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.entry.content.toLowerCase().includes('login'))).toBe(true);
  });

  it('is case-insensitive', () => {
    const results = store.search('LOGIN');
    expect(results).toHaveLength(2);
  });

  it('restricts search to a specific sessionId', () => {
    const results = store.search('login', { sessionId: 's1' });
    expect(results).toHaveLength(1);
    expect(results[0].sessionId).toBe('s1');
  });

  it('respects limit', () => {
    const results = store.search('login', { limit: 1 });
    expect(results).toHaveLength(1);
  });

  it('returns empty array when no match', () => {
    expect(store.search('xyzzy-no-match')).toHaveLength(0);
  });

  it('includes lineNumber in results', () => {
    const results = store.search('fix the login bug');
    expect(results[0].lineNumber).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// generateTitle (tested indirectly via getOrCreateMeta)
// ---------------------------------------------------------------------------

describe('TranscriptStore.generateTitle', () => {
  let tmpDir: string;
  let store: TranscriptStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new TranscriptStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('uses first 50 chars for short messages', () => {
    const meta = store.getOrCreateMeta('s1', 'Short message');
    expect(meta.title).toBe('Short message');
  });

  it('truncates long messages to 50 chars with ellipsis', () => {
    const longMsg = 'A'.repeat(60);
    const meta = store.getOrCreateMeta('s2', longMsg);
    expect(meta.title).toHaveLength(50);
    expect(meta.title.endsWith('...')).toBe(true);
  });

  it('strips newlines from title', () => {
    const meta = store.getOrCreateMeta('s3', 'line one\nline two');
    expect(meta.title).not.toContain('\n');
    expect(meta.title).toBe('line one line two');
  });

  it('uses fallback title when no firstMessage provided', () => {
    const meta = store.getOrCreateMeta('deadbeef-1234-abcd');
    expect(meta.title).toContain('Session');
  });

  it('returns existing meta on second call without overwriting title', () => {
    store.getOrCreateMeta('s4', 'Original title');
    const second = store.getOrCreateMeta('s4', 'Should not overwrite');
    expect(second.title).toBe('Original title');
  });
});

// ---------------------------------------------------------------------------
// deleteSession
// ---------------------------------------------------------------------------

describe('TranscriptStore.deleteSession', () => {
  let tmpDir: string;
  let store: TranscriptStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new TranscriptStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes the JSONL file', () => {
    store.append(makeEntry({ sessionId: 'to-delete' }));
    const filePath = path.join(tmpDir, '.profclaw', 'transcripts', 'to-delete.jsonl');
    expect(fs.existsSync(filePath)).toBe(true);

    store.deleteSession('to-delete');
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('removes the session from the index', () => {
    store.append(makeEntry({ sessionId: 'to-delete' }));
    store.deleteSession('to-delete');

    const sessions = store.listSessions();
    expect(sessions.find((s) => s.sessionId === 'to-delete')).toBeUndefined();
  });

  it('does not throw when session does not exist', () => {
    expect(() => store.deleteSession('ghost-session')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// index persistence
// ---------------------------------------------------------------------------

describe('TranscriptStore index persistence', () => {
  let tmpDir: string;

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads index from disk on construction', () => {
    tmpDir = makeTmpDir();
    const store1 = new TranscriptStore(tmpDir);
    store1.append(makeEntry({ sessionId: 'persist-me', content: 'test' }));

    // Fresh instance should load from disk
    const store2 = new TranscriptStore(tmpDir);
    const sessions = store2.listSessions();
    expect(sessions.find((s) => s.sessionId === 'persist-me')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// updateMeta
// ---------------------------------------------------------------------------

describe('TranscriptStore.updateMeta', () => {
  let tmpDir: string;
  let store: TranscriptStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new TranscriptStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('updates partial fields on existing session', () => {
    store.append(makeEntry({ sessionId: 'upd', content: 'hello' }));
    store.updateMeta('upd', { title: 'My Custom Title', tokensUsed: 999 });

    const sessions = store.listSessions();
    const meta = sessions.find((s) => s.sessionId === 'upd');
    expect(meta?.title).toBe('My Custom Title');
    expect(meta?.tokensUsed).toBe(999);
  });

  it('does not throw for unknown session', () => {
    expect(() => store.updateMeta('ghost', { title: 'nope' })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

describe('getTranscriptStore singleton', () => {
  beforeEach(() => {
    _resetTranscriptStoreSingleton();
  });

  afterEach(() => {
    _resetTranscriptStoreSingleton();
  });

  it('returns the same instance on multiple calls', () => {
    const a = getTranscriptStore();
    const b = getTranscriptStore();
    expect(a).toBe(b);
  });
});
