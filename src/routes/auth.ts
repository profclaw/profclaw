/**
 * Authentication Routes
 *
 * Handles user authentication:
 * - Email/Password signup & signin
 * - GitHub OAuth login
 * - Session management (logout)
 * - Current user info
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import {
  signUpWithEmail,
  signInWithEmail,
  signInWithGitHub,
  validateSession,
  deleteSession,
  createSession,
  getGitHubAuthUrl,
  updateUser,
  getUserConnectedAccounts,
  getUserGitHubToken,
  type User,
} from '../auth/auth-service.js';
import {
  redirectToJira,
  handleJiraCallback,
} from '../auth/jira-oauth.js';
import {
  redirectToLinear,
  handleLinearCallback,
} from '../auth/linear-oauth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { validatePasswordStrength, hashInviteCode, hashPassword, verifyPassword } from '../auth/password.js';
import { getSettingsRaw, updateSettings } from '../settings/index.js';
import { getDb } from '../storage/index.js';
import { inviteCodes, users } from '../storage/schema.js';
import { invalidateLocalAdminCache } from '../auth/middleware.js';
import { createContextualLogger } from '../utils/logger.js';

// RATE LIMITERS

const loginLimiter = rateLimit({ windowMs: 60_000, max: 10, message: 'Too many login attempts. Try again in a minute.' });
const signupLimiter = rateLimit({ windowMs: 60_000, max: 5, message: 'Too many signup attempts. Try again in a minute.' });

// VALIDATION SCHEMAS

const signupSchema = z.object({
  email: z.string().email('Invalid email address').max(255),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128)
    .refine((p) => validatePasswordStrength(p) === null, {
      message: 'Password must contain at least one letter and one number',
    }),
  name: z.string().min(1, 'Name is required').max(100).trim(),
  inviteCode: z.string().max(50).optional(),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address').max(255),
  password: z.string().min(1, 'Password is required').max(128),
});

const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  avatarUrl: z.string().url().max(500).optional(),
  bio: z.string().max(500).optional(),
  timezone: z.string().max(50).optional(),
  locale: z.string().max(10).optional(),
  onboardingCompleted: z.boolean().optional(),
});

const accessKeySchema = z.object({
  key: z.string().min(1, 'Access key is required').max(128),
});

const setAccessKeySchema = z.object({
  key: z.string().max(128).nullable(),
});

type AuthVariables = {
  user: User;
};

export const authRoutes = new Hono<{ Variables: AuthVariables }>();
const log = createContextualLogger('AuthRoutes');

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 30 * 24 * 60 * 60, // 30 days
  path: '/',
};

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

// EMAIL/PASSWORD AUTH

/**
 * POST /api/auth/signup
 * Create new account with email/password
 */
authRoutes.post('/signup', signupLimiter, async (c) => {
  try {
    const parsedBody = await parseJsonBody(c);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const parsed = signupSchema.safeParse(parsedBody.body);

    if (!parsed.success) {
      const firstError = parsed.error.errors[0]?.message || 'Invalid input';
      return c.json({ error: firstError }, 400);
    }

    const { email, password, name, inviteCode } = parsed.data;

    // Check registration mode
    const settings = await getSettingsRaw();
    const mode = settings.system.registrationMode;

    // Allow first user signup without invite code (bootstrap admin)
    const db = getDb();
    let isFirstUser = false;
    if (db) {
      const existingUsers = await db.select({ id: users.id }).from(users).limit(1);
      isFirstUser = existingUsers.length === 0;
    }

    let inviteRecord: { id: string } | undefined;

    if (mode === 'invite' && !isFirstUser) {
      if (!inviteCode) {
        return c.json({ error: 'Registration requires an invite code' }, 403);
      }

      const db = getDb();
      if (!db) {
        return c.json({ error: 'Database not initialized' }, 500);
      }

      const codeHash = hashInviteCode(inviteCode);
      const records = await db
        .select()
        .from(inviteCodes)
        .where(eq(inviteCodes.codeHash, codeHash))
        .limit(1);

      if (!records.length) {
        return c.json({ error: 'Invalid invite code' }, 400);
      }

      const record = records[0];

      if (record.usedBy) {
        return c.json({ error: 'Invite code already used' }, 400);
      }

      if (record.expiresAt && new Date() > new Date(record.expiresAt)) {
        return c.json({ error: 'Invite code has expired' }, 400);
      }

      inviteRecord = { id: record.id };
    }

    const result = await signUpWithEmail(email, password, name);

    if (!result.success || !result.session) {
      return c.json({ error: result.error || 'Signup failed' }, 400);
    }

    // Mark invite code as used
    if (inviteRecord && result.user) {
      const db = getDb();
      if (db) {
        await db
          .update(inviteCodes)
          .set({ usedBy: result.user.id, usedAt: new Date() })
          .where(eq(inviteCodes.id, inviteRecord.id));
      }
    }

    // Set session cookie
    setCookie(c, 'profclaw_session', result.session.token, COOKIE_OPTIONS);

    return c.json({
      user: result.user,
      message: 'Account created successfully',
    });
  } catch (error) {
    log.error('Signup error', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Signup failed' }, 500);
  }
});

/**
 * POST /api/auth/login
 * Sign in with email/password
 */
authRoutes.post('/login', loginLimiter, async (c) => {
  try {
    const parsedBody = await parseJsonBody(c);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const parsed = loginSchema.safeParse(parsedBody.body);

    if (!parsed.success) {
      const firstError = parsed.error.errors[0]?.message || 'Invalid input';
      return c.json({ error: firstError }, 400);
    }

    const { email, password } = parsed.data;
    const result = await signInWithEmail(email, password);

    if (!result.success || !result.session) {
      return c.json({ error: result.error || 'Login failed' }, 401);
    }

    // Set session cookie
    setCookie(c, 'profclaw_session', result.session.token, COOKIE_OPTIONS);

    return c.json({
      user: result.user,
      message: 'Logged in successfully',
    });
  } catch (error) {
    log.error('Login error', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Login failed' }, 500);
  }
});

/**
 * POST /api/auth/logout
 * Sign out and invalidate session
 */
authRoutes.post('/logout', async (c) => {
  try {
    const token = getCookie(c, 'profclaw_session');

    if (token) {
      await deleteSession(token);
      deleteCookie(c, 'profclaw_session', { path: '/' });
    }

    return c.json({ message: 'Logged out successfully' });
  } catch (error) {
    log.error('Logout error', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Logout failed' }, 500);
  }
});

// GITHUB OAUTH

/**
 * GET /api/auth/github
 * Redirect to GitHub OAuth
 */
authRoutes.get('/github', async (c) => {
  const state = Math.random().toString(36).substring(7);
  const url = await getGitHubAuthUrl(state);

  if (!url) {
    return c.json({ error: 'GitHub OAuth not configured' }, 500);
  }

  // Store state for CSRF protection (in production, use a more secure method)
  setCookie(c, 'github_oauth_state', state, {
    ...COOKIE_OPTIONS,
    maxAge: 600, // 10 minutes
  });

  return c.redirect(url);
});

/**
 * GET /api/auth/github/callback
 * Handle GitHub OAuth callback
 */
authRoutes.get('/github/callback', async (c) => {
  try {
    const code = c.req.query('code');
    const state = c.req.query('state');
    const storedState = getCookie(c, 'github_oauth_state');

    // Clean up state cookie
    deleteCookie(c, 'github_oauth_state', { path: '/' });

    if (!code) {
      return c.redirect('/login?error=no_code');
    }

    // CSRF check
    if (state !== storedState) {
      return c.redirect('/login?error=invalid_state');
    }

    const result = await signInWithGitHub(code);

    if (!result.success || !result.session) {
      return c.redirect(`/login?error=${encodeURIComponent(result.error || 'auth_failed')}`);
    }

    // Set session cookie
    setCookie(c, 'profclaw_session', result.session.token, COOKIE_OPTIONS);

    // Redirect to dashboard or onboarding
    if (!result.user?.onboardingCompleted) {
      return c.redirect('/onboarding');
    }

    return c.redirect('/');
  } catch (error) {
    log.error('GitHub callback error', error instanceof Error ? error : new Error(String(error)));
    return c.redirect('/login?error=callback_failed');
  }
});

/**
 * GET /api/auth/github/url
 * Get GitHub OAuth URL (for SPA apps)
 */
authRoutes.get('/github/url', async (c) => {
  const state = Math.random().toString(36).substring(7);
  const url = await getGitHubAuthUrl(state);

  if (!url) {
    return c.json({ error: 'GitHub OAuth not configured' }, 500);
  }

  return c.json({ url, state });
});

/**
 * POST /api/auth/github/token
 * Exchange code for session (for SPA apps)
 */
authRoutes.post('/github/token', async (c) => {
  try {
    const parsed = await parseJsonBody(c);
    if (!parsed.ok) {
      return parsed.response;
    }

    const code = typeof parsed.body.code === 'string' ? parsed.body.code : undefined;

    if (!code) {
      return c.json({ error: 'Code is required' }, 400);
    }

    const result = await signInWithGitHub(code);

    if (!result.success || !result.session) {
      return c.json({ error: result.error || 'Authentication failed' }, 401);
    }

    // Set session cookie
    setCookie(c, 'profclaw_session', result.session.token, COOKIE_OPTIONS);

    return c.json({
      user: result.user,
      message: 'Logged in with GitHub successfully',
    });
  } catch (error) {
    log.error('GitHub token exchange error', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Authentication failed' }, 500);
  }
});

// SESSION & USER

/**
 * GET /api/auth/me
 * Get current authenticated user
 */
authRoutes.get('/me', async (c) => {
  try {
    // Check if user was injected by local-mode middleware bypass
    const localUser = c.get('user');
    const settings = await getSettingsRaw();
    const authMode = settings.system.authMode;

    if (localUser && authMode === 'local') {
      return c.json({
        authenticated: true,
        authMode,
        user: localUser,
      });
    }

    const token = getCookie(c, 'profclaw_session');

    // In local mode with access key set but no valid session
    if (authMode === 'local' && settings.system.accessKeyHash) {
      if (!token) {
        return c.json({
          authenticated: false,
          authMode,
          accessKeyRequired: true,
        }, 401);
      }
      const user = await validateSession(token);
      if (!user) {
        deleteCookie(c, 'profclaw_session', { path: '/' });
        return c.json({
          authenticated: false,
          authMode,
          accessKeyRequired: true,
        }, 401);
      }
      return c.json({
        authenticated: true,
        authMode,
        user,
      });
    }

    if (!token) {
      return c.json({ authenticated: false, authMode }, 401);
    }

    const user = await validateSession(token);

    if (!user) {
      deleteCookie(c, 'profclaw_session', { path: '/' });
      return c.json({ authenticated: false, authMode }, 401);
    }

    // Get connected accounts
    const connectedAccounts = await getUserConnectedAccounts(user.id);

    // Check if has GitHub token
    const hasGitHubToken = !!(await getUserGitHubToken(user.id));

    return c.json({
      authenticated: true,
      authMode,
      user: {
        ...user,
        connectedAccounts,
        hasGitHubToken,
      },
    });
  } catch (error) {
    log.error('Get user error', error instanceof Error ? error : new Error(String(error)));
    return c.json({ authenticated: false }, 500);
  }
});

/**
 * PATCH /api/auth/me
 * Update current user profile
 */
authRoutes.patch('/me', async (c) => {
  try {
    const token = getCookie(c, 'profclaw_session');

    if (!token) {
      return c.json({ error: 'Not authenticated' }, 401);
    }

    const user = await validateSession(token);

    if (!user) {
      return c.json({ error: 'Invalid session' }, 401);
    }

    const parsedBody = await parseJsonBody(c);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const parsed = updateProfileSchema.safeParse(parsedBody.body);

    if (!parsed.success) {
      const firstError = parsed.error.errors[0]?.message || 'Invalid input';
      return c.json({ error: firstError }, 400);
    }

    const updatedUser = await updateUser(user.id, parsed.data);

    return c.json({ user: updatedUser });
  } catch (error) {
    log.error('Update user error', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Update failed' }, 500);
  }
});

// ACCESS KEY (local mode protection)

/**
 * POST /api/auth/verify-access-key
 * Verify access key and create session (public route, rate limited)
 */
authRoutes.post('/verify-access-key', loginLimiter, async (c) => {
  try {
    const settings = await getSettingsRaw();

    if (settings.system.authMode !== 'local' || !settings.system.accessKeyHash) {
      return c.json({ error: 'Access key not configured' }, 400);
    }

    const parsedBody = await parseJsonBody(c);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const parsed = accessKeySchema.safeParse(parsedBody.body);
    if (!parsed.success) {
      return c.json({ error: 'Access key is required' }, 400);
    }

    const { key } = parsed.data;
    const result = verifyPassword(key, settings.system.accessKeyHash);

    if (!result.valid) {
      return c.json({ error: 'Invalid access key' }, 401);
    }

    // Find admin user to create session
    const db = getDb();
    if (!db) {
      return c.json({ error: 'Database not initialized' }, 500);
    }

    const admins = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'admin'))
      .limit(1);

    if (admins.length === 0) {
      return c.json({ error: 'No admin user found' }, 500);
    }

    const session = await createSession(admins[0].id);
    setCookie(c, 'profclaw_session', session.token, COOKIE_OPTIONS);

    return c.json({ success: true, message: 'Access verified' });
  } catch (error) {
    log.error('Access key verification error', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Verification failed' }, 500);
  }
});

/**
 * PUT /api/auth/access-key
 * Set or remove access key (protected, admin only)
 */
authRoutes.put('/access-key', async (c) => {
  try {
    const user = c.get('user') as User | undefined;
    if (!user || user.role !== 'admin') {
      return c.json({ error: 'Admin access required' }, 403);
    }

    const settings = await getSettingsRaw();
    if (settings.system.authMode !== 'local') {
      return c.json({ error: 'Access key is only available in local mode' }, 400);
    }

    const parsedBody = await parseJsonBody(c);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const parsed = setAccessKeySchema.safeParse(parsedBody.body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid input' }, 400);
    }

    const { key } = parsed.data;
    const accessKeyHash = key ? hashPassword(key) : undefined;

    await updateSettings({
      system: { ...settings.system, accessKeyHash },
    });

    // Invalidate admin cache so middleware picks up the change
    invalidateLocalAdminCache();

    return c.json({
      success: true,
      hasAccessKey: Boolean(accessKeyHash),
      message: key ? 'Access key set' : 'Access key removed',
    });
  } catch (error) {
    log.error('Access key update error', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to update access key' }, 500);
  }
});

// OTHER OAUTH PROVIDERS (preserved from original)

// Jira OAuth
authRoutes.get('/jira', (c) => redirectToJira(c));
authRoutes.get('/jira/callback', (c) => handleJiraCallback(c));

// Linear OAuth
authRoutes.get('/linear', (c) => redirectToLinear(c));
authRoutes.get('/linear/callback', (c) => handleLinearCallback(c));
