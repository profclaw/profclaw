import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';

const { mockSettingsApi } = vi.hoisted(() => ({
  mockSettingsApi: {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
    getPluginHealth: vi.fn(),
    togglePlugin: vi.fn(),
  },
}));

vi.mock('../../settings/index.js', () => ({
  getSettings: mockSettingsApi.getSettings,
  updateSettings: mockSettingsApi.updateSettings,
  resetSettings: mockSettingsApi.resetSettings,
  getPluginHealth: mockSettingsApi.getPluginHealth,
  togglePlugin: mockSettingsApi.togglePlugin,
  UpdateSettingsSchema: z.object({
    system: z.object({
      authMode: z.enum(['local', 'multi']).optional(),
    }).optional(),
  }),
}));

import { settingsRoutes } from '../settings.js';

function buildApp(): Hono {
  const app = new Hono();
  app.route('/api/settings', settingsRoutes);
  return app;
}

describe('settingsRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockSettingsApi.getSettings.mockResolvedValue({ system: { authMode: 'local' } });
    mockSettingsApi.updateSettings.mockResolvedValue({ system: { authMode: 'multi' } });
    mockSettingsApi.resetSettings.mockResolvedValue({ system: { authMode: 'local' } });
    mockSettingsApi.getPluginHealth.mockResolvedValue([
      { id: 'search', healthy: true },
    ]);
    mockSettingsApi.togglePlugin.mockResolvedValue({ plugins: { search: { enabled: true } } });
  });

  it('returns current settings on GET /', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/settings'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      settings: { system: { authMode: 'local' } },
    });
  });

  it('returns 400 for malformed JSON on PATCH /', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"system":{"authMode":"multi"}',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 when PATCH / body is not a JSON object', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(['bad']),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Request body must be a JSON object',
    });
  });

  it('returns 400 when PATCH / payload fails schema validation', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: { authMode: 'bad' } }),
    }));

    expect(response.status).toBe(400);
    const json = await response.json() as { error: string; details: unknown };
    expect(json.error).toBe('Validation failed');
    expect(json.details).toBeTruthy();
  });

  it('returns 400 for malformed JSON on POST /plugins/:id/toggle', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/settings/plugins/search/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"enabled":true',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 404 when toggling an unknown plugin', async () => {
    const app = buildApp();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockSettingsApi.togglePlugin.mockRejectedValueOnce(new Error('Unknown plugin: search'));

    const response = await app.fetch(new Request('http://localhost/api/settings/plugins/search/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to toggle plugin',
      message: 'Unknown plugin: search',
    });
  });
});
