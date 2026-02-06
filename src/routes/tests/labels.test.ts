import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const { mockLabelsApi } = vi.hoisted(() => ({
  mockLabelsApi: {
    createLabel: vi.fn(),
    getLabel: vi.fn(),
    listLabels: vi.fn(),
    updateLabel: vi.fn(),
    deleteLabel: vi.fn(),
    getTicketLabels: vi.fn(),
    addLabelToTicket: vi.fn(),
    removeLabelFromTicket: vi.fn(),
    setTicketLabels: vi.fn(),
  },
}));

vi.mock('../../labels/index.js', () => ({
  createLabel: mockLabelsApi.createLabel,
  getLabel: mockLabelsApi.getLabel,
  listLabels: mockLabelsApi.listLabels,
  updateLabel: mockLabelsApi.updateLabel,
  deleteLabel: mockLabelsApi.deleteLabel,
  getTicketLabels: mockLabelsApi.getTicketLabels,
  addLabelToTicket: mockLabelsApi.addLabelToTicket,
  removeLabelFromTicket: mockLabelsApi.removeLabelFromTicket,
  setTicketLabels: mockLabelsApi.setTicketLabels,
}));

import { labelsRoutes } from '../labels.js';

function buildApp(): Hono {
  const app = new Hono();
  app.route('/api', labelsRoutes);
  return app;
}

describe('labelsRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockLabelsApi.createLabel.mockResolvedValue({ id: 'label-1', name: 'Bug', projectId: 'proj-1' });
    mockLabelsApi.updateLabel.mockResolvedValue({ id: 'label-1', name: 'Urgent' });
    mockLabelsApi.getTicketLabels.mockResolvedValue([{ id: 'label-1', name: 'Bug' }]);
    mockLabelsApi.setTicketLabels.mockResolvedValue(undefined);
  });

  it('returns 400 for malformed JSON on POST /projects/:projectId/labels', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/projects/proj-1/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name":"Bug"',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 when PATCH /labels/:id body is not a JSON object', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/labels/label-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(['Urgent']),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Request body must be a JSON object',
    });
  });

  it('creates a label successfully', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/projects/proj-1/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bug', color: '#f00' }),
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      id: 'label-1',
      name: 'Bug',
      projectId: 'proj-1',
    });
  });

  it('returns 400 for malformed JSON on PUT /tickets/:ticketId/labels', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/tickets/ticket-1/labels', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{"labelIds":["label-1"]',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('sets ticket labels successfully', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/tickets/ticket-1/labels', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ labelIds: ['label-1'] }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      labels: [{ id: 'label-1', name: 'Bug' }],
      count: 1,
    });
  });
});
