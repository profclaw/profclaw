import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

type MockDb = {
  select: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  _resolveWith: (value: unknown) => void;
};

function buildMockDb(): MockDb {
  let resolveValue: unknown = [];

  const db: MockDb = {
    select: vi.fn(() => db),
    from: vi.fn(() => db),
    where: vi.fn(() => db),
    limit: vi.fn(() => Promise.resolve(resolveValue)),
    insert: vi.fn(() => db),
    values: vi.fn(() => Promise.resolve()),
    update: vi.fn(() => db),
    set: vi.fn(() => db),
    _resolveWith(value: unknown) {
      resolveValue = value;
    },
  };

  return db;
}

let mockDb = buildMockDb();

vi.mock('../../storage/index.js', () => ({
  getDb: vi.fn(() => mockDb),
}));

vi.mock('../../storage/schema.js', () => ({
  users: {
    id: 'id',
    role: 'role',
    email: 'email',
  },
  userPreferences: {
    id: 'id',
    userId: 'userId',
    updatedAt: 'updatedAt',
  },
}));

vi.mock('../../settings/index.js', () => ({
  getSettingsRaw: vi.fn(() => Promise.resolve({ system: { authMode: 'local' } })),
  updateSettings: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../auth/auth-service.js', () => ({
  createSession: vi.fn(() => Promise.resolve({ token: 'session-token' })),
}));

vi.mock('hono/cookie', () => ({
  setCookie: vi.fn(),
}));

vi.mock('../../auth/password.js', () => ({
  hashPassword: vi.fn((password: string) => `hashed:${password}`),
  validatePasswordStrength: vi.fn(() => null),
}));

vi.mock('../../auth/middleware.js', () => ({
  invalidateLocalAdminCache: vi.fn(),
}));

import { oobeRoutes } from '../oobe.js';
import { getSettingsRaw } from '../../settings/index.js';

function buildApp(): Hono {
  const app = new Hono();
  app.route('/api/oobe', oobeRoutes);
  return app;
}

describe('oobeRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = buildMockDb();
    mockDb._resolveWith([]);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 400 for malformed JSON on POST /setup', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/oobe/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name":"Owner"',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 for malformed JSON on POST /validate-ai', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/oobe/validate-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"provider":"openai"',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 for malformed JSON on POST /enable-multiuser', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/oobe/enable-multiuser', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"email":"owner@example.com"',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('falls back to setup-needed status when status lookup throws', async () => {
    const app = buildApp();
    vi.mocked(getSettingsRaw).mockRejectedValueOnce(new Error('settings unavailable'));

    const response = await app.fetch(new Request('http://localhost/api/oobe/status'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      needsSetup: true,
      authMode: 'local',
    });
  });
});
