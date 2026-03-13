/**
 * Sandbox Security Configuration
 *
 * Defines security presets per deployment mode.
 * The config specifies WHAT restrictions to apply; enforcement
 * depends on the execution environment (Docker, native, etc.).
 */

import { getMode } from './deployment.js';
import type { DeploymentMode } from './deployment.js';

// Types

export type SandboxSecurityLevel = 'permissive' | 'standard' | 'strict';

export interface SandboxSecurityConfig {
  /** Security level name */
  level: SandboxSecurityLevel;
  /** Allow outbound network access */
  allowNetwork: boolean;
  /** Mount filesystem as read-only outside workspace */
  readOnlyFs: boolean;
  /** Max memory in megabytes (0 = no limit) */
  maxMemoryMb: number;
  /** Max CPU usage as a percentage 0–100 (0 = no limit) */
  maxCpuPercent: number;
  /** Execution timeout in milliseconds */
  timeoutMs: number;
  /**
   * Allowlist of shell command prefixes.
   * Empty array means all commands are allowed.
   * Enforcement is advisory — the execution environment decides.
   */
  allowedCommands: string[];
  /**
   * Paths that must not be mounted or accessed.
   * Enforcement is advisory — the execution environment decides.
   */
  blockedPaths: string[];
}

// Presets per deployment mode

/**
 * pico — single-user, trusted machine.
 * Minimal restrictions; mirrors running directly on the host.
 */
const PERMISSIVE_PRESET: SandboxSecurityConfig = {
  level: 'permissive',
  allowNetwork: true,
  readOnlyFs: false,
  maxMemoryMb: 0,
  maxCpuPercent: 0,
  timeoutMs: parseInt(process.env.SANDBOX_TIMEOUT_MS || '300000', 10),
  allowedCommands: [],
  blockedPaths: [],
};

/**
 * mini — shared or semi-trusted environment.
 * FS outside the workspace is read-only; network off by default.
 */
const STANDARD_PRESET: SandboxSecurityConfig = {
  level: 'standard',
  allowNetwork: false,
  readOnlyFs: true,
  maxMemoryMb: parseInt(process.env.SANDBOX_MAX_MEMORY_MB || '512', 10),
  maxCpuPercent: parseInt(process.env.SANDBOX_MAX_CPU_PERCENT || '80', 10),
  timeoutMs: parseInt(process.env.SANDBOX_TIMEOUT_MS || '120000', 10),
  allowedCommands: [
    'node', 'npm', 'npx', 'pnpm',
    'python', 'python3', 'pip', 'pip3',
    'sh', 'bash',
    'git',
    'ls', 'cat', 'cp', 'mv', 'mkdir', 'rm', 'touch',
    'grep', 'sed', 'awk', 'sort', 'uniq', 'wc',
    'jq', 'curl',
  ],
  blockedPaths: [
    '/etc/shadow',
    '/etc/sudoers',
    '/root',
    '/proc',
    '/sys',
    '/dev',
    '/run/secrets',
  ],
};

/**
 * pro — multi-tenant or public-facing deployment.
 * Full network isolation, tight resource caps.
 * All limits are configurable via env vars.
 */
const STRICT_PRESET: SandboxSecurityConfig = {
  level: 'strict',
  allowNetwork: process.env.SANDBOX_ALLOW_NETWORK === 'true',
  readOnlyFs: true,
  maxMemoryMb: parseInt(process.env.SANDBOX_MAX_MEMORY_MB || '256', 10),
  maxCpuPercent: parseInt(process.env.SANDBOX_MAX_CPU_PERCENT || '50', 10),
  timeoutMs: parseInt(process.env.SANDBOX_TIMEOUT_MS || '60000', 10),
  allowedCommands: [
    'node', 'npm', 'npx',
    'python', 'python3',
    'sh', 'bash',
    'git',
    'ls', 'cat', 'cp', 'mv', 'mkdir', 'rm', 'touch',
    'grep', 'sed', 'awk',
    'jq',
  ],
  blockedPaths: [
    '/etc/shadow',
    '/etc/sudoers',
    '/etc/passwd',
    '/root',
    '/proc',
    '/sys',
    '/dev',
    '/run',
    '/var/run',
    '/tmp',
    '/home',
  ],
};

// Map deployment mode -> default security level
const MODE_SECURITY_LEVEL: Record<DeploymentMode, SandboxSecurityLevel> = {
  pico: 'permissive',
  mini: 'standard',
  pro: 'strict',
};

const LEVEL_PRESETS: Record<SandboxSecurityLevel, SandboxSecurityConfig> = {
  permissive: PERMISSIVE_PRESET,
  standard: STANDARD_PRESET,
  strict: STRICT_PRESET,
};

// Public API

/**
 * Resolve the active sandbox security level.
 *
 * Priority:
 *   1. `PROFCLAW_SANDBOX_LEVEL` env var (explicit override)
 *   2. Default for the current deployment mode
 */
export function getSecurityLevel(): SandboxSecurityLevel {
  const override = process.env.PROFCLAW_SANDBOX_LEVEL?.toLowerCase().trim();
  if (override === 'permissive' || override === 'standard' || override === 'strict') {
    return override;
  }
  return MODE_SECURITY_LEVEL[getMode()];
}

/**
 * Return the full security config for the current deployment mode.
 * Respects `PROFCLAW_SANDBOX_LEVEL` override when set.
 */
export function getSandboxConfig(): SandboxSecurityConfig {
  return LEVEL_PRESETS[getSecurityLevel()];
}

/**
 * Return the security config for a specific level, ignoring env overrides.
 * Useful for introspection and tests.
 */
export function getSandboxConfigForLevel(level: SandboxSecurityLevel): SandboxSecurityConfig {
  return LEVEL_PRESETS[level];
}

/**
 * Convert maxMemoryMb to a Docker-compatible memory limit string.
 * Returns undefined when no limit is configured (0).
 */
export function toDockerMemoryLimit(maxMemoryMb: number): string | undefined {
  if (maxMemoryMb <= 0) return undefined;
  return `${maxMemoryMb}m`;
}

/**
 * Convert maxCpuPercent to a Docker-compatible CPU limit string (fractional cores).
 * Assumes a single-core equivalent at 100%.
 * Returns undefined when no limit is configured (0).
 */
export function toDockerCpuLimit(maxCpuPercent: number): string | undefined {
  if (maxCpuPercent <= 0) return undefined;
  return (maxCpuPercent / 100).toFixed(2);
}
