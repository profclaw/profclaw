import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PermissionManager,
  DEFAULT_PERMISSION_RULES,
  type PermissionRule,
  type PermissionResponse,
} from '../permissions.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManager(rules?: PermissionRule[]): PermissionManager {
  return new PermissionManager(rules);
}

function makePrompt(response: PermissionResponse) {
  return vi.fn().mockResolvedValue(response);
}

// ---------------------------------------------------------------------------
// Safe tools — auto-allowed without prompting
// ---------------------------------------------------------------------------

describe('safe tools', () => {
  it('allows read_file without prompting', async () => {
    const manager = makeManager();
    const prompt = makePrompt('deny');
    manager.setPromptCallback(prompt);

    const result = await manager.check('read_file');

    expect(result.allowed).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('allows an unknown tool (no rule) without prompting', async () => {
    const manager = makeManager();
    const prompt = makePrompt('deny');
    manager.setPromptCallback(prompt);

    const result = await manager.check('some_unknown_tool');

    expect(result.allowed).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('getLevel returns "safe" for an unknown tool', () => {
    const manager = makeManager();
    expect(manager.getLevel('no_such_tool')).toBe('safe');
  });
});

// ---------------------------------------------------------------------------
// Dangerous tools — always prompt
// ---------------------------------------------------------------------------

describe('dangerous tools', () => {
  it('prompts before allowing bash when callback returns allow', async () => {
    const manager = makeManager();
    const prompt = makePrompt('allow');
    manager.setPromptCallback(prompt);

    const result = await manager.check('bash', { command: 'echo hi' });

    expect(result.allowed).toBe(true);
    expect(prompt).toHaveBeenCalledOnce();
    expect(prompt).toHaveBeenCalledWith('bash', { command: 'echo hi' }, expect.objectContaining({ toolName: 'bash' }));
  });

  it('denies bash when callback returns deny', async () => {
    const manager = makeManager();
    const prompt = makePrompt('deny');
    manager.setPromptCallback(prompt);

    const result = await manager.check('bash');

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/denied/i);
    expect(prompt).toHaveBeenCalledOnce();
  });

  it('prompts for delete_file', async () => {
    const manager = makeManager();
    const prompt = makePrompt('allow');
    manager.setPromptCallback(prompt);

    const result = await manager.check('delete_file');

    expect(result.allowed).toBe(true);
    expect(prompt).toHaveBeenCalledOnce();
  });

  it('getLevel returns "dangerous" for bash', () => {
    const manager = makeManager();
    expect(manager.getLevel('bash')).toBe('dangerous');
  });
});

// ---------------------------------------------------------------------------
// Cautious tools — prompt first time, remember afterwards
// ---------------------------------------------------------------------------

describe('cautious tools', () => {
  it('prompts before write_file', async () => {
    const manager = makeManager();
    const prompt = makePrompt('allow');
    manager.setPromptCallback(prompt);

    const result = await manager.check('write_file');

    expect(result.allowed).toBe(true);
    expect(prompt).toHaveBeenCalledOnce();
  });

  it('getLevel returns "cautious" for write_file', () => {
    const manager = makeManager();
    expect(manager.getLevel('write_file')).toBe('cautious');
  });
});

// ---------------------------------------------------------------------------
// always_allow — remembers for the session
// ---------------------------------------------------------------------------

describe('always_allow response', () => {
  it('adds tool to autoAllow and skips prompt on subsequent calls', async () => {
    const manager = makeManager();
    const prompt = makePrompt('always_allow');
    manager.setPromptCallback(prompt);

    // First call triggers prompt
    const first = await manager.check('bash');
    expect(first.allowed).toBe(true);
    expect(prompt).toHaveBeenCalledOnce();

    // Second call should skip prompt entirely
    const second = await manager.check('bash');
    expect(second.allowed).toBe(true);
    expect(prompt).toHaveBeenCalledOnce(); // still only called once
  });

  it('autoAllow persists across multiple tool invocations', async () => {
    const manager = makeManager();
    const prompt = makePrompt('always_allow');
    manager.setPromptCallback(prompt);

    await manager.check('bash');
    await manager.check('bash');
    await manager.check('bash');

    expect(prompt).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// always_deny — remembers for the session
// ---------------------------------------------------------------------------

describe('always_deny response', () => {
  it('adds tool to autoDeny and skips prompt on subsequent calls', async () => {
    const manager = makeManager();
    const prompt = makePrompt('always_deny');
    manager.setPromptCallback(prompt);

    // First call triggers prompt
    const first = await manager.check('git_push');
    expect(first.allowed).toBe(false);
    expect(prompt).toHaveBeenCalledOnce();

    // Second call should skip prompt entirely
    const second = await manager.check('git_push');
    expect(second.allowed).toBe(false);
    expect(prompt).toHaveBeenCalledOnce(); // still only called once
  });

  it('always_deny reason mentions session', async () => {
    const manager = makeManager();
    manager.setPromptCallback(makePrompt('always_deny'));

    await manager.check('git_push'); // first call stores deny
    const result = await manager.check('git_push');

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/session/i);
  });
});

// ---------------------------------------------------------------------------
// No callback registered — non-interactive mode
// ---------------------------------------------------------------------------

describe('no callback (non-interactive mode)', () => {
  it('allows dangerous tools without a callback', async () => {
    const manager = makeManager();
    // No setPromptCallback called

    const result = await manager.check('bash');

    expect(result.allowed).toBe(true);
  });

  it('allows cautious tools without a callback', async () => {
    const manager = makeManager();

    const result = await manager.check('write_file');

    expect(result.allowed).toBe(true);
  });

  it('allows safe tools without a callback', async () => {
    const manager = makeManager();

    const result = await manager.check('read_file');

    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Custom rules override defaults
// ---------------------------------------------------------------------------

describe('custom rules', () => {
  it('overrides a tool level via custom rules', async () => {
    const customRules: PermissionRule[] = [
      { toolName: 'read_file', level: 'dangerous', reason: 'Custom: treat reads as dangerous' },
    ];
    const manager = makeManager(customRules);
    const prompt = makePrompt('deny');
    manager.setPromptCallback(prompt);

    const result = await manager.check('read_file');

    expect(result.allowed).toBe(false);
    expect(prompt).toHaveBeenCalledOnce();
  });

  it('does not include default rules when custom rules are supplied', async () => {
    const customRules: PermissionRule[] = [
      { toolName: 'my_tool', level: 'cautious', reason: 'Custom tool' },
    ];
    const manager = makeManager(customRules);
    const prompt = makePrompt('deny');
    manager.setPromptCallback(prompt);

    // bash is in DEFAULT_PERMISSION_RULES but not in customRules → treated as safe
    const result = await manager.check('bash');

    expect(result.allowed).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('getLevel reflects custom rule', () => {
    const customRules: PermissionRule[] = [
      { toolName: 'special_tool', level: 'dangerous', reason: 'Very risky' },
    ];
    const manager = makeManager(customRules);
    expect(manager.getLevel('special_tool')).toBe('dangerous');
  });
});

// ---------------------------------------------------------------------------
// reset()
// ---------------------------------------------------------------------------

describe('reset()', () => {
  it('clears autoAllow so the tool prompts again', async () => {
    const manager = makeManager();
    const prompt = vi.fn()
      .mockResolvedValueOnce('always_allow' as PermissionResponse)
      .mockResolvedValueOnce('deny' as PermissionResponse);
    manager.setPromptCallback(prompt);

    await manager.check('bash'); // always_allow → cached
    manager.reset();

    const result = await manager.check('bash'); // prompt fires again
    expect(result.allowed).toBe(false);
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it('clears autoDeny so the tool prompts again', async () => {
    const manager = makeManager();
    const prompt = vi.fn()
      .mockResolvedValueOnce('always_deny' as PermissionResponse)
      .mockResolvedValueOnce('allow' as PermissionResponse);
    manager.setPromptCallback(prompt);

    await manager.check('bash'); // always_deny → cached
    manager.reset();

    const result = await manager.check('bash'); // prompt fires again
    expect(result.allowed).toBe(true);
    expect(prompt).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_PERMISSION_RULES sanity checks
// ---------------------------------------------------------------------------

describe('DEFAULT_PERMISSION_RULES', () => {
  it('contains bash as dangerous', () => {
    const rule = DEFAULT_PERMISSION_RULES.find((r) => r.toolName === 'bash');
    expect(rule).toBeDefined();
    expect(rule?.level).toBe('dangerous');
  });

  it('contains write_file as cautious', () => {
    const rule = DEFAULT_PERMISSION_RULES.find((r) => r.toolName === 'write_file');
    expect(rule).toBeDefined();
    expect(rule?.level).toBe('cautious');
  });

  it('contains git_force_push as dangerous', () => {
    const rule = DEFAULT_PERMISSION_RULES.find((r) => r.toolName === 'git_force_push');
    expect(rule).toBeDefined();
    expect(rule?.level).toBe('dangerous');
  });

  it('every rule has a non-empty reason', () => {
    for (const rule of DEFAULT_PERMISSION_RULES) {
      expect(rule.reason.length).toBeGreaterThan(0);
    }
  });
});
