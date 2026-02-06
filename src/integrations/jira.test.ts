import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Jira Integration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, JIRA_WEBHOOK_SECRET: 'test-secret', JIRA_AI_TASK_LABEL: 'ai-task' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const createMockContext = (queryToken: string, body: any) => {
    return {
      req: {
        query: (key: string) => (key === 'token' ? queryToken : undefined),
        text: async () => JSON.stringify(body),
      },
    } as any;
  };

  it('should verify correct token', async () => {
    const { verifyJiraToken } = await import('./jira.js');
    const c = createMockContext('test-secret', {});
    expect(verifyJiraToken(c)).toBe(true);
  });

  it('should reject incorrect token', async () => {
    const { verifyJiraToken } = await import('./jira.js');
    const c = createMockContext('wrong-secret', {});
    expect(verifyJiraToken(c)).toBe(false);
  });

  it('should handle issue_created with ai-task label', async () => {
    const { handleJiraWebhook } = await import('./jira.js');
    const payload = {
      webhookEvent: 'jira:issue_created',
      issue: {
        id: '10001',
        key: 'TEST-1',
        self: 'https://site.atlassian.net/rest/api/2/issue/10001',
        fields: {
          summary: 'Test Issue',
          description: 'Test Description',
          priority: { name: 'High', id: '2' },
          labels: ['ai-task', 'bug'],
          reporter: { displayName: 'John Doe', accountId: '123' },
          status: { name: 'To Do', id: '1' },
          created: '2023-01-01T00:00:00.000Z',
          updated: '2023-01-01T00:00:00.000Z',
        },
      },
      timestamp: 1672531200000,
    };

    const c = createMockContext('test-secret', payload);
    const result = await handleJiraWebhook(c);

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      title: 'Jira Issue TEST-1: Test Issue',
      description: 'Test Description',
      source: 'jira',
      sourceId: 'TEST-1',
      sourceUrl: 'https://site.atlassian.net/browse/TEST-1',
      priority: 2,
    });
  });

  it('should ignore issue without ai-task label', async () => {
    const { handleJiraWebhook } = await import('./jira.js');
    const payload = {
      webhookEvent: 'jira:issue_created',
      issue: {
        id: '10002',
        key: 'TEST-2',
        self: 'https://site.atlassian.net/rest/api/2/issue/10002',
        fields: {
          summary: 'Normal Issue',
          description: null,
          priority: { name: 'Medium', id: '3' },
          labels: ['bug'],
          reporter: { displayName: 'Jane Doe', accountId: '456' },
          status: { name: 'To Do', id: '1' },
          created: '2023-01-01T00:00:00.000Z',
          updated: '2023-01-01T00:00:00.000Z',
        },
      },
      timestamp: 1672531200000,
    };

    const c = createMockContext('test-secret', payload);
    const result = await handleJiraWebhook(c);

    expect(result).toBeNull();
  });

  it('should throw error on invalid token in handler', async () => {
    const { handleJiraWebhook } = await import('./jira.js');
    const c = createMockContext('wrong-secret', {});
    await expect(handleJiraWebhook(c)).rejects.toThrow('Invalid webhook token');
  });

  it('should ignore unrelated events', async () => {
    const { handleJiraWebhook } = await import('./jira.js');
    const payload = {
      webhookEvent: 'jira:worklog_updated',
      issue: {
        key: 'TEST-3',
        fields: { labels: ['ai-task'] },
      },
    };
    const c = createMockContext('test-secret', payload);
    const result = await handleJiraWebhook(c);
    expect(result).toBeNull();
  });
});
