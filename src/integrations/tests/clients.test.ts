import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubClient } from '../github-client.js';
import { LinearClient } from '../linear-client.js';
import { JiraClient } from '../jira-client.js';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Integration Clients', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('GitHubClient', () => {
    const client = new GitHubClient('fake-token');

    it('should add a comment', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 123 }),
      });

      await client.addComment('owner/repo', 1, 'Hello');
      
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/issues/1/comments',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ body: 'Hello' }),
        })
      );
    });

    it('should suggest a version', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ tag_name: 'v1.2.3' }),
      });

      const version = await client.suggestVersion('owner/repo');
      expect(version).toBe('v1.2.4');
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Not Found' }),
      });

      await expect(client.getPullRequest('owner/repo', 1)).rejects.toThrow('Not Found');
    });
  });

  describe('LinearClient', () => {
    const client = new LinearClient({ apiKey: 'lin_api_fake' });

    it('should add a comment via GraphQL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { commentCreate: { success: true } } }),
      });

      await client.addComment('issue-id', 'GraphQL comment');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.linear.app/graphql',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'lin_api_fake',
          }),
        })
      );
    });

    it('should handle GraphQL errors', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ errors: [{ message: 'No permission' }] }),
      });

      await expect(client.addComment('id', 'text')).rejects.toThrow('Linear API error: No permission');
    });
  });

  describe('JiraClient', () => {
    const client = new JiraClient({ 
      baseUrl: 'https://test.atlassian.net',
      email: 'test@example.com',
      apiToken: 'fake-token'
    });

    it('should add a comment', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id: '1000' }),
      });

      await client.addComment('PROJ-1', 'Jira comment');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.atlassian.net/rest/api/2/issue/PROJ-1/comment',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': expect.stringContaining('Basic '),
          }),
        })
      );
    });

    it('should transition an issue', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
      });

      await client.transitionIssue('PROJ-1', 'transition-id');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.atlassian.net/rest/api/2/issue/PROJ-1/transitions',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ transition: { id: 'transition-id' } }),
        })
      );
    });
  });
});
