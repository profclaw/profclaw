/**
 * Skills Installer
 *
 * Installs missing dependencies for skills (binaries, packages).
 * Supports brew, npm/pnpm, go, pip, and direct downloads.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../utils/logger.js';
import { clearBinaryCache, hasBinary } from './loader.js';
import type { SkillInstallSpec, SkillsSystemConfig } from './types.js';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const MAX_TIMEOUT = 15 * 60 * 1000; // 15 minutes

export interface InstallResult {
  success: boolean;
  spec: SkillInstallSpec;
  message: string;
  duration: number;
}

/**
 * Install a dependency from a spec
 */
export async function installDependency(
  spec: SkillInstallSpec,
  config: SkillsSystemConfig,
  timeoutMs?: number,
): Promise<InstallResult> {
  const start = Date.now();
  const timeout = Math.min(timeoutMs || DEFAULT_TIMEOUT, MAX_TIMEOUT);

  try {
    // Check platform compatibility
    if (spec.os && !spec.os.includes(process.platform)) {
      return {
        success: false,
        spec,
        message: `Skipped: not compatible with ${process.platform}`,
        duration: Date.now() - start,
      };
    }

    let result: { success: boolean; message: string };

    switch (spec.kind) {
      case 'brew':
        result = await installViaBrew(spec, timeout);
        break;
      case 'npm':
      case 'pnpm':
        result = await installViaNode(spec, config, timeout);
        break;
      case 'go':
        result = await installViaGo(spec, timeout);
        break;
      case 'pip':
        result = await installViaPip(spec, timeout);
        break;
      case 'download':
        result = await installViaDownload(spec, timeout);
        break;
      default:
        result = { success: false, message: `Unknown install kind: ${spec.kind}` };
    }

    // Clear binary cache after install
    clearBinaryCache();

    return {
      ...result,
      spec,
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      success: false,
      spec,
      message: `Install failed: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - start,
    };
  }
}

/**
 * Install all missing dependencies for a skill
 */
export async function installSkillDependencies(
  installSpecs: SkillInstallSpec[],
  config: SkillsSystemConfig,
): Promise<InstallResult[]> {
  const results: InstallResult[] = [];

  for (const spec of installSpecs) {
    // Check if already installed
    const alreadyInstalled = spec.bins
      ? await Promise.all(spec.bins.map(b => hasBinary(b))).then(r => r.every(Boolean))
      : false;

    if (alreadyInstalled) {
      results.push({
        success: true,
        spec,
        message: 'Already installed',
        duration: 0,
      });
      continue;
    }

    const result = await installDependency(spec, config);
    results.push(result);

    // Stop on first failure
    if (!result.success) {
      logger.warn(`[Skills/Installer] Failed to install ${spec.label || spec.id}: ${result.message}`);
      break;
    }

    logger.info(`[Skills/Installer] Installed ${spec.label || spec.id} via ${spec.kind}`);
  }

  return results;
}

// =============================================================================
// Install Methods
// =============================================================================

async function installViaBrew(
  spec: SkillInstallSpec,
  timeout: number,
): Promise<{ success: boolean; message: string }> {
  // Check if brew is available
  if (!(await hasBinary('brew'))) {
    return { success: false, message: 'Homebrew not installed' };
  }

  const formula = spec.formula || spec.package || spec.id;
  if (!formula) {
    return { success: false, message: 'No formula specified' };
  }

  try {
    await execFileAsync('brew', ['install', formula], { timeout });
    return { success: true, message: `Installed ${formula} via brew` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: `brew install ${formula} failed: ${msg}` };
  }
}

async function installViaNode(
  spec: SkillInstallSpec,
  config: SkillsSystemConfig,
  timeout: number,
): Promise<{ success: boolean; message: string }> {
  const pkg = spec.package || spec.id;
  if (!pkg) {
    return { success: false, message: 'No package specified' };
  }

  // Use configured package manager
  const pm = spec.kind === 'pnpm' ? 'pnpm' : config.install.nodeManager;

  if (!(await hasBinary(pm))) {
    return { success: false, message: `${pm} not installed` };
  }

  try {
    await execFileAsync(pm, ['install', '-g', pkg], { timeout });
    return { success: true, message: `Installed ${pkg} via ${pm}` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: `${pm} install -g ${pkg} failed: ${msg}` };
  }
}

async function installViaGo(
  spec: SkillInstallSpec,
  timeout: number,
): Promise<{ success: boolean; message: string }> {
  const mod = spec.module || spec.id;
  if (!mod) {
    return { success: false, message: 'No module specified' };
  }

  if (!(await hasBinary('go'))) {
    return { success: false, message: 'Go not installed' };
  }

  try {
    await execFileAsync('go', ['install', `${mod}@latest`], { timeout });
    return { success: true, message: `Installed ${mod} via go` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: `go install ${mod} failed: ${msg}` };
  }
}

async function installViaPip(
  spec: SkillInstallSpec,
  timeout: number,
): Promise<{ success: boolean; message: string }> {
  const pkg = spec.package || spec.id;
  if (!pkg) {
    return { success: false, message: 'No package specified' };
  }

  // Try pip3 first, then pip
  const pipBin = (await hasBinary('pip3')) ? 'pip3' : (await hasBinary('pip')) ? 'pip' : null;
  if (!pipBin) {
    return { success: false, message: 'pip not installed' };
  }

  try {
    await execFileAsync(pipBin, ['install', pkg], { timeout });
    return { success: true, message: `Installed ${pkg} via ${pipBin}` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: `${pipBin} install ${pkg} failed: ${msg}` };
  }
}

async function installViaDownload(
  spec: SkillInstallSpec,
  timeout: number,
): Promise<{ success: boolean; message: string }> {
  if (!spec.url) {
    return { success: false, message: 'No download URL specified' };
  }

  const targetDir = spec.targetDir || join(homedir(), '.glinr', 'tools', spec.id || 'download');

  try {
    await mkdir(targetDir, { recursive: true });

    // Download file
    const response = await fetch(spec.url, {
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      return { success: false, message: `Download failed: HTTP ${response.status}` };
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (spec.extract && spec.archive) {
      // Write archive and extract
      const archivePath = join(targetDir, `download.${spec.archive}`);
      await writeFile(archivePath, buffer);

      if (spec.archive === 'tar.gz' || spec.archive === 'tar.bz2') {
        const args = ['-xf', archivePath, '-C', targetDir];
        if (spec.archive === 'tar.gz') args.splice(1, 0, '-z');
        if (spec.archive === 'tar.bz2') args.splice(1, 0, '-j');
        await execFileAsync('tar', args, { timeout: 60000 });
      } else if (spec.archive === 'zip') {
        await execFileAsync('unzip', ['-o', archivePath, '-d', targetDir], { timeout: 60000 });
      }
    } else {
      // Write as executable
      const binName = spec.bins?.[0] || spec.id || 'downloaded';
      const binPath = join(targetDir, binName);
      await writeFile(binPath, buffer);
      await chmod(binPath, 0o755);
    }

    return { success: true, message: `Downloaded to ${targetDir}` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Download failed: ${msg}` };
  }
}
