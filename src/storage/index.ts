import { LibSQLAdapter } from "./libsql.js";
import type { StorageAdapter } from "./adapter.js";
import { loadConfig } from "../utils/config-loader.js";

interface SettingsYaml {
  storage?: {
    tier: "local" | "memory";
    dbPath?: string;
  };
}

let storage: StorageAdapter | null = null;

/**
 * Initialize storage based on configuration
 */
export async function initStorage(): Promise<StorageAdapter> {
  if (storage) {
    return storage;
  }
  const settings = loadConfig<SettingsYaml>("settings.yml");

  // Support DATABASE_URL env var (e.g. "file:/app/data/profclaw.db" from Docker)
  const databaseUrl = process.env.DATABASE_URL;
  let tier = process.env.STORAGE_TIER || settings.storage?.tier || "memory";
  let dbPathOverride: string | undefined;

  // Normalize tier aliases: "file" and "local" both mean persistent SQLite
  if (tier === "file") {
    tier = "local";
  }

  if (databaseUrl && tier === "memory") {
    // DATABASE_URL implies persistent storage
    tier = "local";
    dbPathOverride = databaseUrl.startsWith("file:")
      ? databaseUrl.slice(5)
      : databaseUrl;
  }

  if (tier === "local") {
    const dbPath = dbPathOverride || process.env.DB_PATH || settings.storage?.dbPath;
    storage = new LibSQLAdapter({ dbPath });
    console.log(
      `[Storage] Initializing LibSQL storage at ${dbPath || "default path"}`,
    );
  } else {
    console.log("[Storage] Initializing in-memory storage (LibSQL in-memory)");
    storage = new LibSQLAdapter({ dbPath: ":memory:" });
  }

  await storage.connect();
  return storage;
}

/**
 * Get the global storage instance
 */
export function getStorage(): StorageAdapter {
  if (!storage) {
    throw new Error("Storage not initialized. Call initStorage() first.");
  }
  return storage;
}

/**
 * Get the raw drizzle database instance for advanced queries
 */
export function getDb(): any {
  if (!storage) {
    throw new Error("Storage not initialized. Call initStorage() first.");
  }
  // Access the internal db property
  return (storage as any).db;
}

/**
 * Get the raw libsql client for executing raw SQL
 */
export function getClient(): any {
  if (!storage) {
    throw new Error("Storage not initialized. Call initStorage() first.");
  }
  return (storage as any).client;
}

export * from "./adapter.js";
export * from "./schema.js";

// =============================================================================
// AI Provider Configuration Persistence
// =============================================================================

export interface SavedProviderConfig {
  type: string;
  apiKey?: string;
  baseUrl?: string;
  resourceName?: string;
  deploymentName?: string;
  apiVersion?: string;
  defaultModel?: string;
  enabled?: boolean;
}

/**
 * Save an AI provider configuration to the database
 */
export async function saveProviderConfig(
  config: SavedProviderConfig,
): Promise<void> {
  const client = getClient();

  // Store as JSON in settings table with category 'ai_providers'
  await client.execute({
    sql: `
      INSERT INTO settings (key, value, category, is_secret, updated_at)
      VALUES (?, ?, 'ai_providers', 1, unixepoch())
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = unixepoch()
    `,
    args: [`provider_${config.type}`, JSON.stringify(config)],
  });
}

/**
 * Load an AI provider configuration from the database
 */
export async function loadProviderConfig(
  type: string,
): Promise<SavedProviderConfig | null> {
  const client = getClient();

  const result = await client.execute({
    sql: `SELECT value FROM settings WHERE key = ? AND category = 'ai_providers'`,
    args: [`provider_${type}`],
  });

  if (result.rows.length === 0) {
    return null;
  }

  try {
    return JSON.parse(result.rows[0].value as string) as SavedProviderConfig;
  } catch {
    return null;
  }
}

/**
 * Load all saved AI provider configurations
 */
export async function loadAllProviderConfigs(): Promise<SavedProviderConfig[]> {
  const client = getClient();

  const result = await client.execute({
    sql: `SELECT value FROM settings WHERE category = 'ai_providers'`,
    args: [],
  });

  return result.rows
    .map((row: { value: unknown }) => {
      try {
        return JSON.parse(row.value as string) as SavedProviderConfig;
      } catch {
        return null;
      }
    })
    .filter(
      (config: SavedProviderConfig | null): config is SavedProviderConfig =>
        config !== null,
    );
}

/**
 * Delete a saved provider configuration
 */
export async function deleteProviderConfig(type: string): Promise<void> {
  const client = getClient();

  await client.execute({
    sql: `DELETE FROM settings WHERE key = ? AND category = 'ai_providers'`,
    args: [`provider_${type}`],
  });
}
