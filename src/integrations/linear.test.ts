import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleLinearWebhook } from './linear.js';
import { createHmac } from 'crypto';

// Mock context helper
function createMockContext(body: any, signature?: string) {
  const rawBody = JSON.stringify(body);
  
  return {
    req: {
      text: vi.fn().mockResolvedValue(rawBody),
      header: vi.fn((name: string) => {
        if (name === 'Linear-Signature') return signature || '';
        if (name === 'X-Correlation-ID') return 'test-correlation-id';
        return undefined;
      }),
    },
  } as any;
}

// Generate valid signature
function generateSignature(body: any, secret: string = 'test-secret'): string {
  const rawBody = JSON.stringify(body);
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

describe('Linear Integration', () => {
  beforeEach(() => {
    // Set environment variables
    process.env.LINEAR_WEBHOOK_SECRET = 'test-secret';
    process.env.LINEAR_AI_TASK_LABEL = 'ai-task';
    
    // Clear mocks
    vi.clearAllMocks();
  });

  describe('handleLinearWebhook - Signature Verification', () => {
    it('should reject webhook without signature header', async () => {
      const payload = {
        action: 'create',
        type: 'Issue',
        data: {},
        url: 'https://linear.app/team/issue/ENG-1',
        organizationId: 'org-123',
        webhookTimestamp: Date.now(),
        webhookId: 'webhook-1',
      };

      const c = createMockContext(payload, undefined);

      await expect(handleLinearWebhook(c)).rejects.toThrow(
        'Missing Linear-Signature header'
      );
    });

    it('should reject webhook with invalid signature', async () => {
      const payload = {
        action: 'create',
        type: 'Issue',
        data: {},
        url: 'https://linear.app/team/issue/ENG-1',
        organizationId: 'org-123',
        webhookTimestamp: Date.now(),
        webhookId: 'webhook-1',
      };

      const c = createMockContext(payload, 'invalid-signature');

      await expect(handleLinearWebhook(c)).rejects.toThrow(
        'Invalid Linear webhook signature'
      );
    });

    it('should accept webhook with valid signature', async () => {
      const payload = {
        action: 'create',
        type: 'Issue',
        data: {
          id: 'issue-1',
          identifier: 'ENG-1',
          title: 'Test issue',
          description: 'Test description',
          state: { id: 'state-1', name: 'Todo', type: 'backlog' },
          priority: 2,
          labels: [{ id: 'label-1', name: 'ai-task' }],
          team: { id: 'team-1', name: 'Engineering', key: 'ENG' },
          url: 'https://linear.app/team/issue/ENG-1',
          createdAt: '2026-02-01T00:00:00.000Z',
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
        url: 'https://linear.app/team/issue/ENG-1',
        organizationId: 'org-123',
        webhookTimestamp: Date.now(),
        webhookId: 'webhook-1',
      };

      const signature = generateSignature(payload);
      const c = createMockContext(payload, signature);

      const result = await handleLinearWebhook(c);

      expect(result).toBeDefined();
      expect(result?.title).toContain('ENG-1');
    });

    it('should reject webhook with old timestamp', async () => {
      const payload = {
        action: 'create',
        type: 'Issue',
        data: {},
        url: 'https://linear.app/team/issue/ENG-1',
        organizationId: 'org-123',
        webhookTimestamp: Date.now() - 10 * 60 * 1000, // 10 minutes ago
        webhookId: 'webhook-1',
      };

      const signature = generateSignature(payload);
      const c = createMockContext(payload, signature);

      await expect(handleLinearWebhook(c)).rejects.toThrow(
        'Webhook timestamp too old'
      );
    });
  });

  describe('handleLinearWebhook - Issue Events', () => {
    it('should create task when issue is created with ai-task label', async () => {
      const payload = {
        action: 'create',
        type: 'Issue',
        data: {
          id: 'issue-1',
          identifier: 'ENG-1',
          title: 'Implement auth system',
          description: 'Add JWT-based authentication',
          state: { id: 'state-1', name: 'Todo', type: 'backlog' },
          priority: 3,
          labels: [
            { id: 'label-1', name: 'ai-task' },
            { id: 'label-2', name: 'backend' },
          ],
          team: { id: 'team-1', name: 'Engineering', key: 'ENG' },
          url: 'https://linear.app/team/issue/ENG-1',
          createdAt: '2026-02-01T00:00:00.000Z',
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
        url: 'https://linear.app/team/issue/ENG-1',
        organizationId: 'org-123',
        webhookTimestamp: Date.now(),
        webhookId: 'webhook-1',
      };

      const signature = generateSignature(payload);
      const c = createMockContext(payload, signature);

      const result = await handleLinearWebhook(c);

      expect(result).toBeDefined();
      expect(result?.title).toBe('ENG-1: Implement auth system');
      expect(result?.description).toBe('Add JWT-based authentication');
      expect(result?.priority).toBe(2); // Priority 3 maps to high (2)
      expect(result?.labels).toContain('ai-task');
      expect(result?.labels).toContain('backend');
      expect(result?.source).toBe('linear_issue');
      expect(result?.sourceId).toBe(payload.data.id);
      expect(result?.metadata?.identifier).toBe('ENG-1');
    });

    it('should ignore issue without ai-task label', async () => {
      const payload = {
        action: 'create',
        type: 'Issue',
        data: {
          id: 'issue-1',
          identifier: 'ENG-1',
          title: 'Test issue',
          state: { id: 'state-1', name: 'Todo', type: 'backlog' },
          priority: 2,
          labels: [{ id: 'label-1', name: 'bug' }],
          team: { id: 'team-1', name: 'Engineering', key: 'ENG' },
          url: 'https://linear.app/team/issue/ENG-1',
          createdAt: '2026-02-01T00:00:00.000Z',
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
        url: 'https://linear.app/team/issue/ENG-1',
        organizationId: 'org-123',
        webhookTimestamp: Date.now(),
        webhookId: 'webhook-1',
      };

      const signature = generateSignature(payload);
      const c = createMockContext(payload, signature);

      const result = await handleLinearWebhook(c);

      expect(result).toBeNull();
    });

    it('should map Linear priorities correctly', async () => {
      const testCases = [
        { linearPriority: 4, expectedPriority: 1 }, // Urgent -> Critical (1)
        { linearPriority: 3, expectedPriority: 2 }, // High -> High (2)
        { linearPriority: 2, expectedPriority: 3 }, // Medium -> Medium (3)
        { linearPriority: 1, expectedPriority: 4 }, // Low -> Low (4)
        { linearPriority: 0, expectedPriority: 4 }, // No priority -> Low (4)
      ];

      for (const { linearPriority, expectedPriority } of testCases) {
        const payload = {
          action: 'create',
          type: 'Issue',
          data: {
            id: 'issue-1',
            identifier: 'ENG-1',
            title: 'Test',
            state: { id: 'state-1', name: 'Todo', type: 'backlog' },
            priority: linearPriority,
            labels: [{ id: 'label-1', name: 'ai-task' }],
            team: { id: 'team-1', name: 'Engineering', key: 'ENG' },
            url: 'https://linear.app/team/issue/ENG-1',
            createdAt: '2026-02-01T00:00:00.000Z',
            updatedAt: '2026-02-01T00:00:00.000Z',
          },
          url: 'https://linear.app/team/issue/ENG-1',
          organizationId: 'org-123',
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
        };

        const signature = generateSignature(payload);
        const c = createMockContext(payload, signature);

        const result = await handleLinearWebhook(c);

        expect(result?.priority).toBe(expectedPriority);
      }
    });

    it('should prioritize label-based priority over Linear priority', async () => {
      const payload = {
        action: 'create',
        type: 'Issue',
        data: {
          id: 'issue-1',
          identifier: 'ENG-1',
          title: 'Test',
          state: { id: 'state-1', name: 'Todo', type: 'backlog' },
          priority: 1, // Low in Linear
          labels: [
            { id: 'label-1', name: 'ai-task' },
            { id: 'label-2', name: 'critical' }, // But labeled as critical
          ],
          team: { id: 'team-1', name: 'Engineering', key: 'ENG' },
          url: 'https://linear.app/team/issue/ENG-1',
          createdAt: '2026-02-01T00:00:00.000Z',
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
        url: 'https://linear.app/team/issue/ENG-1',
        organizationId: 'org-123',
        webhookTimestamp: Date.now(),
        webhookId: 'webhook-1',
      };

      const signature = generateSignature(payload);
      const c = createMockContext(payload, signature);

      const result = await handleLinearWebhook(c);

      expect(result?.priority).toBe(1); // Label wins (critical = 1)
    });

    it('should include project and assignee information', async () => {
      const payload = {
        action: 'create',
        type: 'Issue',
        data: {
          id: 'issue-1',
          identifier: 'ENG-1',
          title: 'Test',
          state: { id: 'state-1', name: 'Todo', type: 'backlog' },
          priority: 2,
          labels: [{ id: 'label-1', name: 'ai-task' }],
          team: { id: 'team-1', name: 'Engineering', key: 'ENG' },
          project: { id: 'project-1', name: 'Auth System' },
          assignee: { id: 'user-1', name: 'John Doe', email: 'john@example.com' },
          url: 'https://linear.app/team/issue/ENG-1',
          createdAt: '2026-02-01T00:00:00.000Z',
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
        url: 'https://linear.app/team/issue/ENG-1',
        organizationId: 'org-123',
        webhookTimestamp: Date.now(),
        webhookId: 'webhook-1',
      };

      const signature = generateSignature(payload);
      const c = createMockContext(payload, signature);

      const result = await handleLinearWebhook(c);

      expect(result?.source).toBe('linear_issue');
      expect(result?.metadata?.projectName).toBe('Auth System');
      expect(result?.metadata?.assignee).toBe('john@example.com');
      expect(result?.prompt).toContain('Auth System');
      expect(result?.prompt).toContain('John Doe');
    });
  });

  describe('handleLinearWebhook - Comment Events', () => {
    it('should create task from comment with /ai-do command', async () => {
      const payload = {
        action: 'create',
        type: 'Comment',
        data: {
          id: 'comment-1',
          body: '/ai-do Add unit tests for authentication endpoints',
          user: { id: 'user-1', name: 'John Doe', email: 'john@example.com' },
          issue: {
            id: 'issue-1',
            identifier: 'ENG-1',
            title: 'Implement auth system',
            description: 'Add JWT-based authentication',
            state: { id: 'state-1', name: 'In Progress', type: 'started' },
            priority: 3,
            labels: [{ id: 'label-1', name: 'backend' }],
            team: { id: 'team-1', name: 'Engineering', key: 'ENG' },
            url: 'https://linear.app/team/issue/ENG-1',
            createdAt: '2026-02-01T00:00:00.000Z',
            updatedAt: '2026-02-01T00:00:00.000Z',
          },
          createdAt: '2026-02-01T01:00:00.000Z',
          url: 'https://linear.app/team/comment/comment-1',
        },
        url: 'https://linear.app/team/comment/comment-1',
        organizationId: 'org-123',
        webhookTimestamp: Date.now(),
        webhookId: 'webhook-1',
      };

      const signature = generateSignature(payload);
      const c = createMockContext(payload, signature);

      const result = await handleLinearWebhook(c);

      expect(result).toBeDefined();
      expect(result?.title).toContain('ENG-1');
      expect(result?.title).toContain('Add unit tests');
      expect(result?.description).toBe('Add unit tests for authentication endpoints');
      expect(result?.prompt).toContain('AI Instruction');
      expect(result?.prompt).toContain('Add unit tests');
      expect(result?.prompt).toContain('John Doe');
      expect(result?.source).toBe('linear_comment');
    });

    it('should ignore comment without /ai-do command', async () => {
      const payload = {
        action: 'create',
        type: 'Comment',
        data: {
          id: 'comment-1',
          body: 'Looks good to me!',
          user: { id: 'user-1', name: 'John Doe', email: 'john@example.com' },
          issue: {
            id: 'issue-1',
            identifier: 'ENG-1',
            title: 'Test',
            state: { id: 'state-1', name: 'Todo', type: 'backlog' },
            priority: 2,
            team: { id: 'team-1', name: 'Engineering', key: 'ENG' },
            url: 'https://linear.app/team/issue/ENG-1',
            createdAt: '2026-02-01T00:00:00.000Z',
            updatedAt: '2026-02-01T00:00:00.000Z',
          },
          createdAt: '2026-02-01T01:00:00.000Z',
          url: 'https://linear.app/team/comment/comment-1',
        },
        url: 'https://linear.app/team/comment/comment-1',
        organizationId: 'org-123',
        webhookTimestamp: Date.now(),
        webhookId: 'webhook-1',
      };

      const signature = generateSignature(payload);
      const c = createMockContext(payload, signature);

      const result = await handleLinearWebhook(c);

      expect(result).toBeNull();
    });

    it('should handle case-insensitive /ai-do command', async () => {
      const payload = {
        action: 'create',
        type: 'Comment',
        data: {
          id: 'comment-1',
          body: '/AI-DO Refactor the code',
          user: { id: 'user-1', name: 'John Doe', email: 'john@example.com' },
          issue: {
            id: 'issue-1',
            identifier: 'ENG-1',
            title: 'Test',
            state: { id: 'state-1', name: 'Todo', type: 'backlog' },
            priority: 2,
            team: { id: 'team-1', name: 'Engineering', key: 'ENG' },
            url: 'https://linear.app/team/issue/ENG-1',
            createdAt: '2026-02-01T00:00:00.000Z',
            updatedAt: '2026-02-01T00:00:00.000Z',
          },
          createdAt: '2026-02-01T01:00:00.000Z',
          url: 'https://linear.app/team/comment/comment-1',
        },
        url: 'https://linear.app/team/comment/comment-1',
        organizationId: 'org-123',
        webhookTimestamp: Date.now(),
        webhookId: 'webhook-1',
      };

      const signature = generateSignature(payload);
      const c = createMockContext(payload, signature);

      const result = await handleLinearWebhook(c);

      expect(result).toBeDefined();
      expect(result?.description).toBe('Refactor the code');
    });
  });

  describe('handleLinearWebhook - IssueLabel Events', () => {
    it('should create task when ai-task label is added', async () => {
      const payload = {
        action: 'create',
        type: 'IssueLabel',
        data: {
          id: 'label-link-1',
          label: { id: 'label-1', name: 'ai-task' },
          issue: {
            id: 'issue-1',
            identifier: 'ENG-1',
            title: 'Existing issue',
            description: 'Already exists but now labeled',
            state: { id: 'state-1', name: 'Todo', type: 'backlog' },
            priority: 2,
            labels: [{ id: 'label-1', name: 'ai-task' }],
            team: { id: 'team-1', name: 'Engineering', key: 'ENG' },
            url: 'https://linear.app/team/issue/ENG-1',
            createdAt: '2026-02-01T00:00:00.000Z',
            updatedAt: '2026-02-01T00:00:00.000Z',
          },
        },
        url: 'https://linear.app/team/issue/ENG-1',
        organizationId: 'org-123',
        webhookTimestamp: Date.now(),
        webhookId: 'webhook-1',
      };

      const signature = generateSignature(payload);
      const c = createMockContext(payload, signature);

      const result = await handleLinearWebhook(c);

      expect(result).toBeDefined();
      expect(result?.title).toContain('ENG-1');
    });
  });

  describe('handleLinearWebhook - Edge Cases', () => {
    it('should handle unknown event types gracefully', async () => {
      const payload = {
        action: 'create',
        type: 'Project' as any,
        data: {},
        url: 'https://linear.app/team/project/1',
        organizationId: 'org-123',
        webhookTimestamp: Date.now(),
        webhookId: 'webhook-1',
      };

      const signature = generateSignature(payload);
      const c = createMockContext(payload, signature);

      const result = await handleLinearWebhook(c);

      expect(result).toBeNull();
    });

    it('should handle issue without labels', async () => {
      const payload = {
        action: 'create',
        type: 'Issue',
        data: {
          id: 'issue-1',
          identifier: 'ENG-1',
          title: 'Test',
          state: { id: 'state-1', name: 'Todo', type: 'backlog' },
          priority: 2,
          team: { id: 'team-1', name: 'Engineering', key: 'ENG' },
          url: 'https://linear.app/team/issue/ENG-1',
          createdAt: '2026-02-01T00:00:00.000Z',
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
        url: 'https://linear.app/team/issue/ENG-1',
        organizationId: 'org-123',
        webhookTimestamp: Date.now(),
        webhookId: 'webhook-1',
      };

      const signature = generateSignature(payload);
      const c = createMockContext(payload, signature);

      const result = await handleLinearWebhook(c);

      expect(result).toBeNull(); // No ai-task label
    });

    it('should reject malformed JSON', async () => {
      const c = {
        req: {
          text: vi.fn().mockResolvedValue('invalid json{'),
          header: vi.fn((name: string) => {
            if (name === 'Linear-Signature') return 'sig';
            return undefined;
          }),
        },
      } as any;

      await expect(handleLinearWebhook(c)).rejects.toThrow('Invalid JSON payload');
    });
  });
});
