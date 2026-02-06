/**
 * In-App Notifications API
 *
 * CRUD for user notifications with read/unread state.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getClient } from '../storage/index.js';
import { logger } from '../utils/logger.js';

const notificationsRoutes = new Hono();

// === List Notifications ===

notificationsRoutes.get('/', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50');
  const unreadOnly = c.req.query('unread') === 'true';

  try {
    const client = getClient();
    const whereClause = unreadOnly ? 'WHERE read = 0' : '';
    const result = await client.execute({
      sql: `SELECT * FROM notifications ${whereClause} ORDER BY created_at DESC LIMIT ?`,
      args: [limit],
    });

    const countResult = await client.execute({
      sql: `SELECT COUNT(*) as total FROM notifications WHERE read = 0`,
      args: [],
    });

    const notifications = result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      userId: row.user_id as string | null,
      title: row.title as string,
      description: row.description as string | null,
      type: row.type as string,
      category: row.category as string,
      entityType: row.entity_type as string | null,
      entityId: row.entity_id as string | null,
      read: Boolean(row.read),
      createdAt: row.created_at as number,
    }));

    return c.json({
      notifications,
      total: notifications.length,
      unreadCount: Number(countResult.rows[0]?.total ?? 0),
    });
  } catch (error) {
    logger.error('[Notifications] List error:', error instanceof Error ? error : undefined);
    return c.json({ error: 'Failed to list notifications' }, 500);
  }
});

// === Create Notification ===

notificationsRoutes.post(
  '/',
  zValidator(
    'json',
    z.object({
      title: z.string(),
      description: z.string().optional(),
      type: z.enum(['success', 'error', 'info', 'warning']).default('info'),
      category: z.enum(['system', 'task', 'ticket', 'agent', 'chat', 'cron']).default('system'),
      entityType: z.string().optional(),
      entityId: z.string().optional(),
      userId: z.string().optional(),
    }),
  ),
  async (c) => {
    const body = c.req.valid('json');

    try {
      const id = randomUUID();
      const client = getClient();

      await client.execute({
        sql: `INSERT INTO notifications (id, user_id, title, description, type, category, entity_type, entity_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          body.userId ?? null,
          body.title,
          body.description ?? null,
          body.type,
          body.category,
          body.entityType ?? null,
          body.entityId ?? null,
        ],
      });

      return c.json({
        id,
        title: body.title,
        type: body.type,
        category: body.category,
        read: false,
      }, 201);
    } catch (error) {
      logger.error('[Notifications] Create error:', error instanceof Error ? error : undefined);
      return c.json({ error: 'Failed to create notification' }, 500);
    }
  },
);

// === Mark as Read ===

notificationsRoutes.patch(
  '/:id/read',
  async (c) => {
    const id = c.req.param('id');

    try {
      const client = getClient();
      await client.execute({
        sql: `UPDATE notifications SET read = 1 WHERE id = ?`,
        args: [id],
      });

      return c.json({ success: true });
    } catch (error) {
      logger.error('[Notifications] Mark read error:', error instanceof Error ? error : undefined);
      return c.json({ error: 'Failed to mark as read' }, 500);
    }
  },
);

// === Mark All as Read ===

notificationsRoutes.post('/mark-all-read', async (c) => {
  try {
    const client = getClient();
    await client.execute({
      sql: `UPDATE notifications SET read = 1 WHERE read = 0`,
      args: [],
    });

    return c.json({ success: true });
  } catch (error) {
    logger.error('[Notifications] Mark all read error:', error instanceof Error ? error : undefined);
    return c.json({ error: 'Failed to mark all as read' }, 500);
  }
});

// === Delete Notification ===

notificationsRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');

  try {
    const client = getClient();
    await client.execute({
      sql: `DELETE FROM notifications WHERE id = ?`,
      args: [id],
    });

    return c.json({ success: true });
  } catch (error) {
    logger.error('[Notifications] Delete error:', error instanceof Error ? error : undefined);
    return c.json({ error: 'Failed to delete notification' }, 500);
  }
});

// === Get Unread Count ===

notificationsRoutes.get('/unread-count', async (c) => {
  try {
    const client = getClient();
    const result = await client.execute({
      sql: `SELECT COUNT(*) as count FROM notifications WHERE read = 0`,
      args: [],
    });

    return c.json({ count: Number(result.rows[0]?.count ?? 0) });
  } catch (error) {
    logger.error('[Notifications] Count error:', error instanceof Error ? error : undefined);
    return c.json({ error: 'Failed to get count' }, 500);
  }
});

export { notificationsRoutes };
