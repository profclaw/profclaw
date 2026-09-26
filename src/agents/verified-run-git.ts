/**
 * Git-backed workspace for verified runs.
 *
 * Isolation comes from WorktreeManager. Checkpoints are commits on the run
 * branch: restoring is `git reset --hard <sha>` plus `git clean -fd`, so a
 * failed attempt can be discarded without touching the user's main tree.
 * All git calls use execFile (no shell), and nothing here pushes.
 */

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { WorktreeManager } from './worktree-manager.js';
import type { FileChangeStatus } from './session-diff.js';

const execFile = promisify(execFileCb);

export interface WorkspaceChange {
  /** Absolute path in the workspace */
  path: string;
  /** Path relative to the workspace root */
  relPath: string;
  status: FileChangeStatus;
  /** Content at the base commit, null for created files */
  original: string | null;
}

/** Everything the run loop needs from an isolated working copy. */
export interface RunWorkspace {
  readonly path: string;
  readonly branch: string;
  /** Create the isolated copy and return a ref for its pristine state. */
  prepare(): Promise<string>;
  /** Persist the current state and return a ref that restore() accepts. */
  checkpoint(label: string): Promise<string>;
  /** Discard everything since the given ref. */
  restore(ref: string): Promise<void>;
  /** Files differing from the pristine state. */
  changedFiles(): Promise<WorkspaceChange[]>;
  /** Remove the isolated copy (the branch is kept). */
  dispose(): Promise<void>;
}

const IDENTITY = ['-c', 'user.name=profClaw', '-c', 'user.email=bot@profclaw.ai', '-c', 'commit.gpgsign=false'];

export class GitRunWorkspace implements RunWorkspace {
  path = '';
  branch: string;
  private baseRef = '';
  private readonly manager: WorktreeManager;

  constructor(
    private readonly projectRoot: string,
    private readonly runId: string,
    branchName?: string,
  ) {
    this.manager = new WorktreeManager(projectRoot);
    this.branch = branchName ?? `profclaw/run-${runId}`;
  }

  private async git(args: string[], cwd?: string): Promise<string> {
    const { stdout } = await execFile('git', args, {
      cwd: cwd ?? (this.path || this.projectRoot),
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  }

  async prepare(): Promise<string> {
    const info = await this.manager.create({
      taskId: this.runId,
      branchName: this.branch,
    });
    this.path = info.path;
    this.branch = info.branch;
    this.baseRef = (await this.git(['rev-parse', 'HEAD'])).trim();
    return this.baseRef;
  }

  async checkpoint(label: string): Promise<string> {
    await this.git(['add', '-A']);
    await this.git([...IDENTITY, 'commit', '--allow-empty', '--no-verify', '-m', `profclaw run: ${label}`]);
    return (await this.git(['rev-parse', 'HEAD'])).trim();
  }

  async restore(ref: string): Promise<void> {
    await this.git(['reset', '--hard', ref]);
    await this.git(['clean', '-fd']);
  }

  async changedFiles(): Promise<WorkspaceChange[]> {
    // Include uncommitted work by staging it into the index first (no commit).
    await this.git(['add', '-A']);
    const raw = await this.git(['diff', '--cached', '--name-status', '--no-renames', this.baseRef]);
    const changes: WorkspaceChange[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      const [code, ...rest] = line.split('\t');
      const relPath = rest.join('\t');
      const status: FileChangeStatus = code === 'A' ? 'created' : code === 'D' ? 'deleted' : 'modified';
      let original: string | null = null;
      if (status !== 'created') {
        try {
          original = await this.git(['show', `${this.baseRef}:${relPath}`]);
        } catch {
          original = null;
        }
      }
      changes.push({ path: join(this.path, relPath), relPath, status, original });
    }
    return changes;
  }

  async dispose(): Promise<void> {
    await this.manager.remove(this.runId);
  }
}
