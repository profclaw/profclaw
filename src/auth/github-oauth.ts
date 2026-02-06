import { Context } from 'hono';
import { getGitHubOAuthConfig } from '../settings/index.js';

/**
 * Redirect user to GitHub for OAuth
 */
export async function redirectToGitHub(c: Context) {
  const config = await getGitHubOAuthConfig();
  if (!config?.clientId) {
    return c.json({ error: 'GitHub OAuth not configured' }, 500);
  }

  const state = Math.random().toString(36).substring(7);
  // Store state in session/cookie if needed for CSRF protection

  const url = `https://github.com/login/oauth/authorize?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(config.redirectUri)}&scope=repo,user,workflow&state=${state}`;

  return c.redirect(url);
}

/**
 * Handle GitHub OAuth callback
 */
export async function handleGitHubCallback(c: Context) {
  const code = c.req.query('code');
  const state = c.req.query('state');

  const config = await getGitHubOAuthConfig();
  if (!config?.clientId || !config?.clientSecret) {
    return c.json({ error: 'GitHub OAuth not configured' }, 500);
  }

  if (!code) {
    return c.json({ error: 'No code provided' }, 400);
  }

  try {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.redirectUri,
      }),
    });

    const data = await response.json() as any;

    if (data.error) {
      return c.json({ error: data.error, description: data.error_description }, 400);
    }

    // In a real app, we would store this token in a database linked to the user
    // For now, we'll return it so the user can see it works
    return c.json({
      message: 'GitHub connected successfully',
      access_token: data.access_token as string,
      scope: data.scope as string,
    });
  } catch (error) {
    console.error('[GitHub Auth] Callback error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}
