/**
 * Skill Marketplace Client
 *
 * Enables discovering, installing, and updating skills from remote registries.
 * Supports the profClaw skill registry (future) and GitHub-hosted skills.
 *
 * Skills are installed to ~/.profclaw/skills/<name>/SKILL.md
 */

import { join } from 'node:path';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { logger } from '../utils/logger.js';

// Types

export interface MarketplaceSkill {
  name: string;
  description: string;
  version: string;
  author: string;
  category: string;
  tags: string[];
  /** Number of installs */
  installs: number;
  /** Average rating 0-5 */
  rating: number;
  /** Source URL (GitHub raw content, registry API, etc.) */
  sourceUrl: string;
  /** When the skill was last updated */
  updatedAt: string;
  /** Whether this skill is already installed locally */
  installed?: boolean;
  /** Local version if installed */
  installedVersion?: string;
}

export interface MarketplaceSearchParams {
  query?: string;
  category?: string;
  tag?: string;
  sortBy?: 'installs' | 'rating' | 'updated' | 'name';
  limit?: number;
  offset?: number;
}

export interface MarketplaceRegistry {
  name: string;
  url: string;
  enabled: boolean;
}

export interface InstallResult {
  success: boolean;
  skillName: string;
  version?: string;
  installPath?: string;
  error?: string;
}

// Default registries

const DEFAULT_REGISTRIES: MarketplaceRegistry[] = [
  {
    name: 'profclaw-community',
    url: 'https://registry.profclaw.ai/api/v1',
    enabled: true,
  },
  {
    name: 'clawhub',
    url: 'https://clawhub.dev/api/v1',
    enabled: true,
  },
];

// Marketplace Client

const MANAGED_SKILLS_DIR = join(homedir(), '.profclaw', 'skills');

export class MarketplaceClient {
  private registries: MarketplaceRegistry[];

  constructor(registries?: MarketplaceRegistry[]) {
    this.registries = registries || [...DEFAULT_REGISTRIES];
  }

  /**
   * Search for skills across all enabled registries.
   */
  async search(params: MarketplaceSearchParams = {}): Promise<MarketplaceSkill[]> {
    const results: MarketplaceSkill[] = [];

    for (const registry of this.registries.filter((r) => r.enabled)) {
      try {
        const skills = await this.searchRegistry(registry, params);
        results.push(...skills);
      } catch (error) {
        logger.warn(`[Marketplace] Failed to search ${registry.name}: ${error instanceof Error ? error.message : 'Unknown'}`);
      }
    }

    // Sort results
    const sortBy = params.sortBy || 'installs';
    results.sort((a, b) => {
      switch (sortBy) {
        case 'installs': return b.installs - a.installs;
        case 'rating': return b.rating - a.rating;
        case 'updated': return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        case 'name': return a.name.localeCompare(b.name);
        default: return 0;
      }
    });

    return results.slice(0, params.limit || 50);
  }

  /**
   * Install a skill from a registry or direct URL.
   */
  async install(source: string): Promise<InstallResult> {
    try {
      let skillContent: string;
      let skillName: string;

      if (source.startsWith('http://') || source.startsWith('https://')) {
        // Direct URL install
        const result = await this.fetchSkillFromUrl(source);
        skillContent = result.content;
        skillName = result.name;
      } else if (source.includes('/')) {
        // GitHub shorthand: owner/repo or owner/repo/path
        const result = await this.fetchSkillFromGitHub(source);
        skillContent = result.content;
        skillName = result.name;
      } else {
        // Registry skill name
        const result = await this.fetchSkillFromRegistry(source);
        skillContent = result.content;
        skillName = result.name;
      }

      // Install to managed skills directory
      const installDir = join(MANAGED_SKILLS_DIR, skillName);
      await mkdir(installDir, { recursive: true });
      const installPath = join(installDir, 'SKILL.md');
      await writeFile(installPath, skillContent, 'utf-8');

      // Parse version from frontmatter
      const versionMatch = skillContent.match(/version:\s*(.+)/);
      const version = versionMatch ? versionMatch[1].trim() : 'unknown';

      logger.info(`[Marketplace] Installed skill: ${skillName} v${version} to ${installPath}`);

      return {
        success: true,
        skillName,
        version,
        installPath,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Install failed';
      logger.error(`[Marketplace] Install failed for ${source}: ${msg}`);
      return {
        success: false,
        skillName: source,
        error: msg,
      };
    }
  }

  /**
   * Uninstall a managed skill.
   */
  async uninstall(skillName: string): Promise<boolean> {
    const skillDir = join(MANAGED_SKILLS_DIR, skillName);
    try {
      await rm(skillDir, { recursive: true });
      logger.info(`[Marketplace] Uninstalled skill: ${skillName}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check for updates to installed managed skills.
   */
  async checkUpdates(): Promise<Array<{ name: string; currentVersion: string; latestVersion: string }>> {
    const updates: Array<{ name: string; currentVersion: string; latestVersion: string }> = [];

    try {
      const { readdir } = await import('node:fs/promises');
      const dirs = await readdir(MANAGED_SKILLS_DIR).catch(() => [] as string[]);

      for (const dir of dirs) {
        const skillPath = join(MANAGED_SKILLS_DIR, dir, 'SKILL.md');
        try {
          const content = await readFile(skillPath, 'utf-8');
          const versionMatch = content.match(/version:\s*(.+)/);
          const currentVersion = versionMatch ? versionMatch[1].trim() : 'unknown';

          // Check registry for latest version
          const latest = await this.getLatestVersion(dir);
          if (latest && latest !== currentVersion) {
            updates.push({ name: dir, currentVersion, latestVersion: latest });
          }
        } catch {
          // Skip skills we can't read
        }
      }
    } catch {
      // No managed skills directory
    }

    return updates;
  }

  /**
   * Add a custom registry.
   */
  addRegistry(registry: MarketplaceRegistry): void {
    const existing = this.registries.findIndex((r) => r.name === registry.name);
    if (existing >= 0) {
      this.registries[existing] = registry;
    } else {
      this.registries.push(registry);
    }
  }

  /**
   * List configured registries.
   */
  listRegistries(): MarketplaceRegistry[] {
    return [...this.registries];
  }

  // Private methods

  private async searchRegistry(
    registry: MarketplaceRegistry,
    params: MarketplaceSearchParams,
  ): Promise<MarketplaceSkill[]> {
    const url = new URL(`${registry.url}/skills`);
    if (params.query) url.searchParams.set('q', params.query);
    if (params.category) url.searchParams.set('category', params.category);
    if (params.tag) url.searchParams.set('tag', params.tag);
    if (params.limit) url.searchParams.set('limit', String(params.limit));
    if (params.offset) url.searchParams.set('offset', String(params.offset));

    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': 'profClaw/2.0 Marketplace' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Registry ${registry.name} returned ${response.status}`);
    }

    const data = await response.json() as { skills?: MarketplaceSkill[] };
    return data.skills || [];
  }

  private async fetchSkillFromUrl(url: string): Promise<{ content: string; name: string }> {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'profClaw/2.0 Marketplace' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch skill: HTTP ${response.status}`);
    }

    const content = await response.text();
    const nameMatch = content.match(/name:\s*(.+)/);
    const name = nameMatch ? nameMatch[1].trim() : `skill-${Date.now()}`;

    return { content, name };
  }

  private async fetchSkillFromGitHub(shorthand: string): Promise<{ content: string; name: string }> {
    // Parse: owner/repo or owner/repo/path/to/SKILL.md
    const parts = shorthand.split('/');
    if (parts.length < 2) {
      throw new Error(`Invalid GitHub shorthand: ${shorthand}. Use owner/repo or owner/repo/path`);
    }

    const owner = parts[0];
    const repo = parts[1];
    const path = parts.length > 2 ? parts.slice(2).join('/') : 'SKILL.md';

    const url = `https://raw.githubusercontent.com/${owner}/${repo}/main/${path}`;
    return this.fetchSkillFromUrl(url);
  }

  private async fetchSkillFromRegistry(name: string): Promise<{ content: string; name: string }> {
    for (const registry of this.registries.filter((r) => r.enabled)) {
      try {
        const url = `${registry.url}/skills/${encodeURIComponent(name)}/content`;
        const response = await fetch(url, {
          headers: { 'User-Agent': 'profClaw/2.0 Marketplace' },
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          const content = await response.text();
          return { content, name };
        }
      } catch {
        // Try next registry
      }
    }

    throw new Error(`Skill "${name}" not found in any registry`);
  }

  private async getLatestVersion(skillName: string): Promise<string | null> {
    for (const registry of this.registries.filter((r) => r.enabled)) {
      try {
        const url = `${registry.url}/skills/${encodeURIComponent(skillName)}`;
        const response = await fetch(url, {
          headers: { 'User-Agent': 'profClaw/2.0 Marketplace' },
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          const data = await response.json() as { version?: string };
          return data.version || null;
        }
      } catch {
        // Try next registry
      }
    }

    return null;
  }
}

// Singleton
let marketplaceInstance: MarketplaceClient | null = null;

export function getMarketplace(): MarketplaceClient {
  if (!marketplaceInstance) {
    marketplaceInstance = new MarketplaceClient();
  }
  return marketplaceInstance;
}
