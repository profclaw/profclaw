/**
 * profClaw Projects profClaw Projects & Sprints Sprints Types
 *
 * Multi-project support with custom ticket prefixes and sprint management.
 * Designed for bi-directional sync with:
 * - Linear Teams
 * - Jira Projects
 * - GitHub Repositories/Projects
 * - Plane Projects
 */

import { z } from 'zod';
import { ExternalPlatform, SyncDirection } from '../tickets/types.js';

// === Project Enums ===

export const ProjectStatus = z.enum(['active', 'archived']);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

// === Sprint Enums ===

export const SprintStatus = z.enum(['planning', 'active', 'completed', 'cancelled']);
export type SprintStatus = z.infer<typeof SprintStatus>;

// === Project External Link (sync with Linear/Jira/GitHub) ===

export const ProjectExternalLinkSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  platform: ExternalPlatform,
  externalId: z.string(),         // Team/Project ID in external system
  externalUrl: z.string().url().optional(),
  syncEnabled: z.boolean().default(true),
  syncDirection: SyncDirection.default('bidirectional'),
  lastSyncedAt: z.string().datetime().optional(),
  syncError: z.string().optional(),
  createdAt: z.string().datetime(),
});

export type ProjectExternalLink = z.infer<typeof ProjectExternalLinkSchema>;

// === Core Project ===

export const ProjectSchema = z.object({
  id: z.string(),
  sequence: z.number(),
  workspaceId: z.string().optional().default('default'),

  // Identity
  key: z.string().min(2).max(10).toUpperCase(), // "PC", "MOBILE", "API"
  name: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().default('📋'),
  color: z.string().default('#6366f1'),

  // Settings
  defaultAssignee: z.string().optional(),
  defaultAgent: z.string().optional(),
  defaultLabels: z.array(z.string()).default([]),

  // Feature toggles
  cycleView: z.boolean().default(true),
  boardView: z.boolean().default(true),

  // Metadata
  lead: z.string().optional(),
  status: ProjectStatus.default('active'),

  // Timestamps
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().optional(),
});

export type Project = z.infer<typeof ProjectSchema>;

// === Project with Relations ===

export interface ProjectWithRelations extends Project {
  externalLinks: ProjectExternalLink[];
  ticketCount?: number;
  activeSprintCount?: number;
  // Stats
  stats?: {
    totalTickets: number;
    openTickets: number;
    inProgressTickets: number;
    doneTickets: number;
    velocity?: number; // Avg completed per sprint
  };
}

// === Create/Update Schemas ===

export const CreateProjectSchema = z.object({
  key: z.string()
    .min(2, 'Project key must be at least 2 characters')
    .max(10, 'Project key must be at most 10 characters')
    .regex(/^[A-Z][A-Z0-9]*$/, 'Project key must start with a letter and contain only uppercase letters and numbers')
    .transform(val => val.toUpperCase()),
  name: z.string().min(1, 'Project name is required'),
  description: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  defaultAssignee: z.string().optional(),
  defaultAgent: z.string().optional(),
  defaultLabels: z.array(z.string()).optional(),
  cycleView: z.boolean().optional(),
  boardView: z.boolean().optional(),
  lead: z.string().optional(),
  // External link on creation (for importing from Linear/Jira/GitHub)
  externalLink: z.object({
    platform: ExternalPlatform,
    externalId: z.string(),
    externalUrl: z.string().url().optional(),
  }).optional(),
});

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

export const UpdateProjectSchema = CreateProjectSchema.partial().omit({ key: true });
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;

// === Sprint Schema ===

export const SprintSchema = z.object({
  id: z.string(),
  sequence: z.number(),          // Sprint 1, Sprint 2, etc.
  projectId: z.string(),

  // Content
  name: z.string().min(1),
  goal: z.string().optional(),
  description: z.string().optional(),

  // Status workflow: planning → active → completed | cancelled
  status: SprintStatus.default('planning'),

  // Timeline
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),

  // Capacity planning
  capacity: z.number().optional(),  // Story points

  // Timestamps
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});

export type Sprint = z.infer<typeof SprintSchema>;

// === Sprint with Stats ===

export interface SprintWithStats extends Sprint {
  ticketCount: number;
  completedCount: number;
  totalPoints: number;
  completedPoints: number;
  // Burndown data
  burndown?: Array<{
    date: string;
    remaining: number;
    ideal: number;
  }>;
}

// === Create/Update Sprint Schemas ===

// Date string validation - accepts YYYY-MM-DD or full ISO datetime
const dateStringSchema = z.string().refine(
  (val) => {
    // Accept YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return true;
    // Accept full ISO datetime
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val)) return true;
    return false;
  },
  { message: 'Invalid date format. Use YYYY-MM-DD or ISO datetime.' }
);

export const CreateSprintSchema = z.object({
  name: z.string().min(1, 'Sprint name is required'),
  goal: z.string().optional(),
  description: z.string().optional(),
  startDate: dateStringSchema.optional(),
  endDate: dateStringSchema.optional(),
  capacity: z.number().optional(),
});

export type CreateSprintInput = z.infer<typeof CreateSprintSchema>;

export const UpdateSprintSchema = CreateSprintSchema.partial();
export type UpdateSprintInput = z.infer<typeof UpdateSprintSchema>;

// === Sprint Ticket Assignment ===

export const SprintTicketSchema = z.object({
  id: z.string(),
  sprintId: z.string(),
  ticketId: z.string(),
  sortOrder: z.number().default(0),
  addedAt: z.string().datetime(),
});

export type SprintTicket = z.infer<typeof SprintTicketSchema>;

export const AddTicketsToSprintSchema = z.object({
  ticketIds: z.array(z.string()).min(1, 'At least one ticket is required'),
});

export type AddTicketsToSprintInput = z.infer<typeof AddTicketsToSprintSchema>;

// === Query Schemas ===

export const ProjectQuerySchema = z.object({
  status: z.union([ProjectStatus, z.array(ProjectStatus)]).optional(),
  search: z.string().optional(),
  workspaceId: z.string().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'name', 'key']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  limit: z.number().min(1).max(100).optional(),
  offset: z.number().min(0).optional(),
  includeArchived: z.boolean().optional(),
});

export type ProjectQuery = z.infer<typeof ProjectQuerySchema>;

export const SprintQuerySchema = z.object({
  projectId: z.string().optional(),
  status: z.union([SprintStatus, z.array(SprintStatus)]).optional(),
  search: z.string().optional(),
  sortBy: z.enum(['createdAt', 'startDate', 'endDate', 'sequence']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  limit: z.number().min(1).max(100).optional(),
  offset: z.number().min(0).optional(),
});

export type SprintQuery = z.infer<typeof SprintQuerySchema>;

// === Platform Mappings (for sync adapters) ===

/**
 * Maps profClaw sprint status to external platform equivalents
 */
export const SPRINT_STATUS_MAP: Record<SprintStatus, Record<string, string>> = {
  planning: { jira: 'future',   linear: 'planned',   github: 'open' },
  active:   { jira: 'active',   linear: 'started',   github: 'open' },
  completed:{ jira: 'closed',   linear: 'completed', github: 'closed' },
  cancelled:{ jira: 'closed',   linear: 'canceled',  github: 'closed' },
};

/**
 * Maps external platform sprint status to profClaw
 */
export const REVERSE_SPRINT_STATUS_MAP: Record<string, Record<string, SprintStatus>> = {
  jira: {
    'future': 'planning',
    'active': 'active',
    'closed': 'completed',
  },
  linear: {
    'planned': 'planning',
    'started': 'active',
    'completed': 'completed',
    'canceled': 'cancelled',
  },
  github: {
    'open': 'active',
    'closed': 'completed',
  },
};

/**
 * Maps profClaw project to external platform entities
 * - Linear: Team
 * - Jira: Project
 * - GitHub: Repository + Project (board)
 */
export const PROJECT_PLATFORM_ENTITIES: Record<string, { entity: string; urlPattern: string }> = {
  linear: {
    entity: 'Team',
    urlPattern: 'https://linear.app/{workspace}/team/{id}',
  },
  jira: {
    entity: 'Project',
    urlPattern: 'https://{domain}.atlassian.net/jira/software/projects/{key}',
  },
  github: {
    entity: 'Repository',
    urlPattern: 'https://github.com/{owner}/{repo}',
  },
  plane: {
    entity: 'Project',
    urlPattern: '{baseUrl}/{workspace}/projects/{id}',
  },
};
