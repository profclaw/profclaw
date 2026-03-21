/**
 * Feed Routes
 *
 * REST API for managing RSS/Atom feeds and article digests.
 * All endpoints are under /api/feeds.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import {
  addFeed,
  addFeedBundle,
  listFeeds,
  getFeed,
  updateFeed,
  removeFeed,
  toggleFeed,
  pollFeed,
  pollAllFeeds,
  getDigestArticles,
  markAsDigested,
  getFeedStats,
  listCategories,
  discoverFeedUrl,
  FEED_BUNDLES,
} from '../feeds/index.js';
import { logger } from '../utils/logger.js';

const app = new Hono();

// Schemas

const createFeedSchema = z.object({
  name: z.string().min(1).max(200),
  url: z.string().url(),
  category: z.string().max(50).optional(),
  tags: z.array(z.string()).optional(),
  pollIntervalMs: z.number().min(60000).optional(), // Min 1 minute
  metadata: z.record(z.unknown()).optional(),
});

const updateFeedSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  category: z.string().max(50).optional(),
  tags: z.array(z.string()).optional(),
  pollIntervalMs: z.number().min(60000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// Routes

/** List all feeds */
app.get('/', async (c) => {
  const category = c.req.query('category');
  const tag = c.req.query('tag');
  const enabled = c.req.query('enabled');

  const feeds = await listFeeds({
    category: category || undefined,
    tag: tag || undefined,
    enabled: enabled !== undefined ? enabled === 'true' : undefined,
  });

  return c.json({ success: true, data: feeds });
});

/** Get feed stats */
app.get('/stats', async (c) => {
  const stats = await getFeedStats();
  return c.json({ success: true, data: stats });
});

/** List available categories */
app.get('/categories', async (c) => {
  const categories = await listCategories();
  return c.json({ success: true, data: categories });
});

/** List available bundles */
app.get('/bundles', (c) => {
  const bundles = Object.entries(FEED_BUNDLES).map(([name, feeds]) => ({
    name,
    feedCount: feeds.length,
    feeds: feeds.map((f) => ({ name: f.name, url: f.url, category: f.category })),
  }));
  return c.json({ success: true, data: bundles });
});

/** Get a single feed */
app.get('/:id', async (c) => {
  const feed = await getFeed(c.req.param('id'));
  if (!feed) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Feed not found' } }, 404);
  }
  return c.json({ success: true, data: feed });
});

/** Create a new feed */
app.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = createFeedSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
  }

  try {
    const feed = await addFeed(parsed.data);
    return c.json({ success: true, data: feed }, 201);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to create feed';
    return c.json({ success: false, error: { code: 'CREATE_FAILED', message: msg } }, 400);
  }
});

/** Install a feed bundle */
app.post('/bundles/:name/install', async (c) => {
  const bundleName = c.req.param('name');

  try {
    const feeds = await addFeedBundle(bundleName);
    return c.json({ success: true, data: { installed: feeds.length, feeds } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to install bundle';
    return c.json({ success: false, error: { code: 'BUNDLE_FAILED', message: msg } }, 400);
  }
});

/** Discover feed URL from a website */
app.post('/discover', async (c) => {
  const body = await c.req.json() as { url?: string };
  if (!body.url) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'url is required' } }, 400);
  }

  const feedUrl = await discoverFeedUrl(body.url);
  return c.json({ success: true, data: { feedUrl } });
});

/** Update a feed */
app.patch('/:id', async (c) => {
  const body = await c.req.json();
  const parsed = updateFeedSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
  }

  await updateFeed(c.req.param('id'), parsed.data);
  const feed = await getFeed(c.req.param('id'));
  return c.json({ success: true, data: feed });
});

/** Toggle feed enabled/disabled */
app.post('/:id/toggle', async (c) => {
  const body = await c.req.json() as { enabled?: boolean };
  const enabled = body.enabled !== false;
  await toggleFeed(c.req.param('id'), enabled);
  return c.json({ success: true, data: { enabled } });
});

/** Delete a feed */
app.delete('/:id', async (c) => {
  const removed = await removeFeed(c.req.param('id'));
  if (!removed) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Feed not found' } }, 404);
  }
  return c.json({ success: true });
});

/** Poll a specific feed */
app.post('/:id/poll', async (c) => {
  const result = await pollFeed(c.req.param('id'));
  return c.json({ success: true, data: result });
});

/** Poll all due feeds */
app.post('/poll-all', async (c) => {
  const result = await pollAllFeeds();
  return c.json({ success: true, data: result });
});

/** Get digest articles */
app.get('/digest/articles', async (c) => {
  const since = c.req.query('since');
  const category = c.req.query('category');
  const tag = c.req.query('tag');
  const feedId = c.req.query('feedId');
  const limit = c.req.query('limit');
  const undigestedOnly = c.req.query('undigestedOnly');

  const articles = await getDigestArticles({
    since: since ? new Date(since) : undefined,
    category: category || undefined,
    tag: tag || undefined,
    feedId: feedId || undefined,
    limit: limit ? parseInt(limit) : undefined,
    undigestedOnly: undigestedOnly === 'true',
  });

  return c.json({ success: true, data: articles });
});

/** Mark articles as digested */
app.post('/digest/mark', async (c) => {
  const body = await c.req.json() as { articleIds?: string[] };
  if (!body.articleIds?.length) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'articleIds required' } }, 400);
  }

  await markAsDigested(body.articleIds);
  return c.json({ success: true });
});

export default app;
