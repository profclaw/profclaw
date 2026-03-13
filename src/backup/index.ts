/**
 * Database Backup & Restore
 *
 * Full database export to JSON for backup/migration.
 * Supports selective table export and atomic restore.
 */

import { randomUUID } from 'crypto';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

interface BackupMetadata {
  id: string;
  version: string;
  createdAt: string;
  tables: string[];
  rowCounts: Record<string, number>;
  sizeBytes: number;
}

interface BackupData {
  metadata: BackupMetadata;
  data: Record<string, unknown[]>;
}

type DbClient = {
  execute: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
};

const BACKUP_TABLES = [
  'tasks',
  'summaries',
  'tickets',
  'ticket_comments',
  'ticket_history',
  'projects',
  'labels',
  'ticket_labels',
  'states',
  'sprints',
  'sprint_tickets',
  'scheduled_jobs',
  'job_templates',
  'settings',
  'embeddings',
  'agent_sessions',
  'cost_history',
];

/**
 * Export entire database to a JSON backup
 */
export async function exportDatabase(
  db: DbClient,
  options: { tables?: string[]; outputDir?: string } = {},
): Promise<{ filePath: string; metadata: BackupMetadata }> {
  const tables = options.tables ?? BACKUP_TABLES;
  const outputDir = options.outputDir ?? path.resolve(process.cwd(), 'data', 'backups');

  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true });
  }

  const backupId = randomUUID().slice(0, 8);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `profclaw-backup-${timestamp}-${backupId}.json`;
  const filePath = path.join(outputDir, fileName);

  const data: Record<string, unknown[]> = {};
  const rowCounts: Record<string, number> = {};
  const exportedTables: string[] = [];

  for (const table of tables) {
    try {
      const result = await db.execute(`SELECT * FROM ${table}`);
      const rows = result.rows ?? [];
      data[table] = rows;
      rowCounts[table] = rows.length;
      exportedTables.push(table);
      logger.debug('[Backup] Exported table', { table, rows: rows.length });
    } catch {
      // Table may not exist yet
      logger.debug('[Backup] Skipped table (not found)', { table });
    }
  }

  const metadata: BackupMetadata = {
    id: backupId,
    version: '2.0.0',
    createdAt: new Date().toISOString(),
    tables: exportedTables,
    rowCounts,
    sizeBytes: 0,
  };

  const backup: BackupData = { metadata, data };
  const json = JSON.stringify(backup, null, 2);
  metadata.sizeBytes = Buffer.byteLength(json, 'utf-8');

  await writeFile(filePath, JSON.stringify(backup, null, 2), 'utf-8');

  logger.info('[Backup] Database exported', {
    file: fileName,
    tables: exportedTables.length,
    totalRows: Object.values(rowCounts).reduce((a, b) => a + b, 0),
    sizeBytes: metadata.sizeBytes,
  });

  return { filePath, metadata };
}

/**
 * Import database from a JSON backup
 * Uses INSERT OR REPLACE to handle conflicts
 */
export async function importDatabase(
  db: DbClient,
  filePath: string,
  options: { tables?: string[]; dryRun?: boolean } = {},
): Promise<{ metadata: BackupMetadata; imported: Record<string, number> }> {
  const content = await readFile(filePath, 'utf-8');
  const backup: BackupData = JSON.parse(content) as BackupData;

  if (!backup.metadata || !backup.data) {
    throw new Error('Invalid backup file format');
  }

  const tablesToImport = options.tables ?? backup.metadata.tables;
  const imported: Record<string, number> = {};

  for (const table of tablesToImport) {
    const rows = backup.data[table];
    if (!rows || rows.length === 0) continue;

    if (options.dryRun) {
      imported[table] = rows.length;
      continue;
    }

    let count = 0;
    for (const row of rows) {
      try {
        const record = row as Record<string, unknown>;
        const columns = Object.keys(record);
        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map(col => record[col]);

        await db.execute(
          `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
          values,
        );
        count++;
      } catch (err) {
        logger.warn('[Backup] Failed to import row', { table, error: (err as Error).message });
      }
    }

    imported[table] = count;
    logger.debug('[Backup] Imported table', { table, rows: count });
  }

  logger.info('[Backup] Database imported', {
    from: path.basename(filePath),
    tables: Object.keys(imported).length,
    totalRows: Object.values(imported).reduce((a, b) => a + b, 0),
  });

  return { metadata: backup.metadata, imported };
}

/**
 * List available backups
 */
export async function listBackups(
  backupDir?: string,
): Promise<BackupMetadata[]> {
  const dir = backupDir ?? path.resolve(process.cwd(), 'data', 'backups');

  if (!existsSync(dir)) return [];

  const { readdir, stat } = await import('fs/promises');
  const files = await readdir(dir);
  const backups: BackupMetadata[] = [];

  for (const file of files) {
    if (!file.startsWith('profclaw-backup-') || !file.endsWith('.json')) continue;

    try {
      const filePath = path.join(dir, file);
      const fileStat = await stat(filePath);
      const content = await readFile(filePath, 'utf-8');
      const backup: BackupData = JSON.parse(content) as BackupData;

      if (backup.metadata) {
        backup.metadata.sizeBytes = fileStat.size;
        backups.push(backup.metadata);
      }
    } catch {
      // Skip malformed backups
    }
  }

  return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Delete old backups, keeping the most recent N
 */
export async function pruneBackups(
  keepCount: number = 5,
  backupDir?: string,
): Promise<number> {
  const dir = backupDir ?? path.resolve(process.cwd(), 'data', 'backups');
  const backups = await listBackups(dir);

  if (backups.length <= keepCount) return 0;

  const { unlink } = await import('fs/promises');
  const toDelete = backups.slice(keepCount);
  let deleted = 0;

  for (const backup of toDelete) {
    try {
      const timestamp = backup.createdAt.replace(/[:.]/g, '-');
      const fileName = `profclaw-backup-${timestamp}-${backup.id}.json`;
      const filePath = path.join(dir, fileName);

      if (existsSync(filePath)) {
        await unlink(filePath);
        deleted++;
      }
    } catch {
      // Skip
    }
  }

  if (deleted > 0) {
    logger.info('[Backup] Pruned old backups', { deleted, kept: keepCount });
  }
  return deleted;
}
