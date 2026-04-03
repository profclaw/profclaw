/**
 * Worktree Manager
 *
 * Provides git worktree isolation for agent tasks. Each task can optionally
 * run in its own git worktree so concurrent agents don't create dirty-tree
 * conflicts on the main working tree.
 *
 * All git operations use execFile (not shell) to avoid injection risks.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { logger } from '../utils/logger.js';

const execFile = promisify(execFileCb);

// Types

export interface WorktreeInfo {
  /** Absolute path to the worktree directory */
  path: string;
  /** Branch checked out in this worktree */
  branch: string;
  /** Branch the worktree was created from */
  baseBranch: string;
  /** Unix timestamp (ms) when this worktree was created */
  createdAt: number;
  /** Optional task identifier that owns this worktree */
  taskId?: string;
}

export interface MergeResult {
  success: boolean;
  /** Conflicting file paths when success is false */
  conflicts?: string[];
}

// Helpers

function sanitizeBranchName(name: string): string {
  // Strip characters that are not safe in git branch names
  return name.replace(/[^a-zA-Z0-9/_.-]/g, "-").replace(/^[-.]|[-.]$/g, "");
}

async function getCurrentBranch(cwd: string): Promise<string> {
  const { stdout } = await execFile(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    { cwd },
  );
  return stdout.trim();
}

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await execFile("git", ["rev-parse", "--git-dir"], { cwd: dir });
    return true;
  } catch {
    return false;
  }
}

// WorktreeManager

export class WorktreeManager {
  private readonly worktrees: Map<string, WorktreeInfo> = new Map();
  /** Absolute path to the directory that holds all created worktrees */
  private readonly baseDir: string;
  /** Resolved project root (the main git working tree) */
  private readonly projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = resolve(projectRoot ?? process.cwd());
    this.baseDir = join(this.projectRoot, ".profclaw", "worktrees");
  }

  /**
   * Create an isolated worktree for a task.
   *
   * Runs: git worktree add <path> -b <branch> [baseBranch]
   */
  async create(options: {
    taskId: string;
    /** Branch to base the new worktree on (defaults to current HEAD branch) */
    baseBranch?: string;
    /** Name for the new branch (defaults to profclaw/task-{taskId}) */
    branchName?: string;
  }): Promise<WorktreeInfo> {
    const { taskId } = options;

    if (!(await isGitRepo(this.projectRoot))) {
      throw new Error(
        `[WorktreeManager] ${this.projectRoot} is not a git repository`,
      );
    }

    const baseBranch =
      options.baseBranch ?? (await getCurrentBranch(this.projectRoot));
    const rawBranch = options.branchName ?? `profclaw/task-${taskId}`;
    const branch = sanitizeBranchName(rawBranch);
    const worktreePath = join(this.baseDir, taskId);

    // Ensure the base directory exists
    await mkdir(this.baseDir, { recursive: true });

    try {
      await execFile(
        "git",
        ["worktree", "add", worktreePath, "-b", branch, baseBranch],
        { cwd: this.projectRoot },
      );
    } catch (error: unknown) {
      throw new Error(
        `[WorktreeManager] Failed to create worktree for task ${taskId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const info: WorktreeInfo = {
      path: worktreePath,
      branch,
      baseBranch,
      createdAt: Date.now(),
      taskId,
    };

    this.worktrees.set(taskId, info);
    logger.info(`[WorktreeManager] Created worktree for task ${taskId} at ${worktreePath}`);
    return info;
  }

  /** Return all active worktrees tracked by this manager instance. */
  list(): WorktreeInfo[] {
    return Array.from(this.worktrees.values());
  }

  /** Return the WorktreeInfo for a specific task, or undefined if unknown. */
  get(taskId: string): WorktreeInfo | undefined {
    return this.worktrees.get(taskId);
  }

  /**
   * Merge the worktree's branch back into its base branch.
   *
   * Runs: git merge [--squash] <branch>  (executed from the base worktree)
   */
  async merge(
    taskId: string,
    options?: { squash?: boolean; message?: string },
  ): Promise<MergeResult> {
    const info = this.worktrees.get(taskId);
    if (!info) {
      throw new Error(
        `[WorktreeManager] No worktree found for task ${taskId}`,
      );
    }

    const args = ["merge"];
    if (options?.squash) {
      args.push("--squash");
    }
    args.push(info.branch);

    if (options?.message) {
      args.push("-m", options.message);
    }

    try {
      await execFile("git", args, { cwd: this.projectRoot });
      logger.info(
        `[WorktreeManager] Merged branch ${info.branch} into ${info.baseBranch}`,
      );
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      // Extract conflicting file names from git's error/stdout output
      const conflicts = message
        .split("\n")
        .filter((line) => line.startsWith("CONFLICT"))
        .map((line) => line.replace(/^CONFLICT[^:]*:\s*/i, "").trim())
        .filter(Boolean);

      logger.error(
        `[WorktreeManager] Merge conflicts for task ${taskId}:`,
        error instanceof Error ? error : new Error(String(error)),
      );
      return { success: false, conflicts };
    }
  }

  /**
   * Remove a worktree from disk and deregister it.
   *
   * Runs: git worktree remove <path>
   */
  async remove(taskId: string): Promise<void> {
    const info = this.worktrees.get(taskId);
    if (!info) {
      throw new Error(
        `[WorktreeManager] No worktree found for task ${taskId}`,
      );
    }

    try {
      await execFile("git", ["worktree", "remove", info.path, "--force"], {
        cwd: this.projectRoot,
      });
    } catch (error: unknown) {
      // If git worktree remove fails (e.g. path already gone) try to clean up
      // the directory ourselves so we stay consistent.
      logger.error(
        `[WorktreeManager] git worktree remove failed for task ${taskId}, attempting manual rm:`,
        error instanceof Error ? error : new Error(String(error)),
      );
      try {
        await rm(info.path, { recursive: true, force: true });
      } catch (rmError: unknown) {
        logger.error(
          `[WorktreeManager] Manual rm also failed for ${info.path}:`,
          rmError instanceof Error ? rmError : new Error(String(rmError)),
        );
      }
    }

    this.worktrees.delete(taskId);
    logger.info(`[WorktreeManager] Removed worktree for task ${taskId}`);
  }

  /**
   * Prune stale worktree metadata that git is tracking but whose paths no
   * longer exist on disk.
   *
   * Runs: git worktree prune
   *
   * @returns Number of pruned entries as reported by git
   */
  async prune(): Promise<number> {
    if (!(await isGitRepo(this.projectRoot))) {
      return 0;
    }

    try {
      const { stderr } = await execFile(
        "git",
        ["worktree", "prune", "--verbose"],
        { cwd: this.projectRoot },
      );

      // git prints one line per pruned entry to stderr when --verbose is given
      const pruned = stderr
        .split("\n")
        .filter((line) => line.trim().length > 0).length;

      if (pruned > 0) {
        logger.info(`[WorktreeManager] Pruned ${pruned} stale worktree(s)`);
      }
      return pruned;
    } catch (error: unknown) {
      logger.error(`[WorktreeManager] Failed to prune worktrees:`, error instanceof Error ? error : new Error(String(error)));
      return 0;
    }
  }
}

// Singleton

let _manager: WorktreeManager | undefined;

/**
 * Return a shared WorktreeManager rooted at the current working directory.
 * Use the WorktreeManager constructor directly if you need a different root.
 */
export function getWorktreeManager(): WorktreeManager {
  if (!_manager) {
    _manager = new WorktreeManager();
  }
  return _manager;
}
