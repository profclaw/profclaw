import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  createContextualLogger: vi.fn(() => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  })),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Slack Notifications', () => {
  let slack: typeof import('../slack.js');

  beforeEach(async () => {
    vi.resetModules();
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/fake';
    process.env.SLACK_CHANNEL = 'test-channel';
    process.env.SLACK_NOTIFY_ON_START = 'true';
    
    slack = await import('../slack.js');
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true });
  });

  it('should send a basic notification', async () => {
    await slack.sendSlackNotification({
      type: 'task_retry',
      title: 'Retry Title',
      message: 'Retry Message',
      severity: 'warning'
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/fake',
      expect.objectContaining({
        method: 'POST',
      })
    );
    
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.attachments[0].blocks[0].text.text).toBe('Retry Title');
  });

  it('should include task details in notification', async () => {
    const task = {
      id: 'task-123456789',
      title: 'Critical Task',
      priority: 1,
      repository: 'profclaw/profclaw',
      sourceUrl: 'https://github.com/profclaw/profclaw/issues/1'
    } as any;

    await slack.notifyTaskStarted(task);

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    const blocks = callBody.attachments[0].blocks;
    
    // Header block
    expect(blocks[0].text.text).toContain('Task Started');
    // Task ID field in section block
    expect(blocks[2].fields[0].text).toContain('task-123');
    // Repo field
    expect(blocks[2].fields[2].text).toContain('profclaw/profclaw');
  });

  it('should honor NOTIFY_ON_START setting', async () => {
    // Current env has SLACK_NOTIFY_ON_START = 'true'
    await slack.notifyTaskStarted({ title: 'Test', id: '1', priority: 3 } as any);
    expect(mockFetch).toHaveBeenCalled();
  });

  it('should send success notification with PR URL', async () => {
    const task = { title: 'Test PR', id: '2', priority: 3 } as any;
    await slack.notifyTaskCompleted(task, 'https://github.com/pr/1');

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.attachments[0].blocks[1].text.text).toContain('View Pull Request');
  });

  it('should send failure notification with error block', async () => {
    const task = { title: 'Broken Task', id: '3', priority: 3 } as any;
    await slack.notifyTaskFailed(task, 'Fatal Error occurred');

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.attachments[0].blocks[1].text.text).toContain('Fatal Error occurred');
  });

  it('should handle fetch errors gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network Down'));

    await expect(
      slack.sendSlackNotification({ type: 'task_started', title: 'T', message: 'M' })
    ).resolves.toBeUndefined();
  });
});
