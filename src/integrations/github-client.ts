import { logger } from '../utils/logger.js';

interface GitHubApiError {
  message?: string;
}

interface GitHubRelease {
  tag_name: string;
}

/**
 * GitHub API Client
 * 
 * Provides methods for interacting with GitHub API beyond webhooks.
 */
export class GitHubClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request<T = unknown>(path: string, options: RequestInit = {}): Promise<T | null> {
    const url = `https://api.github.com${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `token ${this.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'profClaw',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json() as GitHubApiError;
      logger.error(`[GitHub Client] Error ${response.status} on ${path}:`, error as Error);
      throw new Error(error.message || 'GitHub API error');
    }

    if (response.status === 204) return null;
    return response.json() as Promise<T>;
  }

  /**
   * Add a comment to an issue or pull request
   */
  async addComment(repo: string, issueNumber: number, body: string): Promise<void> {
    await this.request(`/repos/${repo}/issues/${issueNumber}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }

  /**
   * Update pull request description
   */
  async updatePullRequest(repo: string, prNumber: number, body: string): Promise<void> {
    await this.request(`/repos/${repo}/pulls/${prNumber}`, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    });
  }

  /**
   * Get pull request details
   */
  async getPullRequest<T = unknown>(repo: string, prNumber: number): Promise<T | null> {
    return this.request(`/repos/${repo}/pulls/${prNumber}`);
  }

  /**
   * Create a new release version suggestion based on changes
   */
  async suggestVersion(repo: string): Promise<string> {
    // Basic logic: get latest release and propose next patch/minor
    try {
      const release = await this.request<GitHubRelease>(`/repos/${repo}/releases/latest`);
      if (!release?.tag_name) {
        return 'v1.0.1';
      }
      const tag = release.tag_name;
      // Very simple semver increment
      const parts = tag.replace('v', '').split('.');
      if (parts.length === 3) {
        return `v${parts[0]}.${parts[1]}.${parseInt(parts[2]) + 1}`;
      }
      return 'v1.0.1';
    } catch {
      return 'v0.1.0';
    }
  }
}
