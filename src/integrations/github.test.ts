import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';

describe('GitHub Integration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      GITHUB_WEBHOOK_SECRET: 'test-webhook-secret',
      GITHUB_AI_TASK_LABEL: 'ai-task',
      GITHUB_AI_REVIEW_LABEL: 'ai-review',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const createSignature = (payload: string, secret: string): string => {
    const hmac = createHmac('sha256', secret);
    hmac.update(payload);
    return `sha256=${hmac.digest('hex')}`;
  };

  const createMockContext = (
    signature: string | undefined,
    body: any,
    eventType: string = 'issues'
  ) => {
    const payload = JSON.stringify(body);
    return {
      req: {
        header: (key: string) => {
          const lowerKey = key.toLowerCase();
          if (lowerKey === 'x-hub-signature-256') return signature;
          if (lowerKey === 'x-github-event') return eventType;
          if (lowerKey === 'x-github-delivery') return 'test-delivery-id';
          return undefined;
        },
        text: async () => payload,
      },
    } as any;
  };

  describe('verifyGitHubSignature', () => {
    it('should verify correct signature', async () => {
      const { verifyGitHubSignature } = await import('./github.js');
      const payload = '{"test":"data"}';
      const signature = createSignature(payload, 'test-webhook-secret');

      expect(verifyGitHubSignature(payload, signature)).toBe(true);
    });

    it('should reject incorrect signature', async () => {
      const { verifyGitHubSignature } = await import('./github.js');
      const payload = '{"test":"data"}';
      const wrongSignature = 'sha256=wronghash';

      expect(verifyGitHubSignature(payload, wrongSignature)).toBe(false);
    });

    it('should reject missing signature', async () => {
      const { verifyGitHubSignature } = await import('./github.js');
      const payload = '{"test":"data"}';

      expect(verifyGitHubSignature(payload, undefined)).toBe(false);
    });

    it('should reject malformed signature', async () => {
      const { verifyGitHubSignature } = await import('./github.js');
      const payload = '{"test":"data"}';

      expect(verifyGitHubSignature(payload, 'not-sha256-format')).toBe(false);
    });
  });

  describe('handleGitHubWebhook - Issues', () => {
    it('should create task when issue is opened with ai-task label', async () => {
      const { handleGitHubWebhook } = await import('./github.js');
      const payload = {
        action: 'opened',
        issue: {
          number: 123,
          title: 'Fix authentication bug',
          body: 'Users cannot login with Google OAuth',
          html_url: 'https://github.com/org/repo/issues/123',
          user: { login: 'developer' },
          labels: [{ name: 'bug' }, { name: 'ai-task' }],
          created_at: '2023-01-01T00:00:00Z',
        },
        repository: {
          full_name: 'org/repo',
        },
      };

      const signature = createSignature(JSON.stringify(payload), 'test-webhook-secret');
      const c = createMockContext(signature, payload, 'issues');
      const result = await handleGitHubWebhook(c);

      expect(result).not.toBeNull();
      expect(result).toMatchObject({
        title: 'Fix authentication bug',
        description: 'Users cannot login with Google OAuth',
        source: 'github_issue',
        sourceId: '123',
        sourceUrl: 'https://github.com/org/repo/issues/123',
        repository: 'org/repo',
        labels: ['bug', 'ai-task'],
      });
      expect(result?.prompt).toContain('Fix authentication bug');
      expect(result?.prompt).toContain('GitHub Issue #123');
    });

    it('should create task when ai-task label is added', async () => {
      const { handleGitHubWebhook } = await import('./github.js');
      const payload = {
        action: 'labeled',
        issue: {
          number: 456,
          title: 'Add dark mode',
          body: null,
          html_url: 'https://github.com/org/repo/issues/456',
          user: { login: 'designer' },
          labels: [{ name: 'feature' }, { name: 'ai-task' }],
          created_at: '2023-01-01T00:00:00Z',
        },
        label: { name: 'ai-task' },
        repository: {
          full_name: 'org/repo',
        },
      };

      const signature = createSignature(JSON.stringify(payload), 'test-webhook-secret');
      const c = createMockContext(signature, payload, 'issues');
      const result = await handleGitHubWebhook(c);

      expect(result).not.toBeNull();
      expect(result?.title).toBe('Add dark mode');
    });

    it('should ignore issue without ai-task label', async () => {
      const { handleGitHubWebhook } = await import('./github.js');
      const payload = {
        action: 'opened',
        issue: {
          number: 789,
          title: 'Regular issue',
          body: 'This is a regular issue',
          html_url: 'https://github.com/org/repo/issues/789',
          user: { login: 'user' },
          labels: [{ name: 'bug' }],
          created_at: '2023-01-01T00:00:00Z',
        },
        repository: {
          full_name: 'org/repo',
        },
      };

      const signature = createSignature(JSON.stringify(payload), 'test-webhook-secret');
      const c = createMockContext(signature, payload, 'issues');
      const result = await handleGitHubWebhook(c);

      expect(result).toBeNull();
    });

    it('should ignore closed action', async () => {
      const { handleGitHubWebhook } = await import('./github.js');
      const payload = {
        action: 'closed',
        issue: {
          number: 999,
          title: 'Closed issue',
          body: null,
          html_url: 'https://github.com/org/repo/issues/999',
          user: { login: 'user' },
          labels: [{ name: 'ai-task' }],
          created_at: '2023-01-01T00:00:00Z',
        },
        repository: {
          full_name: 'org/repo',
        },
      };

      const signature = createSignature(JSON.stringify(payload), 'test-webhook-secret');
      const c = createMockContext(signature, payload, 'issues');
      const result = await handleGitHubWebhook(c);

      expect(result).toBeNull();
    });
  });

  describe('handleGitHubWebhook - Issue Comments', () => {
    it('should create task on /ai-do command', async () => {
      const { handleGitHubWebhook } = await import('./github.js');
      const payload = {
        action: 'created',
        issue: {
          number: 111,
          title: 'Need help here',
          body: 'Original issue description',
          html_url: 'https://github.com/org/repo/issues/111',
          user: { login: 'owner' },
          labels: null,
          created_at: '2023-01-01T00:00:00Z',
        },
        comment: {
          id: 222,
          body: '/ai-do Fix the memory leak in the cache module',
          html_url: 'https://github.com/org/repo/issues/111#issuecomment-222',
          user: { login: 'developer' },
        },
        repository: {
          full_name: 'org/repo',
        },
      };

      const signature = createSignature(JSON.stringify(payload), 'test-webhook-secret');
      const c = createMockContext(signature, payload, 'issue_comment');
      const result = await handleGitHubWebhook(c);

      expect(result).not.toBeNull();
      expect(result?.title).toBe('AI Task: Need help here');
      expect(result?.prompt).toContain('Fix the memory leak in the cache module');
    });

    it('should ignore comment without /ai-do', async () => {
      const { handleGitHubWebhook } = await import('./github.js');
      const payload = {
        action: 'created',
        issue: {
          number: 333,
          title: 'Some issue',
          body: null,
          html_url: 'https://github.com/org/repo/issues/333',
          user: { login: 'user' },
          labels: null,
          created_at: '2023-01-01T00:00:00Z',
        },
        comment: {
          id: 444,
          body: 'Just a regular comment',
          html_url: 'https://github.com/org/repo/issues/333#issuecomment-444',
          user: { login: 'commenter' },
        },
        repository: {
          full_name: 'org/repo',
        },
      };

      const signature = createSignature(JSON.stringify(payload), 'test-webhook-secret');
      const c = createMockContext(signature, payload, 'issue_comment');
      const result = await handleGitHubWebhook(c);

      expect(result).toBeNull();
    });
  });

  describe('handleGitHubWebhook - Pull Requests', () => {
    it('should create review task when PR is opened with ai-review label', async () => {
      const { handleGitHubWebhook } = await import('./github.js');
      const payload = {
        action: 'opened',
        pull_request: {
          number: 555,
          title: 'Add new feature',
          body: 'This PR adds a new authentication method',
          html_url: 'https://github.com/org/repo/pull/555',
          user: { login: 'contributor' },
          labels: [{ name: 'ai-review' }],
          head: { ref: 'feature/auth' },
          base: { ref: 'main' },
        },
        repository: {
          full_name: 'org/repo',
        },
      };

      const signature = createSignature(JSON.stringify(payload), 'test-webhook-secret');
      const c = createMockContext(signature, payload, 'pull_request');
      const result = await handleGitHubWebhook(c);

      expect(result).not.toBeNull();
      expect(result?.title).toBe('Review PR: Add new feature');
      expect(result?.source).toBe('github_pr');
      expect(result?.branch).toBe('feature/auth');
      expect(result?.prompt).toContain('Please review Pull Request #555');
    });

    it('should ignore PR without ai-review label', async () => {
      const { handleGitHubWebhook } = await import('./github.js');
      const payload = {
        action: 'opened',
        pull_request: {
          number: 666,
          title: 'Regular PR',
          body: null,
          html_url: 'https://github.com/org/repo/pull/666',
          user: { login: 'user' },
          labels: [{ name: 'feature' }],
          head: { ref: 'feature/something' },
          base: { ref: 'main' },
        },
        repository: {
          full_name: 'org/repo',
        },
      };

      const signature = createSignature(JSON.stringify(payload), 'test-webhook-secret');
      const c = createMockContext(signature, payload, 'pull_request');
      const result = await handleGitHubWebhook(c);

      expect(result).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should throw error on invalid signature in handler', async () => {
      const { handleGitHubWebhook } = await import('./github.js');
      const payload = {
        action: 'opened',
        issue: {
          number: 1,
          title: 'Test',
          body: null,
          html_url: 'https://github.com/org/repo/issues/1',
          user: { login: 'user' },
          labels: [{ name: 'ai-task' }],
          created_at: '2023-01-01T00:00:00Z',
        },
        repository: { full_name: 'org/repo' },
      };

      const c = createMockContext('sha256=wrongsignature', payload, 'issues');

      await expect(handleGitHubWebhook(c)).rejects.toThrow('Invalid webhook signature');
    });

    it('should handle unknown event types', async () => {
      const { handleGitHubWebhook } = await import('./github.js');
      const payload = { action: 'unknown' };

      const signature = createSignature(JSON.stringify(payload), 'test-webhook-secret');
      const c = createMockContext(signature, payload, 'unknown_event');
      const result = await handleGitHubWebhook(c);

      expect(result).toBeNull();
    });

    it('should handle issue with null labels', async () => {
      const { handleGitHubWebhook } = await import('./github.js');
      const payload = {
        action: 'opened',
        issue: {
          number: 777,
          title: 'Issue with null labels',
          body: 'Description',
          html_url: 'https://github.com/org/repo/issues/777',
          user: { login: 'user' },
          labels: null,
          created_at: '2023-01-01T00:00:00Z',
        },
        repository: { full_name: 'org/repo' },
      };

      const signature = createSignature(JSON.stringify(payload), 'test-webhook-secret');
      const c = createMockContext(signature, payload, 'issues');
      const result = await handleGitHubWebhook(c);

      expect(result).toBeNull();
    });
  });
});
