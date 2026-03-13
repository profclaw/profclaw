/**
 * System Maintenance Tools
 * 
 * Tools for database optimization, data migration, and system health.
 */

import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import { getDb } from '../../../storage/index.js';
import { summaries, summaryBlobs } from '../../../storage/schema.js';
import { eq, sql } from 'drizzle-orm';
import { logger } from '../../../utils/logger.js';

// Schemas

const DbMaintenanceParamsSchema = z.object({
  optimize: z.boolean().default(true).describe('Run VACUUM and ANALYZE'),
  migrateSummaries: z.boolean().default(true).describe('Move rawOutput from main table to blob storage'),
  cleanupLogs: z.boolean().default(false).describe('Clean up old task events (audit logs)'),
});

export type DbMaintenanceParams = z.infer<typeof DbMaintenanceParamsSchema>;

interface DbMaintenanceResult {
  optimized: boolean;
  summariesMigrated: number;
  logsCleaned: number;
}

// Database Maintenance Tool

export const dbMaintenanceTool: ToolDefinition<DbMaintenanceParams, DbMaintenanceResult> = {
  name: 'db_maintenance',
  description: 'Perform system maintenance tasks like database optimization and data migration.',
  category: 'system',
  securityLevel: 'dangerous',
  allowedHosts: ['local'],
  parameters: DbMaintenanceParamsSchema,

  async execute(
    _context: ToolExecutionContext,
    params: DbMaintenanceParams
  ): Promise<ToolResult<DbMaintenanceResult>> {
    const db = await getDb();
    const results: DbMaintenanceResult = {
      optimized: false,
      summariesMigrated: 0,
      logsCleaned: 0,
    };

    try {
      // 1. Database Optimization (Phase 17)
      if (params.optimize) {
        logger.info('[Maintenance] Running database VACUUM and ANALYZE');
        await db.run(sql`VACUUM`);
        await db.run(sql`ANALYZE`);
        results.optimized = true;
      }

      // 2. Summary Migration (Moving rawOutput to separate table)
      if (params.migrateSummaries) {
        logger.info('[Maintenance] Migrating summary raw outputs to blob storage');
        
        // Find summaries that still have rawOutput in the main table
        const legacySummaries = await db
          .select({
            id: summaries.id,
            rawOutput: summaries.rawOutput,
          })
          .from(summaries)
          .where(sql`${summaries.rawOutput} IS NOT NULL AND ${summaries.rawOutput} != ''`);

        logger.info(`[Maintenance] Found ${legacySummaries.length} summaries to migrate`);

        let migratedCount = 0;
        for (const s of legacySummaries) {
          if (!s.rawOutput) continue;

          try {
            // Check if blob already exists to avoid duplicates
            const [existing] = await db
              .select()
              .from(summaryBlobs)
              .where(eq(summaryBlobs.summaryId, s.id));

            if (!existing) {
              await db.insert(summaryBlobs).values({
                id: randomUUID(),
                summaryId: s.id,
                rawOutput: s.rawOutput,
                compressedSize: s.rawOutput.length,
                createdAt: new Date(),
              });
            }

            // Clear the rawOutput and set the flag in the main table
            await db
              .update(summaries)
              .set({
                rawOutput: null,
                hasBlobOutput: true,
              })
              .where(eq(summaries.id, s.id));
            
            migratedCount++;
          } catch (err) {
            logger.error(`[Maintenance] Failed to migrate summary ${s.id}:`, err instanceof Error ? err : undefined);
          }
        }
        results.summariesMigrated = migratedCount;
      }

      return {
        success: true,
        data: results,
      };
    } catch (error) {
      logger.error('[Maintenance] Error during maintenance:', error instanceof Error ? error : undefined);
      return {
        success: false,
        error: {
          code: 'MAINTENANCE_FAILED',
          message: error instanceof Error ? error.message : 'Unknown maintenance error',
        },
      };
    }
  },
};
