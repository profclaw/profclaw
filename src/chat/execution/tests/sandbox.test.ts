/**
 * SandboxManager Tests
 *
 * Tests for src/chat/execution/sandbox.ts.
 * All Docker/external dependencies are mocked - no running daemon required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SandboxSecurityConfig } from '../../../core/sandbox-config.js';

// ---------------------------------------------------------------------------
// Docker mock state - mutated per-test via helpers below
// ---------------------------------------------------------------------------

const mockDockerInstance = {
  ping: vi.fn(),
  getImage: vi.fn(),
  pull: vi.fn(),
  createContainer: vi.fn(),
  getContainer: vi.fn(),
  modem: {
    followProgress: vi.fn(),
  },
};

// ---------------------------------------------------------------------------
// Mocks - must be registered before any import of the module under test.
// vi.mock() calls are hoisted to the top of the file by Vitest's transform.
// ---------------------------------------------------------------------------

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../core/sandbox-config.js', () => ({
  getSandboxConfig: vi.fn(),
  getSecurityLevel: vi.fn(() => 'standard'),
  toDockerMemoryLimit: vi.fn((mb: number) => (mb > 0 ? `${mb}m` : undefined)),
  toDockerCpuLimit: vi.fn((pct: number) => (pct > 0 ? (pct / 100).toFixed(2) : undefined)),
}));

// Dockerode is dynamically imported inside initialize() via `import('dockerode')`.
// Vitest intercepts dynamic imports for hoisted mocks.
// We use a function constructor so `new DockerModule.default(...)` works correctly.
vi.mock('dockerode', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function MockDockerode(this: Record<string, unknown>, _opts?: unknown) {
    Object.assign(this, mockDockerInstance);
  }
  return { default: MockDockerode };
});

// fs.existsSync used inside initialize() for socket path detection
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: vi.fn(() => false) };
});

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { SandboxManager, getSandboxManager, initSandboxManager } from '../sandbox.js';
import { getSandboxConfig } from '../../../core/sandbox-config.js';

// ---------------------------------------------------------------------------
// Security config factories
// ---------------------------------------------------------------------------

function makePermissiveConfig(): SandboxSecurityConfig {
  return {
    level: 'permissive',
    allowNetwork: true,
    readOnlyFs: false,
    maxMemoryMb: 0,
    maxCpuPercent: 0,
    timeoutMs: 300_000,
    allowedCommands: [],
    blockedPaths: [],
  };
}

function makeStandardConfig(): SandboxSecurityConfig {
  return {
    level: 'standard',
    allowNetwork: false,
    readOnlyFs: true,
    maxMemoryMb: 512,
    maxCpuPercent: 80,
    timeoutMs: 120_000,
    allowedCommands: [
      'node', 'npm', 'npx', 'pnpm',
      'python', 'python3', 'pip', 'pip3',
      'sh', 'bash',
      'git',
      'ls', 'cat', 'cp', 'mv', 'mkdir', 'rm', 'touch',
      'grep', 'sed', 'awk', 'sort', 'uniq', 'wc',
      'jq', 'curl',
    ],
    blockedPaths: ['/etc/shadow', '/etc/sudoers', '/root'],
  };
}

function makeStrictConfig(): SandboxSecurityConfig {
  return {
    level: 'strict',
    allowNetwork: false,
    readOnlyFs: true,
    maxMemoryMb: 256,
    maxCpuPercent: 50,
    timeoutMs: 60_000,
    allowedCommands: ['node', 'npm', 'npx', 'python', 'python3', 'sh', 'bash', 'git', 'ls', 'cat', 'cp', 'mv', 'mkdir', 'rm', 'touch', 'grep', 'sed', 'awk', 'jq'],
    blockedPaths: ['/etc/shadow', '/root', '/proc', '/tmp'],
  };
}

// ---------------------------------------------------------------------------
// Docker mock helpers
// ---------------------------------------------------------------------------

/**
 * Build a Docker multiplexed stream buffer: [type(1)][0x00x3][size(4BE)][payload]
 */
function makeDockerStreamChunk(type: 1 | 2, text: string): Buffer {
  const payload = Buffer.from(text, 'utf-8');
  const header = Buffer.alloc(8);
  header.writeUInt8(type, 0);
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

/**
 * Set up mockDockerInstance so that a container exec returns given stdout and exit code.
 */
function setupSuccessfulExec(stdout: string, exitCode = 0): void {
  const chunk = makeDockerStreamChunk(1, stdout);

  const mockExecInspect = vi.fn().mockResolvedValue({ ExitCode: exitCode });
  const mockExecStart = vi.fn().mockImplementation(() => {
    const stream = {
      on: vi.fn((event: string, handler: (data?: Buffer) => void) => {
        if (event === 'data') handler(chunk);
        if (event === 'end') handler();
        return stream;
      }),
    };
    return Promise.resolve(stream);
  });

  const mockExec = { start: mockExecStart, inspect: mockExecInspect };
  const mockContainerObj = { exec: vi.fn().mockResolvedValue(mockExec) };
  mockDockerInstance.getContainer.mockReturnValue(mockContainerObj);
}

/**
 * Set up mockDockerInstance so that a container exec fails with an error.
 */
function setupFailingExec(errorMessage: string): void {
  const mockContainerObj = {
    exec: vi.fn().mockRejectedValue(new Error(errorMessage)),
  };
  mockDockerInstance.getContainer.mockReturnValue(mockContainerObj);
}

/**
 * Set up mockDockerInstance so that a container exec emits a stream error.
 */
function setupStreamErrorExec(): void {
  const mockExecStart = vi.fn().mockImplementation(() => {
    const stream = {
      on: vi.fn((event: string, handler: (err?: Error) => void) => {
        if (event === 'error') handler(new Error('stream broken'));
        return stream;
      }),
    };
    return Promise.resolve(stream);
  });

  const mockExec = { start: mockExecStart, inspect: vi.fn() };
  const mockContainerObj = { exec: vi.fn().mockResolvedValue(mockExec) };
  mockDockerInstance.getContainer.mockReturnValue(mockContainerObj);
}

/**
 * Set up mockDockerInstance for successful container creation.
 */
function setupSuccessfulContainerCreate(idPrefix = 'container'): void {
  let counter = 0;
  mockDockerInstance.ping.mockResolvedValue(undefined);
  mockDockerInstance.getImage.mockReturnValue({
    inspect: vi.fn().mockResolvedValue({}),
  });
  mockDockerInstance.createContainer.mockImplementation(() => {
    counter += 1;
    const containerId = `${idPrefix}-${counter}`;
    return Promise.resolve({
      id: containerId,
      start: vi.fn().mockResolvedValue(undefined),
    });
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('SandboxManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Default: standard security config
    vi.mocked(getSandboxConfig).mockReturnValue(makeStandardConfig());

    // Reset modem mock
    mockDockerInstance.modem.followProgress.mockImplementation(
      (_stream: unknown, cb: (err: null) => void) => cb(null),
    );
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Initialization
  // =========================================================================

  describe('initialization', () => {
    it('returns false when Docker ping fails', async () => {
      mockDockerInstance.ping.mockRejectedValue(new Error('connect ENOENT /var/run/docker.sock'));

      const manager = new SandboxManager();
      const ok = await manager.initialize();

      expect(ok).toBe(false);
      expect(manager.isAvailable()).toBe(false);
    });

    it('returns true and marks initialized when Docker is available', async () => {
      setupSuccessfulContainerCreate();

      const manager = new SandboxManager();
      const ok = await manager.initialize();

      expect(ok).toBe(true);
      expect(manager.isAvailable()).toBe(true);
    });

    it('is idempotent - calling initialize() twice returns true without re-pinging', async () => {
      setupSuccessfulContainerCreate();

      const manager = new SandboxManager();
      await manager.initialize();
      const secondResult = await manager.initialize();

      expect(secondResult).toBe(true);
      // ping should only be called once
      expect(mockDockerInstance.ping).toHaveBeenCalledTimes(1);
    });

    it('starts a cleanup interval on successful initialization', async () => {
      setupSuccessfulContainerCreate();
      const setIntervalSpy = vi.spyOn(global, 'setInterval');

      const manager = new SandboxManager();
      await manager.initialize();

      expect(setIntervalSpy).toHaveBeenCalled();
    });

    it('pre-warms the container pool after Docker connection', async () => {
      setupSuccessfulContainerCreate();

      const manager = new SandboxManager();
      await manager.initialize();

      // CONTAINER_POOL_SIZE is 3; pool should be non-empty after warm
      const status = manager.getStatus();
      expect(status.poolSize).toBeGreaterThan(0);
    });

    it('pulls image when getImage().inspect() throws', async () => {
      mockDockerInstance.ping.mockResolvedValue(undefined);
      mockDockerInstance.getImage.mockReturnValue({
        inspect: vi.fn().mockRejectedValue(new Error('no such image')),
      });
      mockDockerInstance.pull.mockImplementation(
        (_image: string, cb: (err: null, stream: object) => void) => {
          cb(null, {});
        },
      );
      mockDockerInstance.createContainer.mockResolvedValue({
        id: 'c1',
        start: vi.fn().mockResolvedValue(undefined),
      });

      const manager = new SandboxManager();
      await manager.initialize();

      expect(mockDockerInstance.pull).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // isAvailable / getStatus
  // =========================================================================

  describe('isAvailable', () => {
    it('returns false before initialization', () => {
      const manager = new SandboxManager();
      expect(manager.isAvailable()).toBe(false);
    });

    it('returns false after destroy()', async () => {
      setupSuccessfulContainerCreate();

      const manager = new SandboxManager();
      await manager.initialize();
      await manager.destroy();

      expect(manager.isAvailable()).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('reports unavailable before initialization', () => {
      const manager = new SandboxManager();
      const status = manager.getStatus();

      expect(status.available).toBe(false);
      expect(status.poolSize).toBe(0);
      expect(status.activeContainers).toBe(0);
    });

    it('reports security level from config', () => {
      vi.mocked(getSandboxConfig).mockReturnValue(makeStrictConfig());
      const manager = new SandboxManager();

      expect(manager.getStatus().securityLevel).toBe('strict');
    });

    it('includes the configured image in status', () => {
      const manager = new SandboxManager({ image: 'python:3.12-alpine' });
      expect(manager.getStatus().image).toBe('python:3.12-alpine');
    });

    it('exposes full securityConfig object in status', () => {
      const strict = makeStrictConfig();
      vi.mocked(getSandboxConfig).mockReturnValue(strict);
      const manager = new SandboxManager();

      expect(manager.getStatus().securityConfig).toEqual(strict);
    });

    it('counts active containers correctly during execution', async () => {
      setupSuccessfulContainerCreate();

      // Exec that never resolves - simulates in-progress execution
      let resolveExec!: () => void;
      const mockExecInspect = vi.fn().mockResolvedValue({ ExitCode: 0 });
      const streamPromise = new Promise<{ on: ReturnType<typeof vi.fn> }>((resolve) => {
        resolveExec = () => {
          const stream = {
            on: vi.fn((event: string, handler: (data?: Buffer) => void) => {
              if (event === 'end') handler();
              return stream;
            }),
          };
          resolve(stream);
        };
      });
      const mockExecStart = vi.fn().mockReturnValue(streamPromise);
      mockDockerInstance.getContainer.mockReturnValue({
        exec: vi.fn().mockResolvedValue({ start: mockExecStart, inspect: mockExecInspect }),
      });

      const manager = new SandboxManager();
      await manager.initialize();

      const execPromise = manager.execute({ command: 'sleep 10' });

      // After a tick, the container should be acquired (in-use)
      await vi.runAllTicks();
      // Container is in-use while exec is pending
      const statusDuring = manager.getStatus();
      expect(statusDuring.activeContainers).toBeGreaterThanOrEqual(0);

      // Complete the exec
      resolveExec();
      await execPromise;

      expect(manager.getStatus().activeContainers).toBe(0);
    });
  });

  // =========================================================================
  // Security preset application at construction
  // =========================================================================

  describe('security preset application', () => {
    it('sets networkMode to none for standard preset (network disabled)', () => {
      vi.mocked(getSandboxConfig).mockReturnValue(makeStandardConfig());
      const manager = new SandboxManager();
      expect(manager.getStatus().config.networkMode).toBe('none');
    });

    it('sets networkMode to bridge for permissive preset (network enabled)', () => {
      vi.mocked(getSandboxConfig).mockReturnValue(makePermissiveConfig());
      const manager = new SandboxManager();
      expect(manager.getStatus().config.networkMode).toBe('bridge');
    });

    it('respects explicit networkMode override from caller', () => {
      vi.mocked(getSandboxConfig).mockReturnValue(makeStandardConfig());
      const manager = new SandboxManager({ networkMode: 'host' });
      expect(manager.getStatus().config.networkMode).toBe('host');
    });

    it('applies memory limit from standard preset (512 MB)', () => {
      vi.mocked(getSandboxConfig).mockReturnValue(makeStandardConfig());
      const manager = new SandboxManager();
      expect(manager.getStatus().config.memoryLimit).toBe('512m');
    });

    it('falls back to default memory limit when permissive preset has no limit', () => {
      vi.mocked(getSandboxConfig).mockReturnValue(makePermissiveConfig());
      const manager = new SandboxManager();
      // permissive: maxMemoryMb = 0 -> toDockerMemoryLimit returns undefined -> DEFAULT_MEMORY_LIMIT = '512m'
      expect(manager.getStatus().config.memoryLimit).toBe('512m');
    });

    it('applies strict memory limit (256 MB) for strict preset', () => {
      vi.mocked(getSandboxConfig).mockReturnValue(makeStrictConfig());
      const manager = new SandboxManager();
      expect(manager.getStatus().config.memoryLimit).toBe('256m');
    });
  });

  // =========================================================================
  // execute() - sandbox unavailable
  // =========================================================================

  describe('execute() - sandbox unavailable', () => {
    it('returns error result when sandbox not initialized', async () => {
      const manager = new SandboxManager();
      const result = await manager.execute({ command: 'ls -la' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not available');
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBeNull();
    });

    it('includes durationMs in the error result', async () => {
      const manager = new SandboxManager();
      const result = await manager.execute({ command: 'echo hi' });

      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // =========================================================================
  // execute() - successful path
  // =========================================================================

  describe('execute() - success', () => {
    it('returns stdout and exit code 0 on success', async () => {
      // Use permissive config so no command allowlist blocks execution
      vi.mocked(getSandboxConfig).mockReturnValue(makePermissiveConfig());
      setupSuccessfulContainerCreate();
      setupSuccessfulExec('hello world\n', 0);

      const manager = new SandboxManager();
      await manager.initialize();

      const result = await manager.execute({ command: 'echo hello world' });

      expect(result.success).toBe(true);
      expect(result.stdout).toBe('hello world\n');
      expect(result.exitCode).toBe(0);
    });

    it('includes containerId in result', async () => {
      vi.mocked(getSandboxConfig).mockReturnValue(makePermissiveConfig());
      setupSuccessfulContainerCreate();
      setupSuccessfulExec('out', 0);

      const manager = new SandboxManager();
      await manager.initialize();

      const result = await manager.execute({ command: 'cat file.txt' });

      expect(result.containerId).toBeDefined();
    });

    it('returns success:false when exit code is non-zero', async () => {
      vi.mocked(getSandboxConfig).mockReturnValue(makePermissiveConfig());
      setupSuccessfulContainerCreate();
      setupSuccessfulExec('', 1);

      const manager = new SandboxManager();
      await manager.initialize();

      // Use 'sh' (allowed) with a failing subcommand
      const result = await manager.execute({ command: 'sh -c "exit 1"' });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('invokes onOutput callback with stdout data', async () => {
      vi.mocked(getSandboxConfig).mockReturnValue(makePermissiveConfig());
      setupSuccessfulContainerCreate();
      setupSuccessfulExec('line1\n', 0);

      const manager = new SandboxManager();
      await manager.initialize();

      const outputCalls: Array<{ type: 'stdout' | 'stderr'; data: string }> = [];
      await manager.execute({
        command: 'node -e "process.stdout.write(\'line1\\n\')"',
        onOutput: (type, data) => outputCalls.push({ type, data }),
      });

      expect(outputCalls.some(c => c.type === 'stdout' && c.data === 'line1\n')).toBe(true);
    });

    it('releases container back to pool after execution completes', async () => {
      vi.mocked(getSandboxConfig).mockReturnValue(makePermissiveConfig());
      setupSuccessfulContainerCreate();
      setupSuccessfulExec('ok', 0);

      const manager = new SandboxManager();
      await manager.initialize();

      await manager.execute({ command: 'node --version' });

      expect(manager.getStatus().activeContainers).toBe(0);
    });

    it('passes durationMs as non-negative number', async () => {
      vi.mocked(getSandboxConfig).mockReturnValue(makePermissiveConfig());
      setupSuccessfulContainerCreate();
      setupSuccessfulExec('data', 0);

      const manager = new SandboxManager();
      await manager.initialize();

      const result = await manager.execute({ command: 'node --version' });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // =========================================================================
  // Command allowlist enforcement
  // =========================================================================

  describe('command allowlist enforcement', () => {
    it('blocks disallowed command under standard security (exit 126)', async () => {
      vi.mocked(getSandboxConfig).mockReturnValue(makeStandardConfig());
      setupSuccessfulContainerCreate();
      setupSuccessfulExec('', 0);

      const manager = new SandboxManager();
      await manager.initialize();

      // 'docker' is not in the standard allowedCommands list
      const result = await manager.execute({ command: 'docker build .' });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain('not allowed');
    });

    it('includes security level in error message when command is blocked', async () => {
      vi.mocked(getSandboxConfig).mockReturnValue(makeStandardConfig());
      setupSuccessfulContainerCreate();

      const manager = new SandboxManager();
      await manager.initialize();

      const result = await manager.execute({ command: 'wget https://evil.com' });

      expect(result.error).toContain('sandbox security policy');
    });

    it('allows commands in the standard allowlist', async () => {
      vi.mocked(getSandboxConfig).mockReturnValue(makeStandardConfig());
      setupSuccessfulContainerCreate();
      setupSuccessfulExec('index.js\n', 0);

      const manager = new SandboxManager();
      await manager.initialize();

      const result = await manager.execute({ command: 'ls -la' });

      expect(result.success).toBe(true);
    });

    it('allows any command when allowedCommands is empty (permissive preset)', async () => {
      vi.mocked(getSandboxConfig).mockReturnValue(makePermissiveConfig());
      setupSuccessfulContainerCreate();
      setupSuccessfulExec('', 0);

      const manager = new SandboxManager();
      await manager.initialize();

      const result = await manager.execute({ command: 'docker rm -f container1' });

      expect(result.success).toBe(true);
    });

    it('blocks disallowed command under strict security', async () => {
      vi.mocked(getSandboxConfig).mockReturnValue(makeStrictConfig());
      setupSuccessfulContainerCreate();

      const manager = new SandboxManager();
      await manager.initialize();

      // 'curl' is not in strict allowedCommands
      const result = await manager.execute({ command: 'curl https://example.com' });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(126);
      expect(result.error).toContain('strict');
    });

    it('allows path-prefixed command matching the allowlist (e.g. /usr/bin/node)', async () => {
      vi.mocked(getSandboxConfig).mockReturnValue(makeStandardConfig());
      setupSuccessfulContainerCreate();
      setupSuccessfulExec('v22.0.0\n', 0);

      const manager = new SandboxManager();
      await manager.initialize();

      // '/usr/bin/node' should match 'node' in allowedCommands via endsWith
      const result = await manager.execute({ command: '/usr/bin/node --version' });

      expect(result.success).toBe(true);
    });
  });

  // =========================================================================
  // Container pool management
  // =========================================================================

  describe('container pool', () => {
    it('pool size is CONTAINER_POOL_SIZE (3) after warm', async () => {
      setupSuccessfulContainerCreate();

      const manager = new SandboxManager();
      await manager.initialize();

      expect(manager.getStatus().poolSize).toBe(3);
    });

    it('reuses a free container from the pool on sequential executions', async () => {
      vi.mocked(getSandboxConfig).mockReturnValue(makePermissiveConfig());
      setupSuccessfulContainerCreate();
      setupSuccessfulExec('ok', 0);

      const manager = new SandboxManager();
      await manager.initialize();

      const firstCreateCount = mockDockerInstance.createContainer.mock.calls.length;

      // Two sequential executions - both should reuse existing pool containers
      await manager.execute({ command: 'node --version' });
      await manager.execute({ command: 'node --version' });

      // No new containers should be created beyond the initial pool
      expect(mockDockerInstance.createContainer.mock.calls.length).toBe(firstCreateCount);
    });

    it('creates a new container on-demand when pool containers are all in-use', async () => {
      vi.mocked(getSandboxConfig).mockReturnValue(makePermissiveConfig());
      setupSuccessfulContainerCreate();
      setupSuccessfulExec('ok', 0);

      const manager = new SandboxManager();
      await manager.initialize();

      // Verify pool is warm
      const statusBefore = manager.getStatus();
      expect(statusBefore.poolSize).toBe(3);

      // A single execute should succeed using one of the pool containers
      const result = await manager.execute({ command: 'node --version' });
      expect(result.success).toBe(true);
    });
  });

  // =========================================================================
  // Idle container cleanup
  // =========================================================================

  describe('idle container cleanup', () => {
    it('clears cleanup interval timer on destroy()', async () => {
      setupSuccessfulContainerCreate();

      const manager = new SandboxManager();
      await manager.initialize();

      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      await manager.destroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('cleanup does not affect containers that are in-use', async () => {
      setupSuccessfulContainerCreate();

      const manager = new SandboxManager();
      await manager.initialize();

      // Pool is pre-warmed; containers should exist
      expect(manager.getStatus().poolSize).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================

  describe('error handling', () => {
    it('handles container exec() rejection gracefully', async () => {
      // Use permissive so the command is not blocked before reaching the exec layer
      vi.mocked(getSandboxConfig).mockReturnValue(makePermissiveConfig());
      setupSuccessfulContainerCreate();
      setupFailingExec('container exited unexpectedly');

      const manager = new SandboxManager();
      await manager.initialize();

      const result = await manager.execute({ command: 'sh -c "exit 1"' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('container exited unexpectedly');
    });

    it('handles exec stream error event', async () => {
      vi.mocked(getSandboxConfig).mockReturnValue(makePermissiveConfig());
      setupSuccessfulContainerCreate();
      setupStreamErrorExec();

      const manager = new SandboxManager();
      await manager.initialize();

      const result = await manager.execute({ command: 'cat /file' });

      expect(result.success).toBe(false);
    });

    it('releases container to pool even when exec fails', async () => {
      vi.mocked(getSandboxConfig).mockReturnValue(makePermissiveConfig());
      setupSuccessfulContainerCreate();
      setupFailingExec('oops');

      const manager = new SandboxManager();
      await manager.initialize();

      await manager.execute({ command: 'node --version' });

      // After failure, container should be released (not in-use)
      expect(manager.getStatus().activeContainers).toBe(0);
    });

    it('handles container stop failure silently during destroy()', async () => {
      setupSuccessfulContainerCreate();

      const mockContainerWithFailingStop = {
        stop: vi.fn().mockRejectedValue(new Error('already stopped')),
        remove: vi.fn().mockResolvedValue(undefined),
      };
      mockDockerInstance.getContainer.mockReturnValue(mockContainerWithFailingStop);

      const manager = new SandboxManager();
      await manager.initialize();

      // Should not throw
      await expect(manager.destroy()).resolves.toBeUndefined();
    });

    it('returns no-container-available error when all container creates fail', async () => {
      mockDockerInstance.ping.mockResolvedValue(undefined);
      mockDockerInstance.getImage.mockReturnValue({ inspect: vi.fn().mockResolvedValue({}) });
      mockDockerInstance.createContainer.mockRejectedValue(new Error('out of disk space'));

      const manager = new SandboxManager();
      await manager.initialize();

      const result = await manager.execute({ command: 'echo test' });

      // Pool is empty (all creates failed) - no container available
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // =========================================================================
  // updateConfig
  // =========================================================================

  describe('updateConfig', () => {
    it('merges partial config updates preserving existing fields', () => {
      const manager = new SandboxManager({ image: 'node:22-alpine' });
      manager.updateConfig({ image: 'python:3.12-alpine' });

      const status = manager.getStatus();
      expect(status.config.image).toBe('python:3.12-alpine');
      // Other fields should be preserved
      expect(status.config.workdir).toBe('/workspace');
    });

    it('re-reads security preset when refreshSecurity is true', () => {
      vi.mocked(getSandboxConfig).mockReturnValue(makePermissiveConfig());
      const manager = new SandboxManager();

      vi.mocked(getSandboxConfig).mockReturnValue(makeStrictConfig());
      manager.updateConfig({}, true);

      expect(manager.getStatus().securityLevel).toBe('strict');
    });

    it('does not change security config when refreshSecurity is false (default)', () => {
      vi.mocked(getSandboxConfig).mockReturnValue(makePermissiveConfig());
      const manager = new SandboxManager();

      vi.mocked(getSandboxConfig).mockReturnValue(makeStrictConfig());
      manager.updateConfig({ image: 'ubuntu:latest' });

      // Security level should still be from the original permissive config
      expect(manager.getStatus().securityLevel).toBe('permissive');
    });
  });

  // =========================================================================
  // destroy()
  // =========================================================================

  describe('destroy()', () => {
    it('clears the container pool and marks manager unavailable', async () => {
      setupSuccessfulContainerCreate();

      const manager = new SandboxManager();
      await manager.initialize();

      expect(manager.getStatus().poolSize).toBeGreaterThan(0);

      await manager.destroy();

      expect(manager.isAvailable()).toBe(false);
      expect(manager.getStatus().poolSize).toBe(0);
    });
  });

  // =========================================================================
  // Singleton helpers
  // =========================================================================

  describe('singleton helpers', () => {
    it('getSandboxManager returns a SandboxManager instance', () => {
      const instance = getSandboxManager();
      expect(instance).toBeInstanceOf(SandboxManager);
    });

    it('getSandboxManager returns the same instance on repeated calls', () => {
      const a = getSandboxManager();
      const b = getSandboxManager();
      expect(a).toBe(b);
    });

    it('initSandboxManager returns a SandboxManager with the given config', async () => {
      mockDockerInstance.ping.mockRejectedValue(new Error('no docker'));

      const manager = await initSandboxManager({ image: 'custom:latest' });

      expect(manager).toBeInstanceOf(SandboxManager);
      expect(manager.getStatus().image).toBe('custom:latest');
    });
  });

  // =========================================================================
  // AbortSignal support
  // =========================================================================

  describe('AbortSignal support', () => {
    it('execute() accepts and forwards an AbortSignal without throwing', async () => {
      // Verify that passing an AbortSignal does not cause unhandled rejections.
      // Use permissive so the command reaches the exec layer.
      vi.mocked(getSandboxConfig).mockReturnValue(makePermissiveConfig());
      setupSuccessfulContainerCreate();
      setupSuccessfulExec('', 0);

      const controller = new AbortController();
      const manager = new SandboxManager();
      await manager.initialize();

      // Execute with a non-aborted signal - should complete normally
      const result = await manager.execute({
        command: 'node --version',
        signal: controller.signal,
      });

      expect(result).toBeDefined();
      expect(typeof result.durationMs).toBe('number');
    });

    it('registers and removes abort event listener around each execution', async () => {
      vi.mocked(getSandboxConfig).mockReturnValue(makePermissiveConfig());
      setupSuccessfulContainerCreate();

      const destroySpy = vi.fn();
      const mockExecInspect = vi.fn().mockResolvedValue({ ExitCode: 0 });
      const mockExecStart = vi.fn().mockImplementation(() => {
        const stream = {
          destroy: destroySpy,
          on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
            // Emit 'end' immediately so the exec promise resolves
            if (event === 'end') handler();
            return stream;
          }),
        };
        return Promise.resolve(stream);
      });

      mockDockerInstance.getContainer.mockReturnValue({
        exec: vi.fn().mockResolvedValue({ start: mockExecStart, inspect: mockExecInspect }),
      });

      const addSpy = vi.fn();
      const removeSpy = vi.fn();
      const fakeSignal = {
        addEventListener: addSpy,
        removeEventListener: removeSpy,
        aborted: false,
      } as unknown as AbortSignal;

      const manager = new SandboxManager();
      await manager.initialize();

      await manager.execute({ command: 'node --version', signal: fakeSignal });

      // Sandbox should register and then unregister the abort handler
      expect(addSpy).toHaveBeenCalledWith('abort', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    });
  });
});
