/**
 * Human-Friendly Pairing Codes
 *
 * Provides secure, easy-to-type pairing codes for device authorization.
 * Adapted from OpenClaw reference implementation.
 *
 * Features:
 * - 8-character codes without ambiguous characters (no 0/O, 1/I)
 * - Time-limited pending requests (1 hour TTL)
 * - Database-backed persistence
 * - Rate limiting on code generation
 */

import { randomBytes, randomUUID } from 'crypto';
import { getStorage } from '../storage/index.js';
import { createContextualLogger } from '../utils/logger.js';

const log = createContextualLogger('PairingCodes');

// Code generation alphabet (no ambiguous chars: 0O1I)
const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAIRING_CODE_LENGTH = 8;

// Limits
const PAIRING_PENDING_TTL_MS = 60 * 60 * 1000; // 1 hour
const PAIRING_PENDING_MAX = 5; // Max concurrent pending requests per user

/**
 * Pairing request record
 */
export interface PairingRequest {
  id: string;
  code: string;
  /** User or device identifier requesting pairing */
  requesterId: string;
  /** Optional metadata about the requester */
  meta?: Record<string, string>;
  /** Expiration timestamp */
  expiresAt: Date;
  /** Status: pending, approved, rejected, expired */
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  /** Who approved/rejected */
  resolvedBy?: string;
  /** Resolution timestamp */
  resolvedAt?: Date;
  /** Token issued on approval */
  token?: string;
  createdAt: Date;
  lastSeenAt: Date;
}

/**
 * Initialize pairing codes table
 */
export async function initPairingCodesTable(): Promise<void> {
  const storage = getStorage();

  await storage.execute(`
    CREATE TABLE IF NOT EXISTS pairing_requests (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      requester_id TEXT NOT NULL,
      meta TEXT,
      expires_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      resolved_by TEXT,
      resolved_at INTEGER,
      token TEXT,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    )
  `);

  // Index for fast code lookup
  await storage.execute(`
    CREATE INDEX IF NOT EXISTS idx_pairing_code ON pairing_requests(code)
  `);

  // Index for requester lookup
  await storage.execute(`
    CREATE INDEX IF NOT EXISTS idx_pairing_requester ON pairing_requests(requester_id)
  `);
}

/**
 * Generate a random pairing code
 */
function generatePairingCode(): string {
  const bytes = randomBytes(PAIRING_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    code += PAIRING_CODE_ALPHABET[bytes[i] % PAIRING_CODE_ALPHABET.length];
  }
  return code;
}

/**
 * Generate a secure token for approved devices
 */
function generateToken(): string {
  return `profclaw_pair_${randomBytes(32).toString('base64url')}`;
}

/**
 * Request a new pairing code
 */
export async function requestPairingCode(params: {
  requesterId: string;
  meta?: Record<string, string>;
}): Promise<{ code: string; expiresAt: Date; created: boolean }> {
  const storage = getStorage();

  // Check for existing pending request
  const existingRows = await storage.query<{
    id: string;
    code: string;
    expires_at: number;
  }>(
    `SELECT id, code, expires_at FROM pairing_requests
     WHERE requester_id = ? AND status = 'pending' AND expires_at > ?`,
    [params.requesterId, Math.floor(Date.now() / 1000)]
  );

  // Return existing code if still valid
  if (existingRows.length > 0) {
    const existing = existingRows[0];

    // Update last seen
    await storage.execute(
      `UPDATE pairing_requests SET last_seen_at = ? WHERE id = ?`,
      [Math.floor(Date.now() / 1000), existing.id]
    );

    return {
      code: existing.code,
      expiresAt: new Date(existing.expires_at * 1000),
      created: false,
    };
  }

  // Check rate limit (max pending requests)
  const pendingCountRows = await storage.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM pairing_requests
     WHERE requester_id = ? AND status = 'pending' AND expires_at > ?`,
    [params.requesterId, Math.floor(Date.now() / 1000)]
  );

  if (pendingCountRows[0].count >= PAIRING_PENDING_MAX) {
    throw new Error(`Maximum pending pairing requests reached (${PAIRING_PENDING_MAX})`);
  }

  // Generate new code (retry if collision)
  let code = generatePairingCode();
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const collision = await storage.query<{ id: string }>(
      `SELECT id FROM pairing_requests WHERE code = ?`,
      [code]
    );

    if (collision.length === 0) break;

    code = generatePairingCode();
    attempts++;
  }

  if (attempts >= maxAttempts) {
    throw new Error('Failed to generate unique pairing code');
  }

  // Create new pairing request
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = Math.floor((Date.now() + PAIRING_PENDING_TTL_MS) / 1000);

  await storage.execute(
    `INSERT INTO pairing_requests (id, code, requester_id, meta, expires_at, status, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      id,
      code,
      params.requesterId,
      params.meta ? JSON.stringify(params.meta) : null,
      expiresAt,
      now,
      now,
    ]
  );

  log.info('Created pairing code', { code, requesterId: params.requesterId });

  return {
    code,
    expiresAt: new Date(expiresAt * 1000),
    created: true,
  };
}

/**
 * Approve a pairing code
 */
export async function approvePairingCode(params: {
  code: string;
  approvedBy: string;
}): Promise<{ request: PairingRequest; token: string } | null> {
  const storage = getStorage();

  // Find pending request by code
  const rows = await storage.query<{
    id: string;
    code: string;
    requester_id: string;
    meta: string | null;
    expires_at: number;
    status: string;
    created_at: number;
    last_seen_at: number;
  }>(
    `SELECT * FROM pairing_requests
     WHERE code = ? AND status = 'pending' AND expires_at > ?`,
    [params.code.toUpperCase(), Math.floor(Date.now() / 1000)]
  );

  if (rows.length === 0) {
    log.info('Code not found or expired', { code: params.code });
    return null;
  }

  const row = rows[0];
  const token = generateToken();
  const now = Math.floor(Date.now() / 1000);

  // Update to approved
  await storage.execute(
    `UPDATE pairing_requests
     SET status = 'approved', resolved_by = ?, resolved_at = ?, token = ?
     WHERE id = ?`,
    [params.approvedBy, now, token, row.id]
  );

  log.info('Code approved', { code: params.code, approvedBy: params.approvedBy });

  return {
    request: {
      id: row.id,
      code: row.code,
      requesterId: row.requester_id,
      meta: row.meta ? JSON.parse(row.meta) : undefined,
      expiresAt: new Date(row.expires_at * 1000),
      status: 'approved',
      resolvedBy: params.approvedBy,
      resolvedAt: new Date(now * 1000),
      token,
      createdAt: new Date(row.created_at * 1000),
      lastSeenAt: new Date(row.last_seen_at * 1000),
    },
    token,
  };
}

/**
 * Reject a pairing code
 */
export async function rejectPairingCode(params: {
  code: string;
  rejectedBy: string;
  reason?: string;
}): Promise<boolean> {
  const storage = getStorage();
  const now = Math.floor(Date.now() / 1000);

  // Check if code exists and is pending first
  const existing = await storage.query<{ id: string }>(
    `SELECT id FROM pairing_requests WHERE code = ? AND status = 'pending'`,
    [params.code.toUpperCase()]
  );

  if (existing.length === 0) {
    return false;
  }

  await storage.execute(
    `UPDATE pairing_requests
     SET status = 'rejected', resolved_by = ?, resolved_at = ?
     WHERE code = ? AND status = 'pending'`,
    [params.rejectedBy, now, params.code.toUpperCase()]
  );

  log.info('Code rejected', { code: params.code, rejectedBy: params.rejectedBy });
  return true;
}

/**
 * Check pairing code status
 */
export async function checkPairingStatus(code: string): Promise<{
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'not_found';
  token?: string;
  expiresAt?: Date;
}> {
  const storage = getStorage();

  const rows = await storage.query<{
    status: string;
    token: string | null;
    expires_at: number;
  }>(`SELECT status, token, expires_at FROM pairing_requests WHERE code = ?`, [
    code.toUpperCase(),
  ]);

  if (rows.length === 0) {
    return { status: 'not_found' };
  }

  const row = rows[0];
  const expiresAt = new Date(row.expires_at * 1000);

  // Check if expired
  if (row.status === 'pending' && expiresAt < new Date()) {
    // Mark as expired
    await storage.execute(
      `UPDATE pairing_requests SET status = 'expired' WHERE code = ?`,
      [code.toUpperCase()]
    );
    return { status: 'expired', expiresAt };
  }

  return {
    status: row.status as PairingRequest['status'],
    token: row.token || undefined,
    expiresAt,
  };
}

/**
 * List pending pairing requests (for admin UI)
 */
export async function listPendingPairingRequests(): Promise<
  Array<{
    id: string;
    code: string;
    requesterId: string;
    meta?: Record<string, string>;
    expiresAt: Date;
    createdAt: Date;
    lastSeenAt: Date;
  }>
> {
  const storage = getStorage();

  const rows = await storage.query<{
    id: string;
    code: string;
    requester_id: string;
    meta: string | null;
    expires_at: number;
    created_at: number;
    last_seen_at: number;
  }>(
    `SELECT id, code, requester_id, meta, expires_at, created_at, last_seen_at
     FROM pairing_requests
     WHERE status = 'pending' AND expires_at > ?
     ORDER BY created_at DESC`,
    [Math.floor(Date.now() / 1000)]
  );

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    requesterId: row.requester_id,
    meta: row.meta ? JSON.parse(row.meta) : undefined,
    expiresAt: new Date(row.expires_at * 1000),
    createdAt: new Date(row.created_at * 1000),
    lastSeenAt: new Date(row.last_seen_at * 1000),
  }));
}

/**
 * Clean up expired pairing requests
 */
export async function cleanupExpiredPairingRequests(): Promise<number> {
  const storage = getStorage();
  const now = Math.floor(Date.now() / 1000);

  // Count old requests before delete
  const sevenDaysAgo = now - 7 * 24 * 60 * 60;
  const countResult = await storage.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM pairing_requests WHERE created_at < ? AND status IN ('expired', 'rejected')`,
    [sevenDaysAgo]
  );
  const toDelete = countResult[0]?.count || 0;

  // Mark expired requests
  await storage.execute(
    `UPDATE pairing_requests SET status = 'expired' WHERE status = 'pending' AND expires_at < ?`,
    [now]
  );

  // Delete old requests (older than 7 days)
  await storage.execute(
    `DELETE FROM pairing_requests WHERE created_at < ? AND status IN ('expired', 'rejected')`,
    [sevenDaysAgo]
  );

  return toDelete;
}

/**
 * Validate a pairing token
 */
export async function validatePairingToken(token: string): Promise<{
  valid: boolean;
  requesterId?: string;
  meta?: Record<string, string>;
}> {
  const storage = getStorage();

  const rows = await storage.query<{
    requester_id: string;
    meta: string | null;
  }>(`SELECT requester_id, meta FROM pairing_requests WHERE token = ? AND status = 'approved'`, [
    token,
  ]);

  if (rows.length === 0) {
    return { valid: false };
  }

  return {
    valid: true,
    requesterId: rows[0].requester_id,
    meta: rows[0].meta ? JSON.parse(rows[0].meta) : undefined,
  };
}

/**
 * Format a pairing code for display (with spaces for readability)
 */
export function formatPairingCode(code: string): string {
  if (code.length !== PAIRING_CODE_LENGTH) {
    return code;
  }
  // Split into two groups of 4: ABCD-EFGH
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Parse a pairing code from user input (removes spaces, dashes, converts to uppercase)
 */
export function parsePairingCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}
