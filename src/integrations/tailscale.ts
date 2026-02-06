/**
 * Tailscale Integration
 *
 * Auto-configure Tailscale Serve and Funnel for remote access to profClaw.
 * Tailscale Serve exposes a local port to your tailnet.
 * Tailscale Funnel exposes it to the public internet via a Tailscale-managed domain.
 *
 * Requirements:
 *   - Tailscale CLI installed and authenticated (`tailscale status`)
 *   - Tailscale Funnel requires HTTPS and ACL permissions
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT = 15000;

// Types

export interface TailscaleStatus {
  installed: boolean;
  running: boolean;
  loggedIn: boolean;
  hostname?: string;
  tailnetName?: string;
  ipv4?: string;
  ipv6?: string;
  version?: string;
  os?: string;
}

export interface TailscaleServeConfig {
  port: number;
  protocol: 'http' | 'https';
  path?: string;
  servePort?: number;
}

export interface TailscaleFunnelConfig extends TailscaleServeConfig {
  funnelPort?: number;
}

export interface TailscaleServeResult {
  success: boolean;
  url?: string;
  error?: string;
}

// Tailscale Service

class TailscaleService {
  /**
   * Check if Tailscale is installed and get status
   */
  async getStatus(): Promise<TailscaleStatus> {
    const result: TailscaleStatus = {
      installed: false,
      running: false,
      loggedIn: false,
    };

    try {
      const { stdout } = await execFileAsync('tailscale', ['version'], { timeout: DEFAULT_TIMEOUT });
      result.installed = true;
      result.version = stdout.trim().split('\n')[0];
    } catch {
      return result;
    }

    try {
      const { stdout } = await execFileAsync('tailscale', ['status', '--json'], { timeout: DEFAULT_TIMEOUT });
      const status = JSON.parse(stdout) as {
        BackendState?: string;
        Self?: {
          HostName?: string;
          DNSName?: string;
          TailscaleIPs?: string[];
          OS?: string;
        };
        CurrentTailnet?: {
          Name?: string;
        };
      };

      result.running = status.BackendState === 'Running';
      result.loggedIn = result.running;
      result.hostname = status.Self?.HostName;
      result.tailnetName = status.CurrentTailnet?.Name;
      result.os = status.Self?.OS;

      const ips = status.Self?.TailscaleIPs || [];
      result.ipv4 = ips.find((ip) => !ip.includes(':'));
      result.ipv6 = ips.find((ip) => ip.includes(':'));
    } catch {
      // Status check failed - tailscale might not be running
    }

    return result;
  }

  /**
   * Start Tailscale Serve - expose local port to tailnet
   */
  async startServe(config: TailscaleServeConfig): Promise<TailscaleServeResult> {
    const status = await this.getStatus();

    if (!status.installed) {
      return { success: false, error: 'Tailscale is not installed. Install from https://tailscale.com/download' };
    }

    if (!status.running || !status.loggedIn) {
      return { success: false, error: 'Tailscale is not running or not logged in. Run: tailscale up' };
    }

    const servePort = config.servePort || 443;
    const target = `${config.protocol}://localhost:${config.port}`;
    const path = config.path || '/';

    try {
      // Reset existing serve config for this port
      await execFileAsync('tailscale', ['serve', '--remove', `${servePort}`], { timeout: DEFAULT_TIMEOUT }).catch(() => {
        // Ignore errors from removing non-existent config
      });

      // Set up serve
      await execFileAsync('tailscale', [
        'serve',
        '--bg',
        '--set-path', path,
        `${servePort}`,
        target,
      ], { timeout: DEFAULT_TIMEOUT });

      const dnsName = status.hostname && status.tailnetName
        ? `${status.hostname}.${status.tailnetName}`
        : status.hostname || 'unknown';

      const url = `https://${dnsName}${path === '/' ? '' : path}`;

      return { success: true, url };
    } catch (error) {
      return {
        success: false,
        error: `Failed to start Tailscale Serve: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Start Tailscale Funnel - expose to public internet
   */
  async startFunnel(config: TailscaleFunnelConfig): Promise<TailscaleServeResult> {
    const status = await this.getStatus();

    if (!status.installed) {
      return { success: false, error: 'Tailscale is not installed' };
    }

    if (!status.running || !status.loggedIn) {
      return { success: false, error: 'Tailscale is not running or not logged in' };
    }

    const funnelPort = config.funnelPort || 443;
    const target = `${config.protocol}://localhost:${config.port}`;
    const path = config.path || '/';

    try {
      // Set up funnel
      await execFileAsync('tailscale', [
        'funnel',
        '--bg',
        '--set-path', path,
        `${funnelPort}`,
        target,
      ], { timeout: DEFAULT_TIMEOUT });

      const dnsName = status.hostname && status.tailnetName
        ? `${status.hostname}.${status.tailnetName}`
        : status.hostname || 'unknown';

      const url = `https://${dnsName}${path === '/' ? '' : path}`;

      return { success: true, url };
    } catch (error) {
      return {
        success: false,
        error: `Failed to start Tailscale Funnel: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Stop Tailscale Serve/Funnel for a port
   */
  async stop(port?: number): Promise<{ success: boolean; error?: string }> {
    try {
      if (port) {
        await execFileAsync('tailscale', ['serve', '--remove', `${port}`], { timeout: DEFAULT_TIMEOUT });
      } else {
        await execFileAsync('tailscale', ['serve', '--remove'], { timeout: DEFAULT_TIMEOUT });
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get current serve/funnel configuration
   */
  async getServeConfig(): Promise<{ success: boolean; config?: unknown; error?: string }> {
    try {
      const { stdout } = await execFileAsync('tailscale', ['serve', 'status', '--json'], { timeout: DEFAULT_TIMEOUT });
      return { success: true, config: JSON.parse(stdout) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

// Singleton

let service: TailscaleService | null = null;

export function getTailscaleService(): TailscaleService {
  if (!service) {
    service = new TailscaleService();
  }
  return service;
}

export { TailscaleService };
