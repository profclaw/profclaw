/**
 * Output Styles — configurable formatting for TUI messages.
 *
 * Styles control how assistant messages, code blocks, and tool calls
 * are presented in the terminal. Load from .profclaw/style.json or
 * use one of the built-in named styles.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface OutputStyle {
  name: string;
  /** Prefix prepended to each line of an assistant message, e.g. '│ ' */
  messagePrefix: string;
  /** Chalk color name for the message prefix, e.g. 'cyan' or 'gray' */
  messagePrefixColor: string;
  /** Whether to draw a top/bottom border around code blocks */
  codeBlockBorder: boolean;
  /** Chalk color name for the code language label, e.g. 'yellow' */
  codeLabelColor: string;
  /** Icon shown before a tool call name, e.g. '⚙' or '->' */
  toolIcon: string;
  /** Chalk color name for tool call output */
  toolColor: string;
  /** Reduce whitespace between consecutive messages */
  compact: boolean;
}

// ── Built-in styles ────────────────────────────────────────────────────────────

export const BUILT_IN_STYLES: Record<string, OutputStyle> = {
  /** Full-featured default style with color, borders, and icons */
  default: {
    name: 'default',
    messagePrefix: '  ',
    messagePrefixColor: 'cyan',
    codeBlockBorder: true,
    codeLabelColor: 'yellow',
    toolIcon: '⚙',
    toolColor: 'cyan',
    compact: false,
  },

  /** Minimal style: no prefix, reduced whitespace */
  minimal: {
    name: 'minimal',
    messagePrefix: '',
    messagePrefixColor: 'gray',
    codeBlockBorder: false,
    codeLabelColor: 'gray',
    toolIcon: '->',
    toolColor: 'gray',
    compact: true,
  },

  /** Bordered style: sidebar line on every message, bordered code blocks */
  bordered: {
    name: 'bordered',
    messagePrefix: '│ ',
    messagePrefixColor: 'cyan',
    codeBlockBorder: true,
    codeLabelColor: 'cyan',
    toolIcon: '⚙',
    toolColor: 'cyan',
    compact: false,
  },

  /**
   * Plain style: no decoration, suitable for piping output to other tools.
   * Disables borders, icons, and color prefixes.
   */
  plain: {
    name: 'plain',
    messagePrefix: '',
    messagePrefixColor: 'white',
    codeBlockBorder: false,
    codeLabelColor: 'white',
    toolIcon: '[tool]',
    toolColor: 'white',
    compact: true,
  },
};

// ── Partial style type for style.json files ────────────────────────────────────

type PartialOutputStyle = Partial<Omit<OutputStyle, 'name'>> & { name?: string };

// ── Loader ─────────────────────────────────────────────────────────────────────

/**
 * Resolve the style config file location. Checks (in order):
 *   1. .profclaw/style.json in the current working directory
 *   2. ~/.profclaw/style.json in the user home directory
 */
function findStyleConfigPath(): string | null {
  const candidates = [
    join(process.cwd(), '.profclaw', 'style.json'),
    join(homedir(), '.profclaw', 'style.json'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Load an OutputStyle by name, or from a .profclaw/style.json config file.
 *
 * Resolution order:
 *   1. If `name` matches a built-in style key — use it.
 *   2. If a style.json file exists — merge it on top of the default style.
 *      If the file has a `name` field that matches a built-in, use that as
 *      the base instead of `default`.
 *   3. Fall back to the `default` built-in style.
 *
 * @param name  Optional style name override (e.g. from `--style minimal`).
 */
export function loadOutputStyle(name?: string): OutputStyle {
  // Direct named style lookup
  if (name !== undefined && name in BUILT_IN_STYLES) {
    return BUILT_IN_STYLES[name]!;
  }

  // Try loading from config file
  const configPath = findStyleConfigPath();
  if (configPath !== null) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw) as PartialOutputStyle;

      // Determine which built-in to use as the base
      const baseName = parsed.name ?? name ?? 'default';
      const base: OutputStyle = BUILT_IN_STYLES[baseName] ?? BUILT_IN_STYLES['default']!;

      // Merge file overrides on top of the base, then assign the final name
      const merged: OutputStyle = {
        ...base,
        ...parsed,
        name: baseName,
      };
      return merged;
    } catch {
      // Silently fall through to built-in default on parse errors
    }
  }

  // Final fallback: named built-in or default
  return BUILT_IN_STYLES[name ?? 'default'] ?? BUILT_IN_STYLES['default']!;
}
