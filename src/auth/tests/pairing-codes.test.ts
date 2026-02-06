import { describe, it, expect, vi, beforeEach } from 'vitest';
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
} from '../pairing-codes.js';
import { getStorage } from '../../storage/index.js';

vi.mock('../../storage/index.js', () => ({
  getStorage: vi.fn(),
}));

// Use a real "now" so that new Date() comparisons inside the module are accurate.
// We derive NOW_MS at test-file evaluation time so all tests share a stable reference.
const NOW_MS = Date.now();
const NOW_S = Math.floor(NOW_MS / 1000);

describe('Pairing Codes', () => {
  let mockStorage: {
    execute: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockStorage = {
      execute: vi.fn().mockResolvedValue(undefined),
      query: vi.fn(),
    };
    (getStorage as ReturnType<typeof vi.fn>).mockReturnValue(mockStorage);
  });

  // ---------------------------------------------------------------------------
  // requestPairingCode
  // ---------------------------------------------------------------------------
  describe('requestPairingCode', () => {
    it('returns an existing pending code without creating a new one', async () => {
      const existingExpiresAt = NOW_S + 3600;
      mockStorage.query.mockResolvedValueOnce([
        { id: 'existing-id', code: 'ABCDEFGH', expires_at: existingExpiresAt },
      ]);

      const result = await requestPairingCode({ requesterId: 'device-1' });

      expect(result.code).toBe('ABCDEFGH');
      expect(result.created).toBe(false);
      expect(result.expiresAt).toEqual(new Date(existingExpiresAt * 1000));
      // Should update last_seen_at but NOT insert
      expect(mockStorage.execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE pairing_requests SET last_seen_at'),
        expect.arrayContaining(['existing-id'])
      );
      // No INSERT should have happened
      const insertCalls = mockStorage.execute.mock.calls.filter((c: unknown[]) =>
        (c[0] as string).includes('INSERT')
      );
      expect(insertCalls).toHaveLength(0);
    });

    it('creates a new code when no pending request exists', async () => {
      // No existing pending request
      mockStorage.query.mockResolvedValueOnce([]);
      // Count query returns 0
      mockStorage.query.mockResolvedValueOnce([{ count: 0 }]);
      // No collision for the generated code
      mockStorage.query.mockResolvedValueOnce([]);

      const result = await requestPairingCode({ requesterId: 'device-2' });

      expect(result.created).toBe(true);
      expect(result.code).toHaveLength(8);
      expect(result.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
      expect(mockStorage.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO pairing_requests'),
        expect.arrayContaining(['device-2'])
      );
    });

    it('stores optional meta as JSON when provided', async () => {
      mockStorage.query.mockResolvedValueOnce([]);
      mockStorage.query.mockResolvedValueOnce([{ count: 0 }]);
      mockStorage.query.mockResolvedValueOnce([]);

      await requestPairingCode({
        requesterId: 'device-3',
        meta: { hostname: 'my-pc', os: 'linux' },
      });

      const insertCall = mockStorage.execute.mock.calls.find((c: unknown[]) =>
        (c[0] as string).includes('INSERT INTO pairing_requests')
      );
      expect(insertCall).toBeDefined();
      // meta should be JSON-encoded in the params array
      const params = insertCall[1] as unknown[];
      const metaParam = params.find(
        (p) => typeof p === 'string' && p.includes('hostname')
      );
      expect(metaParam).toBeDefined();
      expect(JSON.parse(metaParam as string)).toEqual({ hostname: 'my-pc', os: 'linux' });
    });

    it('stores null for meta when not provided', async () => {
      mockStorage.query.mockResolvedValueOnce([]);
      mockStorage.query.mockResolvedValueOnce([{ count: 0 }]);
      mockStorage.query.mockResolvedValueOnce([]);

      await requestPairingCode({ requesterId: 'device-4' });

      const insertCall = mockStorage.execute.mock.calls.find((c: unknown[]) =>
        (c[0] as string).includes('INSERT INTO pairing_requests')
      );
      const params = insertCall[1] as unknown[];
      // meta is the 4th positional param (id, code, requester_id, meta, ...)
      expect(params[3]).toBeNull();
    });

    it('retries on code collision and succeeds within max attempts', async () => {
      mockStorage.query.mockResolvedValueOnce([]);
      mockStorage.query.mockResolvedValueOnce([{ count: 0 }]);
      // First 3 attempts collide, 4th is clean
      mockStorage.query.mockResolvedValueOnce([{ id: 'collision-1' }]);
      mockStorage.query.mockResolvedValueOnce([{ id: 'collision-2' }]);
      mockStorage.query.mockResolvedValueOnce([{ id: 'collision-3' }]);
      mockStorage.query.mockResolvedValueOnce([]);

      const result = await requestPairingCode({ requesterId: 'device-5' });

      expect(result.created).toBe(true);
      expect(result.code).toHaveLength(8);
    });

    it('throws when max collision attempts are exhausted', async () => {
      mockStorage.query.mockResolvedValueOnce([]);
      mockStorage.query.mockResolvedValueOnce([{ count: 0 }]);
      // All 10 collision checks return a hit
      for (let i = 0; i < 10; i++) {
        mockStorage.query.mockResolvedValueOnce([{ id: `collision-${i}` }]);
      }

      await expect(
        requestPairingCode({ requesterId: 'device-6' })
      ).rejects.toThrow('Failed to generate unique pairing code');
    });

    it('throws when the concurrent pending limit is reached', async () => {
      // No existing pending for this requester (first query returns empty)
      mockStorage.query.mockResolvedValueOnce([]);
      // Count query at the limit
      mockStorage.query.mockResolvedValueOnce([{ count: 5 }]);

      await expect(
        requestPairingCode({ requesterId: 'device-7' })
      ).rejects.toThrow('Maximum pending pairing requests reached (5)');
    });

    it('generates codes using only valid alphabet characters', async () => {
      mockStorage.query.mockResolvedValueOnce([]);
      mockStorage.query.mockResolvedValueOnce([{ count: 0 }]);
      mockStorage.query.mockResolvedValueOnce([]);

      const codes = new Set<string>();
      // Generate several codes to verify alphabet constraints
      for (let i = 0; i < 20; i++) {
        const result = await requestPairingCode({ requesterId: `dev-${i}` });
        codes.add(result.code);

        // Reset mocks for next iteration
        mockStorage.query.mockResolvedValueOnce([]);
        mockStorage.query.mockResolvedValueOnce([{ count: 0 }]);
        mockStorage.query.mockResolvedValueOnce([]);
      }

      for (const code of codes) {
        expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
        // Ambiguous chars must be absent
        expect(code).not.toMatch(/[01OI]/);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // approvePairingCode
  // ---------------------------------------------------------------------------
  describe('approvePairingCode', () => {
    it('returns null when code is not found or expired', async () => {
      mockStorage.query.mockResolvedValueOnce([]);

      const result = await approvePairingCode({ code: 'XXXXXXXX', approvedBy: 'admin' });

      expect(result).toBeNull();
    });

    it('approves a valid pending code and returns a token', async () => {
      const row = {
        id: 'req-1',
        code: 'ABCD1234',
        requester_id: 'device-1',
        meta: null,
        expires_at: NOW_S + 3600,
        status: 'pending',
        created_at: NOW_S - 60,
        last_seen_at: NOW_S - 30,
      };
      mockStorage.query.mockResolvedValueOnce([row]);

      const result = await approvePairingCode({ code: 'ABCD1234', approvedBy: 'admin-user' });

      expect(result).not.toBeNull();
      expect(result!.token).toMatch(/^profclaw_pair_/);
      expect(result!.request.status).toBe('approved');
      expect(result!.request.resolvedBy).toBe('admin-user');
      expect(result!.request.requesterId).toBe('device-1');
      expect(mockStorage.execute).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'approved'"),
        expect.arrayContaining(['admin-user', result!.token, 'req-1'])
      );
    });

    it('uppercases the code before lookup', async () => {
      mockStorage.query.mockResolvedValueOnce([]);

      await approvePairingCode({ code: 'abcd1234', approvedBy: 'admin' });

      expect(mockStorage.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['ABCD1234'])
      );
    });

    it('parses meta JSON when meta is present', async () => {
      const row = {
        id: 'req-2',
        code: 'METAXXXX',
        requester_id: 'device-2',
        meta: JSON.stringify({ hostname: 'server' }),
        expires_at: NOW_S + 3600,
        status: 'pending',
        created_at: NOW_S - 60,
        last_seen_at: NOW_S - 30,
      };
      mockStorage.query.mockResolvedValueOnce([row]);

      const result = await approvePairingCode({ code: 'METAXXXX', approvedBy: 'admin' });

      expect(result!.request.meta).toEqual({ hostname: 'server' });
    });

    it('generates a unique token per approval', async () => {
      const makeRow = (id: string, code: string) => ({
        id,
        code,
        requester_id: 'device-x',
        meta: null,
        expires_at: NOW_S + 3600,
        status: 'pending',
        created_at: NOW_S - 60,
        last_seen_at: NOW_S - 30,
      });

      mockStorage.query.mockResolvedValueOnce([makeRow('req-a', 'AAAABBBB')]);
      const result1 = await approvePairingCode({ code: 'AAAABBBB', approvedBy: 'admin' });

      mockStorage.query.mockResolvedValueOnce([makeRow('req-b', 'CCCCDDDD')]);
      const result2 = await approvePairingCode({ code: 'CCCCDDDD', approvedBy: 'admin' });

      expect(result1!.token).not.toBe(result2!.token);
    });
  });

  // ---------------------------------------------------------------------------
  // rejectPairingCode
  // ---------------------------------------------------------------------------
  describe('rejectPairingCode', () => {
    it('returns false when code is not found or already resolved', async () => {
      mockStorage.query.mockResolvedValueOnce([]);

      const result = await rejectPairingCode({ code: 'NOTFOUND', rejectedBy: 'admin' });

      expect(result).toBe(false);
    });

    it('rejects a pending code and returns true', async () => {
      mockStorage.query.mockResolvedValueOnce([{ id: 'req-3' }]);

      const result = await rejectPairingCode({ code: 'ABCDEFGH', rejectedBy: 'admin' });

      expect(result).toBe(true);
      expect(mockStorage.execute).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'rejected'"),
        expect.arrayContaining(['admin', 'ABCDEFGH'])
      );
    });

    it('uppercases code before lookup and update', async () => {
      mockStorage.query.mockResolvedValueOnce([{ id: 'req-4' }]);

      await rejectPairingCode({ code: 'abcdefgh', rejectedBy: 'admin' });

      expect(mockStorage.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['ABCDEFGH'])
      );
      expect(mockStorage.execute).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['ABCDEFGH'])
      );
    });
  });

  // ---------------------------------------------------------------------------
  // checkPairingStatus
  // ---------------------------------------------------------------------------
  describe('checkPairingStatus', () => {
    it('returns not_found for unknown code', async () => {
      mockStorage.query.mockResolvedValueOnce([]);

      const result = await checkPairingStatus('ZZZZZZZZ');

      expect(result.status).toBe('not_found');
    });

    it('returns pending status with expiry for a valid pending code', async () => {
      const expiresAt = NOW_S + 3600;
      mockStorage.query.mockResolvedValueOnce([
        { status: 'pending', token: null, expires_at: expiresAt },
      ]);

      const result = await checkPairingStatus('PENDCODE');

      expect(result.status).toBe('pending');
      expect(result.expiresAt).toEqual(new Date(expiresAt * 1000));
      expect(result.token).toBeUndefined();
    });

    it('returns approved status with token when approved', async () => {
      const expiresAt = NOW_S + 3600;
      mockStorage.query.mockResolvedValueOnce([
        { status: 'approved', token: 'profclaw_pair_abc123', expires_at: expiresAt },
      ]);

      const result = await checkPairingStatus('APPRVDCD');

      expect(result.status).toBe('approved');
      expect(result.token).toBe('profclaw_pair_abc123');
    });

    it('marks and returns expired status when pending code has passed TTL', async () => {
      const pastExpiresAt = NOW_S - 100;
      mockStorage.query.mockResolvedValueOnce([
        { status: 'pending', token: null, expires_at: pastExpiresAt },
      ]);

      const result = await checkPairingStatus('EXPRDCDE');

      expect(result.status).toBe('expired');
      expect(mockStorage.execute).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'expired'"),
        expect.arrayContaining(['EXPRDCDE'])
      );
    });

    it('returns rejected status for a rejected code', async () => {
      const expiresAt = NOW_S + 3600;
      mockStorage.query.mockResolvedValueOnce([
        { status: 'rejected', token: null, expires_at: expiresAt },
      ]);

      const result = await checkPairingStatus('REJCTCDE');

      expect(result.status).toBe('rejected');
    });

    it('uppercases the code before querying', async () => {
      mockStorage.query.mockResolvedValueOnce([]);

      await checkPairingStatus('abcdefgh');

      expect(mockStorage.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['ABCDEFGH'])
      );
    });
  });

  // ---------------------------------------------------------------------------
  // listPendingPairingRequests
  // ---------------------------------------------------------------------------
  describe('listPendingPairingRequests', () => {
    it('returns an empty array when no pending requests exist', async () => {
      mockStorage.query.mockResolvedValueOnce([]);

      const result = await listPendingPairingRequests();

      expect(result).toEqual([]);
    });

    it('maps rows to the expected shape', async () => {
      const rows = [
        {
          id: 'req-10',
          code: 'LISTCODE',
          requester_id: 'device-10',
          meta: JSON.stringify({ name: 'laptop' }),
          expires_at: NOW_S + 3600,
          created_at: NOW_S - 300,
          last_seen_at: NOW_S - 10,
        },
      ];
      mockStorage.query.mockResolvedValueOnce(rows);

      const result = await listPendingPairingRequests();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'req-10',
        code: 'LISTCODE',
        requesterId: 'device-10',
        meta: { name: 'laptop' },
      });
      expect(result[0].expiresAt).toBeInstanceOf(Date);
      expect(result[0].createdAt).toBeInstanceOf(Date);
      expect(result[0].lastSeenAt).toBeInstanceOf(Date);
    });

    it('handles null meta gracefully', async () => {
      mockStorage.query.mockResolvedValueOnce([
        {
          id: 'req-11',
          code: 'NULLMETA',
          requester_id: 'device-11',
          meta: null,
          expires_at: NOW_S + 3600,
          created_at: NOW_S - 60,
          last_seen_at: NOW_S - 10,
        },
      ]);

      const result = await listPendingPairingRequests();

      expect(result[0].meta).toBeUndefined();
    });

    it('queries only non-expired pending requests', async () => {
      mockStorage.query.mockResolvedValueOnce([]);

      await listPendingPairingRequests();

      expect(mockStorage.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE status = 'pending' AND expires_at > ?"),
        expect.arrayContaining([NOW_S])
      );
    });
  });

  // ---------------------------------------------------------------------------
  // cleanupExpiredPairingRequests
  // ---------------------------------------------------------------------------
  describe('cleanupExpiredPairingRequests', () => {
    it('marks pending requests as expired and deletes old ones', async () => {
      const sevenDaysAgo = NOW_S - 7 * 24 * 60 * 60;
      mockStorage.query.mockResolvedValueOnce([{ count: 3 }]);

      const deleted = await cleanupExpiredPairingRequests();

      expect(deleted).toBe(3);
      // Should mark expired
      expect(mockStorage.execute).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'expired'"),
        expect.arrayContaining([NOW_S])
      );
      // Should delete old records
      expect(mockStorage.execute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM pairing_requests'),
        expect.arrayContaining([sevenDaysAgo])
      );
    });

    it('returns 0 when no old requests to delete', async () => {
      mockStorage.query.mockResolvedValueOnce([{ count: 0 }]);

      const deleted = await cleanupExpiredPairingRequests();

      expect(deleted).toBe(0);
    });

    it('handles missing count row safely', async () => {
      mockStorage.query.mockResolvedValueOnce([]);

      const deleted = await cleanupExpiredPairingRequests();

      expect(deleted).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // validatePairingToken
  // ---------------------------------------------------------------------------
  describe('validatePairingToken', () => {
    it('returns valid: false for an unknown token', async () => {
      mockStorage.query.mockResolvedValueOnce([]);

      const result = await validatePairingToken('profclaw_pair_bad');

      expect(result.valid).toBe(false);
      expect(result.requesterId).toBeUndefined();
    });

    it('returns valid: true with requesterId for a known approved token', async () => {
      mockStorage.query.mockResolvedValueOnce([
        { requester_id: 'device-20', meta: null },
      ]);

      const result = await validatePairingToken('profclaw_pair_goodtoken');

      expect(result.valid).toBe(true);
      expect(result.requesterId).toBe('device-20');
      expect(result.meta).toBeUndefined();
    });

    it('returns parsed meta when token is valid and meta is present', async () => {
      mockStorage.query.mockResolvedValueOnce([
        { requester_id: 'device-21', meta: JSON.stringify({ env: 'prod' }) },
      ]);

      const result = await validatePairingToken('profclaw_pair_tokenWithMeta');

      expect(result.valid).toBe(true);
      expect(result.meta).toEqual({ env: 'prod' });
    });

    it('queries against approved status', async () => {
      mockStorage.query.mockResolvedValueOnce([]);

      await validatePairingToken('sometoken');

      expect(mockStorage.query).toHaveBeenCalledWith(
        expect.stringContaining("AND status = 'approved'"),
        expect.arrayContaining(['sometoken'])
      );
    });
  });

  // ---------------------------------------------------------------------------
  // formatPairingCode (pure function - no mocks needed)
  // ---------------------------------------------------------------------------
  describe('formatPairingCode', () => {
    it('formats an 8-character code as XXXX-XXXX', () => {
      expect(formatPairingCode('ABCDEFGH')).toBe('ABCD-EFGH');
    });

    it('returns the input unchanged when length is not 8', () => {
      expect(formatPairingCode('ABCD')).toBe('ABCD');
      expect(formatPairingCode('ABCDEFGHI')).toBe('ABCDEFGHI');
      expect(formatPairingCode('')).toBe('');
    });

    it('preserves character casing', () => {
      expect(formatPairingCode('12345678')).toBe('1234-5678');
    });
  });

  // ---------------------------------------------------------------------------
  // parsePairingCode (pure function - no mocks needed)
  // ---------------------------------------------------------------------------
  describe('parsePairingCode', () => {
    it('strips dashes from a formatted code', () => {
      expect(parsePairingCode('ABCD-EFGH')).toBe('ABCDEFGH');
    });

    it('strips spaces from user input', () => {
      expect(parsePairingCode('ABCD EFGH')).toBe('ABCDEFGH');
    });

    it('converts lowercase to uppercase', () => {
      expect(parsePairingCode('abcd-efgh')).toBe('ABCDEFGH');
    });

    it('strips mixed whitespace and dashes', () => {
      expect(parsePairingCode('AB CD - EF GH')).toBe('ABCDEFGH');
    });

    it('returns already-clean codes unchanged', () => {
      expect(parsePairingCode('ABCDEFGH')).toBe('ABCDEFGH');
    });

    it('handles empty string', () => {
      expect(parsePairingCode('')).toBe('');
    });

    it('round-trips with formatPairingCode', () => {
      const original = 'ABCDEFGH';
      const formatted = formatPairingCode(original);
      expect(parsePairingCode(formatted)).toBe(original);
    });
  });
});
