/**
 * Structured Summaries Module
 *
 * Provides functionality for extracting, storing, and querying
 * structured summaries from AI agent task executions.
 *
 * Phase 7: Structured Summaries
 */

// Storage operations
export {
  createSummary,
  getSummary,
  getTaskSummaries,
  getSessionSummaries,
  querySummaries,
  searchSummaries,
  getSummaryStats,
  getRecentSummaries,
  deleteSummary,
  clearAllSummaries,
} from './storage.js';

// Extraction functions
export {
  extractFromTaskResult,
  extractFromSession,
  extractFromRawOutput,
} from './extractor.js';

// Re-export types
export type {
  Summary,
  CreateSummaryInput,
  SummaryQuery,
  SummaryStats,
  FileChange,
  Decision,
  Blocker,
  Artifact,
  TokenUsage,
  Cost,
} from '../types/summary.js';

export {
  SummarySchema,
  CreateSummaryInputSchema,
  SummaryQuerySchema,
} from '../types/summary.js';
