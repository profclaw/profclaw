/**
 * File Snapshot Manager
 *
 * Captures file contents before edits so users can rewind changes.
 * Snapshots are persisted to disk under .profclaw/snapshots/{sessionId}/
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export interface FileSnapshot {
  path: string;
  content: string;
  timestamp: number;
  turnIndex: number;
}

interface SnapshotIndex {
  sessionId: string;
  snapshots: Record<string, FileSnapshot[]>;
}

let defaultManager: FileSnapshotManager | null = null;

export class FileSnapshotManager {
  private snapshots: Map<string, FileSnapshot[]>;
  private sessionDir: string;

  constructor(sessionId: string) {
    this.snapshots = new Map();
    this.sessionDir = path.join('.profclaw', 'snapshots', sessionId);
  }

  /**
   * Call BEFORE writing a file.
   * Reads current contents and stores a snapshot keyed by file path.
   * If the file does not exist yet, the snapshot is skipped (new file creation).
   */
  async captureBeforeEdit(filePath: string, turnIndex: number): Promise<void> {
    const resolved = path.resolve(filePath);

    let content: string;
    try {
      content = await fs.readFile(resolved, 'utf-8');
    } catch {
      // File does not exist — nothing to snapshot before creation
      return;
    }

    const snapshot: FileSnapshot = {
      path: resolved,
      content,
      timestamp: Date.now(),
      turnIndex,
    };

    const history = this.snapshots.get(resolved) ?? [];
    history.push(snapshot);
    this.snapshots.set(resolved, history);
  }

  /**
   * Rewind a file to its state before a specific turn.
   * If no turnIndex is supplied, rewinds to the most recent snapshot.
   */
  async rewind(
    filePath: string,
    turnIndex?: number,
  ): Promise<{ restored: boolean; path: string; turnIndex: number }> {
    const resolved = path.resolve(filePath);
    const history = this.snapshots.get(resolved);

    if (!history || history.length === 0) {
      return { restored: false, path: resolved, turnIndex: turnIndex ?? -1 };
    }

    let target: FileSnapshot;
    if (turnIndex === undefined) {
      target = history[history.length - 1];
    } else {
      // Find the latest snapshot at or before the requested turn
      const candidates = history.filter((s) => s.turnIndex <= turnIndex);
      if (candidates.length === 0) {
        return { restored: false, path: resolved, turnIndex };
      }
      target = candidates[candidates.length - 1];
    }

    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, target.content, 'utf-8');

    return { restored: true, path: resolved, turnIndex: target.turnIndex };
  }

  /**
   * Rewind ALL files that were modified during the given turn.
   * Restores each file to the snapshot captured at the start of that turn
   * (i.e. the snapshot whose turnIndex equals the supplied value).
   */
  async rewindTurn(
    turnIndex: number,
  ): Promise<Array<{ path: string; restored: boolean }>> {
    const results: Array<{ path: string; restored: boolean }> = [];

    for (const [filePath, history] of this.snapshots.entries()) {
      const hadChangeInTurn = history.some((s) => s.turnIndex === turnIndex);
      if (!hadChangeInTurn) continue;

      // Find the snapshot taken at the start of this turn (before the edit)
      const snapshot = history.find((s) => s.turnIndex === turnIndex);
      if (!snapshot) {
        results.push({ path: filePath, restored: false });
        continue;
      }

      try {
        const resolved = path.resolve(filePath);
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, snapshot.content, 'utf-8');
        results.push({ path: filePath, restored: true });
      } catch {
        results.push({ path: filePath, restored: false });
      }
    }

    return results;
  }

  /**
   * List all files that have at least one snapshot.
   */
  getModifiedFiles(): Array<{
    path: string;
    snapshotCount: number;
    lastModified: number;
  }> {
    const result: Array<{
      path: string;
      snapshotCount: number;
      lastModified: number;
    }> = [];

    for (const [filePath, history] of this.snapshots.entries()) {
      if (history.length === 0) continue;
      const lastModified = history[history.length - 1].timestamp;
      result.push({
        path: filePath,
        snapshotCount: history.length,
        lastModified,
      });
    }

    return result;
  }

  /**
   * Return the full snapshot history for a specific file.
   */
  getHistory(filePath: string): FileSnapshot[] {
    const resolved = path.resolve(filePath);
    return this.snapshots.get(resolved) ?? [];
  }

  /**
   * Persist snapshot index to disk.
   */
  async save(): Promise<void> {
    try {
      await fs.mkdir(this.sessionDir, { recursive: true });
      const indexPath = path.join(this.sessionDir, 'index.json');

      const index: SnapshotIndex = {
        sessionId: path.basename(this.sessionDir),
        snapshots: {},
      };

      for (const [filePath, history] of this.snapshots.entries()) {
        index.snapshots[filePath] = history;
      }

      await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
    } catch {
      // Non-fatal — snapshots still work in memory
    }
  }

  /**
   * Load snapshot index from disk (for session resume).
   */
  async load(): Promise<void> {
    try {
      const indexPath = path.join(this.sessionDir, 'index.json');
      const raw = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(raw) as SnapshotIndex;

      for (const [filePath, history] of Object.entries(index.snapshots)) {
        this.snapshots.set(filePath, history);
      }
    } catch {
      // No persisted data — start fresh
    }
  }

  /**
   * Remove the on-disk snapshot directory.
   */
  async cleanup(): Promise<void> {
    try {
      await fs.rm(this.sessionDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
    this.snapshots.clear();
  }
}

/**
 * Returns the singleton FileSnapshotManager for this process.
 * Pass sessionId on first call to initialise; subsequent calls without an
 * argument return the existing instance.
 */
export function getFileSnapshotManager(sessionId?: string): FileSnapshotManager {
  if (!defaultManager) {
    const id = sessionId ?? `session-${Date.now().toString(36)}`;
    defaultManager = new FileSnapshotManager(id);
  }
  return defaultManager;
}
