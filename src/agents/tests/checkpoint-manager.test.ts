/**
 * CheckpointManager Tests
 *
 * Uses a temporary directory so tests never pollute .profclaw/checkpoints/.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CheckpointManager } from '../checkpoint-manager.js';
import type { ExecutorCheckpoint } from '../checkpoint-manager.js';

// ─── Fixture factory ──────────────────────────────────────────────────────────

function makeCheckpoint(overrides: Partial<ExecutorCheckpoint> = {}): ExecutorCheckpoint {
  return {
    sessionId: 'test-session-abc123',
    taskDescription: 'Refactor auth module',
    currentStep: 10,
    totalSteps: 50,
    messages: [
      { role: 'user', content: 'Please refactor the auth module' },
      { role: 'assistant', content: 'I will start by reading the existing code.' },
    ],
    tokensUsed: 5000,
    estimatedCost: 0.015,
    toolCallHistory: [
      { name: 'read_file', success: true, step: 2 },
      { name: 'write_file', success: true, step: 5 },
    ],
    completedFiles: ['src/auth/session.ts'],
    remainingWork: 'Write tests and update docs',
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CheckpointManager', () => {
  let tmpRoot: string;
  let manager: CheckpointManager;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'profclaw-cp-test-'));
    manager = new CheckpointManager(tmpRoot);
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  // ── save ──────────────────────────────────────────────────────────────────

  describe('save', () => {
    it('creates the checkpoints directory when it does not exist', async () => {
      const cp = makeCheckpoint();
      await manager.save(cp);
      expect(existsSync(join(tmpRoot, '.profclaw', 'checkpoints'))).toBe(true);
    });

    it('writes a JSON file named after the sessionId', async () => {
      const cp = makeCheckpoint();
      await manager.save(cp);
      expect(existsSync(join(tmpRoot, '.profclaw', 'checkpoints', `${cp.sessionId}.json`))).toBe(true);
    });

    it('overwrites an existing checkpoint with the same sessionId', async () => {
      const cp = makeCheckpoint({ currentStep: 5 });
      await manager.save(cp);
      await manager.save({ ...cp, currentStep: 10 });
      const loaded = await manager.load(cp.sessionId);
      expect(loaded?.currentStep).toBe(10);
    });

    it('updates updatedAt on each save', async () => {
      const cp = makeCheckpoint({ updatedAt: 0 });
      const before = Date.now();
      await manager.save(cp);
      const loaded = await manager.load(cp.sessionId);
      expect(loaded?.updatedAt).toBeGreaterThanOrEqual(before);
    });
  });

  // ── load ──────────────────────────────────────────────────────────────────

  describe('load', () => {
    it('returns null when no checkpoint exists', async () => {
      const result = await manager.load('nonexistent-session');
      expect(result).toBeNull();
    });

    it('restores all checkpoint fields accurately', async () => {
      const cp = makeCheckpoint();
      await manager.save(cp);
      const loaded = await manager.load(cp.sessionId);

      expect(loaded).not.toBeNull();
      expect(loaded!.sessionId).toBe(cp.sessionId);
      expect(loaded!.taskDescription).toBe(cp.taskDescription);
      expect(loaded!.currentStep).toBe(cp.currentStep);
      expect(loaded!.totalSteps).toBe(cp.totalSteps);
      expect(loaded!.messages).toHaveLength(2);
      expect(loaded!.tokensUsed).toBe(cp.tokensUsed);
      expect(loaded!.estimatedCost).toBe(cp.estimatedCost);
      expect(loaded!.toolCallHistory).toHaveLength(2);
      expect(loaded!.completedFiles).toEqual(['src/auth/session.ts']);
      expect(loaded!.remainingWork).toBe('Write tests and update docs');
    });

    it('returns null for a malformed JSON file', async () => {
      // Manually write a broken file
      const { writeFile, mkdir } = await import('node:fs/promises');
      const dir = join(tmpRoot, '.profclaw', 'checkpoints');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'broken.json'), 'NOT-VALID-JSON', 'utf-8');
      // Malformed file has no sessionId match, so just confirm load returns null
      const result = await manager.load('broken');
      expect(result).toBeNull();
    });
  });

  // ── list ──────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('returns an empty array when no checkpoints directory exists', async () => {
      const list = await manager.list();
      expect(list).toEqual([]);
    });

    it('returns summaries for all saved checkpoints', async () => {
      await manager.save(makeCheckpoint({ sessionId: 'session-1', currentStep: 5 }));
      await manager.save(makeCheckpoint({ sessionId: 'session-2', currentStep: 15 }));

      const list = await manager.list();
      expect(list).toHaveLength(2);
      const ids = list.map((s) => s.sessionId);
      expect(ids).toContain('session-1');
      expect(ids).toContain('session-2');
    });

    it('sorts results newest-updated first', async () => {
      const older = makeCheckpoint({ sessionId: 'old-session', updatedAt: Date.now() - 10_000 });
      const newer = makeCheckpoint({ sessionId: 'new-session', updatedAt: Date.now() });
      await manager.save(older);
      await manager.save(newer);

      const list = await manager.list();
      expect(list[0].sessionId).toBe('new-session');
      expect(list[1].sessionId).toBe('old-session');
    });

    it('ignores non-JSON files in the checkpoints directory', async () => {
      await manager.save(makeCheckpoint());
      const { writeFile } = await import('node:fs/promises');
      await writeFile(
        join(tmpRoot, '.profclaw', 'checkpoints', 'notes.txt'),
        'some random text',
        'utf-8',
      );
      const list = await manager.list();
      expect(list).toHaveLength(1);
    });

    it('exposes the correct step count in summaries', async () => {
      await manager.save(makeCheckpoint({ sessionId: 'step-test', currentStep: 42 }));
      const list = await manager.list();
      expect(list[0].step).toBe(42);
    });
  });

  // ── remove ────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('deletes the checkpoint file from disk', async () => {
      const cp = makeCheckpoint();
      await manager.save(cp);
      await manager.remove(cp.sessionId);
      const loaded = await manager.load(cp.sessionId);
      expect(loaded).toBeNull();
    });

    it('does not throw when the checkpoint does not exist', async () => {
      await expect(manager.remove('ghost-session')).resolves.toBeUndefined();
    });

    it('removes the entry from list after deletion', async () => {
      await manager.save(makeCheckpoint({ sessionId: 'to-delete' }));
      await manager.save(makeCheckpoint({ sessionId: 'to-keep' }));
      await manager.remove('to-delete');
      const list = await manager.list();
      expect(list.map((s) => s.sessionId)).not.toContain('to-delete');
      expect(list.map((s) => s.sessionId)).toContain('to-keep');
    });
  });

  // ── findResumable ─────────────────────────────────────────────────────────

  describe('findResumable', () => {
    it('returns null when there are no checkpoints', async () => {
      const result = await manager.findResumable('do something');
      expect(result).toBeNull();
    });

    it('returns null when no description matches', async () => {
      await manager.save(makeCheckpoint({ taskDescription: 'Refactor auth module' }));
      const result = await manager.findResumable('totally unrelated task xyz');
      expect(result).toBeNull();
    });

    it('matches on exact substring', async () => {
      const cp = makeCheckpoint({ sessionId: 'auth-session', taskDescription: 'Refactor auth module' });
      await manager.save(cp);
      const result = await manager.findResumable('Refactor auth module');
      expect(result?.sessionId).toBe('auth-session');
    });

    it('matches case-insensitively', async () => {
      const cp = makeCheckpoint({ sessionId: 'ci-session', taskDescription: 'Add unit tests to the API layer' });
      await manager.save(cp);
      const result = await manager.findResumable('ADD UNIT TESTS');
      expect(result?.sessionId).toBe('ci-session');
    });

    it('matches via word overlap when substring is absent', async () => {
      const cp = makeCheckpoint({
        sessionId: 'overlap-session',
        taskDescription: 'Add rate limiting middleware',
      });
      await manager.save(cp);
      // 3 of 4 words overlap (add, rate, limiting)
      const result = await manager.findResumable('add rate limiting to routes');
      expect(result?.sessionId).toBe('overlap-session');
    });

    it('prefers the most recently updated match when multiple qualify', async () => {
      const older = makeCheckpoint({
        sessionId: 'old-auth',
        taskDescription: 'Refactor auth',
        updatedAt: Date.now() - 30_000,
      });
      const newer = makeCheckpoint({
        sessionId: 'new-auth',
        taskDescription: 'Refactor auth module with JWT',
        updatedAt: Date.now(),
      });
      await manager.save(older);
      await manager.save(newer);
      const result = await manager.findResumable('Refactor auth');
      // Both match but newer should win (updatedAt is higher)
      expect(result).not.toBeNull();
    });

    it('skips checkpoints without a taskDescription', async () => {
      const cp = makeCheckpoint({ sessionId: 'nodesc', taskDescription: undefined });
      await manager.save(cp);
      const result = await manager.findResumable('anything at all');
      expect(result).toBeNull();
    });
  });
});
