import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Hoisted mock factories - must come before vi.mock() calls
// ---------------------------------------------------------------------------
const {
  mockCreateProject,
  mockGetProject,
  mockGetProjectByKey,
  mockGetProjectWithRelations,
  mockUpdateProject,
  mockArchiveProject,
  mockDeleteProject,
  mockQueryProjects,
  mockCreateProjectExternalLink,
  mockGetProjectExternalLinks,
  mockFindProjectByExternalId,
  mockGetOrCreateDefaultProject,
  mockMigrateTicketsToDefaultProject,
  mockCreateSprint,
  mockGetSprint,
  mockGetSprintWithStats,
  mockUpdateSprint,
  mockStartSprint,
  mockCompleteSprint,
  mockCancelSprint,
  mockDeleteSprint,
  mockQuerySprints,
  mockGetActiveSprint,
  mockAddTicketsToSprint,
  mockRemoveTicketFromSprint,
  mockGetSprintTickets,
  mockReorderSprintTickets,
} = vi.hoisted(() => ({
  mockCreateProject: vi.fn(),
  mockGetProject: vi.fn(),
  mockGetProjectByKey: vi.fn(),
  mockGetProjectWithRelations: vi.fn(),
  mockUpdateProject: vi.fn(),
  mockArchiveProject: vi.fn(),
  mockDeleteProject: vi.fn(),
  mockQueryProjects: vi.fn(),
  mockCreateProjectExternalLink: vi.fn(),
  mockGetProjectExternalLinks: vi.fn(),
  mockFindProjectByExternalId: vi.fn(),
  mockGetOrCreateDefaultProject: vi.fn(),
  mockMigrateTicketsToDefaultProject: vi.fn(),
  mockCreateSprint: vi.fn(),
  mockGetSprint: vi.fn(),
  mockGetSprintWithStats: vi.fn(),
  mockUpdateSprint: vi.fn(),
  mockStartSprint: vi.fn(),
  mockCompleteSprint: vi.fn(),
  mockCancelSprint: vi.fn(),
  mockDeleteSprint: vi.fn(),
  mockQuerySprints: vi.fn(),
  mockGetActiveSprint: vi.fn(),
  mockAddTicketsToSprint: vi.fn(),
  mockRemoveTicketFromSprint: vi.fn(),
  mockGetSprintTickets: vi.fn(),
  mockReorderSprintTickets: vi.fn(),
}));

vi.mock('../../projects/index.js', () => ({
  createProject: mockCreateProject,
  getProject: mockGetProject,
  getProjectByKey: mockGetProjectByKey,
  getProjectWithRelations: mockGetProjectWithRelations,
  updateProject: mockUpdateProject,
  archiveProject: mockArchiveProject,
  deleteProject: mockDeleteProject,
  queryProjects: mockQueryProjects,
  createProjectExternalLink: mockCreateProjectExternalLink,
  getProjectExternalLinks: mockGetProjectExternalLinks,
  findProjectByExternalId: mockFindProjectByExternalId,
  getOrCreateDefaultProject: mockGetOrCreateDefaultProject,
  migrateTicketsToDefaultProject: mockMigrateTicketsToDefaultProject,
  createSprint: mockCreateSprint,
  getSprint: mockGetSprint,
  getSprintWithStats: mockGetSprintWithStats,
  updateSprint: mockUpdateSprint,
  startSprint: mockStartSprint,
  completeSprint: mockCompleteSprint,
  cancelSprint: mockCancelSprint,
  deleteSprint: mockDeleteSprint,
  querySprints: mockQuerySprints,
  getActiveSprint: mockGetActiveSprint,
  addTicketsToSprint: mockAddTicketsToSprint,
  removeTicketFromSprint: mockRemoveTicketFromSprint,
  getSprintTickets: mockGetSprintTickets,
  reorderSprintTickets: mockReorderSprintTickets,
  // Schemas re-exported from the real module via vi.importActual is not needed
  // because zod validation is done on the router side using the schema.
  // We must provide these as real Zod objects so the route file can call .safeParse().
  CreateProjectSchema: {
    safeParse: (data: unknown) => {
      const d = data as Record<string, unknown>;
      if (!d || typeof d !== 'object' || !d['name'] || !d['key']) {
        return { success: false, error: { flatten: () => ({ fieldErrors: { name: ['Required'], key: ['Required'] } }) } };
      }
      return { success: true, data: d };
    },
  },
  UpdateProjectSchema: {
    safeParse: (data: unknown) => {
      if (!data || typeof data !== 'object') {
        return { success: false, error: { flatten: () => ({ fieldErrors: {} }) } };
      }
      return { success: true, data };
    },
  },
  CreateSprintSchema: {
    safeParse: (data: unknown) => {
      const d = data as Record<string, unknown>;
      if (!d || typeof d !== 'object' || !d['name']) {
        return { success: false, error: { flatten: () => ({ fieldErrors: { name: ['Required'] } }) } };
      }
      return { success: true, data: d };
    },
  },
  UpdateSprintSchema: {
    safeParse: (data: unknown) => {
      if (!data || typeof data !== 'object') {
        return { success: false, error: { flatten: () => ({ fieldErrors: {} }) } };
      }
      return { success: true, data };
    },
  },
  AddTicketsToSprintSchema: {
    safeParse: (data: unknown) => {
      const d = data as Record<string, unknown>;
      if (!d || typeof d !== 'object' || !Array.isArray(d['ticketIds'])) {
        return { success: false, error: { flatten: () => ({ fieldErrors: { ticketIds: ['Required'] } }) } };
      }
      return { success: true, data: d };
    },
  },
}));

import { projectsRoutes } from '../projects.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
const PROJECT = {
  id: 'proj-1',
  name: 'Alpha',
  key: 'ALP',
  status: 'active',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const SPRINT = {
  id: 'sprint-1',
  projectId: 'proj-1',
  name: 'Sprint 1',
  status: 'planning',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

function buildApp(): Hono {
  const app = new Hono();
  app.route('/projects', projectsRoutes);
  return app;
}

function req(
  url: string,
  method = 'GET',
  body?: unknown,
): Request {
  const opts: RequestInit = { method };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  return new Request(`http://localhost${url}`, opts);
}

// ---------------------------------------------------------------------------
// Projects - list
// ---------------------------------------------------------------------------
describe('GET /projects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryProjects.mockResolvedValue({ projects: [PROJECT], total: 1 });
  });

  it('returns a list of projects with pagination defaults', async () => {
    const res = await buildApp().fetch(req('/projects'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.projects).toHaveLength(1);
    expect(json.total).toBe(1);
    expect(json.limit).toBe(50);
    expect(json.offset).toBe(0);
  });

  it('passes status filter (single)', async () => {
    mockQueryProjects.mockResolvedValue({ projects: [], total: 0 });
    await buildApp().fetch(req('/projects?status=active'));

    expect(mockQueryProjects).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' }),
    );
  });

  it('passes status filter (comma-separated as array)', async () => {
    mockQueryProjects.mockResolvedValue({ projects: [], total: 0 });
    await buildApp().fetch(req('/projects?status=active,archived'));

    expect(mockQueryProjects).toHaveBeenCalledWith(
      expect.objectContaining({ status: ['active', 'archived'] }),
    );
  });

  it('passes search / q param', async () => {
    mockQueryProjects.mockResolvedValue({ projects: [], total: 0 });
    await buildApp().fetch(req('/projects?q=alpha'));

    expect(mockQueryProjects).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'alpha' }),
    );
  });

  it('parses limit and offset as integers', async () => {
    mockQueryProjects.mockResolvedValue({ projects: [], total: 0 });
    await buildApp().fetch(req('/projects?limit=10&offset=20'));

    expect(mockQueryProjects).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 20 }),
    );
  });

  it('sets includeArchived when flag is true', async () => {
    mockQueryProjects.mockResolvedValue({ projects: [], total: 0 });
    await buildApp().fetch(req('/projects?includeArchived=true'));

    expect(mockQueryProjects).toHaveBeenCalledWith(
      expect.objectContaining({ includeArchived: true }),
    );
  });

  it('returns 500 when queryProjects throws', async () => {
    mockQueryProjects.mockRejectedValue(new Error('DB failure'));
    const res = await buildApp().fetch(req('/projects'));

    expect(res.status).toBe(500);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBe('Failed to query projects');
  });
});

// ---------------------------------------------------------------------------
// Projects - create
// ---------------------------------------------------------------------------
describe('POST /projects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateProject.mockResolvedValue(PROJECT);
  });

  it('creates a project and returns 201', async () => {
    const res = await buildApp().fetch(req('/projects', 'POST', { name: 'Alpha', key: 'ALP' }));

    expect(res.status).toBe(201);
    const json = await res.json() as Record<string, unknown>;
    expect(json.message).toBe('Project created');
    expect((json.project as Record<string, unknown>).id).toBe('proj-1');
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await buildApp().fetch(req('/projects', 'POST', { description: 'No name or key' }));

    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBe('Validation failed');
  });

  it('returns 409 on UNIQUE constraint violation', async () => {
    const err = new Error('UNIQUE constraint failed: projects.key');
    mockCreateProject.mockRejectedValue(err);

    const res = await buildApp().fetch(req('/projects', 'POST', { name: 'Alpha', key: 'ALP' }));

    expect(res.status).toBe(409);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBe('Project key already exists');
  });

  it('returns 409 on SQLITE_CONSTRAINT code', async () => {
    const err = Object.assign(new Error('Constraint'), { code: 'SQLITE_CONSTRAINT' });
    mockCreateProject.mockRejectedValue(err);

    const res = await buildApp().fetch(req('/projects', 'POST', { name: 'Alpha', key: 'ALP' }));

    expect(res.status).toBe(409);
  });

  it('returns 500 on unexpected DB error', async () => {
    mockCreateProject.mockRejectedValue(new Error('Unexpected'));

    const res = await buildApp().fetch(req('/projects', 'POST', { name: 'Alpha', key: 'ALP' }));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Projects - default
// ---------------------------------------------------------------------------
describe('GET /projects/default', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the default project', async () => {
    mockGetOrCreateDefaultProject.mockResolvedValue(PROJECT);
    const res = await buildApp().fetch(req('/projects/default'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect((json.project as Record<string, unknown>).key).toBe('ALP');
  });

  it('returns 500 when getOrCreateDefaultProject throws', async () => {
    mockGetOrCreateDefaultProject.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(req('/projects/default'));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Projects - migrate
// ---------------------------------------------------------------------------
describe('POST /projects/migrate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns migration result', async () => {
    mockMigrateTicketsToDefaultProject.mockResolvedValue({ migrated: 7 });
    const res = await buildApp().fetch(req('/projects/migrate', 'POST'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.message).toBe('Migration complete');
    expect(json.migrated).toBe(7);
  });

  it('returns 500 on failure', async () => {
    mockMigrateTicketsToDefaultProject.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(req('/projects/migrate', 'POST'));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Projects - by-key
// ---------------------------------------------------------------------------
describe('GET /projects/by-key/:key', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns project when found', async () => {
    mockGetProjectByKey.mockResolvedValue(PROJECT);
    const res = await buildApp().fetch(req('/projects/by-key/ALP'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect((json.project as Record<string, unknown>).key).toBe('ALP');
  });

  it('returns 404 when not found', async () => {
    mockGetProjectByKey.mockResolvedValue(null);
    const res = await buildApp().fetch(req('/projects/by-key/NOPE'));

    expect(res.status).toBe(404);
  });

  it('returns 500 on error', async () => {
    mockGetProjectByKey.mockRejectedValue(new Error('db fail'));
    const res = await buildApp().fetch(req('/projects/by-key/ERR'));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Projects - by-external
// ---------------------------------------------------------------------------
describe('GET /projects/by-external/:platform/:externalId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns project when found', async () => {
    mockFindProjectByExternalId.mockResolvedValue(PROJECT);
    const res = await buildApp().fetch(req('/projects/by-external/github/repo-42'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.project).toBeTruthy();
    expect(mockFindProjectByExternalId).toHaveBeenCalledWith('github', 'repo-42');
  });

  it('returns 404 when not found', async () => {
    mockFindProjectByExternalId.mockResolvedValue(null);
    const res = await buildApp().fetch(req('/projects/by-external/jira/JIRA-1'));

    expect(res.status).toBe(404);
  });

  it('returns 500 on error', async () => {
    mockFindProjectByExternalId.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(req('/projects/by-external/linear/lin-1'));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Projects - get by ID
// ---------------------------------------------------------------------------
describe('GET /projects/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProject.mockResolvedValue(PROJECT);
  });

  it('returns a project by id', async () => {
    const res = await buildApp().fetch(req('/projects/proj-1'));

    expect(res.status).toBe(200);
    expect(mockGetProject).toHaveBeenCalledWith('proj-1');
  });

  it('uses getProjectWithRelations when include=all', async () => {
    mockGetProjectWithRelations.mockResolvedValue({ ...PROJECT, sprints: [] });
    const res = await buildApp().fetch(req('/projects/proj-1?include=all'));

    expect(res.status).toBe(200);
    expect(mockGetProjectWithRelations).toHaveBeenCalledWith('proj-1');
    expect(mockGetProject).not.toHaveBeenCalled();
  });

  it('returns 404 when project not found', async () => {
    mockGetProject.mockResolvedValue(null);
    const res = await buildApp().fetch(req('/projects/missing'));

    expect(res.status).toBe(404);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBe('Project not found');
  });

  it('returns 500 on DB error', async () => {
    mockGetProject.mockRejectedValue(new Error('db fail'));
    const res = await buildApp().fetch(req('/projects/proj-1'));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Projects - update
// ---------------------------------------------------------------------------
describe('PATCH /projects/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateProject.mockResolvedValue({ ...PROJECT, name: 'Updated' });
  });

  it('updates a project successfully', async () => {
    const res = await buildApp().fetch(req('/projects/proj-1', 'PATCH', { name: 'Updated' }));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.message).toBe('Project updated');
  });

  it('returns 400 on invalid body', async () => {
    const res = await buildApp().fetch(new Request('http://localhost/projects/proj-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    }));

    // Hono will return 400 for JSON parse errors
    expect([400, 500]).toContain(res.status);
  });

  it('returns 404 when update throws not found', async () => {
    mockUpdateProject.mockRejectedValue(new Error('Project not found in database'));
    const res = await buildApp().fetch(req('/projects/missing', 'PATCH', { name: 'X' }));

    expect(res.status).toBe(404);
  });

  it('returns 500 on unexpected error', async () => {
    mockUpdateProject.mockRejectedValue(new Error('Unexpected DB error'));
    const res = await buildApp().fetch(req('/projects/proj-1', 'PATCH', { name: 'X' }));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Projects - archive
// ---------------------------------------------------------------------------
describe('POST /projects/:id/archive', () => {
  beforeEach(() => vi.clearAllMocks());

  it('archives a project', async () => {
    mockArchiveProject.mockResolvedValue({ ...PROJECT, status: 'archived' });
    const res = await buildApp().fetch(req('/projects/proj-1/archive', 'POST'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.message).toBe('Project archived');
  });

  it('returns 404 when project not found', async () => {
    mockArchiveProject.mockRejectedValue(new Error('Project not found'));
    const res = await buildApp().fetch(req('/projects/missing/archive', 'POST'));

    expect(res.status).toBe(404);
  });

  it('returns 500 on unexpected error', async () => {
    mockArchiveProject.mockRejectedValue(new Error('DB failure'));
    const res = await buildApp().fetch(req('/projects/proj-1/archive', 'POST'));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Projects - delete
// ---------------------------------------------------------------------------
describe('DELETE /projects/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes a project and returns 200', async () => {
    mockDeleteProject.mockResolvedValue(undefined);
    const res = await buildApp().fetch(req('/projects/proj-1', 'DELETE'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.message).toBe('Project deleted');
  });

  it('returns 500 on error', async () => {
    mockDeleteProject.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(req('/projects/proj-1', 'DELETE'));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Project external links
// ---------------------------------------------------------------------------
describe('GET /projects/:id/external-links', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns external links', async () => {
    const links = [{ id: 'link-1', platform: 'github', externalId: 'repo-1' }];
    mockGetProjectExternalLinks.mockResolvedValue(links);

    const res = await buildApp().fetch(req('/projects/proj-1/external-links'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(Array.isArray(json.externalLinks)).toBe(true);
  });

  it('returns 500 on error', async () => {
    mockGetProjectExternalLinks.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(req('/projects/proj-1/external-links'));

    expect(res.status).toBe(500);
  });
});

describe('POST /projects/:id/external-links', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates an external link', async () => {
    const link = { id: 'link-1', platform: 'github', externalId: 'repo-1' };
    mockCreateProjectExternalLink.mockResolvedValue(link);

    const res = await buildApp().fetch(req('/projects/proj-1/external-links', 'POST', {
      platform: 'github',
      externalId: 'repo-1',
      externalUrl: 'https://github.com/org/repo',
    }));

    expect(res.status).toBe(201);
    const json = await res.json() as Record<string, unknown>;
    expect(json.message).toBe('External link created');
  });

  it('returns 400 when platform is missing', async () => {
    const res = await buildApp().fetch(req('/projects/proj-1/external-links', 'POST', {
      externalId: 'repo-1',
    }));

    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBe('platform and externalId are required');
  });

  it('returns 400 when externalId is missing', async () => {
    const res = await buildApp().fetch(req('/projects/proj-1/external-links', 'POST', {
      platform: 'github',
    }));

    expect(res.status).toBe(400);
  });

  it('returns 500 on DB error', async () => {
    mockCreateProjectExternalLink.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(req('/projects/proj-1/external-links', 'POST', {
      platform: 'github',
      externalId: 'repo-1',
    }));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Sprints - list
// ---------------------------------------------------------------------------
describe('GET /projects/:projectId/sprints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuerySprints.mockResolvedValue({ sprints: [SPRINT], total: 1 });
  });

  it('returns sprints with pagination defaults', async () => {
    const res = await buildApp().fetch(req('/projects/proj-1/sprints'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.sprints).toHaveLength(1);
    expect(json.total).toBe(1);
    expect(json.limit).toBe(50);
    expect(json.offset).toBe(0);
    expect(mockQuerySprints).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-1' }),
    );
  });

  it('passes status filter for sprints', async () => {
    mockQuerySprints.mockResolvedValue({ sprints: [], total: 0 });
    await buildApp().fetch(req('/projects/proj-1/sprints?status=active'));

    expect(mockQuerySprints).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' }),
    );
  });

  it('passes comma-separated status as array', async () => {
    mockQuerySprints.mockResolvedValue({ sprints: [], total: 0 });
    await buildApp().fetch(req('/projects/proj-1/sprints?status=planning,active'));

    expect(mockQuerySprints).toHaveBeenCalledWith(
      expect.objectContaining({ status: ['planning', 'active'] }),
    );
  });

  it('returns 500 on error', async () => {
    mockQuerySprints.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(req('/projects/proj-1/sprints'));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Sprints - create
// ---------------------------------------------------------------------------
describe('POST /projects/:projectId/sprints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSprint.mockResolvedValue(SPRINT);
  });

  it('creates a sprint and returns 201', async () => {
    const res = await buildApp().fetch(req('/projects/proj-1/sprints', 'POST', { name: 'Sprint 1' }));

    expect(res.status).toBe(201);
    const json = await res.json() as Record<string, unknown>;
    expect(json.message).toBe('Sprint created');
    expect(mockCreateSprint).toHaveBeenCalledWith('proj-1', expect.objectContaining({ name: 'Sprint 1' }));
  });

  it('returns 400 when name is missing', async () => {
    const res = await buildApp().fetch(req('/projects/proj-1/sprints', 'POST', { startDate: '2024-01-01' }));

    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBe('Validation failed');
  });

  it('returns 404 when project not found', async () => {
    mockCreateSprint.mockRejectedValue(new Error('Project not found'));
    const res = await buildApp().fetch(req('/projects/missing/sprints', 'POST', { name: 'Sprint 1' }));

    expect(res.status).toBe(404);
  });

  it('returns 500 on unexpected error', async () => {
    mockCreateSprint.mockRejectedValue(new Error('DB error'));
    const res = await buildApp().fetch(req('/projects/proj-1/sprints', 'POST', { name: 'Sprint 1' }));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Sprints - active
// ---------------------------------------------------------------------------
describe('GET /projects/:projectId/sprints/active', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns active sprint', async () => {
    mockGetActiveSprint.mockResolvedValue({ ...SPRINT, status: 'active' });
    const res = await buildApp().fetch(req('/projects/proj-1/sprints/active'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.sprint).toBeTruthy();
  });

  it('returns 404 when no active sprint', async () => {
    mockGetActiveSprint.mockResolvedValue(null);
    const res = await buildApp().fetch(req('/projects/proj-1/sprints/active'));

    expect(res.status).toBe(404);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBe('No active sprint');
  });

  it('returns 500 on error', async () => {
    mockGetActiveSprint.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(req('/projects/proj-1/sprints/active'));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Sprints - get by ID
// ---------------------------------------------------------------------------
describe('GET /projects/:projectId/sprints/:sprintId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSprint.mockResolvedValue(SPRINT);
  });

  it('returns sprint by id', async () => {
    const res = await buildApp().fetch(req('/projects/proj-1/sprints/sprint-1'));

    expect(res.status).toBe(200);
    expect(mockGetSprint).toHaveBeenCalledWith('sprint-1');
  });

  it('uses getSprintWithStats when include=stats', async () => {
    mockGetSprintWithStats.mockResolvedValue({ ...SPRINT, stats: { total: 5, completed: 3 } });
    const res = await buildApp().fetch(req('/projects/proj-1/sprints/sprint-1?include=stats'));

    expect(res.status).toBe(200);
    expect(mockGetSprintWithStats).toHaveBeenCalledWith('sprint-1');
    expect(mockGetSprint).not.toHaveBeenCalled();
  });

  it('returns 404 when sprint not found', async () => {
    mockGetSprint.mockResolvedValue(null);
    const res = await buildApp().fetch(req('/projects/proj-1/sprints/missing'));

    expect(res.status).toBe(404);
  });

  it('returns 500 on error', async () => {
    mockGetSprint.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(req('/projects/proj-1/sprints/sprint-1'));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Sprints - update
// ---------------------------------------------------------------------------
describe('PATCH /projects/:projectId/sprints/:sprintId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateSprint.mockResolvedValue({ ...SPRINT, name: 'Sprint 1 Updated' });
  });

  it('updates a sprint', async () => {
    const res = await buildApp().fetch(req('/projects/proj-1/sprints/sprint-1', 'PATCH', { name: 'Sprint 1 Updated' }));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.message).toBe('Sprint updated');
  });

  it('returns 404 when sprint not found', async () => {
    mockUpdateSprint.mockRejectedValue(new Error('Sprint not found'));
    const res = await buildApp().fetch(req('/projects/proj-1/sprints/missing', 'PATCH', { name: 'X' }));

    expect(res.status).toBe(404);
  });

  it('returns 500 on unexpected error', async () => {
    mockUpdateSprint.mockRejectedValue(new Error('DB error'));
    const res = await buildApp().fetch(req('/projects/proj-1/sprints/sprint-1', 'PATCH', { name: 'X' }));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Sprint lifecycle - start / complete / cancel / delete
// ---------------------------------------------------------------------------
describe('POST /projects/:projectId/sprints/:sprintId/start', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts a sprint', async () => {
    mockStartSprint.mockResolvedValue({ ...SPRINT, status: 'active' });
    const res = await buildApp().fetch(req('/projects/proj-1/sprints/sprint-1/start', 'POST'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.message).toBe('Sprint started');
  });

  it('returns 404 when sprint not found', async () => {
    mockStartSprint.mockRejectedValue(new Error('Sprint not found'));
    const res = await buildApp().fetch(req('/projects/proj-1/sprints/missing/start', 'POST'));

    expect(res.status).toBe(404);
  });

  it('returns 400 when sprint cannot be started', async () => {
    mockStartSprint.mockRejectedValue(new Error('Sprint cannot be started in its current state'));
    const res = await buildApp().fetch(req('/projects/proj-1/sprints/sprint-1/start', 'POST'));

    expect(res.status).toBe(400);
  });

  it('returns 500 on unexpected error', async () => {
    mockStartSprint.mockRejectedValue(new Error('DB error'));
    const res = await buildApp().fetch(req('/projects/proj-1/sprints/sprint-1/start', 'POST'));

    expect(res.status).toBe(500);
  });
});

describe('POST /projects/:projectId/sprints/:sprintId/complete', () => {
  beforeEach(() => vi.clearAllMocks());

  it('completes a sprint', async () => {
    mockCompleteSprint.mockResolvedValue({ ...SPRINT, status: 'completed' });
    const res = await buildApp().fetch(req('/projects/proj-1/sprints/sprint-1/complete', 'POST'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.message).toBe('Sprint completed');
  });

  it('returns 404 when sprint not found', async () => {
    mockCompleteSprint.mockRejectedValue(new Error('Sprint not found'));
    const res = await buildApp().fetch(req('/projects/proj-1/sprints/missing/complete', 'POST'));

    expect(res.status).toBe(404);
  });

  it('returns 400 when sprint cannot be completed', async () => {
    mockCompleteSprint.mockRejectedValue(new Error('Sprint cannot be completed'));
    const res = await buildApp().fetch(req('/projects/proj-1/sprints/sprint-1/complete', 'POST'));

    expect(res.status).toBe(400);
  });
});

describe('POST /projects/:projectId/sprints/:sprintId/cancel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cancels a sprint', async () => {
    mockCancelSprint.mockResolvedValue({ ...SPRINT, status: 'cancelled' });
    const res = await buildApp().fetch(req('/projects/proj-1/sprints/sprint-1/cancel', 'POST'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.message).toBe('Sprint cancelled');
  });

  it('returns 404 when sprint not found', async () => {
    mockCancelSprint.mockRejectedValue(new Error('Sprint not found'));
    const res = await buildApp().fetch(req('/projects/proj-1/sprints/missing/cancel', 'POST'));

    expect(res.status).toBe(404);
  });

  it('returns 500 on unexpected error', async () => {
    mockCancelSprint.mockRejectedValue(new Error('DB error'));
    const res = await buildApp().fetch(req('/projects/proj-1/sprints/sprint-1/cancel', 'POST'));

    expect(res.status).toBe(500);
  });
});

describe('DELETE /projects/:projectId/sprints/:sprintId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes a sprint', async () => {
    mockDeleteSprint.mockResolvedValue(undefined);
    const res = await buildApp().fetch(req('/projects/proj-1/sprints/sprint-1', 'DELETE'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.message).toBe('Sprint deleted');
  });

  it('returns 500 on error', async () => {
    mockDeleteSprint.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(req('/projects/proj-1/sprints/sprint-1', 'DELETE'));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Sprint tickets
// ---------------------------------------------------------------------------
describe('GET /projects/:projectId/sprints/:sprintId/tickets', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns ticket ids in sprint', async () => {
    mockGetSprintTickets.mockResolvedValue(['ticket-1', 'ticket-2']);
    const res = await buildApp().fetch(req('/projects/proj-1/sprints/sprint-1/tickets'));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.ticketIds).toEqual(['ticket-1', 'ticket-2']);
  });

  it('returns 500 on error', async () => {
    mockGetSprintTickets.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(req('/projects/proj-1/sprints/sprint-1/tickets'));

    expect(res.status).toBe(500);
  });
});

describe('POST /projects/:projectId/sprints/:sprintId/tickets', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adds tickets to sprint', async () => {
    const assignments = [{ sprintId: 'sprint-1', ticketId: 'ticket-1' }];
    mockAddTicketsToSprint.mockResolvedValue(assignments);

    const res = await buildApp().fetch(req(
      '/projects/proj-1/sprints/sprint-1/tickets',
      'POST',
      { ticketIds: ['ticket-1'] },
    ));

    expect(res.status).toBe(201);
    const json = await res.json() as Record<string, unknown>;
    expect(json.message).toBe('Tickets added to sprint');
    expect(mockAddTicketsToSprint).toHaveBeenCalledWith('sprint-1', expect.objectContaining({ ticketIds: ['ticket-1'] }));
  });

  it('returns 400 when ticketIds is missing', async () => {
    const res = await buildApp().fetch(req(
      '/projects/proj-1/sprints/sprint-1/tickets',
      'POST',
      { position: 0 },
    ));

    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBe('Validation failed');
  });

  it('returns 404 when sprint not found', async () => {
    mockAddTicketsToSprint.mockRejectedValue(new Error('Sprint not found'));
    const res = await buildApp().fetch(req(
      '/projects/proj-1/sprints/missing/tickets',
      'POST',
      { ticketIds: ['ticket-1'] },
    ));

    expect(res.status).toBe(404);
  });
});

describe('DELETE /projects/:projectId/sprints/:sprintId/tickets/:ticketId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('removes a ticket from sprint', async () => {
    mockRemoveTicketFromSprint.mockResolvedValue(undefined);
    const res = await buildApp().fetch(
      req('/projects/proj-1/sprints/sprint-1/tickets/ticket-1', 'DELETE'),
    );

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.message).toBe('Ticket removed from sprint');
    expect(mockRemoveTicketFromSprint).toHaveBeenCalledWith('sprint-1', 'ticket-1');
  });

  it('returns 500 on error', async () => {
    mockRemoveTicketFromSprint.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(
      req('/projects/proj-1/sprints/sprint-1/tickets/ticket-1', 'DELETE'),
    );

    expect(res.status).toBe(500);
  });
});

describe('PUT /projects/:projectId/sprints/:sprintId/tickets/reorder', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reorders tickets in sprint', async () => {
    mockReorderSprintTickets.mockResolvedValue(undefined);
    const res = await buildApp().fetch(req(
      '/projects/proj-1/sprints/sprint-1/tickets/reorder',
      'PUT',
      { ticketOrder: ['ticket-2', 'ticket-1'] },
    ));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.message).toBe('Tickets reordered');
    expect(mockReorderSprintTickets).toHaveBeenCalledWith('sprint-1', ['ticket-2', 'ticket-1']);
  });

  it('returns 400 when ticketOrder is not an array', async () => {
    const res = await buildApp().fetch(req(
      '/projects/proj-1/sprints/sprint-1/tickets/reorder',
      'PUT',
      { ticketOrder: 'not-an-array' },
    ));

    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBe('ticketOrder must be an array of ticket IDs');
  });

  it('returns 400 when ticketOrder is missing', async () => {
    const res = await buildApp().fetch(req(
      '/projects/proj-1/sprints/sprint-1/tickets/reorder',
      'PUT',
      {},
    ));

    expect(res.status).toBe(400);
  });

  it('returns 500 on error', async () => {
    mockReorderSprintTickets.mockRejectedValue(new Error('fail'));
    const res = await buildApp().fetch(req(
      '/projects/proj-1/sprints/sprint-1/tickets/reorder',
      'PUT',
      { ticketOrder: ['ticket-1'] },
    ));

    expect(res.status).toBe(500);
  });
});
