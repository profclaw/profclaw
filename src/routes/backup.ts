/**
 * Backup & Restore API Routes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { exportDatabase, importDatabase, listBackups, pruneBackups } from '../backup/index.js';
import { getClient } from '../storage/index.js';
import { logger } from '../utils/logger.js';

type RawDbClient = {
  execute: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
};

const app = new Hono();

// List available backups
app.get('/', async (c: Context) => {
  try {
    const backups = await listBackups();
    return c.json({ success: true, backups });
  } catch (error) {
    logger.error('[BackupRoute] List failed', error as Error);
    return c.json({ error: 'Failed to list backups' }, 500);
  }
});

// Create a new backup
app.post('/export', async (c: Context) => {
  try {
    const body = await c.req.json().catch(() => ({})) as { tables?: string[] };

    const client = getClient() as RawDbClient | undefined;
    if (!client) {
      return c.json({ error: 'Database client not available' }, 500);
    }

    const result = await exportDatabase(client, { tables: body.tables });
    return c.json({ success: true, ...result });
  } catch (error) {
    logger.error('[BackupRoute] Export failed', error as Error);
    return c.json({ error: 'Export failed' }, 500);
  }
});

// Restore from backup
app.post('/import', async (c: Context) => {
  try {
    const body = await c.req.json() as { filePath: string; tables?: string[]; dryRun?: boolean };

    if (!body.filePath) {
      return c.json({ error: 'filePath required' }, 400);
    }

    const client = getClient() as RawDbClient | undefined;
    if (!client) {
      return c.json({ error: 'Database client not available' }, 500);
    }

    const result = await importDatabase(client, body.filePath, {
      tables: body.tables,
      dryRun: body.dryRun,
    });
    return c.json({ success: true, ...result });
  } catch (error) {
    logger.error('[BackupRoute] Import failed', error as Error);
    return c.json({ error: 'Import failed' }, 500);
  }
});

// Prune old backups
app.delete('/prune', async (c: Context) => {
  try {
    const keep = Number(c.req.query('keep')) || 5;
    const deleted = await pruneBackups(keep);
    return c.json({ success: true, deleted, kept: keep });
  } catch (error) {
    logger.error('[BackupRoute] Prune failed', error as Error);
    return c.json({ error: 'Prune failed' }, 500);
  }
});

export const backupRoutes = app;
