import { LibSQLAdapter } from "./libsql.js";
import type { StorageAdapter } from "./adapter.js";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { Client, InValue, Row } from "@libsql/client";
import { loadConfig } from "../utils/config-loader.js";
import * as schema from "./schema.js";
import { createContextualLogger } from "../utils/logger.js";
import { runMigrations, type MigrationDb } from "./migrations.js";

const log = createContextualLogger('Storage');

/**
 * Wraps a libsql Client into the MigrationDb interface expected by runMigrations.
 */
export function buildMigrationDb(client: Client): MigrationDb {
  return {
    execute: async (
      sql: string,
      params?: unknown[],
    ): Promise<{ rows?: unknown[]; rowsAffected?: number }> => {
      const result = await client.execute({
        sql,
        args: (params ?? []) as InValue[],
      });
      return {
        rows: result.rows as unknown[],
        rowsAffected: result.rowsAffected,
      };
    },
  };
}

interface SettingsYaml {
  storage?: {
    tier: "local" | "memory";
    dbPath?: string;
  };
}

let storage: StorageAdapter | null = null;
let storageIsInMemory = false;

/**
 * Returns true if the active storage backend is ephemeral (in-memory).
 * Always returns false before initStorage() has been called.
 */
export function isStorageInMemory(): boolean {
  return storageIsInMemory;
}

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

  // Extract path from DATABASE_URL when present (works for any tier)
  if (databaseUrl) {
    dbPathOverride = databaseUrl.startsWith("file:")
      ? databaseUrl.slice(5)
      : databaseUrl;
    // DATABASE_URL implies persistent storage even if tier was "memory"
    if (tier === "memory") {
      tier = "local";
    }
  }

  if (tier === "local") {
    const dbPath = dbPathOverride || process.env.DB_PATH || settings.storage?.dbPath;
    storage = new LibSQLAdapter({ dbPath });
    storageIsInMemory = false;
    log.info('Initializing LibSQL storage', { dbPath: dbPath || 'default path' });
  } else {
    storageIsInMemory = true;
    log.info('Initializing in-memory storage (LibSQL in-memory)');
    storage = new LibSQLAdapter({ dbPath: ":memory:" });
  }

  await storage.connect();

  // Auto-run migrations on startup so first-time users don't hit schema errors
  try {
    const migrationDb = buildMigrationDb((storage as LibSQLAdapter).getClient());
    const result = await runMigrations(migrationDb);
    if (result.applied > 0) {
      log.info('Auto-migration complete', {
        applied: result.applied,
        currentVersion: result.currentVersion,
        migrations: result.migrations,
      });
    } else {
      log.debug('Schema is up to date', { currentVersion: result.currentVersion });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Auto-migration failed', { error: message });
    throw new Error(
      `Database migration failed during startup: ${message}\n` +
      `To diagnose, run: profclaw db:migrate --verbose`,
    );
  }

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
export function getDb(): LibSQLDatabase<typeof schema> {
  if (!storage) {
    throw new Error("Storage not initialized. Call initStorage() first.");
  }
  return (storage as LibSQLAdapter).getDb();
}

/**
 * Get the raw libsql client for executing raw SQL
 */
export function getClient(): Client {
  if (!storage) {
    throw new Error("Storage not initialized. Call initStorage() first.");
  }
  return (storage as LibSQLAdapter).getClient();
}

/**
 * Close the global storage connection. Call before process exit in CLI commands.
 */
export async function closeStorage(): Promise<void> {
  if (storage) {
    await storage.disconnect();
    storage = null;
  }
}

export * from "./adapter.js";
export * from "./schema.js";

// AI Provider Configuration Persistence

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
    .map((row: Row) => {
      const value = row.value;
      if (typeof value !== "string") {
        return null;
      }
      try {
        return JSON.parse(value) as SavedProviderConfig;
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
