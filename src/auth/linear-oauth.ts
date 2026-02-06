import type { Context } from 'hono';
import { logger } from '../utils/logger.js';

const CLIENT_ID = process.env.LINEAR_CLIENT_ID || '';
const CLIENT_SECRET = process.env.LINEAR_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.LINEAR_REDIRECT_URI || '';

/**
 * Redirect user to Linear for authorization
 */
export async function redirectToLinear(c: Context) {
  if (!CLIENT_ID || !REDIRECT_URI) {
    return c.json({ error: 'Linear OAuth not configured' }, 500);
  }

  // Scopes for Linear
  const scopes = ['read', 'write'].join(',');

  const authUrl = new URL('https://linear.app/oauth/authorize');
  authUrl.searchParams.append('client_id', CLIENT_ID);
  authUrl.searchParams.append('scope', scopes);
  authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.append('state', Math.random().toString(36).substring(7));
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('actor', 'user');

  return c.redirect(authUrl.toString());
}

/**
 * Handle Linear OAuth callback
 */
export async function handleLinearCallback(c: Context) {
  const code = c.req.query('code');
  if (!code) {
    return c.json({ error: 'No code provided' }, 400);
  }

  try {
    const response = await fetch('https://api.linear.app/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    const data = await response.json() as any;
    
    if (data.error) {
      return c.json({ error: data.error, description: data.error_description }, 400);
    }

    return c.json({
      message: 'Linear connected successfully',
      access_token: data.access_token as string,
      expires_in: data.expires_in as number,
      scope: data.scope as string[]
    });
  } catch (error) {
    logger.error('[Linear Auth] Callback error:', error as Error);
    return c.json({ error: 'Failed to exchange code for token' }, 500);
  }
}
