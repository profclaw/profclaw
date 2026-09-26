/**
 * OS-level confinement for shell commands run by `profclaw run`.
 *
 * Wraps a command so the kernel, not pattern matching, enforces the limits:
 *  - writes only inside the worktree, a per-run temp dir, the git metadata the
 *    worktree needs and a few device nodes (plus opt-in extras)
 *  - reads are broad (node, pnpm, git and tsc need many system paths) but
 *    credential directories such as ~/.ssh and ~/.aws are denied
 *  - network is denied unless PROFCLAW_RUN_ALLOW_NETWORK is set
 *
 * Backends: macOS Seatbelt (`/usr/bin/sandbox-exec`) and Linux `bwrap`.
 * Modes (PROFCLAW_RUN_SANDBOX): `auto` uses a sandbox when available and
 * otherwise falls back to pattern screening with a one-time warning, `on`
 * fails closed, `off` disables.
 *
 * Known limits: a writable git dir can be used to plant state outside the
 * worktree (hooks and config are denied, other refs are not), and a sandboxed
 * process can still read anything not in the deny list.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

export type SandboxMode = 'auto' | 'on' | 'off';
export type SandboxBackend = 'seatbelt' | 'bwrap' | 'none';

export interface SandboxAvailability {
  backend: SandboxBackend;
  /** Absolute path of the sandbox binary */
  binary: string;
}

export interface SandboxOptions {
  workdir: string;
  /** Per-run scratch directory that is writable */
  tempDir: string;
  /** Home directory whose credential dirs are denied (default: os.homedir()) */
  home?: string;
  allowNetwork?: boolean;
  /** Extra writable paths (e.g. the git dir of a linked worktree) */
  extraWritable?: string[];
  /** Paths inside an extraWritable tree that stay read-only (e.g. hooks) */
  extraReadOnly?: string[];
  /** Extra paths whose reads are denied */
  extraDenyRead?: string[];
}

export interface SandboxPlan {
  backend: SandboxBackend;
  file: string;
  args: string[];
  /** Environment overrides the caller must merge in (TMPDIR) */
  env: Record<string, string>;
}

export type DetectFn = () => SandboxAvailability;

/** Home-relative locations holding credentials. Reads are denied. */
export const SENSITIVE_HOME_PATHS = [
  '.ssh',
  '.aws',
  '.config/gh',
  '.gnupg',
  '.netrc',
  '.git-credentials',
  '.kube',
  '.azure',
  '.config/gcloud',
  '.docker/config.json',
  'Library/Keychains',
];

/** Absolute credential locations outside of HOME. */
export const SENSITIVE_ABSOLUTE_PATHS = ['/Library/Keychains', '/private/var/db/dslocal'];

// Environment parsing

export function resolveSandboxMode(env: NodeJS.ProcessEnv = process.env): SandboxMode {
  const raw = (env.PROFCLAW_RUN_SANDBOX ?? 'auto').trim().toLowerCase();
  if (raw === 'on' || raw === 'off' || raw === 'auto') return raw;
  if (raw === '1' || raw === 'true') return 'on';
  if (raw === '0' || raw === 'false') return 'off';
  throw new Error(`Invalid PROFCLAW_RUN_SANDBOX "${raw}" (expected auto, on or off)`);
}

export function resolveAllowNetwork(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.PROFCLAW_RUN_ALLOW_NETWORK ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/** Extra writable paths from PROFCLAW_RUN_SANDBOX_WRITABLE (path-delimiter separated). */
export function resolveExtraWritable(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.PROFCLAW_RUN_SANDBOX_WRITABLE ?? '')
    .split(delimiter)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

// Path handling

/** Resolve symlinks (Seatbelt matches real paths, e.g. /tmp is /private/tmp). */
export function canonicalPath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

/**
 * Quote a path as an SBPL string literal. Backslash and double quote are
 * escaped; control characters cannot be represented safely and are rejected,
 * so a crafted path can never terminate the literal and inject rules.
 */
export function escapeSeatbeltString(value: string): string {
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error('Path contains control characters and cannot be sandboxed');
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function subpath(path: string): string {
  return `(subpath ${escapeSeatbeltString(path)})`;
}

function deniedReadPaths(options: SandboxOptions): string[] {
  const home = canonicalPath(options.home ?? homedir());
  return [
    ...SENSITIVE_HOME_PATHS.map((p) => join(home, p)),
    ...SENSITIVE_ABSOLUTE_PATHS,
    ...(options.extraDenyRead ?? []).map(canonicalPath),
  ];
}

// Seatbelt

/**
 * Build the Seatbelt profile. SBPL applies the last matching rule, so the
 * broad allow comes first and the specific denies and re-allows follow.
 */
export function buildSeatbeltProfile(options: SandboxOptions): string {
  const writable = [options.workdir, options.tempDir, ...(options.extraWritable ?? [])].map(canonicalPath);
  const readOnly = (options.extraReadOnly ?? []).map(canonicalPath);
  const lines: string[] = [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    `(allow file-write* ${writable.map(subpath).join(' ')})`,
    '(allow file-write* (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty") (literal "/dev/dtracehelper"))',
  ];
  if (readOnly.length > 0) lines.push(`(deny file-write* ${readOnly.map(subpath).join(' ')})`);
  lines.push(`(deny file-read* ${deniedReadPaths(options).map(subpath).join(' ')})`);
  if (options.allowNetwork !== true) lines.push('(deny network*)');
  return `${lines.join('\n')}\n`;
}

// bubblewrap

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function buildBwrapArgs(options: SandboxOptions): string[] {
  const workdir = canonicalPath(options.workdir);
  const tempDir = canonicalPath(options.tempDir);
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--die-with-parent', '--new-session'];
  for (const path of [workdir, tempDir, ...(options.extraWritable ?? []).map(canonicalPath)]) {
    args.push('--bind', path, path);
  }
  for (const path of (options.extraReadOnly ?? []).map(canonicalPath)) {
    if (existsSync(path)) args.push('--ro-bind', path, path);
  }
  for (const path of deniedReadPaths(options)) {
    if (!existsSync(path)) continue;
    // Directories are hidden behind an empty tmpfs, files behind /dev/null.
    args.push(...(isDirectory(path) ? ['--tmpfs', path] : ['--ro-bind', '/dev/null', path]));
  }
  if (options.allowNetwork !== true) args.push('--unshare-net');
  args.push('--chdir', workdir);
  return args;
}

// Detection

let cachedAvailability: SandboxAvailability | undefined;

function findOnPath(name: string): string | undefined {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir.length > 0 && existsSync(join(dir, name))) return join(dir, name);
  }
  return undefined;
}

/**
 * Detect a working sandbox. A probe run confirms it functions, since
 * sandbox-exec fails when already inside a sandbox and bwrap can be blocked
 * by unprivileged user namespace policy.
 */
export function detectSandbox(): SandboxAvailability {
  if (cachedAvailability) return cachedAvailability;
  let found: SandboxAvailability = { backend: 'none', binary: '' };
  if (process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec')) {
    const probe = spawnSync('/usr/bin/sandbox-exec', ['-p', '(version 1)(allow default)', '/usr/bin/true']);
    if (probe.status === 0) found = { backend: 'seatbelt', binary: '/usr/bin/sandbox-exec' };
  } else if (process.platform === 'linux') {
    const bwrap = findOnPath('bwrap');
    if (bwrap) {
      const probe = spawnSync(bwrap, ['--ro-bind', '/', '/', '--unshare-net', 'true']);
      if (probe.status === 0) found = { backend: 'bwrap', binary: bwrap };
    }
  }
  cachedAvailability = found;
  return found;
}

// Planning

let warned = false;

/** Test hook: allow the one-time warning to fire again. */
export function resetSandboxWarning(): void {
  warned = false;
}

/** One-line description for CLI output. */
export function describeSandbox(
  mode: SandboxMode,
  detect: DetectFn = detectSandbox,
  allowNetwork: boolean = resolveAllowNetwork(),
): string {
  if (mode === 'off') return 'Sandbox: off (pattern screening only)';
  const { backend } = detect();
  if (backend === 'none') {
    return mode === 'on'
      ? 'Sandbox: required but unavailable, bash commands will fail'
      : 'Sandbox: unavailable, bash commands are pattern screened only';
  }
  return `Sandbox: ${mode} (${backend}, network ${allowNetwork ? 'allowed' : 'denied'})`;
}

export interface PlanOptions {
  mode?: SandboxMode;
  detect?: DetectFn;
  /** Receives the one-time fallback warning (default: stderr) */
  warn?: (message: string) => void;
  shell?: string;
}

/**
 * Turn a shell command into the process to spawn. Throws in `on` mode when no
 * sandbox is available. In `auto` mode falls back to the plain shell and warns once.
 */
export function planSandboxedCommand(command: string, options: SandboxOptions, plan: PlanOptions = {}): SandboxPlan {
  const mode = plan.mode ?? resolveSandboxMode();
  const shell = plan.shell ?? '/bin/sh';
  const plain: SandboxPlan = { backend: 'none', file: shell, args: ['-c', command], env: {} };
  if (mode === 'off') return plain;

  const available = (plan.detect ?? detectSandbox)();
  if (available.backend === 'none') {
    if (mode === 'on') {
      throw new Error('PROFCLAW_RUN_SANDBOX=on but no sandbox is available (need sandbox-exec on macOS or bwrap on Linux)');
    }
    if (!warned) {
      warned = true;
      const message =
        '[profclaw] No OS sandbox available, shell commands are only pattern screened (set PROFCLAW_RUN_SANDBOX=on to require one).\n';
      if (plan.warn) plan.warn(message);
      else process.stderr.write(message);
    }
    return plain;
  }

  const env = { TMPDIR: canonicalPath(options.tempDir) };
  if (available.backend === 'seatbelt') {
    return {
      backend: 'seatbelt',
      file: available.binary,
      args: ['-p', buildSeatbeltProfile(options), shell, '-c', command],
      env,
    };
  }
  return { backend: 'bwrap', file: available.binary, args: [...buildBwrapArgs(options), shell, '-c', command], env };
}
