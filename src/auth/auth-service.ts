/**
 * Authentication Service
 *
 * Handles:
 * - Email/Password authentication
 * - GitHub OAuth authentication
 * - Session management
 * - Password hashing with crypto
 */

import { randomUUID, randomBytes, createHash } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../storage/index.js';
import {
  users,
  sessions,
  oauthAccounts,
  userPreferences,
  githubTokens,
} from '../storage/schema.js';
import { getGitHubOAuthConfig, getSettingsRaw, type GitHubOAuthConfig } from '../settings/index.js';
import { hashPassword, verifyPassword as verifyPw } from './password.js';

/**
 * Hash a session token for secure storage.
 * Uses SHA256 which is fast and sufficient for random 32-byte tokens.
 */
function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// TYPES

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  bio?: string | null;
  timezone?: string | null;
  locale?: string | null;
  role: string;
  status: string;
  createdAt: Date;
  onboardingCompleted: boolean;
}

export interface Session {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
}

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
  bio: string | null;
}

export interface AuthResult {
  success: boolean;
  user?: User;
  session?: Session;
  error?: string;
}

// CONFIG

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Cache for GitHub OAuth config (refreshed on each call to support dynamic updates)
let cachedGitHubConfig: GitHubOAuthConfig | null = null;

async function getGitHubConfig(): Promise<GitHubOAuthConfig | null> {
  cachedGitHubConfig = await getGitHubOAuthConfig();
  return cachedGitHubConfig;
}

// PASSWORD UPGRADE (transparent SHA256 → scrypt migration)

/**
 * Upgrade a user's password hash from legacy SHA256 to scrypt.
 * Called transparently on successful login with legacy hash.
 */
async function upgradePasswordHash(userId: string, password: string): Promise<void> {
  const db = getDb();
  if (!db) return;

  const newHash = hashPassword(password);
  await db
    .update(users)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(users.id, userId));
  console.log(`[Auth] Upgraded password hash to scrypt for user ${userId}`);
}

// SESSION MANAGEMENT

export async function createSession(
  userId: string,
  userAgent?: string,
  ipAddress?: string
): Promise<Session> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const sessionId = randomUUID();
  const plainToken = randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(plainToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);

  // Store the HASH, not the plaintext token
  await db.insert(sessions).values({
    id: sessionId,
    userId,
    token: tokenHash,
    userAgent,
    ipAddress,
    createdAt: now,
    expiresAt,
    lastActiveAt: now,
  });

  // Return plaintext token to caller (set in cookie, never stored server-side)
  return { id: sessionId, userId, token: plainToken, expiresAt };
}

export async function validateSession(token: string): Promise<User | null> {
  const db = getDb();
  if (!db) return null;

  const tokenHash = hashSessionToken(token);
  const result = await db
    .select()
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.token, tokenHash))
    .limit(1);

  if (!result.length) return null;

  const session = result[0].sessions;
  const user = result[0].users;

  // Check if expired
  if (new Date() > new Date(session.expiresAt as Date)) {
    await db.delete(sessions).where(eq(sessions.id, session.id));
    return null;
  }

  // Update last active
  await db
    .update(sessions)
    .set({ lastActiveAt: new Date() })
    .where(eq(sessions.id, session.id));

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt as Date,
    onboardingCompleted: user.onboardingCompleted ?? false,
  };
}

export async function deleteSession(token: string): Promise<void> {
  const db = getDb();
  if (!db) return;

  const tokenHash = hashSessionToken(token);
  await db.delete(sessions).where(eq(sessions.token, tokenHash));
}

export async function deleteAllUserSessions(userId: string): Promise<void> {
  const db = getDb();
  if (!db) return;

  await db.delete(sessions).where(eq(sessions.userId, userId));
}

// EMAIL/PASSWORD AUTHENTICATION

export async function signUpWithEmail(
  email: string,
  password: string,
  name: string
): Promise<AuthResult> {
  const db = getDb();
  if (!db) return { success: false, error: 'Database not initialized' };

  // Check if email exists
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  if (existing.length > 0) {
    return { success: false, error: 'Email already registered' };
  }

  // Validate password strength
  if (password.length < 8) {
    return { success: false, error: 'Password must be at least 8 characters' };
  }

  // Hash password with scrypt
  const passwordHash = hashPassword(password);

  // Create user
  const userId = randomUUID();
  const now = new Date();

  await db.insert(users).values({
    id: userId,
    email: email.toLowerCase(),
    passwordHash,
    name,
    role: 'user',
    status: 'active',
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

  return {
    success: true,
    user: {
      id: userId,
      email: email.toLowerCase(),
      name,
      role: 'user',
      status: 'active',
      createdAt: now,
      onboardingCompleted: false,
    },
    session,
  };
}

export async function signInWithEmail(
  email: string,
  password: string
): Promise<AuthResult> {
  const db = getDb();
  if (!db) return { success: false, error: 'Database not initialized' };

  // Find user
  const result = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  if (!result.length) {
    return { success: false, error: 'Invalid email or password' };
  }

  const user = result[0];

  // Check password
  if (!user.passwordHash) {
    return { success: false, error: 'Please sign in with GitHub' };
  }

  const { valid, needsUpgrade } = verifyPw(password, user.passwordHash);
  if (!valid) {
    return { success: false, error: 'Invalid email or password' };
  }

  // Transparently upgrade legacy SHA256 hash to scrypt
  if (needsUpgrade) {
    upgradePasswordHash(user.id, password).catch((err) => {
      console.error('[Auth] Failed to upgrade password hash:', err);
    });
  }

  // Check if suspended
  if (user.status === 'suspended') {
    return { success: false, error: 'Account suspended' };
  }

  // Update last login
  await db
    .update(users)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, user.id));

  // Create session
  const session = await createSession(user.id);

  return {
    success: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt as Date,
      onboardingCompleted: user.onboardingCompleted ?? false,
    },
    session,
  };
}

// GITHUB OAUTH

export async function getGitHubAuthUrl(state?: string): Promise<string | null> {
  const config = await getGitHubConfig();
  if (!config?.clientId) return null;

  const authState = state || randomBytes(16).toString('hex');
  const scopes = 'read:user user:email repo read:project';

  return `https://github.com/login/oauth/authorize?` +
    `client_id=${config.clientId}` +
    `&redirect_uri=${encodeURIComponent(config.redirectUri)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&state=${authState}`;
}

export async function exchangeGitHubCode(code: string): Promise<{
  accessToken: string;
  scope: string;
} | null> {
  const config = await getGitHubConfig();
  if (!config?.clientId || !config?.clientSecret) return null;

  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
  });

  const data = (await response.json()) as {
    access_token?: string;
    scope?: string;
    error?: string;
  };

  if (data.error || !data.access_token) {
    console.error('[Auth] GitHub token exchange failed:', data.error);
    return null;
  }

  return {
    accessToken: data.access_token,
    scope: data.scope || '',
  };
}

export async function getGitHubUser(accessToken: string): Promise<GitHubUser | null> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    console.error('[Auth] Failed to fetch GitHub user:', response.status);
    return null;
  }

  return response.json() as Promise<GitHubUser>;
}

/**
 * Fetch user's primary email from GitHub (requires user:email scope)
 */
export async function getGitHubPrimaryEmail(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      console.error('[Auth] Failed to fetch GitHub emails:', response.status);
      return null;
    }

    const emails = (await response.json()) as Array<{
      email: string;
      primary: boolean;
      verified: boolean;
    }>;

    // Get primary verified email first, fallback to any primary email
    const primaryEmail =
      emails.find((e) => e.primary && e.verified)?.email ||
      emails.find((e) => e.primary)?.email ||
      emails.find((e) => e.verified)?.email ||
      emails[0]?.email;

    return primaryEmail || null;
  } catch (error) {
    console.error('[Auth] Error fetching GitHub emails:', error);
    return null;
  }
}

export async function signInWithGitHub(
  code: string
): Promise<AuthResult> {
  const db = getDb();
  if (!db) return { success: false, error: 'Database not initialized' };

  // Exchange code for token
  const tokenResult = await exchangeGitHubCode(code);
  if (!tokenResult) {
    return { success: false, error: 'Failed to authenticate with GitHub' };
  }

  // Get GitHub user info
  const githubUser = await getGitHubUser(tokenResult.accessToken);
  if (!githubUser) {
    return { success: false, error: 'Failed to get GitHub user info' };
  }

  // If user email is not public, fetch from emails API
  if (!githubUser.email) {
    const primaryEmail = await getGitHubPrimaryEmail(tokenResult.accessToken);
    if (primaryEmail) {
      githubUser.email = primaryEmail;
    }
  }

  // Check if OAuth account exists
  const existingOAuth = await db
    .select()
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.provider, 'github'),
        eq(oauthAccounts.providerAccountId, String(githubUser.id))
      )
    )
    .limit(1);

  let userId: string;
  const now = new Date();

  if (existingOAuth.length > 0) {
    // Update existing OAuth account with new token
    userId = existingOAuth[0].userId;
    await db
      .update(oauthAccounts)
      .set({
        accessToken: tokenResult.accessToken,
        scope: tokenResult.scope,
        providerUsername: githubUser.login,
        providerData: githubUser as unknown as Record<string, unknown>,
        updatedAt: now,
      })
      .where(eq(oauthAccounts.id, existingOAuth[0].id));

    // Get existing user to check if email needs updating
    const existingUser = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const currentEmail = existingUser[0]?.email || '';

    // Update user's last login and email if we now have a real one
    const updateData: Partial<typeof users.$inferInsert> = {
      lastLoginAt: now,
      updatedAt: now,
      avatarUrl: githubUser.avatar_url,
      name: githubUser.name || existingUser[0]?.name, // Update name from GitHub
    };

    // Update email if current is a fallback and we have a real one
    if (currentEmail.endsWith('@github.local') && githubUser.email && !githubUser.email.endsWith('@github.local')) {
      updateData.email = githubUser.email.toLowerCase();
    }

    await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, userId));
  } else {
    // Check if user exists with this email
    const email = githubUser.email || `${githubUser.login}@github.local`;
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);

    if (existingUser.length > 0) {
      // Link GitHub to existing user
      userId = existingUser[0].id;
    } else {
      // Block new user creation via GitHub OAuth in invite mode
      const settings = await getSettingsRaw();
      if (settings.system.registrationMode === 'invite') {
        return {
          success: false,
          error: 'Registration requires an invite code. Please sign up with email first.',
        };
      }

      // Create new user
      userId = randomUUID();
      await db.insert(users).values({
        id: userId,
        email: email.toLowerCase(),
        name: githubUser.name || githubUser.login,
        avatarUrl: githubUser.avatar_url,
        bio: githubUser.bio,
        role: 'user',
        status: 'active',
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
      });

      // Create default preferences
      await db.insert(userPreferences).values({
        id: randomUUID(),
        userId,
        updatedAt: now,
      });
    }

    // Create OAuth account link
    await db.insert(oauthAccounts).values({
      id: randomUUID(),
      userId,
      provider: 'github',
      providerAccountId: String(githubUser.id),
      providerUsername: githubUser.login,
      accessToken: tokenResult.accessToken,
      scope: tokenResult.scope,
      providerData: githubUser as unknown as Record<string, unknown>,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Also store in githubTokens for import/sync (backward compatibility)
  const existingToken = await db
    .select()
    .from(githubTokens)
    .where(eq(githubTokens.userId, userId))
    .limit(1);

  if (existingToken.length > 0) {
    await db
      .update(githubTokens)
      .set({
        accessToken: tokenResult.accessToken,
        tokenType: 'oauth',
        scopes: tokenResult.scope,
        githubUsername: githubUser.login,
        updatedAt: now,
      })
      .where(eq(githubTokens.id, existingToken[0].id));
  } else {
    await db.insert(githubTokens).values({
      id: randomUUID(),
      userId,
      accessToken: tokenResult.accessToken,
      tokenType: 'oauth',
      scopes: tokenResult.scope,
      githubUsername: githubUser.login,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Fetch updated user
  const userResult = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!userResult.length) {
    return { success: false, error: 'User not found' };
  }

  const user = userResult[0];

  // Create session
  const session = await createSession(userId);

  return {
    success: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt as Date,
      onboardingCompleted: user.onboardingCompleted ?? false,
    },
    session,
  };
}

// USER OPERATIONS

export async function getUserById(userId: string): Promise<User | null> {
  const db = getDb();
  if (!db) return null;

  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!result.length) return null;

  const user = result[0];
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    timezone: user.timezone,
    locale: user.locale,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt as Date,
    onboardingCompleted: user.onboardingCompleted ?? false,
  };
}

export async function updateUser(
  userId: string,
  updates: {
    name?: string;
    avatarUrl?: string;
    bio?: string;
    timezone?: string;
    locale?: string;
    onboardingCompleted?: boolean;
  }
): Promise<User | null> {
  const db = getDb();
  if (!db) return null;

  await db
    .update(users)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  return getUserById(userId);
}

export async function getUserGitHubToken(userId: string): Promise<string | null> {
  const db = getDb();
  if (!db) return null;

  // Try OAuth account first
  const oauth = await db
    .select()
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, 'github')))
    .limit(1);

  if (oauth.length > 0) {
    return oauth[0].accessToken;
  }

  // Fallback to githubTokens
  const token = await db
    .select()
    .from(githubTokens)
    .where(eq(githubTokens.userId, userId))
    .limit(1);

  return token[0]?.accessToken || null;
}

export async function getUserConnectedAccounts(
  userId: string
): Promise<Array<{ provider: string; username: string; connectedAt: Date }>> {
  const db = getDb();
  if (!db) return [];

  const accounts = await db
    .select()
    .from(oauthAccounts)
    .where(eq(oauthAccounts.userId, userId));

  return accounts.map((a: { provider: string; providerUsername: string | null; createdAt: Date | null }) => ({
    provider: a.provider,
    username: a.providerUsername || '',
    connectedAt: a.createdAt as Date,
  }));
}
