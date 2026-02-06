import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { createLazyRouteHandler, type RouteDefinition } from './route-loader.js';

describe('route loader lazy handler', () => {
  it('loads the route on first request and caches it', async () => {
    const subapp = new Hono();
    subapp.get('/status', (c) => c.json({ ok: true }));

    const load = vi.fn(async () => subapp);
    const definition: RouteDefinition = {
      id: 'mock',
      mountPaths: ['/api/mock'],
      load,
    };

    const app = new Hono();
    const handler = createLazyRouteHandler(definition, '/api/mock');
    app.all('/api/mock', handler);
    app.all('/api/mock/*', handler);

    expect(load).not.toHaveBeenCalled();

    const firstResponse = await app.request('http://localhost/api/mock/status');
    expect(firstResponse.status).toBe(200);
    expect(await firstResponse.json()).toEqual({ ok: true });
    expect(load).toHaveBeenCalledTimes(1);

    const secondResponse = await app.request('http://localhost/api/mock/status');
    expect(secondResponse.status).toBe(200);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('rewrites the mount root to slash for nested route roots', async () => {
    const subapp = new Hono();
    subapp.get('/', (c) => c.text('root-ok'));

    const definition: RouteDefinition = {
      id: 'root',
      mountPaths: ['/api/root'],
      load: async () => subapp,
    };

    const app = new Hono();
    const handler = createLazyRouteHandler(definition, '/api/root');
    app.all('/api/root', handler);

    const response = await app.request('http://localhost/api/root');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('root-ok');
  });
});
