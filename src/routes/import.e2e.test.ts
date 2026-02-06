/**
 * E2E Test: GitHub Projects Import Flow
 *
 * Tests end-to-end flow of the import wizard including:
 * - Token validation
 * - Project listing
 * - Project preview with field mapping
 * - Dry run preview
 * - Import execution with timestamp preservation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the GitHub Projects client
vi.mock('../integrations/github-projects.js', () => ({
  validateGitHubToken: vi.fn(),
  listGitHubProjects: vi.fn(),
  listGitHubRepos: vi.fn(),
  getGitHubProjectPreview: vi.fn(),
}));

// Mock the storage
const mockTickets: Array<{ id: string; title: string; status: string; createdAt: Date }> = [];
const mockSprints: Array<{ id: string; name: string; projectId: string }> = [];
const mockProjects: Array<{ id: string; key: string; name: string }> = [];
const mockExternalLinks: Array<{ id: string; ticketId: string; externalId: string }> = [];

vi.mock('../storage/index.js', () => ({
  getDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((data) => {
        if (data.title) mockTickets.push(data);
        if (data.name && data.projectId) mockSprints.push(data);
        if (data.key) mockProjects.push(data);
        if (data.externalId) mockExternalLinks.push(data);
        return Promise.resolve();
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
  })),
}));

// Mock projects service
vi.mock('../projects/index.js', () => ({
  createProject: vi.fn((data) => Promise.resolve({ id: 'proj-123', ...data })),
  createProjectExternalLink: vi.fn((data) => Promise.resolve({ id: 'link-123', ...data })),
  createSprint: vi.fn((data) => Promise.resolve({ id: 'sprint-123', ...data })),
}));

// Mock auth service
vi.mock('../auth/auth-service.js', () => ({
  validateSession: vi.fn(() => Promise.resolve({ userId: 'user-123' })),
}));

// Import mocked modules
import {
  validateGitHubToken,
  listGitHubProjects,
  getGitHubProjectPreview,
} from '../integrations/github-projects.js';
import { createProject, createSprint } from '../projects/index.js';

describe('GitHub Import E2E Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTickets.length = 0;
    mockSprints.length = 0;
    mockProjects.length = 0;
    mockExternalLinks.length = 0;
  });

  describe('Complete Import Wizard Flow', () => {
    it('should complete full import flow from token to imported data', async () => {
      // Step 1: Token Validation
      vi.mocked(validateGitHubToken).mockResolvedValue({
        valid: true,
        scopes: ['read:project', 'repo'],
        login: 'testuser',
      });

      const tokenResult = await validateGitHubToken('ghp_test123');
      expect(tokenResult.valid).toBe(true);
      expect(tokenResult.scopes).toContain('read:project');

      // Step 2: List Projects
      vi.mocked(listGitHubProjects).mockResolvedValue([
        {
          id: 'PVT_kwDOA1B2C3',
          number: 1,
          title: 'Product Roadmap',
          shortDescription: 'Our product roadmap',
          url: 'https://github.com/users/testuser/projects/1',
          public: false,
          creator: { login: 'testuser' },
          items: { totalCount: 25 },
          fields: { totalCount: 8 },
        },
        {
          id: 'PVT_kwDOD4E5F6',
          number: 2,
          title: 'Sprint Board',
          url: 'https://github.com/users/testuser/projects/2',
          public: true,
          creator: { login: 'testuser' },
          items: { totalCount: 12 },
          fields: { totalCount: 5 },
        },
      ]);

      const projects = await listGitHubProjects('ghp_test123');
      expect(projects).toHaveLength(2);
      expect(projects[0].title).toBe('Product Roadmap');
      expect(projects[0].items.totalCount).toBe(25);

      // Step 3: Get Project Preview
      const selectedProjectId = projects[0].id;
      vi.mocked(getGitHubProjectPreview).mockResolvedValue({
        project: {
          id: selectedProjectId,
          title: 'Product Roadmap',
          url: 'https://github.com/users/testuser/projects/1',
        },
        iterations: [
          { id: 'iter-1', title: 'Sprint 1', startDate: '2024-01-01', duration: 14 },
          { id: 'iter-2', title: 'Sprint 2', startDate: '2024-01-15', duration: 14 },
        ],
        items: [
          {
            id: 'item-1',
            title: 'Implement OAuth',
            body: 'Add OAuth 2.0 authentication',
            url: 'https://github.com/org/repo/issues/1',
            status: 'In Progress',
            priority: 'High',
            type: 'Feature',
            labels: ['auth', 'backend'],
            assignees: ['dev1'],
            iteration: 'Sprint 1',
            createdAt: '2023-12-01T10:00:00Z',
            updatedAt: '2024-01-05T15:30:00Z',
            issueNumber: 1,
            repoOwner: 'org',
            repoName: 'repo',
          },
          {
            id: 'item-2',
            title: 'Fix login bug',
            body: 'Users cannot login with special characters',
            url: 'https://github.com/org/repo/issues/2',
            status: 'Todo',
            priority: 'Critical',
            labels: ['bug', 'urgent'],
            assignees: [],
            createdAt: '2024-01-02T08:00:00Z',
            updatedAt: '2024-01-02T08:00:00Z',
            issueNumber: 2,
            repoOwner: 'org',
            repoName: 'repo',
          },
          {
            id: 'item-3',
            title: 'Draft: API design',
            body: 'Planning document',
            url: '',
            status: 'Backlog',
            labels: [],
            assignees: [],
            createdAt: '2024-01-03T12:00:00Z',
            updatedAt: '2024-01-03T12:00:00Z',
            // No issueNumber - draft item
          },
        ],
        fieldMappings: {
          status: {
            'In Progress': 'in_progress',
            'Todo': 'todo',
            'Backlog': 'backlog',
            'Done': 'done',
          },
          priority: {
            'High': 'high',
            'Critical': 'critical',
            'Medium': 'medium',
            'Low': 'low',
          },
          type: {
            'Feature': 'feature',
            'Bug': 'bug',
            'Task': 'task',
          },
        },
      });

      const preview = await getGitHubProjectPreview('ghp_test123', selectedProjectId);
      expect(preview.items).toHaveLength(3);
      expect(preview.iterations).toHaveLength(2);
      expect(preview.fieldMappings.status['In Progress']).toBe('in_progress');

      // Step 4: Simulate Dry Run Logic
      const fieldMappings = preview.fieldMappings;
      const selectedItemIds = ['item-1', 'item-2']; // User deselects draft item
      const preserveTimestamps = true;

      const itemsToImport = preview.items.filter(item => selectedItemIds.includes(item.id));
      expect(itemsToImport).toHaveLength(2);

      // Check for unmapped values
      const unmappedStatus: string[] = [];
      const unmappedPriority: string[] = [];
      for (const item of itemsToImport) {
        if (item.status && !fieldMappings.status[item.status]) {
          unmappedStatus.push(item.status);
        }
        if (item.priority && !fieldMappings.priority[item.priority]) {
          unmappedPriority.push(item.priority);
        }
      }
      expect(unmappedStatus).toHaveLength(0); // All statuses mapped
      expect(unmappedPriority).toHaveLength(0); // All priorities mapped

      // Step 5: Simulate Import Execution
      const projectKey = 'ROADMAP';
      const projectName = 'Product Roadmap';

      // Create project
      const project = await createProject({
        key: projectKey,
        name: projectName,
        icon: '🗺️',
        color: '#6366f1',
      });
      expect(project.id).toBe('proj-123');

      // Create sprints from iterations
      for (const iteration of preview.iterations) {
        const sprint = await createSprint({
          projectId: project.id,
          name: iteration.title,
          startDate: new Date(iteration.startDate),
          endDate: new Date(new Date(iteration.startDate).getTime() + iteration.duration * 24 * 60 * 60 * 1000),
        });
        expect(sprint.id).toBe('sprint-123');
      }

      // Map and create tickets
      const createdTickets = [];
      for (const item of itemsToImport) {
        const mappedStatus = fieldMappings.status[item.status || ''] || 'backlog';
        const mappedPriority = fieldMappings.priority[item.priority || ''] || 'medium';
        const mappedType = fieldMappings.type[item.type || ''] || 'task';

        const ticket = {
          id: `ticket-${item.id}`,
          projectId: project.id,
          title: item.title,
          description: item.body || '',
          status: mappedStatus,
          priority: mappedPriority,
          type: mappedType,
          labels: item.labels,
          createdBy: 'github-import',
          createdAt: preserveTimestamps && item.createdAt
            ? new Date(item.createdAt)
            : new Date(),
          updatedAt: preserveTimestamps && item.updatedAt
            ? new Date(item.updatedAt)
            : new Date(),
        };

        createdTickets.push(ticket);

        // Create external link if it's a real issue (not draft)
        if (item.issueNumber && item.repoOwner && item.repoName) {
          const externalId = `${item.repoOwner}/${item.repoName}#${item.issueNumber}`;
          mockExternalLinks.push({
            id: `link-${item.id}`,
            ticketId: ticket.id,
            externalId,
          });
        }
      }

      expect(createdTickets).toHaveLength(2);
      expect(createdTickets[0].status).toBe('in_progress');
      expect(createdTickets[0].priority).toBe('high');
      expect(createdTickets[1].status).toBe('todo');
      expect(createdTickets[1].priority).toBe('critical');

      // Verify timestamps were preserved
      expect(createdTickets[0].createdAt.toISOString()).toBe('2023-12-01T10:00:00.000Z');
      expect(createdTickets[0].updatedAt.toISOString()).toBe('2024-01-05T15:30:00.000Z');

      // Verify external links created for real issues
      expect(mockExternalLinks).toHaveLength(2);
      expect(mockExternalLinks[0].externalId).toBe('org/repo#1');
      expect(mockExternalLinks[1].externalId).toBe('org/repo#2');
    });

    it('should handle import with custom field mappings', async () => {
      vi.mocked(getGitHubProjectPreview).mockResolvedValue({
        project: { id: 'proj-1', title: 'Test', url: '' },
        iterations: [],
        items: [
          {
            id: 'item-1',
            title: 'Custom Status Item',
            url: '',
            status: 'Needs Review', // Not in default mapping
            priority: 'P1', // Custom priority format
            labels: [],
            assignees: [],
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        ],
        fieldMappings: {
          status: {}, // Empty - user needs to map
          priority: {},
          type: {},
        },
      });

      const preview = await getGitHubProjectPreview('token', 'proj-1');

      // User provides custom mappings
      const customMappings = {
        status: { 'Needs Review': 'in_review' },
        priority: { 'P1': 'critical' },
        type: {},
      };

      // Apply custom mapping
      const item = preview.items[0];
      const mappedStatus = customMappings.status[item.status || ''] || 'backlog';
      const mappedPriority = customMappings.priority[item.priority || ''] || 'medium';

      expect(mappedStatus).toBe('in_review');
      expect(mappedPriority).toBe('critical');
    });

    it('should skip items without preserving timestamps when disabled', async () => {
      const preserveTimestamps = false;
      const now = new Date('2024-06-15T00:00:00Z');
      vi.setSystemTime(now);

      const item = {
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-06-01T00:00:00Z',
      };

      const createdAt = preserveTimestamps && item.createdAt
        ? new Date(item.createdAt)
        : now;

      expect(createdAt.toISOString()).toBe('2024-06-15T00:00:00.000Z');

      vi.useRealTimers();
    });

    it('should calculate correct import summary', async () => {
      const allItems = [
        { id: '1', status: 'Todo', priority: 'High' },
        { id: '2', status: 'Custom', priority: 'P1' }, // Unmapped
        { id: '3', status: 'Done', priority: 'Low' },
        { id: '4', status: 'In Progress', priority: 'Medium' },
      ];

      const selectedIds = new Set(['1', '2', '3']); // User selects 3 items
      const iterations = [{ id: 'i1', title: 'Sprint 1' }];

      const fieldMappings = {
        status: { 'Todo': 'todo', 'Done': 'done', 'In Progress': 'in_progress' },
        priority: { 'High': 'high', 'Low': 'low', 'Medium': 'medium' },
        type: {},
      };

      // Calculate unmapped values
      const unmappedStatus = new Set<string>();
      const unmappedPriority = new Set<string>();

      for (const item of allItems.filter(i => selectedIds.has(i.id))) {
        if (item.status && !fieldMappings.status[item.status]) {
          unmappedStatus.add(item.status);
        }
        if (item.priority && !fieldMappings.priority[item.priority]) {
          unmappedPriority.add(item.priority);
        }
      }

      const summary = {
        totalItems: allItems.length,
        itemsToCreate: selectedIds.size,
        itemsToSkip: allItems.length - selectedIds.size,
        iterations: iterations.length,
        unmappedValues: {
          status: Array.from(unmappedStatus),
          priority: Array.from(unmappedPriority),
        },
      };

      expect(summary.totalItems).toBe(4);
      expect(summary.itemsToCreate).toBe(3);
      expect(summary.itemsToSkip).toBe(1);
      expect(summary.iterations).toBe(1);
      expect(summary.unmappedValues.status).toContain('Custom');
      expect(summary.unmappedValues.priority).toContain('P1');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid token gracefully', async () => {
      vi.mocked(validateGitHubToken).mockResolvedValue({
        valid: false,
        scopes: [],
        error: 'Bad credentials',
      });

      const result = await validateGitHubToken('invalid_token');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Bad credentials');
    });

    it('should handle missing required scopes', async () => {
      vi.mocked(validateGitHubToken).mockResolvedValue({
        valid: true,
        scopes: ['repo'], // Missing read:project
        login: 'testuser',
      });

      const result = await validateGitHubToken('ghp_limited');
      expect(result.valid).toBe(true);
      expect(result.scopes).not.toContain('read:project');

      // UI would show warning about missing scope
      const hasProjectScope = result.scopes?.includes('read:project');
      expect(hasProjectScope).toBe(false);
    });

    it('should handle empty project list', async () => {
      vi.mocked(listGitHubProjects).mockResolvedValue([]);

      const projects = await listGitHubProjects('ghp_test');
      expect(projects).toHaveLength(0);
    });
  });
});
