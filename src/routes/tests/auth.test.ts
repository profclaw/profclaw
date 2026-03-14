import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const { mockAuthDeps } = vi.hoisted(() => ({
  mockAuthDeps: {
    signUpWithEmail: vi.fn(),
    signInWithEmail: vi.fn(),
    signInWithGitHub: vi.fn(),
    validateSession: vi.fn(),
    deleteSession: vi.fn(),
    getGitHubAuthUrl: vi.fn(),
    getUserById: vi.fn(),
    updateUser: vi.fn(),
    getUserConnectedAccounts: vi.fn(),
    getUserGitHubToken: vi.fn(),
    redirectToJira: vi.fn(),
    handleJiraCallback: vi.fn(),
    redirectToLinear: vi.fn(),
    handleLinearCallback: vi.fn(),
    validatePasswordStrength: vi.fn(() => null),
    hashInviteCode: vi.fn((value: string) => `hash:${value}`),
    getSettingsRaw: vi.fn(),
    getDb: vi.fn(),
  },
}));

vi.mock('../../auth/auth-service.js', () => ({
  signUpWithEmail: mockAuthDeps.signUpWithEmail,
  signInWithEmail: mockAuthDeps.signInWithEmail,
  signInWithGitHub: mockAuthDeps.signInWithGitHub,
  validateSession: mockAuthDeps.validateSession,
  deleteSession: mockAuthDeps.deleteSession,
  getGitHubAuthUrl: mockAuthDeps.getGitHubAuthUrl,
  getUserById: mockAuthDeps.getUserById,
  updateUser: mockAuthDeps.updateUser,
  getUserConnectedAccounts: mockAuthDeps.getUserConnectedAccounts,
  getUserGitHubToken: mockAuthDeps.getUserGitHubToken,
}));

vi.mock('../../auth/jira-oauth.js', () => ({
  redirectToJira: mockAuthDeps.redirectToJira,
  handleJiraCallback: mockAuthDeps.handleJiraCallback,
}));

vi.mock('../../auth/linear-oauth.js', () => ({
  redirectToLinear: mockAuthDeps.redirectToLinear,
  handleLinearCallback: mockAuthDeps.handleLinearCallback,
}));

vi.mock('../../middleware/rate-limit.js', () => ({
  rateLimit: vi.fn(() => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  }),
}));

vi.mock('../../auth/password.js', () => ({
  validatePasswordStrength: mockAuthDeps.validatePasswordStrength,
  hashInviteCode: mockAuthDeps.hashInviteCode,
}));

vi.mock('../../settings/index.js', () => ({
  getSettingsRaw: mockAuthDeps.getSettingsRaw,
}));

vi.mock('../../storage/index.js', () => ({
  getDb: mockAuthDeps.getDb,
}));

vi.mock('../../storage/schema.js', () => ({
  inviteCodes: {
    codeHash: 'codeHash',
    id: 'id',
  },
}));

import { authRoutes } from '../auth.js';

function buildApp(): Hono {
  const app = new Hono();
  app.route('/api/auth', authRoutes);
  return app;
}

describe('authRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockAuthDeps.getSettingsRaw.mockResolvedValue({
      system: { registrationMode: 'open', authMode: 'multi' },
    });
    mockAuthDeps.signInWithEmail.mockResolvedValue({
      success: true,
      user: { id: 'user-1', email: 'owner@example.com' },
      session: { token: 'session-token' },
    });
    mockAuthDeps.signUpWithEmail.mockResolvedValue({
      success: true,
      user: { id: 'user-1', email: 'owner@example.com', name: 'Owner' },
      session: { token: 'session-token' },
    });
    mockAuthDeps.signInWithGitHub.mockResolvedValue({
      success: true,
      user: { id: 'user-1', onboardingCompleted: true },
      session: { token: 'session-token' },
    });
    mockAuthDeps.validateSession.mockResolvedValue({
      id: 'user-1',
      email: 'owner@example.com',
      name: 'Owner',
    });
    mockAuthDeps.updateUser.mockResolvedValue({
      id: 'user-1',
      email: 'owner@example.com',
      name: 'Updated Owner',
    });
    mockAuthDeps.getUserConnectedAccounts.mockResolvedValue([]);
    mockAuthDeps.getUserGitHubToken.mockResolvedValue(null);
    mockAuthDeps.getDb.mockReturnValue(null);
  });

  it('returns 400 for malformed JSON on POST /signup', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"email":"owner@example.com"',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 when POST /login body is not a JSON object', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(['owner@example.com', 'password']),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Request body must be a JSON object',
    });
  });

  it('logs in successfully with valid credentials', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.com', password: 'Password123' }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: 'Logged in successfully',
      user: { id: 'user-1' },
    });
  });

  it('returns 400 for malformed JSON on POST /github/token', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/auth/github/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"code":"abc"',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 for malformed JSON on PATCH /me after auth', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/auth/me', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'profclaw_session=session-token',
      },
      body: '{"name":"Updated Owner"',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('updates the current user on valid PATCH /me', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/auth/me', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'profclaw_session=session-token',
      },
      body: JSON.stringify({ name: 'Updated Owner' }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      user: {
        id: 'user-1',
        email: 'owner@example.com',
        name: 'Updated Owner',
      },
    });
  });
});
