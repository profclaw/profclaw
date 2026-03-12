import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  createApiToken,
  listApiTokens,
  revokeApiToken,
  type TokenScope,
} from '../auth/api-tokens.js';

const tokens = new Hono();

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

// Create a new API token
tokens.post('/', async (c) => {
  try {
    const parsed = await parseJsonBody(c);
    if (!parsed.ok) {
      return parsed.response;
    }

    const { name, scopes, expiresInDays, rateLimit } = parsed.body;

    if (!name || !scopes || !Array.isArray(scopes)) {
      return c.json({ error: 'name and scopes are required' }, 400);
    }

    const result = await createApiToken(name, scopes as TokenScope[], {
      expiresInDays,
      rateLimit,
    });

    return c.json({
      message: 'Token created. Save the token - it will not be shown again!',
      token: result.plainTextToken,
      id: result.token.id,
      name: result.token.name,
      scopes: result.token.scopes,
      expiresAt: result.token.expiresAt,
    }, 201);
  } catch (error) {
    console.error('[API] Error creating token:', error);
    return c.json({ error: 'Failed to create token' }, 500);
  }
});

// List all tokens (without secrets)
tokens.get('/', async (c) => {
  try {
    const tokenList = await listApiTokens();
    return c.json({ tokens: tokenList });
  } catch (error) {
    console.error('[API] Error listing tokens:', error);
    return c.json({ error: 'Failed to list tokens' }, 500);
  }
});

// Revoke a token
tokens.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await revokeApiToken(id);
    return c.json({ message: 'Token revoked' });
  } catch (error) {
    console.error('[API] Error revoking token:', error);
    return c.json({ error: 'Failed to revoke token' }, 500);
  }
});

export { tokens as tokensRoutes };
