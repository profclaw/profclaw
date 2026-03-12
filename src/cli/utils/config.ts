import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';

export interface CLIConfig {
  apiUrl: string;
  apiToken?: string;
  defaultAgent?: string;
  outputFormat: 'table' | 'json';
}

const DEFAULT_CONFIG: CLIConfig = {
  apiUrl: 'http://localhost:3000',
  outputFormat: 'table',
};

let cachedConfig: CLIConfig | null = null;

/**
 * Get the config file path
 */
export function getConfigPath(): string {
  // Check for project-level config first
  const projectConfig = join(process.cwd(), '.profclaw.json');
  if (existsSync(projectConfig)) {
    return projectConfig;
  }

  // Fall back to user-level config
  return join(homedir(), '.profclaw', 'config.json');
}

/**
 * Load configuration from file
 */
export function getConfig(): CLIConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = getConfigPath();
  let config: CLIConfig = { ...DEFAULT_CONFIG };

  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf-8');
      config = { ...DEFAULT_CONFIG, ...JSON.parse(content) };
    } catch {
      // Use default config on parse error
    }
  }

  // Environment variable overrides
  if (process.env.PROFCLAW_API_URL) {
    config.apiUrl = process.env.PROFCLAW_API_URL;
  }
  if (process.env.PROFCLAW_API_TOKEN) {
    config.apiToken = process.env.PROFCLAW_API_TOKEN;
  }

  cachedConfig = config;
  return config;
}

/**
 * Save configuration to file
 */
export function saveConfig(updates: Partial<CLIConfig>): void {
  const configPath = join(homedir(), '.profclaw', 'config.json');
  const dir = dirname(configPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const current = getConfig();
  const newConfig = { ...current, ...updates };

  writeFileSync(configPath, JSON.stringify(newConfig, null, 2));
  cachedConfig = newConfig;
}

/**
 * Get a specific config value
 */
export function getConfigValue<K extends keyof CLIConfig>(key: K): CLIConfig[K] {
  return getConfig()[key];
}

/**
 * Set a specific config value
 */
export function setConfigValue<K extends keyof CLIConfig>(key: K, value: CLIConfig[K]): void {
  saveConfig({ [key]: value });
}

/**
 * Clear cached config (for testing)
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}
