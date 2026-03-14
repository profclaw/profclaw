/**
 * Push Notification Routes
 *
 * API endpoints for Web Push subscription management.
 */

import { Hono } from 'hono';
import { getPushService } from '../notifications/push.js';

export const pushRoutes = new Hono();

/**
 * GET /api/push/vapid-key - Get VAPID public key for client subscription
 */
pushRoutes.get('/vapid-key', (c) => {
  try {
    const push = getPushService();
    return c.json({ publicKey: push.getPublicKey() });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to get VAPID key' },
      500
    );
  }
});

/**
 * POST /api/push/subscribe - Register a push subscription
 */
pushRoutes.post('/subscribe', async (c) => {
  const body = await c.req.json<{
    endpoint: string;
    keys: { p256dh: string; auth: string };
    userId?: string;
    deviceName?: string;
  }>();

  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return c.json({ error: 'Invalid subscription: endpoint and keys required' }, 400);
  }

  const push = getPushService();
  const subscription = push.subscribe({
    endpoint: body.endpoint,
    keys: body.keys,
    userId: body.userId,
    deviceName: body.deviceName,
  });

  return c.json({ success: true, subscription });
});

/**
 * DELETE /api/push/subscribe/:id - Unregister a push subscription
 */
pushRoutes.delete('/subscribe/:id', (c) => {
  const id = c.req.param('id');
  const push = getPushService();
  push.unsubscribe(id);
  return c.json({ success: true });
});

/**
 * POST /api/push/notify - Send a push notification (admin only)
 */
pushRoutes.post('/notify', async (c) => {
  const body = await c.req.json<{
    title: string;
    body: string;
    userId?: string;
    tag?: string;
    url?: string;
  }>();

  if (!body.title || !body.body) {
    return c.json({ error: 'Title and body are required' }, 400);
  }

  const push = getPushService();
  const notification = {
    title: body.title,
    body: body.body,
    tag: body.tag,
    url: body.url,
  };

  const result = body.userId
    ? await push.notifyUser(body.userId, notification)
    : await push.notifyAll(notification);

  return c.json({ success: true, ...result });
});

/**
 * GET /api/push/subscriptions - List subscriptions (admin)
 */
pushRoutes.get('/subscriptions', (c) => {
  const push = getPushService();
  const subs = push.listSubscriptions();
  return c.json({ subscriptions: subs, count: subs.length });
});
