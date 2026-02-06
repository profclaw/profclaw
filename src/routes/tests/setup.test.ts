import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const { mockSetupDeps } = vi.hoisted(() => ({
  mockSetupDeps: {
    getDb: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    isGitHubOAuthConfigured: vi.fn(),
    createSession: vi.fn(),
    hashPassword: vi.fn((password: string) => `hashed:${password}`),
    validatePasswordStrength: vi.fn(() => null),
    generateRecoveryCodes: vi.fn(() => ['CODE1']),
    hashRecoveryCodes: vi.fn(() => ['HASH1']),
    hashRecoveryCode: vi.fn((code: string) => `hash:${code}`),
  },
}));

vi.mock('../../storage/index.js', () => ({
  getDb: mockSetupDeps.getDb,
}));

vi.mock('../../storage/schema.js', () => ({
  users: {
    id: 'id',
    role: 'role',
    email: 'email',
    passwordResetToken: 'passwordResetToken',
  },
  userPreferences: {
    id: 'id',
    userId: 'userId',
  },
}));

vi.mock('../../settings/index.js', () => ({
  getSettings: mockSetupDeps.getSettings,
  updateSettings: mockSetupDeps.updateSettings,
  isGitHubOAuthConfigured: mockSetupDeps.isGitHubOAuthConfigured,
}));

vi.mock('../../auth/auth-service.js', () => ({
  createSession: mockSetupDeps.createSession,
}));

vi.mock('../../auth/password.js', () => ({
  hashPassword: mockSetupDeps.hashPassword,
  validatePasswordStrength: mockSetupDeps.validatePasswordStrength,
  generateRecoveryCodes: mockSetupDeps.generateRecoveryCodes,
  hashRecoveryCodes: mockSetupDeps.hashRecoveryCodes,
  hashRecoveryCode: mockSetupDeps.hashRecoveryCode,
}));

vi.mock('../../middleware/rate-limit.js', () => ({
  rateLimit: vi.fn(() => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  }),
}));

import { setupRoutes } from '../setup.js';
import { getSettings } from '../../settings/index.js';

function buildApp(): Hono {
  const app = new Hono();
  app.route('/api/setup', setupRoutes);
  return app;
}

describe('setupRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mockSetupDeps.getDb.mockReturnValue({});
    mockSetupDeps.getSettings.mockResolvedValue({
      aiProvider: {},
      system: { showForgotPassword: true },
    });
    mockSetupDeps.updateSettings.mockResolvedValue(undefined);
    mockSetupDeps.isGitHubOAuthConfigured.mockResolvedValue(false);
    mockSetupDeps.createSession.mockResolvedValue({
      token: 'session-token',
      expiresAt: new Date('2026-03-12T00:00:00Z'),
    });
  });

  it('falls back to safe defaults when GET /status throws', async () => {
    const app = buildApp();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(getSettings).mockRejectedValueOnce(new Error('settings unavailable'));

    const response = await app.fetch(new Request('http://localhost/api/setup/status'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      configured: false,
      isFirstTimeSetup: true,
      hasAdmin: false,
      ready: false,
    });
  });

  it('returns 400 for malformed JSON on POST /github-oauth/validate', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/setup/github-oauth/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"clientId":"abc"',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 for malformed JSON on POST /github-oauth', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/setup/github-oauth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"clientId":"abc"',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 for malformed JSON on POST /admin', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/setup/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"email":"owner@example.com"',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 for malformed JSON on POST /verify-recovery-code', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/setup/verify-recovery-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"email":"owner@example.com"',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 for malformed JSON on POST /reset-password', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/setup/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"resetToken":"token"',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('saves GitHub OAuth settings on valid POST /github-oauth', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/setup/github-oauth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'Iv1.0123456789abcdef',
        clientSecret: '0123456789abcdef0123456789abcdef01234567',
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: 'GitHub OAuth configured successfully.',
    });
    expect(mockSetupDeps.updateSettings).toHaveBeenCalledOnce();
  });
});
