/**
 * Skills Loader
 *
 * Parses SKILL.md files with YAML frontmatter and loads skills from
 * multiple sources with precedence ordering.
 *
 * Loading precedence (lowest to highest):
 * 1. Extra dirs (config.load.extraDirs)
 * 2. Bundled (built-in skills)
 * 3. Managed (~/.profclaw/skills/)
 * 4. Workspace (<project>/skills/)
 *
 * Later sources override earlier ones by skill name.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../utils/logger.js';
import {
  DEFAULT_SKILLS_CONFIG,
  type SkillEntry,
  type SkillFrontmatter,
  type SkillMetadata,
  type SkillSource,
  type SkillsSystemConfig,
  type SkillCommandSpec,
  type SkillConfig,
  type SkillStatus,
  type SkillsStatus,
} from './types.js';
import { compileSkill, type CompiledSkill } from './compiler.js';

const execFileAsync = promisify(execFile);

// =============================================================================
// Compiled Skill Registry (populated during loadSkillFromDir)
// =============================================================================

/** In-memory registry of compiled skills, keyed by skillKey/skillName */
const compiledSkillRegistry = new Map<string, CompiledSkill>();

/**
 * Return the compiled (model-adaptive) version of a skill by its ID.
 * Returns undefined if the skill has not been loaded yet.
 */
export function getCompiledSkill(skillId: string): CompiledSkill | undefined {
  return compiledSkillRegistry.get(skillId);
}

// =============================================================================
// SKILL.md Parser
// =============================================================================

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;

/**
 * Parse a SKILL.md file into frontmatter + instructions
 */
export function parseSkillMd(content: string): {
  frontmatter: SkillFrontmatter;
  metadata?: SkillMetadata;
  instructions: string;
} {
  const match = content.match(FRONTMATTER_REGEX);

  if (!match) {
    // No frontmatter - treat entire content as instructions
    return {
      frontmatter: { name: 'unknown', description: '' },
      instructions: content,
    };
  }

  const [, yamlStr, instructions] = match;

  // Parse YAML frontmatter (simple key-value parser, no dependency needed)
  const rawFrontmatter = parseSimpleYaml(yamlStr);
  const frontmatter: SkillFrontmatter = {
    name: (rawFrontmatter.name as string) ?? 'unknown',
    description: (rawFrontmatter.description as string) ?? '',
    'user-invocable': rawFrontmatter['user-invocable'] as boolean | undefined,
    'disable-model-invocation': rawFrontmatter['disable-model-invocation'] as boolean | undefined,
    'command-dispatch': rawFrontmatter['command-dispatch'] as 'tool' | undefined,
    'command-tool': rawFrontmatter['command-tool'] as string | undefined,
    'command-arg-mode': rawFrontmatter['command-arg-mode'] as 'raw' | 'parsed' | undefined,
    metadata: rawFrontmatter.metadata as string | undefined,
  };

  // Parse extended metadata from JSON string
  let metadata: SkillMetadata | undefined;
  if (frontmatter.metadata) {
    try {
      const parsed = JSON.parse(frontmatter.metadata);
      // Support both { profclaw: {...} } and direct format
      metadata = parsed.profclaw || parsed.openclaw || parsed;
    } catch {
      logger.warn(`[Skills] Failed to parse metadata JSON for skill: ${frontmatter.name}`);
    }
  }

  return { frontmatter, metadata, instructions: instructions.trim() };
}

/**
 * Simple YAML parser for frontmatter (handles common cases without js-yaml dep)
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let multilineKey = '';
  let multilineValue = '';
  let inMultiline = false;

  for (const line of yaml.split('\n')) {
    // Handle multiline values (metadata: |)
    if (inMultiline) {
      if (line.startsWith('  ') || line.startsWith('\t') || line.trim() === '') {
        multilineValue += (multilineValue ? '\n' : '') + line.replace(/^  /, '');
        continue;
      } else {
        // End of multiline
        result[multilineKey] = multilineValue.trim();
        inMultiline = false;
      }
    }

    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    const rawValue = line.slice(colonIndex + 1).trim();

    if (!key) continue;

    // Check for multiline indicator
    if (rawValue === '|' || rawValue === '>') {
      multilineKey = key;
      multilineValue = '';
      inMultiline = true;
      continue;
    }

    // Parse value
    if (rawValue === 'true') {
      result[key] = true;
    } else if (rawValue === 'false') {
      result[key] = false;
    } else if (/^\d+$/.test(rawValue)) {
      result[key] = parseInt(rawValue, 10);
    } else if (/^\d+\.\d+$/.test(rawValue)) {
      result[key] = parseFloat(rawValue);
    } else {
      // Strip quotes
      result[key] = rawValue.replace(/^['"]|['"]$/g, '');
    }
  }

  // Handle final multiline value
  if (inMultiline) {
    result[multilineKey] = multilineValue.trim();
  }

  return result;
}

// =============================================================================
// Skill Loading
// =============================================================================

/**
 * Load a single skill from a directory
 */
async function loadSkillFromDir(
  dirPath: string,
  source: SkillSource,
  config: SkillsSystemConfig,
): Promise<SkillEntry | null> {
  const skillMdPath = join(dirPath, 'SKILL.md');

  try {
    const content = await readFile(skillMdPath, 'utf-8');
    const { frontmatter, metadata, instructions } = parseSkillMd(content);

    const skillName = frontmatter.name || basename(dirPath);
    const skillKey = metadata?.skillKey || skillName;
    const skillConfig = config?.entries?.[skillKey];

    // Build invocation policy
    const invocation = {
      userInvocable: frontmatter['user-invocable'] !== false,
      modelInvocable: frontmatter['disable-model-invocation'] !== true,
    };

    // Check eligibility
    const { eligible, errors } = await checkEligibility(metadata, skillConfig);

    // Build command spec
    let command: SkillCommandSpec | undefined;
    if (invocation.userInvocable) {
      const cmdName = sanitizeCommandName(skillName);
      command = {
        name: cmdName,
        skillName,
        description: (frontmatter.description || '').slice(0, 100),
      };

      if (frontmatter['command-dispatch'] === 'tool' && frontmatter['command-tool']) {
        command.dispatch = {
          kind: 'tool',
          toolName: frontmatter['command-tool'],
          argMode: frontmatter['command-arg-mode'] || 'raw',
        };
      }
    }

    // Compile skill instructions for model-adaptive injection (9.1)
    const compiled = compileSkill(skillKey, skillName, instructions);
    compiledSkillRegistry.set(skillKey, compiled);

    return {
      name: skillName,
      description: frontmatter.description || '',
      source,
      dirPath,
      skillMdPath,
      frontmatter,
      metadata,
      instructions,
      invocation,
      eligible: metadata?.always || eligible,
      eligibilityErrors: errors,
      enabled: skillConfig?.enabled !== false,
      command,
    };
  } catch {
    // SKILL.md doesn't exist or can't be read - skip silently
    return null;
  }
}

/**
 * Load skills from a directory containing skill subdirectories
 */
async function loadSkillsFromDir(
  parentDir: string,
  source: SkillSource,
  config: SkillsSystemConfig,
): Promise<SkillEntry[]> {
  const skills: SkillEntry[] = [];

  try {
    const entries = await readdir(parentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Skip hidden directories
      if (entry.name.startsWith('.')) continue;

      const skillDir = join(parentDir, entry.name);
      const skill = await loadSkillFromDir(skillDir, source, config);

      if (skill) {
        skills.push(skill);
      }
    }
  } catch {
    // Directory doesn't exist - that's fine
  }

  return skills;
}

/**
 * Load all skills from all sources with precedence ordering
 */
export async function loadAllSkills(params: {
  workspaceDir?: string;
  extraDirs?: string[];
  config?: SkillsSystemConfig;
}): Promise<SkillEntry[]> {
  const { workspaceDir, extraDirs, config = DEFAULT_SKILLS_CONFIG } = params;
  const skillMap = new Map<string, SkillEntry>();

  // Merge extraDirs from params with config
  const allExtraDirs = [...(config.load?.extraDirs ?? []), ...(extraDirs ?? [])];

  // 1. Extra dirs (lowest precedence)
  for (const dir of allExtraDirs) {
    const skills = await loadSkillsFromDir(dir, 'plugin', config);
    for (const skill of skills) {
      skillMap.set(skill.name, skill);
    }
  }

  // 2. Bundled skills
  // Navigate relative to the project root
  const bundledDir = join(process.cwd(), 'skills');

  const bundledSkills = await loadSkillsFromDir(bundledDir, 'bundled', config);
  for (const skill of bundledSkills) {
    // Check allowlist (empty = all allowed)
    if ((config.allowBundled?.length ?? 0) === 0 || config.allowBundled?.includes(skill.name)) {
      skillMap.set(skill.name, skill);
    }
  }

  // 3. Managed skills (~/.profclaw/skills/)
  const managedDir = join(homedir(), '.profclaw', 'skills');
  const managedSkills = await loadSkillsFromDir(managedDir, 'managed', config);
  for (const skill of managedSkills) {
    skillMap.set(skill.name, skill);
  }

  // 4. Workspace skills (highest precedence)
  if (workspaceDir) {
    const workspaceSkillsDir = join(workspaceDir, 'skills');
    const workspaceSkills = await loadSkillsFromDir(workspaceSkillsDir, 'workspace', config);
    for (const skill of workspaceSkills) {
      skillMap.set(skill.name, skill);
    }
  }

  const allSkills = Array.from(skillMap.values());
  logger.info(
    `[Skills] Loaded ${allSkills.length} skills ` +
    `(${bundledSkills.length} bundled, ${managedSkills.length} managed)`
  );

  return allSkills;
}

/**
 * Filter skills by eligibility and configuration
 */
export function filterSkills(
  skills: SkillEntry[],
  config?: SkillsSystemConfig,
): SkillEntry[] {
  return skills.filter((skill) => {
    // Check if skill is enabled
    if (!skill.enabled) return false;

    // Check eligibility
    if (!skill.eligible) return false;

    // Check config-based disabling
    const skillKey = skill.metadata?.skillKey ?? skill.name;
    const skillConfig = config?.entries?.[skillKey];
    if (skillConfig?.enabled === false) return false;

    return true;
  });
}

// =============================================================================
// Eligibility Checking
// =============================================================================

/** Cache for binary existence checks */
const binaryCache = new Map<string, boolean>();

/**
 * Check if a binary exists in PATH
 */
export async function hasBinary(name: string): Promise<boolean> {
  const cached = binaryCache.get(name);
  if (cached !== undefined) return cached;

  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    await execFileAsync(cmd, [name], { timeout: 3000 });
    binaryCache.set(name, true);
    return true;
  } catch {
    binaryCache.set(name, false);
    return false;
  }
}

/** Clear binary cache (for testing or after installs) */
export function clearBinaryCache(): void {
  binaryCache.clear();
}

/**
 * Check if a skill's requirements are met
 */
export async function checkEligibility(
  metadata?: SkillMetadata,
  skillConfig?: SkillConfig,
): Promise<{ eligible: boolean; errors: string[] }> {
  const errors: string[] = [];

  if (!metadata?.requires) {
    return { eligible: true, errors };
  }

  const { requires } = metadata;

  // Check OS
  if (metadata.os && !metadata.os.includes(process.platform as 'darwin' | 'linux' | 'win32')) {
    errors.push(`Unsupported platform: ${process.platform} (requires: ${metadata.os.join(', ')})`);
  }

  // Check required binaries (all must exist)
  if (requires.bins) {
    for (const bin of requires.bins) {
      if (!(await hasBinary(bin))) {
        errors.push(`Missing binary: ${bin}`);
      }
    }
  }

  // Check any binaries (at least one must exist)
  if (requires.anyBins && requires.anyBins.length > 0) {
    let hasAny = false;
    for (const bin of requires.anyBins) {
      if (await hasBinary(bin)) {
        hasAny = true;
        break;
      }
    }
    if (!hasAny) {
      errors.push(`Missing one of: ${requires.anyBins.join(', ')}`);
    }
  }

  // Check environment variables
  if (requires.env) {
    for (const envVar of requires.env) {
      // Check skill config first, then process.env
      const hasValue = skillConfig?.apiKey && metadata.primaryEnv === envVar
        ? true
        : !!process.env[envVar];

      if (!hasValue) {
        errors.push(`Missing env: ${envVar}`);
      }
    }
  }

  return { eligible: errors.length === 0, errors };
}

// =============================================================================
// Skill Snapshot
// =============================================================================

/**
 * Build a skills snapshot with prompt for AI model (synchronous version)
 * Use this when you already have loaded skills.
 */
export function buildSkillSnapshotSync(
  skills: SkillEntry[],
  version: number,
): { prompt: string; snapshot: import('./types.js').SkillSnapshot } {
  const eligible = skills.filter(s => s.eligible && s.enabled);

  // Build prompt
  const lines: string[] = [];

  if (eligible.length > 0) {
    lines.push('## Available Skills\n');
    lines.push('The following skills extend your capabilities:\n');

    for (const skill of eligible) {
      const emoji = skill.metadata?.emoji || '';
      lines.push(`### ${emoji} ${skill.name}`);
      lines.push(skill.description);

      // Include instructions if not too long (progressive disclosure)
      if (skill.instructions.length <= 2000) {
        lines.push('');
        lines.push(skill.instructions);
      } else {
        lines.push(`\n*Full instructions available (${Math.round(skill.instructions.length / 4)} tokens)*`);
      }
      lines.push('');
    }
  }

  const snapshot: import('./types.js').SkillSnapshot = {
    prompt: lines.join('\n'),
    skills: eligible.map(s => ({
      name: s.name,
      description: s.description,
      primaryEnv: s.metadata?.primaryEnv,
      source: s.source,
    })),
    entries: eligible,
    version,
    builtAt: Date.now(),
  };

  return { prompt: lines.join('\n'), snapshot };
}

// =============================================================================
// Skill Status
// =============================================================================

/**
 * Build detailed status for all skills
 */
export function buildSkillsStatus(skills: SkillEntry[], version: number): SkillsStatus {
  const sources = { bundled: 0, managed: 0, workspace: 0, plugin: 0 };

  const skillStatuses: SkillStatus[] = skills.map(skill => {
    sources[skill.source]++;

    const missingBins: string[] = [];
    const missingEnv: string[] = [];
    const missingConfig: string[] = [];

    // Parse errors to find missing items
    for (const err of skill.eligibilityErrors) {
      if (err.startsWith('Missing binary:')) missingBins.push(err.replace('Missing binary: ', ''));
      if (err.startsWith('Missing env:')) missingEnv.push(err.replace('Missing env: ', ''));
      if (err.startsWith('Missing config:')) missingConfig.push(err.replace('Missing config: ', ''));
    }

    return {
      name: skill.name,
      source: skill.source,
      enabled: skill.enabled,
      eligible: skill.eligible,
      errors: skill.eligibilityErrors,
      missing: { bins: missingBins, env: missingEnv, config: missingConfig },
      installOptions: skill.metadata?.install || [],
      metadata: skill.metadata,
    };
  });

  return {
    totalLoaded: skills.length,
    totalEligible: skills.filter(s => s.eligible).length,
    totalEnabled: skills.filter(s => s.enabled && s.eligible).length,
    skills: skillStatuses,
    sources,
    version,
  };
}

// =============================================================================
// Utility
// =============================================================================

/** Sanitize a skill name for use as a chat command (alphanumeric + underscore, max 32 chars) */
function sanitizeCommandName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 32);
}

/**
 * Apply per-skill environment overrides
 * Returns a cleanup function to restore original env
 */
export function applySkillEnvOverrides(
  skills: SkillEntry[],
  config: SkillsSystemConfig,
): () => void {
  const original: Record<string, string | undefined> = {};

  for (const skill of skills) {
    if (!skill.eligible || !skill.enabled) continue;

    const skillKey = skill.metadata?.skillKey || skill.name;
    const skillConfig = config.entries[skillKey];
    if (!skillConfig) continue;

    // Apply API key as primary env
    if (skillConfig.apiKey && skill.metadata?.primaryEnv) {
      const envVar = skill.metadata.primaryEnv;
      original[envVar] = process.env[envVar];
      process.env[envVar] = skillConfig.apiKey;
    }

    // Apply custom env overrides
    if (skillConfig.env) {
      for (const [key, value] of Object.entries(skillConfig.env)) {
        original[key] = process.env[key];
        process.env[key] = value;
      }
    }
  }

  // Return cleanup function
  return () => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}
