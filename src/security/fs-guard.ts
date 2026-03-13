/**
 * Filesystem Guard
 *
 * Prevents path traversal and unauthorized filesystem access.
 * Features:
 * - Path normalization (resolve + normalize to eliminate ../)
 * - Symlink resolution to detect symlink-based escapes
 * - Per-mode allowlists (pico/mini/pro)
 * - Configurable blocked paths and patterns
 * - Home directory scoping
 */

import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { logger } from '../utils/logger.js';
import type { GuardResult, FsGuardConfig, FsOperation } from './types.js';

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_BLOCKED_PATHS = [
  '/etc/passwd',
  '/etc/shadow',
  '/etc/sudoers',
  '/etc/master.passwd',
  path.join(os.homedir(), '.ssh'),
  path.join(os.homedir(), '.gnupg'),
  path.join(os.homedir(), '.aws', 'credentials'),
  path.join(os.homedir(), '.config', 'gcloud'),
  '/proc',
  '/sys',
  '/dev',
];

const DEFAULT_BLOCKED_PATTERNS = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.staging',
  '.env.development',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'id_dsa',
  '.pem',
  '.key',
  'credentials.json',
  'service-account.json',
];

const DEFAULT_CONFIG: FsGuardConfig = {
  enabled: true,
  allowedPaths: [process.cwd(), os.tmpdir()],
  blockedPaths: DEFAULT_BLOCKED_PATHS,
  followSymlinks: true,
  blockedPatterns: DEFAULT_BLOCKED_PATTERNS,
};

// =============================================================================
// Filesystem Guard
// =============================================================================

export class FsGuard {
  private config: FsGuardConfig;
  private normalizedAllowed: string[];
  private normalizedBlocked: string[];

  constructor(config?: Partial<FsGuardConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Pre-normalize paths for comparison
    this.normalizedAllowed = this.config.allowedPaths.map((p) =>
      path.resolve(path.normalize(p)),
    );
    this.normalizedBlocked = this.config.blockedPaths.map((p) =>
      path.resolve(path.normalize(p)),
    );
  }

  /**
   * Validate a file path before access
   */
  async validatePath(filePath: string, operation: FsOperation = 'read'): Promise<GuardResult> {
    if (!this.config.enabled) {
      return { allowed: true, risk: 'LOW' };
    }

    // Normalize the input path
    const normalized = path.resolve(path.normalize(filePath));

    // Check blocked patterns (filename-level)
    const basename = path.basename(normalized);
    for (const pattern of this.config.blockedPatterns) {
      if (basename === pattern || basename.startsWith(pattern)) {
        logger.warn(`[FsGuard] Blocked pattern match: ${basename}`, { component: 'FsGuard' });
        return {
          allowed: false,
          reason: `Access to ${basename} is blocked by security policy`,
          risk: 'HIGH',
        };
      }
    }

    // Check explicitly blocked paths
    for (const blocked of this.normalizedBlocked) {
      if (normalized === blocked || normalized.startsWith(blocked + path.sep)) {
        logger.warn(`[FsGuard] Blocked path: ${normalized}`, { component: 'FsGuard' });
        return {
          allowed: false,
          reason: `Access to ${normalized} is blocked by security policy`,
          risk: 'HIGH',
        };
      }
    }

    // For write/delete operations, enforce stricter checks
    if (operation === 'write' || operation === 'delete') {
      if (!this.isInAllowedPath(normalized)) {
        return {
          allowed: false,
          reason: `Write/delete operations restricted to allowed paths`,
          risk: 'HIGH',
        };
      }
    }

    // Resolve symlinks if configured
    if (this.config.followSymlinks) {
      try {
        const realPath = await this.safeRealpath(normalized);
        if (realPath && realPath !== normalized) {
          // The symlink target differs - re-validate the real path
          return this.validateResolvedPath(realPath, operation);
        }
      } catch {
        // File doesn't exist yet (write operation) - that's OK
        // But verify the parent directory is in allowed paths
        if (operation === 'write') {
          const parentDir = path.dirname(normalized);
          if (!this.isInAllowedPath(parentDir)) {
            return {
              allowed: false,
              reason: `Parent directory not in allowed paths`,
              risk: 'HIGH',
            };
          }
        }
      }
    }

    // For read/list, just warn if outside allowed paths but still allow
    // (existing code may depend on this permissive behavior)
    if ((operation === 'read' || operation === 'list') && !this.isInAllowedPath(normalized)) {
      logger.info(`[FsGuard] Read outside allowed paths: ${normalized}`, { component: 'FsGuard' });
    }

    return { allowed: true, risk: 'LOW' };
  }

  /**
   * Check if a path is within any of the allowed paths
   */
  isInAllowedPath(normalizedPath: string): boolean {
    return this.normalizedAllowed.some(
      (allowed) => normalizedPath === allowed || normalizedPath.startsWith(allowed + path.sep),
    );
  }

  /**
   * Get current config
   */
  getConfig(): FsGuardConfig {
    return { ...this.config };
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  /**
   * Validate a symlink-resolved path
   */
  private validateResolvedPath(realPath: string, operation: FsOperation): GuardResult {
    // Check blocked paths on the resolved path
    for (const blocked of this.normalizedBlocked) {
      if (realPath === blocked || realPath.startsWith(blocked + path.sep)) {
        logger.warn(`[FsGuard] Symlink resolves to blocked path: ${realPath}`, { component: 'FsGuard' });
        return {
          allowed: false,
          reason: `Symlink target ${realPath} is blocked by security policy`,
          risk: 'CRITICAL',
        };
      }
    }

    // Check blocked patterns on resolved path
    const basename = path.basename(realPath);
    for (const pattern of this.config.blockedPatterns) {
      if (basename === pattern || basename.startsWith(pattern)) {
        return {
          allowed: false,
          reason: `Symlink target matches blocked pattern: ${basename}`,
          risk: 'CRITICAL',
        };
      }
    }

    // For write/delete, check allowed paths
    if ((operation === 'write' || operation === 'delete') && !this.isInAllowedPath(realPath)) {
      return {
        allowed: false,
        reason: `Symlink target not in allowed paths for ${operation}`,
        risk: 'HIGH',
      };
    }

    return { allowed: true, risk: 'LOW' };
  }

  /**
   * Safely resolve realpath, returning null if file doesn't exist
   */
  private async safeRealpath(filePath: string): Promise<string | null> {
    try {
      return await fs.realpath(filePath);
    } catch {
      return null;
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: FsGuard | null = null;

export function getFsGuard(): FsGuard | null {
  return instance;
}

export function createFsGuard(config?: Partial<FsGuardConfig>): FsGuard {
  instance = new FsGuard(config);
  return instance;
}
