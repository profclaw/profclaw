/**
 * Output Styles — Unit tests
 *
 * Tests for loadOutputStyle, BUILT_IN_STYLES, and config-file merging.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { loadOutputStyle, BUILT_IN_STYLES } from '../output-styles.js';

// Mock fs so we can control config file presence without touching disk
vi.mock('fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('fs')>();
  return {
    ...original,
    existsSync: vi.fn(original.existsSync),
    readFileSync: vi.fn(original.readFileSync),
  };
});

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

// ── BUILT_IN_STYLES ────────────────────────────────────────────────────────────

describe('BUILT_IN_STYLES', () => {
  it('defines all four required built-in styles', () => {
    expect(Object.keys(BUILT_IN_STYLES)).toEqual(
      expect.arrayContaining(['default', 'minimal', 'bordered', 'plain']),
    );
  });

  it('default style has codeBlockBorder enabled and compact off', () => {
    const s = BUILT_IN_STYLES['default']!;
    expect(s.codeBlockBorder).toBe(true);
    expect(s.compact).toBe(false);
    expect(s.messagePrefix).toBe('  ');
  });

  it('minimal style has compact enabled and no message prefix', () => {
    const s = BUILT_IN_STYLES['minimal']!;
    expect(s.compact).toBe(true);
    expect(s.messagePrefix).toBe('');
    expect(s.codeBlockBorder).toBe(false);
  });

  it('bordered style has sidebar prefix "│ "', () => {
    const s = BUILT_IN_STYLES['bordered']!;
    expect(s.messagePrefix).toBe('│ ');
    expect(s.codeBlockBorder).toBe(true);
  });

  it('plain style has no decoration and compact enabled', () => {
    const s = BUILT_IN_STYLES['plain']!;
    expect(s.messagePrefix).toBe('');
    expect(s.codeBlockBorder).toBe(false);
    expect(s.compact).toBe(true);
  });

  it('every style has all required keys', () => {
    const required: Array<keyof typeof BUILT_IN_STYLES['default']> = [
      'name', 'messagePrefix', 'messagePrefixColor',
      'codeBlockBorder', 'codeLabelColor',
      'toolIcon', 'toolColor', 'compact',
    ];
    for (const [styleName, style] of Object.entries(BUILT_IN_STYLES)) {
      for (const key of required) {
        expect(style, `${styleName}.${key} should exist`).toHaveProperty(key);
      }
    }
  });
});

// ── loadOutputStyle — no config file ──────────────────────────────────────────

describe('loadOutputStyle — no config file on disk', () => {
  beforeEach(() => {
    // Simulate missing config files
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the default style when called with no arguments', () => {
    const style = loadOutputStyle();
    expect(style.name).toBe('default');
    expect(style).toEqual(BUILT_IN_STYLES['default']);
  });

  it('returns a named built-in when a valid name is passed', () => {
    expect(loadOutputStyle('minimal')).toEqual(BUILT_IN_STYLES['minimal']);
    expect(loadOutputStyle('bordered')).toEqual(BUILT_IN_STYLES['bordered']);
    expect(loadOutputStyle('plain')).toEqual(BUILT_IN_STYLES['plain']);
  });

  it('falls back to default for an unknown style name', () => {
    const style = loadOutputStyle('nonexistent-style');
    expect(style.name).toBe('default');
  });
});

// ── loadOutputStyle — with config file ────────────────────────────────────────

describe('loadOutputStyle — config file present', () => {
  beforeEach(() => {
    // Simulate config file found in the first candidate path
    mockExistsSync.mockImplementation((p) => String(p).includes('.profclaw/style.json'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('merges config file overrides on top of the default style', () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ compact: true, toolIcon: '>>' }) as unknown as Buffer,
    );
    const style = loadOutputStyle();
    // Overrides applied
    expect(style.compact).toBe(true);
    expect(style.toolIcon).toBe('>>');
    // Original defaults preserved where not overridden
    expect(style.codeBlockBorder).toBe(BUILT_IN_STYLES['default']!.codeBlockBorder);
    expect(style.messagePrefix).toBe(BUILT_IN_STYLES['default']!.messagePrefix);
  });

  it('uses named built-in as base when config file specifies a name', () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ name: 'minimal', toolIcon: '~>' }) as unknown as Buffer,
    );
    const style = loadOutputStyle();
    // Base is minimal, with toolIcon overridden
    expect(style.compact).toBe(true);           // from minimal
    expect(style.codeBlockBorder).toBe(false);  // from minimal
    expect(style.toolIcon).toBe('~>');          // overridden
  });

  it('CLI name argument takes priority over config file name field for direct lookups', () => {
    // When a known name is passed as arg, we skip the config file entirely
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ name: 'plain', compact: false }) as unknown as Buffer,
    );
    const style = loadOutputStyle('bordered');
    expect(style.name).toBe('bordered');
    expect(style.compact).toBe(false);  // bordered.compact is false
  });

  it('falls back to default when config file JSON is malformed', () => {
    mockReadFileSync.mockReturnValue('{ this is not valid json' as unknown as Buffer);
    const style = loadOutputStyle();
    expect(style.name).toBe('default');
  });
});
