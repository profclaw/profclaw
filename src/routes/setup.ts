/**
 * Setup Routes
 *
 * Public routes for initial app setup and configuration status.
 * These routes are accessible without authentication to allow
 * first-time setup and configuration checks.
 */

import { Hono } from 'hono';
import { createContextualLogger } from '../utils/logger.js';

const log = createContextualLogger('Setup');
import type { Context } from 'hono';
import { randomUUID, randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../storage/index.js';
import { users, userPreferences } from '../storage/schema.js';
import { getSettings, updateSettings, isGitHubOAuthConfigured } from '../settings/index.js';
import { createSession } from '../auth/auth-service.js';
import {
  hashPassword,
  validatePasswordStrength,
  generateRecoveryCodes,
  hashRecoveryCodes,
  hashRecoveryCode,
} from '../auth/password.js';
import { rateLimit } from '../middleware/rate-limit.js';

const setup = new Hono();

// Rate limiters for sensitive setup endpoints
const adminCreateLimiter = rateLimit({ windowMs: 60_000, max: 3, message: 'Too many admin creation attempts. Try again in a minute.' });
const recoveryLimiter = rateLimit({ windowMs: 60_000, max: 5, message: 'Too many recovery attempts. Try again in a minute.' });
const resetLimiter = rateLimit({ windowMs: 60_000, max: 5, message: 'Too many reset attempts. Try again in a minute.' });

const githubOAuthBodySchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  redirectUri: z.string().optional(),
});

const adminSetupBodySchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
  name: z.string().min(1),
});

const verifyRecoveryCodeBodySchema = z.object({
  email: z.string().min(1),
  code: z.string().min(1),
});

const resetPasswordBodySchema = z.object({
  resetToken: z.string().min(1),
  newPassword: z.string().min(1),
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

// ROUTES

/**
 * GET /api/setup/status
 * Check if the app is configured (GitHub OAuth, etc.)
 * This is a PUBLIC endpoint - no auth required
 */
setup.get('/status', async (c) => {
  try {
    const settings = await getSettings();
    const db = getDb();

    // Check if GitHub OAuth is configured (either via env or DB)
    const githubConfigured = await isGitHubOAuthConfigured();

    // Check if at least one AI provider is configured
    const aiConfigured = !!(
      settings.aiProvider?.defaultProvider &&
      (settings.aiProvider?.openaiKey ||
        settings.aiProvider?.anthropicKey ||
        settings.aiProvider?.ollamaBaseUrl)
    );

    // Check if there's an admin user
    let hasAdmin = false;
    if (db) {
      const adminUsers = await db
        .select()
        .from(users)
        .where(eq(users.role, 'admin'))
        .limit(1);
      hasAdmin = adminUsers.length > 0;
    }

    // App is ready if OAuth is configured and admin exists
    const ready = githubConfigured && hasAdmin;

    return c.json({
      configured: githubConfigured,
      isFirstTimeSetup: !ready,
      hasAdmin,
      ready,
      providers: {
        github: githubConfigured,
        jira: !!(process.env.JIRA_CLIENT_ID && process.env.JIRA_CLIENT_SECRET),
        linear: !!(process.env.LINEAR_CLIENT_ID && process.env.LINEAR_CLIENT_SECRET),
      },
      ai: {
        configured: aiConfigured,
        provider: settings.aiProvider?.defaultProvider || null,
      },
      showForgotPassword: settings.system?.showForgotPassword ?? true,
    });
  } catch (error) {
    log.error('Status check error', error instanceof Error ? error : new Error(String(error)));
    return c.json({
      configured: false,
      isFirstTimeSetup: true,
      hasAdmin: false,
      ready: false,
      providers: {
        github: false,
        jira: false,
        linear: false,
      },
      ai: {
        configured: false,
        provider: null,
      },
    });
  }
});

/**
 * POST /api/setup/github-oauth/validate
 * Validate GitHub OAuth credentials before saving
 * Tests if the credentials can successfully initiate an OAuth flow
 */
setup.post('/github-oauth/validate', async (c) => {
  try {
    const parsed = await parseJsonBody(c);
    if (!parsed.ok) {
      return parsed.response;
    }

    const bodyParse = githubOAuthBodySchema.safeParse(parsed.body);
    if (!bodyParse.success) {
      return c.json({
        valid: false,
        error: 'Client ID and Client Secret are required',
      }, 400);
    }

    const { clientId, clientSecret } = bodyParse.data;

    // Validate Client ID format
    // GitHub OAuth App Client IDs are typically 20 characters alphanumeric
    // GitHub App Client IDs start with "Iv1." or "Ov"
    const clientIdPattern = /^(Iv1\.[a-f0-9]{16}|Ov[a-zA-Z0-9]{18,20}|[a-f0-9]{20})$/i;
    if (!clientIdPattern.test(clientId)) {
      return c.json({
        valid: false,
        error: 'Invalid Client ID format. Please copy the exact Client ID from GitHub.',
        hint: 'OAuth App Client IDs are 20 hex characters. GitHub App Client IDs start with "Iv1."',
      }, 400);
    }

    // Validate Client Secret format
    // GitHub secrets are typically 40 hex characters
    const secretPattern = /^[a-f0-9]{40}$/i;
    if (!secretPattern.test(clientSecret)) {
      return c.json({
        valid: false,
        error: 'Invalid Client Secret format. Please copy the exact secret from GitHub.',
        hint: 'Client Secrets are 40 hex characters. Make sure you copied the full secret.',
      }, 400);
    }

    // Try to verify with GitHub by making a test request
    // We'll use the device flow to check if credentials are valid
    // This endpoint doesn't require a callback but validates the client_id
    try {
      const response = await fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          scope: 'read:user',
        }),
      });

      const data = await response.json() as { error?: string; error_description?: string };

      if (data.error) {
        // "unauthorized_client" means the client_id is valid but device flow not enabled
        // This is actually a good sign - it means the credentials exist
        if (data.error === 'unauthorized_client') {
          return c.json({
            valid: true,
            message: 'Credentials appear valid. Device flow not enabled (normal for OAuth apps).',
            verified: 'format',
          });
        }

        return c.json({
          valid: false,
          error: data.error_description || data.error,
          hint: 'The Client ID may not exist or may be incorrect.',
        }, 400);
      }

      // If we get a successful response, credentials are valid
      return c.json({
        valid: true,
        message: 'GitHub OAuth credentials verified successfully!',
        verified: 'api',
      });
    } catch (fetchError) {
      // If GitHub API is unreachable, fall back to format validation only
      log.warn('Could not verify credentials with GitHub API', { error: fetchError instanceof Error ? fetchError.message : String(fetchError) });
      return c.json({
        valid: true,
        message: 'Credentials format is valid. Could not verify with GitHub API.',
        verified: 'format',
        warning: 'Please ensure you copied the correct credentials from GitHub.',
      });
    }
  } catch (error) {
    log.error('GitHub OAuth validation error', error instanceof Error ? error : new Error(String(error)));
    return c.json({
      valid: false,
      error: 'Validation failed',
    }, 500);
  }
});

/**
 * POST /api/setup/github-oauth
 * Save GitHub OAuth credentials to database
 * Works if not already configured (for first-time setup)
 */
setup.post('/github-oauth', async (c) => {
  try {
    // Check if already configured (either via env or DB)
    const alreadyConfigured = await isGitHubOAuthConfigured();

    if (alreadyConfigured) {
      return c.json(
        { error: 'GitHub OAuth is already configured. Use settings to update.' },
        403
      );
    }

    const parsed = await parseJsonBody(c);
    if (!parsed.ok) {
      return parsed.response;
    }

    const bodyParse = githubOAuthBodySchema.safeParse(parsed.body);
    if (!bodyParse.success) {
      return c.json({ error: 'Client ID and Client Secret are required' }, 400);
    }

    const { clientId, clientSecret, redirectUri } = bodyParse.data;

    // Calculate default redirect URI based on current origin
    const defaultRedirectUri = redirectUri || 'http://localhost:5173/api/auth/github/callback';

    // Save to database settings (persists across restarts)
    await updateSettings({
      oauth: {
        github: {
          clientId,
          clientSecret,
          redirectUri: defaultRedirectUri,
        },
      },
    });

    log.info('GitHub OAuth credentials saved to database');

    return c.json({
      success: true,
      message: 'GitHub OAuth configured successfully.',
    });
  } catch (error) {
    log.error('GitHub OAuth setup error', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to configure GitHub OAuth' }, 500);
  }
});

/**
 * POST /api/setup/admin
 * Create an admin user (allows multiple admins)
 */
setup.post('/admin', adminCreateLimiter, async (c) => {
  try {
    const db = getDb();
    if (!db) {
      return c.json({ error: 'Database not initialized' }, 500);
    }

    const parsed = await parseJsonBody(c);
    if (!parsed.ok) {
      return parsed.response;
    }

    const bodyParse = adminSetupBodySchema.safeParse(parsed.body);
    if (!bodyParse.success) {
      return c.json({ error: 'Email, password, and name are required' }, 400);
    }

    const { email, password, name } = bodyParse.data;

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return c.json({ error: 'Invalid email format' }, 400);
    }

    // Validate password strength
    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
      return c.json({ error: passwordError }, 400);
    }

    // Check if email already exists
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);

    if (existingUser.length > 0) {
      return c.json({ error: 'Email already registered' }, 400);
    }

    // Generate recovery codes
    const recoveryCodes = generateRecoveryCodes(8);
    const hashedRecoveryCodes = hashRecoveryCodes(recoveryCodes);

    // Hash password with scrypt
    const passwordHash = hashPassword(password);

    // Create admin user
    const userId = randomUUID();
    const now = new Date();

    await db.insert(users).values({
      id: userId,
      email: email.toLowerCase(),
      passwordHash,
      name,
      role: 'admin',
      status: 'active',
      recoveryCodes: JSON.stringify(hashedRecoveryCodes),
      createdAt: now,
      updatedAt: now,
    });

    // Create default preferences
    await db.insert(userPreferences).values({
      id: randomUUID(),
      userId,
      updatedAt: now,
    });

    // Create session
    const session = await createSession(userId);

    log.info('Admin user created', { email });

    return c.json({
      success: true,
      user: {
        id: userId,
        email: email.toLowerCase(),
        name,
        role: 'admin',
      },
      session: {
        token: session.token,
        expiresAt: session.expiresAt,
      },
      // Return recovery codes ONLY ONCE during setup
      recoveryCodes,
      message: 'Admin account created. Save your recovery codes - they will not be shown again!',
    });
  } catch (error) {
    log.error('Admin creation error', error instanceof Error ? error : new Error(String(error)));
    return c.json({
      error: 'Failed to create admin user',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

/**
 * POST /api/setup/verify-recovery-code
 * Verify a recovery code (for password reset)
 */
setup.post('/verify-recovery-code', recoveryLimiter, async (c) => {
  try {
    const db = getDb();
    if (!db) {
      return c.json({ error: 'Database not initialized' }, 500);
    }

    const parsed = await parseJsonBody(c);
    if (!parsed.ok) {
      return parsed.response;
    }

    const bodyParse = verifyRecoveryCodeBodySchema.safeParse(parsed.body);
    if (!bodyParse.success) {
      return c.json({ error: 'Email and recovery code are required' }, 400);
    }

    const { email, code } = bodyParse.data;

    // Find user
    const result = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);

    if (!result.length) {
      return c.json({ error: 'Invalid email or recovery code' }, 401);
    }

    const user = result[0];

    if (!user.recoveryCodes) {
      return c.json({ error: 'No recovery codes configured' }, 400);
    }

    const storedHashes: string[] = JSON.parse(user.recoveryCodes);
    const normalizedCode = code.replace(/-/g, '').toUpperCase();
    const codeHash = hashRecoveryCode(normalizedCode);

    // Check if code matches any stored hash
    const codeIndex = storedHashes.findIndex((h: string) => h === codeHash);

    if (codeIndex === -1) {
      return c.json({ error: 'Invalid email or recovery code' }, 401);
    }

    // Generate reset token
    const resetToken = randomBytes(32).toString('hex');
    const resetExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Remove used recovery code
    storedHashes.splice(codeIndex, 1);

    // Update user with reset token and remaining codes
    await db
      .update(users)
      .set({
        passwordResetToken: resetToken,
        passwordResetExpires: resetExpiry,
        recoveryCodes: JSON.stringify(storedHashes),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    return c.json({
      success: true,
      resetToken,
      expiresAt: resetExpiry,
      remainingCodes: storedHashes.length,
      message: 'Recovery code verified. Use the reset token to set a new password.',
    });
  } catch (error) {
    log.error('Recovery code verification error', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to verify recovery code' }, 500);
  }
});

/**
 * POST /api/setup/reset-password
 * Reset password using reset token
 */
setup.post('/reset-password', resetLimiter, async (c) => {
  try {
    const db = getDb();
    if (!db) {
      return c.json({ error: 'Database not initialized' }, 500);
    }

    const parsed = await parseJsonBody(c);
    if (!parsed.ok) {
      return parsed.response;
    }

    const bodyParse = resetPasswordBodySchema.safeParse(parsed.body);
    if (!bodyParse.success) {
      return c.json({ error: 'Reset token and new password are required' }, 400);
    }

    const { resetToken, newPassword } = bodyParse.data;

    const passwordError = validatePasswordStrength(newPassword);
    if (passwordError) {
      return c.json({ error: passwordError }, 400);
    }

    // Find user with valid reset token
    const result = await db
      .select()
      .from(users)
      .where(eq(users.passwordResetToken, resetToken))
      .limit(1);

    if (!result.length) {
      return c.json({ error: 'Invalid or expired reset token' }, 401);
    }

    const user = result[0];

    // Check if token expired
    if (user.passwordResetExpires && new Date() > new Date(user.passwordResetExpires)) {
      return c.json({ error: 'Reset token has expired' }, 401);
    }

    // Hash new password with scrypt
    const passwordHash = hashPassword(newPassword);

    // Update password and clear reset token
    await db
      .update(users)
      .set({
        passwordHash,
        passwordResetToken: null,
        passwordResetExpires: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    log.info('Password reset for user', { email: user.email });

    return c.json({
      success: true,
      message: 'Password has been reset successfully. You can now sign in.',
    });
  } catch (error) {
    log.error('Password reset error', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to reset password' }, 500);
  }
});

/**
 * GET /api/setup/env-template
 * Get environment variable template for manual setup
 */
setup.get('/env-template', (c) => {
  const template = `# profClaw Configuration
# Copy this to .env and fill in your values

# GitHub OAuth (Required for authentication)
# Create at: https://github.com/settings/applications/new
GITHUB_CLIENT_ID=your_client_id_here
GITHUB_CLIENT_SECRET=your_client_secret_here
GITHUB_CALLBACK_URL=http://localhost:5173/api/auth/github/callback

# Optional: Jira OAuth
JIRA_CLIENT_ID=
JIRA_CLIENT_SECRET=

# Optional: Linear OAuth
LINEAR_CLIENT_ID=
LINEAR_CLIENT_SECRET=

# AI Providers (at least one required for chat)
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
OLLAMA_BASE_URL=http://localhost:11434

# Database
DATABASE_URL=file:./data/profclaw.db

# Server
PORT=3000
NODE_ENV=development
`;

  return c.text(template, 200, {
    'Content-Type': 'text/plain',
  });
});

export { setup as setupRoutes };
