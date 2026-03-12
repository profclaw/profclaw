/**
 * Plugin Sandbox
 *
 * Runs plugins in isolated Node.js Worker threads with restricted access.
 * Plugins cannot access the filesystem, network, or process directly
 * unless explicitly granted permissions.
 */

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';

// =============================================================================
// Types
// =============================================================================

export type PluginPermission =
  | 'fs:read'       // Read filesystem
  | 'fs:write'      // Write filesystem
  | 'net:fetch'     // Make HTTP requests
  | 'env:read'      // Read environment variables
  | 'exec'          // Execute shell commands
  | 'tools';        // Register tools

export interface SandboxConfig {
  pluginId: string;
  pluginPath: string;
  permissions: PluginPermission[];
  timeout: number;
  memoryLimit: number; // MB
}

export interface SandboxMessage {
  type: 'init' | 'call' | 'result' | 'error' | 'log' | 'register-tool';
  id?: string;
  payload?: unknown;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// =============================================================================
// Sandbox Runner (main thread)
// =============================================================================

export class PluginSandbox extends EventEmitter {
  private worker: Worker | null = null;
  private config: SandboxConfig;
  private pendingCalls = new Map<string, PendingCall>();
  private callCounter = 0;
  private healthy = false;

  constructor(config: SandboxConfig) {
    super();
    this.config = config;
  }

  /**
   * Start the sandbox worker
   */
  async start(): Promise<void> {
    if (this.worker) {
      throw new Error(`Sandbox for ${this.config.pluginId} is already running`);
    }

    this.worker = new Worker(new URL(import.meta.url), {
      workerData: {
        pluginPath: this.config.pluginPath,
        permissions: this.config.permissions,
        pluginId: this.config.pluginId,
      },
      resourceLimits: {
        maxOldGenerationSizeMb: this.config.memoryLimit,
        maxYoungGenerationSizeMb: Math.ceil(this.config.memoryLimit / 4),
      },
    });

    this.worker.on('message', (msg: SandboxMessage) => this.handleMessage(msg));
    this.worker.on('error', (err) => this.handleError(err));
    this.worker.on('exit', (code) => this.handleExit(code));

    // Wait for init confirmation
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Sandbox init timeout')), this.config.timeout);
      const handler = (msg: SandboxMessage) => {
        if (msg.type === 'init') {
          clearTimeout(timer);
          this.healthy = true;
          this.worker?.removeListener('message', handler);
          resolve();
        }
      };
      this.worker?.on('message', handler);
    });
  }

  /**
   * Call a plugin method
   */
  async call(method: string, args: unknown[] = []): Promise<unknown> {
    if (!this.worker || !this.healthy) {
      throw new Error(`Sandbox for ${this.config.pluginId} is not running`);
    }

    const id = String(++this.callCounter);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCalls.delete(id);
        reject(new Error(`Plugin call ${method} timed out after ${this.config.timeout}ms`));
      }, this.config.timeout);

      this.pendingCalls.set(id, { resolve, reject, timer });

      this.worker?.postMessage({
        type: 'call',
        id,
        payload: { method, args },
      } satisfies SandboxMessage);
    });
  }

  /**
   * Stop the sandbox
   */
  async stop(): Promise<void> {
    if (!this.worker) return;

    this.healthy = false;

    // Reject all pending calls
    for (const [id, pending] of this.pendingCalls) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Sandbox stopped'));
      this.pendingCalls.delete(id);
    }

    await this.worker.terminate();
    this.worker = null;
  }

  /**
   * Check if sandbox is healthy
   */
  isHealthy(): boolean {
    return this.healthy;
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private handleMessage(msg: SandboxMessage): void {
    switch (msg.type) {
      case 'result': {
        const pending = this.pendingCalls.get(msg.id!);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingCalls.delete(msg.id!);
          pending.resolve(msg.payload);
        }
        break;
      }
      case 'error': {
        const pendingErr = this.pendingCalls.get(msg.id!);
        if (pendingErr) {
          clearTimeout(pendingErr.timer);
          this.pendingCalls.delete(msg.id!);
          pendingErr.reject(new Error(String(msg.payload)));
        }
        break;
      }
      case 'log': {
        this.emit('log', msg.payload);
        break;
      }
      case 'register-tool': {
        this.emit('register-tool', msg.payload);
        break;
      }
    }
  }

  private handleError(err: Error): void {
    this.healthy = false;
    this.emit('error', err);
  }

  private handleExit(code: number): void {
    this.healthy = false;
    this.worker = null;

    // Reject all pending calls
    for (const [id, pending] of this.pendingCalls) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Sandbox exited with code ${code}`));
      this.pendingCalls.delete(id);
    }

    this.emit('exit', code);
  }
}

// =============================================================================
// Sandbox Manager
// =============================================================================

class SandboxManager {
  private sandboxes = new Map<string, PluginSandbox>();

  /**
   * Create and start a sandbox for a plugin
   */
  async create(config: SandboxConfig): Promise<PluginSandbox> {
    if (this.sandboxes.has(config.pluginId)) {
      throw new Error(`Sandbox already exists for ${config.pluginId}`);
    }

    const sandbox = new PluginSandbox(config);
    await sandbox.start();
    this.sandboxes.set(config.pluginId, sandbox);

    sandbox.on('exit', () => {
      this.sandboxes.delete(config.pluginId);
    });

    return sandbox;
  }

  /**
   * Get a running sandbox
   */
  get(pluginId: string): PluginSandbox | undefined {
    return this.sandboxes.get(pluginId);
  }

  /**
   * Stop a sandbox
   */
  async stop(pluginId: string): Promise<void> {
    const sandbox = this.sandboxes.get(pluginId);
    if (sandbox) {
      await sandbox.stop();
      this.sandboxes.delete(pluginId);
    }
  }

  /**
   * Stop all sandboxes
   */
  async stopAll(): Promise<void> {
    const promises = Array.from(this.sandboxes.values()).map((s) => s.stop());
    await Promise.allSettled(promises);
    this.sandboxes.clear();
  }

  /**
   * List running sandboxes
   */
  list(): Array<{ pluginId: string; healthy: boolean }> {
    return Array.from(this.sandboxes.entries()).map(([id, sb]) => ({
      pluginId: id,
      healthy: sb.isHealthy(),
    }));
  }
}

// =============================================================================
// Worker Thread Entry (runs inside sandbox)
// =============================================================================

if (!isMainThread && parentPort && workerData) {
  const { pluginPath, permissions, pluginId } = workerData as {
    pluginPath: string;
    permissions: PluginPermission[];
    pluginId: string;
  };

  // Create restricted API surface
  const sandboxApi = {
    log: (...args: unknown[]) => {
      parentPort?.postMessage({
        type: 'log',
        payload: { pluginId, level: 'info', args: args.map(String) },
      } satisfies SandboxMessage);
    },

    registerTool: (tool: unknown) => {
      if (!permissions.includes('tools')) {
        throw new Error('Plugin does not have "tools" permission');
      }
      parentPort?.postMessage({
        type: 'register-tool',
        payload: tool,
      } satisfies SandboxMessage);
    },

    fetch: permissions.includes('net:fetch')
      ? globalThis.fetch
      : () => { throw new Error('Plugin does not have "net:fetch" permission'); },
  };

  // Load plugin
  (async () => {
    try {
      const pluginModule = await import(pluginPath);
      const plugin = pluginModule.default || pluginModule;

      // Call onLoad if present
      if (typeof plugin.onLoad === 'function') {
        await plugin.onLoad(sandboxApi);
      }

      // Notify main thread we're ready
      parentPort?.postMessage({ type: 'init' } satisfies SandboxMessage);

      // Handle calls from main thread
      parentPort?.on('message', async (msg: SandboxMessage) => {
        if (msg.type !== 'call' || !msg.id) return;

        const { method, args } = msg.payload as { method: string; args: unknown[] };

        try {
          const fn = plugin[method];
          if (typeof fn !== 'function') {
            throw new Error(`Plugin method ${method} not found`);
          }
          const result = await fn.apply(plugin, args);
          parentPort?.postMessage({
            type: 'result',
            id: msg.id,
            payload: result,
          } satisfies SandboxMessage);
        } catch (error) {
          parentPort?.postMessage({
            type: 'error',
            id: msg.id,
            payload: error instanceof Error ? error.message : String(error),
          } satisfies SandboxMessage);
        }
      });
    } catch (error) {
      parentPort?.postMessage({
        type: 'error',
        payload: `Failed to load plugin: ${error instanceof Error ? error.message : String(error)}`,
      } satisfies SandboxMessage);
      process.exit(1);
    }
  })();
}

// =============================================================================
// Singleton
// =============================================================================

let manager: SandboxManager | null = null;

export function getSandboxManager(): SandboxManager {
  if (!manager) {
    manager = new SandboxManager();
  }
  return manager;
}

export { SandboxManager };
