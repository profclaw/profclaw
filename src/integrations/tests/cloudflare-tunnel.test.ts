/**
 * Cloudflare Tunnel Integration Tests
 *
 * Tests for CloudflareTunnelService in src/integrations/cloudflare-tunnel.ts.
 * Mocks node:child_process execFile and spawn.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Mock child_process before importing module under test
// ---------------------------------------------------------------------------

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: (fn: unknown) => fn,
}));

// ---------------------------------------------------------------------------
// Import mocks and module under test
// ---------------------------------------------------------------------------

import { execFile, spawn } from 'node:child_process';
import { CloudflareTunnelService } from '../cloudflare-tunnel.js';

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
const mockSpawn = spawn as unknown as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Mock ChildProcess factory
// ---------------------------------------------------------------------------

function makeMockProcess(): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  pid: number;
} {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

// Helper: resolve execFile with given stdout
function mockExecResolve(stdout: string): void {
  mockExecFile.mockResolvedValue({ stdout, stderr: '' });
}

function mockExecReject(message: string): void {
  mockExecFile.mockRejectedValue(new Error(message));
}

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

// Helper for quick tunnel: runs startQuickTunnel and emits a URL from stderr
// after the internal getStatus() resolves, then returns the result.
async function runQuickTunnel(
  service: CloudflareTunnelService,
  port: number,
  urlToEmit: string,
  source: 'stdout' | 'stderr' = 'stderr',
): Promise<{ result: Awaited<ReturnType<typeof service.startQuickTunnel>>; proc: ReturnType<typeof makeMockProcess> }> {
  const proc = makeMockProcess();
  mockSpawn.mockReturnValue(proc);

  // Start tunnel - getStatus() runs async internally
  const tunnelPromise = service.startQuickTunnel({ port });

  // Wait for the spawn to be called (means getStatus resolved and spawn was invoked)
  await vi.waitFor(() => {
    expect(mockSpawn).toHaveBeenCalled();
  });

  // Wait for listeners to be fully attached after spawn
  await new Promise((r) => process.nextTick(r));

  // Now emit the URL
  proc[source].emit('data', Buffer.from(`${urlToEmit}\n`));

  return { result: await tunnelPromise, proc };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CloudflareTunnelService', () => {
  let service: CloudflareTunnelService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CloudflareTunnelService();
  });

  afterEach(() => {
    // Reset service without awaiting stop (avoids hanging on 'exit' event)
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // getStatus()
  // -------------------------------------------------------------------------

  describe('getStatus()', () => {
    it('returns installed: false when cloudflared is not found', async () => {
      mockExecReject('command not found');

      const status = await service.getStatus();

      expect(status.installed).toBe(false);
      expect(status.authenticated).toBe(false);
    });

    it('parses version from cloudflared output', async () => {
      mockExecSequence([
        { stdout: 'cloudflared version 2024.1.0 (built 2024-01-15-UTC)' },
        { stdout: '[]' }, // tunnel list
      ]);

      const status = await service.getStatus();

      expect(status.installed).toBe(true);
      expect(status.version).toBe('2024.1.0');
    });

    it('marks authenticated: true when tunnel list succeeds', async () => {
      mockExecSequence([
        { stdout: 'cloudflared version 2024.1.0 (built 2024-01-15)' },
        { stdout: '[]' }, // tunnel list succeeds
      ]);

      const status = await service.getStatus();

      expect(status.installed).toBe(true);
      expect(status.authenticated).toBe(true);
    });

    it('marks authenticated: false when tunnel list fails', async () => {
      mockExecSequence([
        { stdout: 'cloudflared version 2024.1.0 (built 2024-01-15)' },
        { error: 'not logged in' },
      ]);

      const status = await service.getStatus();

      expect(status.installed).toBe(true);
      expect(status.authenticated).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // startQuickTunnel()
  // -------------------------------------------------------------------------

  describe('startQuickTunnel()', () => {
    it('returns error when cloudflared is not installed', async () => {
      mockExecReject('not found');

      const result = await service.startQuickTunnel({ port: 3000 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not installed');
    });

    it('spawns cloudflared with correct args', async () => {
      mockExecSequence([
        { stdout: 'cloudflared version 2024.1.0 (built 2024-01-15)' },
        { error: 'not logged in' },
      ]);

      const { result } = await runQuickTunnel(
        service,
        3000,
        'https://abc-def-ghi.trycloudflare.com',
        'stderr',
      );

      expect(result.success).toBe(true);
      expect(result.url).toBe('https://abc-def-ghi.trycloudflare.com');

      const spawnCall = mockSpawn.mock.calls[0] as [string, string[]];
      expect(spawnCall[0]).toBe('cloudflared');
      expect(spawnCall[1]).toContain('--url');
      expect(spawnCall[1]).toContain('http://localhost:3000');
    });

    it('parses tunnel URL from stdout', async () => {
      mockExecSequence([
        { stdout: 'cloudflared version 2024.1.0 (built 2024-01-15)' },
        { error: 'no tunnels' },
      ]);

      const { result } = await runQuickTunnel(
        service,
        8080,
        'Connecting... https://xyz-123-abc.trycloudflare.com ready!',
        'stdout',
      );

      expect(result.success).toBe(true);
      expect(result.url).toBe('https://xyz-123-abc.trycloudflare.com');
    });

    it('returns error when process emits an error event', async () => {
      mockExecSequence([
        { stdout: 'cloudflared version 2024.1.0 (built 2024-01-15)' },
        { error: 'no tunnels' },
      ]);

      const proc = makeMockProcess();
      mockSpawn.mockReturnValue(proc);

      const tunnelPromise = service.startQuickTunnel({ port: 3000 });

      await vi.waitFor(() => {
        expect(mockSpawn).toHaveBeenCalled();
      });

      // Wait for listeners to be attached in the same microtask after spawn
      await new Promise((r) => process.nextTick(r));

      proc.emit('error', new Error('cloudflared crashed'));

      const result = await tunnelPromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('cloudflared crashed');
    });
  });

  // -------------------------------------------------------------------------
  // startNamedTunnel()
  // -------------------------------------------------------------------------

  describe('startNamedTunnel()', () => {
    it('returns error when not installed', async () => {
      mockExecReject('not found');

      const result = await service.startNamedTunnel({ name: 'my-tunnel', port: 3000 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not installed');
    });

    it('returns error when not authenticated', async () => {
      mockExecSequence([
        { stdout: 'cloudflared version 2024.1.0 (built 2024-01-15)' },
        { error: 'not logged in' },
      ]);

      const result = await service.startNamedTunnel({ name: 'my-tunnel', port: 3000 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not authenticated');
    });

    it('reuses existing tunnel by ID', async () => {
      const existingTunnels = JSON.stringify([{ id: 'tunnel-uuid-abc', name: 'my-tunnel' }]);

      mockExecSequence([
        { stdout: 'cloudflared version 2024.1.0 (built 2024-01-15)' }, // version
        { stdout: '[]' },                                                 // authenticated check
        { stdout: existingTunnels },                                       // tunnel list
      ]);

      const proc = makeMockProcess();
      mockSpawn.mockReturnValue(proc);

      // Named tunnel resolves after a 3s setTimeout - run with real timers but
      // the 3s delay is intentional in the source. We test the result is correct.
      const result = await service.startNamedTunnel({ name: 'my-tunnel', port: 3000 });

      expect(result.success).toBe(true);
      expect(result.tunnelId).toBe('tunnel-uuid-abc');
    }, 10000);

    it('uses custom hostname in URL when provided', async () => {
      const existingTunnels = JSON.stringify([{ id: 'abc', name: 'named' }]);

      mockExecSequence([
        { stdout: 'cloudflared version 2024.1.0 (built 2024-01-15)' },
        { stdout: '[]' },
        { stdout: existingTunnels },
        { stdout: '' }, // DNS route
      ]);

      const proc = makeMockProcess();
      mockSpawn.mockReturnValue(proc);

      const result = await service.startNamedTunnel({
        name: 'named',
        port: 3000,
        hostname: 'api.example.com',
      });

      expect(result.success).toBe(true);
      expect(result.url).toBe('https://api.example.com');
    }, 10000);
  });

  // -------------------------------------------------------------------------
  // stop()
  // -------------------------------------------------------------------------

  describe('stop()', () => {
    it('returns success when no process is running', async () => {
      const result = await service.stop();
      expect(result.success).toBe(true);
    });

    it('kills the active process with SIGTERM', async () => {
      mockExecSequence([
        { stdout: 'cloudflared version 2024.1.0 (built 2024-01-15)' },
        { error: 'no tunnels' },
      ]);

      const { proc } = await runQuickTunnel(
        service,
        3000,
        'https://abc.trycloudflare.com',
        'stderr',
      );

      // Now stop - emit exit on nextTick so stop()'s exit listener is attached first
      const stopPromise = service.stop();

      // Allow stop()'s Promise constructor to run and attach its 'exit' listener
      await new Promise((r) => process.nextTick(r));

      // Simulate the process exiting after SIGTERM
      proc.emit('exit', 0);

      const result = await stopPromise;

      expect(result.success).toBe(true);
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  // -------------------------------------------------------------------------
  // getActiveUrl() / isRunning()
  // -------------------------------------------------------------------------

  describe('getActiveUrl() and isRunning()', () => {
    it('returns null and false before any tunnel starts', () => {
      expect(service.getActiveUrl()).toBeNull();
      expect(service.isRunning()).toBe(false);
    });

    it('returns the URL and true after a quick tunnel connects', async () => {
      mockExecSequence([
        { stdout: 'cloudflared version 2024.1.0 (built 2024-01-15)' },
        { error: 'no tunnels' },
      ]);

      await runQuickTunnel(service, 3000, 'https://running.trycloudflare.com', 'stderr');

      expect(service.getActiveUrl()).toBe('https://running.trycloudflare.com');
      expect(service.isRunning()).toBe(true);
    });
  });
});
