/**
 * File Locking Utilities
 *
 * Provides safe concurrent access to config and data files
 * using proper-lockfile for cross-process synchronization.
 *
 * Features:
 * - Automatic retry with backoff on lock contention
 * - Stale lock detection and recovery
 * - Clean async/await API
 * - TypeScript-safe with generics
 */

import lockfile from 'proper-lockfile';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

/**
 * Lock options
 */
export interface LockOptions {
  /** Time to wait before declaring lock stale (ms) */
  stale?: number;
  /** Retry interval (ms) */
  retries?: number | { retries: number; factor?: number; minTimeout?: number; maxTimeout?: number };
  /** Whether to wait for lock */
  wait?: boolean;
  /** Update interval for lock freshness (ms) */
  update?: number;
}

const DEFAULT_LOCK_OPTIONS: LockOptions = {
  stale: 10000, // 10 seconds
  retries: {
    retries: 5,
    factor: 1.5,
    minTimeout: 100,
    maxTimeout: 2000,
  },
  update: 5000, // 5 seconds
};

/**
 * Ensure file exists before locking
 * (proper-lockfile requires the file to exist)
 */
function ensureFileExists(filePath: string): void {
  if (!existsSync(filePath)) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, '');
  }
}

/**
 * Acquire a lock on a file
 * Returns a release function that must be called when done
 */
export async function acquireLock(
  filePath: string,
  options?: LockOptions
): Promise<() => Promise<void>> {
  ensureFileExists(filePath);

  const opts = { ...DEFAULT_LOCK_OPTIONS, ...options };

  try {
    const release = await lockfile.lock(filePath, {
      stale: opts.stale,
      retries: opts.retries,
      update: opts.update,
    });

    return release;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOCKED') {
      throw new Error(`File is locked by another process: ${filePath}`);
    }
    throw error;
  }
}

/**
 * Check if a file is currently locked
 */
export async function isLocked(filePath: string): Promise<boolean> {
  if (!existsSync(filePath)) {
    return false;
  }

  try {
    return await lockfile.check(filePath);
  } catch {
    return false;
  }
}

/**
 * Execute a function while holding a file lock
 * Automatically releases the lock when done or on error
 */
export async function withLock<T>(
  filePath: string,
  fn: () => Promise<T>,
  options?: LockOptions
): Promise<T> {
  const release = await acquireLock(filePath, options);

  try {
    return await fn();
  } finally {
    await release();
  }
}

/**
 * Read a JSON file with locking
 */
export async function readJsonWithLock<T>(
  filePath: string,
  options?: LockOptions
): Promise<T | null> {
  if (!existsSync(filePath)) {
    return null;
  }

  return withLock(
    filePath,
    async () => {
      const { readFileSync } = await import('fs');
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as T;
    },
    options
  );
}

/**
 * Write a JSON file with locking
 */
export async function writeJsonWithLock<T>(
  filePath: string,
  data: T,
  options?: LockOptions
): Promise<void> {
  await withLock(
    filePath,
    async () => {
      const { writeFileSync } = await import('fs');
      writeFileSync(filePath, JSON.stringify(data, null, 2));
    },
    options
  );
}

/**
 * Update a JSON file atomically with locking
 * Reads current value, applies updater, writes result
 */
export async function updateJsonWithLock<T>(
  filePath: string,
  updater: (current: T | null) => T,
  options?: LockOptions
): Promise<T> {
  return withLock(
    filePath,
    async () => {
      const { readFileSync, writeFileSync } = await import('fs');

      let current: T | null = null;
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf-8');
        if (content.trim()) {
          current = JSON.parse(content) as T;
        }
      }

      const updated = updater(current);
      writeFileSync(filePath, JSON.stringify(updated, null, 2));
      return updated;
    },
    options
  );
}

/**
 * Multi-file lock for transactions spanning multiple files
 * All files are locked in a deterministic order to prevent deadlocks
 */
export async function withMultiLock<T>(
  filePaths: string[],
  fn: () => Promise<T>,
  options?: LockOptions
): Promise<T> {
  // Sort paths to prevent deadlocks
  const sortedPaths = [...filePaths].sort();
  const releases: Array<() => Promise<void>> = [];

  try {
    // Acquire all locks in order
    for (const filePath of sortedPaths) {
      const release = await acquireLock(filePath, options);
      releases.push(release);
    }

    // Execute function
    return await fn();
  } finally {
    // Release all locks in reverse order
    for (const release of releases.reverse()) {
      await release().catch(console.error);
    }
  }
}

/**
 * Lock file path for a given config file
 * Uses a .lock suffix by default
 */
export function getLockFilePath(filePath: string): string {
  return `${filePath}.lock`;
}

/**
 * Clean up stale lock files
 * Use with caution - only for recovery scenarios
 */
export async function cleanupStaleLock(filePath: string): Promise<boolean> {
  try {
    const isStale = await lockfile.check(filePath, { stale: 0 });
    if (!isStale) {
      // Not locked or not stale, nothing to do
      return false;
    }

    // Force unlock
    await lockfile.unlock(filePath, { realpath: false });
    console.log(`[FileLock] Cleaned up stale lock: ${filePath}`);
    return true;
  } catch (error) {
    // Lock file might not exist
    return false;
  }
}

/**
 * Wrapper for settings file operations
 */
export class LockedConfigFile<T> {
  constructor(
    private filePath: string,
    private options?: LockOptions
  ) {}

  async read(): Promise<T | null> {
    return readJsonWithLock<T>(this.filePath, this.options);
  }

  async write(data: T): Promise<void> {
    return writeJsonWithLock(this.filePath, data, this.options);
  }

  async update(updater: (current: T | null) => T): Promise<T> {
    return updateJsonWithLock(this.filePath, updater, this.options);
  }

  async isLocked(): Promise<boolean> {
    return isLocked(this.filePath);
  }
}
