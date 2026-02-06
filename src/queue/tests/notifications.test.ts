import { describe, it, expect, vi, beforeEach } from 'vitest';
import { postResultToSource } from '../notifications.js';
import { GitHubClient } from '../../integrations/github-client.js';
import { JiraClient } from '../../integrations/jira-client.js';
import { LinearClient } from '../../integrations/linear-client.js';
import { getTaskSummaries } from '../../summaries/storage.js';

// Mock integrations
vi.mock('../../integrations/github-client.js', () => ({
  GitHubClient: vi.fn()
}));

vi.mock('../../integrations/jira-client.js', () => ({
  JiraClient: vi.fn()
}));

vi.mock('../../integrations/linear-client.js', () => ({
  LinearClient: vi.fn()
}));

// Mock summary storage
vi.mock('../../summaries/storage.js', () => ({
  getTaskSummaries: vi.fn()
}));

describe('Task Queue Notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_TOKEN = 'fake-gh';
    process.env.JIRA_BASE_URL = 'https://jira.com';
    process.env.JIRA_EMAIL = 't@e.com';
    process.env.JIRA_API_TOKEN = 'fake-jira';
    process.env.LINEAR_API_KEY = 'fake-lin';
  });

  it('should post comment to GitHub with rich summary', async () => {
    const task = {
      id: 'task-1',
      source: 'github_issue',
      sourceId: '123',
      repository: 'owner/repo',
      metadata: {}
    } as any;

    const result = { success: true, duration: 5000 } as any;

    const summary = {
      title: 'Amazing Change',
      whatChanged: 'Modified core logic',
      whyChanged: 'Speed optimization',
      filesChanged: [{ path: 'index.ts', action: 'modified' }],
      decisions: [{ description: 'Used faster sort' }],
      artifacts: []
    };

    (getTaskSummaries as any).mockResolvedValue([summary]);

    const ghClientInstance = { addComment: vi.fn().mockResolvedValue({}) };
    vi.mocked(GitHubClient).mockImplementation(function() {
        return ghClientInstance as any;
    });

    await postResultToSource(task, result);

    expect(ghClientInstance.addComment).toHaveBeenCalledWith(
      'owner/repo',
      123,
      expect.stringContaining('Amazing Change')
    );
  });

  it('should post comment to Jira without summary fallback', async () => {
    const task = {
      id: 'task-2',
      source: 'jira',
      sourceId: 'PROJ-100',
      metadata: {}
    } as any;

    const result = { success: true, output: 'Raw AI output here' } as any;

    (getTaskSummaries as any).mockResolvedValue([]); // No summary

    const jiraClientInstance = { addComment: vi.fn().mockResolvedValue({}) };
    vi.mocked(JiraClient).mockImplementation(function() {
        return jiraClientInstance as any;
    });

    await postResultToSource(task, result);

    expect(jiraClientInstance.addComment).toHaveBeenCalledWith(
      'PROJ-100',
      expect.stringContaining('Raw AI output here')
    );
  });

  it('should post comment to Linear', async () => {
    const task = {
      id: 'task-3',
      source: 'linear_issue',
      sourceId: 'lin-id-123',
      metadata: { issueId: 'real-issue-id' }
    } as any;

    const result = { success: true } as any;
    (getTaskSummaries as any).mockResolvedValue([]);

    const linClientInstance = { addComment: vi.fn().mockResolvedValue({}) };
    vi.mocked(LinearClient).mockImplementation(function() {
        return linClientInstance as any;
    });

    await postResultToSource(task, result);

    expect(linClientInstance.addComment).toHaveBeenCalledWith(
      'real-issue-id',
      expect.stringContaining('AI Task Result')
    );
  });
});
