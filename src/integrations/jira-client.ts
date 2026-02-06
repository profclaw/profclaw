import { logger } from '../utils/logger.js';

/**
 * Jira API Client
 * 
 * Supports adding comments and updating issue status.
 */
export class JiraClient {
  private baseUrl: string;
  private email?: string;
  private apiToken?: string;
  private authHeader?: string;

  constructor(config: { baseUrl: string; email?: string; apiToken?: string; authHeader?: string }) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.email = config.email;
    this.apiToken = config.apiToken;
    this.authHeader = config.authHeader;

    if (!this.authHeader && this.email && this.apiToken) {
      const creds = Buffer.from(`${this.email}:${this.apiToken}`).toString('base64');
      this.authHeader = `Basic ${creds}`;
    }
  }

  /**
   * Add a comment to a Jira issue
   */
  async addComment(issueKey: string, body: string): Promise<void> {
    const path = `/rest/api/2/issue/${issueKey}/comment`;
    await this.request(path, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }

  /**
   * Update issue status (transition)
   */
  async transitionIssue(issueKey: string, transitionId: string): Promise<void> {
    const path = `/rest/api/2/issue/${issueKey}/transitions`;
    await this.request(path, {
      method: 'POST',
      body: JSON.stringify({
        transition: { id: transitionId },
      }),
    });
  }

  /**
   * Internal request helper
   */
  private async request(path: string, options: RequestInit): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.authHeader || '',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`[Jira Client] Error ${response.status} on ${path}:`, new Error(errorText));
      throw new Error(`Jira API error: ${response.status} ${response.statusText}`);
    }

    if (response.status === 204) return null;
    return await response.json();
  }
}
