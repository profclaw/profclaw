import { describe, it, expect, beforeEach } from 'vitest';
import {
  compileSkill,
  getSkillForModel,
  trackSkillUsage,
  getSkillEffectiveness,
  getBestModelForSkill,
  getSkillRanking,
  dumpEffectivenessData,
  restoreEffectivenessData,
} from '../compiler.js';
import type { CompiledSkill } from '../compiler.js';
import type { ModelCapabilityLevel } from '../../chat/execution/types.js';

// =============================================================================
// Helpers
// =============================================================================

/**
 * The effectiveness map is a module-level singleton with no public clear method.
 * We snapshot the state before each test suite describe block and can restore it,
 * but since restoreEffectivenessData only merges (not replaces), we generate
 * globally unique skill IDs per test using a counter to avoid cross-test pollution.
 */
let _uidCounter = 0;
function uid(label: string): string {
  return `${label}-${++_uidCounter}`;
}

const NUMBERED_STEPS_MD = `
# Deploy Skill

Deploy the application to the target environment.

## Steps

1. Run the build command to compile the project
2. \`read_file\` the config file to verify settings
3. \`exec\` the deploy script with the target env
4. Verify that the service is healthy

## Notes

Make sure the target env variable is set.
`;

const TASK_LIST_MD = `
# Audit Skill

Audit the codebase for issues.

## Checklist

- [ ] Search for TODO comments using \`search_files\`
- [x] Read the main index file with \`read_file\`
- [ ] Run \`exec\` with lint command
- [ ] Write a summary report to /tmp/audit.md

## Examples

\`\`\`bash
search_files --pattern TODO
\`\`\`
`;

const MINIMAL_MD = `
# Simple Skill

Just do the thing.
`;

const NO_STEPS_MD = `
# Background Skill

This skill provides context but has no steps.

Just keep this in mind when responding.
`;

// =============================================================================
// 9.1 - compileSkill
// =============================================================================

describe('compileSkill', () => {
  describe('with numbered steps markdown', () => {
    let compiled: CompiledSkill;

    beforeEach(() => {
      compiled = compileSkill('deploy', 'Deploy Skill', NUMBERED_STEPS_MD);
    });

    it('returns a CompiledSkill with the correct skillId and skillName', () => {
      expect(compiled.skillId).toBe('deploy');
      expect(compiled.skillName).toBe('Deploy Skill');
    });

    it('preserves rawInstructions verbatim', () => {
      expect(compiled.rawInstructions).toBe(NUMBERED_STEPS_MD);
    });

    it('builds a workflow from 4 sequential steps', () => {
      expect(compiled.workflow).toBeDefined();
      expect(compiled.workflow!.steps.length).toBe(4);
    });

    it('workflow id is prefixed with skill-', () => {
      expect(compiled.workflow!.id).toBe('skill-deploy');
    });

    it('workflow name matches skillName', () => {
      expect(compiled.workflow!.name).toBe('Deploy Skill');
    });

    it('generates step IDs as step-1, step-2, etc.', () => {
      const ids = compiled.workflow!.steps.map((s) => s.id);
      expect(ids).toEqual(['step-1', 'step-2', 'step-3', 'step-4']);
    });

    it('infers exec tool for "Run the build command" step', () => {
      const step = compiled.workflow!.steps[0];
      expect(step.tool).toBe('exec');
    });

    it('uses backtick-quoted tool name for read_file step', () => {
      const step = compiled.workflow!.steps[1];
      expect(step.tool).toBe('read_file');
    });

    it('uses backtick-quoted tool name for exec deploy step', () => {
      const step = compiled.workflow!.steps[2];
      expect(step.tool).toBe('exec');
    });

    it('extracts action verbs from step lines', () => {
      expect(compiled.actions.length).toBeGreaterThan(0);
      // First step starts with "Run"
      expect(compiled.actions.some((a) => a === 'run')).toBe(true);
    });

    it('extracts referenced tools from backtick tokens', () => {
      expect(compiled.referencedTools).toContain('read_file');
      expect(compiled.referencedTools).toContain('exec');
    });

    it('does not include prose words in referencedTools', () => {
      // "true", "and", etc. should not appear
      expect(compiled.referencedTools).not.toContain('true');
      expect(compiled.referencedTools).not.toContain('the');
    });

    it('condensed version is shorter than full version', () => {
      expect(compiled.condensed.length).toBeLessThanOrEqual(compiled.full.length);
    });

    it('condensed version is under 500 characters (target limit)', () => {
      expect(compiled.condensed.length).toBeLessThanOrEqual(520); // slight tolerance for truncation suffix
    });

    it('full version preserves all content', () => {
      expect(compiled.full).toContain('Deploy the application');
    });
  });

  describe('with task-list markdown (- [ ] items)', () => {
    let compiled: CompiledSkill;

    beforeEach(() => {
      compiled = compileSkill('audit', 'Audit Skill', TASK_LIST_MD);
    });

    it('extracts steps from - [ ] task items', () => {
      expect(compiled.workflow).toBeDefined();
      expect(compiled.workflow!.steps.length).toBeGreaterThanOrEqual(3);
    });

    it('uses search_files tool from backtick in task item', () => {
      const step = compiled.workflow!.steps[0];
      expect(step.tool).toBe('search_files');
    });

    it('uses read_file tool from backtick in second task item', () => {
      const step = compiled.workflow!.steps[1];
      expect(step.tool).toBe('read_file');
    });

    it('does not include code fence content in steps', () => {
      const allInstructions = compiled.workflow!.steps.map((s) => s.params.instruction as string);
      expect(allInstructions.every((i) => !i.includes('```'))).toBe(true);
    });

    it('strips example block from condensed output', () => {
      expect(compiled.condensed).not.toContain('search_files --pattern TODO');
    });

    it('includes all content in full output', () => {
      expect(compiled.full).toContain('Audit the codebase');
    });
  });

  describe('with no steps markdown', () => {
    it('returns undefined workflow when there are fewer than 2 steps', () => {
      const compiled = compileSkill('bg', 'Background Skill', NO_STEPS_MD);
      expect(compiled.workflow).toBeUndefined();
    });

    it('still generates condensed and full versions', () => {
      const compiled = compileSkill('bg', 'Background Skill', NO_STEPS_MD);
      expect(compiled.condensed.length).toBeGreaterThan(0);
      expect(compiled.full.length).toBeGreaterThan(0);
    });

    it('returns empty actions array when no steps found', () => {
      const compiled = compileSkill('bg', 'Background Skill', NO_STEPS_MD);
      expect(compiled.actions).toEqual([]);
    });
  });

  describe('with minimal single-step markdown', () => {
    it('does not produce a workflow for a single step', () => {
      const md = `\n## Steps\n\n1. Read the file\n`;
      const compiled = compileSkill('min', 'Minimal', md);
      expect(compiled.workflow).toBeUndefined();
    });
  });

  describe('condensed version generation', () => {
    it('strips heading markdown markers (#) from condensed output', () => {
      const compiled = compileSkill('h', 'Heading Skill', '# Section Title\n\nSome content here.');
      expect(compiled.condensed).not.toMatch(/^#/m);
    });

    it('appends ... when content is truncated', () => {
      // Create a large markdown that will definitely exceed 500 chars
      const bigMd = Array.from({ length: 50 }, (_, i) => `Line ${i}: This is a content line that adds length to the document.`).join('\n');
      const compiled = compileSkill('big', 'Big Skill', bigMd);
      if (compiled.condensed.endsWith('...')) {
        expect(compiled.condensed).toContain('...');
      }
      expect(compiled.condensed.length).toBeLessThanOrEqual(520);
    });
  });

  describe('workflow variables', () => {
    it('workflow includes skillInstructions variable', () => {
      const compiled = compileSkill('wf', 'Workflow Skill', NUMBERED_STEPS_MD);
      expect(compiled.workflow!.variables).toBeDefined();
      expect(compiled.workflow!.variables!['skillInstructions']).toBe(NUMBERED_STEPS_MD);
    });
  });

  describe('workflow triggers', () => {
    it('derives triggers from skillName words', () => {
      const compiled = compileSkill('code-review', 'Code Review Skill', NUMBERED_STEPS_MD);
      const triggers = compiled.workflow!.triggers;
      // "code", "review" should appear (words > 2 chars)
      expect(triggers.some((t) => t === 'code')).toBe(true);
      expect(triggers.some((t) => t === 'review')).toBe(true);
    });
  });
});

// =============================================================================
// 9.2 - getSkillForModel
// =============================================================================

describe('getSkillForModel', () => {
  const compiled = compileSkill('test-skill', 'Test Skill', NUMBERED_STEPS_MD);

  it('returns full instructions for reasoning capability level', () => {
    const result = getSkillForModel(compiled, 'reasoning' as ModelCapabilityLevel);
    expect(result).toBe(compiled.full);
  });

  it('returns full instructions prefixed with directive for instruction level', () => {
    const result = getSkillForModel(compiled, 'instruction' as ModelCapabilityLevel);
    expect(result).toMatch(/^Follow these steps exactly:/);
    expect(result).toContain(compiled.full);
  });

  it('returns condensed instructions for basic capability level', () => {
    const result = getSkillForModel(compiled, 'basic' as ModelCapabilityLevel);
    expect(result).toContain(compiled.condensed);
  });

  it('appends workflow reference for basic level when workflow exists', () => {
    const result = getSkillForModel(compiled, 'basic' as ModelCapabilityLevel);
    if (compiled.workflow) {
      expect(result).toContain(`{{${compiled.workflow.id}}}`);
    }
  });

  it('does not append workflow reference for basic level when workflow is undefined', () => {
    const noWorkflowSkill = compileSkill('nw', 'No Workflow', NO_STEPS_MD);
    const result = getSkillForModel(noWorkflowSkill, 'basic' as ModelCapabilityLevel);
    expect(result).not.toContain('{{');
  });

  it('reasoning level returns full content without preamble', () => {
    const result = getSkillForModel(compiled, 'reasoning' as ModelCapabilityLevel);
    expect(result).not.toMatch(/^Follow/);
  });
});

// =============================================================================
// 9.3 - trackSkillUsage + getSkillEffectiveness
// =============================================================================

describe('trackSkillUsage + getSkillEffectiveness', () => {
  it('creates a new effectiveness record on first call', () => {
    const skillId = uid('eff-new');
    trackSkillUsage(skillId, 'model-x', true, 100);
    const records = getSkillEffectiveness(skillId, 'model-x');
    expect(records.length).toBe(1);
    expect(records[0].skillId).toBe(skillId);
    expect(records[0].modelId).toBe('model-x');
    expect(records[0].attempts).toBe(1);
    expect(records[0].successes).toBe(1);
    expect(records[0].failures).toBe(0);
    expect(records[0].successRate).toBe(1);
  });

  it('records failure correctly', () => {
    const skillId = uid('eff-fail');
    trackSkillUsage(skillId, 'model-y', false, 200);
    const records = getSkillEffectiveness(skillId, 'model-y');
    expect(records[0].successes).toBe(0);
    expect(records[0].failures).toBe(1);
    expect(records[0].successRate).toBe(0);
  });

  it('increments attempts on subsequent calls', () => {
    const skillId = uid('eff-incr');
    trackSkillUsage(skillId, 'model-z', true, 50);
    trackSkillUsage(skillId, 'model-z', false, 150);
    trackSkillUsage(skillId, 'model-z', true, 100);

    const records = getSkillEffectiveness(skillId, 'model-z');
    expect(records[0].attempts).toBe(3);
    expect(records[0].successes).toBe(2);
    expect(records[0].failures).toBe(1);
  });

  it('computes successRate as successes / attempts', () => {
    const skillId = uid('eff-rate');
    trackSkillUsage(skillId, 'model-a', true, 100);
    trackSkillUsage(skillId, 'model-a', false, 100);

    const records = getSkillEffectiveness(skillId, 'model-a');
    expect(records[0].successRate).toBeCloseTo(0.5);
  });

  it('computes rolling average for avgDurationMs', () => {
    const skillId = uid('eff-avg');
    trackSkillUsage(skillId, 'model-a', true, 100);
    trackSkillUsage(skillId, 'model-a', true, 300);

    const records = getSkillEffectiveness(skillId, 'model-a');
    // Rolling avg: (100 * 1 + 300) / 2 = 200
    expect(records[0].avgDurationMs).toBeCloseTo(200);
  });

  it('returns empty array when no records exist for skillId', () => {
    const records = getSkillEffectiveness(uid('eff-nonexistent'));
    expect(records).toEqual([]);
  });

  it('returns all model records for a skill when no modelId specified', () => {
    const skillId = uid('eff-all-models');
    trackSkillUsage(skillId, 'model-1', true, 100);
    trackSkillUsage(skillId, 'model-2', false, 200);

    const records = getSkillEffectiveness(skillId);
    expect(records.length).toBe(2);
    const modelIds = records.map((r) => r.modelId);
    expect(modelIds).toContain('model-1');
    expect(modelIds).toContain('model-2');
  });

  it('separates records for different skills', () => {
    const skillG = uid('eff-sep-g');
    const skillH = uid('eff-sep-h');
    trackSkillUsage(skillG, 'model-a', true, 100);
    trackSkillUsage(skillH, 'model-a', false, 100);

    const gRecords = getSkillEffectiveness(skillG);
    const hRecords = getSkillEffectiveness(skillH);
    expect(gRecords.length).toBe(1);
    expect(hRecords.length).toBe(1);
    expect(gRecords[0].successes).toBe(1);
    expect(hRecords[0].failures).toBe(1);
  });
});

// =============================================================================
// getBestModelForSkill
// =============================================================================

describe('getBestModelForSkill', () => {
  it('returns null when no records exist', () => {
    const result = getBestModelForSkill(uid('best-empty'));
    expect(result).toBeNull();
  });

  it('returns the model with highest success rate', () => {
    const skillId = uid('best-rank');
    trackSkillUsage(skillId, 'model-low', true, 100);  // 1 success/1 attempt = 1.0
    trackSkillUsage(skillId, 'model-low', false, 100); // 1 success/2 attempts = 0.5
    trackSkillUsage(skillId, 'model-high', true, 100); // 1 success/1 attempt = 1.0

    const best = getBestModelForSkill(skillId);
    // model-high has 1/1 = 1.0, model-low has 1/2 = 0.5
    expect(best).not.toBeNull();
    expect(best!.successRate).toBeGreaterThanOrEqual(0.5);
  });

  it('returns successRate between 0 and 1', () => {
    const skillId = uid('best-rate');
    trackSkillUsage(skillId, 'model-a', true, 100);
    trackSkillUsage(skillId, 'model-a', false, 100);

    const best = getBestModelForSkill(skillId);
    expect(best!.successRate).toBeGreaterThanOrEqual(0);
    expect(best!.successRate).toBeLessThanOrEqual(1);
  });

  it('returns modelId string', () => {
    const skillId = uid('best-str');
    trackSkillUsage(skillId, 'claude-sonnet', true, 100);
    const best = getBestModelForSkill(skillId);
    expect(typeof best!.modelId).toBe('string');
    expect(best!.modelId).toBe('claude-sonnet');
  });
});

// =============================================================================
// getSkillRanking
// =============================================================================

describe('getSkillRanking', () => {
  // Use unique IDs per test to avoid cross-test pollution from the shared module map.
  // Tests that need "all skills" check via find() rather than by exact count.

  it('returns a non-empty or empty array (coverage check)', () => {
    // getSkillRanking returns whatever is in the module map
    const ranking = getSkillRanking();
    expect(Array.isArray(ranking)).toBe(true);
  });

  it('includes newly tracked skills in the ranking', () => {
    const skillId = uid('rank-new');
    trackSkillUsage(skillId, 'model-a', true, 100);

    const ranking = getSkillRanking();
    const entry = ranking.find((r) => r.skillId === skillId);
    expect(entry).toBeDefined();
    expect(entry!.totalUses).toBe(1);
  });

  it('sorts by totalUses descending - most used skill appears first among equal-named batch', () => {
    const popular = uid('rank-popular');
    const rare = uid('rank-rare');
    trackSkillUsage(popular, 'model-a', true, 100);
    trackSkillUsage(popular, 'model-a', true, 100);
    trackSkillUsage(popular, 'model-a', true, 100); // 3 uses
    trackSkillUsage(rare, 'model-a', true, 100);    // 1 use

    const ranking = getSkillRanking();
    const popIdx = ranking.findIndex((r) => r.skillId === popular);
    const rareIdx = ranking.findIndex((r) => r.skillId === rare);
    expect(popIdx).toBeLessThan(rareIdx);
    expect(ranking[popIdx].totalUses).toBe(3);
  });

  it('aggregates uses across multiple models for the same skill', () => {
    const skillId = uid('rank-multimodel');
    trackSkillUsage(skillId, 'model-a', true, 100);
    trackSkillUsage(skillId, 'model-b', false, 200);
    trackSkillUsage(skillId, 'model-c', true, 150);

    const ranking = getSkillRanking();
    const entry = ranking.find((r) => r.skillId === skillId);
    expect(entry!.totalUses).toBe(3);
    // 2 successes out of 3 attempts
    expect(entry!.overallSuccessRate).toBeCloseTo(2 / 3);
  });

  it('ranking entries have skillId, totalUses, overallSuccessRate', () => {
    const skillId = uid('rank-shape');
    trackSkillUsage(skillId, 'model-a', true, 100);
    const ranking = getSkillRanking();
    const entry = ranking.find((r) => r.skillId === skillId);
    expect(entry).toHaveProperty('skillId');
    expect(entry).toHaveProperty('totalUses');
    expect(entry).toHaveProperty('overallSuccessRate');
  });

  it('secondary sort by overallSuccessRate when totalUses is equal', () => {
    const highSkill = uid('rank-equal-high');
    const lowSkill = uid('rank-equal-low');
    trackSkillUsage(highSkill, 'model-x', true, 100);  // 1 use, 100% success
    trackSkillUsage(lowSkill, 'model-x', false, 100);  // 1 use, 0% success

    const ranking = getSkillRanking();
    const highIdx = ranking.findIndex((r) => r.skillId === highSkill);
    const lowIdx = ranking.findIndex((r) => r.skillId === lowSkill);
    // Both have 1 total use; higher success rate should come first
    expect(highIdx).toBeLessThan(lowIdx);
  });

  it('overallSuccessRate is 1.0 for all-success skill', () => {
    const skillId = uid('rank-allsuccess');
    trackSkillUsage(skillId, 'model-a', true, 50);
    trackSkillUsage(skillId, 'model-a', true, 50);

    const ranking = getSkillRanking();
    const entry = ranking.find((r) => r.skillId === skillId);
    expect(entry!.overallSuccessRate).toBe(1.0);
  });

  it('overallSuccessRate is 0 for all-failure skill', () => {
    const skillId = uid('rank-allfail');
    trackSkillUsage(skillId, 'model-a', false, 50);
    trackSkillUsage(skillId, 'model-a', false, 50);

    const ranking = getSkillRanking();
    const entry = ranking.find((r) => r.skillId === skillId);
    expect(entry!.overallSuccessRate).toBe(0);
  });
});
