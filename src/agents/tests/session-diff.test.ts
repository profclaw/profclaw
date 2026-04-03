import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionDiffTracker } from '../session-diff.js';

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
