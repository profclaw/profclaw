/**
 * profClaw Plugin Marketplace
 *
 * Discovers, installs, and manages plugins from the npm registry.
 * Plugins can be published as `profclaw-plugin-*` or `@profclaw/plugin-*`.
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PLUGINS_DIR = join(homedir(), '.profclaw', 'plugins');
const REGISTRY_FILE = join(homedir(), '.profclaw', 'marketplace.json');

// =============================================================================
// Types
// =============================================================================

export interface MarketplacePlugin {
  name: string;
  version: string;
  description: string;
  author: string;
  category: 'tool' | 'channel' | 'provider' | 'integration' | 'skill' | 'theme' | 'middleware';
  downloads: number;
  lastPublished: string;
  homepage?: string;
  repository?: string;
  keywords: string[];
  profclaw?: {
    minVersion?: string;
    capabilities?: string[];
  };
}

export interface InstalledPlugin {
  name: string;
  version: string;
  source: 'npm' | 'local';
  path: string;
  installedAt: string;
  enabled: boolean;
}

interface MarketplaceState {
  installed: InstalledPlugin[];
  lastFetch: string | null;
  cache: MarketplacePlugin[];
}

// =============================================================================
// Marketplace Service
// =============================================================================

class PluginMarketplace {
  private state: MarketplaceState;

  constructor() {
    this.state = this.loadState();
  }

  /**
   * Search npm registry for profClaw plugins
   */
  async search(query?: string, category?: string): Promise<MarketplacePlugin[]> {
    const searchTerms = ['profclaw-plugin', query].filter(Boolean).join(' ');

    try {
      const { stdout } = await execFileAsync('npm', [
        'search',
        searchTerms,
        '--json',
        '--long',
      ], { timeout: 15000 });

      const results = JSON.parse(stdout) as Array<{
        name: string;
        version: string;
        description: string;
        author?: { name?: string; email?: string } | string;
        date: string;
        keywords?: string[];
        links?: { npm?: string; homepage?: string; repository?: string };
      }>;

      const plugins: MarketplacePlugin[] = results
        .filter((r) => r.name.startsWith('profclaw-plugin-') || r.name.startsWith('@profclaw/'))
        .map((r) => ({
          name: r.name,
          version: r.version,
          description: r.description || '',
          author: typeof r.author === 'string' ? r.author : r.author?.name || 'Unknown',
          category: this.inferCategory(r.keywords || []),
          downloads: 0,
          lastPublished: r.date || '',
          homepage: r.links?.homepage,
          repository: r.links?.repository,
          keywords: r.keywords || [],
        }));

      const filtered = category
        ? plugins.filter((p) => p.category === category)
        : plugins;

      // Cache results
      this.state.cache = plugins;
      this.state.lastFetch = new Date().toISOString();
      this.saveState();

      return filtered;
    } catch (error) {
      // Return cached results if npm search fails
      if (this.state.cache.length > 0) {
        const cached = category
          ? this.state.cache.filter((p) => p.category === category)
          : this.state.cache;
        return cached;
      }
      throw new Error(`npm search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Install a plugin from npm
   */
  async install(packageName: string, version?: string): Promise<InstalledPlugin> {
    // Validate package name
    if (!packageName.startsWith('profclaw-plugin-') && !packageName.startsWith('@profclaw/')) {
      throw new Error('Plugin must be named profclaw-plugin-* or @profclaw/*');
    }

    // Check if already installed
    const existing = this.state.installed.find((p) => p.name === packageName);
    if (existing) {
      throw new Error(`Plugin ${packageName} is already installed at ${existing.path}`);
    }

    // Ensure plugins directory exists
    if (!existsSync(PLUGINS_DIR)) {
      mkdirSync(PLUGINS_DIR, { recursive: true });
    }

    const installSpec = version ? `${packageName}@${version}` : packageName;
    const pluginDir = join(
      PLUGINS_DIR,
      packageName.replace(/^@profclaw\//, '').replace(/^profclaw-plugin-/, ''),
    );

    // Create a subdirectory for the plugin
    if (!existsSync(pluginDir)) {
      mkdirSync(pluginDir, { recursive: true });
    }

    // Initialize a minimal package.json if not present
    const pkgJsonPath = join(pluginDir, 'package.json');
    if (!existsSync(pkgJsonPath)) {
      writeFileSync(pkgJsonPath, JSON.stringify({ name: 'profclaw-plugin-workspace', private: true }, null, 2));
    }

    // Detect package manager
    const pm = this.detectPackageManager();

    try {
      if (pm === 'pnpm') {
        await execFileAsync('pnpm', ['add', installSpec], { cwd: pluginDir, timeout: 60000 });
      } else if (pm === 'yarn') {
        await execFileAsync('yarn', ['add', installSpec], { cwd: pluginDir, timeout: 60000 });
      } else {
        await execFileAsync('npm', ['install', installSpec], { cwd: pluginDir, timeout: 60000 });
      }
    } catch (error) {
      throw new Error(`Failed to install ${installSpec}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Read installed version
    let installedVersion = 'unknown';
    try {
      const installedPkgPath = join(pluginDir, 'node_modules', packageName, 'package.json');
      if (existsSync(installedPkgPath)) {
        const pkg = JSON.parse(readFileSync(installedPkgPath, 'utf-8')) as { version?: string };
        installedVersion = pkg.version || 'unknown';
      }
    } catch {
      // Version detection failed, use 'unknown'
    }

    const installed: InstalledPlugin = {
      name: packageName,
      version: installedVersion,
      source: 'npm',
      path: pluginDir,
      installedAt: new Date().toISOString(),
      enabled: true,
    };

    this.state.installed.push(installed);
    this.saveState();

    return installed;
  }

  /**
   * Uninstall a plugin
   */
  async uninstall(packageName: string): Promise<void> {
    const index = this.state.installed.findIndex((p) => p.name === packageName);
    if (index === -1) {
      throw new Error(`Plugin ${packageName} is not installed`);
    }

    const plugin = this.state.installed[index];

    // Remove from node_modules if npm-installed
    if (plugin.source === 'npm') {
      const pm = this.detectPackageManager();
      try {
        if (pm === 'pnpm') {
          await execFileAsync('pnpm', ['remove', packageName], { cwd: plugin.path, timeout: 30000 });
        } else if (pm === 'yarn') {
          await execFileAsync('yarn', ['remove', packageName], { cwd: plugin.path, timeout: 30000 });
        } else {
          await execFileAsync('npm', ['uninstall', packageName], { cwd: plugin.path, timeout: 30000 });
        }
      } catch {
        // Best effort removal
      }
    }

    this.state.installed.splice(index, 1);
    this.saveState();
  }

  /**
   * Enable/disable a plugin
   */
  setEnabled(packageName: string, enabled: boolean): void {
    const plugin = this.state.installed.find((p) => p.name === packageName);
    if (!plugin) {
      throw new Error(`Plugin ${packageName} is not installed`);
    }
    plugin.enabled = enabled;
    this.saveState();
  }

  /**
   * List installed plugins
   */
  listInstalled(): InstalledPlugin[] {
    return [...this.state.installed];
  }

  /**
   * Get details of an installed plugin
   */
  getInstalled(packageName: string): InstalledPlugin | undefined {
    return this.state.installed.find((p) => p.name === packageName);
  }

  /**
   * Check for updates to installed plugins
   */
  async checkUpdates(): Promise<Array<{ name: string; current: string; latest: string }>> {
    const updates: Array<{ name: string; current: string; latest: string }> = [];

    for (const plugin of this.state.installed) {
      if (plugin.source !== 'npm') continue;

      try {
        const { stdout } = await execFileAsync('npm', ['view', plugin.name, 'version'], { timeout: 10000 });
        const latest = stdout.trim();
        if (latest && latest !== plugin.version) {
          updates.push({ name: plugin.name, current: plugin.version, latest });
        }
      } catch {
        // Skip plugins that can't be checked
      }
    }

    return updates;
  }

  /**
   * Update a plugin to the latest version
   */
  async update(packageName: string): Promise<InstalledPlugin> {
    const existing = this.state.installed.find((p) => p.name === packageName);
    if (!existing) {
      throw new Error(`Plugin ${packageName} is not installed`);
    }

    // Uninstall and reinstall
    await this.uninstall(packageName);
    return this.install(packageName);
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private inferCategory(keywords: string[]): MarketplacePlugin['category'] {
    const kw = keywords.map((k) => k.toLowerCase());
    if (kw.includes('channel') || kw.includes('chat')) return 'channel';
    if (kw.includes('provider') || kw.includes('model') || kw.includes('ai')) return 'provider';
    if (kw.includes('integration') || kw.includes('webhook')) return 'integration';
    if (kw.includes('skill') || kw.includes('prompt')) return 'skill';
    if (kw.includes('theme') || kw.includes('ui')) return 'theme';
    if (kw.includes('middleware')) return 'middleware';
    return 'tool';
  }

  private detectPackageManager(): 'pnpm' | 'yarn' | 'npm' {
    if (existsSync(join(process.cwd(), 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(join(process.cwd(), 'yarn.lock'))) return 'yarn';
    return 'npm';
  }

  private loadState(): MarketplaceState {
    try {
      if (existsSync(REGISTRY_FILE)) {
        const data = readFileSync(REGISTRY_FILE, 'utf-8');
        return JSON.parse(data) as MarketplaceState;
      }
    } catch {
      // Corrupted state, start fresh
    }
    return { installed: [], lastFetch: null, cache: [] };
  }

  private saveState(): void {
    const dir = join(homedir(), '.profclaw');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(REGISTRY_FILE, JSON.stringify(this.state, null, 2));
  }
}

// =============================================================================
// Singleton
// =============================================================================

let marketplace: PluginMarketplace | null = null;

export function getMarketplace(): PluginMarketplace {
  if (!marketplace) {
    marketplace = new PluginMarketplace();
  }
  return marketplace;
}

export { PluginMarketplace };
