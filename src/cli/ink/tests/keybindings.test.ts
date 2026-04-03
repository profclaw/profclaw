import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('fs');

describe('loadKeybindings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns defaults when no config file exists', async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const { loadKeybindings, DEFAULT_KEYBINDINGS } = await import('../keybindings.js');
    const bindings = loadKeybindings('/tmp/nonexistent/keybindings.json');

    expect(bindings).toEqual(DEFAULT_KEYBINDINGS);
  });

  it('merges user overrides with defaults by action', async () => {
    const userOverride = [
      { key: 'ctrl+k', action: 'clear', description: 'My clear' },
    ];

    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(userOverride));

    const { loadKeybindings } = await import('../keybindings.js');
    const bindings = loadKeybindings('/tmp/keybindings.json');

    const clearBinding = bindings.find(b => b.action === 'clear');
    expect(clearBinding?.key).toBe('ctrl+k');
    expect(clearBinding?.description).toBe('My clear');
  });

  it('preserves all default actions in the merged result', async () => {
    const userOverride = [
      { key: 'ctrl+k', action: 'clear', description: 'My clear' },
    ];

    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(userOverride));

    const { loadKeybindings, DEFAULT_KEYBINDINGS } = await import('../keybindings.js');
    const bindings = loadKeybindings('/tmp/keybindings.json');

    const defaultActions = DEFAULT_KEYBINDINGS.map(b => b.action);
    for (const action of defaultActions) {
      expect(bindings.some(b => b.action === action)).toBe(true);
    }
  });

  it('appends custom user actions not in defaults', async () => {
    const userBindings = [
      { key: 'ctrl+b', action: 'custom-action', description: 'My custom action' },
    ];

    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(userBindings));

    const { loadKeybindings } = await import('../keybindings.js');
    const bindings = loadKeybindings('/tmp/keybindings.json');

    expect(bindings.some(b => b.action === 'custom-action')).toBe(true);
  });

  it('falls back to defaults on malformed JSON', async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('{ invalid json }');

    const { loadKeybindings, DEFAULT_KEYBINDINGS } = await import('../keybindings.js');
    const bindings = loadKeybindings('/tmp/keybindings.json');

    expect(bindings).toEqual(DEFAULT_KEYBINDINGS);
  });
});

describe('saveKeybindings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes bindings as JSON to the config path', async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.mkdirSync as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (fs.writeFileSync as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const { saveKeybindings, DEFAULT_KEYBINDINGS } = await import('../keybindings.js');
    saveKeybindings(DEFAULT_KEYBINDINGS, '/tmp/.profclaw/keybindings.json');

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/tmp/.profclaw/keybindings.json',
      expect.stringContaining('"action"'),
      'utf8',
    );
  });

  it('creates parent directory if it does not exist', async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (fs.mkdirSync as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (fs.writeFileSync as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const { saveKeybindings, DEFAULT_KEYBINDINGS } = await import('../keybindings.js');
    saveKeybindings(DEFAULT_KEYBINDINGS, '/tmp/.profclaw/keybindings.json');

    expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp/.profclaw', { recursive: true });
  });
});

describe('matchKeybinding', () => {
  it('matches ctrl+l to the clear action', async () => {
    const { matchKeybinding, DEFAULT_KEYBINDINGS } = await import('../keybindings.js');
    const match = matchKeybinding('l', { ctrl: true }, DEFAULT_KEYBINDINGS);

    expect(match).toBeDefined();
    expect(match?.action).toBe('clear');
  });

  it('matches ctrl+d to the exit action', async () => {
    const { matchKeybinding, DEFAULT_KEYBINDINGS } = await import('../keybindings.js');
    const match = matchKeybinding('d', { ctrl: true }, DEFAULT_KEYBINDINGS);

    expect(match?.action).toBe('exit');
  });

  it('returns undefined for unbound key', async () => {
    const { matchKeybinding, DEFAULT_KEYBINDINGS } = await import('../keybindings.js');
    const match = matchKeybinding('z', { ctrl: true }, DEFAULT_KEYBINDINGS);

    expect(match).toBeUndefined();
  });

  it('is case-insensitive for key names', async () => {
    const { matchKeybinding, DEFAULT_KEYBINDINGS } = await import('../keybindings.js');
    const match = matchKeybinding('L', { ctrl: true }, DEFAULT_KEYBINDINGS);

    expect(match?.action).toBe('clear');
  });

  it('does not match when modifier is missing', async () => {
    const { matchKeybinding, DEFAULT_KEYBINDINGS } = await import('../keybindings.js');
    // ctrl+l requires ctrl — no modifiers should NOT match
    const match = matchKeybinding('l', {}, DEFAULT_KEYBINDINGS);

    expect(match).toBeUndefined();
  });

  it('matches shift+tab to toggle-thinking', async () => {
    const { matchKeybinding, DEFAULT_KEYBINDINGS } = await import('../keybindings.js');
    const match = matchKeybinding('tab', { shift: true }, DEFAULT_KEYBINDINGS);

    expect(match?.action).toBe('toggle-thinking');
  });

  it('matches alt+enter to multiline', async () => {
    const { matchKeybinding, DEFAULT_KEYBINDINGS } = await import('../keybindings.js');
    const match = matchKeybinding('enter', { alt: true }, DEFAULT_KEYBINDINGS);

    expect(match?.action).toBe('multiline');
  });

  it('uses the bindings array provided, not defaults', async () => {
    const { matchKeybinding } = await import('../keybindings.js');
    const custom = [
      { key: 'ctrl+z', action: 'undo', description: 'Undo' },
    ];
    const match = matchKeybinding('z', { ctrl: true }, custom);

    expect(match?.action).toBe('undo');
  });
});
