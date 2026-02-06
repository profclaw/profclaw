import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FsGuard } from '../fs-guard.js';
import os from 'os';
import path from 'path';

// Mock fs.realpath
vi.mock('fs/promises', () => ({
  default: {
    realpath: vi.fn(),
  },
}));

import fs from 'fs/promises';
const mockRealpath = vi.mocked(fs.realpath);

describe('FsGuard', () => {
  let guard: FsGuard;

  beforeEach(() => {
    guard = new FsGuard({
      allowedPaths: ['/project', '/tmp'],
    });
    vi.clearAllMocks();
    // Default: file doesn't exist (no symlink resolution needed)
    mockRealpath.mockRejectedValue(new Error('ENOENT'));
  });

  describe('validatePath()', () => {
    it('allows access to files in allowed paths', async () => {
      const result = await guard.validatePath('/project/src/index.ts', 'read');
      expect(result.allowed).toBe(true);
    });

    it('allows reading from temp directory', async () => {
      const result = await guard.validatePath('/tmp/output.log', 'read');
      expect(result.allowed).toBe(true);
    });

    it('blocks /etc/passwd', async () => {
      const result = await guard.validatePath('/etc/passwd', 'read');
      expect(result.allowed).toBe(false);
      expect(result.risk).toBe('HIGH');
    });

    it('blocks /etc/shadow', async () => {
      const result = await guard.validatePath('/etc/shadow', 'read');
      expect(result.allowed).toBe(false);
    });

    it('blocks SSH directory', async () => {
      const sshPath = path.join(os.homedir(), '.ssh', 'id_rsa');
      const result = await guard.validatePath(sshPath, 'read');
      expect(result.allowed).toBe(false);
    });

    it('blocks .env files by pattern', async () => {
      const result = await guard.validatePath('/project/.env', 'read');
      expect(result.allowed).toBe(false);
    });

    it('blocks .env.local files', async () => {
      const result = await guard.validatePath('/project/.env.local', 'read');
      expect(result.allowed).toBe(false);
    });

    it('blocks .env.production files', async () => {
      const result = await guard.validatePath('/project/.env.production', 'read');
      expect(result.allowed).toBe(false);
    });

    it('blocks credentials.json', async () => {
      const result = await guard.validatePath('/project/credentials.json', 'read');
      expect(result.allowed).toBe(false);
    });

    it('blocks /proc access', async () => {
      const result = await guard.validatePath('/proc/self/environ', 'read');
      expect(result.allowed).toBe(false);
    });

    it('blocks /sys access', async () => {
      const result = await guard.validatePath('/sys/kernel/version', 'read');
      expect(result.allowed).toBe(false);
    });
  });

  describe('path traversal', () => {
    it('normalizes ../ traversal', async () => {
      // /project/src/../../etc/passwd normalizes to /etc/passwd
      const result = await guard.validatePath('/project/src/../../etc/passwd', 'read');
      expect(result.allowed).toBe(false);
    });

    it('normalizes redundant separators', async () => {
      const result = await guard.validatePath('/etc///passwd', 'read');
      expect(result.allowed).toBe(false);
    });
  });

  describe('symlink resolution', () => {
    it('blocks symlinks pointing to blocked paths', async () => {
      mockRealpath.mockResolvedValue('/etc/shadow');
      const result = await guard.validatePath('/project/link-to-shadow', 'read');
      expect(result.allowed).toBe(false);
      expect(result.risk).toBe('CRITICAL');
    });

    it('allows symlinks pointing to allowed paths', async () => {
      mockRealpath.mockResolvedValue('/project/src/real-file.ts');
      const result = await guard.validatePath('/project/link-to-src', 'read');
      expect(result.allowed).toBe(true);
    });
  });

  describe('write restrictions', () => {
    it('blocks write outside allowed paths', async () => {
      const result = await guard.validatePath('/var/log/secret.log', 'write');
      expect(result.allowed).toBe(false);
    });

    it('allows write inside allowed paths', async () => {
      const result = await guard.validatePath('/project/output.txt', 'write');
      expect(result.allowed).toBe(true);
    });

    it('blocks delete outside allowed paths', async () => {
      const result = await guard.validatePath('/usr/bin/something', 'delete');
      expect(result.allowed).toBe(false);
    });
  });

  describe('isInAllowedPath()', () => {
    it('returns true for allowed paths', () => {
      expect(guard.isInAllowedPath('/project/src/file.ts')).toBe(true);
    });

    it('returns false for paths outside allowed', () => {
      expect(guard.isInAllowedPath('/etc/passwd')).toBe(false);
    });

    it('returns true for exact allowed path', () => {
      expect(guard.isInAllowedPath('/project')).toBe(true);
    });
  });

  describe('disabled guard', () => {
    it('allows everything when disabled', async () => {
      const disabled = new FsGuard({ enabled: false });
      const result = await disabled.validatePath('/etc/shadow', 'read');
      expect(result.allowed).toBe(true);
    });
  });
});
