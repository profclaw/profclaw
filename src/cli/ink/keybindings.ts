/**
 * Keybindings Configuration
 *
 * Loads, saves, and matches keyboard shortcuts.
 * User overrides are read from .profclaw/keybindings.json and merged
 * with the default set so unknown keys are always preserved.
 */

import fs from 'fs';
import path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Keybinding {
  key: string;          // e.g. 'ctrl+l', 'alt+enter', 'shift+tab'
  action: string;       // e.g. 'clear', 'multiline', 'toggle-thinking'
  description: string;
}

export interface KeyModifiers {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULT_KEYBINDINGS: Keybinding[] = [
  { key: 'ctrl+l',     action: 'clear',            description: 'Clear screen' },
  { key: 'ctrl+c',     action: 'cancel',            description: 'Cancel current operation' },
  { key: 'ctrl+d',     action: 'exit',              description: 'Quit' },
  { key: 'alt+enter',  action: 'multiline',         description: 'Enter multiline mode' },
  { key: 'shift+tab',  action: 'toggle-thinking',   description: 'Toggle thinking display' },
  { key: 'ctrl+p',     action: 'session-picker',    description: 'Open session picker' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultConfigPath(): string {
  return path.join(process.cwd(), '.profclaw', 'keybindings.json');
}

/**
 * Normalise a key string to lowercase with sorted modifiers so comparisons
 * are consistent regardless of how the caller orders modifier names.
 * e.g. "Ctrl+Shift+L" → "ctrl+shift+l"
 */
function normaliseKey(key: string): string {
  const parts = key.toLowerCase().split('+').map(p => p.trim());

  const modifiers = parts.filter(p => ['ctrl', 'alt', 'shift'].includes(p)).sort();
  const rest = parts.filter(p => !['ctrl', 'alt', 'shift'].includes(p));

  return [...modifiers, ...rest].join('+');
}

/**
 * Build a normalised key string from a bare key name and a modifiers object
 * (as produced by Ink's `useInput` hook).
 */
function buildKeyString(key: string, modifiers: KeyModifiers): string {
  const parts: string[] = [];
  if (modifiers.ctrl)  parts.push('ctrl');
  if (modifiers.alt)   parts.push('alt');
  if (modifiers.shift) parts.push('shift');
  parts.push(key.toLowerCase());
  return parts.join('+');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load keybindings from the config file, merged with defaults.
 * User-defined entries override defaults by `action`; entries in the config
 * that don't match any default action are appended as custom bindings.
 */
export function loadKeybindings(configPath?: string): Keybinding[] {
  const filePath = configPath ?? defaultConfigPath();

  let userBindings: Keybinding[] = [];

  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      userBindings = JSON.parse(raw) as Keybinding[];
    } catch {
      // Malformed JSON — fall back to defaults silently
    }
  }

  if (userBindings.length === 0) {
    return [...DEFAULT_KEYBINDINGS];
  }

  // Merge: for each default, check if user overrides by action
  const userByAction = new Map(userBindings.map(b => [b.action, b]));
  const merged: Keybinding[] = DEFAULT_KEYBINDINGS.map(def => {
    const override = userByAction.get(def.action);
    return override ? { ...def, ...override } : def;
  });

  // Append any custom user bindings whose action isn't in the defaults
  const defaultActions = new Set(DEFAULT_KEYBINDINGS.map(b => b.action));
  for (const binding of userBindings) {
    if (!defaultActions.has(binding.action)) {
      merged.push(binding);
    }
  }

  return merged;
}

/**
 * Persist keybindings to the config file.
 * Creates the .profclaw directory if it doesn't exist.
 */
export function saveKeybindings(bindings: Keybinding[], configPath?: string): void {
  const filePath = configPath ?? defaultConfigPath();
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, JSON.stringify(bindings, null, 2), 'utf8');
}

/**
 * Find the first keybinding matching a key + modifier combination.
 * Returns undefined when no match is found.
 */
export function matchKeybinding(
  key: string,
  modifiers: KeyModifiers,
  bindings: Keybinding[],
): Keybinding | undefined {
  const pressed = normaliseKey(buildKeyString(key, modifiers));
  return bindings.find(b => normaliseKey(b.key) === pressed);
}
