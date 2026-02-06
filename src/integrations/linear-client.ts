import { logger } from '../utils/logger.js';

/**
 * Linear API Client
 * 
 * Uses GraphQL to interact with Linear issues.
 */
export class LinearClient {
  private apiKey?: string;
  private authHeader?: string;
  private endpoint = 'https://api.linear.app/graphql';

  constructor(config: { apiKey?: string; authHeader?: string }) {
    this.apiKey = config.apiKey;
    this.authHeader = config.authHeader || (this.apiKey ? `${this.apiKey}` : undefined);
  }

  /**
   * Add a comment to a Linear issue
   */
  async addComment(issueId: string, body: string): Promise<void> {
    const query = `
      mutation CreateComment($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) {
          success
          comment {
            id
          }
        }
      }
    `;

    await this.request(query, { issueId, body });
  }

  /**
   * Internal request helper for GraphQL
   */
  private async request(query: string, variables: Record<string, any>): Promise<any> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.authHeader || '',
      },
      body: JSON.stringify({ query, variables }),
    });

    const result = await response.json() as any;

    if (!response.ok || result.errors) {
      const error = result.errors ? result.errors[0].message : response.statusText;
      logger.error('[Linear Client] API Error:', new Error(error));
      throw new Error(`Linear API error: ${error}`);
    }

    return result.data;
  }
}
