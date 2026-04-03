/**
 * Auto-Update Check
 *
 * Checks npm registry for newer versions of profclaw and caches the result
 * for 24 hours so startup is not meaningfully delayed.
 * Cache file: .profclaw/update-check.json
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const NPM_REGISTRY = 'https://registry.npmjs.org';

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl?: string;
}

interface UpdateCache {
  checkedAt: number;
  info: UpdateInfo;
}

function getCacheDir(): string {
  return path.join(process.cwd(), '.profclaw');
}

function getCachePath(): string {
  return path.join(getCacheDir(), 'update-check.json');
}

function readCache(): UpdateCache | null {
  try {
    const raw = fs.readFileSync(getCachePath(), 'utf8');
    return JSON.parse(raw) as UpdateCache;
  } catch {
    return null;
  }
}

function writeCache(info: UpdateInfo): void {
  try {
    const dir = getCacheDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const cache: UpdateCache = { checkedAt: Date.now(), info };
    fs.writeFileSync(getCachePath(), JSON.stringify(cache, null, 2), 'utf8');
  } catch {
    // Non-fatal — update check is best-effort
  }
}

function isCacheValid(cache: UpdateCache): boolean {
  return Date.now() - cache.checkedAt < CACHE_TTL_MS;
}

function getCurrentVersion(packageName: string): string {
  try {
    // Try to read from the package.json that ships with the installed package
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve(`${packageName}/package.json`);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version: string };
    return pkg.version;
  } catch {
    // Fallback: read from our own package.json (works in dev / monorepo)
    try {
      const selfPath = path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../../package.json',
      );
      const pkg = JSON.parse(fs.readFileSync(selfPath, 'utf8')) as {
        version: string;
        name: string;
      };
      return pkg.version;
    } catch {
      return '0.0.0';
    }
  }
}

function getPackageName(): string {
  try {
    const selfPath = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      '../../package.json',
    );
    const pkg = JSON.parse(fs.readFileSync(selfPath, 'utf8')) as { name: string };
    return pkg.name;
  } catch {
    return 'profclaw';
  }
}

/**
 * Compare two semver strings.
 * Returns true when `latest` is strictly newer than `current`.
 */
function isNewerVersion(current: string, latest: string): boolean {
  const parse = (v: string): number[] =>
    v
      .replace(/^[^0-9]*/, '')
      .split('.')
      .map(n => parseInt(n, 10) || 0);

  const [cMaj, cMin, cPatch] = parse(current);
  const [lMaj, lMin, lPatch] = parse(latest);

  if (lMaj !== cMaj) return (lMaj ?? 0) > (cMaj ?? 0);
  if (lMin !== cMin) return (lMin ?? 0) > (cMin ?? 0);
  return (lPatch ?? 0) > (cPatch ?? 0);
}

/**
 * Fetch the latest version from the npm registry.
 * Throws if the network request fails.
 */
async function fetchLatestVersion(packageName: string): Promise<string> {
  const url = `${NPM_REGISTRY}/${encodeURIComponent(packageName)}/latest`;

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`npm registry returned ${response.status} for ${packageName}`);
  }

  const data = (await response.json()) as { version: string };
  return data.version;
}

/**
 * Check whether a newer version of `packageName` is available on npm.
 * Results are cached for 24 hours in .profclaw/update-check.json.
 */
export async function checkForUpdate(packageName?: string): Promise<UpdateInfo> {
  const pkg = packageName ?? getPackageName();
  const currentVersion = getCurrentVersion(pkg);

  // Serve from cache if still fresh
  const cached = readCache();
  if (cached && isCacheValid(cached) && cached.info.currentVersion === currentVersion) {
    return cached.info;
  }

  try {
    const latestVersion = await fetchLatestVersion(pkg);
    const updateAvailable = isNewerVersion(currentVersion, latestVersion);

    const info: UpdateInfo = {
      currentVersion,
      latestVersion,
      updateAvailable,
      releaseUrl: updateAvailable
        ? `https://www.npmjs.com/package/${pkg}/v/${latestVersion}`
        : undefined,
    };

    writeCache(info);
    return info;
  } catch {
    // Network failure — return a no-update result without caching
    return {
      currentVersion,
      latestVersion: currentVersion,
      updateAvailable: false,
    };
  }
}

/**
 * Format an update notification message suitable for printing to the terminal.
 */
export function formatUpdateMessage(info: UpdateInfo): string {
  if (!info.updateAvailable) return '';

  const parts = [
    `Update available: ${info.currentVersion} → ${info.latestVersion}.`,
    `Run: npm i -g ${getPackageName()}`,
  ];

  if (info.releaseUrl) {
    parts.push(`  ${info.releaseUrl}`);
  }

  return parts.join('  ');
}
