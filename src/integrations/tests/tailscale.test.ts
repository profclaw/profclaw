/**
 * Tailscale Integration Tests
 *
 * Tests for TailscaleService in src/integrations/tailscale.ts.
 * Mocks node:child_process.execFile to avoid real CLI calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock child_process before importing module under test
// ---------------------------------------------------------------------------

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: (fn: unknown) => fn,
}));

// ---------------------------------------------------------------------------
// Import mocks and module under test
// ---------------------------------------------------------------------------

import { execFile } from 'node:child_process';
import { TailscaleService } from '../tailscale.js';

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

// Helper: resolve execFile with a given stdout
function mockExecResolve(stdout: string): void {
  mockExecFile.mockResolvedValue({ stdout, stderr: '' });
}

function mockExecReject(message: string): void {
  mockExecFile.mockRejectedValue(new Error(message));
}

// Helper: resolve specific call index
function mockExecSequence(responses: Array<{ stdout?: string; error?: string }>): void {
  let idx = 0;
  mockExecFile.mockImplementation(() => {
    const resp = responses[idx] ?? responses[responses.length - 1];
    idx++;
    if (resp.error !== undefined) {
      return Promise.reject(new Error(resp.error));
    }
    return Promise.resolve({ stdout: resp.stdout ?? '', stderr: '' });
  });
}

// Tailscale status JSON fixture
const TAILSCALE_STATUS_JSON = JSON.stringify({
  BackendState: 'Running',
  Self: {
    HostName: 'my-host',
    DNSName: 'my-host.tailnet.ts.net',
    TailscaleIPs: ['100.64.0.1', 'fd7a::1'],
    OS: 'linux',
  },
  CurrentTailnet: {
    Name: 'tailnet.ts.net',
  },
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TailscaleService', () => {
  let service: TailscaleService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TailscaleService();
  });

  // -------------------------------------------------------------------------
  // getStatus()
  // -------------------------------------------------------------------------

  describe('getStatus()', () => {
    it('returns installed: false when tailscale binary is not found', async () => {
      mockExecReject('command not found');

      const status = await service.getStatus();

      expect(status.installed).toBe(false);
      expect(status.running).toBe(false);
      expect(status.loggedIn).toBe(false);
    });

    it('parses tailscale version and status output', async () => {
      mockExecSequence([
        { stdout: '1.56.0\ncommit: abc123' }, // tailscale version
        { stdout: TAILSCALE_STATUS_JSON },       // tailscale status --json
      ]);

      const status = await service.getStatus();

      expect(status.installed).toBe(true);
      expect(status.version).toBe('1.56.0');
      expect(status.running).toBe(true);
      expect(status.loggedIn).toBe(true);
      expect(status.hostname).toBe('my-host');
      expect(status.tailnetName).toBe('tailnet.ts.net');
    });

    it('extracts IPv4 and IPv6 addresses separately', async () => {
      mockExecSequence([
        { stdout: '1.56.0' },
        { stdout: TAILSCALE_STATUS_JSON },
      ]);

      const status = await service.getStatus();

      expect(status.ipv4).toBe('100.64.0.1');
      expect(status.ipv6).toBe('fd7a::1');
    });

    it('marks running: false when BackendState is not Running', async () => {
      const stoppedStatus = JSON.stringify({
        BackendState: 'Stopped',
        Self: null,
        CurrentTailnet: null,
      });

      mockExecSequence([
        { stdout: '1.56.0' },
        { stdout: stoppedStatus },
      ]);

      const status = await service.getStatus();

      expect(status.installed).toBe(true);
      expect(status.running).toBe(false);
    });

    it('handles status JSON parse failure gracefully', async () => {
      mockExecSequence([
        { stdout: '1.56.0' },  // version OK
        { error: 'daemon not running' }, // status fails
      ]);

      const status = await service.getStatus();

      expect(status.installed).toBe(true);
      expect(status.running).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // startServe()
  // -------------------------------------------------------------------------

  describe('startServe()', () => {
    it('returns error when tailscale is not installed', async () => {
      // getStatus() falls back to installed: false
      mockExecReject('not found');

      const result = await service.startServe({ port: 3000, protocol: 'http' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not installed');
    });

    it('returns error when tailscale is not running', async () => {
      const notRunningStatus = JSON.stringify({ BackendState: 'Stopped', Self: null, CurrentTailnet: null });
      mockExecSequence([
        { stdout: '1.56.0' },
        { stdout: notRunningStatus },
      ]);

      const result = await service.startServe({ port: 3000, protocol: 'http' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not running');
    });

    it('calls tailscale serve with correct args and returns URL', async () => {
      mockExecSequence([
        { stdout: '1.56.0' },              // version
        { stdout: TAILSCALE_STATUS_JSON }, // status
        { stdout: '' },                    // serve --remove
        { stdout: '' },                    // serve --bg
      ]);

      const result = await service.startServe({ port: 3000, protocol: 'http' });

      expect(result.success).toBe(true);
      expect(result.url).toBeDefined();
      expect(result.url).toContain('https://');

      // Verify the serve --bg call used the right target
      const calls = mockExecFile.mock.calls as [string, string[]][];
      const bgCall = calls.find(([, args]) => args.includes('--bg'));
      expect(bgCall).toBeDefined();
      expect(bgCall![1]).toContain('http://localhost:3000');
    });

    it('respects custom servePort and path', async () => {
      mockExecSequence([
        { stdout: '1.56.0' },
        { stdout: TAILSCALE_STATUS_JSON },
        { stdout: '' },
        { stdout: '' },
      ]);

      const result = await service.startServe({
        port: 8080,
        protocol: 'https',
        servePort: 8443,
        path: '/api',
      });

      expect(result.success).toBe(true);
      expect(result.url).toContain('/api');
    });
  });

  // -------------------------------------------------------------------------
  // startFunnel()
  // -------------------------------------------------------------------------

  describe('startFunnel()', () => {
    it('returns error when not installed', async () => {
      mockExecReject('not found');

      const result = await service.startFunnel({ port: 3000, protocol: 'http' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not installed');
    });

    it('calls tailscale funnel with correct args', async () => {
      mockExecSequence([
        { stdout: '1.56.0' },
        { stdout: TAILSCALE_STATUS_JSON },
        { stdout: '' }, // funnel --bg
      ]);

      const result = await service.startFunnel({ port: 3000, protocol: 'http' });

      expect(result.success).toBe(true);

      const calls = mockExecFile.mock.calls as [string, string[]][];
      const funnelCall = calls.find(([, args]) => args[0] === 'funnel');
      expect(funnelCall).toBeDefined();
      expect(funnelCall![1]).toContain('http://localhost:3000');
    });

    it('uses custom funnelPort', async () => {
      mockExecSequence([
        { stdout: '1.56.0' },
        { stdout: TAILSCALE_STATUS_JSON },
        { stdout: '' },
      ]);

      await service.startFunnel({ port: 3000, protocol: 'http', funnelPort: 8080 });

      const calls = mockExecFile.mock.calls as [string, string[]][];
      const funnelCall = calls.find(([, args]) => args[0] === 'funnel');
      expect(funnelCall![1]).toContain('8080');
    });
  });

  // -------------------------------------------------------------------------
  // stop()
  // -------------------------------------------------------------------------

  describe('stop()', () => {
    it('calls tailscale serve reset when no port given', async () => {
      mockExecResolve('');

      const result = await service.stop();

      expect(result.success).toBe(true);

      const calls = mockExecFile.mock.calls as [string, string[]][];
      const stopCall = calls[0];
      expect(stopCall[0]).toBe('tailscale');
      expect(stopCall[1]).toContain('--remove');
      // Without a port arg it should just be ['serve', '--remove']
      expect(stopCall[1]).not.toContain('443');
    });

    it('calls tailscale serve reset with specific port', async () => {
      mockExecResolve('');

      const result = await service.stop(443);

      expect(result.success).toBe(true);

      const calls = mockExecFile.mock.calls as [string, string[]][];
      expect(calls[0][1]).toContain('443');
    });

    it('returns success: false when tailscale command fails', async () => {
      mockExecReject('permission denied');

      const result = await service.stop();

      expect(result.success).toBe(false);
      expect(result.error).toContain('permission denied');
    });
  });
});
