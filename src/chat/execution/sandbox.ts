/**
 * Sandbox Execution Manager
 *
 * Runs tool commands in isolated Docker containers.
 * Provides security through containerization with resource limits.
 */

import type { SandboxConfig, SandboxMount } from './types.js';
import { logger } from '../../utils/logger.js';
import { randomUUID } from 'crypto';
import type Dockerode from 'dockerode';
import {
  getSandboxConfig,
  getSecurityLevel,
  toDockerMemoryLimit,
  toDockerCpuLimit,
} from '../../core/sandbox-config.js';
import type { SandboxSecurityConfig } from '../../core/sandbox-config.js';

// Types

export interface SandboxExecuteOptions {
  command: string;
  workdir?: string;
  env?: Record<string, string>;
  timeout?: number;
  onOutput?: (type: 'stdout' | 'stderr', data: string) => void;
  signal?: AbortSignal;
}

export interface SandboxExecuteResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  containerId?: string;
  error?: string;
}

interface ContainerInfo {
  id: string;
  name: string;
  createdAt: number;
  inUse: boolean;
}

// Constants

const DEFAULT_IMAGE = 'node:22-alpine';
const DEFAULT_WORKDIR = '/workspace';
const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
const DEFAULT_MEMORY_LIMIT = '512m';
const DEFAULT_CPU_LIMIT = '1';
const CONTAINER_POOL_SIZE = 3;
const CONTAINER_MAX_AGE_MS = 3600_000; // 1 hour
const CLEANUP_INTERVAL_MS = 60_000; // 1 minute
const DEFAULT_SESSION_IDLE_MS = 600_000; // 10 minutes

// Sandbox Manager

interface SessionContainerInfo {
  container: Dockerode.Container;
  lastActivity: number;
}

export class SandboxManager {
  private config: SandboxConfig;
  private securityConfig: SandboxSecurityConfig;
  private docker: Dockerode | null = null;
  private containerPool: Map<string, ContainerInfo> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private initialized = false;

  /** Session-scoped containers (separate from shared pool) */
  private sessionContainers = new Map<string, SessionContainerInfo>();

  constructor(config?: Partial<SandboxConfig>) {
    // Resolve security preset first so derived defaults below can use it
    this.securityConfig = getSandboxConfig();

    this.config = {
      enabled: config?.enabled ?? true,
      image: config?.image ?? DEFAULT_IMAGE,
      workdir: config?.workdir ?? DEFAULT_WORKDIR,
      mounts: config?.mounts ?? [],
      env: config?.env ?? {},
      // Honor explicit caller override; fall back to security preset
      networkMode: config?.networkMode ?? (this.securityConfig.allowNetwork ? 'bridge' : 'none'),
      memoryLimit: config?.memoryLimit ?? (toDockerMemoryLimit(this.securityConfig.maxMemoryMb) ?? DEFAULT_MEMORY_LIMIT),
      cpuLimit: config?.cpuLimit ?? (toDockerCpuLimit(this.securityConfig.maxCpuPercent) ?? DEFAULT_CPU_LIMIT),
    };
  }

  /**
   * Initialize the sandbox manager
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) return true;

    try {
      // Dynamically import dockerode
      const DockerModule = await import('dockerode');

      // Resolve Docker socket: env var > /var/run/docker.sock > default
      const dockerHost = process.env.DOCKER_HOST;
      if (dockerHost) {
        // Support unix:///path or tcp://host:port
        if (dockerHost.startsWith('unix://')) {
          this.docker = new DockerModule.default({ socketPath: dockerHost.replace('unix://', '') });
        } else {
          this.docker = new DockerModule.default({ host: dockerHost });
        }
      } else {
        // Try standard socket paths (works with Docker Desktop, OrbStack, colima, etc.)
        const { existsSync } = await import('fs');
        const socketPaths = [
          '/var/run/docker.sock',
          `${process.env.HOME}/.orbstack/run/docker.sock`,
          `${process.env.HOME}/.docker/run/docker.sock`,
          `${process.env.HOME}/.colima/default/docker.sock`,
        ];
        const socketPath = socketPaths.find(p => existsSync(p));
        this.docker = socketPath
          ? new DockerModule.default({ socketPath })
          : new DockerModule.default();
      }

      // Check Docker connection
      await this.docker.ping();
      logger.info('[Sandbox] Docker connection established', { component: 'Sandbox' });

      // Log active security level so operators know what enforcement is in place
      logger.info(
        `[Sandbox] Security level: ${this.securityConfig.level} (mode override: ${process.env.PROFCLAW_SANDBOX_LEVEL ?? 'none'}, resolved: ${getSecurityLevel()})`,
        {
          component: 'Sandbox',
          securityLevel: this.securityConfig.level,
          allowNetwork: this.securityConfig.allowNetwork,
          readOnlyFs: this.securityConfig.readOnlyFs,
          maxMemoryMb: this.securityConfig.maxMemoryMb,
          maxCpuPercent: this.securityConfig.maxCpuPercent,
          timeoutMs: this.securityConfig.timeoutMs,
        },
      );

      // Pull the image if needed
      await this.ensureImage();

      // Pre-warm container pool
      await this.warmPool();

      // Start cleanup timer
      this.cleanupTimer = setInterval(() => this.cleanupOldContainers(), CLEANUP_INTERVAL_MS);

      this.initialized = true;
      return true;
    } catch (error) {
      logger.warn('[Sandbox] Docker not available, sandbox mode disabled', {
        component: 'Sandbox',
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Check if sandbox is available
   */
  isAvailable(): boolean {
    return this.initialized && this.docker !== null;
  }

  /**
   * Execute a command in the sandbox
   */
  async execute(options: SandboxExecuteOptions): Promise<SandboxExecuteResult> {
    const startTime = Date.now();

    if (!this.isAvailable()) {
      return {
        success: false,
        stdout: '',
        stderr: '',
        exitCode: null,
        durationMs: Date.now() - startTime,
        error: 'Sandbox not available (Docker not running)',
      };
    }

    const containerId = await this.acquireContainer();
    if (!containerId) {
      return {
        success: false,
        stdout: '',
        stderr: '',
        exitCode: null,
        durationMs: Date.now() - startTime,
        error: 'No container available',
      };
    }

    try {
      const result = await this.executeInContainer(containerId, options);
      return {
        ...result,
        durationMs: Date.now() - startTime,
        containerId,
      };
    } finally {
      this.releaseContainer(containerId);
    }
  }

  /**
   * Get sandbox status
   */
  getStatus(): {
    available: boolean;
    image: string;
    poolSize: number;
    activeContainers: number;
    config: SandboxConfig;
    securityLevel: string;
    securityConfig: SandboxSecurityConfig;
  } {
    const activeContainers = Array.from(this.containerPool.values())
      .filter(c => c.inUse).length;

    return {
      available: this.isAvailable(),
      image: this.config.image,
      poolSize: this.containerPool.size,
      activeContainers,
      config: this.config,
      securityLevel: this.securityConfig.level,
      securityConfig: this.securityConfig,
    };
  }

  /**
   * Update sandbox configuration.
   * Pass `refreshSecurity: true` to re-read the security preset from env vars.
   */
  updateConfig(updates: Partial<SandboxConfig>, refreshSecurity = false): void {
    if (refreshSecurity) {
      this.securityConfig = getSandboxConfig();
      logger.info(`[Sandbox] Security config refreshed to level: ${this.securityConfig.level}`, {
        component: 'Sandbox',
      });
    }
    this.config = { ...this.config, ...updates };
    logger.info('[Sandbox] Config updated', { component: 'Sandbox', config: this.config });
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Stop all pooled containers
    for (const [id] of this.containerPool) {
      await this.stopContainer(id);
    }
    this.containerPool.clear();

    // Stop all session containers
    for (const [sessionId] of this.sessionContainers) {
      await this.destroySessionContainer(sessionId);
    }

    this.initialized = false;
    logger.info('[Sandbox] Manager destroyed', { component: 'Sandbox' });
  }

  // Session Isolation Methods

  /**
   * Create an isolated container for a specific session.
   * The container gets its own workspace volume and is labelled with the session ID
   * so it can be identified and cleaned up later.
   * Returns the Docker container ID.
   */
  async createSessionContainer(sessionId: string, config?: Partial<SandboxConfig>): Promise<string> {
    if (!this.isAvailable() || !this.docker) {
      throw new Error('Sandbox not available (Docker not running)');
    }

    if (this.sessionContainers.has(sessionId)) {
      logger.warn(`[Sandbox] Session container already exists for ${sessionId}`, {
        component: 'Sandbox',
        sessionId,
      });
      return this.sessionContainers.get(sessionId)!.container.id;
    }

    const mergedConfig = { ...this.config, ...config };
    const name = `profclaw-session-${sessionId.slice(0, 12)}`;
    const workdir = mergedConfig.workdir ?? DEFAULT_WORKDIR;

    const binds: string[] = mergedConfig.mounts?.map((m: SandboxMount) => {
      const mode = m.readonly ? 'ro' : 'rw';
      return `${m.hostPath}:${m.containerPath}:${mode}`;
    }) ?? [];

    const secCfg = this.securityConfig;
    const capDrop: string[] = ['ALL'];
    const capAdd: string[] = secCfg.level === 'permissive' ? ['NET_BIND_SERVICE'] : [];

    try {
      const container = await this.docker.createContainer({
        Image: mergedConfig.image,
        name,
        Cmd: ['sleep', 'infinity'],
        WorkingDir: workdir,
        Env: Object.entries(mergedConfig.env ?? {}).map(([k, v]) => `${k}=${v}`),
        Labels: {
          'profclaw.session': sessionId,
          'profclaw.managed': 'true',
        },
        HostConfig: {
          Binds: binds,
          NetworkMode: mergedConfig.networkMode ?? (secCfg.allowNetwork ? 'bridge' : 'none'),
          Memory: parseMemoryLimit(mergedConfig.memoryLimit),
          NanoCpus: parseCpuLimit(mergedConfig.cpuLimit),
          AutoRemove: false,
          SecurityOpt: ['no-new-privileges'],
          CapDrop: capDrop,
          CapAdd: capAdd.length > 0 ? capAdd : undefined,
          ReadonlyRootfs: secCfg.readOnlyFs,
        },
        Tty: false,
        OpenStdin: false,
      });

      await container.start();

      this.sessionContainers.set(sessionId, {
        container,
        lastActivity: Date.now(),
      });

      logger.info(`[Sandbox] Created session container ${name}`, {
        component: 'Sandbox',
        sessionId,
        containerId: container.id,
      });

      return container.id;
    } catch (error) {
      logger.error('[Sandbox] Failed to create session container', error instanceof Error ? error : undefined, {
        sessionId,
      });
      throw error;
    }
  }

  /**
   * Execute a command inside the container belonging to a specific session.
   * Updates lastActivity so the idle cleanup timer does not reclaim active sessions.
   */
  async executeInSession(
    sessionId: string,
    command: string[],
    options?: { timeout?: number; workdir?: string },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const info = this.sessionContainers.get(sessionId);
    if (!info) {
      throw new Error(`No container found for session ${sessionId}`);
    }

    // Refresh idle timer
    info.lastActivity = Date.now();

    const timeout = options?.timeout ?? this.securityConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    try {
      const exec = await info.container.exec({
        Cmd: command,
        WorkingDir: options?.workdir ?? this.config.workdir,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });

      const stream = await exec.start({ hijack: true, stdin: false });

      let stdout = '';
      let stderr = '';

      const timeoutId = setTimeout(() => {
        if ('destroy' in stream && typeof stream.destroy === 'function') {
          (stream as NodeJS.ReadableStream & { destroy(): void }).destroy();
        }
      }, timeout);

      await new Promise<void>((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => {
          let offset = 0;
          while (offset < chunk.length) {
            if (offset + 8 > chunk.length) break;
            const type = chunk[offset];
            const size = chunk.readUInt32BE(offset + 4);
            if (offset + 8 + size > chunk.length) break;
            const text = chunk.subarray(offset + 8, offset + 8 + size).toString('utf-8');
            if (type === 1) stdout += text;
            else if (type === 2) stderr += text;
            offset += 8 + size;
          }
        });
        stream.on('end', resolve);
        stream.on('error', reject);
      });

      clearTimeout(timeoutId);

      const inspection = await exec.inspect();
      const exitCode = inspection.ExitCode ?? 0;

      logger.debug(`[Sandbox] Session exec completed`, {
        component: 'Sandbox',
        sessionId,
        exitCode,
      });

      return { stdout, stderr, exitCode };
    } catch (error) {
      logger.error('[Sandbox] Session exec failed', error instanceof Error ? error : undefined, { sessionId });
      throw error;
    }
  }

  /**
   * Stop and remove the container belonging to a session, then free all resources.
   */
  async destroySessionContainer(sessionId: string): Promise<void> {
    const info = this.sessionContainers.get(sessionId);
    if (!info) {
      logger.debug(`[Sandbox] No session container to destroy for ${sessionId}`, { component: 'Sandbox' });
      return;
    }

    const containerId = info.container.id;
    this.sessionContainers.delete(sessionId);

    try {
      await info.container.stop({ t: 5 });
      await info.container.remove({ force: true });
      logger.info(`[Sandbox] Destroyed session container`, {
        component: 'Sandbox',
        sessionId,
        containerId,
      });
    } catch (error) {
      logger.warn(`[Sandbox] Error destroying session container ${containerId}`, {
        component: 'Sandbox',
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Find and destroy containers that have been idle longer than the threshold.
   * Uses env var SANDBOX_SESSION_IDLE_MS (default 600 000 ms / 10 min).
   * Returns the number of containers cleaned up.
   */
  async cleanupIdleSessions(maxIdleMs?: number): Promise<number> {
    const envMs = parseInt(process.env.SANDBOX_SESSION_IDLE_MS ?? '0', 10) || DEFAULT_SESSION_IDLE_MS;
    const threshold = maxIdleMs ?? envMs;

    const now = Date.now();
    const idleSessions: string[] = [];

    for (const [sessionId, info] of this.sessionContainers) {
      if (now - info.lastActivity > threshold) {
        idleSessions.push(sessionId);
      }
    }

    for (const sessionId of idleSessions) {
      await this.destroySessionContainer(sessionId);
    }

    if (idleSessions.length > 0) {
      logger.info(`[Sandbox] Cleaned up ${idleSessions.length} idle session container(s)`, {
        component: 'Sandbox',
        count: idleSessions.length,
      });
    }

    return idleSessions.length;
  }

  // Private Methods

  private async ensureImage(): Promise<void> {
    if (!this.docker) return;

    try {
      await this.docker.getImage(this.config.image).inspect();
      logger.debug(`[Sandbox] Image ${this.config.image} exists`, { component: 'Sandbox' });
    } catch {
      logger.info(`[Sandbox] Pulling image ${this.config.image}...`, { component: 'Sandbox' });
      await new Promise<void>((resolve, reject) => {
        this.docker!.pull(this.config.image, (err: Error | null, stream: NodeJS.ReadableStream) => {
          if (err) return reject(err);
          this.docker!.modem.followProgress(stream, (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          });
        });
      });
      logger.info(`[Sandbox] Image ${this.config.image} pulled`, { component: 'Sandbox' });
    }
  }

  private async warmPool(): Promise<void> {
    const promises: Promise<string | null>[] = [];
    for (let i = 0; i < CONTAINER_POOL_SIZE; i++) {
      promises.push(this.createPooledContainer());
    }
    await Promise.allSettled(promises);
    logger.info(`[Sandbox] Pool warmed with ${this.containerPool.size} containers`, { component: 'Sandbox' });
  }

  private async createPooledContainer(): Promise<string | null> {
    if (!this.docker) return null;

    try {
      const name = `profclaw-sandbox-${randomUUID().slice(0, 8)}`;

      // Build mount bindings
      const binds: string[] = this.config.mounts?.map((m: SandboxMount) => {
        const mode = m.readonly ? 'ro' : 'rw';
        return `${m.hostPath}:${m.containerPath}:${mode}`;
      }) ?? [];

      // Build HostConfig security options from the active security preset
      const secCfg = this.securityConfig;
      const securityOpts = ['no-new-privileges'];
      const capDrop: string[] = ['ALL'];
      // In strict mode, add seccomp-unconfined label as a signal to the runtime
      // (actual seccomp profile attachment is left to the deployment environment)
      const capAdd: string[] = secCfg.level === 'permissive' ? ['NET_BIND_SERVICE'] : [];

      const container = await this.docker.createContainer({
        Image: this.config.image,
        name,
        Cmd: ['sleep', 'infinity'], // Keep container running
        WorkingDir: this.config.workdir,
        Env: Object.entries(this.config.env ?? {}).map(([k, v]) => `${k}=${v}`),
        HostConfig: {
          Binds: binds,
          NetworkMode: this.config.networkMode ?? (secCfg.allowNetwork ? 'bridge' : 'none'),
          Memory: parseMemoryLimit(this.config.memoryLimit),
          NanoCpus: parseCpuLimit(this.config.cpuLimit),
          AutoRemove: false,
          SecurityOpt: securityOpts,
          CapDrop: capDrop,
          CapAdd: capAdd.length > 0 ? capAdd : undefined,
          // Apply read-only root FS from the security preset.
          // The workspace mount is always rw so agents can write outputs.
          ReadonlyRootfs: secCfg.readOnlyFs,
        },
        Tty: false,
        OpenStdin: false,
      });

      await container.start();

      this.containerPool.set(container.id, {
        id: container.id,
        name,
        createdAt: Date.now(),
        inUse: false,
      });

      logger.debug(`[Sandbox] Created container ${name}`, { component: 'Sandbox' });
      return container.id;
    } catch (error) {
      logger.error('[Sandbox] Failed to create container', error instanceof Error ? error : undefined);
      return null;
    }
  }

  private async acquireContainer(): Promise<string | null> {
    // Find an available container
    for (const [id, info] of this.containerPool) {
      if (!info.inUse) {
        info.inUse = true;
        return id;
      }
    }

    // Create a new one if pool is exhausted
    const newId = await this.createPooledContainer();
    if (newId) {
      const info = this.containerPool.get(newId);
      if (info) info.inUse = true;
    }
    return newId;
  }

  private releaseContainer(containerId: string): void {
    const info = this.containerPool.get(containerId);
    if (info) {
      info.inUse = false;
    }
  }

  private async executeInContainer(
    containerId: string,
    options: SandboxExecuteOptions,
  ): Promise<Omit<SandboxExecuteResult, 'durationMs' | 'containerId'>> {
    if (!this.docker) {
      return {
        success: false,
        stdout: '',
        stderr: '',
        exitCode: null,
        error: 'Docker not available',
      };
    }

    const container = this.docker.getContainer(containerId);
    // Prefer caller-supplied timeout; fall back to security preset; then compile-time default
    const timeout = options.timeout ?? this.securityConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // Enforce command allowlist when security level is not permissive
    if (this.securityConfig.allowedCommands.length > 0) {
      const firstToken = options.command.trimStart().split(/\s+/)[0] ?? '';
      const allowed = this.securityConfig.allowedCommands.some(
        cmd => firstToken === cmd || firstToken.endsWith(`/${cmd}`),
      );
      if (!allowed) {
        logger.warn(`[Sandbox] Command blocked by security policy: ${firstToken}`, {
          component: 'Sandbox',
          securityLevel: this.securityConfig.level,
          command: options.command,
        });
        return {
          success: false,
          stdout: '',
          stderr: `Command '${firstToken}' is not allowed at security level '${this.securityConfig.level}'.`,
          exitCode: 126,
          error: `Command blocked by sandbox security policy (level: ${this.securityConfig.level})`,
        };
      }
    }

    try {
      // Create exec instance
      const exec = await container.exec({
        Cmd: ['sh', '-c', options.command],
        WorkingDir: options.workdir ?? this.config.workdir,
        Env: Object.entries(options.env ?? {}).map(([k, v]) => `${k}=${v}`),
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });

      // Start exec and capture output
      const stream = await exec.start({ hijack: true, stdin: false });

      let stdout = '';
      let stderr = '';

      // Handle abort signal
      const abortHandler = () => {
        if ('destroy' in stream && typeof stream.destroy === 'function') {
          (stream as NodeJS.ReadableStream & { destroy(): void }).destroy();
        }
      };
      options.signal?.addEventListener('abort', abortHandler);

      // Set up timeout
      const timeoutId = setTimeout(() => {
        if ('destroy' in stream && typeof stream.destroy === 'function') {
          (stream as NodeJS.ReadableStream & { destroy(): void }).destroy();
        }
      }, timeout);

      // Demultiplex stdout/stderr from Docker stream
      await new Promise<void>((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => {
          // Docker stream format: [type(1)][0][0][0][size(4)][data]
          let offset = 0;
          while (offset < chunk.length) {
            if (offset + 8 > chunk.length) break;

            const type = chunk[offset];
            const size = chunk.readUInt32BE(offset + 4);

            if (offset + 8 + size > chunk.length) break;

            const data = chunk.subarray(offset + 8, offset + 8 + size);
            const text = data.toString('utf-8');

            if (type === 1) {
              stdout += text;
              options.onOutput?.('stdout', text);
            } else if (type === 2) {
              stderr += text;
              options.onOutput?.('stderr', text);
            }

            offset += 8 + size;
          }
        });

        stream.on('end', resolve);
        stream.on('error', reject);
      });

      clearTimeout(timeoutId);
      options.signal?.removeEventListener('abort', abortHandler);

      // Get exit code
      const inspection = await exec.inspect();
      const exitCode = inspection.ExitCode ?? null;

      return {
        success: exitCode === 0,
        stdout,
        stderr,
        exitCode,
      };
    } catch (error) {
      return {
        success: false,
        stdout: '',
        stderr: '',
        exitCode: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async stopContainer(containerId: string): Promise<void> {
    if (!this.docker) return;

    try {
      const container = this.docker.getContainer(containerId);
      await container.stop({ t: 5 });
      await container.remove({ force: true });
      logger.debug(`[Sandbox] Stopped container ${containerId}`, { component: 'Sandbox' });
    } catch {
      // Container might already be stopped
      logger.debug(`[Sandbox] Failed to stop container ${containerId}`, { component: 'Sandbox' });
    }
  }

  private async cleanupOldContainers(): Promise<void> {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [id, info] of this.containerPool) {
      if (!info.inUse && now - info.createdAt > CONTAINER_MAX_AGE_MS) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      await this.stopContainer(id);
      this.containerPool.delete(id);
    }

    // Ensure minimum pool size
    while (this.containerPool.size < CONTAINER_POOL_SIZE) {
      await this.createPooledContainer();
    }
  }
}

// Utility Functions

function parseMemoryLimit(limit?: string): number | undefined {
  if (!limit) return undefined;

  const match = limit.match(/^(\d+)([kmg]?)$/i);
  if (!match) return undefined;

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 'k': return value * 1024;
    case 'm': return value * 1024 * 1024;
    case 'g': return value * 1024 * 1024 * 1024;
    default: return value;
  }
}

function parseCpuLimit(limit?: string): number | undefined {
  if (!limit) return undefined;

  const value = parseFloat(limit);
  if (isNaN(value)) return undefined;

  // Convert CPU cores to nanocpus
  return Math.floor(value * 1_000_000_000);
}

// Singleton

let sandboxManager: SandboxManager | null = null;

export function getSandboxManager(): SandboxManager {
  if (!sandboxManager) {
    sandboxManager = new SandboxManager();
  }
  return sandboxManager;
}

export async function initSandboxManager(config?: Partial<SandboxConfig>): Promise<SandboxManager> {
  if (sandboxManager) {
    await sandboxManager.destroy();
  }
  sandboxManager = new SandboxManager(config);
  await sandboxManager.initialize();
  return sandboxManager;
}
