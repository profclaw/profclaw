import { z } from 'zod';
import { getStorage } from '../storage/index.js';

// Plugin status enum
export const PluginStatusSchema = z.enum(['enabled', 'disabled', 'error', 'checking']);

// Settings schema with categories
export const SettingsSchema = z.object({
  appearance: z.object({
    theme: z.enum(['light', 'dark', 'midnight', 'system']).default('system'),
  }).default({}),
  aiProvider: z.object({
    defaultProvider: z.enum([
      'anthropic', 'openai', 'google', 'azure', 'ollama', 'openrouter',
      'groq', 'xai', 'mistral', 'cohere', 'perplexity', 'deepseek',
      'together', 'cerebras', 'fireworks', 'copilot',
    ]).optional(),
    openaiKey: z.string().optional(),
    anthropicKey: z.string().optional(),
    ollamaBaseUrl: z.string().optional(),
    providerKeys: z.record(z.string(), z.string()).optional(),
  }).optional(),
  // OAuth provider credentials (stored encrypted in DB)
  oauth: z.object({
    github: z.object({
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      redirectUri: z.string().optional(),
    }).optional(),
    jira: z.object({
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
    }).optional(),
    linear: z.object({
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
    }).optional(),
  }).default({}),
  integrations: z.object({
    ollamaEndpoint: z.string().optional(),
    githubToken: z.string().optional(),
    openclawApiKey: z.string().optional(),
    jiraWebhookSecret: z.string().optional(),
    linearWebhookSecret: z.string().optional(),
  }).default({}),
  notifications: z.object({
    taskComplete: z.boolean().default(true),
    taskFailed: z.boolean().default(true),
    budgetAlerts: z.boolean().default(true),
    dailyDigest: z.boolean().default(false),
    browserNotifications: z.boolean().default(false),
  }).default({}),
  plugins: z.object({
    // MCP Server - allows AI agents to interact via MCP tools
    mcpServer: z.object({
      enabled: z.boolean().default(false),
      allowRead: z.boolean().default(true),
      allowWrite: z.boolean().default(false),
    }).default({}),
    // CLI access - allows shell commands to control profClaw
    cliAccess: z.object({
      enabled: z.boolean().default(false),
      requireAuth: z.boolean().default(true),
    }).default({}),
    // Webhook receivers
    webhooks: z.object({
      github: z.boolean().default(false),
      jira: z.boolean().default(false),
      linear: z.boolean().default(false),
      openclaw: z.boolean().default(false),
    }).default({}),
    // Local AI (Ollama)
    ollama: z.object({
      enabled: z.boolean().default(false),
      autoStart: z.boolean().default(false),
    }).default({}),
  }).default({}),
  system: z.object({
    autonomousExecution: z.boolean().default(false),
    telemetry: z.boolean().default(true),
    debugMode: z.boolean().default(false),
    maxConcurrentTasks: z.number().min(1).max(10).default(3),
    registrationMode: z.enum(['open', 'invite']).default('invite'),
    showForgotPassword: z.boolean().default(true),
    authMode: z.enum(['local', 'multi']).default('local'),
    accessKeyHash: z.string().optional(),
  }).default({}),
});

export type Settings = z.infer<typeof SettingsSchema>;

// Default settings - plugins DISABLED by default for security
const DEFAULT_SETTINGS: Settings = {
  appearance: {
    theme: 'system',
  },
  oauth: {},
  integrations: {},
  notifications: {
    taskComplete: true,
    taskFailed: true,
    budgetAlerts: true,
    dailyDigest: false,
    browserNotifications: false,
  },
  plugins: {
    mcpServer: { enabled: false, allowRead: true, allowWrite: false },
    cliAccess: { enabled: false, requireAuth: true },
    webhooks: { github: false, jira: false, linear: false, openclaw: false },
    ollama: { enabled: false, autoStart: false },
  },
  system: {
    autonomousExecution: false,
    telemetry: true,
    debugMode: false,
    maxConcurrentTasks: 3,
    registrationMode: 'invite' as const,
    showForgotPassword: true,
    authMode: 'local' as const,
  },
};

// Secret fields that should be masked in responses
const SECRET_FIELDS = [
  'integrations.githubToken',
  'integrations.openclawApiKey',
  'integrations.jiraWebhookSecret',
  'integrations.linearWebhookSecret',
  'oauth.github.clientSecret',
  'oauth.jira.clientSecret',
  'oauth.linear.clientSecret',
  'aiProvider.openaiKey',
  'aiProvider.anthropicKey',
  'aiProvider.providerKeys',
  'system.accessKeyHash',
];

// Mask a value for display
function maskValue(value: string): string {
  if (!value || value.length < 8) return '••••••••';
  return value.slice(0, 4) + '••••' + value.slice(-4);
}

// Deep mask secrets in settings object
function maskSecrets(settings: Settings): Settings {
  const masked = JSON.parse(JSON.stringify(settings)) as Settings;

  for (const field of SECRET_FIELDS) {
    const parts = field.split('.');
    let obj: Record<string, unknown> = masked as unknown as Record<string, unknown>;

    // Navigate to the parent of the field
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!obj[part] || typeof obj[part] !== 'object') {
        obj = {} as Record<string, unknown>; // Path doesn't exist
        break;
      }
      obj = obj[part] as Record<string, unknown>;
    }

    // Mask the final field
    const lastKey = parts[parts.length - 1];
    if (obj && typeof obj[lastKey] === 'string' && obj[lastKey]) {
      obj[lastKey] = maskValue(obj[lastKey] as string);
    }
  }

  return masked;
}

// In-memory cache for settings
let settingsCache: Settings | null = null;

/**
 * Get all settings (with secrets masked)
 */
export async function getSettings(): Promise<Settings> {
  if (settingsCache) {
    return maskSecrets(settingsCache);
  }

  const storage = getStorage();

  try {
    // Load settings from storage
    const rows = await storage.query<{ key: string; value: unknown; category: string }>(
      'SELECT key, value, category FROM settings'
    );

    // Build settings object from rows
    const loaded: Record<string, Record<string, unknown>> = {
      appearance: { ...DEFAULT_SETTINGS.appearance },
      oauth: { ...DEFAULT_SETTINGS.oauth },
      integrations: { ...DEFAULT_SETTINGS.integrations },
      notifications: { ...DEFAULT_SETTINGS.notifications },
      system: { ...DEFAULT_SETTINGS.system },
    };

    for (const row of rows) {
      if (loaded[row.category]) {
        // Parse JSON string values from database
        let value = row.value;
        if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
          try {
            value = JSON.parse(value);
          } catch {
            // Keep as string if parse fails
          }
        }
        loaded[row.category][row.key] = value;
      }
    }

    // Validate and cache
    const parsed = SettingsSchema.safeParse(loaded);
    settingsCache = parsed.success ? parsed.data : { ...DEFAULT_SETTINGS };

    return maskSecrets(settingsCache);
  } catch (error) {
    console.warn('[Settings] Failed to load settings, using defaults:', error);
    settingsCache = { ...DEFAULT_SETTINGS };
    return maskSecrets(settingsCache);
  }
}

/**
 * Get raw settings (with actual secret values, for internal use)
 */
export async function getSettingsRaw(): Promise<Settings> {
  if (settingsCache) {
    return settingsCache;
  }

  // Load and cache
  await getSettings();
  return settingsCache || DEFAULT_SETTINGS;
}

/**
 * Get a specific setting value
 */
export async function getSetting<K extends keyof Settings>(
  category: K
): Promise<Settings[K]> {
  const settings = await getSettingsRaw();
  return settings[category];
}

/**
 * Update settings (partial update)
 */
export async function updateSettings(updates: Partial<Settings>): Promise<Settings> {
  const storage = getStorage();
  const current = await getSettingsRaw();

  // Merge updates with current settings
  const merged = {
    appearance: { ...current.appearance, ...updates.appearance },
    oauth: {
      github: { ...current.oauth?.github, ...updates.oauth?.github },
      jira: { ...current.oauth?.jira, ...updates.oauth?.jira },
      linear: { ...current.oauth?.linear, ...updates.oauth?.linear },
    },
    integrations: { ...current.integrations, ...updates.integrations },
    notifications: { ...current.notifications, ...updates.notifications },
    system: { ...current.system, ...updates.system },
    plugins: {
      mcpServer: { ...current.plugins?.mcpServer, ...updates.plugins?.mcpServer },
      cliAccess: { ...current.plugins?.cliAccess, ...updates.plugins?.cliAccess },
      ollama: { ...current.plugins?.ollama, ...updates.plugins?.ollama },
      webhooks: { ...current.plugins?.webhooks, ...updates.plugins?.webhooks },
    },
  };

  // Validate merged settings
  const parsed = SettingsSchema.safeParse(merged);
  if (!parsed.success) {
    throw new Error(`Invalid settings: ${parsed.error.message}`);
  }

  // Save each setting to storage
  const now = new Date();

  for (const [category, values] of Object.entries(parsed.data)) {
    if (!updates[category as keyof Settings]) continue;

    for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
      const isSecret = SECRET_FIELDS.includes(`${category}.${key}`);

      // Skip if value is masked (user didn't update it)
      if (isSecret && typeof value === 'string' && value.includes('••••')) {
        continue;
      }

      await storage.execute(
        `INSERT INTO settings (key, value, category, is_secret, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
        [key, JSON.stringify(value), category, isSecret ? 1 : 0, now.getTime()]
      );
    }
  }

  // Update cache
  settingsCache = parsed.data;

  return maskSecrets(settingsCache);
}

/**
 * Reset settings to defaults
 */
export async function resetSettings(): Promise<Settings> {
  const storage = getStorage();

  await storage.execute('DELETE FROM settings');
  settingsCache = { ...DEFAULT_SETTINGS };

  return maskSecrets(settingsCache);
}

/**
 * Check if a specific integration is configured
 */
export async function isIntegrationConfigured(
  integration: keyof Settings['integrations']
): Promise<boolean> {
  const settings = await getSettingsRaw();
  const value = settings.integrations[integration];
  return Boolean(value && value.length > 0);
}

// Validation schema for updates
export const UpdateSettingsSchema = SettingsSchema.partial();

// =============================================================================
// OAuth Configuration Getters (env vars override DB)
// =============================================================================

export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Get GitHub OAuth config
 * Priority: env vars > database settings
 */
export async function getGitHubOAuthConfig(): Promise<GitHubOAuthConfig | null> {
  // First check env vars (they take precedence)
  const envClientId = process.env.GITHUB_CLIENT_ID;
  const envClientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (envClientId && envClientSecret) {
    return {
      clientId: envClientId,
      clientSecret: envClientSecret,
      redirectUri: process.env.GITHUB_CALLBACK_URL || 'http://localhost:5173/api/auth/github/callback',
    };
  }

  // Fall back to database settings
  const settings = await getSettingsRaw();
  const dbConfig = settings.oauth?.github;

  if (dbConfig?.clientId && dbConfig?.clientSecret) {
    return {
      clientId: dbConfig.clientId,
      clientSecret: dbConfig.clientSecret,
      redirectUri: dbConfig.redirectUri || 'http://localhost:5173/api/auth/github/callback',
    };
  }

  return null;
}

/**
 * Check if GitHub OAuth is configured (either via env or DB)
 */
export async function isGitHubOAuthConfigured(): Promise<boolean> {
  const config = await getGitHubOAuthConfig();
  return config !== null;
}

// Plugin health status interface
export interface PluginHealth {
  id: string;
  name: string;
  enabled: boolean;
  status: 'online' | 'offline' | 'error' | 'disabled';
  lastChecked?: Date;
  message?: string;
}

/**
 * Check health status of all plugins
 */
export async function getPluginHealth(): Promise<PluginHealth[]> {
  const settings = await getSettingsRaw();
  const plugins = settings.plugins;
  const health: PluginHealth[] = [];

  // MCP Server
  health.push({
    id: 'mcp-server',
    name: 'MCP Server',
    enabled: plugins.mcpServer?.enabled ?? false,
    status: plugins.mcpServer?.enabled ? 'online' : 'disabled',
    lastChecked: new Date(),
  });

  // CLI Access
  health.push({
    id: 'cli-access',
    name: 'CLI Access',
    enabled: plugins.cliAccess?.enabled ?? false,
    status: plugins.cliAccess?.enabled ? 'online' : 'disabled',
    lastChecked: new Date(),
  });

  // Ollama - check if actually running
  const ollamaEnabled = plugins.ollama?.enabled ?? false;
  let ollamaStatus: 'online' | 'offline' | 'error' | 'disabled' = 'disabled';
  let ollamaMessage: string | undefined;

  if (ollamaEnabled) {
    try {
      const endpoint = settings.integrations.ollamaEndpoint || 'http://localhost:11434';
      const response = await fetch(`${endpoint}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      ollamaStatus = response.ok ? 'online' : 'error';
      if (!response.ok) {
        ollamaMessage = `HTTP ${response.status}`;
      }
    } catch (error) {
      ollamaStatus = 'offline';
      ollamaMessage = error instanceof Error ? error.message : 'Connection failed';
    }
  }

  health.push({
    id: 'ollama',
    name: 'Ollama (Local AI)',
    enabled: ollamaEnabled,
    status: ollamaStatus,
    lastChecked: new Date(),
    message: ollamaMessage,
  });

  // GitHub webhook
  health.push({
    id: 'webhook-github',
    name: 'GitHub Webhook',
    enabled: plugins.webhooks?.github ?? false,
    status: plugins.webhooks?.github ? 'online' : 'disabled',
    lastChecked: new Date(),
  });

  // Jira webhook
  health.push({
    id: 'webhook-jira',
    name: 'Jira Webhook',
    enabled: plugins.webhooks?.jira ?? false,
    status: plugins.webhooks?.jira ? 'online' : 'disabled',
    lastChecked: new Date(),
  });

  // Linear webhook
  health.push({
    id: 'webhook-linear',
    name: 'Linear Webhook',
    enabled: plugins.webhooks?.linear ?? false,
    status: plugins.webhooks?.linear ? 'online' : 'disabled',
    lastChecked: new Date(),
  });

  // OpenClaw webhook
  health.push({
    id: 'webhook-openclaw',
    name: 'OpenClaw Webhook',
    enabled: plugins.webhooks?.openclaw ?? false,
    status: plugins.webhooks?.openclaw ? 'online' : 'disabled',
    lastChecked: new Date(),
  });

  return health;
}

/**
 * Toggle a plugin on/off
 *
 * Updates the enabled state of a plugin. The current settings are fetched
 * and merged with the new enabled state to preserve other plugin settings.
 */
export async function togglePlugin(pluginId: string, enabled: boolean): Promise<Settings> {
  const current = await getSettingsRaw();
  const plugins = { ...current.plugins };

  switch (pluginId) {
    case 'mcp-server':
      plugins.mcpServer = { ...plugins.mcpServer, enabled };
      break;
    case 'cli-access':
      plugins.cliAccess = { ...plugins.cliAccess, enabled };
      break;
    case 'ollama':
      plugins.ollama = { ...plugins.ollama, enabled };
      break;
    case 'webhook-github':
      plugins.webhooks = { ...plugins.webhooks, github: enabled };
      break;
    case 'webhook-jira':
      plugins.webhooks = { ...plugins.webhooks, jira: enabled };
      break;
    case 'webhook-linear':
      plugins.webhooks = { ...plugins.webhooks, linear: enabled };
      break;
    case 'webhook-openclaw':
      plugins.webhooks = { ...plugins.webhooks, openclaw: enabled };
      break;
    default:
      throw new Error(`Unknown plugin: ${pluginId}`);
  }

  return updateSettings({ plugins });
}
