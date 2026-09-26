import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionDiffTracker, shortestEditScript } from '../session-diff.js';

async function makeTempDir(): Promise<string> {
  const dir = path.join(
    tmpdir(),
    `profclaw-diff-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

describe('SessionDiffTracker', () => {
  let tmpDir: string;
  let tracker: SessionDiffTracker;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
    tracker = new SessionDiffTracker();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // recordOriginal
  // -------------------------------------------------------------------------

  it('recordOriginal stores the original content (first call wins)', () => {
    const filePath = path.join(tmpDir, 'example.ts');

    tracker.recordOriginal(filePath, 'first');
    tracker.recordOriginal(filePath, 'second'); // must be ignored

    const files = tracker.getChangedFiles();
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe(filePath);
    expect(files[0].status).toBe('modified');
  });

  // -------------------------------------------------------------------------
  // recordCreated
  // -------------------------------------------------------------------------

  it('recordCreated marks the file with created status', () => {
    const filePath = path.join(tmpDir, 'new-file.ts');

    tracker.recordCreated(filePath);

    const files = tracker.getChangedFiles();
    expect(files).toHaveLength(1);
    expect(files[0].status).toBe('created');
  });

  it('recordCreated is a no-op if the file was already recorded', () => {
    const filePath = path.join(tmpDir, 'existing.ts');

    tracker.recordOriginal(filePath, 'original content');
    tracker.recordCreated(filePath); // should not overwrite

    const files = tracker.getChangedFiles();
    expect(files[0].status).toBe('modified');
  });

  // -------------------------------------------------------------------------
  // getFileDiff
  // -------------------------------------------------------------------------

  it('getFileDiff returns empty string when content is unchanged', async () => {
    const filePath = path.join(tmpDir, 'same.ts');
    const content = 'const a = 1;\n';
    await writeFile(filePath, content, 'utf-8');

    tracker.recordOriginal(filePath, content);

    const diff = await tracker.getFileDiff(filePath);
    expect(diff).toBe('');
  });

  it('getFileDiff returns a unified diff when content has changed', async () => {
    const filePath = path.join(tmpDir, 'changed.ts');
    await writeFile(filePath, 'const b = 2;\n', 'utf-8');

    tracker.recordOriginal(filePath, 'const a = 1;\n');

    const diff = await tracker.getFileDiff(filePath);
    expect(diff).toContain('---');
    expect(diff).toContain('+++');
    expect(diff).toContain('-const a = 1;');
    expect(diff).toContain('+const b = 2;');
  });

  it('getFileDiff shows created file diff (empty original)', async () => {
    const filePath = path.join(tmpDir, 'brand-new.ts');
    await writeFile(filePath, 'export const x = 42;\n', 'utf-8');

    tracker.recordCreated(filePath);

    const diff = await tracker.getFileDiff(filePath);
    expect(diff).toContain('+export const x = 42;');
  });

  it('getFileDiff shows deleted-file diff when file no longer exists', async () => {
    const filePath = path.join(tmpDir, 'deleted.ts');
    // File existed before (content recorded) but is now gone
    tracker.recordOriginal(filePath, 'delete me\n');
    // Don't create the file on disk — it's been deleted

    const diff = await tracker.getFileDiff(filePath);
    expect(diff).toContain('-delete me');
  });

  it('getFileDiff returns empty string for untracked file', async () => {
    const filePath = path.join(tmpDir, 'untracked.ts');
    const diff = await tracker.getFileDiff(filePath);
    expect(diff).toBe('');
  });

  // -------------------------------------------------------------------------
  // generateDiff
  // -------------------------------------------------------------------------

  it('generateDiff returns empty string when no files tracked', async () => {
    const diff = await tracker.generateDiff();
    expect(diff).toBe('');
  });

  it('generateDiff concatenates diffs for all changed files', async () => {
    const fileA = path.join(tmpDir, 'alpha.ts');
    const fileB = path.join(tmpDir, 'beta.ts');

    await writeFile(fileA, 'const a = 2;\n', 'utf-8');
    await writeFile(fileB, 'const b = 20;\n', 'utf-8');

    tracker.recordOriginal(fileA, 'const a = 1;\n');
    tracker.recordOriginal(fileB, 'const b = 10;\n');

    const diff = await tracker.generateDiff();
    expect(diff).toContain('alpha.ts');
    expect(diff).toContain('beta.ts');
    expect(diff).toContain('-const a = 1;');
    expect(diff).toContain('+const a = 2;');
    expect(diff).toContain('-const b = 10;');
    expect(diff).toContain('+const b = 20;');
  });

  it('generateDiff omits unchanged files', async () => {
    const fileA = path.join(tmpDir, 'unchanged.ts');
    const fileB = path.join(tmpDir, 'changed2.ts');

    const sameContent = 'no change here\n';
    await writeFile(fileA, sameContent, 'utf-8');
    await writeFile(fileB, 'after\n', 'utf-8');

    tracker.recordOriginal(fileA, sameContent);
    tracker.recordOriginal(fileB, 'before\n');

    const diff = await tracker.generateDiff();
    expect(diff).not.toContain('unchanged.ts');
    expect(diff).toContain('changed2.ts');
  });

  // -------------------------------------------------------------------------
  // getChangedFiles
  // -------------------------------------------------------------------------

  it('getChangedFiles returns correct statuses for mixed changes', () => {
    const created = path.join(tmpDir, 'c.ts');
    const modified = path.join(tmpDir, 'm.ts');

    tracker.recordCreated(created);
    tracker.recordOriginal(modified, 'old');

    const files = tracker.getChangedFiles();
    const createdEntry = files.find((f) => f.path === created);
    const modifiedEntry = files.find((f) => f.path === modified);

    expect(createdEntry?.status).toBe('created');
    expect(modifiedEntry?.status).toBe('modified');
  });
});

describe('shortestEditScript', () => {
  function replay(edits: Array<['+' | '-' | '=', string]>): { before: string[]; after: string[] } {
    const before: string[] = [];
    const after: string[] = [];
    for (const [type, line] of edits) {
      if (type !== '+') before.push(line);
      if (type !== '-') after.push(line);
    }
    return { before, after };
  }

  it('reports a one-line change as one removal and one addition in place', () => {
    const oldLines = ['a', 'b', 'c', 'd'];
    const newLines = ['a', 'b', 'C', 'd'];
    const edits = shortestEditScript(oldLines, newLines);
    expect(edits.filter(([t]) => t !== '=')).toEqual([
      ['-', 'c'],
      ['+', 'C'],
    ]);
    expect(replay(edits)).toEqual({ before: oldLines, after: newLines });
  });

  it('reconstructs both inputs for random inputs and never exceeds the trivial edit cost', () => {
    let seed = 12345;
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const alphabet = ['a', 'b', 'c', 'd', 'e'];
    for (let i = 0; i < 300; i++) {
      const oldLines = Array.from({ length: rand(9) }, () => alphabet[rand(alphabet.length)]);
      const newLines = Array.from({ length: rand(9) }, () => alphabet[rand(alphabet.length)]);
      const edits = shortestEditScript(oldLines, newLines);
      const { before, after } = replay(edits);
      expect(before).toEqual(oldLines);
      expect(after).toEqual(newLines);
      const cost = edits.filter(([t]) => t !== '=').length;
      expect(cost).toBeLessThanOrEqual(oldLines.length + newLines.length);
    }
  });

  it('produces the right unified diff for a change on the third line', async () => {
    const dir = await makeTempDir();
    try {
      const file = path.join(dir, 'math.js');
      const original = 'one\ntwo\nthree + 1\nfour\n';
      await writeFile(file, 'one\ntwo\nthree\nfour\n');
      const t = new SessionDiffTracker();
      t.recordOriginal(file, original);
      const diff = await t.generateDiff();
      expect(diff).toContain('-three + 1');
      expect(diff).toContain('+three');
      expect(diff).not.toMatch(/^[+-]one$/m);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
