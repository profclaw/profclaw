/**
 * Plan Mode - Two-phase workflow for agent task planning and execution
 *
 * Provides plan storage and management. Plans are persisted to
 * .profclaw/plans/{id}.json inside the project root (or home dir fallback).
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../utils/logger.js';

// Types

export interface PlanStep {
  index: number;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  files?: string[];
  estimatedEffort?: 'small' | 'medium' | 'large';
}

export interface Plan {
  id: string;
  taskId?: string;
  title: string;
  steps: PlanStep[];
  status: 'draft' | 'approved' | 'in_progress' | 'completed' | 'rejected';
  rejectionReason?: string;
  createdAt: number;
  approvedAt?: number;
  completedAt?: number;
}

// Helpers

function resolvePlansDir(projectRoot?: string): string {
  const base = projectRoot ?? process.cwd();
  return join(base, '.profclaw', 'plans');
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// PlanManager

export class PlanManager {
  private plans: Map<string, Plan>;
  private plansDir: string;

  constructor(projectRoot?: string) {
    this.plans = new Map();
    this.plansDir = resolvePlansDir(projectRoot ?? homedir());
    this._loadAll();
  }

  /** Load all persisted plans from disk into memory */
  private _loadAll(): void {
    try {
      if (!existsSync(this.plansDir)) return;
      const files = readdirSync(this.plansDir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        const planId = file.replace(/\.json$/, '');
        const plan = this.load(planId);
        if (plan) {
          this.plans.set(plan.id, plan);
        }
      }
    } catch (err) {
      logger.warn('[PlanManager] Failed to load plans from disk:', { error: String(err) });
    }
  }

  /**
   * Create a new plan in draft status.
   */
  create(title: string, steps: Omit<PlanStep, 'status'>[]): Plan {
    const plan: Plan = {
      id: randomUUID(),
      title,
      steps: steps.map((s) => ({ ...s, status: 'pending' as const })),
      status: 'draft',
      createdAt: Date.now(),
    };
    this.plans.set(plan.id, plan);
    this.save(plan);
    logger.info('[PlanManager] Plan created:', { id: plan.id, title, stepCount: steps.length });
    return plan;
  }

  /**
   * Approve a draft plan, transitioning it to in_progress.
   */
  approve(planId: string): Plan {
    const plan = this._getOrThrow(planId);
    if (plan.status !== 'draft') {
      throw new Error(`Plan ${planId} is not in draft status (current: ${plan.status})`);
    }
    const updated: Plan = {
      ...plan,
      status: 'in_progress',
      approvedAt: Date.now(),
    };
    this.plans.set(planId, updated);
    this.save(updated);
    logger.info('[PlanManager] Plan approved:', { id: planId });
    return updated;
  }

  /**
   * Reject a draft plan.
   */
  reject(planId: string, reason?: string): Plan {
    const plan = this._getOrThrow(planId);
    if (plan.status !== 'draft') {
      throw new Error(`Plan ${planId} is not in draft status (current: ${plan.status})`);
    }
    const updated: Plan = {
      ...plan,
      status: 'rejected',
      rejectionReason: reason,
    };
    this.plans.set(planId, updated);
    this.save(updated);
    logger.info('[PlanManager] Plan rejected:', { id: planId, reason });
    return updated;
  }

  /**
   * Update the status of a specific step. Automatically marks the plan as
   * completed when all steps are either completed or skipped.
   */
  updateStep(planId: string, stepIndex: number, status: PlanStep['status']): Plan {
    const plan = this._getOrThrow(planId);
    const stepIdx = plan.steps.findIndex((s) => s.index === stepIndex);
    if (stepIdx === -1) {
      throw new Error(`Step ${stepIndex} not found in plan ${planId}`);
    }

    const updatedSteps = plan.steps.map((s) =>
      s.index === stepIndex ? { ...s, status } : s
    );

    const allDone = updatedSteps.every(
      (s) => s.status === 'completed' || s.status === 'skipped'
    );

    const updated: Plan = {
      ...plan,
      steps: updatedSteps,
      status: allDone ? 'completed' : plan.status,
      completedAt: allDone ? Date.now() : plan.completedAt,
    };
    this.plans.set(planId, updated);
    this.save(updated);
    return updated;
  }

  /**
   * Get a plan by ID. Returns undefined if not found.
   */
  get(planId: string): Plan | undefined {
    return this.plans.get(planId);
  }

  /**
   * Returns the currently active (in_progress) plan, if any.
   */
  getActive(): Plan | undefined {
    for (const plan of this.plans.values()) {
      if (plan.status === 'in_progress') {
        return plan;
      }
    }
    return undefined;
  }

  /**
   * Returns all plans, sorted newest first.
   */
  list(): Plan[] {
    return Array.from(this.plans.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Persist a plan to .profclaw/plans/{id}.json
   */
  save(plan: Plan): void {
    try {
      ensureDir(this.plansDir);
      const filePath = join(this.plansDir, `${plan.id}.json`);
      writeFileSync(filePath, JSON.stringify(plan, null, 2), 'utf-8');
    } catch (err) {
      logger.error('[PlanManager] Failed to save plan:', err as Error);
    }
  }

  /**
   * Load a single plan from disk by ID.
   */
  load(planId: string): Plan | undefined {
    try {
      const filePath = join(this.plansDir, `${planId}.json`);
      if (!existsSync(filePath)) return undefined;
      const raw = readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as Plan;
    } catch (err) {
      logger.warn(`[PlanManager] Failed to load plan ${planId}:`, { error: String(err) });
      return undefined;
    }
  }

  // Private helpers

  private _getOrThrow(planId: string): Plan {
    const plan = this.plans.get(planId);
    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }
    return plan;
  }
}

// Singleton instance used by tools and CLI commands
export const planManager = new PlanManager();
