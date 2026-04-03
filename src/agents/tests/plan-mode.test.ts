import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PlanManager } from '../plan-mode.js';
import type { Plan } from '../plan-mode.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  const dir = join(tmpdir(), `plan-mode-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function removeTmpDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SAMPLE_STEPS = [
  { index: 1, description: 'Create data model', files: ['src/models/user.ts'], estimatedEffort: 'small' as const },
  { index: 2, description: 'Add API endpoint', files: ['src/routes/users.ts'], estimatedEffort: 'medium' as const },
  { index: 3, description: 'Write tests', estimatedEffort: 'medium' as const },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PlanManager', () => {
  let tmpDir: string;
  let manager: PlanManager;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    manager = new PlanManager(tmpDir);
  });

  afterEach(() => {
    removeTmpDir(tmpDir);
  });

  // ── create ──────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('creates a plan with draft status', () => {
      const plan = manager.create('Add user management', SAMPLE_STEPS);

      expect(plan.id).toBeTruthy();
      expect(plan.title).toBe('Add user management');
      expect(plan.status).toBe('draft');
      expect(plan.steps).toHaveLength(3);
      expect(plan.createdAt).toBeGreaterThan(0);
      expect(plan.approvedAt).toBeUndefined();
      expect(plan.completedAt).toBeUndefined();
    });

    it('sets all steps to pending status', () => {
      const plan = manager.create('Feature', SAMPLE_STEPS);
      for (const step of plan.steps) {
        expect(step.status).toBe('pending');
      }
    });

    it('preserves step metadata (files, effort)', () => {
      const plan = manager.create('Feature', SAMPLE_STEPS);
      expect(plan.steps[0].files).toEqual(['src/models/user.ts']);
      expect(plan.steps[0].estimatedEffort).toBe('small');
      expect(plan.steps[1].estimatedEffort).toBe('medium');
      expect(plan.steps[2].files).toBeUndefined();
    });

    it('returns plan from list() after creation', () => {
      manager.create('Plan A', SAMPLE_STEPS);
      manager.create('Plan B', SAMPLE_STEPS);
      const plans = manager.list();
      expect(plans).toHaveLength(2);
    });
  });

  // ── approve ──────────────────────────────────────────────────────────────

  describe('approve()', () => {
    it('transitions draft plan to in_progress', () => {
      const plan = manager.create('Plan', SAMPLE_STEPS);
      const approved = manager.approve(plan.id);

      expect(approved.status).toBe('in_progress');
      expect(approved.approvedAt).toBeDefined();
      expect(approved.approvedAt).toBeGreaterThan(0);
    });

    it('throws when plan is not in draft status', () => {
      const plan = manager.create('Plan', SAMPLE_STEPS);
      manager.approve(plan.id);

      expect(() => manager.approve(plan.id)).toThrow(/not in draft status/);
    });

    it('throws for unknown plan ID', () => {
      expect(() => manager.approve('nonexistent-id')).toThrow(/not found/);
    });
  });

  // ── reject ───────────────────────────────────────────────────────────────

  describe('reject()', () => {
    it('transitions draft plan to rejected', () => {
      const plan = manager.create('Plan', SAMPLE_STEPS);
      const rejected = manager.reject(plan.id, 'Not scoped correctly');

      expect(rejected.status).toBe('rejected');
      expect(rejected.rejectionReason).toBe('Not scoped correctly');
    });

    it('works without a reason', () => {
      const plan = manager.create('Plan', SAMPLE_STEPS);
      const rejected = manager.reject(plan.id);

      expect(rejected.status).toBe('rejected');
      expect(rejected.rejectionReason).toBeUndefined();
    });

    it('throws when plan is not in draft status', () => {
      const plan = manager.create('Plan', SAMPLE_STEPS);
      manager.approve(plan.id);

      expect(() => manager.reject(plan.id)).toThrow(/not in draft status/);
    });
  });

  // ── updateStep ───────────────────────────────────────────────────────────

  describe('updateStep()', () => {
    it('updates a specific step status', () => {
      const plan = manager.create('Plan', SAMPLE_STEPS);
      manager.approve(plan.id);

      const updated = manager.updateStep(plan.id, 1, 'completed');
      const step = updated.steps.find((s) => s.index === 1);

      expect(step?.status).toBe('completed');
      // other steps remain pending
      expect(updated.steps.find((s) => s.index === 2)?.status).toBe('pending');
    });

    it('marks plan as completed when all steps are done', () => {
      const plan = manager.create('Plan', SAMPLE_STEPS);
      manager.approve(plan.id);

      manager.updateStep(plan.id, 1, 'completed');
      manager.updateStep(plan.id, 2, 'skipped');
      const final = manager.updateStep(plan.id, 3, 'completed');

      expect(final.status).toBe('completed');
      expect(final.completedAt).toBeDefined();
    });

    it('does not mark as completed when steps remain pending', () => {
      const plan = manager.create('Plan', SAMPLE_STEPS);
      manager.approve(plan.id);

      const after = manager.updateStep(plan.id, 1, 'completed');
      expect(after.status).toBe('in_progress');
    });

    it('throws for unknown step index', () => {
      const plan = manager.create('Plan', SAMPLE_STEPS);
      expect(() => manager.updateStep(plan.id, 99, 'completed')).toThrow(/Step 99 not found/);
    });
  });

  // ── get / getActive ───────────────────────────────────────────────────────

  describe('get()', () => {
    it('returns a plan by ID', () => {
      const plan = manager.create('Plan', SAMPLE_STEPS);
      const found = manager.get(plan.id);
      expect(found?.id).toBe(plan.id);
    });

    it('returns undefined for unknown ID', () => {
      expect(manager.get('no-such-id')).toBeUndefined();
    });
  });

  describe('getActive()', () => {
    it('returns undefined when no plan is in_progress', () => {
      manager.create('Draft plan', SAMPLE_STEPS);
      expect(manager.getActive()).toBeUndefined();
    });

    it('returns the in_progress plan', () => {
      const plan = manager.create('Plan', SAMPLE_STEPS);
      manager.approve(plan.id);

      const active = manager.getActive();
      expect(active?.id).toBe(plan.id);
      expect(active?.status).toBe('in_progress');
    });

    it('returns undefined after plan is completed', () => {
      const plan = manager.create('Plan', [{ index: 1, description: 'Only step' }]);
      manager.approve(plan.id);
      manager.updateStep(plan.id, 1, 'completed');

      expect(manager.getActive()).toBeUndefined();
    });
  });

  // ── list ─────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('returns all plans and orders newest first when timestamps differ', () => {
      const a = manager.create('First', SAMPLE_STEPS);

      // Force b's createdAt to be strictly after a by mutating via save()
      const b = manager.create('Second', SAMPLE_STEPS);
      const bWithLaterTs = { ...b, createdAt: a.createdAt + 100 };
      manager.save(bWithLaterTs);
      // Reload so in-memory map reflects the change
      const freshManager = new PlanManager(tmpDir);

      const list = freshManager.list();
      expect(list).toHaveLength(2);

      // b should sort before a because it has a later createdAt
      expect(list[0].id).toBe(b.id);
      expect(list[1].id).toBe(a.id);
    });

    it('returns empty array when no plans exist', () => {
      expect(manager.list()).toEqual([]);
    });
  });

  // ── save / load (disk persistence) ───────────────────────────────────────

  describe('save() and load()', () => {
    it('persists plan to disk as JSON', () => {
      const plan = manager.create('Persisted plan', SAMPLE_STEPS);
      const filePath = join(tmpDir, '.profclaw', 'plans', `${plan.id}.json`);

      expect(existsSync(filePath)).toBe(true);

      const raw = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Plan;
      expect(parsed.id).toBe(plan.id);
      expect(parsed.title).toBe('Persisted plan');
    });

    it('load() returns undefined for missing plan', () => {
      expect(manager.load('does-not-exist')).toBeUndefined();
    });

    it('load() deserialises plan correctly', () => {
      const plan = manager.create('Round-trip', SAMPLE_STEPS);
      const loaded = manager.load(plan.id);

      expect(loaded?.id).toBe(plan.id);
      expect(loaded?.title).toBe('Round-trip');
      expect(loaded?.steps).toHaveLength(3);
    });

    it('survives a fresh manager instantiation (cold load from disk)', () => {
      const original = manager.create('Survive reload', SAMPLE_STEPS);
      manager.approve(original.id);

      // Instantiate a brand-new manager pointing at the same tmpDir
      const fresh = new PlanManager(tmpDir);
      const found = fresh.get(original.id);

      expect(found?.status).toBe('in_progress');
      expect(found?.title).toBe('Survive reload');
    });
  });
});
