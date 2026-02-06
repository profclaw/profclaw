import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const { mockStatesApi } = vi.hoisted(() => ({
  mockStatesApi: {
    listStates: vi.fn(),
    createState: vi.fn(),
    updateState: vi.fn(),
    deleteState: vi.fn(),
    getState: vi.fn(),
  },
}));

vi.mock('../../states/index.js', () => ({
  listStates: mockStatesApi.listStates,
  createState: mockStatesApi.createState,
  updateState: mockStatesApi.updateState,
  deleteState: mockStatesApi.deleteState,
  getState: mockStatesApi.getState,
}));

import { statesRoutes } from '../states.js';

function buildApp(): Hono {
  const app = new Hono();
  app.route('/api', statesRoutes);
  return app;
}

describe('statesRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatesApi.listStates.mockResolvedValue([{ id: 'state-1', name: 'Todo' }]);
    mockStatesApi.createState.mockResolvedValue({ id: 'state-1', name: 'Todo', projectId: 'proj-1' });
    mockStatesApi.updateState.mockResolvedValue({ id: 'state-1', name: 'Doing' });
    mockStatesApi.deleteState.mockResolvedValue(undefined);
    mockStatesApi.getState.mockResolvedValue(null);
  });

  it('returns 400 for malformed JSON on POST /projects/:projectId/states', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/projects/proj-1/states', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name":"Todo"',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 when PATCH /states/:id body is not a JSON object', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/states/state-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(['Doing']),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Request body must be a JSON object',
    });
  });

  it('creates a state successfully', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/projects/proj-1/states', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Todo', color: '#fff', stateGroup: 'unstarted' }),
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      state: { id: 'state-1', name: 'Todo', projectId: 'proj-1' },
    });
  });

  it('updates a state successfully', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/states/state-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Doing' }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      state: { id: 'state-1', name: 'Doing' },
    });
  });
});
