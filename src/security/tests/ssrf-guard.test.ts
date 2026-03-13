import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SsrfGuard } from '../ssrf-guard.js';

// Mock dns.promises.resolve4
vi.mock('dns', () => ({
  promises: {
    resolve4: vi.fn(),
  },
}));

import { promises as dns } from 'dns';
const mockResolve4 = vi.mocked(dns.resolve4);

describe('SsrfGuard', () => {
  let guard: SsrfGuard;

  beforeEach(() => {
    guard = new SsrfGuard();
    vi.clearAllMocks();
  });

  describe('URL scheme validation', () => {
    it('allows http URLs', async () => {
      mockResolve4.mockResolvedValue(['93.184.216.34']);
      const result = await guard.validateUrl('http://example.com');
      expect(result.allowed).toBe(true);
    });

    it('allows https URLs', async () => {
      mockResolve4.mockResolvedValue(['93.184.216.34']);
      const result = await guard.validateUrl('https://example.com');
      expect(result.allowed).toBe(true);
    });

    it('blocks file:// URLs', async () => {
      const result = await guard.validateUrl('file:///etc/passwd');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Blocked URL scheme');
    });

    it('blocks ftp:// URLs', async () => {
      const result = await guard.validateUrl('ftp://evil.com/file');
      expect(result.allowed).toBe(false);
    });

    it('blocks gopher:// URLs', async () => {
      const result = await guard.validateUrl('gopher://evil.com');
      expect(result.allowed).toBe(false);
    });

    it('rejects invalid URLs', async () => {
      const result = await guard.validateUrl('not-a-url');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Invalid URL');
    });
  });

  describe('private IP blocking', () => {
    it('blocks loopback (127.0.0.1)', () => {
      const result = guard.checkIp('127.0.0.1');
      expect(result.allowed).toBe(false);
    });

    it('blocks 10.x.x.x range', () => {
      const result = guard.checkIp('10.0.0.1');
      expect(result.allowed).toBe(false);
    });

    it('blocks 172.16.x.x range', () => {
      const result = guard.checkIp('172.16.0.1');
      expect(result.allowed).toBe(false);
    });

    it('blocks 192.168.x.x range', () => {
      const result = guard.checkIp('192.168.1.1');
      expect(result.allowed).toBe(false);
    });

    it('blocks link-local (169.254.x.x)', () => {
      const result = guard.checkIp('169.254.169.254');
      expect(result.allowed).toBe(false);
    });

    it('allows public IPs', () => {
      const result = guard.checkIp('8.8.8.8');
      expect(result.allowed).toBe(true);
    });

    it('allows other public IPs', () => {
      const result = guard.checkIp('93.184.216.34');
      expect(result.allowed).toBe(true);
    });

    it('blocks IPv6 loopback', () => {
      const result = guard.checkIp('::1');
      expect(result.allowed).toBe(false);
    });

    it('blocks IPv6 link-local', () => {
      const result = guard.checkIp('fe80::1');
      expect(result.allowed).toBe(false);
    });

    it('blocks IPv6 unique-local', () => {
      const result = guard.checkIp('fc00::1');
      expect(result.allowed).toBe(false);
    });
  });

  describe('cloud metadata blocking', () => {
    it('blocks AWS metadata endpoint', async () => {
      const result = await guard.validateUrl('http://169.254.169.254/latest/meta-data/');
      expect(result.allowed).toBe(false);
      expect(result.risk).toBe('CRITICAL');
    });

    it('blocks GCP metadata endpoint', async () => {
      mockResolve4.mockResolvedValue(['169.254.169.254']);
      const result = await guard.validateUrl('http://metadata.google.internal/');
      expect(result.allowed).toBe(false);
    });
  });

  describe('DNS rebinding defense', () => {
    it('blocks hostname resolving to private IP', async () => {
      mockResolve4.mockResolvedValue(['10.0.0.1']);
      const result = await guard.validateUrl('http://evil.com/attack');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked IP');
    });

    it('blocks if any resolved IP is private', async () => {
      mockResolve4.mockResolvedValue(['93.184.216.34', '10.0.0.1']);
      const result = await guard.validateUrl('http://dual-stack.com');
      expect(result.allowed).toBe(false);
    });

    it('allows hostname resolving to public IP', async () => {
      mockResolve4.mockResolvedValue(['93.184.216.34']);
      const result = await guard.validateUrl('http://example.com');
      expect(result.allowed).toBe(true);
    });

    it('blocks on DNS resolution failure', async () => {
      mockResolve4.mockRejectedValue(new Error('NXDOMAIN'));
      const result = await guard.validateUrl('http://nonexistent.invalid');
      expect(result.allowed).toBe(false);
    });

    it('blocks when DNS returns empty', async () => {
      mockResolve4.mockResolvedValue([]);
      const result = await guard.validateUrl('http://empty-dns.com');
      expect(result.allowed).toBe(false);
    });
  });

  describe('redirect validation', () => {
    it('allows redirects within limit', async () => {
      mockResolve4.mockResolvedValue(['93.184.216.34']);
      const result = await guard.validateRedirect('http://example.com', 3);
      expect(result.allowed).toBe(true);
    });

    it('blocks too many redirects', async () => {
      const result = await guard.validateRedirect('http://example.com', 5);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Too many redirects');
    });
  });

  describe('host allowlist', () => {
    it('allows explicitly permitted hosts', async () => {
      const allowedGuard = new SsrfGuard({ allowedHosts: ['internal.company.com'] });
      mockResolve4.mockResolvedValue(['10.0.0.1']);
      const result = await allowedGuard.validateUrl('http://internal.company.com/api');
      expect(result.allowed).toBe(true);
    });
  });

  describe('disabled guard', () => {
    it('allows everything when disabled', async () => {
      const disabled = new SsrfGuard({ enabled: false });
      const result = await disabled.validateUrl('file:///etc/passwd');
      expect(result.allowed).toBe(true);
    });
  });
});
