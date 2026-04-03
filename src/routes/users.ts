/**
 * User Routes
 *
 * Handles user profile and preferences management.
 */

import { Hono, Context } from 'hono';
import { createContextualLogger } from '../utils/logger.js';

const log = createContextualLogger('Users');
import { getCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import { randomUUID, randomBytes, createHash } from 'crypto';
import { getDb } from '../storage/index.js';
import { users, userPreferences, userApiKeys, sessions, oauthAccounts, inviteCodes } from '../storage/schema.js';
import { validateSession, getUserById, getUserConnectedAccounts, type User } from '../auth/auth-service.js';
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  generateRecoveryCodes,
  hashRecoveryCodes,
  generateInviteCode,
  hashInviteCode,
} from '../auth/password.js';
import { getSettingsRaw, updateSettings, type Settings } from '../settings/index.js';

// Define environment with user variable
type Variables = {
  user: User;
};

export const userRoutes = new Hono<{ Variables: Variables }>();

type UserPreferencesUpdate = Partial<typeof userPreferences.$inferInsert>;

// Middleware to require authentication
async function requireAuth(c: Context<{ Variables: Variables }>, next: () => Promise<void>) {
  const token = getCookie(c, 'profclaw_session');

  if (!token) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  const user = await validateSession(token);

  if (!user) {
    return c.json({ error: 'Invalid session' }, 401);
  }

  c.set('user', user);
  await next();
}

// Apply auth middleware to all routes
userRoutes.use('/*', requireAuth);

// PROFILE

/**
 * GET /api/users/me/profile
 * Get full user profile with preferences
 */
userRoutes.get('/me/profile', async (c) => {
  const user = c.get('user');
  const db = getDb();

  if (!db) return c.json({ error: 'Database not initialized' }, 500);

  // Get preferences
  const prefs = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, user.id))
    .limit(1);

  // Get connected accounts
  const connectedAccounts = await getUserConnectedAccounts(user.id);

  // Get active sessions count
  const sessionsResult = await db
    .select()
    .from(sessions)
    .where(eq(sessions.userId, user.id));

  return c.json({
    user,
    preferences: prefs[0] || null,
    connectedAccounts,
    activeSessions: sessionsResult.length,
  });
});

/**
 * PATCH /api/users/me/profile
 * Update user profile
 */
userRoutes.patch('/me/profile', async (c) => {
  const user = c.get('user');
  const db = getDb();

  if (!db) return c.json({ error: 'Database not initialized' }, 500);

  const body = await c.req.json();
  const { name, bio, timezone, locale } = body;

  // Validate inputs
  if (name !== undefined && (typeof name !== 'string' || name.length < 1)) {
    return c.json({ error: 'Name must be at least 1 character' }, 400);
  }

  await db
    .update(users)
    .set({
      ...(name !== undefined && { name }),
      ...(bio !== undefined && { bio }),
      ...(timezone !== undefined && { timezone }),
      ...(locale !== undefined && { locale }),
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  const updated = await getUserById(user.id);
  return c.json({ user: updated });
});

/**
 * PUT /api/users/me/email
 * Change user email address
 * Requires password verification for security
 */
userRoutes.put('/me/email', async (c) => {
  const user = c.get('user');
  const db = getDb();

  if (!db) return c.json({ error: 'Database not initialized' }, 500);

  const body = await c.req.json();
  const { newEmail, currentPassword } = body;

  // Validate inputs
  if (!newEmail || typeof newEmail !== 'string') {
    return c.json({ error: 'New email is required' }, 400);
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(newEmail)) {
    return c.json({ error: 'Invalid email format' }, 400);
  }

  // Get current user with password hash
  const currentUser = await db
    .select()
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  if (!currentUser.length) {
    return c.json({ error: 'User not found' }, 404);
  }

  // If user has a password, verify it
  if (currentUser[0].passwordHash) {
    if (!currentPassword) {
      return c.json({ error: 'Current password is required' }, 400);
    }

    const { valid } = verifyPassword(currentPassword, currentUser[0].passwordHash);
    if (!valid) {
      return c.json({ error: 'Current password is incorrect' }, 401);
    }
  }

  // Check if email already exists
  const existingEmail = await db
    .select()
    .from(users)
    .where(eq(users.email, newEmail.toLowerCase()))
    .limit(1);

  if (existingEmail.length > 0 && existingEmail[0].id !== user.id) {
    return c.json({ error: 'Email already in use' }, 409);
  }

  // Update email
  await db
    .update(users)
    .set({
      email: newEmail.toLowerCase(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  const updated = await getUserById(user.id);
  return c.json({ user: updated, message: 'Email updated successfully' });
});

/**
 * PUT /api/users/me/password
 * Change user password
 * OAuth-only users can set a password to enable email+password login
 */
userRoutes.put('/me/password', async (c) => {
  const user = c.get('user');
  const db = getDb();

  if (!db) return c.json({ error: 'Database not initialized' }, 500);

  const body = await c.req.json();
  const { currentPassword, newPassword } = body;

  // Validate new password strength
  if (!newPassword || typeof newPassword !== 'string') {
    return c.json({ error: 'New password is required' }, 400);
  }
  const passwordError = validatePasswordStrength(newPassword);
  if (passwordError) {
    return c.json({ error: passwordError }, 400);
  }

  // Get current user with password hash
  const currentUser = await db
    .select()
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  if (!currentUser.length) {
    return c.json({ error: 'User not found' }, 404);
  }

  // If user already has a password, verify current password
  if (currentUser[0].passwordHash) {
    if (!currentPassword) {
      return c.json({ error: 'Current password is required' }, 400);
    }

    const { valid } = verifyPassword(currentPassword, currentUser[0].passwordHash);
    if (!valid) {
      return c.json({ error: 'Current password is incorrect' }, 401);
    }
  }
  // Note: OAuth-only users (no passwordHash) can set a password without verification

  // Hash new password with scrypt
  const newPasswordHash = hashPassword(newPassword);

  // Update password
  await db
    .update(users)
    .set({
      passwordHash: newPasswordHash,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  return c.json({ message: 'Password updated successfully' });
});

// CONNECTED ACCOUNTS (OAuth)

/**
 * GET /api/users/me/connected-accounts
 * List connected OAuth accounts
 */
userRoutes.get('/me/connected-accounts', async (c) => {
  const user = c.get('user');
  const accounts = await getUserConnectedAccounts(user.id);

  // Get user to check if they have a password set
  const db = getDb();
  if (!db) return c.json({ error: 'Database not initialized' }, 500);

  const currentUser = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  return c.json({
    accounts,
    hasPassword: Boolean(currentUser[0]?.passwordHash),
    canDisconnect: Boolean(currentUser[0]?.passwordHash) || accounts.length > 1,
  });
});

/**
 * DELETE /api/users/me/connected-accounts/:provider
 * Disconnect an OAuth account
 * Requires either a password to be set, or another OAuth account to exist
 */
userRoutes.delete('/me/connected-accounts/:provider', async (c) => {
  const user = c.get('user');
  const provider = c.req.param('provider').toLowerCase();
  const db = getDb();

  if (!db) return c.json({ error: 'Database not initialized' }, 500);

  
  // Get all connected accounts
  const accounts = await db
    .select()
    .from(oauthAccounts)
    .where(eq(oauthAccounts.userId, user.id));

  // Find the account to disconnect
  type OAuthAccount = typeof accounts[number];
  const accountToRemove = accounts.find((a: OAuthAccount) => a.provider === provider);
  if (!accountToRemove) {
    return c.json({ error: 'Account not found' }, 404);
  }

  // Check if user has password or other OAuth accounts
  const currentUser = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  const hasPassword = Boolean(currentUser[0]?.passwordHash);
  const otherAccounts = accounts.filter((a: OAuthAccount) => a.provider !== provider);

  if (!hasPassword && otherAccounts.length === 0) {
    return c.json({
      error: 'Cannot disconnect last authentication method. Please set a password first.',
      requiresPassword: true,
    }, 400);
  }

  // Delete the OAuth account
  await db.delete(oauthAccounts).where(eq(oauthAccounts.id, accountToRemove.id));

  return c.json({
    message: `${provider} account disconnected successfully`,
    remainingAccounts: otherAccounts.length,
  });
});

/**
 * PUT /api/users/me/primary-email
 * Set which email is the primary (login) email
 * Can choose from connected OAuth account emails or manually set email
 */
userRoutes.put('/me/primary-email', async (c) => {
  const user = c.get('user');
  const db = getDb();

  if (!db) return c.json({ error: 'Database not initialized' }, 500);

  const body = await c.req.json();
  const { email, source } = body; // source: 'manual' | 'github' | 'google' etc

  if (!email || typeof email !== 'string') {
    return c.json({ error: 'Email is required' }, 400);
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return c.json({ error: 'Invalid email format' }, 400);
  }

  
  // If source is an OAuth provider, verify the email belongs to that account
  if (source && source !== 'manual') {
    const accounts = await db
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, user.id));

    type OAuthAccount = typeof accounts[number];
    const providerAccount = accounts.find((a: OAuthAccount) => a.provider === source);
    if (!providerAccount) {
      return c.json({ error: `No ${source} account connected` }, 400);
    }

    // Verify email matches provider data (if available)
    const providerData = providerAccount.providerData as Record<string, unknown> | null;
    const providerEmail = typeof providerData?.email === 'string' ? providerData.email : undefined;
    if (providerEmail && providerEmail.toLowerCase() !== email.toLowerCase()) {
      return c.json({ error: 'Email does not match connected account' }, 400);
    }
  }

  // Check if email already in use by another user
  const existingUser = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  if (existingUser.length > 0 && existingUser[0].id !== user.id) {
    return c.json({ error: 'Email already in use by another account' }, 409);
  }

  // Update primary email
  await db
    .update(users)
    .set({
      email: email.toLowerCase(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  const updated = await getUserById(user.id);
  return c.json({
    user: updated,
    message: 'Primary email updated successfully',
  });
});

// PREFERENCES

/**
 * GET /api/users/me/preferences
 * Get user preferences
 */
userRoutes.get('/me/preferences', async (c) => {
  const user = c.get('user');
  const db = getDb();

  if (!db) return c.json({ error: 'Database not initialized' }, 500);

  const prefs = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, user.id))
    .limit(1);

  if (!prefs.length) {
    // Create default preferences
    const id = randomUUID();
    const now = new Date();

    await db.insert(userPreferences).values({
      id,
      userId: user.id,
      updatedAt: now,
    });

    const created = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.id, id))
      .limit(1);

    return c.json({ preferences: created[0] });
  }

  return c.json({ preferences: prefs[0] });
});

/**
 * PATCH /api/users/me/preferences
 * Update user preferences
 */
userRoutes.patch('/me/preferences', async (c) => {
  const user = c.get('user');
  const db = getDb();

  if (!db) return c.json({ error: 'Database not initialized' }, 500);

  const body = await c.req.json();
  const allowedFields = [
    'theme',
    'accentColor',
    'fontSize',
    'emailNotifications',
    'pushNotifications',
    'notifyOnMention',
    'notifyOnAssign',
    'notifyOnComment',
    'defaultAgent',
    'aiAutoSuggest',
    'aiResponseLength',
    'editorMode',
    'tabSize',
    'extraSettings',
  ];

  // Filter to allowed fields only
  const updates: UserPreferencesUpdate = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      (updates as Record<string, unknown>)[field] = body[field];
    }
  }

  updates.updatedAt = new Date();

  // Ensure preferences exist
  const existing = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, user.id))
    .limit(1);

  if (!existing.length) {
    await db.insert(userPreferences).values({
      id: randomUUID(),
      userId: user.id,
      ...updates,
    });
  } else {
    await db
      .update(userPreferences)
      .set(updates)
      .where(eq(userPreferences.userId, user.id));
  }

  const updated = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, user.id))
    .limit(1);

  return c.json({ preferences: updated[0] });
});

// API KEYS

/**
 * GET /api/users/me/api-keys
 * List user's API keys (without the actual key values)
 */
userRoutes.get('/me/api-keys', async (c) => {
  const user = c.get('user');
  const db = getDb();

  if (!db) return c.json({ error: 'Database not initialized' }, 500);

  const keys = await db
    .select({
      id: userApiKeys.id,
      name: userApiKeys.name,
      keyPrefix: userApiKeys.keyPrefix,
      scopes: userApiKeys.scopes,
      lastUsedAt: userApiKeys.lastUsedAt,
      usageCount: userApiKeys.usageCount,
      expiresAt: userApiKeys.expiresAt,
      createdAt: userApiKeys.createdAt,
      revokedAt: userApiKeys.revokedAt,
    })
    .from(userApiKeys)
    .where(eq(userApiKeys.userId, user.id));

  return c.json({ apiKeys: keys });
});

/**
 * POST /api/users/me/api-keys
 * Create a new API key
 */
userRoutes.post('/me/api-keys', async (c) => {
  const user = c.get('user');
  const db = getDb();

  if (!db) return c.json({ error: 'Database not initialized' }, 500);

  const body = await c.req.json();
  const { name, scopes = ['read'], expiresInDays } = body;

  if (!name || typeof name !== 'string') {
    return c.json({ error: 'Name is required' }, 400);
  }

  // Generate API key
  const rawKey = `profclaw_${randomBytes(24).toString('hex')}`;
  const keyPrefix = rawKey.slice(0, 14) + '...';
  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  const id = randomUUID();
  const now = new Date();
  const expiresAt = expiresInDays
    ? new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  await db.insert(userApiKeys).values({
    id,
    userId: user.id,
    name,
    keyHash,
    keyPrefix,
    scopes,
    expiresAt,
    createdAt: now,
  });

  // Return the full key ONLY on creation (it won't be retrievable later)
  return c.json({
    apiKey: {
      id,
      name,
      key: rawKey, // Only returned once!
      keyPrefix,
      scopes,
      expiresAt,
      createdAt: now,
    },
    message: 'Save this key securely - it will not be shown again',
  });
});

/**
 * DELETE /api/users/me/api-keys/:keyId
 * Revoke an API key
 */
userRoutes.delete('/me/api-keys/:keyId', async (c) => {
  const user = c.get('user');
  const keyId = c.req.param('keyId');
  const db = getDb();

  if (!db) return c.json({ error: 'Database not initialized' }, 500);

  // Verify ownership
  const key = await db
    .select()
    .from(userApiKeys)
    .where(eq(userApiKeys.id, keyId))
    .limit(1);

  if (!key.length || key[0].userId !== user.id) {
    return c.json({ error: 'API key not found' }, 404);
  }

  // Mark as revoked
  await db
    .update(userApiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(userApiKeys.id, keyId));

  return c.json({ message: 'API key revoked' });
});

// SESSIONS

/**
 * GET /api/users/me/sessions
 * List active sessions
 */
userRoutes.get('/me/sessions', async (c) => {
  const user = c.get('user');
  const db = getDb();

  if (!db) return c.json({ error: 'Database not initialized' }, 500);

  const currentToken = getCookie(c, 'profclaw_session');

  const userSessions = await db
    .select({
      id: sessions.id,
      userAgent: sessions.userAgent,
      ipAddress: sessions.ipAddress,
      deviceName: sessions.deviceName,
      createdAt: sessions.createdAt,
      lastActiveAt: sessions.lastActiveAt,
      expiresAt: sessions.expiresAt,
      token: sessions.token,
    })
    .from(sessions)
    .where(eq(sessions.userId, user.id));

  // Mark current session
  type SessionRow = typeof userSessions[number];
  const sessionsWithCurrent = userSessions.map((s: SessionRow) => ({
    id: s.id,
    userAgent: s.userAgent,
    ipAddress: s.ipAddress,
    deviceName: s.deviceName,
    createdAt: s.createdAt,
    lastActiveAt: s.lastActiveAt,
    expiresAt: s.expiresAt,
    isCurrent: s.token === currentToken,
  }));

  return c.json({ sessions: sessionsWithCurrent });
});

/**
 * DELETE /api/users/me/sessions/:sessionId
 * Revoke a specific session
 */
userRoutes.delete('/me/sessions/:sessionId', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');
  const db = getDb();

  if (!db) return c.json({ error: 'Database not initialized' }, 500);

  // Verify ownership
  const session = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!session.length || session[0].userId !== user.id) {
    return c.json({ error: 'Session not found' }, 404);
  }

  await db.delete(sessions).where(eq(sessions.id, sessionId));

  return c.json({ message: 'Session revoked' });
});

/**
 * DELETE /api/users/me/sessions
 * Revoke all sessions except current
 */
userRoutes.delete('/me/sessions', async (c) => {
  const user = c.get('user');
  const currentToken = getCookie(c, 'profclaw_session');
  const db = getDb();

  if (!db) return c.json({ error: 'Database not initialized' }, 500);

  // Get all sessions except current
  const userSessions = await db
    .select()
    .from(sessions)
    .where(eq(sessions.userId, user.id));

  let revokedCount = 0;
  for (const session of userSessions) {
    if (session.token !== currentToken) {
      await db.delete(sessions).where(eq(sessions.id, session.id));
      revokedCount++;
    }
  }

  return c.json({ message: `Revoked ${revokedCount} sessions` });
});

// ONBOARDING

/**
 * POST /api/users/me/complete-onboarding
 * Mark onboarding as complete
 */
userRoutes.post('/me/complete-onboarding', async (c) => {
  const user = c.get('user');
  const db = getDb();

  if (!db) return c.json({ error: 'Database not initialized' }, 500);

  await db
    .update(users)
    .set({ onboardingCompleted: true, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  return c.json({ message: 'Onboarding completed' });
});

// RECOVERY CODES

/**
 * POST /api/users/me/recovery-codes/regenerate
 * Regenerate recovery codes (invalidates all existing codes)
 * Returns new codes ONLY ONCE - they cannot be retrieved again
 */
userRoutes.post('/me/recovery-codes/regenerate', async (c) => {
  const user = c.get('user');
  const db = getDb();

  if (!db) return c.json({ error: 'Database not initialized' }, 500);

  try {
    // Generate new recovery codes
    const recoveryCodes = generateRecoveryCodes(8);
    const hashedRecoveryCodes = hashRecoveryCodes(recoveryCodes);

    // Update user with new hashed codes (invalidates old ones)
    await db
      .update(users)
      .set({
        recoveryCodes: JSON.stringify(hashedRecoveryCodes),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    return c.json({
      success: true,
      recoveryCodes,
      message: 'New recovery codes generated. Save these codes securely - they will not be shown again!',
    });
  } catch (error) {
    log.error('Recovery code regeneration error', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to regenerate recovery codes' }, 500);
  }
});

/**
 * GET /api/users/me/recovery-codes/count
 * Get the count of remaining recovery codes (without exposing the codes)
 */
userRoutes.get('/me/recovery-codes/count', async (c) => {
  const user = c.get('user');
  const db = getDb();

  if (!db) return c.json({ error: 'Database not initialized' }, 500);

  try {
    const result = await db
      .select({ recoveryCodes: users.recoveryCodes })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    if (!result.length) {
      return c.json({ error: 'User not found' }, 404);
    }

    const storedCodes = result[0].recoveryCodes;
    const count = storedCodes ? JSON.parse(storedCodes).length : 0;

    return c.json({
      remainingCodes: count,
      hasRecoveryCodes: count > 0,
    });
  } catch (error) {
    log.error('Recovery code count error', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to get recovery code count' }, 500);
  }
});

// ADMIN: USER MANAGEMENT

/**
 * Middleware to require admin role
 */
async function requireAdmin(c: Context<{ Variables: Variables }>, next: () => Promise<void>) {
  const user = c.get('user');
  if (user.role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403);
  }
  await next();
}

/**
 * GET /api/users/admin/list
 * List all users (admin only)
 */
userRoutes.get('/admin/list', requireAdmin, async (c) => {
  const db = getDb();
  if (!db) return c.json({ error: 'Database not initialized' }, 500);

  try {
    const allUsers = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        status: users.status,
        avatarUrl: users.avatarUrl,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        onboardingCompleted: users.onboardingCompleted,
      })
      .from(users)
      .orderBy(users.createdAt);

    return c.json({ users: allUsers, total: allUsers.length });
  } catch (error) {
    log.error('List users error', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to list users' }, 500);
  }
});

// ADMIN: INVITE CODES (must be before /:userId to avoid route shadowing)

/**
 * POST /api/users/admin/invites
 * Generate invite code(s) (admin only)
 */
userRoutes.post('/admin/invites', requireAdmin, async (c) => {
  const user = c.get('user');
  const db = getDb();
  if (!db) return c.json({ error: 'Database not initialized' }, 500);

  try {
    const body = await c.req.json();
    const count = Math.min(Math.max(body.count || 1, 1), 50);
    const label = body.label || null;

    let expiresAt: Date | null = null;
    if (body.expiresInDays) {
      expiresAt = new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000);
    }

    const codes: Array<{ id: string; code: string; expiresAt: Date | null }> = [];

    for (let i = 0; i < count; i++) {
      const code = generateInviteCode();
      const codeHash = hashInviteCode(code);
      const id = randomUUID();

      await db.insert(inviteCodes).values({
        id,
        codeHash,
        createdBy: user.id,
        expiresAt,
        createdAt: new Date(),
        label,
      });

      codes.push({ id, code, expiresAt });
    }

    return c.json({
      codes,
      message: `Generated ${count} invite code(s)`,
    });
  } catch (err) {
    log.error('Generate invites error', err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Failed to generate invite codes' }, 500);
  }
});

/**
 * GET /api/users/admin/invites
 * List invite codes (admin only)
 */
userRoutes.get('/admin/invites', requireAdmin, async (c) => {
  const db = getDb();
  if (!db) return c.json({ error: 'Database not initialized' }, 500);

  try {
    const allInvites = await db
      .select({
        id: inviteCodes.id,
        createdBy: inviteCodes.createdBy,
        usedBy: inviteCodes.usedBy,
        usedAt: inviteCodes.usedAt,
        expiresAt: inviteCodes.expiresAt,
        createdAt: inviteCodes.createdAt,
        label: inviteCodes.label,
      })
      .from(inviteCodes)
      .orderBy(inviteCodes.createdAt);

    return c.json({ invites: allInvites, total: allInvites.length });
  } catch (err) {
    log.error('List invites error', err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Failed to list invite codes' }, 500);
  }
});

/**
 * DELETE /api/users/admin/invites/:id
 * Revoke/delete an invite code (admin only)
 */
userRoutes.delete('/admin/invites/:id', requireAdmin, async (c) => {
  const inviteId = c.req.param('id') as string;
  const db = getDb();
  if (!db) return c.json({ error: 'Database not initialized' }, 500);

  try {
    const existing = await db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.id, inviteId))
      .limit(1);

    if (!existing.length) {
      return c.json({ error: 'Invite code not found' }, 404);
    }

    await db.delete(inviteCodes).where(eq(inviteCodes.id, inviteId));

    return c.json({ message: 'Invite code deleted' });
  } catch (err) {
    log.error('Delete invite error', err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Failed to delete invite code' }, 500);
  }
});

// ADMIN: REGISTRATION MODE (must be before /:userId to avoid route shadowing)

/**
 * GET /api/users/admin/registration-mode
 * Get current registration mode (admin only)
 */
userRoutes.get('/admin/registration-mode', requireAdmin, async (c) => {
  try {
    const settings = await getSettingsRaw();
    return c.json({ mode: settings.system.registrationMode });
  } catch (err) {
    log.error('Get registration mode error', err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Failed to get registration mode' }, 500);
  }
});

/**
 * PATCH /api/users/admin/registration-mode
 * Set registration mode (admin only)
 */
userRoutes.patch('/admin/registration-mode', requireAdmin, async (c) => {
  try {
    const body = await c.req.json();
    const { mode } = body;

    if (mode !== 'open' && mode !== 'invite') {
      return c.json({ error: 'Mode must be "open" or "invite"' }, 400);
    }

    await updateSettings({
      system: { registrationMode: mode } as Settings['system'],
    });

    return c.json({ mode, message: `Registration mode set to ${mode}` });
  } catch (err) {
    log.error('Set registration mode error', err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Failed to set registration mode' }, 500);
  }
});

// ADMIN: USER CRUD (/:userId wildcard routes - must be AFTER specific routes)

/**
 * GET /api/users/admin/:userId
 * Get user details (admin only)
 */
userRoutes.get('/admin/:userId', requireAdmin, async (c) => {
  const userId = c.req.param('userId') as string;
  const db = getDb();
  if (!db) return c.json({ error: 'Database not initialized' }, 500);

  try {
    const result = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        status: users.status,
        avatarUrl: users.avatarUrl,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        onboardingCompleted: users.onboardingCompleted,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!result.length) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Get session count
    const userSessions = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userId));

    return c.json({ user: result[0], activeSessions: userSessions.length });
  } catch (error) {
    log.error('Get user error', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to get user' }, 500);
  }
});

/**
 * PATCH /api/users/admin/:userId
 * Update user (admin only)
 */
userRoutes.patch('/admin/:userId', requireAdmin, async (c) => {
  const userId = c.req.param('userId') as string;
  const db = getDb();
  if (!db) return c.json({ error: 'Database not initialized' }, 500);

  try {
    const body = await c.req.json();
    const { name, role, status } = body;

    // Validate role if provided
    if (role && !['admin', 'user'].includes(role)) {
      return c.json({ error: 'Invalid role' }, 400);
    }

    // Validate status if provided
    if (status && !['active', 'suspended', 'pending'].includes(status)) {
      return c.json({ error: 'Invalid status' }, 400);
    }

    await db
      .update(users)
      .set({
        ...(name !== undefined && { name }),
        ...(role !== undefined && { role }),
        ...(status !== undefined && { status }),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    return c.json({ message: 'User updated' });
  } catch (error) {
    log.error('Update user error', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to update user' }, 500);
  }
});

/**
 * POST /api/users/admin/:userId/reset-password
 * Reset user password (admin only) - generates temporary password
 */
userRoutes.post('/admin/:userId/reset-password', requireAdmin, async (c) => {
  const userId = c.req.param('userId') as string;
  const db = getDb();
  if (!db) return c.json({ error: 'Database not initialized' }, 500);

  try {
    // Generate a temporary password
    const tempPassword = randomBytes(8).toString('hex');
    const passwordHash = hashPassword(tempPassword);

    // Generate new recovery codes
    const recoveryCodes = generateRecoveryCodes(8);
    const hashedRecoveryCodes = hashRecoveryCodes(recoveryCodes);

    await db
      .update(users)
      .set({
        passwordHash,
        recoveryCodes: JSON.stringify(hashedRecoveryCodes),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    // Invalidate all sessions for this user
    await db.delete(sessions).where(eq(sessions.userId, userId));

    return c.json({
      message: 'Password reset successfully',
      temporaryPassword: tempPassword,
      recoveryCodes,
      note: 'User must change password on next login. All sessions have been revoked.',
    });
  } catch (error) {
    log.error('Reset password error', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to reset password' }, 500);
  }
});

/**
 * DELETE /api/users/admin/:userId
 * Delete user (admin only)
 */
userRoutes.delete('/admin/:userId', requireAdmin, async (c) => {
  const adminUser = c.get('user');
  const userId = c.req.param('userId') as string;
  const db = getDb();
  if (!db) return c.json({ error: 'Database not initialized' }, 500);
  if (!userId) return c.json({ error: 'User ID required' }, 400);

  // Prevent self-deletion
  if (userId === adminUser.id) {
    return c.json({ error: 'Cannot delete your own account' }, 400);
  }

  try {
    // Delete user sessions first
    await db.delete(sessions).where(eq(sessions.userId, userId));

    // Delete user preferences
    await db.delete(userPreferences).where(eq(userPreferences.userId, userId));

    // Delete user API keys
    await db.delete(userApiKeys).where(eq(userApiKeys.userId, userId));

    // Delete user
    await db.delete(users).where(eq(users.id, userId));

    return c.json({ message: 'User deleted' });
  } catch (error) {
    log.error('Delete user error', error instanceof Error ? error : new Error(String(error)));
    return c.json({ error: 'Failed to delete user' }, 500);
  }
});
