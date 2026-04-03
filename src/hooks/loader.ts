/**
 * Hook Loader
 *
 * Dynamically loads hooks from a YAML config file or a hooks/ directory.
 * Each hook file should export a `Hook` or `Hook[]` as its default export.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { createContextualLogger } from '../utils/logger.js';
import type { Hook } from './registry.js';

const log = createContextualLogger('HookLoader');

interface HookFileConfig {
  /** Path to the hook module (relative or absolute) */
  path: string;
  /** Optional: override enabled state */
  enabled?: boolean;
}

interface HooksYaml {
  hooks?: HookFileConfig[];
  hooksDir?: string;
}

function parseSimpleYaml(content: string): HooksYaml {
  const result: HooksYaml = {};
  const lines = content.split('\n');
  let inHooks = false;
  const hookEntries: HookFileConfig[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.startsWith('hooksDir:')) {
      result.hooksDir = line.replace('hooksDir:', '').trim().replace(/^['"]|['"]$/g, '');
      inHooks = false;
      continue;
    }
    if (line.startsWith('hooks:')) {
      inHooks = true;
      continue;
    }
    if (inHooks && line.match(/^\s+-\s+path:/)) {
      const path = line.replace(/^\s+-\s+path:\s*/, '').replace(/^['"]|['"]$/g, '');
      hookEntries.push({ path, enabled: true });
      continue;
    }
    if (inHooks && line.match(/^\s+enabled:/)) {
      const last = hookEntries[hookEntries.length - 1];
      if (last) {
        last.enabled = line.includes('true');
      }
      continue;
    }
    if (line && !line.startsWith(' ') && !line.startsWith('\t') && !line.startsWith('#')) {
      inHooks = false;
    }
  }

  if (hookEntries.length > 0) {
    result.hooks = hookEntries;
  }

  return result;
}

async function loadHookFromPath(filePath: string): Promise<Hook[]> {
  try {
    const mod = await import(filePath) as Record<string, unknown>;
    const exported = mod.default ?? mod;

    if (Array.isArray(exported)) {
      return exported as Hook[];
    }

    if (exported && typeof (exported as Hook).handler === 'function') {
      return [exported as Hook];
    }

    log.warn('Hook file did not export a Hook or Hook[]', { path: filePath });
    return [];
  } catch (error) {
    log.error('[HookLoader] Failed to load hook file', {
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Load hooks from a YAML config file or hooks/ directory.
 *
 * Resolution order:
 * 1. `configPath` if provided
 * 2. `profclaw.hooks.yml` in the current working directory
 * 3. `hooks/` directory in the current working directory
 */
export async function loadHooks(configPath?: string): Promise<Hook[]> {
  const cwd = process.cwd();
  const loaded: Hook[] = [];

  // Resolve config path
  const yamlPath =
    configPath ?? resolve(cwd, 'profclaw.hooks.yml');

  if (existsSync(yamlPath)) {
    log.info('Loading hooks from YAML config', { path: yamlPath });
    try {
      const content = readFileSync(yamlPath, 'utf-8');
      const config = parseSimpleYaml(content);

      // Load explicitly listed hook files
      if (config.hooks) {
        for (const entry of config.hooks) {
          if (entry.enabled === false) continue;
          const absPath = resolve(cwd, entry.path);
          const hooks = await loadHookFromPath(absPath);
          loaded.push(...hooks);
        }
      }

      // Load from hooksDir if specified
      if (config.hooksDir) {
        const dir = resolve(cwd, config.hooksDir);
        const dirHooks = await loadHooksFromDirectory(dir);
        loaded.push(...dirHooks);
      }
    } catch (error) {
      log.error('[HookLoader] Failed to parse hooks YAML', {
        path: yamlPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    // Fallback: scan hooks/ directory
    const hooksDir = resolve(cwd, 'hooks');
    if (existsSync(hooksDir)) {
      log.info('Loading hooks from directory', { dir: hooksDir });
      const dirHooks = await loadHooksFromDirectory(hooksDir);
      loaded.push(...dirHooks);
    }
  }

  log.info('Hooks loaded', { count: loaded.length });
  return loaded;
}

async function loadHooksFromDirectory(dir: string): Promise<Hook[]> {
  const result: Hook[] = [];

  if (!existsSync(dir)) return result;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = extname(entry.name);
    if (ext !== '.ts' && ext !== '.js' && ext !== '.mjs') continue;
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.js')) continue;

    const filePath = join(dir, entry.name);
    const hooks = await loadHookFromPath(filePath);
    result.push(...hooks);
  }

  return result;
}
