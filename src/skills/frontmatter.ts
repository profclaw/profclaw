/**
 * Skill Frontmatter Parser
 *
 * Parses YAML frontmatter from SKILL.md files.
 * Following OpenClaw's patterns for compatibility.
 */

import type {
  SkillFrontmatter,
  SkillMetadata,
  SkillInvocationPolicy,
  SkillEntry,
  SkillSource,
} from './types.js';

/**
 * Raw parsed frontmatter (before type conversion)
 */
type ParsedFrontmatter = Record<string, string | undefined>;

/**
 * Parse YAML frontmatter from markdown content
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const frontmatter: ParsedFrontmatter = {};

  // Match YAML frontmatter block
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return frontmatter;
  }

  const yamlContent = match[1];
  const lines = yamlContent.split(/\r?\n/);

  for (const line of lines) {
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('#')) {
      continue;
    }

    // Parse key: value pairs (single-line only, following OpenClaw)
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      continue;
    }

    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();

    // Remove surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    frontmatter[key] = value;
  }

  return frontmatter;
}

/**
 * Get markdown content after frontmatter
 */
export function getMarkdownContent(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  return match ? match[1].trim() : content.trim();
}

/**
 * Normalize string list from various input formats
 */
function normalizeStringList(input: unknown): string[] {
  if (!input) {
    return [];
  }
  if (Array.isArray(input)) {
    return input.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof input === 'string') {
    return input.split(',').map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Parse boolean from string value
 */
function parseBooleanValue(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const lower = value.toLowerCase().trim();
  if (lower === 'true' || lower === '1' || lower === 'yes') return true;
  if (lower === 'false' || lower === '0' || lower === 'no') return false;
  return undefined;
}

/**
 * Parse frontmatter boolean with fallback
 */
function parseFrontmatterBool(value: string | undefined, fallback: boolean): boolean {
  const parsed = parseBooleanValue(value);
  return parsed === undefined ? fallback : parsed;
}

/**
 * Convert raw frontmatter to typed SkillFrontmatter
 */
function toSkillFrontmatter(raw: ParsedFrontmatter): SkillFrontmatter {
  return {
    name: raw['name'] || '',
    description: raw['description'] || '',
    'user-invocable': parseBooleanValue(raw['user-invocable']),
    'disable-model-invocation': parseBooleanValue(raw['disable-model-invocation']),
    'command-dispatch': raw['command-dispatch'] as 'tool' | undefined,
    'command-tool': raw['command-tool'],
    'command-arg-mode': raw['command-arg-mode'] as 'raw' | 'parsed' | undefined,
    metadata: raw['metadata'],
  };
}

/**
 * Resolve extended metadata from frontmatter
 */
export function resolveMetadata(
  raw: ParsedFrontmatter
): SkillMetadata | undefined {
  const metadataStr = raw['metadata'];
  if (!metadataStr) {
    return undefined;
  }

  try {
    // Parse JSON metadata
    const parsed = JSON.parse(metadataStr);
    if (!parsed || typeof parsed !== 'object') {
      return undefined;
    }

    // Support nested profclaw/openclaw key or flat structure
    const metadataObj = (parsed.profclaw || parsed.openclaw || parsed) as Record<string, unknown>;

    const requiresRaw = typeof metadataObj.requires === 'object' && metadataObj.requires !== null
      ? (metadataObj.requires as Record<string, unknown>)
      : undefined;

    const osRaw = normalizeStringList(metadataObj.os);

    return {
      always: typeof metadataObj.always === 'boolean' ? metadataObj.always : undefined,
      skillKey: typeof metadataObj.skillKey === 'string' ? metadataObj.skillKey : undefined,
      primaryEnv: typeof metadataObj.primaryEnv === 'string' ? metadataObj.primaryEnv : undefined,
      emoji: typeof metadataObj.emoji === 'string' ? metadataObj.emoji : undefined,
      homepage: typeof metadataObj.homepage === 'string' ? metadataObj.homepage : undefined,
      os: osRaw.length > 0 ? osRaw as ('darwin' | 'linux' | 'win32')[] : undefined,
      requires: requiresRaw ? {
        bins: normalizeStringList(requiresRaw.bins),
        anyBins: normalizeStringList(requiresRaw.anyBins),
        env: normalizeStringList(requiresRaw.env),
        config: normalizeStringList(requiresRaw.config),
      } : undefined,
      toolCategories: normalizeStringList(metadataObj.tools || metadataObj.toolCategories),
    };
  } catch {
    return undefined;
  }
}

/**
 * Resolve skill invocation policy from frontmatter
 */
export function resolveSkillInvocationPolicy(
  raw: ParsedFrontmatter
): SkillInvocationPolicy {
  return {
    userInvocable: parseFrontmatterBool(raw['user-invocable'], true),
    modelInvocable: !parseFrontmatterBool(raw['disable-model-invocation'], false),
  };
}

/**
 * Parse a SKILL.md file into a SkillEntry
 */
export function parseSkillFile(
  content: string,
  filePath: string,
  baseDir: string,
  source: SkillSource
): SkillEntry | null {
  const raw = parseFrontmatter(content);

  // Name is required
  const name = raw['name'];
  if (!name) {
    return null;
  }

  const frontmatter = toSkillFrontmatter(raw);
  const metadata = resolveMetadata(raw);
  const invocation = resolveSkillInvocationPolicy(raw);
  const instructions = getMarkdownContent(content);

  return {
    name,
    description: frontmatter.description || name,
    source,
    dirPath: baseDir,
    skillMdPath: filePath,
    frontmatter,
    metadata,
    instructions,
    invocation,
    eligible: true, // Will be computed by loader
    eligibilityErrors: [],
    enabled: true, // Will be computed by config
  };
}
