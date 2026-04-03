import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConversationBrancher } from '../conversation-branch.js';
import { TranscriptStore } from '../transcript.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'profclaw-branch-test-'));
}

function seedTranscript(root: string, sessionId: string, messages: Array<{ type: 'user' | 'assistant'; content: string }>): void {
  const store = new TranscriptStore(root);
  for (const msg of messages) {
    store.append({
      timestamp: Date.now(),
      sessionId,
      type: msg.type,
      content: msg.content,
    });
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ConversationBrancher.fork', () => {
  let tmpDir: string;
  let brancher: ConversationBrancher;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    brancher = new ConversationBrancher(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a branch with the correct parentId and turnIndex', () => {
    const branch = brancher.fork('conv-1', 3, 'my branch');

    expect(branch.parentId).toBe('conv-1');
    expect(branch.forkTurnIndex).toBe(3);
    expect(branch.title).toBe('my branch');
    expect(branch.id).toBeTruthy();
    expect(typeof branch.createdAt).toBe('number');
  });

  it('generates unique IDs for each branch', () => {
    const b1 = brancher.fork('conv-1', 0);
    const b2 = brancher.fork('conv-1', 1);
    expect(b1.id).not.toBe(b2.id);
  });
});

describe('ConversationBrancher.listBranches', () => {
  let tmpDir: string;
  let brancher: ConversationBrancher;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    brancher = new ConversationBrancher(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns only branches matching the given conversationId', () => {
    brancher.fork('conv-A', 0, 'branch-1');
    brancher.fork('conv-A', 2, 'branch-2');
    brancher.fork('conv-B', 1, 'other-conv-branch');

    const branches = brancher.listBranches('conv-A');
    expect(branches).toHaveLength(2);
    expect(branches.every(b => b.parentId === 'conv-A')).toBe(true);
  });

  it('returns empty array when conversation has no branches', () => {
    const branches = brancher.listBranches('unknown-conv');
    expect(branches).toHaveLength(0);
  });

  it('sorts branches newest first', async () => {
    const b1 = brancher.fork('conv-A', 0);
    // Ensure different timestamp
    await new Promise(r => setTimeout(r, 5));
    const b2 = brancher.fork('conv-A', 1);

    const branches = brancher.listBranches('conv-A');
    expect(branches.length).toBe(2);
    // b2 was created after b1 — should come first (newest first)
    const idx1 = branches.findIndex(b => b.id === b1.id);
    const idx2 = branches.findIndex(b => b.id === b2.id);
    expect(idx2).toBeLessThanOrEqual(idx1);
  });
});

describe('ConversationBrancher.getBaseMessages', () => {
  let tmpDir: string;
  let brancher: ConversationBrancher;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    brancher = new ConversationBrancher(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns messages up to and including forkTurnIndex', () => {
    seedTranscript(tmpDir, 'conv-1', [
      { type: 'user', content: 'turn 0 user' },
      { type: 'assistant', content: 'turn 0 assistant' },
      { type: 'user', content: 'turn 1 user' },
      { type: 'assistant', content: 'turn 1 assistant' },
      { type: 'user', content: 'turn 2 user' },
      { type: 'assistant', content: 'turn 2 assistant' },
    ]);

    const branch = brancher.fork('conv-1', 2); // fork at index 2 (0-based)
    const msgs = brancher.getBaseMessages(branch);

    expect(msgs).toHaveLength(3); // entries 0, 1, 2
    expect(msgs[0]).toEqual({ role: 'user', content: 'turn 0 user' });
    expect(msgs[1]).toEqual({ role: 'assistant', content: 'turn 0 assistant' });
    expect(msgs[2]).toEqual({ role: 'user', content: 'turn 1 user' });
  });

  it('returns empty array when session has no transcript', () => {
    const branch = brancher.fork('empty-conv', 5);
    const msgs = brancher.getBaseMessages(branch);
    expect(msgs).toHaveLength(0);
  });

  it('maps user entries to role "user" and assistant entries to role "assistant"', () => {
    seedTranscript(tmpDir, 'conv-2', [
      { type: 'user', content: 'hello' },
      { type: 'assistant', content: 'world' },
    ]);

    const branch = brancher.fork('conv-2', 1);
    const msgs = brancher.getBaseMessages(branch);

    expect(msgs[0]?.role).toBe('user');
    expect(msgs[1]?.role).toBe('assistant');
  });
});

describe('ConversationBrancher persistence (save/load)', () => {
  let tmpDir: string;

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persists branches and reloads them', () => {
    tmpDir = makeTmpDir();

    const b1 = new ConversationBrancher(tmpDir);
    const branch = b1.fork('conv-X', 4, 'persisted');

    // Fresh instance should load from disk
    const b2 = new ConversationBrancher(tmpDir);
    const loaded = b2.listBranches('conv-X');

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe(branch.id);
    expect(loaded[0]?.title).toBe('persisted');
  });
});
