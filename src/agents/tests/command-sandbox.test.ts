import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildBwrapArgs,
  buildSeatbeltProfile,
  describeSandbox,
  detectSandbox,
  escapeSeatbeltString,
  planSandboxedCommand,
  resetSandboxWarning,
  resolveAllowNetwork,
  resolveSandboxMode,
} from '../command-sandbox.js';
import type { SandboxAvailability, SandboxOptions } from '../command-sandbox.js';

const none = (): SandboxAvailability => ({ backend: 'none', binary: '' });
const fakeSeatbelt = (): SandboxAvailability => ({ backend: 'seatbelt', binary: '/usr/bin/sandbox-exec' });

function baseOptions(overrides: Partial<SandboxOptions> = {}): SandboxOptions {
  return { workdir: '/work/tree', tempDir: '/work/tmp', home: '/home/u', ...overrides };
}

describe('escapeSeatbeltString', () => {
  it('quotes plain paths', () => {
    expect(escapeSeatbeltString('/a/b')).toBe('"/a/b"');
  });

  it('escapes quotes and backslashes so a path cannot close the literal', () => {
    const evil = '/tmp/x") (allow file-read* (subpath "/';
    const out = escapeSeatbeltString(evil);
    expect(out).toBe('"/tmp/x\\") (allow file-read* (subpath \\"/"');
    // Every interior quote is preceded by a backslash
    expect(out.slice(1, -1).replace(/\\\\/g, '').match(/(?<!\\)"/g)).toBeNull();
    expect(escapeSeatbeltString('a\\b')).toBe('"a\\\\b"');
  });

  it('rejects control characters', () => {
    expect(() => escapeSeatbeltString('/a\n(allow default)')).toThrow(/control/);
    expect(() => escapeSeatbeltString('/a\0b')).toThrow(/control/);
  });
});

describe('buildSeatbeltProfile', () => {
  it('allows writes only to the worktree, temp dir and extras', () => {
    const profile = buildSeatbeltProfile(baseOptions({ extraWritable: ['/repo/.git'], extraReadOnly: ['/repo/.git/hooks'] }));
    expect(profile).toContain('(deny file-write*)');
    expect(profile).toContain('(allow file-write* (subpath "/work/tree") (subpath "/work/tmp") (subpath "/repo/.git"))');
    expect(profile).toContain('(deny file-write* (subpath "/repo/.git/hooks"))');
    expect(profile.indexOf('(deny file-write*)')).toBeLessThan(profile.indexOf('(allow file-write* (subpath'));
  });

  it('denies sensitive home dirs and keychains for reads', () => {
    const profile = buildSeatbeltProfile(baseOptions());
    for (const p of ['/home/u/.ssh', '/home/u/.aws', '/home/u/.config/gh', '/home/u/.gnupg', '/home/u/Library/Keychains', '/Library/Keychains']) {
      expect(profile).toContain(`(subpath "${p}")`);
    }
    expect(profile).toMatch(/\(deny file-read\* /);
  });

  it('denies network unless allowed', () => {
    expect(buildSeatbeltProfile(baseOptions())).toContain('(deny network*)');
    expect(buildSeatbeltProfile(baseOptions({ allowNetwork: true }))).not.toContain('network');
  });

  it('cannot be injected through a hostile path', () => {
    const profile = buildSeatbeltProfile(baseOptions({ workdir: '/x") (allow network*) ("' }));
    expect(profile).not.toMatch(/^\(allow network\*\)/m);
    expect(profile.split('\n').every((l) => l === '' || l.startsWith('('))).toBe(true);
    expect(() => buildSeatbeltProfile(baseOptions({ workdir: '/x\n(allow default)' }))).toThrow();
  });
});

describe('buildBwrapArgs', () => {
  it('binds writable paths, unshares the network and sets cwd', () => {
    const args = buildBwrapArgs(baseOptions());
    expect(args.slice(0, 3)).toEqual(['--ro-bind', '/', '/']);
    expect(args).toContain('--unshare-net');
    expect(args.join(' ')).toContain('--bind /work/tree /work/tree');
    expect(args.slice(-2)).toEqual(['--chdir', '/work/tree']);
    expect(buildBwrapArgs(baseOptions({ allowNetwork: true }))).not.toContain('--unshare-net');
  });
});

describe('environment parsing', () => {
  it('defaults to auto and rejects junk', () => {
    expect(resolveSandboxMode({})).toBe('auto');
    expect(resolveSandboxMode({ PROFCLAW_RUN_SANDBOX: 'ON' })).toBe('on');
    expect(resolveSandboxMode({ PROFCLAW_RUN_SANDBOX: 'off' })).toBe('off');
    expect(() => resolveSandboxMode({ PROFCLAW_RUN_SANDBOX: 'maybe' })).toThrow();
  });

  it('network is off by default', () => {
    expect(resolveAllowNetwork({})).toBe(false);
    expect(resolveAllowNetwork({ PROFCLAW_RUN_ALLOW_NETWORK: '1' })).toBe(true);
  });
});

describe('planSandboxedCommand modes', () => {
  beforeEach(() => resetSandboxWarning());

  it('on fails closed when no sandbox is available', () => {
    expect(() => planSandboxedCommand('echo hi', baseOptions(), { mode: 'on', detect: none })).toThrow(/no sandbox is available/);
  });

  it('auto falls back to the plain shell and warns exactly once', () => {
    const warnings: string[] = [];
    const warn = (m: string): void => void warnings.push(m);
    const a = planSandboxedCommand('echo hi', baseOptions(), { mode: 'auto', detect: none, warn });
    const b = planSandboxedCommand('echo hi', baseOptions(), { mode: 'auto', detect: none, warn });
    expect(a).toMatchObject({ backend: 'none', file: '/bin/sh', args: ['-c', 'echo hi'] });
    expect(b.backend).toBe('none');
    expect(warnings).toHaveLength(1);
  });

  it('off never sandboxes or warns', () => {
    const warnings: string[] = [];
    const plan = planSandboxedCommand('x', baseOptions(), { mode: 'off', detect: fakeSeatbelt, warn: (m) => void warnings.push(m) });
    expect(plan.backend).toBe('none');
    expect(warnings).toHaveLength(0);
  });

  it('wraps with sandbox-exec when available', () => {
    const plan = planSandboxedCommand('echo hi', baseOptions(), { mode: 'auto', detect: fakeSeatbelt });
    expect(plan.file).toBe('/usr/bin/sandbox-exec');
    expect(plan.args.slice(0, 1)).toEqual(['-p']);
    expect(plan.args.slice(-3)).toEqual(['/bin/sh', '-c', 'echo hi']);
    expect(plan.env.TMPDIR).toBe('/work/tmp');
  });

  it('describes the active mode', () => {
    expect(describeSandbox('off', none, false)).toMatch(/off/);
    expect(describeSandbox('auto', fakeSeatbelt, false)).toBe('Sandbox: auto (seatbelt, network denied)');
    expect(describeSandbox('on', none, false)).toMatch(/required but unavailable/);
  });
});

// Integration (real kernel sandbox)

const backend = detectSandbox().backend;
const hasSeatbelt = backend === 'seatbelt';

function runPlanned(command: string, options: SandboxOptions): Promise<{ code: number; out: string }> {
  const plan = planSandboxedCommand(command, options, { mode: 'on' });
  return new Promise((resolve) => {
    execFile(plan.file, plan.args, { cwd: options.workdir, env: { ...process.env, ...plan.env }, timeout: 20_000 }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      resolve({ code, out: `${stdout}${stderr}` });
    });
  });
}

describe.skipIf(!hasSeatbelt)('sandbox-exec integration', () => {
  let root: string;
  let workdir: string;
  let tempDir: string;
  let outside: string;
  let home: string;
  let opts: SandboxOptions;

  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'profclaw-sbx-')));
    workdir = join(root, 'work');
    tempDir = join(root, 'scratch');
    outside = join(root, 'outside');
    home = join(root, 'home');
    for (const d of [workdir, tempDir, outside, join(home, '.ssh')]) mkdirSync(d, { recursive: true });
    writeFileSync(join(home, '.ssh', 'id_fake'), 'FAKE-PRIVATE-KEY');
    writeFileSync(join(workdir, 'readable.txt'), 'hello');
    opts = { workdir, tempDir, home };
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('allows writing inside the worktree and temp dir, and reading it', async () => {
    const r = await runPlanned(`echo ok > inside.txt && echo t > "${tempDir}/t.txt" && cat readable.txt`, opts);
    expect(r.code).toBe(0);
    expect(readFileSync(join(workdir, 'inside.txt'), 'utf-8').trim()).toBe('ok');
    expect(existsSync(join(tempDir, 't.txt'))).toBe(true);
  });

  it('blocks writing outside the worktree', async () => {
    const target = join(outside, 'escape.txt');
    const r = await runPlanned(`echo pwn > "${target}"`, opts);
    expect(r.code).not.toBe(0);
    expect(existsSync(target)).toBe(false);
  });

  it('blocks reading a denied credential dir', async () => {
    const r = await runPlanned(`cat "${join(home, '.ssh', 'id_fake')}"`, opts);
    expect(r.code).not.toBe(0);
    expect(r.out).not.toContain('FAKE-PRIVATE-KEY');
  });

  it('still runs system tools (node, git)', async () => {
    const r = await runPlanned(`"${process.execPath}" -e "console.log(21*2)" && git --version`, opts);
    expect(r.code).toBe(0);
    expect(r.out).toContain('42');
  });

  it('denies network by default and allows it when opted in', async () => {
    const server = createServer((_req, res) => res.end('pong'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    try {
      const denied = await runPlanned(`/usr/bin/curl -sS -m 5 ${url}`, opts);
      expect(denied.code).not.toBe(0);
      expect(denied.out).not.toContain('pong');
      const allowed = await runPlanned(`/usr/bin/curl -sS -m 5 ${url}`, { ...opts, allowNetwork: true });
      expect(allowed.out).toContain('pong');
    } finally {
      server.close();
    }
  });
});
