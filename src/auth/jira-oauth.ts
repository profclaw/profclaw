import type { Context } from 'hono';
import { logger } from '../utils/logger.js';

interface JiraOAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

interface JiraAccessibleResource {
  id: string;
  name: string;
  url: string;
}

const CLIENT_ID = process.env.JIRA_CLIENT_ID || '';
const CLIENT_SECRET = process.env.JIRA_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.JIRA_REDIRECT_URI || '';

/**
 * Redirect user to Atlassian (Jira) for authorization
 */
export async function redirectToJira(c: Context) {
  if (!CLIENT_ID || !REDIRECT_URI) {
    return c.json({ error: 'Jira OAuth not configured' }, 500);
  }

  // Scopes for Jira: read and write issues
  const scopes = [
    'read:jira-work',
    'write:jira-work',
    'read:jira-user',
    'offline_access'
  ].join(' ');

  const authUrl = new URL('https://auth.atlassian.com/authorize');
  authUrl.searchParams.append('audience', 'api.atlassian.com');
  authUrl.searchParams.append('client_id', CLIENT_ID);
  authUrl.searchParams.append('scope', scopes);
  authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.append('state', Math.random().toString(36).substring(7));
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('prompt', 'consent');

  return c.redirect(authUrl.toString());
}

/**
 * Handle Atlassian OAuth callback
 */
export async function handleJiraCallback(c: Context) {
  const code = c.req.query('code');
  if (!code) {
    return c.json({ error: 'No code provided' }, 400);
  }

  try {
    const response = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    const data = await response.json() as JiraOAuthTokenResponse;
    
    if (data.error) {
      return c.json({ error: data.error, description: data.error_description }, 400);
    }

    // After getting the token, we usually need to call /oauth/token/accessible-resources
    // to find the cloudId of the Jira site they authorized
    const resourcesResponse = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
      headers: { 'Authorization': `Bearer ${data.access_token}` },
    });
    const resources = await resourcesResponse.json() as JiraAccessibleResource[];

    return c.json({
      message: 'Jira connected successfully',
      access_token: data.access_token as string,
      refresh_token: data.refresh_token as string,
      sites: resources.map(r => ({
        id: r.id, // cloudId
        name: r.name,
        url: r.url
      }))
    });
  } catch (error) {
    logger.error('[Jira Auth] Callback error:', error as Error);
    return c.json({ error: 'Failed to exchange code for token' }, 500);
  }
}
