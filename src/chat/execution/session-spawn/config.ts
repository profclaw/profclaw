/**
 * Session Spawn Configuration
 *
 * Loads session spawn settings from config/settings.yml with environment variable overrides.
 */

import { loadConfig } from '../../../utils/config-loader.js';

// Types

export interface SessionSpawnConfig {
  enabled: boolean;
  maxDepth: number;
  maxChildrenPerSession: number;
  defaultBudget: number;
  defaultSteps: number;
  rootMultiplier: number;
  defaultMessagePriority: number;
  maxMessagePriority: number;
  cleanup: {
    enabled: boolean;
    intervalMs: number;
    maxAgeMs: number;
  };
}

interface SettingsYaml {
  sessionSpawn?: Partial<SessionSpawnConfig>;
}

// Defaults

const DEFAULT_CONFIG: SessionSpawnConfig = {
  enabled: true,
  maxDepth: 3,
  maxChildrenPerSession: 5,
  defaultBudget: 20_000,
  defaultSteps: 20,
  rootMultiplier: 5,
  defaultMessagePriority: 5,
  maxMessagePriority: 10,
  cleanup: {
    enabled: true,
    intervalMs: 3_600_000, // 1 hour
    maxAgeMs: 86_400_000, // 24 hours
  },
};

// Config Loading

let cachedConfig: SessionSpawnConfig | null = null;

/**
 * Load session spawn configuration from settings.yml with environment overrides.
 * Results are cached for performance.
 */
export function getSessionSpawnConfig(): SessionSpawnConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const settings = loadConfig<SettingsYaml>('settings.yml');
  const yamlConfig = settings.sessionSpawn || {};

  // Merge with defaults, applying environment overrides
  cachedConfig = {
    enabled: parseBoolean(
      process.env.SESSION_SPAWN_ENABLED,
      yamlConfig.enabled ?? DEFAULT_CONFIG.enabled
    ),
    maxDepth: parseNumber(
      process.env.SESSION_SPAWN_MAX_DEPTH,
      yamlConfig.maxDepth ?? DEFAULT_CONFIG.maxDepth
    ),
    maxChildrenPerSession: parseNumber(
      process.env.SESSION_SPAWN_MAX_CHILDREN,
      yamlConfig.maxChildrenPerSession ?? DEFAULT_CONFIG.maxChildrenPerSession
    ),
    defaultBudget: parseNumber(
      process.env.SESSION_SPAWN_DEFAULT_BUDGET,
      yamlConfig.defaultBudget ?? DEFAULT_CONFIG.defaultBudget
    ),
    defaultSteps: parseNumber(
      process.env.SESSION_SPAWN_DEFAULT_STEPS,
      yamlConfig.defaultSteps ?? DEFAULT_CONFIG.defaultSteps
    ),
    rootMultiplier: parseNumber(
      process.env.SESSION_SPAWN_ROOT_MULTIPLIER,
      yamlConfig.rootMultiplier ?? DEFAULT_CONFIG.rootMultiplier
    ),
    defaultMessagePriority: parseNumber(
      process.env.SESSION_SPAWN_MESSAGE_PRIORITY,
      yamlConfig.defaultMessagePriority ?? DEFAULT_CONFIG.defaultMessagePriority
    ),
    maxMessagePriority:
      yamlConfig.maxMessagePriority ?? DEFAULT_CONFIG.maxMessagePriority,
    cleanup: {
      enabled: parseBoolean(
        process.env.SESSION_SPAWN_CLEANUP_ENABLED,
        yamlConfig.cleanup?.enabled ?? DEFAULT_CONFIG.cleanup.enabled
      ),
      intervalMs: parseNumber(
        process.env.SESSION_SPAWN_CLEANUP_INTERVAL,
        yamlConfig.cleanup?.intervalMs ?? DEFAULT_CONFIG.cleanup.intervalMs
      ),
      maxAgeMs: parseNumber(
        process.env.SESSION_SPAWN_MAX_AGE,
        yamlConfig.cleanup?.maxAgeMs ?? DEFAULT_CONFIG.cleanup.maxAgeMs
      ),
    },
  };

  return cachedConfig;
}

/**
 * Clear the cached configuration (useful for testing or config reload).
 */
export function clearSessionSpawnConfigCache(): void {
  cachedConfig = null;
}

/**
 * Get computed root session limits based on config.
 */
export function getRootSessionLimits(): { maxBudget: number; maxSteps: number } {
  const config = getSessionSpawnConfig();
  return {
    maxBudget: config.defaultBudget * config.rootMultiplier,
    maxSteps: config.defaultSteps * config.rootMultiplier,
  };
}

// Helpers

function parseNumber(envValue: string | undefined, defaultValue: number): number {
  if (envValue === undefined || envValue === '') {
    return defaultValue;
  }
  const parsed = parseInt(envValue, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function parseBoolean(envValue: string | undefined, defaultValue: boolean): boolean {
  if (envValue === undefined || envValue === '') {
    return defaultValue;
  }
  return envValue.toLowerCase() === 'true' || envValue === '1';
}
