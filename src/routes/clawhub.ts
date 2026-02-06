/**
 * ClawHub Marketplace Routes
 *
 * Browse and install skills from OpenClaw's ClawHub marketplace.
 */

import { Hono } from 'hono';
import { getClawHubClient } from '../plugins/clawhub.js';

export const clawhubRoutes = new Hono();

/**
 * GET /api/clawhub/search - Search ClawHub for skills
 */
clawhubRoutes.get('/search', async (c) => {
  const query = c.req.query('q');
  const hub = getClawHubClient();

  try {
    const results = await hub.search(query || undefined);
    return c.json({ results, count: results.length });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Search failed' },
      500
    );
  }
});

/**
 * GET /api/clawhub/featured - Get featured/popular skills
 */
clawhubRoutes.get('/featured', async (c) => {
  const hub = getClawHubClient();

  try {
    const featured = await hub.getFeatured();
    return c.json({ skills: featured, count: featured.length });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to get featured skills' },
      500
    );
  }
});

/**
 * POST /api/clawhub/install - Install a skill from ClawHub
 */
clawhubRoutes.post('/install', async (c) => {
  const body = await c.req.json<{
    name: string;
    repo: string;
    path?: string;
    author?: string;
    installUrl?: string;
  }>();

  if (!body.name || !body.repo) {
    return c.json({ error: 'name and repo are required' }, 400);
  }

  const hub = getClawHubClient();

  try {
    const installed = await hub.install({
      name: body.name,
      repo: body.repo,
      path: body.path || 'SKILL.md',
      author: body.author || body.repo.split('/')[0],
      description: '',
      stars: 0,
      lastUpdated: '',
      tags: [],
      source: 'clawhub',
      installUrl: body.installUrl || `https://raw.githubusercontent.com/${body.repo}/main/${body.path || 'SKILL.md'}`,
    });

    return c.json({ success: true, skill: installed });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Install failed' },
      500
    );
  }
});

/**
 * POST /api/clawhub/uninstall - Uninstall a ClawHub skill
 */
clawhubRoutes.post('/uninstall', async (c) => {
  const body = await c.req.json<{ name: string }>();

  if (!body.name) {
    return c.json({ error: 'name is required' }, 400);
  }

  const hub = getClawHubClient();

  try {
    hub.uninstall(body.name);
    return c.json({ success: true });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Uninstall failed' },
      500
    );
  }
});

/**
 * GET /api/clawhub/installed - List installed ClawHub skills
 */
clawhubRoutes.get('/installed', (c) => {
  const hub = getClawHubClient();
  const installed = hub.listInstalled();
  return c.json({ skills: installed, count: installed.length });
});
