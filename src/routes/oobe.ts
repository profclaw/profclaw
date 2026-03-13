/**
 * OOBE (Out-of-Box Experience) Routes
 *
 * Public routes for the first-time setup wizard.
 * Creates a local-mode user without requiring email/password.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../storage/index.js';
import { users, userPreferences } from '../storage/schema.js';
import { getSettingsRaw, updateSettings } from '../settings/index.js';
import { createSession } from '../auth/auth-service.js';
import { setCookie } from 'hono/cookie';
import { hashPassword, validatePasswordStrength } from '../auth/password.js';
import { invalidateLocalAdminCache } from '../auth/middleware.js';

const oobe = new Hono();

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 30 * 24 * 60 * 60, // 30 days
  path: '/',
};

// =============================================================================
// SCHEMAS
// =============================================================================

const PROVIDER_ENUM = z.enum([
  'anthropic', 'openai', 'google', 'azure', 'ollama', 'openrouter',
  'groq', 'xai', 'mistral', 'cohere', 'perplexity', 'deepseek',
  'together', 'cerebras', 'fireworks', 'copilot',
]);

const setupSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  avatarUrl: z.string().url().max(500).optional(),
  aiProvider: z.object({
    provider: PROVIDER_ENUM,
    apiKey: z.string().optional(),
    ollamaBaseUrl: z.string().optional(),
  }).optional(),
});

const enableMultiUserSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});

const validateAiSchema = z.object({
  provider: PROVIDER_ENUM,
  apiKey: z.string().optional(),
  ollamaBaseUrl: z.string().optional(),
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

// =============================================================================
// ROUTES
// =============================================================================

/**
 * GET /api/oobe/status
 * Check if OOBE setup is needed
 */
oobe.get('/status', async (c) => {
  try {
    const db = getDb();
    const settings = await getSettingsRaw();

    let hasAdmin = false;
    if (db) {
      const adminUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, 'admin'))
        .limit(1);
      hasAdmin = adminUsers.length > 0;
    }

    return c.json({
      needsSetup: !hasAdmin,
      authMode: settings.system.authMode,
      hasAccessKey: Boolean(settings.system.accessKeyHash),
    });
  } catch (error) {
    console.error('[OOBE] Status check error:', error);
    return c.json({ needsSetup: true, authMode: 'local' });
  }
});

/**
 * POST /api/oobe/setup
 * Create local user and configure AI provider
 */
oobe.post('/setup', async (c) => {
  try {
    const db = getDb();
    if (!db) {
      return c.json({ error: 'Database not initialized' }, 500);
    }

    // Check if admin already exists
    const existingAdmins = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'admin'))
      .limit(1);

    if (existingAdmins.length > 0) {
      return c.json({ error: 'Setup already completed' }, 403);
    }

    const parsedBody = await parseJsonBody(c);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const parsed = setupSchema.safeParse(parsedBody.body);

    if (!parsed.success) {
      const firstError = parsed.error.errors[0]?.message || 'Invalid input';
      return c.json({ error: firstError }, 400);
    }

    const { name, avatarUrl, aiProvider: aiConfig } = parsed.data;

    // Create local admin user with synthetic email
    const userId = randomUUID();
    const now = new Date();

    await db.insert(users).values({
      id: userId,
      email: 'owner@profclaw.local',
      name,
      avatarUrl: avatarUrl ?? null,
      role: 'admin',
      status: 'active',
      onboardingCompleted: true,
      createdAt: now,
      updatedAt: now,
    });

    // Create default preferences
    await db.insert(userPreferences).values({
      id: randomUUID(),
      userId,
      updatedAt: now,
    });

    // Configure AI provider if provided
    if (aiConfig) {
      const aiSettings: Record<string, string | Record<string, string> | undefined> = {
        defaultProvider: aiConfig.provider,
      };
      if (aiConfig.provider === 'anthropic' && aiConfig.apiKey) {
        aiSettings.anthropicKey = aiConfig.apiKey;
      } else if (aiConfig.provider === 'openai' && aiConfig.apiKey) {
        aiSettings.openaiKey = aiConfig.apiKey;
      } else if (aiConfig.provider === 'ollama') {
        aiSettings.ollamaBaseUrl = aiConfig.ollamaBaseUrl || 'http://localhost:11434';
      } else if (aiConfig.apiKey) {
        aiSettings.providerKeys = { [aiConfig.provider]: aiConfig.apiKey };
      }
      await updateSettings({ aiProvider: aiSettings });
    }

    // Set auth mode to local
    const settings = await getSettingsRaw();
    await updateSettings({
      system: { ...settings.system, authMode: 'local' as const },
    });

    // Create session (for cookie-based auth fallback)
    const session = await createSession(userId);
    setCookie(c, 'profclaw_session', session.token, COOKIE_OPTIONS);

    // Invalidate cached admin in middleware
    invalidateLocalAdminCache();

    console.log(`[OOBE] Local admin created: ${name}`);

    return c.json({
      success: true,
      user: {
        id: userId,
        email: 'owner@profclaw.local',
        name,
        role: 'admin',
      },
    });
  } catch (error) {
    console.error('[OOBE] Setup error:', error);
    return c.json({
      error: 'Setup failed',
      details: error instanceof Error ? error.message : 'Unknown',
    }, 500);
  }
});

/**
 * POST /api/oobe/validate-ai
 * Test an AI provider key with a small request
 */
oobe.post('/validate-ai', async (c) => {
  try {
    const parsedBody = await parseJsonBody(c);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const parsed = validateAiSchema.safeParse(parsedBody.body);

    if (!parsed.success) {
      return c.json({ valid: false, error: 'Invalid input' }, 400);
    }

    const { provider, apiKey, ollamaBaseUrl } = parsed.data;

    if (provider === 'ollama') {
      // Test Ollama connection
      const baseUrl = ollamaBaseUrl || 'http://localhost:11434';
      try {
        const response = await fetch(`${baseUrl}/api/tags`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
          return c.json({ valid: false, error: `Ollama returned HTTP ${response.status}` });
        }
        const data = await response.json() as { models?: unknown[] };
        return c.json({
          valid: true,
          message: `Connected to Ollama (${Array.isArray(data.models) ? data.models.length : 0} models available)`,
        });
      } catch {
        return c.json({ valid: false, error: 'Cannot connect to Ollama. Is it running?' });
      }
    }

    // Test OpenAI or Anthropic key
    if (!apiKey) {
      return c.json({ valid: false, error: 'API key is required' }, 400);
    }

    if (provider === 'anthropic') {
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }],
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (response.ok || response.status === 200) {
          return c.json({ valid: true, message: 'Anthropic API key is valid' });
        }
        const error = await response.json() as { error?: { message?: string } };
        return c.json({
          valid: false,
          error: error?.error?.message || `HTTP ${response.status}`,
        });
      } catch (err) {
        return c.json({
          valid: false,
          error: err instanceof Error ? err.message : 'Connection failed',
        });
      }
    }

    if (provider === 'openai') {
      try {
        const response = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000),
        });
        if (response.ok) {
          return c.json({ valid: true, message: 'OpenAI API key is valid' });
        }
        const error = await response.json() as { error?: { message?: string } };
        return c.json({
          valid: false,
          error: error?.error?.message || `HTTP ${response.status}`,
        });
      } catch (err) {
        return c.json({
          valid: false,
          error: err instanceof Error ? err.message : 'Connection failed',
        });
      }
    }

    // OpenAI-compatible providers
    const COMPATIBLE_URLS: Record<string, string> = {
      groq: 'https://api.groq.com/openai/v1/models',
      xai: 'https://api.x.ai/v1/models',
      deepseek: 'https://api.deepseek.com/v1/models',
      together: 'https://api.together.xyz/v1/models',
      fireworks: 'https://api.fireworks.ai/inference/v1/models',
      mistral: 'https://api.mistral.ai/v1/models',
      openrouter: 'https://openrouter.ai/api/v1/models',
      cerebras: 'https://api.cerebras.ai/v1/models',
    };

    const compatibleUrl = COMPATIBLE_URLS[provider];
    if (compatibleUrl && apiKey) {
      try {
        const response = await fetch(compatibleUrl, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000),
        });
        if (response.ok) {
          return c.json({ valid: true, message: `${provider} API key is valid` });
        }
        const errBody = await response.json() as { error?: { message?: string } };
        return c.json({
          valid: false,
          error: errBody?.error?.message || `HTTP ${response.status}`,
        });
      } catch (err) {
        return c.json({
          valid: false,
          error: err instanceof Error ? err.message : 'Connection failed',
        });
      }
    }

    // Other providers - accept key without live validation
    if (apiKey && apiKey.length > 0) {
      return c.json({ valid: true, message: `API key accepted for ${provider}` });
    }

    return c.json({ valid: false, error: 'API key is required' }, 400);
  } catch (error) {
    console.error('[OOBE] AI validation error:', error);
    return c.json({ valid: false, error: 'Validation failed' }, 500);
  }
});

/**
 * POST /api/oobe/enable-multiuser
 * Set email + password on the owner account and switch to multi-user auth mode
 */
oobe.post('/enable-multiuser', async (c) => {
  try {
    const db = getDb();
    if (!db) {
      return c.json({ error: 'Database not initialized' }, 500);
    }

    const parsedBody = await parseJsonBody(c);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const parsed = enableMultiUserSchema.safeParse(parsedBody.body);

    if (!parsed.success) {
      const firstError = parsed.error.errors[0]?.message || 'Invalid input';
      return c.json({ error: firstError }, 400);
    }

    const { email, password } = parsed.data;

    // Validate password strength
    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
      return c.json({ error: passwordError }, 400);
    }

    // Find the admin user (owner)
    const admins = await db
      .select()
      .from(users)
      .where(eq(users.role, 'admin'))
      .limit(1);

    if (admins.length === 0) {
      return c.json({ error: 'No admin user found' }, 404);
    }

    const admin = admins[0];

    // Check if email is already taken by another user
    const existingEmail = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);

    if (existingEmail.length > 0 && existingEmail[0].id !== admin.id) {
      return c.json({ error: 'Email already in use' }, 400);
    }

    // Update admin with real email and password
    const passwordHash = hashPassword(password);
    await db
      .update(users)
      .set({
        email: email.toLowerCase(),
        passwordHash,
        updatedAt: new Date(),
      })
      .where(eq(users.id, admin.id));

    // Switch auth mode to multi
    const settings = await getSettingsRaw();
    await updateSettings({
      system: { ...settings.system, authMode: 'multi' as const },
    });

    // Invalidate cached admin
    invalidateLocalAdminCache();

    console.log(`[OOBE] Multi-user mode enabled for: ${email}`);

    return c.json({
      success: true,
      message: 'Multi-user authentication enabled',
    });
  } catch (error) {
    console.error('[OOBE] Enable multi-user error:', error);
    return c.json({ error: 'Failed to enable multi-user mode' }, 500);
  }
});

export { oobe as oobeRoutes };
