/**
 * Shared Authentication Middleware
 *
 * Provides a unified auth middleware that supports:
 * - Cookie-based sessions (profclaw_session)
 * - API token authentication (Authorization: Bearer profclaw_...)
 *
 * Applied globally to /api/* routes with configurable exclusions.
 */

import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { validateSession, type User } from './auth-service.js';
import { validateToken, hasScope, type TokenScope } from './api-tokens.js';
import { getSettingsRaw } from '../settings/index.js';
import { getDb } from '../storage/index.js';
import { users } from '../storage/schema.js';
import { eq } from 'drizzle-orm';

// Cached admin user for local-mode bypass (avoids DB query per request)
let cachedLocalAdmin: User | null = null;
let cachedLocalAdminExpiry = 0;
const LOCAL_ADMIN_CACHE_TTL = 60_000; // 60s

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
  '/api/auth/verify-access-key',
  '/api/setup',
  '/health',
  '/auth',
];

/** Route prefixes that don't require authentication */
const PUBLIC_PREFIXES = [
  '/api/setup/',
  '/api/oobe/',
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
 * 1. Cookie-based session (profclaw_session)
 * 2. API token (Authorization: Bearer profclaw_...)
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

    // Local-mode bypass: auto-inject admin user when authMode is 'local'
    // Skip auto-inject if an access key is set (require session cookie instead)
    try {
      const settings = await getSettingsRaw();
      if (settings.system.authMode === 'local' && !settings.system.accessKeyHash) {
        const now = Date.now();
        if (!cachedLocalAdmin || now > cachedLocalAdminExpiry) {
          const db = getDb();
          if (db) {
            const admins = await db
              .select()
              .from(users)
              .where(eq(users.role, 'admin'))
              .limit(1);
            if (admins.length > 0) {
              const admin = admins[0];
              cachedLocalAdmin = {
                id: admin.id,
                email: admin.email,
                name: admin.name ?? 'Owner',
                role: admin.role as 'admin',
                status: admin.status as 'active',
                createdAt: admin.createdAt ?? new Date(),
                onboardingCompleted: admin.onboardingCompleted ?? true,
              };
              cachedLocalAdminExpiry = now + LOCAL_ADMIN_CACHE_TTL;
            }
          }
        }
        if (cachedLocalAdmin) {
          c.set('user', cachedLocalAdmin);
          return next();
        }
      }
    } catch {
      // Fall through to normal auth if settings read fails
    }

    // Try cookie-based session first
    const sessionToken = getCookie(c, 'profclaw_session');
    if (sessionToken) {
      const user = await validateSession(sessionToken);
      if (user) {
        c.set('user', user);
        return next();
      }
    }

    // Try API token authentication
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer profclaw_')) {
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

    // Also allow Bearer with non-profclaw tokens to pass through
    // for device/CLI auth that may use different token formats
    if (authHeader?.startsWith('Bearer ') && !authHeader.startsWith('Bearer profclaw_')) {
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

/**
 * Invalidate cached local admin user.
 * Call when authMode changes or admin user is updated.
 */
export function invalidateLocalAdminCache(): void {
  cachedLocalAdmin = null;
  cachedLocalAdminExpiry = 0;
}
