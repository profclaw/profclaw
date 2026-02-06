/**
 * Plugin Marketplace Routes
 *
 * API endpoints for searching, installing, and managing plugins.
 */

import { Hono } from 'hono';
import { getMarketplace } from '../plugins/marketplace.js';

export const pluginsRoutes = new Hono();

/**
 * GET /api/plugins - List installed plugins
 */
pluginsRoutes.get('/', (c) => {
  const marketplace = getMarketplace();
  const installed = marketplace.listInstalled();
  return c.json({ plugins: installed, count: installed.length });
});

/**
 * GET /api/plugins/search - Search npm registry for plugins
 */
pluginsRoutes.get('/search', async (c) => {
  const query = c.req.query('q');
  const category = c.req.query('category');
  const marketplace = getMarketplace();

  try {
    const results = await marketplace.search(query, category);
    return c.json({ results, count: results.length });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Search failed' },
      500,
    );
  }
});

/**
 * POST /api/plugins/install - Install a plugin
 */
pluginsRoutes.post('/install', async (c) => {
  const body = await c.req.json<{ name: string; version?: string }>();

  if (!body.name) {
    return c.json({ error: 'Plugin name is required' }, 400);
  }

  const marketplace = getMarketplace();

  try {
    const installed = await marketplace.install(body.name, body.version);
    return c.json({ success: true, plugin: installed });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Install failed' },
      500,
    );
  }
});

/**
 * POST /api/plugins/uninstall - Uninstall a plugin
 */
pluginsRoutes.post('/uninstall', async (c) => {
  const body = await c.req.json<{ name: string }>();

  if (!body.name) {
    return c.json({ error: 'Plugin name is required' }, 400);
  }

  const marketplace = getMarketplace();

  try {
    await marketplace.uninstall(body.name);
    return c.json({ success: true });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Uninstall failed' },
      500,
    );
  }
});

/**
 * PATCH /api/plugins/:name/toggle - Enable/disable a plugin
 */
pluginsRoutes.patch('/:name/toggle', async (c) => {
  const name = c.req.param('name');
  const body = await c.req.json<{ enabled: boolean }>();

  const marketplace = getMarketplace();

  try {
    marketplace.setEnabled(name, body.enabled);
    return c.json({ success: true, enabled: body.enabled });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Toggle failed' },
      500,
    );
  }
});

/**
 * GET /api/plugins/updates - Check for updates
 */
pluginsRoutes.get('/updates', async (c) => {
  const marketplace = getMarketplace();

  try {
    const updates = await marketplace.checkUpdates();
    return c.json({ updates, count: updates.length });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Update check failed' },
      500,
    );
  }
});

/**
 * POST /api/plugins/:name/update - Update a plugin
 */
pluginsRoutes.post('/:name/update', async (c) => {
  const name = c.req.param('name');
  const marketplace = getMarketplace();

  try {
    const updated = await marketplace.update(name);
    return c.json({ success: true, plugin: updated });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Update failed' },
      500,
    );
  }
});
