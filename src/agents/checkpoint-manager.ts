/**
 * Checkpoint Manager
 *
 * Saves and restores executor state so long-running agentic sessions can be
 * interrupted and resumed without losing progress.  Checkpoints live at
 * .profclaw/checkpoints/<sessionId>.json relative to the project root (or the
 * current working directory when no root is supplied).
 */

import { mkdir, readFile, writeFile, unlink, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ModelMessage } from 'ai';
import { logger } from '../utils/logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExecutorCheckpoint {
  /** Session that produced this checkpoint */
  sessionId: string;
  /** Human-readable description of the original task */
  taskDescription?: string;
  /** How many steps have been executed so far */
  currentStep: number;
  /** Expected total steps (best-effort estimate) */
  totalSteps: number;
  /** Full message history up to this point */
  messages: ModelMessage[];
  /** Cumulative tokens consumed */
  tokensUsed: number;
  /** Estimated dollar cost so far */
  estimatedCost: number;
  /** Every tool call made so far: name, success flag, and the step it ran in */
  toolCallHistory: Array<{ name: string; success: boolean; step: number }>;
  /** Files that have already been processed (for file-iteration tasks) */
  completedFiles?: string[];
  /** Free-text description of what still needs to happen */
  remainingWork?: string;
  /** Unix epoch ms — when the checkpoint was first created */
  createdAt: number;
  /** Unix epoch ms — when the checkpoint was last saved */
  updatedAt: number;
}

/** Lightweight summary returned by list() */
export interface CheckpointSummary {
  sessionId: string;
  taskDescription?: string;
  step: number;
  updatedAt: number;
}

// ─── CheckpointManager ────────────────────────────────────────────────────────

export class CheckpointManager {
  private readonly checkpointsDir: string;

  constructor(projectRoot?: string) {
    const root = projectRoot ? resolve(projectRoot) : process.cwd();
    this.checkpointsDir = join(root, '.profclaw', 'checkpoints');
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private filePath(sessionId: string): string {
    return join(this.checkpointsDir, `${sessionId}.json`);
  }

  private async ensureDir(): Promise<void> {
    if (!existsSync(this.checkpointsDir)) {
      await mkdir(this.checkpointsDir, { recursive: true });
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Persist a checkpoint to disk.  Creates .profclaw/checkpoints/ if needed.
   */
  async save(checkpoint: ExecutorCheckpoint): Promise<void> {
    await this.ensureDir();
    const path = this.filePath(checkpoint.sessionId);
    const payload = JSON.stringify({ ...checkpoint, updatedAt: Date.now() }, null, 2);
    await writeFile(path, payload, 'utf-8');
    logger.debug('[CheckpointManager] Saved checkpoint', {
      sessionId: checkpoint.sessionId,
      step: checkpoint.currentStep,
      path,
    });
  }

  /**
   * Load a previously saved checkpoint.  Returns null when none exists.
   */
  async load(sessionId: string): Promise<ExecutorCheckpoint | null> {
    const path = this.filePath(sessionId);
    try {
      const raw = await readFile(path, 'utf-8');
      const parsed = JSON.parse(raw) as ExecutorCheckpoint;
      logger.debug('[CheckpointManager] Loaded checkpoint', {
        sessionId,
        step: parsed.currentStep,
      });
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * List all checkpoints, sorted newest first.
   */
  async list(): Promise<CheckpointSummary[]> {
    if (!existsSync(this.checkpointsDir)) return [];

    let files: string[];
    try {
      files = await readdir(this.checkpointsDir);
    } catch {
      return [];
    }

    const summaries: CheckpointSummary[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await readFile(join(this.checkpointsDir, file), 'utf-8');
        const cp = JSON.parse(raw) as ExecutorCheckpoint;
        summaries.push({
          sessionId: cp.sessionId,
          taskDescription: cp.taskDescription,
          step: cp.currentStep,
          updatedAt: cp.updatedAt,
        });
      } catch {
        // Skip malformed files
      }
    }

    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Delete a checkpoint after the session has completed successfully.
   */
  async remove(sessionId: string): Promise<void> {
    const path = this.filePath(sessionId);
    try {
      await unlink(path);
      logger.debug('[CheckpointManager] Removed checkpoint', { sessionId });
    } catch {
      // Already gone — not an error
    }
  }

  /**
   * Find a resumable checkpoint whose taskDescription loosely matches the
   * given description (case-insensitive substring + word overlap heuristic).
   * Returns the most recently updated match, or null if nothing qualifies.
   */
  async findResumable(taskDescription: string): Promise<ExecutorCheckpoint | null> {
    const all = await this.list();
    if (all.length === 0) return null;

    const needle = taskDescription.toLowerCase();
    const needleWords = new Set(needle.split(/\W+/).filter(Boolean));

    let bestScore = 0;
    let bestId: string | null = null;

    for (const summary of all) {
      if (!summary.taskDescription) continue;
      const hay = summary.taskDescription.toLowerCase();

      // Substring match is a strong signal
      if (hay.includes(needle) || needle.includes(hay)) {
        // Prefer the most recently updated substring match
        if (summary.updatedAt > (bestScore === 2 ? 0 : -1)) {
          bestScore = 2;
          bestId = summary.sessionId;
        }
        continue;
      }

      // Word-overlap fallback
      const hayWords = hay.split(/\W+/).filter(Boolean);
      const overlap = hayWords.filter((w) => needleWords.has(w)).length;
      const ratio = needleWords.size > 0 ? overlap / needleWords.size : 0;
      if (ratio >= 0.5 && ratio > bestScore) {
        bestScore = ratio;
        bestId = summary.sessionId;
      }
    }

    if (!bestId) return null;
    return this.load(bestId);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _instance: CheckpointManager | undefined;

export function getCheckpointManager(projectRoot?: string): CheckpointManager {
  if (!_instance) {
    _instance = new CheckpointManager(projectRoot);
  }
  return _instance;
}
