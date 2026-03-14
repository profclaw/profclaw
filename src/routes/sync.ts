/**
 * Sync Routes
 *
 * Webhook endpoints for external platform sync:
 * - POST /api/sync/webhook/linear
 * - POST /api/sync/webhook/github
 * - GET /api/sync/status
 * - POST /api/sync/trigger
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { createContextualLogger } from '../utils/logger.js';

const log = createContextualLogger('Sync');
import { handleSyncWebhook, pushTicketToExternal, getSyncStatus } from '../sync/integration.js';
import { hasSyncEngine, getSyncEngine } from '../sync/engine.js';
import { loadSyncConfig } from '../sync/config.js';
import { processGitHubWebhookForTicketSync } from '../integrations/github-ticket-sync.js';
import crypto from 'crypto';

const syncRoutes = new Hono();

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

// === Webhook Signature Verification ===

function verifyLinearSignature(payload: string, signature: string | undefined, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

function verifyGitHubSignature(payload: string, signature: string | undefined, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// === Webhook Endpoints ===

/**
 * Linear webhook endpoint
 * POST /api/sync/webhook/linear
 */
syncRoutes.post('/webhook/linear', async (c) => {
  const config = loadSyncConfig();
  const linearConfig = config.platforms.linear;

  // Verify webhook is enabled
  if (!linearConfig?.enabled) {
    return c.json({ error: 'Linear sync not enabled' }, 400);
  }

  // Get raw body for signature verification
  const rawBody = await c.req.text();
  const signature = c.req.header('linear-signature');

  // Verify signature if secret is configured
  if (linearConfig.webhookSecret) {
    if (!verifyLinearSignature(rawBody, signature, linearConfig.webhookSecret)) {
      log.warn('Invalid Linear webhook signature');
      return c.json({ error: 'Invalid signature' }, 401);
    }
  }

  // Parse payload
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  // Handle webhook
  const result = await handleSyncWebhook('linear', payload);

  if (result.success) {
    return c.json({ message: result.message });
  } else {
    return c.json({ error: result.message }, 500);
  }
});

/**
 * GitHub webhook endpoint
 * POST /api/sync/webhook/github
 */
syncRoutes.post('/webhook/github', async (c) => {
  const config = loadSyncConfig();
  const githubConfig = config.platforms.github;

  // Verify webhook is enabled
  if (!githubConfig?.enabled) {
    return c.json({ error: 'GitHub sync not enabled' }, 400);
  }

  // Get raw body for signature verification
  const rawBody = await c.req.text();
  const signature = c.req.header('x-hub-signature-256');

  // Verify signature if secret is configured
  if (githubConfig.webhookSecret) {
    if (!verifyGitHubSignature(rawBody, signature, githubConfig.webhookSecret)) {
      log.warn('Invalid GitHub webhook signature');
      return c.json({ error: 'Invalid signature' }, 401);
    }
  }

  // Check event type
  const eventType = c.req.header('x-github-event');
  if (!['issues', 'issue_comment'].includes(eventType || '')) {
    // Acknowledge but ignore other events
    return c.json({ message: `Ignored event type: ${eventType}` });
  }

  // Parse payload
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  // Try ticket sync handler first (for already-synced tickets)
  try {
    const ticketSyncResult = await processGitHubWebhookForTicketSync(eventType!, payload);

    if (ticketSyncResult.action !== 'ignored') {
      log.info('GitHub ticket sync', { action: ticketSyncResult.action, result: ticketSyncResult });
      return c.json({
        message: `Ticket sync: ${ticketSyncResult.action}`,
        ticketId: ticketSyncResult.ticketId,
        commentId: ticketSyncResult.commentId,
      });
    }
  } catch (error) {
    log.error('Ticket sync error (falling back to legacy)', error instanceof Error ? error : new Error(String(error)));
  }

  // Fallback to legacy sync webhook handler (for sync engine)
  const result = await handleSyncWebhook('github', payload);

  if (result.success) {
    return c.json({ message: result.message });
  } else {
    return c.json({ error: result.message }, 500);
  }
});

// === Status & Management ===

/**
 * Get sync status
 * GET /api/sync/status
 */
syncRoutes.get('/status', async (c) => {
  const status = getSyncStatus();

  // Add health check for each adapter
  let health: Record<string, { healthy: boolean; latencyMs: number }> = {};
  if (hasSyncEngine()) {
    health = await getSyncEngine().healthCheck();
  }

  return c.json({
    ...status,
    health,
  });
});

/**
 * Trigger manual sync
 * POST /api/sync/trigger
 */
syncRoutes.post('/trigger', async (c) => {
  if (!hasSyncEngine()) {
    return c.json({ error: 'Sync engine not initialized' }, 400);
  }

  const parsed = await parseJsonBody(c);
  if (!parsed.ok) {
    return parsed.response;
  }

  const body = parsed.body;
  const engine = getSyncEngine();

  try {
    if (typeof body.platform === 'string' && body.platform.length > 0) {
      // Sync specific platform
      const results = await engine.syncPlatform(body.platform);
      return c.json({
        message: `Synced ${body.platform}`,
        results,
      });
    } else {
      // Sync all platforms
      const results = await engine.syncAll();
      return c.json({
        message: 'Synced all platforms',
        results,
      });
    }
  } catch (error) {
    log.error('Sync trigger failed', error instanceof Error ? error : new Error(String(error)));
    return c.json({
      error: error instanceof Error ? error.message : 'Sync failed',
    }, 500);
  }
});

/**
 * Push ticket to external platform
 * POST /api/sync/push/:ticketId
 */
syncRoutes.post('/push/:ticketId', async (c) => {
  const ticketId = c.req.param('ticketId');
  const parsed = await parseJsonBody(c);
  if (!parsed.ok) {
    return parsed.response;
  }

  const platform = typeof parsed.body.platform === 'string' ? parsed.body.platform : undefined;

  const result = await pushTicketToExternal(ticketId, platform);

  if (result.success) {
    return c.json({
      message: 'Ticket pushed successfully',
      externalId: result.externalId,
    });
  } else {
    return c.json({ error: result.error }, 400);
  }
});

/**
 * Get pending conflicts
 * GET /api/sync/conflicts
 */
syncRoutes.get('/conflicts', async (c) => {
  if (!hasSyncEngine()) {
    return c.json({ conflicts: [] });
  }

  const engine = getSyncEngine();
  const conflicts = engine.getPendingConflicts();

  return c.json({ conflicts, count: conflicts.length });
});

/**
 * Resolve a conflict
 * POST /api/sync/conflicts/:ticketId/resolve
 */
syncRoutes.post('/conflicts/:ticketId/resolve', async (c) => {
  if (!hasSyncEngine()) {
    return c.json({ error: 'Sync engine not initialized' }, 400);
  }

  const ticketId = c.req.param('ticketId');
  const parsed = await parseJsonBody(c);
  if (!parsed.ok) {
    return parsed.response;
  }

  const resolution = parsed.body.resolution;

  if (resolution !== 'local' && resolution !== 'remote') {
    return c.json({ error: 'Invalid resolution. Must be "local" or "remote"' }, 400);
  }

  const engine = getSyncEngine();
  engine.resolvePendingConflict(ticketId, resolution);

  return c.json({ message: 'Conflict resolved', resolution });
});

export default syncRoutes;
