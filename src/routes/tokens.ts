import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import {
  createApiToken,
  listApiTokens,
  revokeApiToken,
  type TokenScope,
} from '../auth/api-tokens.js';
import { createContextualLogger } from '../utils/logger.js';

const tokens = new Hono();
const log = createContextualLogger('TokensRoutes');

const createTokenBodySchema = z.object({
  name: z.string().min(1),
  scopes: z.array(z.string()).min(1),
  expiresInDays: z.number().optional(),
  rateLimit: z.number().optional(),
});

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

    const bodyParse = createTokenBodySchema.safeParse(parsed.body);
    if (!bodyParse.success) {
      return c.json({ error: 'name and scopes are required' }, 400);
    }

    const { name, scopes, expiresInDays, rateLimit } = bodyParse.data;

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
    log.error('Error creating token', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to create token' }, 500);
  }
});

// List all tokens (without secrets)
tokens.get('/', async (c) => {
  try {
    const tokenList = await listApiTokens();
    return c.json({ tokens: tokenList });
  } catch (error) {
    log.error('Error listing tokens', error instanceof Error ? error : new Error(String(error)));
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
    log.error('Error revoking token', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to revoke token' }, 500);
  }
});

export { tokens as tokensRoutes };
