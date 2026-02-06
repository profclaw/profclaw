import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * GitHub Projects V2 Integration Tests
 *
 * Tests for the GitHub Projects GraphQL client used in the import wizard.
 */

describe('GitHub Projects Integration', () => {
  // Mock fetch globally
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    global.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('validateGitHubToken', () => {
    it('should return valid=true for valid token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            viewer: {
              login: 'testuser',
              id: 'U_123',
            },
          },
        }),
      });

      const { validateGitHubToken } = await import('./github-projects.js');
      const result = await validateGitHubToken('ghp_valid_token');

      expect(result.valid).toBe(true);
      expect(result.username).toBe('testuser');
      expect(result.error).toBeUndefined();
    });

    it('should return valid=false for invalid token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      const { validateGitHubToken } = await import('./github-projects.js');
      const result = await validateGitHubToken('invalid_token');

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should return valid=false on GraphQL errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          errors: [{ message: 'Bad credentials' }],
        }),
      });

      const { validateGitHubToken } = await import('./github-projects.js');
      const result = await validateGitHubToken('bad_token');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Bad credentials');
    });
  });

  describe('listGitHubProjects', () => {
    it('should return list of projects', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            viewer: {
              projectsV2: {
                nodes: [
                  {
                    id: 'PVT_123',
                    number: 1,
                    title: 'Test Project',
                    shortDescription: 'A test project',
                    url: 'https://github.com/users/test/projects/1',
                    public: false,
                    creator: { login: 'testuser' },
                    items: { totalCount: 10 },
                    fields: { totalCount: 5 },
                  },
                  {
                    id: 'PVT_456',
                    number: 2,
                    title: 'Another Project',
                    shortDescription: null,
                    url: 'https://github.com/users/test/projects/2',
                    public: true,
                    creator: { login: 'testuser' },
                    items: { totalCount: 25 },
                    fields: { totalCount: 8 },
                  },
                ],
              },
            },
          },
        }),
      });

      const { listGitHubProjects } = await import('./github-projects.js');
      const projects = await listGitHubProjects('ghp_valid_token');

      expect(projects).toHaveLength(2);
      expect(projects[0]).toMatchObject({
        id: 'PVT_123',
        number: 1,
        title: 'Test Project',
        public: false,
        items: { totalCount: 10 },
      });
      expect(projects[1]).toMatchObject({
        id: 'PVT_456',
        title: 'Another Project',
        public: true,
      });
    });

    it('should return empty array when no projects exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            viewer: {
              projectsV2: {
                nodes: [],
              },
            },
          },
        }),
      });

      const { listGitHubProjects } = await import('./github-projects.js');
      const projects = await listGitHubProjects('ghp_valid_token');

      expect(projects).toHaveLength(0);
    });
  });

  describe('getGitHubProjectPreview', () => {
    it('should return project preview with items and iterations', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            node: {
              id: 'PVT_123',
              title: 'Test Project',
              url: 'https://github.com/users/test/projects/1',
              items: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: 'PVTI_1',
                    content: {
                      number: 1,
                      title: 'First Issue',
                      body: 'Issue description',
                      url: 'https://github.com/org/repo/issues/1',
                      state: 'open',
                      createdAt: '2024-01-01T00:00:00Z',
                      updatedAt: '2024-01-02T00:00:00Z',
                      labels: { nodes: [{ name: 'bug' }] },
                      assignees: { nodes: [{ login: 'dev1' }] },
                      repository: { owner: { login: 'org' }, name: 'repo' },
                    },
                    fieldValues: {
                      nodes: [
                        {
                          name: 'Todo',
                          field: { name: 'Status' },
                        },
                        {
                          name: 'High',
                          field: { name: 'Priority' },
                        },
                      ],
                    },
                  },
                  {
                    id: 'PVTI_2',
                    content: {
                      number: 2,
                      title: 'Second Issue',
                      body: null,
                      url: 'https://github.com/org/repo/issues/2',
                      state: 'open',
                      createdAt: '2024-01-03T00:00:00Z',
                      updatedAt: '2024-01-03T00:00:00Z',
                      labels: { nodes: [] },
                      assignees: { nodes: [] },
                      repository: { owner: { login: 'org' }, name: 'repo' },
                    },
                    fieldValues: {
                      nodes: [
                        {
                          name: 'In Progress',
                          field: { name: 'Status' },
                        },
                      ],
                    },
                  },
                ],
              },
              fields: {
                nodes: [
                  {
                    name: 'Iteration',
                    configuration: {
                      iterations: [
                        {
                          id: 'ITR_1',
                          title: 'Sprint 1',
                          startDate: '2024-01-01',
                          duration: 14,
                        },
                        {
                          id: 'ITR_2',
                          title: 'Sprint 2',
                          startDate: '2024-01-15',
                          duration: 14,
                        },
                      ],
                    },
                  },
                  {
                    name: 'Status',
                    options: [
                      { id: 'opt1', name: 'Todo' },
                      { id: 'opt2', name: 'In Progress' },
                      { id: 'opt3', name: 'Done' },
                    ],
                  },
                  {
                    name: 'Priority',
                    options: [
                      { id: 'p1', name: 'High' },
                      { id: 'p2', name: 'Medium' },
                      { id: 'p3', name: 'Low' },
                    ],
                  },
                ],
              },
            },
          },
        }),
      });

      const { getGitHubProjectPreview } = await import('./github-projects.js');
      const preview = await getGitHubProjectPreview('ghp_valid_token', 'PVT_123');

      expect(preview.project).toMatchObject({
        id: 'PVT_123',
        title: 'Test Project',
      });

      expect(preview.iterations).toHaveLength(2);
      expect(preview.iterations[0]).toMatchObject({
        id: 'ITR_1',
        title: 'Sprint 1',
        duration: 14,
      });

      expect(preview.items).toHaveLength(2);
      expect(preview.items[0]).toMatchObject({
        title: 'First Issue',
        status: 'Todo',
        priority: 'High',
        labels: ['bug'],
        assignees: ['dev1'],
      });
      expect(preview.items[1]).toMatchObject({
        title: 'Second Issue',
        status: 'In Progress',
        labels: [],
        assignees: [],
      });

      // Check field mappings
      expect(preview.fieldMappings.status).toBeDefined();
      expect(preview.fieldMappings.priority).toBeDefined();
    });

    it('should handle project with no items', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            node: {
              id: 'PVT_EMPTY',
              title: 'Empty Project',
              url: 'https://github.com/users/test/projects/3',
              items: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [],
              },
              fields: {
                nodes: [],
              },
            },
          },
        }),
      });

      const { getGitHubProjectPreview } = await import('./github-projects.js');
      const preview = await getGitHubProjectPreview('ghp_valid_token', 'PVT_EMPTY');

      expect(preview.items).toHaveLength(0);
      expect(preview.iterations).toHaveLength(0);
    });

    it('should handle draft issues', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            node: {
              id: 'PVT_DRAFT',
              title: 'Project with Drafts',
              url: 'https://github.com/users/test/projects/4',
              items: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: 'PVTI_DRAFT',
                    content: {
                      title: 'Draft Issue',
                      body: 'Draft description',
                      createdAt: '2024-01-01T00:00:00Z',
                      updatedAt: '2024-01-01T00:00:00Z',
                    },
                    fieldValues: { nodes: [] },
                  },
                ],
              },
              fields: { nodes: [] },
            },
          },
        }),
      });

      const { getGitHubProjectPreview } = await import('./github-projects.js');
      const preview = await getGitHubProjectPreview('ghp_valid_token', 'PVT_DRAFT');

      expect(preview.items).toHaveLength(1);
      expect(preview.items[0].title).toBe('Draft Issue');
      expect(preview.items[0].issueNumber).toBeUndefined();
    });
  });

  describe('field mapping extraction', () => {
    it('should auto-map common status values', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            node: {
              id: 'PVT_MAP',
              title: 'Mapping Test',
              url: 'https://github.com/test',
              items: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [],
              },
              fields: {
                nodes: [
                  {
                    name: 'Status',
                    options: [
                      { id: 's1', name: 'Todo' },
                      { id: 's2', name: 'In Progress' },
                      { id: 's3', name: 'Done' },
                      { id: 's4', name: 'Backlog' },
                    ],
                  },
                ],
              },
            },
          },
        }),
      });

      const { getGitHubProjectPreview } = await import('./github-projects.js');
      const preview = await getGitHubProjectPreview('ghp_valid_token', 'PVT_MAP');

      // Common values should be auto-mapped
      expect(preview.fieldMappings.status['Todo']).toBe('todo');
      expect(preview.fieldMappings.status['In Progress']).toBe('in_progress');
      expect(preview.fieldMappings.status['Done']).toBe('done');
      expect(preview.fieldMappings.status['Backlog']).toBe('backlog');
    });

    it('should auto-map common priority values', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            node: {
              id: 'PVT_PRI',
              title: 'Priority Test',
              url: 'https://github.com/test',
              items: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [],
              },
              fields: {
                nodes: [
                  {
                    name: 'Priority',
                    options: [
                      { id: 'p1', name: 'Critical' },
                      { id: 'p2', name: 'High' },
                      { id: 'p3', name: 'Medium' },
                      { id: 'p4', name: 'Low' },
                    ],
                  },
                ],
              },
            },
          },
        }),
      });

      const { getGitHubProjectPreview } = await import('./github-projects.js');
      const preview = await getGitHubProjectPreview('ghp_valid_token', 'PVT_PRI');

      expect(preview.fieldMappings.priority['Critical']).toBe('critical');
      expect(preview.fieldMappings.priority['High']).toBe('high');
      expect(preview.fieldMappings.priority['Medium']).toBe('medium');
      expect(preview.fieldMappings.priority['Low']).toBe('low');
    });
  });
});
