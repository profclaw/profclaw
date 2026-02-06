/**
 * Structured Summary Types
 *
 * Schemas for AI work summaries. Replaces random MD files with
 * structured, queryable data about what AI agents did.
 */

import { z } from 'zod';

/**
 * File change record
 */
export const FileChangeSchema = z.object({
  path: z.string(),
  action: z.enum(['created', 'modified', 'deleted', 'renamed']),
  linesAdded: z.number().optional(),
  linesRemoved: z.number().optional(),
  oldPath: z.string().optional(), // For renames
});

export type FileChange = z.infer<typeof FileChangeSchema>;

/**
 * Decision made during task execution
 */
export const DecisionSchema = z.object({
  description: z.string(),
  reason: z.string().optional(),
  alternatives: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type Decision = z.infer<typeof DecisionSchema>;

/**
 * Blocker or issue encountered
 */
export const BlockerSchema = z.object({
  description: z.string(),
  severity: z.enum(['info', 'warning', 'error', 'critical']),
  resolved: z.boolean().default(false),
  resolution: z.string().optional(),
});

export type Blocker = z.infer<typeof BlockerSchema>;

/**
 * Artifact produced by the work
 */
export const ArtifactReferenceSchema = z.object({
  type: z.enum(['commit', 'pull_request', 'branch', 'file', 'comment', 'deployment', 'other']),
  url: z.string().optional(),
  identifier: z.string().optional(), // SHA, PR number, etc.
  title: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type ArtifactReference = z.infer<typeof ArtifactReferenceSchema>;

/**
 * Full structured summary
 */
export const SummarySchema = z.object({
  // Identity
  id: z.string(),
  taskId: z.string().optional(),
  sessionId: z.string().optional(),

  // Timing
  createdAt: z.coerce.date(),
  startedAt: z.coerce.date().optional(),
  completedAt: z.coerce.date().optional(),
  durationMs: z.number().optional(),

  // Agent info
  agent: z.string(), // 'claude-code', 'openclaw', etc.
  model: z.string().optional(),

  // Content
  title: z.string(),
  whatChanged: z.string(), // High-level summary
  whyChanged: z.string().optional(), // Motivation
  howChanged: z.string().optional(), // Technical approach

  // Structured data
  filesChanged: z.array(FileChangeSchema).default([]),
  decisions: z.array(DecisionSchema).default([]),
  blockers: z.array(BlockerSchema).default([]),
  artifacts: z.array(ArtifactReferenceSchema).default([]),

  // Metrics
  tokensUsed: z.object({
    input: z.number(),
    output: z.number(),
    total: z.number(),
  }).optional(),
  cost: z.object({
    amount: z.number(),
    currency: z.string().default('USD'),
  }).optional(),

  // Classification
  taskType: z.string().optional(), // 'feature', 'bugfix', 'refactor', etc.
  component: z.string().optional(), // 'auth', 'api', 'ui', etc.
  labels: z.array(z.string()).default([]),

  // Links
  linkedIssue: z.string().optional(), // GitHub/Jira/Linear issue
  linkedPr: z.string().optional(),
  repository: z.string().optional(),
  branch: z.string().optional(),

  // Raw content (for search)
  rawOutput: z.string().optional(), // Full agent output - lazy loaded from summary_blobs

  // Blob storage flag (Phase 17)
  hasBlobOutput: z.boolean().optional(), // True if rawOutput is in summary_blobs table

  // Metadata
  metadata: z.record(z.unknown()).optional(),
});

export type Summary = z.infer<typeof SummarySchema>;

/** Exported sub-types */
export type TokenUsage = NonNullable<Summary['tokensUsed']>;
export type Cost = NonNullable<Summary['cost']>;
export type Artifact = ArtifactReference;

/**
 * Input for creating a new summary
 */
export const CreateSummaryInputSchema = SummarySchema.omit({
  id: true,
  createdAt: true,
}).partial({
  filesChanged: true,
  decisions: true,
  blockers: true,
  artifacts: true,
  labels: true,
});

export type CreateSummaryInput = z.infer<typeof CreateSummaryInputSchema>;

/**
 * Query parameters for searching summaries
 */
export const SummaryQuerySchema = z.object({
  // Filters
  taskId: z.string().optional(),
  sessionId: z.string().optional(),
  agent: z.string().optional(),
  taskType: z.string().optional(),
  component: z.string().optional(),
  repository: z.string().optional(),

  // Date range
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),

  // Text search
  search: z.string().optional(),

  // Pagination
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),

  // Cursor-based pagination (Phase 17)
  cursorCreatedAt: z.date().optional(),
  cursorId: z.string().optional(),

  // Sorting
  sortBy: z.enum(['createdAt', 'durationMs', 'cost']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type SummaryQuery = z.infer<typeof SummaryQuerySchema>;

/**
 * Summary statistics
 */
export interface SummaryStats {
  totalCount: number;
  byAgent: Record<string, number>;
  byTaskType: Record<string, number>;
  byComponent: Record<string, number>;
  totalTokens: number;
  totalCost: number;
  averageDuration: number;
  filesChangedCount: number;
}
