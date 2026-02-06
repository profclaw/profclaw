/**
 * Skills Prompt Builder
 *
 * Formats eligible skills into prompt context for the LLM.
 * Following OpenClaw's XML format for compatibility.
 */

import type { SkillEntry, SkillSnapshot, SkillsSystemConfig } from './types.js';
import { loadAllSkills, filterSkills } from './loader.js';
import { logger } from '../utils/logger.js';

/**
 * Escape XML special characters
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Format a single skill entry for prompt injection
 */
function formatSkillForPrompt(entry: SkillEntry): string {
  const name = escapeXml(entry.name);
  const description = escapeXml(entry.description);
  const location = escapeXml(entry.skillMdPath);

  return `<skill>
<name>${name}</name>
<description>${description}</description>
<location>${location}</location>
<content>
${entry.instructions}
</content>
</skill>`;
}

/**
 * Format multiple skills for prompt injection
 * Following OpenClaw's XML format
 */
export function formatSkillsForPrompt(entries: SkillEntry[]): string {
  if (entries.length === 0) {
    return '';
  }

  const formatted = entries.map(formatSkillForPrompt).join('\n\n');

  return `<available_skills>
The following skills are available. Use them to understand how to accomplish tasks:

${formatted}
</available_skills>`;
}

/**
 * Build a skill snapshot for a session
 */
export async function buildSkillSnapshot(params: {
  workspaceDir?: string;
  config?: SkillsSystemConfig;
  entries?: SkillEntry[];
  version?: number;
}): Promise<SkillSnapshot> {
  const { workspaceDir, config, entries: providedEntries, version = 1 } = params;

  // Load entries if not provided
  const allEntries = providedEntries ?? await loadAllSkills({
    workspaceDir,
    extraDirs: config?.load?.extraDirs,
  });

  // Filter to eligible skills
  const eligible = filterSkills(allEntries, config);

  // Filter out skills that shouldn't be in the model prompt
  const promptEntries = eligible.filter(
    (entry) => entry.invocation.modelInvocable
  );

  // Build prompt
  const prompt = formatSkillsForPrompt(promptEntries);

  logger.info(`[Skills] Built snapshot with ${eligible.length} eligible skills (${promptEntries.length} for prompt)`);

  return {
    prompt,
    skills: eligible.map((entry) => ({
      name: entry.name,
      description: entry.description,
      primaryEnv: entry.metadata?.primaryEnv,
      source: entry.source,
    })),
    entries: eligible,
    version,
    builtAt: Date.now(),
  };
}

/**
 * Build skills prompt for a single run
 */
export async function buildSkillsPrompt(params: {
  workspaceDir?: string;
  config?: SkillsSystemConfig;
  entries?: SkillEntry[];
}): Promise<string> {
  const snapshot = await buildSkillSnapshot(params);
  return snapshot.prompt;
}

/**
 * Resolve skills prompt from snapshot or build fresh
 */
export async function resolveSkillsPromptForRun(params: {
  skillsSnapshot?: SkillSnapshot;
  entries?: SkillEntry[];
  config?: SkillsSystemConfig;
  workspaceDir?: string;
}): Promise<string> {
  // Use cached snapshot if available
  const snapshotPrompt = params.skillsSnapshot?.prompt?.trim();
  if (snapshotPrompt) {
    return snapshotPrompt;
  }

  // Build from entries if provided
  if (params.entries && params.entries.length > 0) {
    return buildSkillsPrompt({
      workspaceDir: params.workspaceDir,
      entries: params.entries,
      config: params.config,
    });
  }

  // No skills available
  return '';
}

/**
 * Get skill entry by name from snapshot
 */
export function getSkillFromSnapshot(
  snapshot: SkillSnapshot,
  name: string
): SkillEntry | undefined {
  return snapshot.entries?.find((s) => s.name === name);
}

/**
 * Calculate approximate token cost of skills prompt
 * Based on OpenClaw's formula: ~4 chars per token
 */
export function estimateSkillsTokenCost(entries: SkillEntry[]): number {
  if (entries.length === 0) {
    return 0;
  }

  // Base overhead: ~195 chars
  let totalChars = 195;

  for (const entry of entries) {
    // Per skill: ~97 chars + field lengths
    totalChars += 97;
    totalChars += entry.name.length;
    totalChars += entry.description.length;
    totalChars += entry.skillMdPath.length;
    totalChars += entry.instructions.length;
  }

  // Rough estimate: ~4 chars per token
  return Math.ceil(totalChars / 4);
}
