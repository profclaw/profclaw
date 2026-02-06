/**
 * Sync Engine Configuration
 *
 * Loads sync configuration from YAML with:
 * - Environment variable substitution
 * - Zod validation
 * - Type-safe defaults
 * - Runtime config updates
 */

import { z } from 'zod';
import { loadConfig } from '../utils/config-loader.js';
import type { SyncEngineConfig, SyncAdapterConfig, ConflictStrategy, SyncDirection } from './types.js';
import { logger } from '../utils/logger.js';

// === Zod Schemas ===

const SyncDirectionSchema = z.enum(['push', 'pull', 'bidirectional']).default('bidirectional');

const LinearConfigSchema = z.object({
  enabled: z.boolean().default(false),
  apiKey: z.string().optional(),
  teamId: z.string().optional(),
  syncDirection: SyncDirectionSchema,
  webhookSecret: z.string().optional(),
});

const GitHubConfigSchema = z.object({
  enabled: z.boolean().default(false),
  accessToken: z.string().optional(),
  owner: z.string().optional(),
  repo: z.string().optional(),
  syncDirection: SyncDirectionSchema,
  webhookSecret: z.string().optional(),
  syncLabels: z.array(z.string()).default([]),
});

const JiraConfigSchema = z.object({
  enabled: z.boolean().default(false),
  baseUrl: z.string().url().optional(),
  email: z.string().email().optional(),
  apiToken: z.string().optional(),
  projectKey: z.string().optional(),
  syncDirection: SyncDirectionSchema,
});

const PlaneConfigSchema = z.object({
  enabled: z.boolean().default(false),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  workspaceId: z.string().optional(),
  projectId: z.string().optional(),
  syncDirection: SyncDirectionSchema,
});

const PlatformsConfigSchema = z.object({
  linear: LinearConfigSchema.optional(),
  github: GitHubConfigSchema.optional(),
  jira: JiraConfigSchema.optional(),
  plane: PlaneConfigSchema.optional(),
}).default({});

const SyncConfigSchema = z.object({
  enabled: z.boolean().default(false),
  intervalMs: z.number().min(1000).default(60000),
  maxRetries: z.number().min(0).max(10).default(3),
  retryDelayMs: z.number().min(100).default(1000),
  enableWebhooks: z.boolean().default(true),
  conflictStrategy: z.enum(['local_wins', 'remote_wins', 'latest_wins', 'manual']).default('latest_wins'),
  platforms: PlatformsConfigSchema,
});

const StatusMappingSchema = z.record(z.record(z.string())).optional();

const SettingsSchema = z.object({
  sync: SyncConfigSchema.optional(),
  statusMapping: StatusMappingSchema,
});

// === Type Exports ===

export type SyncConfig = z.infer<typeof SyncConfigSchema>;
export type LinearConfig = z.infer<typeof LinearConfigSchema>;
export type GitHubConfig = z.infer<typeof GitHubConfigSchema>;
export type JiraConfig = z.infer<typeof JiraConfigSchema>;
export type PlaneConfig = z.infer<typeof PlaneConfigSchema>;

// === Default Configuration ===

const DEFAULT_SYNC_CONFIG: SyncConfig = {
  enabled: false,
  intervalMs: 60000,
  maxRetries: 3,
  retryDelayMs: 1000,
  enableWebhooks: true,
  conflictStrategy: 'latest_wins',
  platforms: {},
};

// === Config Loader ===

interface RawSettings {
  sync?: Record<string, unknown>;
  statusMapping?: Record<string, Record<string, string>>;
}

let cachedConfig: SyncConfig | null = null;
let cachedStatusMapping: Record<string, Record<string, string>> | null = null;

/**
 * Load sync configuration from settings.yml
 * Validates with Zod and caches result
 */
export function loadSyncConfig(): SyncConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    const rawSettings = loadConfig<RawSettings>('settings.yml');
    const parsed = SettingsSchema.safeParse(rawSettings);

    if (!parsed.success) {
      logger.warn('[SyncConfig] Validation errors, using defaults', { issues: parsed.error.issues });
      cachedConfig = DEFAULT_SYNC_CONFIG;
      return cachedConfig;
    }

    cachedConfig = parsed.data.sync || DEFAULT_SYNC_CONFIG;
    cachedStatusMapping = parsed.data.statusMapping || null;

    logger.info('[SyncConfig] Loaded configuration', {
      enabled: cachedConfig.enabled,
      platforms: Object.keys(cachedConfig.platforms).filter(
        p => (cachedConfig!.platforms as any)[p]?.enabled
      ),
    });

    return cachedConfig;
  } catch (error) {
    logger.error('[SyncConfig] Failed to load configuration', error as Error);
    cachedConfig = DEFAULT_SYNC_CONFIG;
    return cachedConfig;
  }
}

/**
 * Get status mapping overrides from config
 */
export function getStatusMapping(): Record<string, Record<string, string>> | null {
  if (!cachedConfig) {
    loadSyncConfig();
  }
  return cachedStatusMapping;
}

/**
 * Reload configuration (e.g., after file change)
 */
export function reloadSyncConfig(): SyncConfig {
  cachedConfig = null;
  cachedStatusMapping = null;
  return loadSyncConfig();
}

/**
 * Convert YAML config to SyncEngineConfig format
 */
export function toSyncEngineConfig(config: SyncConfig): SyncEngineConfig {
  const platforms: Record<string, SyncAdapterConfig> = {};

  // Convert Linear config
  if (config.platforms.linear?.enabled && config.platforms.linear.apiKey) {
    platforms.linear = {
      apiKey: config.platforms.linear.apiKey,
      teamId: config.platforms.linear.teamId,
    };
  }

  // Convert GitHub config
  if (config.platforms.github?.enabled &&
      config.platforms.github.accessToken &&
      config.platforms.github.owner &&
      config.platforms.github.repo) {
    platforms.github = {
      accessToken: config.platforms.github.accessToken,
      owner: config.platforms.github.owner,
      repo: config.platforms.github.repo,
    };
  }

  // Convert Jira config
  if (config.platforms.jira?.enabled &&
      config.platforms.jira.baseUrl &&
      config.platforms.jira.email &&
      config.platforms.jira.apiToken) {
    platforms.jira = {
      baseUrl: config.platforms.jira.baseUrl,
      apiKey: config.platforms.jira.apiToken,
      // Jira uses basic auth with email:token
    };
  }

  // Convert Plane config
  if (config.platforms.plane?.enabled &&
      config.platforms.plane.apiKey &&
      config.platforms.plane.workspaceId) {
    platforms.plane = {
      apiKey: config.platforms.plane.apiKey,
      baseUrl: config.platforms.plane.baseUrl,
      workspaceId: config.platforms.plane.workspaceId,
      projectId: config.platforms.plane.projectId,
    };
  }

  return {
    conflictStrategy: config.conflictStrategy as ConflictStrategy,
    syncIntervalMs: config.intervalMs,
    maxRetries: config.maxRetries,
    retryDelayMs: config.retryDelayMs,
    enableWebhooks: config.enableWebhooks,
    platforms,
  };
}

/**
 * Check if sync is enabled for any platform
 */
export function isSyncEnabled(): boolean {
  const config = loadSyncConfig();
  if (!config.enabled) return false;

  return Object.values(config.platforms).some(p => p?.enabled);
}

/**
 * Get enabled platforms
 */
export function getEnabledPlatforms(): string[] {
  const config = loadSyncConfig();
  return Object.entries(config.platforms)
    .filter(([_, p]) => p?.enabled)
    .map(([name]) => name);
}

/**
 * Get platform-specific config
 */
export function getPlatformConfig(platform: string): SyncAdapterConfig | null {
  const config = loadSyncConfig();
  const platformConfig = (config.platforms as any)[platform];

  if (!platformConfig?.enabled) {
    return null;
  }

  switch (platform) {
    case 'linear':
      return {
        apiKey: platformConfig.apiKey,
        teamId: platformConfig.teamId,
      };
    case 'github':
      return {
        accessToken: platformConfig.accessToken,
        owner: platformConfig.owner,
        repo: platformConfig.repo,
      };
    case 'jira':
      return {
        baseUrl: platformConfig.baseUrl,
        apiKey: platformConfig.apiToken,
      };
    case 'plane':
      return {
        apiKey: platformConfig.apiKey,
        baseUrl: platformConfig.baseUrl,
        workspaceId: platformConfig.workspaceId,
        projectId: platformConfig.projectId,
      };
    default:
      return null;
  }
}

/**
 * Validate that required credentials are present
 */
export function validatePlatformCredentials(platform: string): { valid: boolean; missing: string[] } {
  const config = loadSyncConfig();
  const platformConfig = (config.platforms as any)[platform];
  const missing: string[] = [];

  if (!platformConfig) {
    return { valid: false, missing: ['platform configuration'] };
  }

  switch (platform) {
    case 'linear':
      if (!platformConfig.apiKey) missing.push('LINEAR_API_KEY');
      break;
    case 'github':
      if (!platformConfig.accessToken) missing.push('GITHUB_TOKEN');
      if (!platformConfig.owner) missing.push('GITHUB_OWNER');
      if (!platformConfig.repo) missing.push('GITHUB_REPO');
      break;
    case 'jira':
      if (!platformConfig.baseUrl) missing.push('JIRA_BASE_URL');
      if (!platformConfig.email) missing.push('JIRA_EMAIL');
      if (!platformConfig.apiToken) missing.push('JIRA_API_TOKEN');
      break;
    case 'plane':
      if (!platformConfig.apiKey) missing.push('PLANE_API_KEY');
      if (!platformConfig.workspaceId) missing.push('PLANE_WORKSPACE_ID');
      break;
  }

  return { valid: missing.length === 0, missing };
}
