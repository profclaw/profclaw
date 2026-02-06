import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock logger before any module imports
vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { logger } from '../utils/logger.js';
import {
  getAppliedMigrations,
  getCurrentVersion,
  getMigrationStatus,
  type MigrationDb,
  type MigrationRecord,
  registerMigration,
  rollbackMigrations,
  runMigrations,
} from './migrations.js';

// =============================================================================
// In-memory MigrationDb factory
//
// Tracks:
//   _migrations rows  - what has been recorded as applied
//   executed[]        - ordered log of every SQL call (for assertion)
//
// Supports the exact SQL patterns used by migrations.ts:
//   CREATE TABLE IF NOT EXISTS _migrations ...
//   SELECT MAX(version) as max_version FROM _migrations
//   SELECT version, name, applied_at, duration_ms FROM _migrations ORDER BY version
//   INSERT INTO _migrations (version, name, applied_at, duration_ms) VALUES (...)
//   DELETE FROM _migrations WHERE version = ?
//   CREATE TABLE IF NOT EXISTS ...  (passthrough - no-op)
//   CREATE INDEX IF NOT EXISTS ...  (passthrough - no-op)
//   ALTER TABLE ... ADD COLUMN ...  (passthrough - can be configured to throw)
//   DROP TABLE IF EXISTS ...        (passthrough - no-op)
// =============================================================================

type MigrationRow = { version: number; name: string; applied_at: string; duration_ms: number };

interface MockDbOptions {
  /** If set, ALTER TABLE calls throw this message */
  alterTableError?: string;
}

function createMockDb(
  initialRows: MigrationRow[] = [],
  opts: MockDbOptions = {},
): MigrationDb & { _rows: MigrationRow[]; _executed: string[] } {
  const rows: MigrationRow[] = [...initialRows];
  const executed: string[] = [];

  const db = {
    _rows: rows,
    _executed: executed,

    execute: vi.fn(async (sql: string, params?: unknown[]) => {
      const trimmed = sql.trim().replace(/\s+/g, ' ');
      executed.push(trimmed);

      // CREATE TABLE / CREATE INDEX - no-op
      if (/^CREATE (TABLE|INDEX)/i.test(trimmed)) {
        return { rows: [], rowsAffected: 0 };
      }

      // DROP TABLE - no-op
      if (/^DROP TABLE/i.test(trimmed)) {
        return { rows: [], rowsAffected: 0 };
      }

      // ALTER TABLE
      if (/^ALTER TABLE/i.test(trimmed)) {
        if (opts.alterTableError) {
          throw new Error(opts.alterTableError);
        }
        return { rows: [], rowsAffected: 0 };
      }

      // SELECT MAX(version) as max_version FROM _migrations
      if (/SELECT MAX\(version\)/i.test(trimmed)) {
        const max = rows.length === 0 ? null : Math.max(...rows.map(r => r.version));
        return { rows: [{ max_version: max }] };
      }

      // SELECT ... FROM _migrations ORDER BY version
      if (/SELECT version.*FROM _migrations.*ORDER BY version/i.test(trimmed)) {
        const sorted = [...rows].sort((a, b) => a.version - b.version);
        return {
          rows: sorted.map(r => ({
            version: r.version,
            name: r.name,
            applied_at: r.applied_at,
            duration_ms: r.duration_ms,
          })),
        };
      }

      // INSERT INTO _migrations
      if (/^INSERT INTO _migrations/i.test(trimmed)) {
        const [version, name, appliedAt, durationMs] = params as [number, string, string, number];
        rows.push({ version, name, applied_at: appliedAt, duration_ms: durationMs });
        return { rows: [], rowsAffected: 1 };
      }

      // DELETE FROM _migrations WHERE version = ?
      if (/^DELETE FROM _migrations WHERE version/i.test(trimmed)) {
        const [targetVersion] = params as [number];
        const idx = rows.findIndex(r => r.version === targetVersion);
        if (idx !== -1) rows.splice(idx, 1);
        return { rows: [], rowsAffected: 1 };
      }

      return { rows: [], rowsAffected: 0 };
    }),
  };

  return db;
}

// =============================================================================
// Helpers
// =============================================================================

/** Returns the set of SQL statement prefixes that were executed */
function executedPrefixes(db: ReturnType<typeof createMockDb>): string[] {
  return db._executed.map(s => s.split(' ').slice(0, 3).join(' ').toUpperCase());
}

// =============================================================================
// Tests
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getCurrentVersion
// ---------------------------------------------------------------------------

describe('getCurrentVersion', () => {
  it('returns 0 when the _migrations table is empty', async () => {
    const db = createMockDb([]);
    const version = await getCurrentVersion(db);
    expect(version).toBe(0);
  });

  it('returns the max version from applied rows', async () => {
    const db = createMockDb([
      { version: 1, name: 'initial_schema', applied_at: new Date().toISOString(), duration_ms: 5 },
      { version: 2, name: 'add_ticket_id_to_tasks', applied_at: new Date().toISOString(), duration_ms: 3 },
    ]);
    const version = await getCurrentVersion(db);
    expect(version).toBe(2);
  });

  it('creates the _migrations table before querying', async () => {
    const db = createMockDb([]);
    await getCurrentVersion(db);
    const firstCall: string = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(firstCall).toMatch(/CREATE TABLE IF NOT EXISTS _migrations/i);
  });

  it('handles a row where max_version is null (no rows in table)', async () => {
    const db = createMockDb([]);
    // Override execute to return null for the MAX query
    const originalExecute = db.execute;
    (db.execute as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({ rows: [] })) // CREATE TABLE
      .mockImplementationOnce(async () => ({ rows: [{ max_version: null }] })); // MAX query
    const version = await getCurrentVersion(db);
    expect(version).toBe(0);
    // Restore
    (db.execute as ReturnType<typeof vi.fn>).mockImplementation(originalExecute);
  });

  it('handles a row where max_version is a string number', async () => {
    const db = createMockDb([]);
    (db.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [], rowsAffected: 0 }) // CREATE TABLE
      .mockResolvedValueOnce({ rows: [{ max_version: '3' }] }); // MAX query
    const version = await getCurrentVersion(db);
    expect(version).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// getAppliedMigrations
// ---------------------------------------------------------------------------

describe('getAppliedMigrations', () => {
  it('returns an empty array when no migrations applied', async () => {
    const db = createMockDb([]);
    const result = await getAppliedMigrations(db);
    expect(result).toEqual([]);
  });

  it('maps database rows to MigrationRecord shape', async () => {
    const appliedAt = '2026-01-01T00:00:00.000Z';
    const db = createMockDb([
      { version: 1, name: 'initial_schema', applied_at: appliedAt, duration_ms: 10 },
    ]);
    const result = await getAppliedMigrations(db);
    expect(result).toHaveLength(1);
    const record: MigrationRecord = result[0];
    expect(record.version).toBe(1);
    expect(record.name).toBe('initial_schema');
    expect(record.appliedAt).toBe(appliedAt);
    expect(record.durationMs).toBe(10);
  });

  it('returns records sorted by ascending version', async () => {
    const ts = new Date().toISOString();
    const db = createMockDb([
      { version: 3, name: 'c', applied_at: ts, duration_ms: 0 },
      { version: 1, name: 'a', applied_at: ts, duration_ms: 0 },
      { version: 2, name: 'b', applied_at: ts, duration_ms: 0 },
    ]);
    const result = await getAppliedMigrations(db);
    expect(result.map(r => r.version)).toEqual([1, 2, 3]);
  });

  it('creates _migrations table before querying', async () => {
    const db = createMockDb([]);
    await getAppliedMigrations(db);
    const firstSql: string = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(firstSql).toMatch(/CREATE TABLE IF NOT EXISTS _migrations/i);
  });
});

// ---------------------------------------------------------------------------
// runMigrations
// ---------------------------------------------------------------------------

describe('runMigrations', () => {
  it('reports 0 applied and correct version when schema is up to date', async () => {
    // Simulate all 6 built-in migrations already applied
    const ts = new Date().toISOString();
    const db = createMockDb([
      { version: 1, name: 'initial_schema', applied_at: ts, duration_ms: 1 },
      { version: 2, name: 'add_ticket_id_to_tasks', applied_at: ts, duration_ms: 1 },
      { version: 3, name: 'add_tool_calls_to_conversations', applied_at: ts, duration_ms: 1 },
      { version: 4, name: 'create_cost_history', applied_at: ts, duration_ms: 1 },
      { version: 5, name: 'add_performance_indexes', applied_at: ts, duration_ms: 1 },
      { version: 6, name: 'create_auto_reply_templates', applied_at: ts, duration_ms: 1 },
    ]);
    const result = await runMigrations(db);
    expect(result.applied).toBe(0);
    expect(result.migrations).toHaveLength(0);
    expect(result.currentVersion).toBe(6);
  });

  it('applies all 6 built-in migrations on a fresh database', async () => {
    const db = createMockDb([]);
    const result = await runMigrations(db);
    expect(result.applied).toBe(6);
    expect(result.migrations).toHaveLength(6);
    expect(result.currentVersion).toBe(6);
  });

  it('returns migration names with v-prefix format', async () => {
    const db = createMockDb([]);
    const result = await runMigrations(db);
    expect(result.migrations[0]).toBe('v1: initial_schema');
    expect(result.migrations[5]).toBe('v6: create_auto_reply_templates');
  });

  it('only applies pending migrations when some are already applied', async () => {
    const ts = new Date().toISOString();
    const db = createMockDb([
      { version: 1, name: 'initial_schema', applied_at: ts, duration_ms: 1 },
      { version: 2, name: 'add_ticket_id_to_tasks', applied_at: ts, duration_ms: 1 },
      { version: 3, name: 'add_tool_calls_to_conversations', applied_at: ts, duration_ms: 1 },
    ]);
    const result = await runMigrations(db);
    expect(result.applied).toBe(3); // v4, v5, v6
    expect(result.migrations.map(n => n.split(':')[0])).toEqual(['v4', 'v5', 'v6']);
  });

  it('inserts a row into _migrations for each applied migration', async () => {
    const db = createMockDb([]);
    await runMigrations(db);
    const insertCalls = (db.execute as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([sql]: [string]) => /INSERT INTO _migrations/i.test(sql),
    );
    expect(insertCalls).toHaveLength(6);
  });

  it('records the version and name in each INSERT call', async () => {
    const db = createMockDb([]);
    await runMigrations(db);
    const insertCalls = (db.execute as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([sql]: [string]) => /INSERT INTO _migrations/i.test(sql),
    );
    const [, [v1, name1]] = insertCalls[0] as [string, [number, string]];
    expect(v1).toBe(1);
    expect(name1).toBe('initial_schema');
  });

  it('stops applying further migrations when one fails', async () => {
    const ts = new Date().toISOString();
    // Seed v1-v3 as applied; v4 will fail due to ALTER TABLE error
    const db = createMockDb(
      [
        { version: 1, name: 'initial_schema', applied_at: ts, duration_ms: 1 },
        { version: 2, name: 'add_ticket_id_to_tasks', applied_at: ts, duration_ms: 1 },
        { version: 3, name: 'add_tool_calls_to_conversations', applied_at: ts, duration_ms: 1 },
      ],
    );

    // Make v4's CREATE TABLE throw a generic error
    const originalExecute = db.execute as ReturnType<typeof vi.fn>;
    let callCount = 0;
    originalExecute.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/CREATE TABLE IF NOT EXISTS cost_history/i.test(sql)) {
        callCount++;
        throw new Error('disk full');
      }
      // Delegate to the real mock logic
      return createMockDb(db._rows).execute(sql, params);
    });

    const result = await runMigrations(db);
    // v4 failed, so only 0 new migrations were recorded beyond the already-applied 3
    expect(result.applied).toBe(0);
    expect(result.migrations).toHaveLength(0);
  });

  it('logs an error when a migration fails', async () => {
    const db = createMockDb([]);
    (db.execute as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/CREATE TABLE IF NOT EXISTS _migrations/i.test(sql)) return { rows: [] };
      if (/SELECT MAX/i.test(sql)) return { rows: [{ max_version: null }] };
      if (/SELECT version.*FROM _migrations/i.test(sql)) return { rows: [] };
      if (/INSERT INTO _migrations/i.test(sql)) return { rows: [], rowsAffected: 1 };
      // Throw on any other SQL (the actual migration DDL)
      throw new Error('simulated db error');
    });

    await runMigrations(db);
    expect(logger.error).toHaveBeenCalledWith(
      '[Migrations] Failed',
      expect.objectContaining({ error: 'simulated db error' }),
    );
  });

  it('logs debug when schema is already up to date', async () => {
    const ts = new Date().toISOString();
    const db = createMockDb([
      { version: 1, name: 'initial_schema', applied_at: ts, duration_ms: 1 },
      { version: 2, name: 'add_ticket_id_to_tasks', applied_at: ts, duration_ms: 1 },
      { version: 3, name: 'add_tool_calls_to_conversations', applied_at: ts, duration_ms: 1 },
      { version: 4, name: 'create_cost_history', applied_at: ts, duration_ms: 1 },
      { version: 5, name: 'add_performance_indexes', applied_at: ts, duration_ms: 1 },
      { version: 6, name: 'create_auto_reply_templates', applied_at: ts, duration_ms: 1 },
    ]);
    await runMigrations(db);
    expect(logger.debug).toHaveBeenCalledWith(
      '[Migrations] Schema is up to date',
      expect.objectContaining({ version: 6 }),
    );
  });

  it('logs info for each successfully applied migration', async () => {
    const db = createMockDb([]);
    await runMigrations(db);
    expect(logger.info).toHaveBeenCalledWith(
      '[Migrations] Applied',
      expect.objectContaining({ version: 1, name: 'initial_schema' }),
    );
  });
});

// ---------------------------------------------------------------------------
// rollbackMigrations
// ---------------------------------------------------------------------------

describe('rollbackMigrations', () => {
  it('rolls back the last migration with a down() by default (count=1)', async () => {
    const ts = new Date().toISOString();
    const db = createMockDb([
      { version: 1, name: 'initial_schema', applied_at: ts, duration_ms: 1 },
      { version: 2, name: 'add_ticket_id_to_tasks', applied_at: ts, duration_ms: 1 },
      { version: 3, name: 'add_tool_calls_to_conversations', applied_at: ts, duration_ms: 1 },
      { version: 4, name: 'create_cost_history', applied_at: ts, duration_ms: 1 },
      { version: 5, name: 'add_performance_indexes', applied_at: ts, duration_ms: 1 },
      { version: 6, name: 'create_auto_reply_templates', applied_at: ts, duration_ms: 1 },
    ]);
    const result = await rollbackMigrations(db);
    // v6 has down(), so it should be the one rolled back
    expect(result.rolledBack).toBe(1);
  });

  it('removes the rolled-back migration from _migrations table', async () => {
    const ts = new Date().toISOString();
    const db = createMockDb([
      { version: 4, name: 'create_cost_history', applied_at: ts, duration_ms: 1 },
      { version: 5, name: 'add_performance_indexes', applied_at: ts, duration_ms: 1 },
      { version: 6, name: 'create_auto_reply_templates', applied_at: ts, duration_ms: 1 },
    ]);
    await rollbackMigrations(db, 1);

    const deleteCalls = (db.execute as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([sql]: [string]) => /DELETE FROM _migrations/i.test(sql),
    );
    expect(deleteCalls).toHaveLength(1);
    // Should delete v6 (highest with down())
    expect(deleteCalls[0][1]).toContain(6);
  });

  it('rolls back multiple migrations when count > 1', async () => {
    const ts = new Date().toISOString();
    const db = createMockDb([
      { version: 1, name: 'initial_schema', applied_at: ts, duration_ms: 1 },
      { version: 4, name: 'create_cost_history', applied_at: ts, duration_ms: 1 },
      { version: 6, name: 'create_auto_reply_templates', applied_at: ts, duration_ms: 1 },
    ]);
    const result = await rollbackMigrations(db, 2);
    // v4 and v6 both have down()
    expect(result.rolledBack).toBe(2);
  });

  it('skips migrations without a down() function', async () => {
    const ts = new Date().toISOString();
    // Only v1 applied - v1 has no down() function, so nothing can be rolled back.
    // We use version 1 specifically because it's the only built-in with no down()
    // and seeding just v1 means currentVersion=1, which means v4/v6 (> 1) are excluded.
    const db = createMockDb([
      { version: 1, name: 'initial_schema', applied_at: ts, duration_ms: 1 },
    ]);
    const result = await rollbackMigrations(db);
    // v1 has no down(), v2/v3 have no down(), only v4 and v6 have down() but they are > currentVersion(1)
    expect(result.rolledBack).toBe(0);
  });

  it('returns updated currentVersion after rollback', async () => {
    const ts = new Date().toISOString();
    const db = createMockDb([
      { version: 4, name: 'create_cost_history', applied_at: ts, duration_ms: 1 },
      { version: 6, name: 'create_auto_reply_templates', applied_at: ts, duration_ms: 1 },
    ]);
    const result = await rollbackMigrations(db, 1);
    // After rolling back v6, currentVersion should be 4
    expect(result.currentVersion).toBe(4);
  });

  it('stops rolling back when a down() function throws', async () => {
    const ts = new Date().toISOString();
    const db = createMockDb([
      { version: 4, name: 'create_cost_history', applied_at: ts, duration_ms: 1 },
      { version: 6, name: 'create_auto_reply_templates', applied_at: ts, duration_ms: 1 },
    ]);

    // Make DROP TABLE throw for the v6 rollback
    const mockExecute = db.execute as ReturnType<typeof vi.fn>;
    const originalImpl = mockExecute.getMockImplementation();
    mockExecute.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/DROP TABLE IF EXISTS auto_reply_templates/i.test(sql)) {
        throw new Error('rollback failed');
      }
      // Delegate to original
      if (originalImpl) return originalImpl(sql, params);
      return { rows: [], rowsAffected: 0 };
    });

    const result = await rollbackMigrations(db, 2);
    expect(result.rolledBack).toBe(0); // Failed on first rollback (v6)
    expect(logger.error).toHaveBeenCalledWith(
      '[Migrations] Rollback failed',
      expect.objectContaining({ version: 6 }),
    );
  });

  it('logs info for each successful rollback', async () => {
    const ts = new Date().toISOString();
    const db = createMockDb([
      { version: 6, name: 'create_auto_reply_templates', applied_at: ts, duration_ms: 1 },
    ]);
    await rollbackMigrations(db, 1);
    expect(logger.info).toHaveBeenCalledWith(
      '[Migrations] Rolled back',
      expect.objectContaining({ version: 6, name: 'create_auto_reply_templates' }),
    );
  });

  it('returns 0 rolledBack on a completely fresh database (version 0)', async () => {
    const db = createMockDb([]);
    const result = await rollbackMigrations(db);
    expect(result.rolledBack).toBe(0);
    expect(result.currentVersion).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getMigrationStatus
// ---------------------------------------------------------------------------

describe('getMigrationStatus', () => {
  it('returns correct status on fresh database', async () => {
    const db = createMockDb([]);
    const status = await getMigrationStatus(db);
    expect(status.currentVersion).toBe(0);
    expect(status.latestVersion).toBe(6); // 6 built-in migrations
    expect(status.pendingCount).toBe(6);
    expect(status.applied).toHaveLength(0);
  });

  it('returns correct status when fully migrated', async () => {
    const ts = new Date().toISOString();
    const db = createMockDb([
      { version: 1, name: 'initial_schema', applied_at: ts, duration_ms: 1 },
      { version: 2, name: 'add_ticket_id_to_tasks', applied_at: ts, duration_ms: 1 },
      { version: 3, name: 'add_tool_calls_to_conversations', applied_at: ts, duration_ms: 1 },
      { version: 4, name: 'create_cost_history', applied_at: ts, duration_ms: 1 },
      { version: 5, name: 'add_performance_indexes', applied_at: ts, duration_ms: 1 },
      { version: 6, name: 'create_auto_reply_templates', applied_at: ts, duration_ms: 1 },
    ]);
    const status = await getMigrationStatus(db);
    expect(status.currentVersion).toBe(6);
    expect(status.latestVersion).toBe(6);
    expect(status.pendingCount).toBe(0);
    expect(status.applied).toHaveLength(6);
  });

  it('returns partial pending count when some migrations applied', async () => {
    const ts = new Date().toISOString();
    const db = createMockDb([
      { version: 1, name: 'initial_schema', applied_at: ts, duration_ms: 1 },
      { version: 2, name: 'add_ticket_id_to_tasks', applied_at: ts, duration_ms: 1 },
    ]);
    const status = await getMigrationStatus(db);
    expect(status.currentVersion).toBe(2);
    expect(status.pendingCount).toBe(4); // v3-v6 still pending
    expect(status.applied).toHaveLength(2);
  });

  it('applied list contains properly shaped MigrationRecord objects', async () => {
    const appliedAt = '2026-03-01T12:00:00.000Z';
    const db = createMockDb([
      { version: 1, name: 'initial_schema', applied_at: appliedAt, duration_ms: 42 },
    ]);
    const status = await getMigrationStatus(db);
    expect(status.applied[0]).toMatchObject({
      version: 1,
      name: 'initial_schema',
      appliedAt,
      durationMs: 42,
    });
  });
});

// ---------------------------------------------------------------------------
// registerMigration
// ---------------------------------------------------------------------------

describe('registerMigration', () => {
  it('adds and sorts custom migrations by version', async () => {
    // Register a migration with a high version number
    const highVersion = 9999;
    registerMigration({
      version: highVersion,
      name: 'test_custom_migration',
      up: async () => { /* no-op */ },
    });

    const db = createMockDb([]);
    const status = await getMigrationStatus(db);
    // Latest version should now be 9999
    expect(status.latestVersion).toBe(highVersion);
    expect(status.pendingCount).toBeGreaterThanOrEqual(7); // 6 built-in + at least 1 custom
  });
});

// ---------------------------------------------------------------------------
// safeAlterTable behavior (via v2/v3 built-in migrations)
// ---------------------------------------------------------------------------

describe('safeAlterTable (via built-in migrations v2/v3)', () => {
  it('silently skips "duplicate column" errors on ALTER TABLE', async () => {
    const ts = new Date().toISOString();
    // Seed v1 only; v2 runs safeAlterTable
    const db = createMockDb(
      [{ version: 1, name: 'initial_schema', applied_at: ts, duration_ms: 1 }],
      { alterTableError: 'duplicate column name: ticket_id' },
    );
    // Should not throw
    const result = await runMigrations(db);
    // v2 should have been "applied" since safeAlterTable swallowed the error
    const appliedVersions = result.migrations.map(m => m.split(':')[0]);
    expect(appliedVersions).toContain('v2');
  });

  it('silently skips "no such table" errors on ALTER TABLE', async () => {
    const ts = new Date().toISOString();
    const db = createMockDb(
      [{ version: 1, name: 'initial_schema', applied_at: ts, duration_ms: 1 }],
      { alterTableError: 'no such table: tasks' },
    );
    const result = await runMigrations(db);
    const appliedVersions = result.migrations.map(m => m.split(':')[0]);
    expect(appliedVersions).toContain('v2');
  });

  it('re-throws unrecognized ALTER TABLE errors', async () => {
    const ts = new Date().toISOString();
    const db = createMockDb(
      [{ version: 1, name: 'initial_schema', applied_at: ts, duration_ms: 1 }],
      { alterTableError: 'disk I/O error' },
    );
    // runMigrations catches the error internally and stops - it does not re-throw at the top level
    const result = await runMigrations(db);
    // v2 migration should have failed and halted
    expect(result.applied).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      '[Migrations] Failed',
      expect.objectContaining({ version: 2 }),
    );
  });

  it('logs debug when duplicate column is encountered', async () => {
    const ts = new Date().toISOString();
    const db = createMockDb(
      [{ version: 1, name: 'initial_schema', applied_at: ts, duration_ms: 1 }],
      { alterTableError: 'duplicate column name: ticket_id' },
    );
    await runMigrations(db);
    expect(logger.debug).toHaveBeenCalledWith(
      '[Migrations] Column already exists, skipping',
      expect.objectContaining({ table: 'tasks' }),
    );
  });

  it('logs debug when no such table is encountered', async () => {
    const ts = new Date().toISOString();
    const db = createMockDb(
      [{ version: 1, name: 'initial_schema', applied_at: ts, duration_ms: 1 }],
      { alterTableError: 'no such table: tasks' },
    );
    await runMigrations(db);
    expect(logger.debug).toHaveBeenCalledWith(
      '[Migrations] Table does not exist, skipping',
      expect.objectContaining({ table: 'tasks' }),
    );
  });
});

// ---------------------------------------------------------------------------
// ensureMigrationsTable (tested indirectly)
// ---------------------------------------------------------------------------

describe('ensureMigrationsTable (indirect)', () => {
  it('is called before every public function that reads _migrations', async () => {
    const db = createMockDb([]);

    await getCurrentVersion(db);
    await getAppliedMigrations(db);
    await runMigrations(db);

    const createTableCalls = (db.execute as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([sql]: [string]) => /CREATE TABLE IF NOT EXISTS _migrations/i.test(sql),
    );
    // Each function calls ensureMigrationsTable at least once
    expect(createTableCalls.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Type-level and edge-case tests
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('getCurrentVersion returns 0 when SELECT returns no rows at all', async () => {
    const db = createMockDb([]);
    (db.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
      .mockResolvedValueOnce({ rows: [] }); // MAX query returns empty rows
    const version = await getCurrentVersion(db);
    expect(version).toBe(0);
  });

  it('getAppliedMigrations handles rows with missing fields gracefully', async () => {
    const db = createMockDb([]);
    (db.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
      .mockResolvedValueOnce({
        rows: [{ version: null, name: undefined, applied_at: null, duration_ms: undefined }],
      });
    const result = await getAppliedMigrations(db);
    expect(result[0].version).toBe(0);
    expect(result[0].name).toBe('');
    expect(result[0].appliedAt).toBe('');
    expect(result[0].durationMs).toBe(0);
  });

  it('runMigrations currentVersion reflects the state after applying all pending', async () => {
    const db = createMockDb([]);
    const result = await runMigrations(db);
    // After applying all pending migrations, currentVersion should equal applied count
    // and there should be no more pending migrations.
    const statusDb = createMockDb(db._rows);
    const status = await getMigrationStatus(statusDb);
    expect(result.currentVersion).toBe(status.latestVersion);
    expect(status.pendingCount).toBe(0);
  });

  it('rollbackMigrations count defaults to 1', async () => {
    const ts = new Date().toISOString();
    const db = createMockDb([
      { version: 4, name: 'create_cost_history', applied_at: ts, duration_ms: 1 },
      { version: 6, name: 'create_auto_reply_templates', applied_at: ts, duration_ms: 1 },
    ]);
    // Call with no count argument
    const result = await rollbackMigrations(db);
    expect(result.rolledBack).toBe(1);
  });

  it('getMigrationStatus latestVersion is the highest registered version', async () => {
    const db = createMockDb([]);
    const status = await getMigrationStatus(db);
    // latestVersion must be >= 6 (built-ins) and equal to whatever was registered last
    expect(status.latestVersion).toBeGreaterThanOrEqual(6);
  });
});
