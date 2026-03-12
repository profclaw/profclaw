/**
 * User Routes Tests
 *
 * Comprehensive tests for user profile and preferences management routes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Mocks — must be declared before any module imports that use them
// ---------------------------------------------------------------------------

// Mock storage
vi.mock('../../storage/index.js', () => ({
  getDb: vi.fn(() => mockDb),
}));

// Mock auth service
vi.mock('../../auth/auth-service.js', () => ({
  validateSession: vi.fn(),
  getUserById: vi.fn(),
  getUserConnectedAccounts: vi.fn(),
}));

// Mock password helpers
vi.mock('../../auth/password.js', () => ({
  hashPassword: vi.fn((pw: string) => `hashed:${pw}`),
  verifyPassword: vi.fn(),
  validatePasswordStrength: vi.fn(() => null), // null = valid
  generateRecoveryCodes: vi.fn(() => ['CODE1', 'CODE2', 'CODE3', 'CODE4', 'CODE5', 'CODE6', 'CODE7', 'CODE8']),
  hashRecoveryCodes: vi.fn((codes: string[]) => codes.map((c) => `h:${c}`)),
  hashRecoveryCode: vi.fn((c: string) => `h:${c}`),
  generateInviteCode: vi.fn(() => 'INVITE123'),
  hashInviteCode: vi.fn((c: string) => `h:${c}`),
}));

// Mock settings
vi.mock('../../settings/index.js', () => ({
  getSettingsRaw: vi.fn(),
  updateSettings: vi.fn(),
}));

// Mock logger (no-op)
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Shared mock DB builder
// ---------------------------------------------------------------------------

type MockDbChain = {
  select: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  _resolveWith: (data: unknown) => void;
};

function buildMockDb(): MockDbChain {
  let resolveValue: unknown = [];
  let operation: 'select' | 'insert' | 'update' | 'delete' | null = null;

  const chain: MockDbChain & PromiseLike<unknown> = {
    select: vi.fn(() => {
      operation = 'select';
      return chain;
    }),
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => Promise.resolve(resolveValue)),
    limit: vi.fn(() => Promise.resolve(resolveValue)),
    insert: vi.fn(() => {
      operation = 'insert';
      return chain;
    }),
    values: vi.fn(() => Promise.resolve()),
    update: vi.fn(() => {
      operation = 'update';
      return chain;
    }),
    set: vi.fn(() => chain),
    delete: vi.fn(() => {
      operation = 'delete';
      return chain;
    }),
    _resolveWith(data: unknown) {
      resolveValue = data;
    },
    then(onFulfilled, onRejected) {
      const result = operation === 'select' ? resolveValue : undefined;
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  };

  return chain;
}

// Actual mockDb used by mocked storage
let mockDb = buildMockDb();

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { userRoutes } from '../users.js';
import { validateSession, getUserById, getUserConnectedAccounts } from '../../auth/auth-service.js';
import { verifyPassword, validatePasswordStrength } from '../../auth/password.js';
import { getSettingsRaw, updateSettings } from '../../settings/index.js';
import { getDb } from '../../storage/index.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const ADMIN_USER = {
  id: 'admin-001',
  email: 'admin@example.com',
  name: 'Admin User',
  role: 'admin',
  status: 'active',
  createdAt: new Date('2024-01-01'),
  onboardingCompleted: true,
  avatarUrl: null,
  bio: null,
  timezone: null,
  locale: null,
};

const REGULAR_USER = {
  id: 'user-001',
  email: 'user@example.com',
  name: 'Regular User',
  role: 'user',
  status: 'active',
  createdAt: new Date('2024-01-01'),
  onboardingCompleted: false,
  avatarUrl: null,
  bio: null,
  timezone: null,
  locale: null,
};

/**
 * Build a Hono test app wrapping userRoutes, injecting a cookie header
 * so that the requireAuth middleware resolves the given user.
 */
function buildApp(user: typeof ADMIN_USER | typeof REGULAR_USER | null) {
  (validateSession as ReturnType<typeof vi.fn>).mockResolvedValue(user);

  const app = new Hono();
  app.route('/', userRoutes);
  return app;
}

function makeRequest(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: string;
  } = {},
): Request {
  const { method = 'GET', body, cookie = 'profclaw_session=test-token' } = options;
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('User Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = buildMockDb();
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);
  });

  // =========================================================================
  // AUTH MIDDLEWARE
  // =========================================================================

  describe('requireAuth middleware', () => {
    it('returns 401 when no session cookie is present', async () => {
      const app = buildApp(REGULAR_USER);
      const req = makeRequest('/me/profile', { cookie: '' });
      const res = await app.fetch(req);
      expect(res.status).toBe(401);
      const data = await res.json() as { error: string };
      expect(data.error).toBe('Not authenticated');
    });

    it('returns 401 when session token is invalid', async () => {
      (validateSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const app = new Hono();
      app.route('/', userRoutes);
      const res = await app.fetch(makeRequest('/me/profile'));
      expect(res.status).toBe(401);
      const data = await res.json() as { error: string };
      expect(data.error).toBe('Invalid session');
    });

    it('returns 500 when database is not initialized', async () => {
      (getDb as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(makeRequest('/me/profile'));
      expect(res.status).toBe(500);
      const data = await res.json() as { error: string };
      expect(data.error).toBe('Database not initialized');
    });
  });

  // =========================================================================
  // GET /me/profile
  // =========================================================================

  describe('GET /me/profile', () => {
    it('returns user profile, preferences, connected accounts and session count', async () => {
      const prefs = { id: 'pref-1', userId: REGULAR_USER.id, theme: 'dark' };
      const accounts = [{ provider: 'github', providerUserId: 'gh-123' }];
      const sessionRows = [{ id: 's1' }, { id: 's2' }];

      mockDb.limit = vi.fn(() => Promise.resolve([prefs]));
      mockDb._resolveWith(sessionRows);
      (getUserConnectedAccounts as ReturnType<typeof vi.fn>).mockResolvedValue(accounts);

      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(makeRequest('/me/profile'));
      expect(res.status).toBe(200);

      const data = await res.json() as {
        user: typeof REGULAR_USER;
        preferences: typeof prefs;
        connectedAccounts: typeof accounts;
        activeSessions: number;
      };
      expect(data.user).toMatchObject({ id: REGULAR_USER.id });
      expect(data.preferences).toMatchObject({ theme: 'dark' });
      expect(data.connectedAccounts).toHaveLength(1);
      expect(data.activeSessions).toBe(2);
    });

    it('returns null preferences when none exist', async () => {
      mockDb.limit = vi.fn(() => Promise.resolve([]));
      mockDb._resolveWith([]);
      (getUserConnectedAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(makeRequest('/me/profile'));
      expect(res.status).toBe(200);
      const data = await res.json() as { preferences: null };
      expect(data.preferences).toBeNull();
    });
  });

  // =========================================================================
  // PATCH /me/profile
  // =========================================================================

  describe('PATCH /me/profile', () => {
    it('updates name, bio, timezone, locale and returns updated user', async () => {
      const updatedUser = { ...REGULAR_USER, name: 'New Name', bio: 'Hello' };
      (getUserById as ReturnType<typeof vi.fn>).mockResolvedValue(updatedUser);

      // update().set().where() — no .limit() needed
      mockDb.where = vi.fn(() => Promise.resolve());

      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/profile', {
          method: 'PATCH',
          body: { name: 'New Name', bio: 'Hello', timezone: 'UTC', locale: 'en' },
        }),
      );
      expect(res.status).toBe(200);
      const data = await res.json() as { user: typeof updatedUser };
      expect(data.user.name).toBe('New Name');
    });

    it('returns 400 when name is an empty string', async () => {
      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/profile', { method: 'PATCH', body: { name: '' } }),
      );
      expect(res.status).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toMatch(/Name must be at least/);
    });
  });

  // =========================================================================
  // PUT /me/email
  // =========================================================================

  describe('PUT /me/email', () => {
    it('returns 400 when newEmail is missing', async () => {
      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/email', { method: 'PUT', body: {} }),
      );
      expect(res.status).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toBe('New email is required');
    });

    it('returns 400 for invalid email format', async () => {
      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/email', { method: 'PUT', body: { newEmail: 'not-an-email' } }),
      );
      expect(res.status).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toBe('Invalid email format');
    });

    it('returns 404 when user row is missing in DB', async () => {
      mockDb.limit = vi.fn(() => Promise.resolve([]));
      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/email', { method: 'PUT', body: { newEmail: 'new@example.com' } }),
      );
      expect(res.status).toBe(404);
    });

    it('returns 400 when user has password but currentPassword not provided', async () => {
      mockDb.limit = vi.fn(() => Promise.resolve([{ ...REGULAR_USER, passwordHash: 'hash123' }]));
      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/email', { method: 'PUT', body: { newEmail: 'new@example.com' } }),
      );
      expect(res.status).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toBe('Current password is required');
    });

    it('returns 401 when currentPassword is wrong', async () => {
      mockDb.limit = vi.fn(() => Promise.resolve([{ ...REGULAR_USER, passwordHash: 'hash123' }]));
      (verifyPassword as ReturnType<typeof vi.fn>).mockReturnValue({ valid: false });
      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/email', {
          method: 'PUT',
          body: { newEmail: 'new@example.com', currentPassword: 'wrong' },
        }),
      );
      expect(res.status).toBe(401);
    });

    it('returns 409 when email is already in use by another user', async () => {
      let callCount = 0;
      mockDb.limit = vi.fn(() => {
        callCount++;
        // 1st call: current user (no password)
        if (callCount === 1) return Promise.resolve([{ ...REGULAR_USER, passwordHash: null }]);
        // 2nd call: existing user with different id
        return Promise.resolve([{ id: 'other-user', email: 'taken@example.com' }]);
      });
      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/email', { method: 'PUT', body: { newEmail: 'taken@example.com' } }),
      );
      expect(res.status).toBe(409);
    });

    it('successfully updates email when validation passes', async () => {
      let callCount = 0;
      mockDb.limit = vi.fn(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve([{ ...REGULAR_USER, passwordHash: null }]);
        return Promise.resolve([]); // no existing user with that email
      });
      (getUserById as ReturnType<typeof vi.fn>).mockResolvedValue(REGULAR_USER);

      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/email', { method: 'PUT', body: { newEmail: 'newaddr@example.com' } }),
      );
      expect(res.status).toBe(200);
      const data = await res.json() as { message: string };
      expect(data.message).toBe('Email updated successfully');
    });
  });

  // =========================================================================
  // PUT /me/password
  // =========================================================================

  describe('PUT /me/password', () => {
    it('returns 400 when newPassword is missing', async () => {
      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/password', { method: 'PUT', body: {} }),
      );
      expect(res.status).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toBe('New password is required');
    });

    it('returns 400 when password fails strength check', async () => {
      (validatePasswordStrength as ReturnType<typeof vi.fn>).mockReturnValue('Password too weak');
      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/password', { method: 'PUT', body: { newPassword: 'weak' } }),
      );
      expect(res.status).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toBe('Password too weak');
    });

    it('returns 401 when current password is incorrect for existing-password user', async () => {
      (validatePasswordStrength as ReturnType<typeof vi.fn>).mockReturnValue(null);
      mockDb.limit = vi.fn(() => Promise.resolve([{ ...REGULAR_USER, passwordHash: 'hash123' }]));
      (verifyPassword as ReturnType<typeof vi.fn>).mockReturnValue({ valid: false });

      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/password', {
          method: 'PUT',
          body: { newPassword: 'NewPass123!', currentPassword: 'wrong' },
        }),
      );
      expect(res.status).toBe(401);
    });

    it('allows OAuth-only users to set a password without verification', async () => {
      (validatePasswordStrength as ReturnType<typeof vi.fn>).mockReturnValue(null);
      mockDb.limit = vi.fn(() => Promise.resolve([{ ...REGULAR_USER, passwordHash: null }]));

      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/password', {
          method: 'PUT',
          body: { newPassword: 'NewPass123!' },
        }),
      );
      expect(res.status).toBe(200);
      const data = await res.json() as { message: string };
      expect(data.message).toBe('Password updated successfully');
    });
  });

  // =========================================================================
  // GET /me/connected-accounts
  // =========================================================================

  describe('GET /me/connected-accounts', () => {
    it('returns accounts and hasPassword flag', async () => {
      const accounts = [{ provider: 'github', providerUserId: 'gh-1' }];
      (getUserConnectedAccounts as ReturnType<typeof vi.fn>).mockResolvedValue(accounts);
      mockDb.limit = vi.fn(() => Promise.resolve([{ passwordHash: 'hash123' }]));

      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(makeRequest('/me/connected-accounts'));
      expect(res.status).toBe(200);

      const data = await res.json() as { hasPassword: boolean; canDisconnect: boolean };
      expect(data.hasPassword).toBe(true);
      expect(data.canDisconnect).toBe(true);
    });

    it('sets canDisconnect=false when no password and only one account', async () => {
      const accounts = [{ provider: 'github', providerUserId: 'gh-1' }];
      (getUserConnectedAccounts as ReturnType<typeof vi.fn>).mockResolvedValue(accounts);
      mockDb.limit = vi.fn(() => Promise.resolve([{ passwordHash: null }]));

      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(makeRequest('/me/connected-accounts'));
      expect(res.status).toBe(200);

      const data = await res.json() as { canDisconnect: boolean };
      expect(data.canDisconnect).toBe(false);
    });
  });

  // =========================================================================
  // DELETE /me/connected-accounts/:provider
  // =========================================================================

  describe('DELETE /me/connected-accounts/:provider', () => {
    it('returns 404 when the provider account does not exist', async () => {
      mockDb.limit = vi.fn(() => Promise.resolve([]));
      // where() for oauthAccounts.userId returns a select result
      mockDb.where = vi.fn(() => Promise.resolve([]));

      // The route selects ALL accounts for the user first
      mockDb.select = vi.fn(() => mockDb);
      mockDb.from = vi.fn(() => mockDb);
      mockDb.where = vi.fn(() => Promise.resolve([]));

      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/connected-accounts/nonexistent', { method: 'DELETE' }),
      );
      expect(res.status).toBe(404);
    });

    it('returns 400 when disconnecting last auth method without a password', async () => {
      const accounts = [{ id: 'oa-1', provider: 'github', userId: REGULAR_USER.id }];

      // Sequence: 1) oauthAccounts select, 2) users.passwordHash select
      let callCount = 0;
      mockDb.where = vi.fn(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(accounts);
        if (callCount === 2) return Promise.resolve(accounts); // re-used for limit
        return Promise.resolve([{ passwordHash: null }]);
      });
      mockDb.limit = vi.fn(() => Promise.resolve([{ passwordHash: null }]));

      // Rebuild with direct from mock resolving arrays
      const localDb = buildMockDb();
      localDb.where = vi.fn(() => localDb);
      let seq = 0;
      localDb.limit = vi.fn(() => {
        seq++;
        if (seq === 1) return Promise.resolve(accounts);
        return Promise.resolve([{ passwordHash: null }]);
      });
      // select().from() returns the chain; need where() to still chain
      // The route does: db.select().from(oauthAccounts).where(...)
      // which is NOT followed by .limit — it awaits the where directly
      // Let's override where to return the right data depending on call
      let wSeq = 0;
      localDb.where = vi.fn(() => {
        wSeq++;
        if (wSeq === 1) return Promise.resolve(accounts); // oauth accounts query
        return localDb; // password query chained further with .limit
      });
      (getDb as ReturnType<typeof vi.fn>).mockReturnValue(localDb);

      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/connected-accounts/github', { method: 'DELETE' }),
      );
      expect(res.status).toBe(400);
      const data = await res.json() as { requiresPassword: boolean };
      expect(data.requiresPassword).toBe(true);
    });
  });

  // =========================================================================
  // GET /me/preferences
  // =========================================================================

  describe('GET /me/preferences', () => {
    it('returns existing preferences', async () => {
      const prefs = { id: 'pref-1', userId: REGULAR_USER.id, theme: 'dark' };
      mockDb.limit = vi.fn(() => Promise.resolve([prefs]));

      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(makeRequest('/me/preferences'));
      expect(res.status).toBe(200);
      const data = await res.json() as { preferences: typeof prefs };
      expect(data.preferences.theme).toBe('dark');
    });

    it('creates and returns default preferences when none exist', async () => {
      const created = { id: 'new-pref', userId: REGULAR_USER.id, theme: 'light' };
      let callCount = 0;
      mockDb.limit = vi.fn(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve([]); // no existing prefs
        return Promise.resolve([created]); // after insert
      });

      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(makeRequest('/me/preferences'));
      expect(res.status).toBe(200);
      const data = await res.json() as { preferences: typeof created };
      expect(data.preferences.id).toBe('new-pref');
    });
  });

  // =========================================================================
  // PATCH /me/preferences
  // =========================================================================

  describe('PATCH /me/preferences', () => {
    it('updates allowed preference fields', async () => {
      const updated = { id: 'pref-1', userId: REGULAR_USER.id, theme: 'light' };
      let callCount = 0;
      mockDb.limit = vi.fn(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve([{ id: 'pref-1' }]); // existing
        return Promise.resolve([updated]); // after update
      });

      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/preferences', { method: 'PATCH', body: { theme: 'light' } }),
      );
      expect(res.status).toBe(200);
      const data = await res.json() as { preferences: typeof updated };
      expect(data.preferences.theme).toBe('light');
    });

    it('inserts preferences row when none exist yet', async () => {
      const created = { id: 'new-pref', userId: REGULAR_USER.id, theme: 'dark' };
      let callCount = 0;
      mockDb.limit = vi.fn(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve([]); // no existing
        return Promise.resolve([created]); // after insert
      });

      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/preferences', { method: 'PATCH', body: { theme: 'dark' } }),
      );
      expect(res.status).toBe(200);
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // GET /me/api-keys
  // =========================================================================

  describe('GET /me/api-keys', () => {
    it('returns list of api keys without hash', async () => {
      const keys = [
        { id: 'key-1', name: 'CI Key', keyPrefix: 'profclaw_ab12...', scopes: ['read'], createdAt: new Date() },
      ];
      mockDb.where = vi.fn(() => Promise.resolve(keys));

      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(makeRequest('/me/api-keys'));
      expect(res.status).toBe(200);
      const data = await res.json() as { apiKeys: typeof keys };
      expect(data.apiKeys).toHaveLength(1);
      expect(data.apiKeys[0].name).toBe('CI Key');
    });
  });

  // =========================================================================
  // POST /me/api-keys
  // =========================================================================

  describe('POST /me/api-keys', () => {
    it('returns 400 when name is missing', async () => {
      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/api-keys', { method: 'POST', body: {} }),
      );
      expect(res.status).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toBe('Name is required');
    });

    it('creates an api key and returns the raw key once', async () => {
      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/api-keys', { method: 'POST', body: { name: 'My Key', scopes: ['read', 'write'] } }),
      );
      expect(res.status).toBe(200);
      const data = await res.json() as { apiKey: { key: string; name: string }; message: string };
      expect(data.apiKey.key).toMatch(/^profclaw_/);
      expect(data.apiKey.name).toBe('My Key');
      expect(data.message).toMatch(/Save this key/);
    });

    it('sets expiry when expiresInDays is provided', async () => {
      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/api-keys', { method: 'POST', body: { name: 'Expiring Key', expiresInDays: 30 } }),
      );
      expect(res.status).toBe(200);
      const data = await res.json() as { apiKey: { expiresAt: string | null } };
      expect(data.apiKey.expiresAt).not.toBeNull();
    });
  });

  // =========================================================================
  // DELETE /me/api-keys/:keyId
  // =========================================================================

  describe('DELETE /me/api-keys/:keyId', () => {
    it('returns 404 when key not found', async () => {
      mockDb.limit = vi.fn(() => Promise.resolve([]));
      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/api-keys/nonexistent', { method: 'DELETE' }),
      );
      expect(res.status).toBe(404);
    });

    it('returns 404 when key belongs to another user', async () => {
      mockDb.limit = vi.fn(() => Promise.resolve([{ id: 'key-1', userId: 'other-user' }]));
      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/api-keys/key-1', { method: 'DELETE' }),
      );
      expect(res.status).toBe(404);
    });

    it('revokes an owned api key', async () => {
      mockDb.limit = vi.fn(() => Promise.resolve([{ id: 'key-1', userId: REGULAR_USER.id }]));

      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/api-keys/key-1', { method: 'DELETE' }),
      );
      expect(res.status).toBe(200);
      const data = await res.json() as { message: string };
      expect(data.message).toBe('API key revoked');
    });
  });

  // =========================================================================
  // GET /me/sessions
  // =========================================================================

  describe('GET /me/sessions', () => {
    it('returns sessions and marks the current one', async () => {
      const sessionRows = [
        { id: 's1', userAgent: 'UA', ipAddress: '127.0.0.1', deviceName: null, createdAt: new Date(), lastActiveAt: new Date(), expiresAt: new Date(), token: 'test-token' },
        { id: 's2', userAgent: 'UA2', ipAddress: '10.0.0.1', deviceName: null, createdAt: new Date(), lastActiveAt: new Date(), expiresAt: new Date(), token: 'other-token' },
      ];
      mockDb.where = vi.fn(() => Promise.resolve(sessionRows));

      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(makeRequest('/me/sessions'));
      expect(res.status).toBe(200);

      const data = await res.json() as { sessions: Array<{ id: string; isCurrent: boolean }> };
      const current = data.sessions.find((s) => s.isCurrent);
      expect(current?.id).toBe('s1');
    });
  });

  // =========================================================================
  // DELETE /me/sessions/:sessionId
  // =========================================================================

  describe('DELETE /me/sessions/:sessionId', () => {
    it('returns 404 when session not found', async () => {
      mockDb.limit = vi.fn(() => Promise.resolve([]));
      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/sessions/bad-id', { method: 'DELETE' }),
      );
      expect(res.status).toBe(404);
    });

    it('revokes session when ownership is confirmed', async () => {
      mockDb.limit = vi.fn(() => Promise.resolve([{ id: 's1', userId: REGULAR_USER.id }]));

      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/sessions/s1', { method: 'DELETE' }),
      );
      expect(res.status).toBe(200);
      const data = await res.json() as { message: string };
      expect(data.message).toBe('Session revoked');
    });
  });

  // =========================================================================
  // DELETE /me/sessions (revoke all)
  // =========================================================================

  describe('DELETE /me/sessions (revoke all)', () => {
    it('revokes all sessions except the current token', async () => {
      const allSessions = [
        { id: 's1', token: 'test-token' },   // current
        { id: 's2', token: 'other-token-1' },
        { id: 's3', token: 'other-token-2' },
      ];
      mockDb.where = vi.fn(() => Promise.resolve(allSessions));
      mockDb.delete = vi.fn(() => mockDb);

      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/sessions', { method: 'DELETE' }),
      );
      expect(res.status).toBe(200);
      const data = await res.json() as { message: string };
      expect(data.message).toBe('Revoked 2 sessions');
    });
  });

  // =========================================================================
  // POST /me/complete-onboarding
  // =========================================================================

  describe('POST /me/complete-onboarding', () => {
    it('marks onboarding as complete', async () => {
      mockDb.where = vi.fn(() => Promise.resolve());
      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/complete-onboarding', { method: 'POST', body: {} }),
      );
      expect(res.status).toBe(200);
      const data = await res.json() as { message: string };
      expect(data.message).toBe('Onboarding completed');
    });
  });

  // =========================================================================
  // POST /me/recovery-codes/regenerate
  // =========================================================================

  describe('POST /me/recovery-codes/regenerate', () => {
    it('regenerates and returns recovery codes', async () => {
      mockDb.where = vi.fn(() => Promise.resolve());
      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/recovery-codes/regenerate', { method: 'POST', body: {} }),
      );
      expect(res.status).toBe(200);
      const data = await res.json() as { success: boolean; recoveryCodes: string[] };
      expect(data.success).toBe(true);
      expect(data.recoveryCodes).toHaveLength(8);
    });
  });

  // =========================================================================
  // GET /me/recovery-codes/count
  // =========================================================================

  describe('GET /me/recovery-codes/count', () => {
    it('returns count of remaining recovery codes', async () => {
      const codes = ['h:C1', 'h:C2', 'h:C3'];
      mockDb.limit = vi.fn(() =>
        Promise.resolve([{ recoveryCodes: JSON.stringify(codes) }]),
      );

      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(makeRequest('/me/recovery-codes/count'));
      expect(res.status).toBe(200);
      const data = await res.json() as { remainingCodes: number; hasRecoveryCodes: boolean };
      expect(data.remainingCodes).toBe(3);
      expect(data.hasRecoveryCodes).toBe(true);
    });

    it('returns count=0 when no recovery codes set', async () => {
      mockDb.limit = vi.fn(() => Promise.resolve([{ recoveryCodes: null }]));
      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(makeRequest('/me/recovery-codes/count'));
      expect(res.status).toBe(200);
      const data = await res.json() as { remainingCodes: number; hasRecoveryCodes: boolean };
      expect(data.remainingCodes).toBe(0);
      expect(data.hasRecoveryCodes).toBe(false);
    });

    it('returns 404 when user not found in DB', async () => {
      mockDb.limit = vi.fn(() => Promise.resolve([]));
      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(makeRequest('/me/recovery-codes/count'));
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // ADMIN: requireAdmin middleware
  // =========================================================================

  describe('requireAdmin middleware', () => {
    it('returns 403 when authenticated user is not admin', async () => {
      const app = buildApp(REGULAR_USER); // role: 'user'
      const res = await app.fetch(makeRequest('/admin/list'));
      expect(res.status).toBe(403);
      const data = await res.json() as { error: string };
      expect(data.error).toBe('Admin access required');
    });
  });

  // =========================================================================
  // GET /admin/list
  // =========================================================================

  describe('GET /admin/list', () => {
    it('returns all users with total count', async () => {
      const allUsers = [ADMIN_USER, REGULAR_USER];
      mockDb.orderBy = vi.fn(() => Promise.resolve(allUsers));

      const app = buildApp(ADMIN_USER);
      const res = await app.fetch(makeRequest('/admin/list'));
      expect(res.status).toBe(200);
      const data = await res.json() as { users: typeof allUsers; total: number };
      expect(data.total).toBe(2);
      expect(data.users).toHaveLength(2);
    });
  });

  // =========================================================================
  // GET /admin/:userId
  // =========================================================================

  describe('GET /admin/:userId', () => {
    it('returns 404 when user does not exist', async () => {
      mockDb.limit = vi.fn(() => Promise.resolve([]));
      const app = buildApp(ADMIN_USER);
      const res = await app.fetch(makeRequest('/admin/no-such-user'));
      expect(res.status).toBe(404);
    });

    it('returns user details with active session count', async () => {
      mockDb.limit = vi.fn(() => Promise.resolve([REGULAR_USER]));
      mockDb._resolveWith([]);

      const app = buildApp(ADMIN_USER);
      const res = await app.fetch(makeRequest(`/admin/${REGULAR_USER.id}`));
      expect(res.status).toBe(200);
      const data = await res.json() as { user: typeof REGULAR_USER; activeSessions: number };
      expect(data.user.id).toBe(REGULAR_USER.id);
    });
  });

  // =========================================================================
  // PATCH /admin/:userId
  // =========================================================================

  describe('PATCH /admin/:userId', () => {
    it('returns 400 for invalid role', async () => {
      const app = buildApp(ADMIN_USER);
      const res = await app.fetch(
        makeRequest(`/admin/${REGULAR_USER.id}`, { method: 'PATCH', body: { role: 'superuser' } }),
      );
      expect(res.status).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toBe('Invalid role');
    });

    it('returns 400 for invalid status', async () => {
      const app = buildApp(ADMIN_USER);
      const res = await app.fetch(
        makeRequest(`/admin/${REGULAR_USER.id}`, { method: 'PATCH', body: { status: 'banned' } }),
      );
      expect(res.status).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toBe('Invalid status');
    });

    it('updates user role and status successfully', async () => {
      mockDb.where = vi.fn(() => Promise.resolve());
      const app = buildApp(ADMIN_USER);
      const res = await app.fetch(
        makeRequest(`/admin/${REGULAR_USER.id}`, {
          method: 'PATCH',
          body: { role: 'admin', status: 'active', name: 'Promoted User' },
        }),
      );
      expect(res.status).toBe(200);
      const data = await res.json() as { message: string };
      expect(data.message).toBe('User updated');
    });
  });

  // =========================================================================
  // POST /admin/:userId/reset-password
  // =========================================================================

  describe('POST /admin/:userId/reset-password', () => {
    it('resets password and invalidates all sessions', async () => {
      mockDb.where = vi.fn(() => Promise.resolve());
      const app = buildApp(ADMIN_USER);
      const res = await app.fetch(
        makeRequest(`/admin/${REGULAR_USER.id}/reset-password`, { method: 'POST', body: {} }),
      );
      expect(res.status).toBe(200);
      const data = await res.json() as { temporaryPassword: string; recoveryCodes: string[] };
      expect(data.temporaryPassword).toBeTruthy();
      expect(data.recoveryCodes).toHaveLength(8);
    });
  });

  // =========================================================================
  // DELETE /admin/:userId
  // =========================================================================

  describe('DELETE /admin/:userId', () => {
    it('returns 400 when admin tries to delete their own account', async () => {
      const app = buildApp(ADMIN_USER);
      const res = await app.fetch(
        makeRequest(`/admin/${ADMIN_USER.id}`, { method: 'DELETE' }),
      );
      expect(res.status).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toBe('Cannot delete your own account');
    });

    it('deletes another user and all related data', async () => {
      mockDb.where = vi.fn(() => Promise.resolve());
      const app = buildApp(ADMIN_USER);
      const res = await app.fetch(
        makeRequest(`/admin/${REGULAR_USER.id}`, { method: 'DELETE' }),
      );
      expect(res.status).toBe(200);
      const data = await res.json() as { message: string };
      expect(data.message).toBe('User deleted');
      // delete should be called for sessions, prefs, api keys, and users table
      expect(mockDb.delete).toHaveBeenCalledTimes(4);
    });
  });

  // =========================================================================
  // POST /admin/invites
  // =========================================================================

  describe('POST /admin/invites', () => {
    it('generates a single invite code by default', async () => {
      const app = buildApp(ADMIN_USER);
      const res = await app.fetch(
        makeRequest('/admin/invites', { method: 'POST', body: { count: 1 } }),
      );
      expect(res.status).toBe(200);
      const data = await res.json() as { codes: Array<{ code: string }>; message: string };
      expect(data.codes).toHaveLength(1);
      expect(data.codes[0].code).toBe('INVITE123');
    });

    it('clamps count to max 50', async () => {
      const app = buildApp(ADMIN_USER);
      // We only check that the route doesn't error; the mock always returns 'INVITE123'
      const res = await app.fetch(
        makeRequest('/admin/invites', { method: 'POST', body: { count: 100 } }),
      );
      expect(res.status).toBe(200);
      const data = await res.json() as { codes: unknown[] };
      expect(data.codes.length).toBeLessThanOrEqual(50);
    });
  });

  // =========================================================================
  // GET /admin/invites
  // =========================================================================

  describe('GET /admin/invites', () => {
    it('returns all invite codes', async () => {
      const invites = [{ id: 'inv-1', createdBy: ADMIN_USER.id }];
      mockDb.orderBy = vi.fn(() => Promise.resolve(invites));

      const app = buildApp(ADMIN_USER);
      const res = await app.fetch(makeRequest('/admin/invites'));
      expect(res.status).toBe(200);
      const data = await res.json() as { invites: typeof invites; total: number };
      expect(data.total).toBe(1);
    });
  });

  // =========================================================================
  // DELETE /admin/invites/:id
  // =========================================================================

  describe('DELETE /admin/invites/:id', () => {
    it('returns 404 when invite not found', async () => {
      mockDb.limit = vi.fn(() => Promise.resolve([]));
      const app = buildApp(ADMIN_USER);
      const res = await app.fetch(
        makeRequest('/admin/invites/nonexistent', { method: 'DELETE' }),
      );
      expect(res.status).toBe(404);
    });

    it('deletes an existing invite code', async () => {
      mockDb.limit = vi.fn(() => Promise.resolve([{ id: 'inv-1' }]));

      const app = buildApp(ADMIN_USER);
      const res = await app.fetch(
        makeRequest('/admin/invites/inv-1', { method: 'DELETE' }),
      );
      expect(res.status).toBe(200);
      const data = await res.json() as { message: string };
      expect(data.message).toBe('Invite code deleted');
    });
  });

  // =========================================================================
  // GET /admin/registration-mode
  // =========================================================================

  describe('GET /admin/registration-mode', () => {
    it('returns current registration mode', async () => {
      (getSettingsRaw as ReturnType<typeof vi.fn>).mockResolvedValue({
        system: { registrationMode: 'invite' },
      });

      const app = buildApp(ADMIN_USER);
      const res = await app.fetch(makeRequest('/admin/registration-mode'));
      expect(res.status).toBe(200);
      const data = await res.json() as { mode: string };
      expect(data.mode).toBe('invite');
    });
  });

  // =========================================================================
  // PATCH /admin/registration-mode
  // =========================================================================

  describe('PATCH /admin/registration-mode', () => {
    it('returns 400 for invalid mode value', async () => {
      const app = buildApp(ADMIN_USER);
      const res = await app.fetch(
        makeRequest('/admin/registration-mode', { method: 'PATCH', body: { mode: 'closed' } }),
      );
      expect(res.status).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toMatch(/"open" or "invite"/);
    });

    it('sets registration mode to open', async () => {
      (updateSettings as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      const app = buildApp(ADMIN_USER);
      const res = await app.fetch(
        makeRequest('/admin/registration-mode', { method: 'PATCH', body: { mode: 'open' } }),
      );
      expect(res.status).toBe(200);
      const data = await res.json() as { mode: string; message: string };
      expect(data.mode).toBe('open');
      expect(updateSettings).toHaveBeenCalledWith({ system: { registrationMode: 'open' } });
    });

    it('sets registration mode to invite', async () => {
      (updateSettings as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      const app = buildApp(ADMIN_USER);
      const res = await app.fetch(
        makeRequest('/admin/registration-mode', { method: 'PATCH', body: { mode: 'invite' } }),
      );
      expect(res.status).toBe(200);
      const data = await res.json() as { mode: string };
      expect(data.mode).toBe('invite');
    });
  });

  // =========================================================================
  // PUT /me/primary-email
  // =========================================================================

  describe('PUT /me/primary-email', () => {
    it('returns 400 when email is missing', async () => {
      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/primary-email', { method: 'PUT', body: {} }),
      );
      expect(res.status).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toBe('Email is required');
    });

    it('returns 400 for malformed email', async () => {
      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/primary-email', { method: 'PUT', body: { email: 'bad-email' } }),
      );
      expect(res.status).toBe(400);
    });

    it('updates primary email when no duplicate exists', async () => {
      mockDb.limit = vi.fn(() => Promise.resolve([])); // no existing user with that email
      (getUserById as ReturnType<typeof vi.fn>).mockResolvedValue(REGULAR_USER);

      const app = buildApp(REGULAR_USER);
      const res = await app.fetch(
        makeRequest('/me/primary-email', {
          method: 'PUT',
          body: { email: 'primary@example.com', source: 'manual' },
        }),
      );
      expect(res.status).toBe(200);
      const data = await res.json() as { message: string };
      expect(data.message).toBe('Primary email updated successfully');
    });
  });
});
