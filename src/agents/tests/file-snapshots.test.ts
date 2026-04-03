import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileSnapshotManager } from '../file-snapshots.js';

// Each test gets its own temp directory so tests are isolated
async function makeTempDir(): Promise<string> {
  const dir = path.join(tmpdir(), `profclaw-snap-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe('FileSnapshotManager', () => {
  let tmpDir: string;
  let manager: FileSnapshotManager;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
    manager = new FileSnapshotManager(`test-session-${Date.now()}`);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    await manager.cleanup();
  });

  // -------------------------------------------------------------------------
  // captureBeforeEdit
  // -------------------------------------------------------------------------

  it('captureBeforeEdit stores file content before a write', async () => {
    const filePath = path.join(tmpDir, 'hello.ts');
    await writeFile(filePath, 'const x = 1;', 'utf-8');

    await manager.captureBeforeEdit(filePath, 0);

    const history = manager.getHistory(filePath);
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe('const x = 1;');
    expect(history[0].turnIndex).toBe(0);
  });

  it('captureBeforeEdit is a no-op when the file does not exist', async () => {
    const filePath = path.join(tmpDir, 'new-file.ts');

    await manager.captureBeforeEdit(filePath, 0);

    const history = manager.getHistory(filePath);
    expect(history).toHaveLength(0);
  });

  it('captureBeforeEdit accumulates multiple snapshots for the same file', async () => {
    const filePath = path.join(tmpDir, 'multi.ts');
    await writeFile(filePath, 'v1', 'utf-8');
    await manager.captureBeforeEdit(filePath, 0);

    await writeFile(filePath, 'v2', 'utf-8');
    await manager.captureBeforeEdit(filePath, 1);

    const history = manager.getHistory(filePath);
    expect(history).toHaveLength(2);
    expect(history[0].content).toBe('v1');
    expect(history[1].content).toBe('v2');
  });

  // -------------------------------------------------------------------------
  // rewind
  // -------------------------------------------------------------------------

  it('rewind restores file to the most recent snapshot when no turnIndex given', async () => {
    const filePath = path.join(tmpDir, 'rewind.ts');
    await writeFile(filePath, 'original', 'utf-8');
    await manager.captureBeforeEdit(filePath, 0);

    // Simulate edit
    await writeFile(filePath, 'modified', 'utf-8');

    const result = await manager.rewind(filePath);
    expect(result.restored).toBe(true);

    const restored = await readFile(filePath, 'utf-8');
    expect(restored).toBe('original');
  });

  it('rewind to a specific turnIndex restores the correct version', async () => {
    const filePath = path.join(tmpDir, 'versioned.ts');

    await writeFile(filePath, 'turn-0', 'utf-8');
    await manager.captureBeforeEdit(filePath, 0);

    await writeFile(filePath, 'turn-1', 'utf-8');
    await manager.captureBeforeEdit(filePath, 1);

    await writeFile(filePath, 'turn-2', 'utf-8');

    // Rewind to state before turn 1 (i.e. the turn-0 snapshot)
    const result = await manager.rewind(filePath, 0);
    expect(result.restored).toBe(true);
    expect(result.turnIndex).toBe(0);

    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe('turn-0');
  });

  it('rewind returns restored=false when no snapshot exists', async () => {
    const filePath = path.join(tmpDir, 'never-touched.ts');

    const result = await manager.rewind(filePath);
    expect(result.restored).toBe(false);
  });

  // -------------------------------------------------------------------------
  // rewindTurn
  // -------------------------------------------------------------------------

  it('rewindTurn restores all files modified in a given turn', async () => {
    const fileA = path.join(tmpDir, 'a.ts');
    const fileB = path.join(tmpDir, 'b.ts');

    await writeFile(fileA, 'a-original', 'utf-8');
    await writeFile(fileB, 'b-original', 'utf-8');

    // Both files are snapshotted at turn 1
    await manager.captureBeforeEdit(fileA, 1);
    await manager.captureBeforeEdit(fileB, 1);

    // Simulate writes
    await writeFile(fileA, 'a-modified', 'utf-8');
    await writeFile(fileB, 'b-modified', 'utf-8');

    const results = await manager.rewindTurn(1);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.restored)).toBe(true);

    const contA = await readFile(fileA, 'utf-8');
    const contB = await readFile(fileB, 'utf-8');
    expect(contA).toBe('a-original');
    expect(contB).toBe('b-original');
  });

  it('rewindTurn returns empty array when no files were touched in that turn', async () => {
    const fileA = path.join(tmpDir, 'untouched.ts');
    await writeFile(fileA, 'x', 'utf-8');
    await manager.captureBeforeEdit(fileA, 0);

    const results = await manager.rewindTurn(99);
    expect(results).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // getModifiedFiles
  // -------------------------------------------------------------------------

  it('getModifiedFiles lists only files with at least one snapshot', async () => {
    const fileA = path.join(tmpDir, 'listed.ts');
    const fileB = path.join(tmpDir, 'unlisted.ts');

    await writeFile(fileA, 'content', 'utf-8');
    await manager.captureBeforeEdit(fileA, 0);
    // fileB is never captured

    const modified = manager.getModifiedFiles();
    expect(modified).toHaveLength(1);
    expect(modified[0].path).toBe(path.resolve(fileA));
    expect(modified[0].snapshotCount).toBe(1);
    expect(modified[0].lastModified).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // save / load
  // -------------------------------------------------------------------------

  it('save and load round-trips snapshot data to disk', async () => {
    const filePath = path.join(tmpDir, 'persist.ts');
    await writeFile(filePath, 'persisted content', 'utf-8');
    await manager.captureBeforeEdit(filePath, 2);

    await manager.save();

    // New manager instance loading from same session dir
    const sessionId = (manager as unknown as { sessionDir: string }).sessionDir
      .split(path.sep)
      .pop() ?? 'unknown';

    const manager2 = new FileSnapshotManager(sessionId);
    await manager2.load();

    const history = manager2.getHistory(filePath);
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe('persisted content');
    expect(history[0].turnIndex).toBe(2);

    await manager2.cleanup();
  });
});
