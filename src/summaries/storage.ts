/**
 * Summary Storage Wrapper
 * 
 * Re-routes summary operations to the persistent storage module.
 */

import type {
  Summary,
  CreateSummaryInput,
  SummaryQuery,
  SummaryStats,
} from '../types/summary.js';
import { getStorage } from '../storage/index.js';

import { getEmbeddingService } from '../ai/embedding-service.js';
import { logger } from '../utils/logger.js';
import { randomUUID } from 'crypto';

/**
 * Create a new summary
 */
export async function createSummary(input: CreateSummaryInput): Promise<Summary> {
  const summary = await getStorage().createSummary(input);

  // Trigger embedding generation in background
  generateAndStoreSummaryEmbedding(summary).catch(err => {
    logger.error(`[Storage] Failed to generate embedding for summary ${summary.id}:`, err);
  });

  return summary;
}

/**
 * Background task to generate and store entity embedding
 */
async function generateAndStoreSummaryEmbedding(summary: Summary): Promise<void> {
  const service = getEmbeddingService();
  const storage = getStorage();

  if (!storage.storeEmbedding) return;

  // Combine key fields for better semantic representation
  const textToIndex = `
    Title: ${summary.title}
    Changes: ${summary.whatChanged}
    Rationale: ${summary.whyChanged || ''}
    Decisions: ${summary.decisions.map(d => d.description).join(', ')}
    Type: ${summary.taskType || ''}
    Component: ${summary.component || ''}
  `.trim();

  const embedding = await service.generateEmbedding(textToIndex);
  
  await storage.storeEmbedding(
    randomUUID(),
    'summary',
    summary.id,
    embedding,
    'semantic-v1'
  );
  
  logger.debug(`[Storage] Stored embedding for summary ${summary.id}`);
}

/**
 * Get a summary by ID
 * @param includeRawOutput - If true, fetches raw output from blob storage (lazy load)
 */
export async function getSummary(id: string, includeRawOutput = false): Promise<Summary | null> {
  return await getStorage().getSummary(id, includeRawOutput);
}

/**
 * Get summaries for a task
 */
export async function getTaskSummaries(taskId: string): Promise<Summary[]> {
  return await getStorage().getTaskSummaries(taskId);
}

/**
 * Get summaries for a session
 */
export async function getSessionSummaries(sessionId: string): Promise<Summary[]> {
  const result = await getStorage().querySummaries({ sessionId });
  return result.summaries;
}

/**
 * Query summaries with filters
 */
export async function querySummaries(query: Partial<SummaryQuery>): Promise<{
  summaries: Summary[];
  total: number;
}> {
  return await getStorage().querySummaries(query);
}

/**
 * Search summaries by text
 */
export async function searchSummaries(
  searchText: string,
  limit = 20
): Promise<Summary[]> {
  const result = await getStorage().querySummaries({ search: searchText, limit });
  return result.summaries;
}

/**
 * Get summary statistics
 */
export async function getSummaryStats(): Promise<SummaryStats> {
  return await getStorage().getSummaryStats();
}

/**
 * Get recent summaries
 */
export async function getRecentSummaries(limit = 50): Promise<Summary[]> {
  const result = await getStorage().querySummaries({ limit });
  return result.summaries;
}

/**
 * Delete a summary
 */
export async function deleteSummary(id: string): Promise<boolean> {
  return await getStorage().deleteSummary(id);
}

/**
 * Clear all summaries (for testing)
 */
export async function clearAllSummaries(): Promise<void> {
  // Not implemented in production storage for safety
  console.warn('[Storage] clearAllSummaries called but not implemented for persistent storage');
}
