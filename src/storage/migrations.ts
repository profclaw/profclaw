/**
 * State Migrations Framework
 *
 * Versioned database migrations with:
 * - Ordered execution by version number
 * - Migration tracking table (prevents re-runs)
 * - Rollback support (best-effort)
 * - Idempotent operations (safe to re-run)
 */

import { logger } from '../utils/logger.js';

// --- Types ---

interface Migration {
  version: number;
  name: string;
  up: (db: MigrationDb) => Promise<void>;
  down?: (db: MigrationDb) => Promise<void>;
}

export interface MigrationRecord {
  version: number;
  name: string;
  appliedAt: string;
  durationMs: number;
}

export type MigrationDb = {
  execute: (sql: string, params?: unknown[]) => Promise<{ rows?: unknown[]; rowsAffected?: number }>;
};

// --- Migration Registry ---

const migrations: Migration[] = [];

/**
 * Register a migration
 */
export function registerMigration(migration: Migration): void {
  migrations.push(migration);
  migrations.sort((a, b) => a.version - b.version);
}

// --- Built-in Migrations ---

// v1: Initial schema marker (represents the base CREATE TABLE IF NOT EXISTS)
registerMigration({
  version: 1,
  name: 'initial_schema',
  up: async () => {
    // Base tables created by initDatabase() - this is a marker only
  },
});

// v2: Add ticket_id to tasks (was inline ALTER TABLE)
registerMigration({
  version: 2,
  name: 'add_ticket_id_to_tasks',
  up: async (db) => {
    await safeAlterTable(db, 'tasks', 'ADD COLUMN ticket_id TEXT');
  },
});

// v3: Add tool_calls to conversations
registerMigration({
  version: 3,
  name: 'add_tool_calls_to_conversations',
  up: async (db) => {
    await safeAlterTable(db, 'conversations', 'ADD COLUMN tool_calls TEXT');
  },
});

// v4: Cost history table
registerMigration({
  version: 4,
  name: 'create_cost_history',
  up: async (db) => {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS cost_history (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        model TEXT NOT NULL,
        provider TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        cost INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'chat',
        agent_id TEXT,
        metadata TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
    await db.execute('CREATE INDEX IF NOT EXISTS idx_cost_history_created ON cost_history(created_at)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_cost_history_model ON cost_history(model)');
  },
  down: async (db) => {
    await db.execute('DROP TABLE IF EXISTS cost_history');
  },
});

// v5: Performance indexes
registerMigration({
  version: 5,
  name: 'add_performance_indexes',
  up: async (db) => {
    await db.execute('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_tickets_project ON tickets(project_id)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status)');
  },
});

// v6: Auto-reply templates storage
registerMigration({
  version: 6,
  name: 'create_auto_reply_templates',
  up: async (db) => {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS auto_reply_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        trigger_config TEXT DEFAULT '{}',
        message TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        channels TEXT DEFAULT '[]',
        cooldown_ms INTEGER NOT NULL DEFAULT 60000,
        max_per_hour INTEGER DEFAULT 10,
        priority INTEGER NOT NULL DEFAULT 50,
        variables TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
  },
  down: async (db) => {
    await db.execute('DROP TABLE IF EXISTS auto_reply_templates');
  },
});

// --- Core Engine ---

/**
 * Ensure the migrations tracking table exists
 */
async function ensureMigrationsTable(db: MigrationDb): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0
    )
  `);
}

/**
 * Safely extract a numeric value from an unknown row field
 */
function extractNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return isNaN(n) ? 0 : n;
}

/**
 * Safely extract a string value from an unknown row field
 */
function extractString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

/**
 * Narrow an unknown row to a Record for field access
 */
function toRecord(row: unknown): Record<string, unknown> {
  if (row !== null && typeof row === 'object') {
    return row as Record<string, unknown>;
  }
  return {};
}

/**
 * Get the current schema version
 */
export async function getCurrentVersion(db: MigrationDb): Promise<number> {
  await ensureMigrationsTable(db);

  const result = await db.execute('SELECT MAX(version) as max_version FROM _migrations');
  const rows = result.rows ?? [];
  if (rows.length === 0) return 0;
  return extractNumber(toRecord(rows[0])['max_version']);
}

/**
 * Get list of applied migrations
 */
export async function getAppliedMigrations(db: MigrationDb): Promise<MigrationRecord[]> {
  await ensureMigrationsTable(db);

  const result = await db.execute(
    'SELECT version, name, applied_at, duration_ms FROM _migrations ORDER BY version',
  );

  return (result.rows ?? []).map((row) => {
    const r = toRecord(row);
    return {
      version: extractNumber(r['version']),
      name: extractString(r['name']),
      appliedAt: extractString(r['applied_at']),
      durationMs: extractNumber(r['duration_ms']),
    };
  });
}

/**
 * Run all pending migrations
 */
export async function runMigrations(db: MigrationDb): Promise<{
  applied: number;
  currentVersion: number;
  migrations: string[];
}> {
  await ensureMigrationsTable(db);

  const currentVersion = await getCurrentVersion(db);
  const pending = migrations.filter(m => m.version > currentVersion);

  if (pending.length === 0) {
    logger.debug('[Migrations] Schema is up to date', { version: currentVersion });
    return { applied: 0, currentVersion, migrations: [] };
  }

  logger.info('[Migrations] Running pending migrations', {
    current: currentVersion,
    pending: pending.length,
  });

  const appliedNames: string[] = [];

  for (const migration of pending) {
    const start = Date.now();
    try {
      await migration.up(db);
      const durationMs = Date.now() - start;

      await db.execute(
        'INSERT INTO _migrations (version, name, applied_at, duration_ms) VALUES (?, ?, ?, ?)',
        [migration.version, migration.name, new Date().toISOString(), durationMs],
      );

      appliedNames.push(`v${migration.version}: ${migration.name}`);
      logger.info('[Migrations] Applied', {
        version: migration.version,
        name: migration.name,
        durationMs,
      });
    } catch (err) {
      logger.error('[Migrations] Failed', {
        version: migration.version,
        name: migration.name,
        error: err instanceof Error ? err.message : String(err),
      });
      // Do not continue after a failure
      break;
    }
  }

  const newVersion = await getCurrentVersion(db);
  return { applied: appliedNames.length, currentVersion: newVersion, migrations: appliedNames };
}

/**
 * Rollback the last N migrations (best-effort - only migrations with a down() are eligible)
 */
export async function rollbackMigrations(
  db: MigrationDb,
  count: number = 1,
): Promise<{ rolledBack: number; currentVersion: number }> {
  const currentVersion = await getCurrentVersion(db);

  // Get migrations to rollback (in reverse order, only those with a down handler)
  const toRollback = migrations
    .filter(m => m.version <= currentVersion && typeof m.down === 'function')
    .sort((a, b) => b.version - a.version)
    .slice(0, count);

  let rolledBack = 0;

  for (const migration of toRollback) {
    try {
      if (migration.down) {
        await migration.down(db);
        await db.execute('DELETE FROM _migrations WHERE version = ?', [migration.version]);
        rolledBack++;
        logger.info('[Migrations] Rolled back', { version: migration.version, name: migration.name });
      }
    } catch (err) {
      logger.error('[Migrations] Rollback failed', {
        version: migration.version,
        error: err instanceof Error ? err.message : String(err),
      });
      break;
    }
  }

  const newVersion = await getCurrentVersion(db);
  return { rolledBack, currentVersion: newVersion };
}

/**
 * Safe ALTER TABLE that ignores "duplicate column" and "no such table" errors
 */
async function safeAlterTable(db: MigrationDb, table: string, alteration: string): Promise<void> {
  try {
    await db.execute(`ALTER TABLE ${table} ${alteration}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // SQLite: "duplicate column name: X" - expected for idempotent migrations
    if (msg.includes('duplicate column')) {
      logger.debug('[Migrations] Column already exists, skipping', { table, alteration });
    } else if (msg.includes('no such table')) {
      logger.debug('[Migrations] Table does not exist, skipping', { table, alteration });
    } else {
      throw err;
    }
  }
}

/**
 * Get migration status summary
 */
export async function getMigrationStatus(db: MigrationDb): Promise<{
  currentVersion: number;
  latestVersion: number;
  pendingCount: number;
  applied: MigrationRecord[];
}> {
  const currentVersion = await getCurrentVersion(db);
  const latestVersion = migrations.length > 0
    ? (migrations[migrations.length - 1]?.version ?? 0)
    : 0;
  const applied = await getAppliedMigrations(db);

  return {
    currentVersion,
    latestVersion,
    pendingCount: migrations.filter(m => m.version > currentVersion).length,
    applied,
  };
}
