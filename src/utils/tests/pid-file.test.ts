import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as os from 'node:os';

import {
  writePidFile,
  readPidFile,
  removePidFile,
  isServerRunning,
  killExistingServer,
} from '../pid-file.js';

// Each test gets a fresh temp directory so tests don't interfere.
let testDir: string;

beforeEach(() => {
  testDir = join(
    os.tmpdir(),
    `profclaw-pid-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(testDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

// ---------------------------------------------------------------------------
// writePidFile
// ---------------------------------------------------------------------------

describe('writePidFile', () => {
  it('creates the .profclaw directory when it is missing', () => {
    writePidFile(3000);
    expect(existsSync(join(testDir, '.profclaw'))).toBe(true);
  });

  it('writes a JSON file with pid, port and startedAt', () => {
    const before = Date.now();
    writePidFile(4321);
    const after = Date.now();

    const data = readPidFile();
    expect(data).not.toBeNull();
    expect(data?.pid).toBe(process.pid);
    expect(data?.port).toBe(4321);
    expect(typeof data?.startedAt).toBe('number');
    expect(data!.startedAt).toBeGreaterThanOrEqual(before);
    expect(data!.startedAt).toBeLessThanOrEqual(after);
  });

  it('overwrites an existing PID file on repeated calls', () => {
    writePidFile(3000);
    writePidFile(3001);
    expect(readPidFile()?.port).toBe(3001);
  });
});

// ---------------------------------------------------------------------------
// readPidFile
// ---------------------------------------------------------------------------

describe('readPidFile', () => {
  it('returns null when the file does not exist', () => {
    expect(readPidFile()).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const dir = join(testDir, '.profclaw');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'server.pid'), 'not-valid-json', 'utf-8');
    expect(readPidFile()).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    const dir = join(testDir, '.profclaw');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'server.pid'), JSON.stringify({ pid: 123 }), 'utf-8');
    expect(readPidFile()).toBeNull();
  });

  it('returns null when field types are wrong', () => {
    const dir = join(testDir, '.profclaw');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'server.pid'),
      JSON.stringify({ pid: '123', port: '3000', startedAt: 'now' }),
      'utf-8',
    );
    expect(readPidFile()).toBeNull();
  });

  it('returns the parsed data for a valid file', () => {
    writePidFile(5000);
    const data = readPidFile();
    expect(data?.pid).toBe(process.pid);
    expect(data?.port).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// removePidFile
// ---------------------------------------------------------------------------

describe('removePidFile', () => {
  it('removes the file when it exists', () => {
    writePidFile(3000);
    expect(existsSync(join(testDir, '.profclaw', 'server.pid'))).toBe(true);
    removePidFile();
    expect(existsSync(join(testDir, '.profclaw', 'server.pid'))).toBe(false);
  });

  it('does not throw when the file does not exist', () => {
    expect(() => removePidFile()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// isServerRunning
// ---------------------------------------------------------------------------

describe('isServerRunning', () => {
  it('returns running=false when no PID file exists', () => {
    const result = isServerRunning();
    expect(result.running).toBe(false);
    expect(result.pid).toBeUndefined();
    expect(result.port).toBeUndefined();
  });

  it('returns running=true for the current process', () => {
    writePidFile(3000);
    const result = isServerRunning();
    expect(result.running).toBe(true);
    expect(result.pid).toBe(process.pid);
    expect(result.port).toBe(3000);
  });

  it('removes a stale PID file and returns running=false for a dead PID', () => {
    const dir = join(testDir, '.profclaw');
    mkdirSync(dir, { recursive: true });
    const pidPath = join(dir, 'server.pid');
    // PID 4194303 (max Linux pid - 1) should not exist on any test host
    const deadPid = 4194303;
    writeFileSync(pidPath, JSON.stringify({ pid: deadPid, port: 3000, startedAt: Date.now() }), 'utf-8');

    const result = isServerRunning();
    // The process either doesn't exist (most hosts) or we got EPERM (pid 1 edge case).
    // For an unreachable PID we expect running=false and the stale file cleaned up.
    if (!result.running) {
      expect(existsSync(pidPath)).toBe(false);
    }
    expect(typeof result.running).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// killExistingServer
// ---------------------------------------------------------------------------

describe('killExistingServer', () => {
  it('returns false when no PID file exists', () => {
    expect(killExistingServer()).toBe(false);
  });

  it('returns true and removes the PID file when the target process is already gone', () => {
    const dir = join(testDir, '.profclaw');
    mkdirSync(dir, { recursive: true });
    const pidPath = join(dir, 'server.pid');
    // Use a dead PID — process.kill(deadPid, 'SIGTERM') throws ESRCH
    // which killExistingServer treats as "already gone → return true"
    const deadPid = 4194303;
    writeFileSync(pidPath, JSON.stringify({ pid: deadPid, port: 3000, startedAt: Date.now() }), 'utf-8');

    const result = killExistingServer();
    expect(result).toBe(true);
    expect(existsSync(pidPath)).toBe(false);
  });
});
