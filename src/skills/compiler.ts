/**
 * Skill Intelligence Compiler - Phase 19 Category 9
 *
 * 9.1 - Skill-to-workflow compiler: parses SKILL.md into WorkflowDefinition
 * 9.2 - Model-adaptive injection: selects condensed vs full instructions by capability
 * 9.3 - Skill effectiveness tracking: in-memory usage/success counters
 */

import type { WorkflowDefinition, WorkflowStep } from '../chat/execution/workflows/types.js';
import type { ModelCapabilityLevel } from '../chat/execution/types.js';

// =============================================================================
// 9.1 - Skill-to-Workflow Compiler
// =============================================================================

export interface CompiledSkill {
  skillId: string;
  skillName: string;
  /** Original markdown instructions */
  rawInstructions: string;
  /** Compiled workflow (if skill has sequential steps) */
  workflow?: WorkflowDefinition;
  /** Condensed version for small models */
  condensed: string;
  /** Full version for large models */
  full: string;
  /** Key action verbs extracted */
  actions: string[];
  /** Tool names referenced in the skill */
  referencedTools: string[];
}

/** Lines that indicate a numbered step (1. text, Step 1: text) */
const NUMBERED_STEP_RE = /^(?:\d+\.\s+|Step\s+\d+[:.]\s*)/i;

/** Lines that are task-list items: - [ ] text */
const TASK_ITEM_RE = /^-\s+\[[ x]\]\s+/i;

/** Backtick-quoted tool or command names */
const BACKTICK_TOOL_RE = /`([a-z_][a-z0-9_-]*)`/gi;

/** Code fence opener */
const CODE_FENCE_RE = /^```/;

/** Heading line */
const HEADING_RE = /^#{1,6}\s/;

/** Example block markers (headings or lines containing "example") */
const EXAMPLE_HEADING_RE = /^#{1,6}\s.*example/i;

/**
 * Map a plain-text step description to a best-guess tool name
 */
function inferToolFromText(text: string): string {
  const lower = text.toLowerCase();

  if (/\b(run|execute|exec|bash|shell|command|cmd)\b/.test(lower)) return 'exec';
  if (/\b(write|create|generate|output|save|produce)\b/.test(lower)) return 'write_file';
  if (/\b(read|open|load|view|look at|check file|inspect file)\b/.test(lower)) return 'read_file';
  if (/\b(search|find|grep|locate|look for)\b/.test(lower)) return 'search_files';
  if (/\b(fetch|download|request|http|url|web)\b/.test(lower)) return 'web_fetch';
  if (/\b(list|enumerate|dir|ls)\b/.test(lower)) return 'search_files';
  if (/\b(check|verify|validate|test)\b/.test(lower)) return 'exec';

  return 'exec';
}

/**
 * Collect all backtick-quoted tool references from a block of text.
 * Common prose words are filtered out to avoid noise.
 */
function extractToolRefs(text: string): string[] {
  const PROSE_WORDS = new Set([
    'true', 'false', 'null', 'undefined', 'yes', 'no', 'ok',
    'and', 'or', 'not', 'the', 'a', 'an', 'of', 'in', 'to', 'for',
  ]);

  const seen = new Set<string>();
  const result: string[] = [];

  let match: RegExpExecArray | null;
  const re = new RegExp(BACKTICK_TOOL_RE.source, 'gi');

  while ((match = re.exec(text)) !== null) {
    const token = match[1].toLowerCase();
    if (!PROSE_WORDS.has(token) && !seen.has(token)) {
      seen.add(token);
      result.push(token);
    }
  }
  return result;
}

/**
 * Extract action verbs from a block of text (first word of each sentence / step).
 */
function extractActions(steps: string[]): string[] {
  const seen = new Set<string>();
  const actions: string[] = [];

  for (const step of steps) {
    // Strip leading numbering / task markers
    const clean = step
      .replace(NUMBERED_STEP_RE, '')
      .replace(TASK_ITEM_RE, '')
      .trim();

    const firstWord = clean.split(/\s+/)[0]?.replace(/[^a-zA-Z]/g, '').toLowerCase();
    if (firstWord && firstWord.length > 2 && !seen.has(firstWord)) {
      seen.add(firstWord);
      actions.push(firstWord);
    }
  }
  return actions;
}

/**
 * Split the instructions into step lines by looking for numbered lists,
 * task-list items, and "Step N:" patterns.
 */
function extractStepLines(instructions: string): string[] {
  const steps: string[] = [];
  const lines = instructions.split('\n');
  let inCodeBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Track code blocks - skip their contents for step extraction
    if (CODE_FENCE_RE.test(trimmed)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    if (NUMBERED_STEP_RE.test(trimmed) || TASK_ITEM_RE.test(trimmed)) {
      steps.push(trimmed);
    }
  }
  return steps;
}

/**
 * Build a WorkflowDefinition from a list of step lines.
 * Only created when there are 2+ sequential steps.
 */
function buildWorkflow(
  skillId: string,
  skillName: string,
  stepLines: string[],
  instructions: string,
): WorkflowDefinition | undefined {
  if (stepLines.length < 2) return undefined;

  const steps: WorkflowStep[] = stepLines.map((line, idx) => {
    const clean = line
      .replace(NUMBERED_STEP_RE, '')
      .replace(TASK_ITEM_RE, '')
      .trim();

    // Pull any backtick tool override from the line
    const toolMatch = /`([a-z_][a-z0-9_-]+)`/.exec(clean);
    const toolName = toolMatch ? toolMatch[1] : inferToolFromText(clean);

    return {
      id: `step-${idx + 1}`,
      name: clean.slice(0, 60),
      tool: toolName,
      params: { instruction: clean },
      continueOnError: false,
    };
  });

  // Derive triggers from skill name words + action verbs
  const triggers = skillName.toLowerCase().split(/[\s_-]+/).filter(t => t.length > 2);

  return {
    id: `skill-${skillId}`,
    name: skillName,
    description: `Auto-compiled workflow for skill: ${skillName}`,
    triggers,
    steps,
    variables: {
      skillInstructions: instructions,
    },
  };
}

/**
 * Strip example blocks and lengthy prose to produce a condensed prompt
 * suitable for basic/small models. Target: ~500 chars.
 */
function buildCondensed(instructions: string): string {
  const lines = instructions.split('\n');
  const kept: string[] = [];
  let inExample = false;
  let inCodeBlock = false;
  let charCount = 0;
  const LIMIT = 500;

  for (const line of lines) {
    const trimmed = line.trim();

    // Track code blocks
    if (CODE_FENCE_RE.test(trimmed)) {
      inCodeBlock = !inCodeBlock;
      // Skip code block fences and contents in condensed mode
      continue;
    }
    if (inCodeBlock) continue;

    // Detect example sections - skip them
    if (EXAMPLE_HEADING_RE.test(trimmed)) {
      inExample = true;
      continue;
    }
    // End example section on next non-empty heading
    if (inExample && HEADING_RE.test(trimmed)) {
      inExample = false;
    }
    if (inExample) continue;

    // Skip blank lines to save space
    if (trimmed === '') continue;

    // Strip heading markdown for condensed
    const content = trimmed.replace(/^#{1,6}\s+/, '');

    if (charCount + content.length + 1 > LIMIT) {
      if (kept.length > 0) {
        kept.push('...');
      }
      break;
    }

    kept.push(content);
    charCount += content.length + 1;
  }

  return kept.join(' ').trim();
}

/**
 * Strip everything except the body text (remove metadata headings, keep instructions).
 * Preserves full detail for large models.
 */
function buildFull(instructions: string): string {
  return instructions.trim();
}

/**
 * Compile a SKILL.md instructions string into a CompiledSkill.
 */
export function compileSkill(
  skillId: string,
  skillName: string,
  markdown: string,
): CompiledSkill {
  const stepLines = extractStepLines(markdown);
  const referencedTools = extractToolRefs(markdown);
  const actions = extractActions(stepLines);
  const workflow = buildWorkflow(skillId, skillName, stepLines, markdown);
  const condensed = buildCondensed(markdown);
  const full = buildFull(markdown);

  return {
    skillId,
    skillName,
    rawInstructions: markdown,
    workflow,
    condensed,
    full,
    actions,
    referencedTools,
  };
}

// =============================================================================
// 9.2 - Model-Adaptive Skill Injection
// =============================================================================

/**
 * Return the appropriate skill instructions for a given model capability level.
 *
 * - reasoning  -> full instructions, no preamble (model can self-direct)
 * - instruction -> full instructions with explicit directive
 * - basic      -> condensed instructions; optionally references compiled workflow
 */
export function getSkillForModel(
  compiled: CompiledSkill,
  capabilityLevel: ModelCapabilityLevel,
): string {
  switch (capabilityLevel) {
    case 'reasoning':
      return compiled.full;

    case 'instruction':
      return `Follow these steps exactly:\n\n${compiled.full}`;

    case 'basic': {
      let text = compiled.condensed;
      if (compiled.workflow) {
        text += ` Or use the workflow: {{${compiled.workflow.id}}}`;
      }
      return text;
    }
  }
}

// =============================================================================
// 9.3 - Skill Effectiveness Tracking
// =============================================================================

export interface SkillEffectiveness {
  skillId: string;
  modelId: string;
  attempts: number;
  successes: number;
  failures: number;
  avgDurationMs: number;
  /** Computed: successes / attempts */
  successRate: number;
  lastUsed: number;
}

/** In-memory tracking map keyed by "<skillId>:<modelId>" */
const effectivenessMap = new Map<string, SkillEffectiveness>();

function effectivenessKey(skillId: string, modelId: string): string {
  return `${skillId}:${modelId}`;
}

/**
 * Record the outcome of one skill execution.
 */
export function trackSkillUsage(
  skillId: string,
  modelId: string,
  success: boolean,
  durationMs: number,
): void {
  const key = effectivenessKey(skillId, modelId);
  const existing = effectivenessMap.get(key);

  if (existing) {
    const newAttempts = existing.attempts + 1;
    const newSuccesses = existing.successes + (success ? 1 : 0);
    const newFailures = existing.failures + (success ? 0 : 1);
    // Rolling average for duration
    const newAvg = (existing.avgDurationMs * existing.attempts + durationMs) / newAttempts;

    effectivenessMap.set(key, {
      ...existing,
      attempts: newAttempts,
      successes: newSuccesses,
      failures: newFailures,
      avgDurationMs: newAvg,
      successRate: newAttempts > 0 ? newSuccesses / newAttempts : 0,
      lastUsed: Date.now(),
    });
  } else {
    effectivenessMap.set(key, {
      skillId,
      modelId,
      attempts: 1,
      successes: success ? 1 : 0,
      failures: success ? 0 : 1,
      avgDurationMs: durationMs,
      successRate: success ? 1 : 0,
      lastUsed: Date.now(),
    });
  }
}

/**
 * Get effectiveness records for a skill.
 * If `modelId` is provided, returns only that model's record (as a single-item array).
 * If omitted, returns all model records for the skill.
 */
export function getSkillEffectiveness(
  skillId: string,
  modelId?: string,
): SkillEffectiveness[] {
  if (modelId) {
    const record = effectivenessMap.get(effectivenessKey(skillId, modelId));
    return record ? [record] : [];
  }

  const results: SkillEffectiveness[] = [];
  for (const record of effectivenessMap.values()) {
    if (record.skillId === skillId) {
      results.push(record);
    }
  }
  return results;
}

/**
 * Return the model with the highest success rate for a given skill.
 * Returns null if no data exists.
 */
export function getBestModelForSkill(
  skillId: string,
): { modelId: string; successRate: number } | null {
  const records = getSkillEffectiveness(skillId);
  if (records.length === 0) return null;

  let best: SkillEffectiveness = records[0];
  for (const record of records) {
    if (record.successRate > best.successRate) {
      best = record;
    }
  }

  return { modelId: best.modelId, successRate: best.successRate };
}

/**
 * Return all skills ranked by total usage, with their overall success rate.
 */
export function getSkillRanking(): Array<{
  skillId: string;
  totalUses: number;
  overallSuccessRate: number;
}> {
  // Aggregate per-skill across all models
  const bySkill = new Map<string, { successes: number; attempts: number }>();

  for (const record of effectivenessMap.values()) {
    const agg = bySkill.get(record.skillId) ?? { successes: 0, attempts: 0 };
    agg.successes += record.successes;
    agg.attempts += record.attempts;
    bySkill.set(record.skillId, agg);
  }

  const ranking = Array.from(bySkill.entries()).map(([skillId, agg]) => ({
    skillId,
    totalUses: agg.attempts,
    overallSuccessRate: agg.attempts > 0 ? agg.successes / agg.attempts : 0,
  }));

  // Sort descending by total uses, then by success rate
  ranking.sort((a, b) => {
    if (b.totalUses !== a.totalUses) return b.totalUses - a.totalUses;
    return b.overallSuccessRate - a.overallSuccessRate;
  });

  return ranking;
}

/**
 * Dump the full effectiveness map as a plain object (for persistence on shutdown).
 */
export function dumpEffectivenessData(): Record<string, SkillEffectiveness> {
  const out: Record<string, SkillEffectiveness> = {};
  for (const [key, value] of effectivenessMap.entries()) {
    out[key] = value;
  }
  return out;
}

/**
 * Restore previously persisted effectiveness data (e.g. loaded from disk on startup).
 */
export function restoreEffectivenessData(data: Record<string, SkillEffectiveness>): void {
  for (const [key, value] of Object.entries(data)) {
    effectivenessMap.set(key, value);
  }
}
