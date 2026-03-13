/**
 * Device Management API Routes
 *
 * Endpoints for device identity and pairing code management.
 * Enables multi-device support with secure authorization.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import {
  loadOrCreateDeviceIdentity,
  exportPublicIdentity,
  createDeviceAttestation,
  verifyDeviceAttestation,
} from '../auth/device-identity.js';
import {
  requestPairingCode,
  approvePairingCode,
  rejectPairingCode,
  checkPairingStatus,
  listPendingPairingRequests,
  cleanupExpiredPairingRequests,
  validatePairingToken,
  formatPairingCode,
  parsePairingCode,
  initPairingCodesTable,
} from '../auth/pairing-codes.js';
import { generatePairingQR, generatePairingUrl, generateQRSvg } from '../auth/qr-pairing.js';
import { getStorage } from '../storage/index.js';

const app = new Hono();

const attestBodySchema = z.object({
  data: z.record(z.string(), z.unknown()).optional(),
});

const verifyAttestationBodySchema = z.object({
  attestation: z.object({
    deviceId: z.string(),
    publicKey: z.string(),
    attestation: z.object({
      timestamp: z.string(),
      nonce: z.string(),
      data: z.record(z.string(), z.unknown()).optional(),
      signature: z.string(),
    }),
  }),
  maxAgeMs: z.number().optional(),
  expectedDeviceId: z.string().optional(),
});

const pairingRequestBodySchema = z.object({
  requesterId: z.string().optional(),
  meta: z.record(z.string(), z.string()).optional(),
});

const pairingApproveBodySchema = z.object({
  code: z.string().min(1),
  approvedBy: z.string().optional(),
});

const pairingRejectBodySchema = z.object({
  code: z.string().min(1),
  rejectedBy: z.string().optional(),
  reason: z.string().optional(),
});

const pairingValidateBodySchema = z.object({
  token: z.string().min(1),
});

async function parseJsonBody(c: Context): Promise<
  { ok: true; body: Record<string, unknown> } | { ok: false; response: Response }
> {
  try {
    const body = await c.req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return {
        ok: false,
        response: c.json({ success: false, error: 'Request body must be a JSON object' }, 400),
      };
    }

    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      response: c.json({ success: false, error: 'Invalid JSON body' }, 400),
    };
  }
}

// ============================================================================
// Device Identity Endpoints
// ============================================================================

/**
 * GET /api/devices/identity
 * Get the current device's identity (creates one if none exists)
 */
app.get('/identity', async (c) => {
  try {
    const identity = loadOrCreateDeviceIdentity();
    return c.json({
      success: true,
      identity: exportPublicIdentity(identity),
    });
  } catch (error) {
    console.error('[Devices] Failed to get identity:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * POST /api/devices/attest
 * Create a signed attestation for the current device
 */
app.post('/attest', async (c) => {
  try {
    const parsed = await parseJsonBody(c);
    if (!parsed.ok) {
      return parsed.response;
    }

    const bodyParse = attestBodySchema.safeParse(parsed.body);
    if (!bodyParse.success) {
      return c.json({ success: false, error: 'Invalid attestation payload' }, 400);
    }

    const identity = loadOrCreateDeviceIdentity();
    const attestation = createDeviceAttestation(identity, bodyParse.data.data);

    return c.json({
      success: true,
      attestation,
    });
  } catch (error) {
    console.error('[Devices] Failed to create attestation:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * POST /api/devices/verify
 * Verify a device attestation
 */
app.post('/verify', async (c) => {
  try {
    const parsed = await parseJsonBody(c);
    if (!parsed.ok) {
      return parsed.response;
    }

    const bodyParse = verifyAttestationBodySchema.safeParse(parsed.body);
    if (!bodyParse.success) {
      return c.json({ success: false, error: 'Missing attestation' }, 400);
    }

    const result = verifyDeviceAttestation(bodyParse.data.attestation, {
      maxAgeMs: bodyParse.data.maxAgeMs,
      expectedDeviceId: bodyParse.data.expectedDeviceId,
    });

    return c.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('[Devices] Failed to verify attestation:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// ============================================================================
// Pairing Code Endpoints
// ============================================================================

/**
 * POST /api/devices/pairing/request
 * Request a new pairing code for device authorization
 */
app.post('/pairing/request', async (c) => {
  try {
    // Ensure table exists
    await initPairingCodesTable();

    const parsed = await parseJsonBody(c);
    if (!parsed.ok) {
      return parsed.response;
    }

    const bodyParse = pairingRequestBodySchema.safeParse(parsed.body);
    if (!bodyParse.success) {
      return c.json({ success: false, error: 'Invalid pairing request payload' }, 400);
    }
    const identity = loadOrCreateDeviceIdentity();
    const identityMeta = {
      deviceId: identity.deviceId,
      ...(identity.displayName ? { displayName: identity.displayName } : {}),
      ...(identity.platform ? { platform: identity.platform } : {}),
    };

    const result = await requestPairingCode({
      requesterId: bodyParse.data.requesterId || identity.deviceId,
      meta: {
        ...identityMeta,
        ...bodyParse.data.meta,
      },
    });

    return c.json({
      success: true,
      code: result.code,
      formattedCode: formatPairingCode(result.code),
      expiresAt: result.expiresAt.toISOString(),
      created: result.created,
    });
  } catch (error) {
    console.error('[Devices] Failed to request pairing code:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/devices/pairing/status/:code
 * Check the status of a pairing code
 */
app.get('/pairing/status/:code', async (c) => {
  try {
    await initPairingCodesTable();
    const code = parsePairingCode(c.req.param('code'));
    const status = await checkPairingStatus(code);

    return c.json({
      success: true,
      code,
      ...status,
      expiresAt: status.expiresAt?.toISOString(),
    });
  } catch (error) {
    console.error('[Devices] Failed to check pairing status:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * POST /api/devices/pairing/approve
 * Approve a pairing code (admin action)
 */
app.post('/pairing/approve', async (c) => {
  try {
    await initPairingCodesTable();
    const parsed = await parseJsonBody(c);
    if (!parsed.ok) {
      return parsed.response;
    }

    const bodyParse = pairingApproveBodySchema.safeParse(parsed.body);
    if (!bodyParse.success) {
      return c.json({ success: false, error: 'Missing code' }, 400);
    }

    const code = parsePairingCode(bodyParse.data.code);
    const approvedBy = bodyParse.data.approvedBy || 'admin';

    const result = await approvePairingCode({ code, approvedBy });

    if (!result) {
      return c.json(
        {
          success: false,
          error: 'Code not found, expired, or already processed',
        },
        404
      );
    }

    return c.json({
      success: true,
      request: {
        id: result.request.id,
        code: result.request.code,
        requesterId: result.request.requesterId,
        meta: result.request.meta,
        status: result.request.status,
        resolvedBy: result.request.resolvedBy,
        resolvedAt: result.request.resolvedAt?.toISOString(),
      },
      token: result.token,
    });
  } catch (error) {
    console.error('[Devices] Failed to approve pairing code:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * POST /api/devices/pairing/reject
 * Reject a pairing code (admin action)
 */
app.post('/pairing/reject', async (c) => {
  try {
    await initPairingCodesTable();
    const parsed = await parseJsonBody(c);
    if (!parsed.ok) {
      return parsed.response;
    }

    const bodyParse = pairingRejectBodySchema.safeParse(parsed.body);
    if (!bodyParse.success) {
      return c.json({ success: false, error: 'Missing code' }, 400);
    }

    const code = parsePairingCode(bodyParse.data.code);
    const rejectedBy = bodyParse.data.rejectedBy || 'admin';

    const success = await rejectPairingCode({
      code,
      rejectedBy,
      reason: bodyParse.data.reason,
    });

    if (!success) {
      return c.json(
        {
          success: false,
          error: 'Code not found or already processed',
        },
        404
      );
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('[Devices] Failed to reject pairing code:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/devices/pairing/pending
 * List all pending pairing requests (admin)
 */
app.get('/pairing/pending', async (c) => {
  try {
    await initPairingCodesTable();
    const requests = await listPendingPairingRequests();

    return c.json({
      success: true,
      requests: requests.map((r) => ({
        ...r,
        formattedCode: formatPairingCode(r.code),
        expiresAt: r.expiresAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
        lastSeenAt: r.lastSeenAt.toISOString(),
      })),
      count: requests.length,
    });
  } catch (error) {
    console.error('[Devices] Failed to list pending requests:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * POST /api/devices/pairing/validate
 * Validate a pairing token
 */
app.post('/pairing/validate', async (c) => {
  try {
    await initPairingCodesTable();
    const parsed = await parseJsonBody(c);
    if (!parsed.ok) {
      return parsed.response;
    }

    const bodyParse = pairingValidateBodySchema.safeParse(parsed.body);
    if (!bodyParse.success) {
      return c.json({ success: false, error: 'Missing token' }, 400);
    }

    const result = await validatePairingToken(bodyParse.data.token);

    return c.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('[Devices] Failed to validate token:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * POST /api/devices/pairing/cleanup
 * Clean up expired pairing requests (admin/cron)
 */
app.post('/pairing/cleanup', async (c) => {
  try {
    await initPairingCodesTable();
    const deleted = await cleanupExpiredPairingRequests();

    return c.json({
      success: true,
      deleted,
    });
  } catch (error) {
    console.error('[Devices] Failed to cleanup pairing requests:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/devices/pairing/qr/:code
 * Generate a QR code payload (url, svg, text) for a pairing code
 */
app.get('/pairing/qr/:code', async (c: Context) => {
  try {
    const code = c.req.param('code');
    if (!code) {
      return c.json({ error: 'Pairing code required' }, 400);
    }

    const forwardedHost = c.req.header('X-Forwarded-Host');
    const baseUrl = forwardedHost ? `https://${forwardedHost}` : undefined;

    const qr = generatePairingQR(code, { baseUrl });
    return c.json({ success: true, ...qr });
  } catch (error) {
    console.error('[Devices] Failed to generate QR code:', error);
    return c.json({ error: 'Failed to generate QR code' }, 500);
  }
});

/**
 * GET /api/devices/pairing/qr/:code/svg
 * Return QR code as a raw SVG image for direct embedding
 */
app.get('/pairing/qr/:code/svg', async (c: Context) => {
  try {
    const code = c.req.param('code');
    if (!code) {
      return c.text('Missing code', 400);
    }

    const forwardedHost = c.req.header('X-Forwarded-Host');
    const baseUrl = forwardedHost ? `https://${forwardedHost}` : undefined;

    const url = generatePairingUrl(code, { baseUrl });
    const svg = generateQRSvg(url, 300);

    c.header('Content-Type', 'image/svg+xml');
    c.header('Cache-Control', 'public, max-age=3600');
    return c.body(svg);
  } catch (error) {
    console.error('[Devices] Failed to generate QR SVG:', error);
    return c.text('Failed to generate QR', 500);
  }
});

// ============================================================================
// Paired Devices Management
// ============================================================================

/**
 * GET /api/devices/paired
 * List all paired/authorized devices
 */
app.get('/paired', async (c) => {
  try {
    await initPairingCodesTable();
    const storage = getStorage();

    const rows = await storage.query<{
      id: string;
      requester_id: string;
      meta: string | null;
      resolved_by: string | null;
      resolved_at: number | null;
      created_at: number;
    }>(
      `SELECT id, requester_id, meta, resolved_by, resolved_at, created_at
       FROM pairing_requests
       WHERE status = 'approved'
       ORDER BY resolved_at DESC`
    );

    const devices = rows.map((row) => {
      const meta = row.meta ? JSON.parse(row.meta) : {};
      return {
        id: row.id,
        deviceId: meta.deviceId || row.requester_id,
        displayName: meta.displayName || `Device ${row.requester_id.slice(0, 8)}`,
        platform: meta.platform,
        approvedBy: row.resolved_by,
        approvedAt: row.resolved_at ? new Date(row.resolved_at * 1000).toISOString() : null,
        createdAt: new Date(row.created_at * 1000).toISOString(),
      };
    });

    return c.json({
      success: true,
      devices,
      count: devices.length,
    });
  } catch (error) {
    console.error('[Devices] Failed to list paired devices:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * DELETE /api/devices/paired/:id
 * Revoke a paired device's access
 */
app.delete('/paired/:id', async (c) => {
  try {
    await initPairingCodesTable();
    const storage = getStorage();
    const id = c.req.param('id');

    // Check if device exists
    const existing = await storage.query<{ id: string }>(
      `SELECT id FROM pairing_requests WHERE id = ? AND status = 'approved'`,
      [id]
    );

    if (existing.length === 0) {
      return c.json({ success: false, error: 'Device not found' }, 404);
    }

    // Revoke by changing status
    await storage.execute(`UPDATE pairing_requests SET status = 'rejected', token = NULL WHERE id = ?`, [
      id,
    ]);

    console.log(`[Devices] Revoked device ${id}`);

    return c.json({ success: true });
  } catch (error) {
    console.error('[Devices] Failed to revoke device:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

export const devicesRoutes = app;
