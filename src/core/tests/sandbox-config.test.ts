/**
 * Tests for Sandbox Security Configuration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock deployment module before importing sandbox-config
vi.mock('../deployment.js', () => ({
  getMode: vi.fn(() => 'mini'),
}));

describe('Sandbox Security Config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('exports getSandboxConfig function', async () => {
    const mod = await import('../sandbox-config.js');
    expect(typeof mod.getSandboxConfig).toBe('function');
  });

  it('exports getSecurityLevel function', async () => {
    const mod = await import('../sandbox-config.js');
    expect(typeof mod.getSecurityLevel).toBe('function');
  });

  it('exports getSandboxConfigForLevel function', async () => {
    const mod = await import('../sandbox-config.js');
    expect(typeof mod.getSandboxConfigForLevel).toBe('function');
  });

  it('returns permissive config for pico mode', async () => {
    const { getMode } = await import('../deployment.js');
    vi.mocked(getMode).mockReturnValue('pico');

    const mod = await import('../sandbox-config.js');
    const config = mod.getSandboxConfig();
    expect(config.level).toBe('permissive');
    expect(config.allowNetwork).toBe(true);
  });

  it('returns standard config for mini mode', async () => {
    const { getMode } = await import('../deployment.js');
    vi.mocked(getMode).mockReturnValue('mini');

    const mod = await import('../sandbox-config.js');
    const config = mod.getSandboxConfig();
    expect(config.level).toBe('standard');
  });

  it('returns strict config for pro mode', async () => {
    const { getMode } = await import('../deployment.js');
    vi.mocked(getMode).mockReturnValue('pro');

    const mod = await import('../sandbox-config.js');
    const config = mod.getSandboxConfig();
    expect(config.level).toBe('strict');
    expect(config.allowNetwork).toBe(false);
  });

  it('respects PROFCLAW_SANDBOX_LEVEL env override', async () => {
    process.env.PROFCLAW_SANDBOX_LEVEL = 'permissive';
    const { getMode } = await import('../deployment.js');
    vi.mocked(getMode).mockReturnValue('pro');

    const mod = await import('../sandbox-config.js');
    const level = mod.getSecurityLevel();
    expect(level).toBe('permissive');
  });

  it('getSandboxConfigForLevel returns correct preset', async () => {
    const mod = await import('../sandbox-config.js');

    const permissive = mod.getSandboxConfigForLevel('permissive');
    expect(permissive.level).toBe('permissive');

    const strict = mod.getSandboxConfigForLevel('strict');
    expect(strict.level).toBe('strict');
  });

  it('toDockerMemoryLimit converts MB to Docker format', async () => {
    const mod = await import('../sandbox-config.js');
    expect(mod.toDockerMemoryLimit(256)).toBe('256m');
    expect(mod.toDockerMemoryLimit(0)).toBeUndefined();
  });

  it('toDockerCpuLimit converts percentage to Docker format', async () => {
    const mod = await import('../sandbox-config.js');
    expect(mod.toDockerCpuLimit(50)).toBe('0.50');
    expect(mod.toDockerCpuLimit(0)).toBeUndefined();
  });
});
