import { randomBytes, createHash } from 'crypto';
import { getStorage } from '../storage/index.js';

/**
 * Token scopes for fine-grained permissions
 */
export type TokenScope =
  | 'tasks:read'
  | 'tasks:write'
  | 'summaries:read'
  | 'summaries:write'
  | 'config:read'
  | 'config:write'
  | 'gateway:execute'
  | 'admin';

/**
 * API Token record
 */
export interface ApiToken {
  id: string;
  name: string;
  /** Hashed token (never store plaintext) */
  tokenHash: string;
  /** First 8 chars for identification */
  tokenPrefix: string;
  scopes: TokenScope[];
  createdAt: Date;
  lastUsedAt?: Date;
  expiresAt?: Date;
  /** Rate limit: requests per minute */
  rateLimit: number;
  enabled: boolean;
}

/**
 * Token creation result
 */
export interface CreateTokenResult {
  token: ApiToken;
  /** The actual token (only shown once!) */
  plainTextToken: string;
}

/**
 * In-memory token cache for fast validation
 */
const tokenCache = new Map<string, ApiToken>();

/**
 * Rate limit tracking
 */
const rateLimitTracker = new Map<string, { count: number; resetAt: number }>();

/**
 * Generate a secure random token
 */
function generateToken(): string {
  return `glinr_${randomBytes(32).toString('base64url')}`;
}

/**
 * Hash a token for storage
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Initialize API tokens table
 */
export async function initApiTokensTable(): Promise<void> {
  const storage = getStorage();
  await storage.execute(`
    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      scopes TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      expires_at TEXT,
      rate_limit INTEGER NOT NULL DEFAULT 60,
      enabled INTEGER NOT NULL DEFAULT 1
    )
  `);

  // Migration for existing tables
  try {
    await storage.execute(`ALTER TABLE api_tokens ADD COLUMN token_prefix TEXT`);
  } catch (e) {
    // Column already exists
  }
  try {
    await storage.execute(`ALTER TABLE api_tokens ADD COLUMN rate_limit INTEGER DEFAULT 60`);
  } catch (e) {
    // Column already exists
  }
  try {
    await storage.execute(`ALTER TABLE api_tokens ADD COLUMN enabled INTEGER DEFAULT 1`);
  } catch (e) {
    // Column already exists
  }
}

/**
 * Create a new API token
 */
export async function createApiToken(
  name: string,
  scopes: TokenScope[],
  options: {
    expiresInDays?: number;
    rateLimit?: number;
  } = {}
): Promise<CreateTokenResult> {
  const plainTextToken = generateToken();
  const tokenHash = hashToken(plainTextToken);
  const tokenPrefix = plainTextToken.slice(0, 12);

  const token: ApiToken = {
    id: randomBytes(8).toString('hex'),
    name,
    tokenHash,
    tokenPrefix,
    scopes,
    createdAt: new Date(),
    expiresAt: options.expiresInDays
      ? new Date(Date.now() + options.expiresInDays * 24 * 60 * 60 * 1000)
      : undefined,
    rateLimit: options.rateLimit || 60,
    enabled: true,
  };

  // Store in database using generic execute
  const storage = getStorage();
  await storage.execute(
    `INSERT INTO api_tokens (id, name, token_hash, token_prefix, scopes, created_at, expires_at, rate_limit, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      token.id,
      token.name,
      token.tokenHash,
      token.tokenPrefix,
      JSON.stringify(token.scopes),
      token.createdAt.toISOString(),
      token.expiresAt?.toISOString() || null,
      token.rateLimit,
      token.enabled ? 1 : 0,
    ]
  );

  // Cache for fast lookup
  tokenCache.set(tokenHash, token);

  return { token, plainTextToken };
}

/**
 * Get token by hash from database
 */
async function getTokenByHash(hash: string): Promise<ApiToken | null> {
  const storage = getStorage();
  const rows = await storage.query<{
    id: string;
    name: string;
    token_hash: string;
    token_prefix: string;
    scopes: string;
    created_at: string;
    last_used_at: string | null;
    expires_at: string | null;
    rate_limit: number;
    enabled: number;
  }>('SELECT * FROM api_tokens WHERE token_hash = ?', [hash]);

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    id: row.id,
    name: row.name,
    tokenHash: row.token_hash,
    tokenPrefix: row.token_prefix,
    scopes: JSON.parse(row.scopes),
    createdAt: new Date(row.created_at),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : undefined,
    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    rateLimit: row.rate_limit,
    enabled: Boolean(row.enabled),
  };
}

/**
 * Validate a token and return its info
 */
export async function validateToken(
  plainTextToken: string
): Promise<{ valid: boolean; token?: ApiToken; error?: string }> {
  if (!plainTextToken || !plainTextToken.startsWith('glinr_')) {
    return { valid: false, error: 'Invalid token format' };
  }

  const tokenHash = hashToken(plainTextToken);

  // Check cache first
  let token = tokenCache.get(tokenHash);

  // If not in cache, check database
  if (!token) {
    token = await getTokenByHash(tokenHash) || undefined;
    if (token) {
      tokenCache.set(tokenHash, token);
    }
  }

  if (!token) {
    return { valid: false, error: 'Token not found' };
  }

  if (!token.enabled) {
    return { valid: false, error: 'Token disabled' };
  }

  if (token.expiresAt && token.expiresAt < new Date()) {
    return { valid: false, error: 'Token expired' };
  }

  // Check rate limit
  const rateLimitKey = token.id;
  const now = Date.now();
  const tracker = rateLimitTracker.get(rateLimitKey);

  if (tracker) {
    if (now < tracker.resetAt) {
      if (tracker.count >= token.rateLimit) {
        return { valid: false, error: 'Rate limit exceeded' };
      }
      tracker.count++;
    } else {
      rateLimitTracker.set(rateLimitKey, { count: 1, resetAt: now + 60000 });
    }
  } else {
    rateLimitTracker.set(rateLimitKey, { count: 1, resetAt: now + 60000 });
  }

  // Update last used (async, don't block)
  const storage = getStorage();
  storage.execute(
    'UPDATE api_tokens SET last_used_at = ? WHERE id = ?',
    [new Date().toISOString(), token.id]
  ).catch(() => {});

  return { valid: true, token };
}

/**
 * Check if a token has a specific scope
 */
export function hasScope(token: ApiToken, scope: TokenScope): boolean {
  return token.scopes.includes('admin') || token.scopes.includes(scope);
}

/**
 * List all tokens (without hashes)
 */
export async function listApiTokens(): Promise<Omit<ApiToken, 'tokenHash'>[]> {
  const storage = getStorage();
  const rows = await storage.query<{
    id: string;
    name: string;
    token_prefix: string;
    scopes: string;
    created_at: string;
    last_used_at: string | null;
    expires_at: string | null;
    rate_limit: number;
    enabled: number;
  }>('SELECT id, name, token_prefix, scopes, created_at, last_used_at, expires_at, rate_limit, enabled FROM api_tokens');

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    scopes: JSON.parse(row.scopes),
    createdAt: new Date(row.created_at),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : undefined,
    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    rateLimit: row.rate_limit,
    enabled: Boolean(row.enabled),
  }));
}

/**
 * Revoke a token
 */
export async function revokeApiToken(id: string): Promise<boolean> {
  const storage = getStorage();
  await storage.execute('DELETE FROM api_tokens WHERE id = ?', [id]);

  // Clear from cache
  for (const [hash, token] of tokenCache.entries()) {
    if (token.id === id) {
      tokenCache.delete(hash);
      break;
    }
  }

  return true;
}

/**
 * Hono middleware for token authentication
 */
export function tokenAuthMiddleware(requiredScopes: TokenScope[] = []) {
  return async (c: any, next: () => Promise<void>) => {
    const authHeader = c.req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid Authorization header' }, 401);
    }

    const token = authHeader.slice(7);
    const result = await validateToken(token);

    if (!result.valid) {
      return c.json({ error: result.error }, 401);
    }

    // Check required scopes
    for (const scope of requiredScopes) {
      if (!hasScope(result.token!, scope)) {
        return c.json({ error: `Missing required scope: ${scope}` }, 403);
      }
    }

    // Attach token info to context
    c.set('apiToken', result.token);

    return next();
  };
}
