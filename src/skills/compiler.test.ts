/**
 * Tests for src/skills/compiler.ts
 *
 * Covers:
 *   9.1 - Skill-to-Workflow Compiler  (compileSkill and helpers)
 *   9.2 - Model-Adaptive Skill Injection (getSkillForModel)
 *   9.3 - Skill Effectiveness Tracking  (trackSkillUsage, getSkillEffectiveness,
 *                                         getBestModelForSkill, getSkillRanking,
 *                                         dump/restore)
 */

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
} from './compiler.js';
import type { CompiledSkill } from './compiler.js';

// =============================================================================
// Isolation helpers
// =============================================================================

/**
 * The effectiveness map is module-level state with no public clear() export.
 * We generate unique skill IDs per test so results never overlap with other
 * tests even as the map grows across the suite.
 */
let _seq = 0;
function uid(label = 'skill'): string {
  return `${label}-${++_seq}`;
}

// =============================================================================
// Shared markdown fixtures
// =============================================================================

const NUMBERED_STEPS_MD = `
# Deploy Skill

Deploy the application to the target environment.

## Steps

1. Run the build command to compile the project
2. \`read_file\` the config file to verify settings
3. \`exec\` the deploy script with the target env
4. Verify that the service is healthy after deployment

## Notes

Make sure the TARGET_ENV variable is set before running.
`.trim();

const TASK_LIST_MD = `
# Audit Skill

Audit the codebase for issues.

## Checklist

- [ ] Search for TODO comments using \`search_files\`
- [x] Read the main entry file with \`read_file\`
- [ ] Run \`exec\` with the lint command
- [ ] Write a summary report to /tmp/audit.md

## Examples

\`\`\`bash
search_files --pattern TODO .
\`\`\`

See output above for details.
`.trim();

const NO_STEPS_MD = `
# Background Skill

This skill provides context but has no numbered steps.

Just keep these guidelines in mind when responding to the user.
`.trim();

const ONE_STEP_MD = `
## Steps

1. Read the configuration file
`.trim();

const MIXED_PROSE_BACKTICKS_MD = `
# Tool Refs

Use \`true\` to enable the flag and \`false\` to disable it.
Do not pass \`null\` or \`undefined\` as the value.
Run \`exec\` to execute, or call \`web_fetch\` for HTTP requests.
`.trim();

const LARGE_MD = Array.from(
  { length: 60 },
  (_, i) => `Content line ${i + 1}: This is a moderately long description line for testing truncation.`,
).join('\n');

// =============================================================================
// 9.1 - compileSkill: return shape
// =============================================================================

describe('compileSkill - return shape', () => {
  let compiled: CompiledSkill;

  beforeEach(() => {
    compiled = compileSkill('deploy', 'Deploy Skill', NUMBERED_STEPS_MD);
  });

  it('sets skillId from first argument', () => {
    expect(compiled.skillId).toBe('deploy');
  });

  it('sets skillName from second argument', () => {
    expect(compiled.skillName).toBe('Deploy Skill');
  });

  it('preserves rawInstructions exactly as passed', () => {
    expect(compiled.rawInstructions).toBe(NUMBERED_STEPS_MD);
  });

  it('returns an actions array', () => {
    expect(Array.isArray(compiled.actions)).toBe(true);
  });

  it('returns a referencedTools array', () => {
    expect(Array.isArray(compiled.referencedTools)).toBe(true);
  });

  it('returns a non-empty condensed string', () => {
    expect(typeof compiled.condensed).toBe('string');
    expect(compiled.condensed.length).toBeGreaterThan(0);
  });

  it('returns a non-empty full string', () => {
    expect(typeof compiled.full).toBe('string');
    expect(compiled.full.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// 9.1 - extractStepLines (via compileSkill): numbered steps
// =============================================================================

describe('compileSkill - step extraction: numbered steps', () => {
  let compiled: CompiledSkill;

  beforeEach(() => {
    compiled = compileSkill('deploy', 'Deploy Skill', NUMBERED_STEPS_MD);
  });

  it('extracts all 4 numbered steps into a workflow', () => {
    expect(compiled.workflow).toBeDefined();
    expect(compiled.workflow!.steps.length).toBe(4);
  });

  it('assigns sequential step IDs step-1 through step-4', () => {
    const ids = compiled.workflow!.steps.map((s) => s.id);
    expect(ids).toEqual(['step-1', 'step-2', 'step-3', 'step-4']);
  });

  it('step name is the clean instruction text (max 60 chars)', () => {
    for (const step of compiled.workflow!.steps) {
      expect(step.name.length).toBeLessThanOrEqual(60);
      expect(step.name).not.toMatch(/^\d+\.\s/);
    }
  });

  it('step params.instruction contains the clean step text', () => {
    const instruction = compiled.workflow!.steps[0].params.instruction as string;
    expect(typeof instruction).toBe('string');
    expect(instruction.length).toBeGreaterThan(0);
  });

  it('continueOnError is false for all steps', () => {
    for (const step of compiled.workflow!.steps) {
      expect(step.continueOnError).toBe(false);
    }
  });
});

// =============================================================================
// 9.1 - extractStepLines (via compileSkill): task-list items
// =============================================================================

describe('compileSkill - step extraction: task-list items', () => {
  let compiled: CompiledSkill;

  beforeEach(() => {
    compiled = compileSkill('audit', 'Audit Skill', TASK_LIST_MD);
  });

  it('extracts steps from - [ ] and - [x] task items', () => {
    expect(compiled.workflow).toBeDefined();
    expect(compiled.workflow!.steps.length).toBe(4);
  });

  it('does not include code fence lines as steps', () => {
    const instructions = compiled.workflow!.steps.map((s) => s.params.instruction as string);
    for (const inst of instructions) {
      expect(inst).not.toContain('```');
      expect(inst).not.toContain('search_files --pattern TODO .');
    }
  });

  it('step names do not start with - [ ] marker', () => {
    for (const step of compiled.workflow!.steps) {
      expect(step.name).not.toMatch(/^-\s+\[/);
    }
  });
});

// =============================================================================
// 9.1 - Tool inference from step text
// =============================================================================

describe('compileSkill - tool inference', () => {
  function stepToolFor(stepText: string): string {
    const md = `## Steps\n\n1. ${stepText}\n2. ${stepText}`;
    const compiled = compileSkill('t', 'T', md);
    return compiled.workflow!.steps[0].tool;
  }

  it('maps "run" keyword to exec', () => {
    expect(stepToolFor('Run the test suite')).toBe('exec');
  });

  it('maps "execute" keyword to exec', () => {
    expect(stepToolFor('Execute the migration script')).toBe('exec');
  });

  it('maps "bash" keyword to exec', () => {
    expect(stepToolFor('Use bash to clear the cache')).toBe('exec');
  });

  it('maps "write" keyword to write_file', () => {
    expect(stepToolFor('Write the output to disk')).toBe('write_file');
  });

  it('maps "create" keyword to write_file', () => {
    expect(stepToolFor('Create the output file')).toBe('write_file');
  });

  it('maps "generate" keyword to write_file', () => {
    expect(stepToolFor('Generate the report')).toBe('write_file');
  });

  it('maps "read" keyword to read_file', () => {
    expect(stepToolFor('Read the configuration')).toBe('read_file');
  });

  it('maps "open" keyword to read_file', () => {
    expect(stepToolFor('Open the source file')).toBe('read_file');
  });

  it('maps "search" keyword to search_files', () => {
    expect(stepToolFor('Search for the pattern in the repo')).toBe('search_files');
  });

  it('maps "find" keyword to search_files', () => {
    expect(stepToolFor('Find all TODO comments')).toBe('search_files');
  });

  it('maps "list" keyword to search_files', () => {
    expect(stepToolFor('List all available modules')).toBe('search_files');
  });

  it('maps "fetch" keyword to web_fetch', () => {
    expect(stepToolFor('Fetch the remote API response')).toBe('web_fetch');
  });

  it('maps "http" keyword to web_fetch', () => {
    expect(stepToolFor('Make an http request to the endpoint')).toBe('web_fetch');
  });

  it('maps "url" keyword to web_fetch', () => {
    expect(stepToolFor('Request the url for the data')).toBe('web_fetch');
  });

  it('maps "verify" keyword to exec', () => {
    expect(stepToolFor('Verify the service is running')).toBe('exec');
  });

  it('backtick tool name in step text overrides inferred tool', () => {
    const md = `## Steps\n\n1. Use \`web_fetch\` to get the data\n2. Use \`web_fetch\` to get the data`;
    const compiled = compileSkill('t', 'T', md);
    expect(compiled.workflow!.steps[0].tool).toBe('web_fetch');
  });
});

// =============================================================================
// 9.1 - extractToolRefs (via compileSkill.referencedTools)
// =============================================================================

describe('compileSkill - extractToolRefs', () => {
  it('extracts backtick-quoted tool names from markdown', () => {
    const compiled = compileSkill('deploy', 'Deploy Skill', NUMBERED_STEPS_MD);
    expect(compiled.referencedTools).toContain('read_file');
    expect(compiled.referencedTools).toContain('exec');
  });

  it('extracts tool refs from task-list markdown', () => {
    const compiled = compileSkill('audit', 'Audit Skill', TASK_LIST_MD);
    expect(compiled.referencedTools).toContain('search_files');
    expect(compiled.referencedTools).toContain('read_file');
  });

  it('filters out prose words: true, false, null, undefined', () => {
    const compiled = compileSkill('prose', 'Prose Skill', MIXED_PROSE_BACKTICKS_MD);
    expect(compiled.referencedTools).not.toContain('true');
    expect(compiled.referencedTools).not.toContain('false');
    expect(compiled.referencedTools).not.toContain('null');
    expect(compiled.referencedTools).not.toContain('undefined');
  });

  it('includes actual tool names from mixed markdown', () => {
    const compiled = compileSkill('prose', 'Prose Skill', MIXED_PROSE_BACKTICKS_MD);
    expect(compiled.referencedTools).toContain('exec');
    expect(compiled.referencedTools).toContain('web_fetch');
  });

  it('deduplicates repeated backtick references', () => {
    const md = `Use \`exec\` here. Also use \`exec\` there. And \`exec\` again.`;
    const compiled = compileSkill('dup', 'Dup Skill', md);
    const count = compiled.referencedTools.filter((t) => t === 'exec').length;
    expect(count).toBe(1);
  });

  it('returns empty array when no backtick tool names present', () => {
    const compiled = compileSkill('none', 'None Skill', NO_STEPS_MD);
    expect(compiled.referencedTools).toEqual([]);
  });
});

// =============================================================================
// 9.1 - extractActions (via compileSkill.actions)
// =============================================================================

describe('compileSkill - extractActions', () => {
  it('extracts action verbs from numbered step first words', () => {
    const compiled = compileSkill('deploy', 'Deploy Skill', NUMBERED_STEPS_MD);
    // "Run", "read_file", "exec", "Verify" -> first words after stripping markers
    expect(compiled.actions.some((a) => a === 'run')).toBe(true);
  });

  it('lowercases extracted action verbs', () => {
    const compiled = compileSkill('deploy', 'Deploy Skill', NUMBERED_STEPS_MD);
    for (const action of compiled.actions) {
      expect(action).toBe(action.toLowerCase());
    }
  });

  it('deduplicates action verbs', () => {
    const md = `## Steps\n\n1. Run the first thing\n2. Run the second thing\n3. Check everything`;
    const compiled = compileSkill('dup-actions', 'Dup Actions', md);
    const runCount = compiled.actions.filter((a) => a === 'run').length;
    expect(runCount).toBe(1);
  });

  it('returns empty array when markdown has no steps', () => {
    const compiled = compileSkill('bg', 'Background', NO_STEPS_MD);
    expect(compiled.actions).toEqual([]);
  });

  it('strips numbering before extracting first word', () => {
    const md = `## Steps\n\n1. Analyze the code\n2. Deploy the artifact`;
    const compiled = compileSkill('strip', 'Strip', md);
    expect(compiled.actions).toContain('analyze');
    expect(compiled.actions).toContain('deploy');
  });
});

// =============================================================================
// 9.1 - buildWorkflow (via compileSkill.workflow)
// =============================================================================

describe('compileSkill - buildWorkflow', () => {
  it('returns undefined workflow when fewer than 2 steps exist', () => {
    const compiled = compileSkill('one', 'One Step', ONE_STEP_MD);
    expect(compiled.workflow).toBeUndefined();
  });

  it('returns undefined workflow when markdown has no steps at all', () => {
    const compiled = compileSkill('none', 'No Steps', NO_STEPS_MD);
    expect(compiled.workflow).toBeUndefined();
  });

  it('workflow id is prefixed with "skill-" followed by skillId', () => {
    const compiled = compileSkill('code-review', 'Code Review', NUMBERED_STEPS_MD);
    expect(compiled.workflow!.id).toBe('skill-code-review');
  });

  it('workflow name matches skillName', () => {
    const compiled = compileSkill('deploy', 'Deploy Skill', NUMBERED_STEPS_MD);
    expect(compiled.workflow!.name).toBe('Deploy Skill');
  });

  it('workflow description mentions skillName', () => {
    const compiled = compileSkill('deploy', 'Deploy Skill', NUMBERED_STEPS_MD);
    expect(compiled.workflow!.description).toContain('Deploy Skill');
  });

  it('workflow variables contains skillInstructions equal to original markdown', () => {
    const compiled = compileSkill('deploy', 'Deploy Skill', NUMBERED_STEPS_MD);
    expect(compiled.workflow!.variables).toBeDefined();
    expect(compiled.workflow!.variables!['skillInstructions']).toBe(NUMBERED_STEPS_MD);
  });

  it('derives triggers from skill name words longer than 2 chars', () => {
    const compiled = compileSkill('code-review', 'Code Review Skill', NUMBERED_STEPS_MD);
    const triggers = compiled.workflow!.triggers;
    expect(triggers).toContain('code');
    expect(triggers).toContain('review');
    expect(triggers).toContain('skill');
  });

  it('single-letter or two-letter words are excluded from triggers', () => {
    const compiled = compileSkill('pr', 'PR Review', NUMBERED_STEPS_MD);
    const triggers = compiled.workflow!.triggers;
    // "PR" splits to "pr" which is 2 chars, excluded by > 2 filter
    expect(triggers).not.toContain('pr');
    expect(triggers).toContain('review');
  });

  it('workflow has a steps array with a length matching step count', () => {
    const compiled = compileSkill('audit', 'Audit Skill', TASK_LIST_MD);
    expect(Array.isArray(compiled.workflow!.steps)).toBe(true);
    expect(compiled.workflow!.steps.length).toBeGreaterThanOrEqual(2);
  });
});

// =============================================================================
// 9.1 - buildCondensed (via compileSkill.condensed)
// =============================================================================

describe('compileSkill - buildCondensed', () => {
  it('strips heading markdown markers from condensed output', () => {
    const compiled = compileSkill('h', 'H Skill', '# Title\n\nSome content.');
    expect(compiled.condensed).not.toMatch(/^#/m);
  });

  it('strips code block fences and their content', () => {
    const compiled = compileSkill('cb', 'Code Block', TASK_LIST_MD);
    expect(compiled.condensed).not.toContain('```');
    expect(compiled.condensed).not.toContain('search_files --pattern TODO .');
  });

  it('strips example sections (headings with "example")', () => {
    const md = `# Title\n\nUseful content.\n\n## Examples\n\nExample detail here.\n\n## More\n\nFinal text.`;
    const compiled = compileSkill('ex', 'Example', md);
    expect(compiled.condensed).not.toContain('Example detail here.');
    expect(compiled.condensed).toContain('Useful content.');
  });

  it('resumes non-example content after an example section ends', () => {
    const md = `# Title\n\nFirst section.\n\n## Examples\n\nSkip this.\n\n## More Content\n\nKeep this.`;
    const compiled = compileSkill('resume', 'Resume', md);
    expect(compiled.condensed).toContain('Keep this.');
  });

  it('condensed output is within 520 chars (500 limit + "..." suffix)', () => {
    const compiled = compileSkill('large', 'Large', LARGE_MD);
    expect(compiled.condensed.length).toBeLessThanOrEqual(520);
  });

  it('appends "..." when content is truncated at 500 char limit', () => {
    const compiled = compileSkill('large', 'Large', LARGE_MD);
    expect(compiled.condensed.endsWith('...')).toBe(true);
  });

  it('condensed output is shorter than or equal to full output length', () => {
    const compiled = compileSkill('deploy', 'Deploy Skill', NUMBERED_STEPS_MD);
    expect(compiled.condensed.length).toBeLessThanOrEqual(compiled.full.length);
  });

  it('skips blank lines in condensed output (no leading/trailing whitespace gaps)', () => {
    const compiled = compileSkill('deploy', 'Deploy Skill', NUMBERED_STEPS_MD);
    expect(compiled.condensed).not.toMatch(/\n\n/);
  });
});

// =============================================================================
// 9.1 - buildFull (via compileSkill.full)
// =============================================================================

describe('compileSkill - buildFull', () => {
  it('full output is trimmed markdown with all content preserved', () => {
    const compiled = compileSkill('deploy', 'Deploy Skill', NUMBERED_STEPS_MD);
    expect(compiled.full).toBe(NUMBERED_STEPS_MD.trim());
  });

  it('full output preserves code block contents', () => {
    const compiled = compileSkill('audit', 'Audit Skill', TASK_LIST_MD);
    expect(compiled.full).toContain('```');
    expect(compiled.full).toContain('search_files --pattern TODO .');
  });

  it('full output preserves example section content', () => {
    const compiled = compileSkill('audit', 'Audit Skill', TASK_LIST_MD);
    expect(compiled.full).toContain('See output above for details.');
  });
});

// =============================================================================
// 9.2 - getSkillForModel
// =============================================================================

describe('getSkillForModel', () => {
  let compiled: CompiledSkill;

  beforeEach(() => {
    compiled = compileSkill('test-skill', 'Test Skill', NUMBERED_STEPS_MD);
  });

  it('reasoning level returns exactly compiled.full', () => {
    const result = getSkillForModel(compiled, 'reasoning');
    expect(result).toBe(compiled.full);
  });

  it('reasoning level does not prepend any preamble', () => {
    const result = getSkillForModel(compiled, 'reasoning');
    expect(result).not.toMatch(/^Follow/i);
  });

  it('instruction level starts with "Follow these steps exactly:"', () => {
    const result = getSkillForModel(compiled, 'instruction');
    expect(result).toMatch(/^Follow these steps exactly:/);
  });

  it('instruction level contains compiled.full after the preamble', () => {
    const result = getSkillForModel(compiled, 'instruction');
    expect(result).toContain(compiled.full);
  });

  it('instruction level uses double newline between preamble and content', () => {
    const result = getSkillForModel(compiled, 'instruction');
    expect(result).toContain('Follow these steps exactly:\n\n');
  });

  it('basic level contains compiled.condensed', () => {
    const result = getSkillForModel(compiled, 'basic');
    expect(result).toContain(compiled.condensed);
  });

  it('basic level appends workflow reference when workflow exists', () => {
    const result = getSkillForModel(compiled, 'basic');
    // NUMBERED_STEPS_MD has 4 steps so workflow is defined
    expect(compiled.workflow).toBeDefined();
    expect(result).toContain(`{{${compiled.workflow!.id}}}`);
  });

  it('basic level does not append workflow reference when workflow is undefined', () => {
    const noWorkflow = compileSkill('bg', 'Background', NO_STEPS_MD);
    expect(noWorkflow.workflow).toBeUndefined();
    const result = getSkillForModel(noWorkflow, 'basic');
    expect(result).not.toContain('{{');
  });

  it('basic level workflow reference follows "Or use the workflow:" prefix', () => {
    const result = getSkillForModel(compiled, 'basic');
    expect(result).toContain('Or use the workflow:');
  });
});

// =============================================================================
// 9.3 - trackSkillUsage + getSkillEffectiveness
// =============================================================================

describe('trackSkillUsage - first call creates record', () => {
  it('creates a new record with attempts=1 on first success', () => {
    const skillId = uid('first-success');
    trackSkillUsage(skillId, 'model-a', true, 100);
    const records = getSkillEffectiveness(skillId, 'model-a');
    expect(records.length).toBe(1);
    expect(records[0].attempts).toBe(1);
    expect(records[0].successes).toBe(1);
    expect(records[0].failures).toBe(0);
    expect(records[0].successRate).toBe(1);
  });

  it('creates a new record with attempts=1 on first failure', () => {
    const skillId = uid('first-failure');
    trackSkillUsage(skillId, 'model-b', false, 200);
    const records = getSkillEffectiveness(skillId, 'model-b');
    expect(records.length).toBe(1);
    expect(records[0].attempts).toBe(1);
    expect(records[0].successes).toBe(0);
    expect(records[0].failures).toBe(1);
    expect(records[0].successRate).toBe(0);
  });

  it('sets avgDurationMs to durationMs on first call', () => {
    const skillId = uid('first-dur');
    trackSkillUsage(skillId, 'model-a', true, 350);
    const records = getSkillEffectiveness(skillId, 'model-a');
    expect(records[0].avgDurationMs).toBe(350);
  });

  it('sets lastUsed to a recent timestamp', () => {
    const before = Date.now();
    const skillId = uid('last-used');
    trackSkillUsage(skillId, 'model-a', true, 100);
    const after = Date.now();
    const records = getSkillEffectiveness(skillId, 'model-a');
    expect(records[0].lastUsed).toBeGreaterThanOrEqual(before);
    expect(records[0].lastUsed).toBeLessThanOrEqual(after);
  });

  it('stores correct skillId and modelId on the record', () => {
    const skillId = uid('ids');
    trackSkillUsage(skillId, 'claude-sonnet-4-6', true, 50);
    const records = getSkillEffectiveness(skillId, 'claude-sonnet-4-6');
    expect(records[0].skillId).toBe(skillId);
    expect(records[0].modelId).toBe('claude-sonnet-4-6');
  });
});

describe('trackSkillUsage - subsequent calls accumulate', () => {
  it('increments attempts on each call', () => {
    const skillId = uid('incr-attempts');
    trackSkillUsage(skillId, 'model-x', true, 100);
    trackSkillUsage(skillId, 'model-x', false, 200);
    trackSkillUsage(skillId, 'model-x', true, 150);
    const records = getSkillEffectiveness(skillId, 'model-x');
    expect(records[0].attempts).toBe(3);
  });

  it('accumulates successes and failures correctly', () => {
    const skillId = uid('incr-sf');
    trackSkillUsage(skillId, 'model-x', true, 100);
    trackSkillUsage(skillId, 'model-x', false, 200);
    trackSkillUsage(skillId, 'model-x', true, 150);
    const records = getSkillEffectiveness(skillId, 'model-x');
    expect(records[0].successes).toBe(2);
    expect(records[0].failures).toBe(1);
  });

  it('computes successRate as successes / attempts', () => {
    const skillId = uid('rate-calc');
    trackSkillUsage(skillId, 'model-a', true, 100);
    trackSkillUsage(skillId, 'model-a', false, 100);
    const records = getSkillEffectiveness(skillId, 'model-a');
    expect(records[0].successRate).toBeCloseTo(0.5);
  });

  it('computes rolling average for avgDurationMs', () => {
    const skillId = uid('avg-dur');
    trackSkillUsage(skillId, 'model-a', true, 100);
    // avg after 1st: 100
    trackSkillUsage(skillId, 'model-a', true, 300);
    // rolling avg: (100 * 1 + 300) / 2 = 200
    const records = getSkillEffectiveness(skillId, 'model-a');
    expect(records[0].avgDurationMs).toBeCloseTo(200);
  });

  it('rolling average after 3 calls is correct', () => {
    const skillId = uid('avg-3');
    trackSkillUsage(skillId, 'model-a', true, 100);
    trackSkillUsage(skillId, 'model-a', true, 200);
    // avg after 2: (100*1 + 200)/2 = 150
    trackSkillUsage(skillId, 'model-a', true, 300);
    // avg after 3: (150*2 + 300)/3 = 200
    const records = getSkillEffectiveness(skillId, 'model-a');
    expect(records[0].avgDurationMs).toBeCloseTo(200);
  });

  it('updates lastUsed on each subsequent call', () => {
    const skillId = uid('last-used-update');
    trackSkillUsage(skillId, 'model-a', true, 100);
    const firstLastUsed = getSkillEffectiveness(skillId, 'model-a')[0].lastUsed;
    trackSkillUsage(skillId, 'model-a', false, 200);
    const secondLastUsed = getSkillEffectiveness(skillId, 'model-a')[0].lastUsed;
    expect(secondLastUsed).toBeGreaterThanOrEqual(firstLastUsed);
  });
});

describe('getSkillEffectiveness - queries', () => {
  it('returns empty array for unknown skillId', () => {
    const records = getSkillEffectiveness(uid('unknown'));
    expect(records).toEqual([]);
  });

  it('returns empty array when model is specified but has no record', () => {
    const skillId = uid('no-model');
    trackSkillUsage(skillId, 'model-a', true, 100);
    const records = getSkillEffectiveness(skillId, 'model-b');
    expect(records).toEqual([]);
  });

  it('returns all model records when modelId is omitted', () => {
    const skillId = uid('all-models');
    trackSkillUsage(skillId, 'model-a', true, 100);
    trackSkillUsage(skillId, 'model-b', false, 200);
    trackSkillUsage(skillId, 'model-c', true, 150);
    const records = getSkillEffectiveness(skillId);
    expect(records.length).toBe(3);
    const modelIds = records.map((r) => r.modelId);
    expect(modelIds).toContain('model-a');
    expect(modelIds).toContain('model-b');
    expect(modelIds).toContain('model-c');
  });

  it('returns single-item array when modelId is specified and exists', () => {
    const skillId = uid('single');
    trackSkillUsage(skillId, 'model-a', true, 100);
    trackSkillUsage(skillId, 'model-b', false, 200);
    const records = getSkillEffectiveness(skillId, 'model-a');
    expect(records.length).toBe(1);
    expect(records[0].modelId).toBe('model-a');
  });

  it('does not leak records from a different skillId', () => {
    const skillA = uid('sep-a');
    const skillB = uid('sep-b');
    trackSkillUsage(skillA, 'model-x', true, 100);
    trackSkillUsage(skillB, 'model-x', false, 100);

    const aRecords = getSkillEffectiveness(skillA);
    const bRecords = getSkillEffectiveness(skillB);
    expect(aRecords.length).toBe(1);
    expect(bRecords.length).toBe(1);
    expect(aRecords[0].successes).toBe(1);
    expect(bRecords[0].failures).toBe(1);
  });
});

// =============================================================================
// 9.3 - getBestModelForSkill
// =============================================================================

describe('getBestModelForSkill', () => {
  it('returns null when skill has no records', () => {
    const result = getBestModelForSkill(uid('best-empty'));
    expect(result).toBeNull();
  });

  it('returns the model with the highest success rate', () => {
    const skillId = uid('best-winner');
    trackSkillUsage(skillId, 'model-low', true, 100);
    trackSkillUsage(skillId, 'model-low', false, 100);  // rate = 0.5
    trackSkillUsage(skillId, 'model-high', true, 100);  // rate = 1.0

    const best = getBestModelForSkill(skillId);
    expect(best).not.toBeNull();
    expect(best!.modelId).toBe('model-high');
    expect(best!.successRate).toBe(1.0);
  });

  it('returned successRate is between 0 and 1 inclusive', () => {
    const skillId = uid('best-bounds');
    trackSkillUsage(skillId, 'model-a', true, 100);
    trackSkillUsage(skillId, 'model-a', false, 100);
    const best = getBestModelForSkill(skillId);
    expect(best!.successRate).toBeGreaterThanOrEqual(0);
    expect(best!.successRate).toBeLessThanOrEqual(1);
  });

  it('returns object with modelId and successRate properties', () => {
    const skillId = uid('best-shape');
    trackSkillUsage(skillId, 'sonnet', true, 100);
    const best = getBestModelForSkill(skillId);
    expect(best).toHaveProperty('modelId');
    expect(best).toHaveProperty('successRate');
  });

  it('returns the single model when only one model has records', () => {
    const skillId = uid('best-single');
    trackSkillUsage(skillId, 'only-model', false, 100);
    const best = getBestModelForSkill(skillId);
    expect(best!.modelId).toBe('only-model');
  });
});

// =============================================================================
// 9.3 - getSkillRanking
// =============================================================================

describe('getSkillRanking', () => {
  it('returns an array', () => {
    const ranking = getSkillRanking();
    expect(Array.isArray(ranking)).toBe(true);
  });

  it('includes a newly tracked skill', () => {
    const skillId = uid('rank-new');
    trackSkillUsage(skillId, 'model-a', true, 100);
    const ranking = getSkillRanking();
    const entry = ranking.find((r) => r.skillId === skillId);
    expect(entry).toBeDefined();
    expect(entry!.totalUses).toBe(1);
  });

  it('ranking entries have skillId, totalUses, and overallSuccessRate', () => {
    const skillId = uid('rank-shape');
    trackSkillUsage(skillId, 'model-a', true, 100);
    const ranking = getSkillRanking();
    const entry = ranking.find((r) => r.skillId === skillId)!;
    expect(entry).toHaveProperty('skillId');
    expect(entry).toHaveProperty('totalUses');
    expect(entry).toHaveProperty('overallSuccessRate');
  });

  it('sorts higher-use skills before lower-use skills', () => {
    const popular = uid('rank-pop');
    const rare = uid('rank-rare');
    trackSkillUsage(popular, 'model-a', true, 100);
    trackSkillUsage(popular, 'model-a', true, 100);
    trackSkillUsage(popular, 'model-a', true, 100); // 3 uses
    trackSkillUsage(rare, 'model-a', true, 100);    // 1 use

    const ranking = getSkillRanking();
    const popIdx = ranking.findIndex((r) => r.skillId === popular);
    const rareIdx = ranking.findIndex((r) => r.skillId === rare);
    expect(popIdx).toBeLessThan(rareIdx);
  });

  it('secondary-sorts by overallSuccessRate when totalUses is equal', () => {
    const highSkill = uid('rank-equal-high');
    const lowSkill = uid('rank-equal-low');
    trackSkillUsage(highSkill, 'model-x', true, 100);  // 1 use, rate=1.0
    trackSkillUsage(lowSkill, 'model-x', false, 100);  // 1 use, rate=0.0

    const ranking = getSkillRanking();
    const highIdx = ranking.findIndex((r) => r.skillId === highSkill);
    const lowIdx = ranking.findIndex((r) => r.skillId === lowSkill);
    expect(highIdx).toBeLessThan(lowIdx);
  });

  it('aggregates totalUses across all models for the same skill', () => {
    const skillId = uid('rank-agg');
    trackSkillUsage(skillId, 'model-a', true, 100);
    trackSkillUsage(skillId, 'model-b', false, 200);
    trackSkillUsage(skillId, 'model-c', true, 150);

    const ranking = getSkillRanking();
    const entry = ranking.find((r) => r.skillId === skillId)!;
    expect(entry.totalUses).toBe(3);
  });

  it('computes overallSuccessRate correctly across models', () => {
    const skillId = uid('rank-rate');
    trackSkillUsage(skillId, 'model-a', true, 100);   // 1 success
    trackSkillUsage(skillId, 'model-b', false, 200);  // 1 failure
    trackSkillUsage(skillId, 'model-c', true, 150);   // 1 success

    const ranking = getSkillRanking();
    const entry = ranking.find((r) => r.skillId === skillId)!;
    expect(entry.overallSuccessRate).toBeCloseTo(2 / 3);
  });

  it('overallSuccessRate is 1.0 for an all-success skill', () => {
    const skillId = uid('rank-allsuccess');
    trackSkillUsage(skillId, 'model-a', true, 50);
    trackSkillUsage(skillId, 'model-a', true, 50);
    const ranking = getSkillRanking();
    const entry = ranking.find((r) => r.skillId === skillId)!;
    expect(entry.overallSuccessRate).toBe(1.0);
  });

  it('overallSuccessRate is 0 for an all-failure skill', () => {
    const skillId = uid('rank-allfail');
    trackSkillUsage(skillId, 'model-a', false, 50);
    trackSkillUsage(skillId, 'model-a', false, 50);
    const ranking = getSkillRanking();
    const entry = ranking.find((r) => r.skillId === skillId)!;
    expect(entry.overallSuccessRate).toBe(0);
  });
});

// =============================================================================
// 9.3 - dumpEffectivenessData / restoreEffectivenessData
// =============================================================================

describe('dumpEffectivenessData / restoreEffectivenessData', () => {
  it('dumpEffectivenessData returns a plain object', () => {
    const dump = dumpEffectivenessData();
    expect(typeof dump).toBe('object');
    expect(dump).not.toBeNull();
    expect(Array.isArray(dump)).toBe(false);
  });

  it('dump includes keys for tracked skill+model pairs', () => {
    const skillId = uid('dump-key');
    trackSkillUsage(skillId, 'model-z', true, 100);
    const dump = dumpEffectivenessData();
    const expectedKey = `${skillId}:model-z`;
    expect(dump).toHaveProperty(expectedKey);
  });

  it('dump values match the tracked effectiveness records', () => {
    const skillId = uid('dump-values');
    trackSkillUsage(skillId, 'model-z', true, 250);
    const dump = dumpEffectivenessData();
    const key = `${skillId}:model-z`;
    expect(dump[key].skillId).toBe(skillId);
    expect(dump[key].modelId).toBe('model-z');
    expect(dump[key].attempts).toBe(1);
    expect(dump[key].successes).toBe(1);
    expect(dump[key].avgDurationMs).toBe(250);
  });

  it('restoreEffectivenessData makes dumped records retrievable', () => {
    const skillId = uid('restore-round');
    trackSkillUsage(skillId, 'model-a', true, 400);
    const dump = dumpEffectivenessData();

    // Restore the dumped data into a "fresh" location using a new key
    const restoredSkillId = uid('restored');
    const restoredKey = `${restoredSkillId}:model-a`;
    const syntheticDump = {
      [restoredKey]: {
        ...dump[`${skillId}:model-a`],
        skillId: restoredSkillId,
      },
    };

    restoreEffectivenessData(syntheticDump);
    const records = getSkillEffectiveness(restoredSkillId, 'model-a');
    expect(records.length).toBe(1);
    expect(records[0].skillId).toBe(restoredSkillId);
    expect(records[0].avgDurationMs).toBe(400);
  });

  it('restoreEffectivenessData merges into existing map (does not clear it)', () => {
    const existing = uid('restore-existing');
    const restored = uid('restore-new');
    trackSkillUsage(existing, 'model-x', true, 100);

    restoreEffectivenessData({
      [`${restored}:model-y`]: {
        skillId: restored,
        modelId: 'model-y',
        attempts: 5,
        successes: 4,
        failures: 1,
        avgDurationMs: 120,
        successRate: 0.8,
        lastUsed: Date.now(),
      },
    });

    // Existing record should still be present
    const existingRecords = getSkillEffectiveness(existing, 'model-x');
    expect(existingRecords.length).toBe(1);

    // Restored record should also be present
    const restoredRecords = getSkillEffectiveness(restored, 'model-y');
    expect(restoredRecords.length).toBe(1);
    expect(restoredRecords[0].attempts).toBe(5);
    expect(restoredRecords[0].successRate).toBeCloseTo(0.8);
  });

  it('round-trip dump then restore preserves all fields', () => {
    const skillId = uid('roundtrip');
    trackSkillUsage(skillId, 'haiku', true, 80);
    trackSkillUsage(skillId, 'haiku', false, 120);

    const dump = dumpEffectivenessData();
    const key = `${skillId}:haiku`;
    const original = dump[key];

    // Restore under a new unique name to avoid collision
    const cloneId = uid('roundtrip-clone');
    restoreEffectivenessData({
      [`${cloneId}:haiku`]: { ...original, skillId: cloneId },
    });

    const cloneRecords = getSkillEffectiveness(cloneId, 'haiku');
    expect(cloneRecords[0].attempts).toBe(original.attempts);
    expect(cloneRecords[0].successes).toBe(original.successes);
    expect(cloneRecords[0].failures).toBe(original.failures);
    expect(cloneRecords[0].avgDurationMs).toBeCloseTo(original.avgDurationMs);
    expect(cloneRecords[0].successRate).toBeCloseTo(original.successRate);
  });
});
