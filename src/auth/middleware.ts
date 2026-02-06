/**
 * Shared Authentication Middleware
 *
 * Provides a unified auth middleware that supports:
 * - Cookie-based sessions (glinr_session)
 * - API token authentication (Authorization: Bearer glinr_...)
 *
 * Applied globally to /api/* routes with configurable exclusions.
 */

import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { validateSession, type User } from './auth-service.js';
import { validateToken, hasScope, type TokenScope } from './api-tokens.js';

/** Routes that don't require authentication */
const PUBLIC_ROUTES = [
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/github',
  '/api/auth/github/callback',
  '/api/auth/github/url',
  '/api/auth/github/token',
  '/api/auth/jira',
  '/api/auth/jira/callback',
  '/api/auth/linear',
  '/api/auth/linear/callback',
  '/api/setup',
  '/health',
  '/auth',
];

/** Route prefixes that don't require authentication */
const PUBLIC_PREFIXES = [
  '/api/setup/',
  '/api/auth/github/',
  '/api/auth/jira/',
  '/api/auth/linear/',
  '/auth/',
  // Webhook routes use their own signature verification
  '/webhooks/',
  // Messaging channels have their own auth (bot tokens, signatures)
  '/api/telegram/',
  '/api/whatsapp/',
  '/api/discord/',
];

function isPublicRoute(path: string): boolean {
  // Exact matches
  if (PUBLIC_ROUTES.includes(path)) return true;

  // Prefix matches
  for (const prefix of PUBLIC_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }

  return false;
}

/**
 * Unified auth middleware for all API routes.
 *
 * Checks authentication via:
 * 1. Cookie-based session (glinr_session)
 * 2. API token (Authorization: Bearer glinr_...)
 *
 * Sets `user` and optionally `apiToken` in the context.
 */
export function authMiddleware() {
  return async (c: Context, next: Next) => {
    const path = c.req.path;

    // Skip auth for public routes
    if (isPublicRoute(path)) {
      return next();
    }

    // Skip non-API routes (static assets, root info, etc.)
    if (!path.startsWith('/api/') && !path.startsWith('/api')) {
      return next();
    }

    // Try cookie-based session first
    const sessionToken = getCookie(c, 'glinr_session');
    if (sessionToken) {
      const user = await validateSession(sessionToken);
      if (user) {
        c.set('user', user);
        return next();
      }
    }

    // Try API token authentication
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer glinr_')) {
      const token = authHeader.slice(7);
      const result = await validateToken(token);

      if (result.valid && result.token) {
        c.set('apiToken', result.token);
        // API token requests don't have a user context by default
        // but they are authenticated
        c.set('authType', 'api_token');
        return next();
      }
    }

    // Also allow Bearer with non-glinr tokens to pass through
    // for device/CLI auth that may use different token formats
    if (authHeader?.startsWith('Bearer ') && !authHeader.startsWith('Bearer glinr_')) {
      // Let the specific route handler validate this token type
      return next();
    }

    // No valid authentication found
    return c.json({ error: 'Authentication required' }, 401);
  };
}

/**
 * Scope-checking middleware for API token routes.
 * Use after authMiddleware to require specific scopes.
 */
export function requireScope(...scopes: TokenScope[]) {
  return async (c: Context, next: Next) => {
    const apiToken = c.get('apiToken');

    if (!apiToken) {
      // Session-based users have full access
      if (c.get('user')) return next();
      return c.json({ error: 'Authentication required' }, 401);
    }

    for (const scope of scopes) {
      if (!hasScope(apiToken, scope)) {
        return c.json({ error: `Missing required scope: ${scope}` }, 403);
      }
    }

    return next();
  };
}

/**
 * Helper to get the authenticated user from context.
 * Returns null if not authenticated via session.
 */
export function getAuthUser(c: Context): User | null {
  return c.get('user') || null;
}
