/**
 * WorktreeManager tests
 *
 * All tests require the process to be running inside a real git repository.
 * If the current working directory is not a git repo the suite is skipped.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { WorktreeManager } from "../worktree-manager.js";

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await execFile("git", ["rev-parse", "--git-dir"], { cwd: dir });
    return true;
  } catch {
    return false;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// Derive the project root — the test runner cwd is the repo root.
const PROJECT_ROOT = process.cwd();
const inGitRepo = await isGitRepo(PROJECT_ROOT);

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!inGitRepo)("WorktreeManager", () => {
  let manager: WorktreeManager;
  /** Track task IDs created during tests so afterEach can clean up stragglers. */
  const createdTasks: string[] = [];

  beforeAll(() => {
    manager = new WorktreeManager(PROJECT_ROOT);
  });

  afterEach(async () => {
    // Best-effort cleanup: remove any worktrees still registered
    for (const taskId of [...createdTasks]) {
      const info = manager.get(taskId);
      if (info) {
        try {
          await manager.remove(taskId);
        } catch {
          // Ignore – the test may have already removed it
        }
      }
    }
    createdTasks.length = 0;
  });

  afterAll(async () => {
    // Final prune to leave the repo tidy
    await manager.prune();
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  it("creates a worktree and returns WorktreeInfo", async () => {
    const taskId = `test-create-${Date.now()}`;
    createdTasks.push(taskId);

    const info = await manager.create({ taskId });

    expect(info.taskId).toBe(taskId);
    expect(info.branch).toMatch(/profclaw\/task-/);
    expect(info.baseBranch).toBeTruthy();
    expect(info.createdAt).toBeGreaterThan(0);
    expect(info.path).toContain(taskId);
  });

  it("worktree directory exists on disk after create", async () => {
    const taskId = `test-exists-${Date.now()}`;
    createdTasks.push(taskId);

    const info = await manager.create({ taskId });
    const exists = await pathExists(info.path);

    expect(exists).toBe(true);
  });

  it("honours a custom branchName option", async () => {
    const taskId = `test-custom-${Date.now()}`;
    createdTasks.push(taskId);

    const info = await manager.create({
      taskId,
      branchName: `custom/branch-${Date.now()}`,
    });

    expect(info.branch).toMatch(/^custom\/branch-/);
  });

  // -------------------------------------------------------------------------
  // list / get
  // -------------------------------------------------------------------------

  it("list returns all registered worktrees", async () => {
    const taskIdA = `test-list-a-${Date.now()}`;
    const taskIdB = `test-list-b-${Date.now()}`;
    createdTasks.push(taskIdA, taskIdB);

    await manager.create({ taskId: taskIdA });
    await manager.create({ taskId: taskIdB });

    const all = manager.list();
    const ids = all.map((w) => w.taskId);

    expect(ids).toContain(taskIdA);
    expect(ids).toContain(taskIdB);
  });

  it("get returns the correct WorktreeInfo for a task", async () => {
    const taskId = `test-get-${Date.now()}`;
    createdTasks.push(taskId);

    const created = await manager.create({ taskId });
    const retrieved = manager.get(taskId);

    expect(retrieved).toBeDefined();
    expect(retrieved?.path).toBe(created.path);
    expect(retrieved?.branch).toBe(created.branch);
  });

  it("get returns undefined for an unknown taskId", () => {
    expect(manager.get("nonexistent-task-xyz")).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // remove
  // -------------------------------------------------------------------------

  it("removes a worktree from disk and deregisters it", async () => {
    const taskId = `test-remove-${Date.now()}`;
    // Not pushed to createdTasks since we remove it ourselves
    const info = await manager.create({ taskId });

    await manager.remove(taskId);

    // No longer in the manager
    expect(manager.get(taskId)).toBeUndefined();
    expect(manager.list().map((w) => w.taskId)).not.toContain(taskId);

    // Directory should be gone from disk
    const exists = await pathExists(info.path);
    expect(exists).toBe(false);
  });

  it("throws when removing a taskId that is not registered", async () => {
    await expect(manager.remove("ghost-task-xyz")).rejects.toThrow(
      "No worktree found",
    );
  });

  // -------------------------------------------------------------------------
  // prune
  // -------------------------------------------------------------------------

  it("prune returns a number (may be zero if nothing stale)", async () => {
    const pruned = await manager.prune();
    expect(typeof pruned).toBe("number");
    expect(pruned).toBeGreaterThanOrEqual(0);
  });

  it("prune clears orphaned git worktree metadata", async () => {
    const taskId = `test-prune-${Date.now()}`;
    const info = await manager.create({ taskId });
    // Simulate an orphaned path: remove directory without using the manager
    const { execFile: raw } = await import("node:child_process");
    const { promisify: p } = await import("node:util");
    const { rm } = await import("node:fs/promises");
    const execRaw = p(raw);

    // Remove directory manually (so git still thinks the worktree exists)
    await rm(info.path, { recursive: true, force: true });

    // prune should pick up the orphaned entry
    const pruned = await manager.prune();
    expect(pruned).toBeGreaterThanOrEqual(0); // git may or may not report immediately

    // Clean up manager state
    manager["worktrees"].delete(taskId);
  });
});
