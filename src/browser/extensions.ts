/**
 * Browser Extensions Support
 *
 * Chrome extension loading, CDP proxy with bypass handling,
 * user data directory / profile management, auth bridge registry,
 * and extension manifest validation.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../utils/logger.js';

// Types

export interface ExtensionManifest {
  manifest_version: number;
  name: string;
  version: string;
  description?: string;
  permissions?: string[];
  host_permissions?: string[];
  content_scripts?: Array<{
    matches: string[];
    js?: string[];
    css?: string[];
    run_at?: 'document_start' | 'document_end' | 'document_idle';
  }>;
  background?: {
    service_worker?: string;
    scripts?: string[];
  };
  action?: {
    default_popup?: string;
    default_icon?: string | Record<string, string>;
  };
}

export interface ExtensionInfo {
  id: string;
  path: string;
  manifest: ExtensionManifest;
  enabled: boolean;
  valid: boolean;
  validationErrors: string[];
}

export interface BrowserProfile {
  id: string;
  name: string;
  userDataDir: string;
  extensions: string[];
  cookies?: boolean;
  localStorage?: boolean;
  createdAt: string;
}

export interface AuthBridgeEntry {
  id: string;
  domain: string;
  provider: string; // e.g., 'google', 'github', 'custom'
  cookieNames?: string[];
  tokenStorage?: 'cookie' | 'localStorage' | 'sessionStorage';
  enabled: boolean;
}

export interface CDPProxyConfig {
  enabled: boolean;
  port: number;
  bypassDomains: string[];
  interceptPatterns: string[];
}

// Extension Manager

export class ExtensionManager {
  private extensions: Map<string, ExtensionInfo> = new Map();
  private profiles: Map<string, BrowserProfile> = new Map();
  private authBridges: Map<string, AuthBridgeEntry> = new Map();
  private cdpConfig: CDPProxyConfig;

  constructor() {
    this.cdpConfig = {
      enabled: false,
      port: parseInt(process.env.CDP_PROXY_PORT ?? '9222', 10),
      bypassDomains: [],
      interceptPatterns: [],
    };
  }

  // Chrome Extension Support

  /**
   * Load a Chrome extension from a directory
   */
  loadExtension(extensionPath: string): ExtensionInfo {
    const absPath = resolve(extensionPath);
    const manifestPath = join(absPath, 'manifest.json');

    if (!existsSync(manifestPath)) {
      throw new Error(`No manifest.json found at ${absPath}`);
    }

    const manifestRaw = readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestRaw) as ExtensionManifest;
    const validationErrors = this.validateManifest(manifest);

    const id = `ext_${manifest.name.toLowerCase().replace(/\s+/g, '-')}_${manifest.version}`;

    const info: ExtensionInfo = {
      id,
      path: absPath,
      manifest,
      enabled: true,
      valid: validationErrors.length === 0,
      validationErrors,
    };

    this.extensions.set(id, info);
    logger.info(`[Browser] Extension loaded: ${manifest.name} v${manifest.version}`, { component: 'ExtensionManager' });
    return info;
  }

  /**
   * Scan a directory for extensions
   */
  scanExtensionsDir(dir: string): ExtensionInfo[] {
    const absDir = resolve(dir);
    if (!existsSync(absDir)) return [];

    const loaded: ExtensionInfo[] = [];
    const entries = readdirSync(absDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const extPath = join(absDir, entry.name);
      if (existsSync(join(extPath, 'manifest.json'))) {
        try {
          loaded.push(this.loadExtension(extPath));
        } catch (err) {
          logger.warn(`[Browser] Failed to load extension at ${extPath}: ${err instanceof Error ? err.message : 'unknown'}`, { component: 'ExtensionManager' });
        }
      }
    }

    return loaded;
  }

  /**
   * Get Playwright launch args for loaded extensions
   */
  getExtensionLaunchArgs(): string[] {
    const enabledPaths = Array.from(this.extensions.values())
      .filter((ext) => ext.enabled && ext.valid)
      .map((ext) => ext.path);

    if (enabledPaths.length === 0) return [];

    return [
      `--disable-extensions-except=${enabledPaths.join(',')}`,
      `--load-extension=${enabledPaths.join(',')}`,
    ];
  }

  /**
   * List loaded extensions
   */
  listExtensions(): ExtensionInfo[] {
    return Array.from(this.extensions.values());
  }

  /**
   * Enable/disable an extension
   */
  toggleExtension(extensionId: string, enabled: boolean): boolean {
    const ext = this.extensions.get(extensionId);
    if (!ext) return false;
    ext.enabled = enabled;
    return true;
  }

  // Extension Manifest Validation

  validateManifest(manifest: ExtensionManifest): string[] {
    const errors: string[] = [];

    if (!manifest.manifest_version || ![2, 3].includes(manifest.manifest_version)) {
      errors.push('manifest_version must be 2 or 3');
    }

    if (!manifest.name || typeof manifest.name !== 'string') {
      errors.push('name is required and must be a string');
    }

    if (!manifest.version || !/^\d+\.\d+(\.\d+)?$/.test(manifest.version)) {
      errors.push('version must be in semver format (x.y or x.y.z)');
    }

    // Check for dangerous permissions
    const dangerousPerms = ['debugger', 'nativeMessaging', 'proxy'];
    const requestedPerms = manifest.permissions ?? [];
    for (const perm of dangerousPerms) {
      if (requestedPerms.includes(perm)) {
        errors.push(`Dangerous permission requested: ${perm}`);
      }
    }

    // Check host permissions for overly broad access
    const hostPerms = manifest.host_permissions ?? [];
    if (hostPerms.includes('<all_urls>') || hostPerms.includes('*://*/*')) {
      errors.push('Extension requests access to all URLs - review carefully');
    }

    // MV3 validation
    if (manifest.manifest_version === 3) {
      if (manifest.background?.scripts) {
        errors.push('MV3 extensions must use service_worker, not background scripts');
      }
    }

    return errors;
  }

  // User Data Directory / Profile Management

  /**
   * Create a browser profile with user data directory
   */
  createProfile(name: string, options?: { extensions?: string[] }): BrowserProfile {
    const id = `profile_${name.toLowerCase().replace(/\s+/g, '-')}`;
    const userDataDir = join(homedir(), '.profclaw', 'browser-profiles', id);

    const profile: BrowserProfile = {
      id,
      name,
      userDataDir,
      extensions: options?.extensions ?? [],
      cookies: true,
      localStorage: true,
      createdAt: new Date().toISOString(),
    };

    this.profiles.set(id, profile);
    logger.info(`[Browser] Profile created: ${name} at ${userDataDir}`, { component: 'ExtensionManager' });
    return profile;
  }

  /**
   * Get a browser profile
   */
  getProfile(profileId: string): BrowserProfile | undefined {
    return this.profiles.get(profileId);
  }

  /**
   * List all profiles
   */
  listProfiles(): BrowserProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Delete a profile (metadata only, doesn't delete user data dir)
   */
  deleteProfile(profileId: string): boolean {
    return this.profiles.delete(profileId);
  }

  // Auth Bridge Registry

  /**
   * Register an auth bridge for a domain
   */
  registerAuthBridge(entry: AuthBridgeEntry): void {
    this.authBridges.set(entry.id, entry);
    logger.info(`[Browser] Auth bridge registered: ${entry.domain} via ${entry.provider}`, { component: 'ExtensionManager' });
  }

  /**
   * Get auth bridge for a domain
   */
  getAuthBridgeForDomain(domain: string): AuthBridgeEntry | undefined {
    return Array.from(this.authBridges.values()).find(
      (b) => b.enabled && (b.domain === domain || domain.endsWith(`.${b.domain}`)),
    );
  }

  /**
   * List auth bridges
   */
  listAuthBridges(): AuthBridgeEntry[] {
    return Array.from(this.authBridges.values());
  }

  /**
   * Remove an auth bridge
   */
  removeAuthBridge(id: string): boolean {
    return this.authBridges.delete(id);
  }

  // CDP Proxy Configuration

  /**
   * Update CDP proxy configuration
   */
  setCDPConfig(config: Partial<CDPProxyConfig>): void {
    this.cdpConfig = { ...this.cdpConfig, ...config };
    logger.info(`[Browser] CDP config updated: port=${this.cdpConfig.port}, enabled=${this.cdpConfig.enabled}`, { component: 'ExtensionManager' });
  }

  /**
   * Get current CDP proxy configuration
   */
  getCDPConfig(): CDPProxyConfig {
    return { ...this.cdpConfig };
  }

  /**
   * Add a domain to the CDP bypass list
   */
  addBypassDomain(domain: string): void {
    if (!this.cdpConfig.bypassDomains.includes(domain)) {
      this.cdpConfig.bypassDomains.push(domain);
    }
  }

  /**
   * Remove a domain from the CDP bypass list
   */
  removeBypassDomain(domain: string): boolean {
    const idx = this.cdpConfig.bypassDomains.indexOf(domain);
    if (idx >= 0) {
      this.cdpConfig.bypassDomains.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * Check if a domain should bypass the CDP proxy
   */
  shouldBypass(domain: string): boolean {
    return this.cdpConfig.bypassDomains.some(
      (d) => domain === d || domain.endsWith(`.${d}`),
    );
  }
}

// Singleton

let extensionManager: ExtensionManager | null = null;

export function getExtensionManager(): ExtensionManager {
  if (!extensionManager) {
    extensionManager = new ExtensionManager();
  }
  return extensionManager;
}
