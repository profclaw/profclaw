import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { contentFilter } from '../content-filter.js';

describe('contentFilter middleware', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.CONTENT_FILTER = 'true';
    process.env.PROFCLAW_MODE = 'mini';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function makeApp() {
    const app = new Hono();
    app.use('/api/chat/send', contentFilter());
    app.post('/api/chat/send', (c) => c.json({ ok: true }));
    return app;
  }

  async function post(app: Hono, body: Record<string, unknown>) {
    return app.request('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('passes clean messages through', async () => {
    const app = makeApp();
    const res = await post(app, { message: 'hello world' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('blocks profane messages with 400', async () => {
    const app = makeApp();
    const res = await post(app, { message: 'you are a stupid asshole' });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string; flagged: boolean };
    expect(data.flagged).toBe(true);
    expect(data.error).toContain('content filter');
  });

  it('checks content field as well as message', async () => {
    const app = makeApp();
    const res = await post(app, { content: 'you are a stupid asshole' });
    expect(res.status).toBe(400);
    const data = await res.json() as { flagged: boolean };
    expect(data.flagged).toBe(true);
  });

  it('skips when CONTENT_FILTER is not set', async () => {
    delete process.env.CONTENT_FILTER;
    const app = makeApp();
    const res = await post(app, { message: 'you are a stupid asshole' });
    expect(res.status).toBe(200);
  });

  it('skips in pico mode', async () => {
    process.env.PROFCLAW_MODE = 'pico';
    // Need to reset cached mode
    vi.resetModules();
    const { contentFilter: freshFilter } = await import('../content-filter.js');
    const app = new Hono();
    app.use('/api/chat/send', freshFilter());
    app.post('/api/chat/send', (c) => c.json({ ok: true }));
    const res = await post(app, { message: 'you are a stupid asshole' });
    // Pico mode skips filter
    expect(res.status).toBe(200);
  });

  it('passes when body has no message or content', async () => {
    const app = makeApp();
    const res = await post(app, { model: 'gemma4' });
    expect(res.status).toBe(200);
  });

  it('passes GET requests through', async () => {
    const app = new Hono();
    app.use('/api/chat/send', contentFilter());
    app.get('/api/chat/send', (c) => c.json({ ok: true }));
    const res = await app.request('/api/chat/send');
    expect(res.status).toBe(200);
  });
});
