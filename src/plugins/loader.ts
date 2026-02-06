/**
 * Plugin Loader
 *
 * Discovers and loads profClaw plugins from:
 * 1. ~/.profclaw/plugins/ (local plugins)
 * 2. node_modules (npm packages with "profclaw" in package.json)
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../utils/logger.js';
import type { ProfClawPlugin, PluginManifest } from './sdk.js';
import { hasCapability } from '../core/deployment.js';

const PLUGINS_DIR = join(homedir(), '.profclaw', 'plugins');

interface LoadedPlugin {
  plugin: ProfClawPlugin;
  source: 'local' | 'npm';
  path: string;
}

/**
 * Discover and load all available plugins.
 */
export async function loadPlugins(): Promise<LoadedPlugin[]> {
  if (!hasCapability('plugins')) {
    logger.info('[Plugins] Plugin loading disabled in this mode');
    return [];
  }

  const plugins: LoadedPlugin[] = [];

  // 1. Load from ~/.profclaw/plugins/
  const localPlugins = await loadLocalPlugins();
  plugins.push(...localPlugins);

  // 2. Load from node_modules (profclaw-plugin-* packages)
  const npmPlugins = await loadNpmPlugins();
  plugins.push(...npmPlugins);

  logger.info(`[Plugins] Loaded ${plugins.length} plugins (${localPlugins.length} local, ${npmPlugins.length} npm)`);
  return plugins;
}

/**
 * Load plugins from ~/.profclaw/plugins/
 */
async function loadLocalPlugins(): Promise<LoadedPlugin[]> {
  const plugins: LoadedPlugin[] = [];

  if (!existsSync(PLUGINS_DIR)) return plugins;

  const entries = readdirSync(PLUGINS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginDir = join(PLUGINS_DIR, entry.name);

    try {
      const plugin = await loadPluginFromDir(pluginDir);
      if (plugin) {
        plugins.push({ plugin, source: 'local', path: pluginDir });
        logger.info(`[Plugins] Loaded local plugin: ${plugin.metadata.name}`);
      }
    } catch (error) {
      logger.error(`[Plugins] Failed to load local plugin ${entry.name}:`, error as Error);
    }
  }

  return plugins;
}

/**
 * Load plugins from node_modules.
 */
async function loadNpmPlugins(): Promise<LoadedPlugin[]> {
  const plugins: LoadedPlugin[] = [];
  const nodeModulesDir = join(process.cwd(), 'node_modules');

  if (!existsSync(nodeModulesDir)) return plugins;

  // Look for packages matching profclaw-plugin-* pattern
  const entries = readdirSync(nodeModulesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    // Check profclaw-plugin-* packages
    if (entry.name.startsWith('profclaw-plugin-')) {
      const packageDir = join(nodeModulesDir, entry.name);
      try {
        const plugin = await loadPluginFromDir(packageDir);
        if (plugin) {
          plugins.push({ plugin, source: 'npm', path: packageDir });
          logger.info(`[Plugins] Loaded npm plugin: ${plugin.metadata.name}`);
        }
      } catch (error) {
        logger.error(`[Plugins] Failed to load npm plugin ${entry.name}:`, error as Error);
      }
    }

    // Check @profclaw/* scoped packages
    if (entry.name === '@profclaw') {
      const scopeDir = join(nodeModulesDir, entry.name);
      const scopeEntries = readdirSync(scopeDir, { withFileTypes: true });
      for (const scopeEntry of scopeEntries) {
        if (!scopeEntry.isDirectory()) continue;
        const packageDir = join(scopeDir, scopeEntry.name);
        try {
          const plugin = await loadPluginFromDir(packageDir);
          if (plugin) {
            plugins.push({ plugin, source: 'npm', path: packageDir });
            logger.info(`[Plugins] Loaded npm plugin: ${plugin.metadata.name}`);
          }
        } catch (error) {
          logger.error(`[Plugins] Failed to load npm plugin @profclaw/${scopeEntry.name}:`, error as Error);
        }
      }
    }
  }

  return plugins;
}

/**
 * Load a single plugin from a directory.
 */
async function loadPluginFromDir(dir: string): Promise<ProfClawPlugin | null> {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) return null;

  const pkgContent = readFileSync(pkgPath, 'utf-8');
  const pkg = JSON.parse(pkgContent) as PluginManifest;

  // Must have profclaw config
  if (!pkg.profclaw && !pkg.name?.includes('profclaw')) return null;

  const entryPoint = pkg.profclaw?.main || 'index.js';
  const entryPath = join(dir, entryPoint);

  if (!existsSync(entryPath)) {
    logger.warn(`[Plugins] Entry point not found: ${entryPath}`);
    return null;
  }

  const module = await import(entryPath);
  const plugin: ProfClawPlugin = module.default || module;

  // Validate plugin has required fields
  if (!plugin.metadata?.id || !plugin.metadata?.name) {
    logger.warn(`[Plugins] Plugin in ${dir} missing metadata.id or metadata.name`);
    return null;
  }

  return plugin;
}

/**
 * Get the plugins directory path.
 */
export function getPluginsDir(): string {
  return PLUGINS_DIR;
}
