import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const { mockTokensApi } = vi.hoisted(() => ({
  mockTokensApi: {
    createApiToken: vi.fn(),
    listApiTokens: vi.fn(),
    revokeApiToken: vi.fn(),
  },
}));

vi.mock('../../auth/api-tokens.js', () => ({
  createApiToken: mockTokensApi.createApiToken,
  listApiTokens: mockTokensApi.listApiTokens,
  revokeApiToken: mockTokensApi.revokeApiToken,
}));

import { tokensRoutes } from '../tokens.js';

function buildApp(): Hono {
  const app = new Hono();
  app.route('/api/tokens', tokensRoutes);
  return app;
}

describe('tokensRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTokensApi.createApiToken.mockResolvedValue({
      plainTextToken: 'pc_tok_123',
      token: {
        id: 'token-1',
        name: 'CLI token',
        scopes: ['read'],
        expiresAt: null,
      },
    });
    mockTokensApi.listApiTokens.mockResolvedValue([
      { id: 'token-1', name: 'CLI token', scopes: ['read'] },
    ]);
    mockTokensApi.revokeApiToken.mockResolvedValue(undefined);
  });

  it('returns 400 for malformed JSON on POST /', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name":"CLI token"',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 when POST / body is not a JSON object', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(['CLI token', ['read']]),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Request body must be a JSON object',
    });
  });

  it('creates a token and returns the secret once', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'CLI token', scopes: ['read'] }),
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      token: 'pc_tok_123',
      id: 'token-1',
      name: 'CLI token',
    });
  });

  it('lists tokens without error', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/tokens'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      tokens: [{ id: 'token-1', name: 'CLI token', scopes: ['read'] }],
    });
  });

  it('returns 500 when revoke fails', async () => {
    const app = buildApp();
    mockTokensApi.revokeApiToken.mockRejectedValueOnce(new Error('db offline'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await app.fetch(new Request('http://localhost/api/tokens/token-1', {
      method: 'DELETE',
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to revoke token' });
  });
});
