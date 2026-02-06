/**
 * Skills System - Core Types
 *
 * Modular capability system inspired by OpenClaw's SKILL.md format
 * and the Agent Skills open specification.
 *
 * Skills are discoverable instruction packages that extend agent capabilities
 * via progressive disclosure: metadata loads early, full instructions on demand.
 */

// SKILL.md Frontmatter

/** Parsed SKILL.md frontmatter (YAML header) */
export interface SkillFrontmatter {
  name: string;
  description: string;

  /** Whether users can invoke this skill via /command */
  'user-invocable'?: boolean;

  /** Whether AI models can auto-invoke this skill */
  'disable-model-invocation'?: boolean;

  /** Command dispatch to a tool */
  'command-dispatch'?: 'tool';
  'command-tool'?: string;
  'command-arg-mode'?: 'raw' | 'parsed';

  /** Extended metadata */
  metadata?: string; // JSON string containing SkillMetadata
}

/** Extended metadata (parsed from frontmatter.metadata JSON) */
export interface SkillMetadata {
  /** Always enable this skill regardless of requirements */
  always?: boolean;

  /** Override skill key (for config lookups) */
  skillKey?: string;

  /** Primary environment variable (API key) */
  primaryEnv?: string;

  /** Visual identifier */
  emoji?: string;

  /** Documentation URL */
  homepage?: string;

  /** Supported platforms */
  os?: ('darwin' | 'linux' | 'win32')[];

  /** Required dependencies */
  requires?: {
    /** All of these binaries must be available */
    bins?: string[];
    /** At least one of these binaries must be available */
    anyBins?: string[];
    /** All of these env vars must be set */
    env?: string[];
    /** All of these config paths must be truthy */
    config?: string[];
  };

  /** Installation instructions for dependencies */
  install?: SkillInstallSpec[];

  /** Tool categories this skill provides */
  toolCategories?: string[];
}

/** How to install a missing dependency */
export interface SkillInstallSpec {
  kind: 'brew' | 'npm' | 'pnpm' | 'go' | 'pip' | 'download';
  id?: string;
  label?: string;
  bins?: string[];
  os?: string[];
  formula?: string;   // brew
  package?: string;    // npm/pip/pnpm
  module?: string;     // go
  url?: string;        // download
  archive?: string;    // tar.gz/zip
  extract?: boolean;
  targetDir?: string;
}

// Skill Entry (Unified representation)

/** Source of a skill */
export type SkillSource = 'bundled' | 'managed' | 'workspace' | 'plugin';

/** A loaded skill entry */
export interface SkillEntry {
  /** Unique skill name */
  name: string;

  /** Human-readable description */
  description: string;

  /** Source where this skill was loaded from */
  source: SkillSource;

  /** Directory path containing the skill */
  dirPath: string;

  /** SKILL.md file path */
  skillMdPath: string;

  /** Parsed frontmatter */
  frontmatter: SkillFrontmatter;

  /** Parsed extended metadata */
  metadata?: SkillMetadata;

  /** Full instructions (body of SKILL.md after frontmatter) */
  instructions: string;

  /** Invocation policy */
  invocation: SkillInvocationPolicy;

  /** Whether this skill is eligible (requirements met) */
  eligible: boolean;

  /** Reasons skill is ineligible (missing bins, env, etc.) */
  eligibilityErrors: string[];

  /** Whether this skill is enabled in config */
  enabled: boolean;

  /** Chat command spec (if user-invocable) */
  command?: SkillCommandSpec;
}

/** Controls how the skill can be invoked */
export interface SkillInvocationPolicy {
  /** Users can invoke via /command */
  userInvocable: boolean;

  /** AI models can auto-invoke */
  modelInvocable: boolean;
}

/** Chat command mapping */
export interface SkillCommandSpec {
  /** Command name (e.g., "python") for /python */
  name: string;

  /** Skill it maps to */
  skillName: string;

  /** Description (max 100 chars) */
  description: string;

  /** Optional: dispatch to a specific tool */
  dispatch?: {
    kind: 'tool';
    toolName: string;
    argMode?: 'raw' | 'parsed';
  };
}

// Skill Snapshot (Lazy-evaluated state)

/** Snapshot of skill state for prompt injection */
export interface SkillSnapshot {
  /** Formatted skills prompt for AI model */
  prompt: string;

  /** Summary of available skills */
  skills: Array<{
    name: string;
    description: string;
    primaryEnv?: string;
    source: SkillSource;
  }>;

  /** Resolved skill entries */
  entries: SkillEntry[];

  /** Change tracking version */
  version: number;

  /** When this snapshot was built */
  builtAt: number;
}

// Skill Configuration

/** Per-skill config (from settings) */
export interface SkillConfig {
  enabled?: boolean;
  apiKey?: string;
  env?: Record<string, string>;
  config?: Record<string, unknown>;
}

/** Skills system configuration */
export interface SkillsSystemConfig {
  /** Directories to load skills from */
  load: {
    /** Additional skill directories */
    extraDirs: string[];
    /** Watch for file changes */
    watch: boolean;
    /** Debounce delay for file watcher */
    watchDebounceMs: number;
  };

  /** Installation preferences */
  install: {
    /** Prefer brew over other package managers */
    preferBrew: boolean;
    /** Node package manager */
    nodeManager: 'npm' | 'pnpm' | 'yarn';
  };

  /** Per-skill configuration overrides */
  entries: Record<string, SkillConfig>;

  /** Bundled skills allowlist (empty = all allowed) */
  allowBundled: string[];
}

/** Default configuration */
export const DEFAULT_SKILLS_CONFIG: SkillsSystemConfig = {
  load: {
    extraDirs: [],
    watch: true,
    watchDebounceMs: 250,
  },
  install: {
    preferBrew: true,
    nodeManager: 'pnpm',
  },
  entries: {},
  allowBundled: [],
};

// Skill Status (for diagnostics)

/** Detailed status for a single skill */
export interface SkillStatus {
  name: string;
  source: SkillSource;
  enabled: boolean;
  eligible: boolean;
  errors: string[];
  missing: {
    bins: string[];
    env: string[];
    config: string[];
  };
  installOptions: SkillInstallSpec[];
  metadata?: SkillMetadata;
}

/** Overall skills system status */
export interface SkillsStatus {
  totalLoaded: number;
  totalEligible: number;
  totalEnabled: number;
  skills: SkillStatus[];
  sources: {
    bundled: number;
    managed: number;
    workspace: number;
    plugin: number;
  };
  version: number;
}
