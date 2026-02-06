/**
 * WebChat Routes
 *
 * POST /api/chat/webchat          -- Send a message (creates session if needed)
 * GET  /api/chat/webchat/stream   -- SSE stream for a session
 * POST /api/chat/webchat/session  -- Create a new session
 * DELETE /api/chat/webchat/session/:id -- End a session
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  createSession,
  getSession,
  attachSSE,
  sendToSession,
  removeSession,
  getSessionCount,
  getSessionCountByIp,
} from '../chat/providers/webchat/index.js';
import { getChatRegistry } from '../chat/providers/registry.js';
import { logger } from '../utils/logger.js';

export const webchatRoutes = new Hono();

const MAX_SESSIONS_PER_IP = parseInt(process.env.WEBCHAT_MAX_SESSIONS_PER_IP || '5', 10);

async function parseJsonBody(c: Context): Promise<
  { ok: true; body: Record<string, unknown> } | { ok: false; response: Response }
> {
  try {
    const body = await c.req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return {
        ok: false,
        response: c.json({ error: 'Request body must be a JSON object' }, 400),
      };
    }

    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      response: c.json({ error: 'Invalid JSON body' }, 400),
    };
  }
}

/**
 * Create a new WebChat session.
 */
webchatRoutes.post('/session', async (c) => {
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';

  // Rate limit by IP
  if (getSessionCountByIp(ip) >= MAX_SESSIONS_PER_IP) {
    return c.json({ error: 'Too many sessions from this IP' }, 429);
  }

  const body = await c.req.json().catch(() => ({}));
  const sessionId = createSession({
    userId: body.userId,
    userName: body.userName,
    ip,
  });

  return c.json({ sessionId, activeSessions: getSessionCount() });
});

/**
 * SSE stream for receiving messages.
 */
webchatRoutes.get('/stream', (c) => {
  const sessionId = c.req.query('sessionId');
  if (!sessionId) {
    return c.json({ error: 'sessionId query parameter required' }, 400);
  }

  const session = getSession(sessionId);
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      attachSSE(sessionId, controller);

      // Send connected event
      const connectMsg = `event: connected\ndata: ${JSON.stringify({
        sessionId,
        userId: session.userId,
        userName: session.userName,
        timestamp: new Date().toISOString(),
      })}\n\n`;
      controller.enqueue(encoder.encode(connectMsg));

      // Heartbeat
      const heartbeat = setInterval(() => {
        try {
          const ping = `event: ping\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`;
          controller.enqueue(encoder.encode(ping));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);

      c.req.raw.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* ok */ }
      });
    },
    cancel() {
      // Cleanup handled by abort handler
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

/**
 * Send a message from the user.
 * The chat engine processes it and streams the response via SSE.
 */
webchatRoutes.post('/', async (c) => {
  const parsed = await parseJsonBody(c);
  if (!parsed.ok) {
    return parsed.response;
  }

  const sessionId = typeof parsed.body.sessionId === 'string' ? parsed.body.sessionId : undefined;
  const text = typeof parsed.body.text === 'string' ? parsed.body.text : undefined;

  if (!sessionId || !text) {
    return c.json({ error: 'sessionId and text are required' }, 400);
  }

  const session = getSession(sessionId);
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  // Acknowledge receipt
  sendToSession(sessionId, 'message:received', {
    text,
    timestamp: new Date().toISOString(),
    from: 'user',
  });

  // Parse the incoming message through the webchat provider
  const registry = getChatRegistry();
  const provider = registry.get('webchat');

  if (!provider) {
    return c.json({ error: 'WebChat provider not registered' }, 500);
  }

  const message = provider.inbound.parseMessage({ sessionId, text });

  if (!message) {
    return c.json({ error: 'Failed to parse message' }, 400);
  }

  // Emit to the chat engine for processing (async -- response goes via SSE)
  try {
    await registry.emit({
      type: 'message',
      provider: 'webchat',
      accountId: 'default',
      timestamp: new Date(),
      payload: message,
    });
  } catch (error) {
    logger.error('[WebChat] Failed to emit message to chat engine:', error as Error);
    return c.json({ error: 'Failed to process message' }, 500);
  }

  return c.json({ success: true, messageId: message.id });
});

/**
 * End a session.
 */
webchatRoutes.delete('/session/:id', (c) => {
  const sessionId = c.req.param('id');
  removeSession(sessionId);
  return c.json({ success: true });
});

/**
 * Get WebChat status.
 */
webchatRoutes.get('/status', (c) => {
  return c.json({
    activeSessions: getSessionCount(),
    provider: 'webchat',
    healthy: true,
  });
});
