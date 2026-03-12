/**
 * Cloudflare Tunnel Integration
 *
 * Auto-configure Cloudflare Tunnel (cloudflared) for remote access to profClaw.
 * Alternative to Tailscale for users who prefer Cloudflare's network.
 *
 * Two modes:
 *   1. Quick tunnel (no account needed) - temporary URL
 *   2. Named tunnel (requires Cloudflare account) - persistent URL with custom domain
 *
 * Requirements:
 *   - cloudflared CLI installed
 *   - For named tunnels: Cloudflare account + authenticated cloudflared
 */

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT = 15000;

// =============================================================================
// Types
// =============================================================================

export interface CloudflareStatus {
  installed: boolean;
  authenticated: boolean;
  version?: string;
}

export interface QuickTunnelConfig {
  port: number;
  protocol?: 'http' | 'https';
}

export interface NamedTunnelConfig {
  name: string;
  port: number;
  protocol?: 'http' | 'https';
  hostname?: string;
}

export interface TunnelResult {
  success: boolean;
  url?: string;
  tunnelId?: string;
  error?: string;
}

// =============================================================================
// Cloudflare Tunnel Service
// =============================================================================

class CloudflareTunnelService extends EventEmitter {
  private activeProcess: ChildProcess | null = null;
  private activeUrl: string | null = null;

  constructor() {
    super();
  }

  /**
   * Check if cloudflared is installed and authenticated
   */
  async getStatus(): Promise<CloudflareStatus> {
    const result: CloudflareStatus = {
      installed: false,
      authenticated: false,
    };

    try {
      const { stdout } = await execFileAsync('cloudflared', ['version'], { timeout: DEFAULT_TIMEOUT });
      result.installed = true;
      // Parse version from output like "cloudflared version 2024.1.0 (built 2024-01-15)"
      const versionMatch = stdout.match(/version\s+([\d.]+)/);
      result.version = versionMatch ? versionMatch[1] : stdout.trim();
    } catch {
      return result;
    }

    // Check authentication by trying to list tunnels
    try {
      await execFileAsync('cloudflared', ['tunnel', 'list', '--output', 'json'], { timeout: DEFAULT_TIMEOUT });
      result.authenticated = true;
    } catch {
      // Not authenticated or no tunnels - that's fine for quick tunnels
    }

    return result;
  }

  /**
   * Start a quick tunnel (no account needed, temporary URL)
   */
  async startQuickTunnel(config: QuickTunnelConfig): Promise<TunnelResult> {
    const status = await this.getStatus();

    if (!status.installed) {
      return {
        success: false,
        error: 'cloudflared is not installed. Install from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
      };
    }

    // Stop any existing tunnel
    await this.stop();

    const protocol = config.protocol || 'http';
    const target = `${protocol}://localhost:${config.port}`;

    return new Promise((resolve) => {
      const proc = spawn('cloudflared', ['tunnel', '--url', target, '--no-autoupdate'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.activeProcess = proc;

      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve({
            success: false,
            error: 'Timed out waiting for tunnel URL. cloudflared may still be starting.',
          });
        }
      }, 30000);

      const handleOutput = (data: Buffer) => {
        const output = data.toString();

        // Look for the tunnel URL in output
        // cloudflared outputs: "https://xxx-xxx-xxx.trycloudflare.com"
        const urlMatch = output.match(/(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/);
        if (urlMatch && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          this.activeUrl = urlMatch[1];
          this.emit('connected', this.activeUrl);
          resolve({ success: true, url: this.activeUrl });
        }
      };

      proc.stdout?.on('data', handleOutput);
      proc.stderr?.on('data', handleOutput);

      proc.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve({ success: false, error: err.message });
        }
      });

      proc.on('exit', (code) => {
        this.activeProcess = null;
        this.activeUrl = null;
        this.emit('disconnected', code);
      });
    });
  }

  /**
   * Start a named tunnel (requires Cloudflare account)
   */
  async startNamedTunnel(config: NamedTunnelConfig): Promise<TunnelResult> {
    const status = await this.getStatus();

    if (!status.installed) {
      return { success: false, error: 'cloudflared is not installed' };
    }

    if (!status.authenticated) {
      return {
        success: false,
        error: 'cloudflared is not authenticated. Run: cloudflared tunnel login',
      };
    }

    // Check if tunnel exists, create if not
    let tunnelId: string | undefined;

    try {
      const { stdout } = await execFileAsync('cloudflared', [
        'tunnel', 'list', '--output', 'json', '--name', config.name,
      ], { timeout: DEFAULT_TIMEOUT });

      const tunnels = JSON.parse(stdout) as Array<{ id: string; name: string }>;
      const existing = tunnels.find((t) => t.name === config.name);

      if (existing) {
        tunnelId = existing.id;
      } else {
        // Create new tunnel
        const { stdout: createOut } = await execFileAsync('cloudflared', [
          'tunnel', 'create', config.name,
        ], { timeout: DEFAULT_TIMEOUT });

        const idMatch = createOut.match(/([a-f0-9-]{36})/);
        tunnelId = idMatch ? idMatch[1] : undefined;
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to create/find tunnel: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }

    if (!tunnelId) {
      return { success: false, error: 'Could not determine tunnel ID' };
    }

    // Route DNS if hostname provided
    if (config.hostname) {
      try {
        await execFileAsync('cloudflared', [
          'tunnel', 'route', 'dns', config.name, config.hostname,
        ], { timeout: DEFAULT_TIMEOUT });
      } catch {
        // DNS routing might already exist, continue
      }
    }

    // Stop any existing tunnel
    await this.stop();

    const protocol = config.protocol || 'http';
    const target = `${protocol}://localhost:${config.port}`;

    return new Promise((resolve) => {
      const args = ['tunnel', '--no-autoupdate', '--url', target, 'run', config.name];

      const proc = spawn('cloudflared', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.activeProcess = proc;

      // For named tunnels, the URL is the hostname or tunnel-specific
      const url = config.hostname
        ? `https://${config.hostname}`
        : `https://${config.name}.cfargotunnel.com`;

      this.activeUrl = url;

      // Give cloudflared a moment to start
      setTimeout(() => {
        this.emit('connected', url);
        resolve({ success: true, url, tunnelId });
      }, 3000);

      proc.on('error', (err) => {
        this.activeProcess = null;
        this.activeUrl = null;
        resolve({ success: false, error: err.message });
      });

      proc.on('exit', (code) => {
        this.activeProcess = null;
        this.activeUrl = null;
        this.emit('disconnected', code);
      });
    });
  }

  /**
   * Stop the active tunnel
   */
  async stop(): Promise<{ success: boolean; error?: string }> {
    if (this.activeProcess) {
      try {
        this.activeProcess.kill('SIGTERM');

        // Wait for graceful shutdown
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            this.activeProcess?.kill('SIGKILL');
            resolve();
          }, 5000);

          this.activeProcess?.on('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        });

        this.activeProcess = null;
        this.activeUrl = null;
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
    return { success: true };
  }

  /**
   * Get current tunnel URL
   */
  getActiveUrl(): string | null {
    return this.activeUrl;
  }

  /**
   * Check if tunnel is running
   */
  isRunning(): boolean {
    return this.activeProcess !== null;
  }

  /**
   * Delete a named tunnel
   */
  async deleteTunnel(name: string): Promise<{ success: boolean; error?: string }> {
    try {
      await execFileAsync('cloudflared', ['tunnel', 'delete', name], { timeout: DEFAULT_TIMEOUT });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let service: CloudflareTunnelService | null = null;

export function getCloudflareTunnelService(): CloudflareTunnelService {
  if (!service) {
    service = new CloudflareTunnelService();
  }
  return service;
}

export { CloudflareTunnelService };
