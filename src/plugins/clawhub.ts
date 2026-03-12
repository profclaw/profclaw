/**
 * ClawHub Integration Client
 *
 * Fetches and installs skills from OpenClaw's ClawHub marketplace.
 * ClawHub skills use the same SKILL.md format that profClaw supports natively.
 *
 * Strategy: Use GitHub search + raw content APIs to discover and download
 * OpenClaw-compatible skills, since ClawHub's skills are published as
 * GitHub repos/directories.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const MANAGED_SKILLS_DIR = join(homedir(), '.profclaw', 'skills');
const CLAWHUB_STATE_FILE = join(homedir(), '.profclaw', 'clawhub.json');
const GITHUB_API = 'https://api.github.com';

// =============================================================================
// Types
// =============================================================================

export interface ClawHubSkill {
  name: string;
  description: string;
  author: string;
  repo: string;
  path: string;
  stars: number;
  lastUpdated: string;
  tags: string[];
  source: 'clawhub' | 'github' | 'awesome-list';
  installUrl: string;
}

export interface ClawHubInstalledSkill {
  name: string;
  repo: string;
  installedAt: string;
  localPath: string;
  version?: string;
}

interface ClawHubState {
  installed: ClawHubInstalledSkill[];
  cache: ClawHubSkill[];
  lastSearch: string | null;
  cacheExpiry: string | null;
}

// GitHub API response types
interface GitHubSearchItem {
  name: string;
  path: string;
  repository: {
    full_name: string;
    description: string;
    stargazers_count: number;
    updated_at: string;
    owner: { login: string };
  };
  html_url: string;
}

interface GitHubRepoContent {
  name: string;
  path: string;
  type: 'file' | 'dir';
  download_url: string | null;
}

// =============================================================================
// ClawHub Client
// =============================================================================

class ClawHubClient {
  private state: ClawHubState;
  private githubToken: string | undefined;

  constructor() {
    this.state = this.loadState();
    this.githubToken = process.env.GITHUB_TOKEN;
  }

  /**
   * Search for OpenClaw-compatible skills on GitHub
   */
  async search(query?: string): Promise<ClawHubSkill[]> {
    // Check cache first (valid for 1 hour)
    if (this.state.cacheExpiry && new Date(this.state.cacheExpiry) > new Date() && !query) {
      return this.state.cache;
    }

    const skills: ClawHubSkill[] = [];

    // Strategy 1: Search GitHub for SKILL.md files in openclaw/community repos
    const ghSkills = await this.searchGitHub(query);
    skills.push(...ghSkills);

    // Strategy 2: Fetch from awesome-openclaw-skills curated list
    const awesomeSkills = await this.fetchAwesomeList();
    skills.push(...awesomeSkills);

    // Deduplicate by name
    const seen = new Set<string>();
    const deduplicated = skills.filter((s) => {
      const key = `${s.author}/${s.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Update cache
    this.state.cache = deduplicated;
    this.state.lastSearch = new Date().toISOString();
    this.state.cacheExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h
    this.saveState();

    return deduplicated;
  }

  /**
   * Install a skill from ClawHub/GitHub into ~/.profclaw/skills/
   */
  async install(skill: ClawHubSkill): Promise<ClawHubInstalledSkill> {
    // Check if already installed
    const existing = this.state.installed.find((s) => s.name === skill.name);
    if (existing) {
      throw new Error(`Skill "${skill.name}" is already installed at ${existing.localPath}`);
    }

    // Ensure managed skills directory exists
    if (!existsSync(MANAGED_SKILLS_DIR)) {
      mkdirSync(MANAGED_SKILLS_DIR, { recursive: true });
    }

    // Create skill directory
    const skillDir = join(MANAGED_SKILLS_DIR, skill.name);
    if (!existsSync(skillDir)) {
      mkdirSync(skillDir, { recursive: true });
    }

    // Download SKILL.md from GitHub
    const skillMdContent = await this.downloadSkillMd(skill);
    writeFileSync(join(skillDir, 'SKILL.md'), skillMdContent);

    const installed: ClawHubInstalledSkill = {
      name: skill.name,
      repo: skill.repo,
      installedAt: new Date().toISOString(),
      localPath: skillDir,
    };

    this.state.installed.push(installed);
    this.saveState();

    return installed;
  }

  /**
   * Uninstall a ClawHub skill
   */
  uninstall(skillName: string): void {
    const index = this.state.installed.findIndex((s) => s.name === skillName);
    if (index === -1) {
      throw new Error(`Skill "${skillName}" is not installed from ClawHub`);
    }

    const skill = this.state.installed[index];

    // Remove skill directory
    if (existsSync(skill.localPath)) {
      rmSync(skill.localPath, { recursive: true, force: true });
    }

    this.state.installed.splice(index, 1);
    this.saveState();
  }

  /**
   * List installed ClawHub skills
   */
  listInstalled(): ClawHubInstalledSkill[] {
    return [...this.state.installed];
  }

  /**
   * Get featured/popular skills
   */
  async getFeatured(): Promise<ClawHubSkill[]> {
    const all = await this.search();
    return all.sort((a, b) => b.stars - a.stars).slice(0, 20);
  }

  // ===========================================================================
  // Private: GitHub Search
  // ===========================================================================

  private async searchGitHub(query?: string): Promise<ClawHubSkill[]> {
    const skills: ClawHubSkill[] = [];
    const searchQuery = query
      ? `SKILL.md ${query} in:path,file`
      : 'SKILL.md openclaw in:path,file language:markdown';

    try {
      const url = `${GITHUB_API}/search/code?q=${encodeURIComponent(searchQuery)}&per_page=30`;
      const response = await this.githubFetch(url);

      if (!response.ok) {
        // Rate limited or unauthorized - return empty
        return skills;
      }

      const data = await response.json() as { items: GitHubSearchItem[] };

      for (const item of data.items || []) {
        // Only include SKILL.md files
        if (!item.name.endsWith('SKILL.md')) continue;

        // Extract skill name from path (parent directory name)
        const pathParts = item.path.split('/');
        const skillName = pathParts.length > 1
          ? pathParts[pathParts.length - 2]
          : item.repository.full_name.split('/')[1];

        skills.push({
          name: skillName,
          description: item.repository.description || '',
          author: item.repository.owner.login,
          repo: item.repository.full_name,
          path: item.path,
          stars: item.repository.stargazers_count,
          lastUpdated: item.repository.updated_at,
          tags: [],
          source: 'github',
          installUrl: `https://raw.githubusercontent.com/${item.repository.full_name}/main/${item.path}`,
        });
      }
    } catch {
      // GitHub search failed - return what we have
    }

    return skills;
  }

  private async fetchAwesomeList(): Promise<ClawHubSkill[]> {
    const skills: ClawHubSkill[] = [];

    try {
      // Try to fetch from awesome-openclaw-skills repo
      const url = `${GITHUB_API}/repos/VoltAgent/awesome-openclaw-skills/contents/README.md`;
      const response = await this.githubFetch(url);

      if (!response.ok) return skills;

      const data = await response.json() as { download_url: string | null };
      if (!data.download_url) return skills;

      const content = await (await fetch(data.download_url)).text();

      // Parse markdown links that look like skill references
      // Pattern: - [Skill Name](url) - description
      const linkRegex = /- \[([^\]]+)\]\(([^)]+)\)\s*[-:]?\s*(.*)/g;
      let linkMatch: RegExpExecArray | null;

      while ((linkMatch = linkRegex.exec(content)) !== null) {
        const [, name, repoUrl, description] = linkMatch;
        if (!repoUrl.includes('github.com')) continue;

        const repoParts = repoUrl.replace('https://github.com/', '').split('/');
        if (repoParts.length < 2) continue;

        skills.push({
          name: name.toLowerCase().replace(/\s+/g, '-'),
          description: description || name,
          author: repoParts[0],
          repo: `${repoParts[0]}/${repoParts[1]}`,
          path: 'SKILL.md',
          stars: 0,
          lastUpdated: '',
          tags: [],
          source: 'awesome-list',
          installUrl: `https://raw.githubusercontent.com/${repoParts[0]}/${repoParts[1]}/main/SKILL.md`,
        });
      }
    } catch {
      // Awesome list fetch failed - that's fine
    }

    return skills;
  }

  private async downloadSkillMd(skill: ClawHubSkill): Promise<string> {
    // Try the installUrl first
    const urls = [
      skill.installUrl,
      `https://raw.githubusercontent.com/${skill.repo}/main/${skill.path}`,
      `https://raw.githubusercontent.com/${skill.repo}/master/${skill.path}`,
    ];

    for (const url of urls) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          return await response.text();
        }
      } catch {
        continue;
      }
    }

    throw new Error(`Failed to download SKILL.md for ${skill.name} from ${skill.repo}`);
  }

  private async githubFetch(url: string): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'profclaw-clawhub-client',
    };

    if (this.githubToken) {
      headers.Authorization = `Bearer ${this.githubToken}`;
    }

    return fetch(url, { headers });
  }

  // ===========================================================================
  // State persistence
  // ===========================================================================

  private loadState(): ClawHubState {
    try {
      if (existsSync(CLAWHUB_STATE_FILE)) {
        const data = readFileSync(CLAWHUB_STATE_FILE, 'utf-8');
        return JSON.parse(data) as ClawHubState;
      }
    } catch {
      // Corrupted state, start fresh
    }
    return { installed: [], cache: [], lastSearch: null, cacheExpiry: null };
  }

  private saveState(): void {
    const dir = join(homedir(), '.profclaw');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(CLAWHUB_STATE_FILE, JSON.stringify(this.state, null, 2));
  }
}

// =============================================================================
// Singleton
// =============================================================================

let client: ClawHubClient | null = null;

export function getClawHubClient(): ClawHubClient {
  if (!client) {
    client = new ClawHubClient();
  }
  return client;
}

export { ClawHubClient };

// Re-export GitHubRepoContent so callers can use it if needed
export type { GitHubRepoContent };
