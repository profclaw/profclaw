import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock logger before any module imports
vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  createContextualLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock config-loader so initStorage doesn't need real files on disk
vi.mock('../../utils/config-loader.js', () => ({
  loadConfig: vi.fn(() => ({ storage: { tier: 'memory' } })),
}));

// Mock runMigrations so we control its behaviour in each test
vi.mock('../migrations.js', () => ({
  runMigrations: vi.fn(),
}));

// Mock LibSQLAdapter so no real DB is opened
vi.mock('../libsql.js', () => {
  const mockClient = {
    execute: vi.fn(async () => ({ rows: [], rowsAffected: 0 })),
    close: vi.fn(),
  };
  function LibSQLAdapter(_opts: unknown) {
    return {
      connect: vi.fn(async () => undefined),
      getClient: vi.fn(() => mockClient),
      getDb: vi.fn(),
    };
  }
  return { LibSQLAdapter };
});

import { runMigrations } from '../migrations.js';
import type { MigrationDb } from '../migrations.js';
import { buildMigrationDb } from '../index.js';
import type { Client } from '@libsql/client';

// Cast the mocked function so we can configure its resolved value
const mockRunMigrations = runMigrations as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockClient(): Client {
  return {
    execute: vi.fn(async () => ({ rows: [], rowsAffected: 0 })),
    batch: vi.fn(async () => []),
    transaction: vi.fn(),
    executeMultiple: vi.fn(async () => undefined),
    sync: vi.fn(async () => ({ frames_synced: 0, duration: 0 })),
    close: vi.fn(),
    closed: false,
    protocol: 'file' as const,
  } as unknown as Client;
}

// ---------------------------------------------------------------------------
// buildMigrationDb
// ---------------------------------------------------------------------------

describe('buildMigrationDb', () => {
  it('returns an object with an execute method', () => {
    const client = makeMockClient();
    const db: MigrationDb = buildMigrationDb(client);
    expect(typeof db.execute).toBe('function');
  });

  it('delegates execute() to the underlying libsql client', async () => {
    const client = makeMockClient();
    const mockExecute = client.execute as ReturnType<typeof vi.fn>;
    mockExecute.mockResolvedValueOnce({ rows: [{ max_version: 3 }], rowsAffected: 0 });

    const db = buildMigrationDb(client);
    const result = await db.execute('SELECT MAX(version) as max_version FROM _migrations');

    expect(mockExecute).toHaveBeenCalledOnce();
    expect(result.rows).toEqual([{ max_version: 3 }]);
  });

  it('passes SQL params as InValue args to the client', async () => {
    const client = makeMockClient();
    const mockExecute = client.execute as ReturnType<typeof vi.fn>;
    mockExecute.mockResolvedValueOnce({ rows: [], rowsAffected: 1 });

    const db = buildMigrationDb(client);
    await db.execute('INSERT INTO _migrations (version, name, applied_at, duration_ms) VALUES (?, ?, ?, ?)', [
      1,
      'initial_schema',
      '2026-04-02T00:00:00.000Z',
      5,
    ]);

    expect(mockExecute).toHaveBeenCalledWith({
      sql: 'INSERT INTO _migrations (version, name, applied_at, duration_ms) VALUES (?, ?, ?, ?)',
      args: [1, 'initial_schema', '2026-04-02T00:00:00.000Z', 5],
    });
  });

  it('handles undefined params by forwarding an empty args array', async () => {
    const client = makeMockClient();
    const mockExecute = client.execute as ReturnType<typeof vi.fn>;
    mockExecute.mockResolvedValueOnce({ rows: [], rowsAffected: 0 });

    const db = buildMigrationDb(client);
    await db.execute('CREATE TABLE IF NOT EXISTS test (id TEXT)');

    expect(mockExecute).toHaveBeenCalledWith({
      sql: 'CREATE TABLE IF NOT EXISTS test (id TEXT)',
      args: [],
    });
  });

  it('includes rowsAffected in the returned result', async () => {
    const client = makeMockClient();
    (client.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [],
      rowsAffected: 42,
    });

    const db = buildMigrationDb(client);
    const result = await db.execute('DELETE FROM cost_history WHERE id = ?', ['abc']);

    expect(result.rowsAffected).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// initStorage auto-migration behaviour
//
// Each test calls initStorage() via a fresh dynamic import so the module-level
// `storage` singleton is reset between tests.
// ---------------------------------------------------------------------------

describe('initStorage auto-migration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls runMigrations after storage.connect()', async () => {
    mockRunMigrations.mockResolvedValueOnce({
      applied: 0,
      currentVersion: 6,
      migrations: [],
    });

    const { initStorage } = await import('../index.js');
    await initStorage();

    expect(mockRunMigrations).toHaveBeenCalledOnce();
  });

  it('logs info when migrations are applied on startup', async () => {
    const mockLog = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    // Patch createContextualLogger to capture the log object used by initStorage
    vi.doMock('../../utils/logger.js', () => ({
      logger: mockLog,
      createContextualLogger: vi.fn(() => mockLog),
    }));

    mockRunMigrations.mockResolvedValueOnce({
      applied: 3,
      currentVersion: 6,
      migrations: ['v4: create_cost_history', 'v5: add_performance_indexes', 'v6: create_auto_reply_templates'],
    });

    const { initStorage } = await import('../index.js');
    await initStorage();

    expect(mockLog.info).toHaveBeenCalledWith(
      'Auto-migration complete',
      expect.objectContaining({ applied: 3, currentVersion: 6 }),
    );
  });

  it('throws a descriptive error with profclaw db:migrate hint when migration fails', async () => {
    mockRunMigrations.mockRejectedValueOnce(new Error('disk full'));

    const { initStorage } = await import('../index.js');
    await expect(initStorage()).rejects.toThrow(/profclaw db:migrate --verbose/);
  });

  it('wraps the original error message in the thrown error', async () => {
    mockRunMigrations.mockRejectedValueOnce(new Error('SQLITE_CONSTRAINT'));

    const { initStorage } = await import('../index.js');
    await expect(initStorage()).rejects.toThrow(/SQLITE_CONSTRAINT/);
  });
});
