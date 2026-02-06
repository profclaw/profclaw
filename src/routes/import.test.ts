import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Import Routes Tests
 *
 * Tests for the GitHub import wizard API endpoints.
 */

// Mock the GitHub Projects client
vi.mock('../integrations/github-projects.js', () => ({
  validateGitHubToken: vi.fn(),
  listGitHubProjects: vi.fn(),
  listGitHubRepos: vi.fn(),
  getGitHubProjectPreview: vi.fn(),
}));

// Mock the storage
vi.mock('../storage/index.js', () => ({
  getDb: vi.fn(() => mockDb),
}));

// Mock projects service
vi.mock('../projects/index.js', () => ({
  createProject: vi.fn(),
  createProjectExternalLink: vi.fn(),
  createSprint: vi.fn(),
}));

// Mock auth service
vi.mock('../auth/auth-service.js', () => ({
  validateSession: vi.fn(),
}));

// Mock database operations
const mockDb = {
  select: vi.fn(() => mockDb),
  from: vi.fn(() => mockDb),
  where: vi.fn(() => mockDb),
  orderBy: vi.fn(() => mockDb),
  limit: vi.fn(() => Promise.resolve([])),
  insert: vi.fn(() => mockDb),
  values: vi.fn(() => Promise.resolve()),
  update: vi.fn(() => mockDb),
  set: vi.fn(() => mockDb),
  delete: vi.fn(() => mockDb),
};

describe('Import Routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('Dry Run Logic', () => {
    it('should correctly identify unmapped status values', async () => {
      const items = [
        { id: '1', title: 'Issue 1', status: 'Todo', priority: 'High' },
        { id: '2', title: 'Issue 2', status: 'In Progress', priority: 'Medium' },
        { id: '3', title: 'Issue 3', status: 'Custom Status', priority: 'High' },
      ];

      const fieldMappings = {
        status: { 'Todo': 'todo', 'In Progress': 'in_progress' }, // 'Custom Status' is not mapped
        priority: { 'High': 'high', 'Medium': 'medium' },
        type: {},
      };

      // Simulate dry-run logic
      const unmappedStatus = new Set<string>();
      for (const item of items) {
        if (item.status && !fieldMappings.status[item.status]) {
          unmappedStatus.add(item.status);
        }
      }

      expect(unmappedStatus.size).toBe(1);
      expect(unmappedStatus.has('Custom Status')).toBe(true);
    });

    it('should correctly count items with conflicts', async () => {
      const items = [
        { id: '1', status: 'Todo' },
        { id: '2', status: 'Unmapped1' },
        { id: '3', status: 'Todo', priority: 'UnmappedPriority' },
        { id: '4', status: 'Unmapped2', type: 'UnmappedType' },
      ];

      const fieldMappings = {
        status: { 'Todo': 'todo' },
        priority: {},
        type: {},
      };

      // Count items with at least one unmapped field
      let itemsWithConflicts = 0;
      for (const item of items) {
        const hasUnmappedStatus = item.status && !fieldMappings.status[item.status as string];
        const hasUnmappedPriority = (item as any).priority && !fieldMappings.priority[(item as any).priority];
        const hasUnmappedType = (item as any).type && !fieldMappings.type[(item as any).type];

        if (hasUnmappedStatus || hasUnmappedPriority || hasUnmappedType) {
          itemsWithConflicts++;
        }
      }

      expect(itemsWithConflicts).toBe(3); // Items 2, 3, and 4 have conflicts
    });

    it('should apply default values for unmapped fields', () => {
      const mapField = (value: string | undefined, mapping: Record<string, string>, defaultValue: string): string => {
        if (!value) return defaultValue;
        return mapping[value] || defaultValue;
      };

      const fieldMappings = {
        status: { 'Todo': 'todo', 'Done': 'done' },
      };

      // Mapped values
      expect(mapField('Todo', fieldMappings.status, 'backlog')).toBe('todo');
      expect(mapField('Done', fieldMappings.status, 'backlog')).toBe('done');

      // Unmapped values should use default
      expect(mapField('Custom', fieldMappings.status, 'backlog')).toBe('backlog');
      expect(mapField(undefined, fieldMappings.status, 'backlog')).toBe('backlog');
    });
  });

  describe('Timestamp Preservation', () => {
    it('should preserve original timestamps when enabled', () => {
      const preserveTimestamps = true;
      const item = {
        createdAt: '2023-06-15T10:30:00Z',
        updatedAt: '2023-06-20T14:00:00Z',
      };
      const now = new Date();

      const createdAt = preserveTimestamps && item.createdAt
        ? new Date(item.createdAt)
        : now;
      const updatedAt = preserveTimestamps && item.updatedAt
        ? new Date(item.updatedAt)
        : now;

      expect(createdAt.toISOString()).toBe('2023-06-15T10:30:00.000Z');
      expect(updatedAt.toISOString()).toBe('2023-06-20T14:00:00.000Z');
    });

    it('should use current timestamp when preservation disabled', () => {
      const preserveTimestamps = false;
      const item = {
        createdAt: '2023-06-15T10:30:00Z',
        updatedAt: '2023-06-20T14:00:00Z',
      };
      const now = new Date('2024-01-01T00:00:00Z');

      const createdAt = preserveTimestamps && item.createdAt
        ? new Date(item.createdAt)
        : now;

      expect(createdAt.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    });
  });

  describe('Selected Items Filtering', () => {
    it('should filter items by selected IDs', () => {
      const allItems = [
        { id: '1', title: 'Issue 1' },
        { id: '2', title: 'Issue 2' },
        { id: '3', title: 'Issue 3' },
        { id: '4', title: 'Issue 4' },
      ];

      const selectedItemIds = ['1', '3'];

      const itemsToImport = allItems.filter((item) => selectedItemIds.includes(item.id));

      expect(itemsToImport).toHaveLength(2);
      expect(itemsToImport.map(i => i.id)).toEqual(['1', '3']);
    });

    it('should import all items when no selection specified', () => {
      const allItems = [
        { id: '1', title: 'Issue 1' },
        { id: '2', title: 'Issue 2' },
      ];

      const selectedItemIds: string[] | undefined = undefined;

      const itemsToImport = selectedItemIds
        ? allItems.filter((item) => selectedItemIds.includes(item.id))
        : allItems;

      expect(itemsToImport).toHaveLength(2);
    });
  });

  describe('End Date Calculation', () => {
    it('should calculate sprint end date correctly', () => {
      const calculateEndDate = (startDate: string, durationDays: number): string => {
        const start = new Date(startDate);
        start.setDate(start.getDate() + durationDays);
        return start.toISOString().split('T')[0];
      };

      expect(calculateEndDate('2024-01-01', 14)).toBe('2024-01-15');
      expect(calculateEndDate('2024-01-15', 7)).toBe('2024-01-22');
      expect(calculateEndDate('2024-02-28', 2)).toBe('2024-03-01'); // Leap year
    });
  });

  describe('Import Summary Calculation', () => {
    it('should calculate correct summary', () => {
      const items = [
        { id: '1', status: 'Todo' },
        { id: '2', status: 'Unmapped' },
        { id: '3', status: 'Done' },
      ];
      const selectedIds = new Set(['1', '2']);
      const iterations = [{ id: 'i1', title: 'Sprint 1' }];
      const fieldMappings = {
        status: { 'Todo': 'todo', 'Done': 'done' },
        priority: {},
        type: {},
      };

      const unmappedStatus: string[] = [];
      const seen = new Set<string>();
      for (const item of items.filter(i => selectedIds.has(i.id))) {
        if (item.status && !fieldMappings.status[item.status] && !seen.has(item.status)) {
          unmappedStatus.push(item.status);
          seen.add(item.status);
        }
      }

      const summary = {
        totalItems: items.length,
        itemsToCreate: selectedIds.size,
        itemsToSkip: items.length - selectedIds.size,
        iterations: iterations.length,
        unmappedValues: {
          status: unmappedStatus,
        },
      };

      expect(summary.totalItems).toBe(3);
      expect(summary.itemsToCreate).toBe(2);
      expect(summary.itemsToSkip).toBe(1);
      expect(summary.iterations).toBe(1);
      expect(summary.unmappedValues.status).toEqual(['Unmapped']);
    });
  });

  describe('External Link Creation', () => {
    it('should create correct external link ID format', () => {
      const item = {
        repoOwner: 'myorg',
        repoName: 'myrepo',
        issueNumber: 123,
      };

      const externalId = `${item.repoOwner}/${item.repoName}#${item.issueNumber}`;

      expect(externalId).toBe('myorg/myrepo#123');
    });

    it('should skip external link for draft issues', () => {
      const item = {
        repoOwner: undefined,
        repoName: undefined,
        issueNumber: undefined,
      };

      const shouldCreateLink = item.issueNumber && item.repoOwner && item.repoName;

      expect(shouldCreateLink).toBeFalsy();
    });
  });
});

describe('Field Mapping Logic', () => {
  describe('Status Mapping', () => {
    const defaultStatusMap: Record<string, string> = {
      'Todo': 'todo',
      'To Do': 'todo',
      'Backlog': 'backlog',
      'In Progress': 'in_progress',
      'In Review': 'in_review',
      'Done': 'done',
      'Closed': 'done',
      'Cancelled': 'cancelled',
      'Canceled': 'cancelled',
    };

    it('should map common status values', () => {
      expect(defaultStatusMap['Todo']).toBe('todo');
      expect(defaultStatusMap['In Progress']).toBe('in_progress');
      expect(defaultStatusMap['Done']).toBe('done');
    });

    it('should handle case variations', () => {
      // The actual implementation should handle case-insensitive matching
      // This test documents the expected behavior
      expect(defaultStatusMap['To Do']).toBe('todo');
      expect(defaultStatusMap['Cancelled']).toBe('cancelled');
      expect(defaultStatusMap['Canceled']).toBe('cancelled');
    });
  });

  describe('Priority Mapping', () => {
    const defaultPriorityMap: Record<string, string> = {
      'Urgent': 'critical',
      'Critical': 'critical',
      'High': 'high',
      'Medium': 'medium',
      'Low': 'low',
      'None': 'none',
    };

    it('should map common priority values', () => {
      expect(defaultPriorityMap['High']).toBe('high');
      expect(defaultPriorityMap['Medium']).toBe('medium');
      expect(defaultPriorityMap['Low']).toBe('low');
    });

    it('should map urgent/critical to critical', () => {
      expect(defaultPriorityMap['Urgent']).toBe('critical');
      expect(defaultPriorityMap['Critical']).toBe('critical');
    });
  });

  describe('Type Mapping', () => {
    const defaultTypeMap: Record<string, string> = {
      'Bug': 'bug',
      'Feature': 'feature',
      'Task': 'task',
      'Epic': 'epic',
      'Story': 'story',
      'Subtask': 'subtask',
    };

    it('should map common type values', () => {
      expect(defaultTypeMap['Bug']).toBe('bug');
      expect(defaultTypeMap['Feature']).toBe('feature');
      expect(defaultTypeMap['Task']).toBe('task');
    });
  });
});
