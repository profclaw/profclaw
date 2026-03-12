/**
 * profClaw Operations Tools
 *
 * Ticket, project, and sprint management through AI chat.
 * These tools allow the AI to create and manage profClaw's own data.
 */

import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { ToolDefinition, ToolResult, ToolExecutionContext, ToolAvailability } from '../types.js';
import { getDb } from '../../../storage/index.js';
import { projects, tickets, sprints, ticketComments, ticketHistory } from '../../../storage/schema.js';
import { eq, sql, desc, and, like, or } from 'drizzle-orm';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// Availability Check
// =============================================================================

/** Cache database availability to avoid repeated checks */
let dbAvailabilityCache: ToolAvailability | null = null;
let lastDbCheck = 0;
const DB_CHECK_INTERVAL_MS = 30000; // Recheck every 30 seconds

/**
 * Check if database is available
 * Rechecks periodically in case database becomes available after startup
 */
function checkDatabaseAvailability(): ToolAvailability {
  const now = Date.now();

  // Use cache if recent and was available
  if (dbAvailabilityCache && dbAvailabilityCache.available && now - lastDbCheck < DB_CHECK_INTERVAL_MS) {
    return dbAvailabilityCache;
  }

  try {
    // This will throw if storage is not initialized
    getDb();
    dbAvailabilityCache = { available: true };
    lastDbCheck = now;
  } catch (error) {
    dbAvailabilityCache = {
      available: false,
      reason: 'Database not initialized',
    };
    lastDbCheck = now;
  }

  return dbAvailabilityCache;
}

// =============================================================================
// Schemas
// =============================================================================

const CreateTicketParamsSchema = z.object({
  projectKey: z.string().describe('Project key (e.g., "PC")'),
  title: z.string().min(1).describe('Ticket title'),
  description: z.string().optional().describe('Detailed description'),
  type: z.enum(['task', 'bug', 'story', 'epic', 'subtask', 'feature', 'improvement']).default('task'),
  priority: z.enum(['critical', 'high', 'medium', 'low', 'none']).default('medium'),
  labels: z.array(z.string()).optional().describe('Labels/tags'),
  storyPoints: z.number().optional().describe('Story points estimate'),
});

const CreateProjectParamsSchema = z.object({
  name: z.string().min(1).describe('Project name'),
  key: z.string().min(2).max(10).describe('Project key prefix (e.g., "PC")'),
  description: z.string().optional().describe('Project description'),
  icon: z.string().optional().describe('Emoji icon (e.g., "🚀")'),
  color: z.string().optional().describe('Hex color (e.g., "#6366f1")'),
});

const ListTicketsParamsSchema = z.object({
  projectKey: z.string().optional().describe('Filter by project'),
  status: z.string().optional().describe('Filter by status'),
  type: z.string().optional().describe('Filter by type'),
  priority: z.string().optional().describe('Filter by priority'),
  search: z.string().optional().describe('Search in title/description'),
  limit: z.number().default(20).describe('Max results'),
});

const ListProjectsParamsSchema = z.object({
  status: z.enum(['active', 'archived', 'all']).default('active'),
});

const UpdateTicketParamsSchema = z.object({
  ticketKey: z.string().describe('Ticket key (e.g., "PC-123")'),
  title: z.string().optional().describe('New title'),
  description: z.string().optional().describe('New description'),
  status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled']).optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low', 'none']).optional(),
  type: z.enum(['task', 'bug', 'story', 'epic', 'subtask', 'feature', 'improvement']).optional(),
  labels: z.array(z.string()).optional(),
  storyPoints: z.number().optional(),
});

const GetTicketParamsSchema = z.object({
  ticketKey: z.string().describe('Ticket key (e.g., "PC-123")'),
});

const AddCommentParamsSchema = z.object({
  ticketKey: z.string().describe('Ticket key (e.g., "PC-123")'),
  content: z.string().min(1).describe('Comment content (supports markdown)'),
});

const MoveTicketParamsSchema = z.object({
  ticketKey: z.string().describe('Ticket key (e.g., "PC-123")'),
  targetProjectKey: z.string().describe('Target project key (e.g., "MOBILE")'),
});

const AssignTicketParamsSchema = z.object({
  ticketKey: z.string().describe('Ticket key (e.g., "PC-123")'),
  assignee: z.string().optional().describe('Human assignee name or email'),
  assigneeAgent: z.enum(['claude', 'openclaw', 'ollama', 'gemini']).optional().describe('AI agent to assign'),
  unassign: z.boolean().optional().describe('Set to true to remove assignment'),
});

export type CreateTicketParams = z.infer<typeof CreateTicketParamsSchema>;
export type CreateProjectParams = z.infer<typeof CreateProjectParamsSchema>;
export type ListTicketsParams = z.infer<typeof ListTicketsParamsSchema>;
export type ListProjectsParams = z.infer<typeof ListProjectsParamsSchema>;
export type UpdateTicketParams = z.infer<typeof UpdateTicketParamsSchema>;
export type GetTicketParams = z.infer<typeof GetTicketParamsSchema>;

// =============================================================================
// Result Types
// =============================================================================

interface TicketResult {
  id: string;
  key: string;
  title: string;
  description?: string;
  status: string;
  type: string;
  priority: string;
  labels?: string[];
  storyPoints?: number;
  projectKey: string;
  createdAt: string;
  /** URL to view this ticket in the UI */
  url: string;
}

interface ProjectResult {
  id: string;
  name: string;
  key: string;
  description?: string;
  icon?: string;
  color?: string;
  status: string;
  ticketCount?: number;
}

// =============================================================================
// Helper Functions
// =============================================================================

async function getProjectByKey(key: string) {
  const client = getDb();
  const result = await client.select().from(projects).where(eq(projects.key, key.toUpperCase())).limit(1);
  return result[0] || null;
}

async function getNextTicketSequence(projectId: string): Promise<number> {
  const client = getDb();
  const result = await client
    .select({ maxNum: sql<number>`COALESCE(MAX(${tickets.sequence}), 0)` })
    .from(tickets)
    .where(eq(tickets.projectId, projectId));
  return (result[0]?.maxNum || 0) + 1;
}

async function getTicketByKey(ticketKey: string) {
  const client = getDb();
  const [projectKey, numStr] = ticketKey.split('-');
  const sequence = parseInt(numStr, 10);

  if (!projectKey || isNaN(sequence)) {
    return null;
  }

  const project = await getProjectByKey(projectKey);
  if (!project) return null;

  const result = await client
    .select()
    .from(tickets)
    .where(and(eq(tickets.projectId, project.id), eq(tickets.sequence, sequence)))
    .limit(1);

  return result[0] ? { ...result[0], projectKey: project.key } : null;
}

/**
 * Safely format a date value to ISO string
 * Handles Date objects, timestamps, and invalid values
 */
function formatDateSafe(value: unknown): string {
  if (!value) return new Date().toISOString();

  // If it's already a valid Date
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString();
  }

  // If it's a number (Unix timestamp in seconds or ms)
  if (typeof value === 'number') {
    // Detect if it's seconds or milliseconds
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  // If it's a string, try to parse it
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  // Fallback to now
  return new Date().toISOString();
}

// =============================================================================
// Create Ticket Tool
// =============================================================================

export const createTicketTool: ToolDefinition<CreateTicketParams, TicketResult> = {
  name: 'create_ticket',
  description: `Create a new ticket/task/bug in profClaw. Use AFTER list_projects to get a valid projectKey.

IMPORTANT: You MUST call this tool after list_projects when the user asks to create a ticket/task/bug.
Required params: projectKey (from list_projects), title (from user request)
Optional: type (bug/feature/task), priority, description

The response includes a 'url' field - use this to create a clickable markdown link in your summary:
Example: "Created ticket [PC-42](/tickets/abc123)"

DO NOT just list projects and stop - you must CREATE the ticket to complete the user's request.`,
  category: 'profclaw',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: CreateTicketParamsSchema,
  isAvailable: checkDatabaseAvailability,
  examples: [
    {
      description: 'Create a bug ticket',
      params: { projectKey: 'PC', title: 'Fix login button', type: 'bug', priority: 'high' },
    },
    {
      description: 'Create a feature with description',
      params: {
        projectKey: 'PC',
        title: 'Add dark mode',
        description: 'Implement dark mode toggle in settings',
        type: 'feature',
      },
    },
  ],

  async execute(_context: ToolExecutionContext, params: CreateTicketParams): Promise<ToolResult<TicketResult>> {
    try {
      const client = getDb();

      // Get project
      const project = await getProjectByKey(params.projectKey);
      if (!project) {
        return {
          success: false,
          error: {
            code: 'PROJECT_NOT_FOUND',
            message: `Project "${params.projectKey}" not found. Use list_projects to see available projects.`,
          },
        };
      }

      // Get next ticket sequence
      const sequence = await getNextTicketSequence(project.id);
      const ticketKey = `${project.key}-${sequence}`;
      const id = randomUUID();
      const now = new Date();

      // Insert ticket - mark as AI-created
      await client.insert(tickets).values({
        id,
        projectId: project.id,
        sequence,
        title: params.title,
        description: params.description || '',
        status: 'backlog',
        type: params.type,
        priority: params.priority,
        labels: params.labels || [],
        estimate: params.storyPoints || null,
        createdBy: 'ai', // Flag as AI-created
        aiAgent: 'profclaw-chat', // Track which AI created it
        createdAt: now,
        updatedAt: now,
      });

      logger.info(`[profClaw] Created ticket ${ticketKey}: ${params.title}`);

      const data: TicketResult = {
        id,
        key: ticketKey,
        title: params.title,
        description: params.description,
        status: 'backlog',
        type: params.type,
        priority: params.priority,
        labels: params.labels,
        storyPoints: params.storyPoints,
        projectKey: project.key,
        createdAt: now.toISOString(),
        url: `/tickets/${id}`,
      };

      const labelsLine = params.labels?.length ? `\n- Labels: ${params.labels.join(', ')}` : '';
      const output = `## Ticket Created\n**${ticketKey}** — ${params.title}\n- Type: ${params.type}\n- Priority: ${params.priority}\n- Status: backlog${labelsLine}`;

      return { success: true, data, output };
    } catch (error) {
      logger.error('[profClaw] Create ticket error:', error instanceof Error ? error : undefined);
      return {
        success: false,
        error: {
          code: 'CREATE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to create ticket',
        },
      };
    }
  },
};

// =============================================================================
// Create Project Tool
// =============================================================================

export const createProjectTool: ToolDefinition<CreateProjectParams, ProjectResult> = {
  name: 'create_project',
  description: `Create a new project in profClaw. Projects organize tickets under a unique key.`,
  category: 'profclaw',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: CreateProjectParamsSchema,
  isAvailable: checkDatabaseAvailability,
  examples: [
    {
      description: 'Create a project',
      params: { name: 'Mobile App', key: 'MOBILE', icon: '📱' },
    },
  ],

  async execute(_context: ToolExecutionContext, params: CreateProjectParams): Promise<ToolResult<ProjectResult>> {
    try {
      const client = getDb();
      const key = params.key.toUpperCase();

      // Check if key exists
      const existing = await getProjectByKey(key);
      if (existing) {
        return {
          success: false,
          error: {
            code: 'KEY_EXISTS',
            message: `Project key "${key}" already exists`,
          },
        };
      }

      const id = randomUUID();
      const now = new Date();

      // Get next project sequence
      const maxSeq = await client.select({ max: sql<number>`COALESCE(MAX(sequence), 0)` }).from(projects);
      const sequence = (maxSeq[0]?.max || 0) + 1;

      await client.insert(projects).values({
        id,
        sequence,
        name: params.name,
        key,
        description: params.description || null,
        icon: params.icon || '📁',
        color: params.color || '#6366f1',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      logger.info(`[profClaw] Created project ${key}: ${params.name}`);

      const data: ProjectResult = {
        id,
        name: params.name,
        key,
        description: params.description,
        icon: params.icon || '📁',
        color: params.color || '#6366f1',
        status: 'active',
      };

      const output = `## Project Created\n**${params.name}** (${key})${params.description ? `\n${params.description}` : ''}`;

      return { success: true, data, output };
    } catch (error) {
      logger.error('[profClaw] Create project error:', error instanceof Error ? error : undefined);
      return {
        success: false,
        error: {
          code: 'CREATE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to create project',
        },
      };
    }
  },
};

// =============================================================================
// List Tickets Tool
// =============================================================================

export const listTicketsTool: ToolDefinition<ListTicketsParams, { tickets: TicketResult[]; total: number }> = {
  name: 'list_tickets',
  description: `List and search tickets in profClaw. Can filter by project, status, type, priority, or search text.`,
  category: 'profclaw',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: ListTicketsParamsSchema,
  isAvailable: checkDatabaseAvailability,
  examples: [
    { description: 'List all tickets', params: {} },
    { description: 'List bugs in a project', params: { projectKey: 'PC', type: 'bug' } },
    { description: 'Search tickets', params: { search: 'login' } },
  ],

  async execute(
    _context: ToolExecutionContext,
    params: ListTicketsParams
  ): Promise<ToolResult<{ tickets: TicketResult[]; total: number }>> {
    try {
      const client = getDb();

      // Build conditions
      const conditions = [];

      if (params.projectKey) {
        const project = await getProjectByKey(params.projectKey);
        if (project) {
          conditions.push(eq(tickets.projectId, project.id));
        }
      }

      if (params.status) {
        conditions.push(eq(tickets.status, params.status));
      }

      if (params.type) {
        conditions.push(eq(tickets.type, params.type));
      }

      if (params.priority) {
        conditions.push(eq(tickets.priority, params.priority));
      }

      if (params.search) {
        conditions.push(
          or(like(tickets.title, `%${params.search}%`), like(tickets.description, `%${params.search}%`))
        );
      }

      // Execute query
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const results = await client
        .select({
          id: tickets.id,
          projectId: tickets.projectId,
          sequence: tickets.sequence,
          title: tickets.title,
          description: tickets.description,
          status: tickets.status,
          type: tickets.type,
          priority: tickets.priority,
          labels: tickets.labels,
          estimate: tickets.estimate,
          createdAt: tickets.createdAt,
        })
        .from(tickets)
        .where(whereClause)
        .orderBy(desc(tickets.createdAt))
        .limit(params.limit);

      // Get project keys for each ticket
      const projectIdSet = new Set<string>();
      for (const t of results) {
        if (t.projectId) projectIdSet.add(t.projectId);
      }
      const projectMap = new Map<string, string>();

      for (const projectId of projectIdSet) {
        const project = await client.select().from(projects).where(eq(projects.id, projectId)).limit(1);
        if (project[0]) {
          projectMap.set(projectId, project[0].key);
        }
      }

      const ticketResults: TicketResult[] = results.map((t: typeof results[0]) => ({
        id: t.id,
        key: `${projectMap.get(t.projectId || '') || 'UNK'}-${t.sequence}`,
        title: t.title,
        description: t.description || undefined,
        status: t.status,
        type: t.type,
        priority: t.priority,
        labels: t.labels || undefined,
        storyPoints: t.estimate || undefined,
        projectKey: projectMap.get(t.projectId || '') || 'UNK',
        createdAt: formatDateSafe(t.createdAt),
        url: `/tickets/${t.id}`,
      }));

      // Build markdown output
      let output: string;
      if (ticketResults.length === 0) {
        output = '## Tickets\n\nNo tickets found matching your criteria.';
      } else {
        const rows = ticketResults.map(
          t => `| ${t.key} | ${t.title} | ${t.status} | ${t.priority} |`
        );
        output = `## Tickets (${ticketResults.length})\n\n| Key | Title | Status | Priority |\n|-----|-------|--------|----------|\n${rows.join('\n')}`;
      }

      return {
        success: true,
        data: { tickets: ticketResults, total: ticketResults.length },
        output,
      };
    } catch (error) {
      logger.error('[profClaw] List tickets error:', error instanceof Error ? error : undefined);
      return {
        success: false,
        error: {
          code: 'LIST_FAILED',
          message: error instanceof Error ? error.message : 'Failed to list tickets',
        },
      };
    }
  },
};

// =============================================================================
// List Projects Tool
// =============================================================================

export const listProjectsTool: ToolDefinition<ListProjectsParams, { projects: ProjectResult[]; hint?: string }> = {
  name: 'list_projects',
  description: `List all projects in profClaw. **REQUIRED FIRST STEP** before creating tickets - returns project keys needed for create_ticket.

WORKFLOW: To create a ticket, you MUST:
1. FIRST call list_projects → get the projectKey (e.g., "PC")
2. THEN call create_ticket with that projectKey

Example: User says "create a bug ticket" →
  - Call list_projects → returns { projects: [{key: "PC", ...}] }
  - Call create_ticket with projectKey="PC", title="...", type="bug"
  - Return summary to user`,
  category: 'profclaw',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: ListProjectsParamsSchema,
  isAvailable: checkDatabaseAvailability,
  examples: [{ description: 'List active projects', params: { status: 'active' } }],

  async execute(
    _context: ToolExecutionContext,
    params: ListProjectsParams
  ): Promise<ToolResult<{ projects: ProjectResult[]; hint?: string }>> {
    try {
      const client = getDb();

      const conditions =
        params.status !== 'all' ? [eq(projects.status, params.status === 'archived' ? 'archived' : 'active')] : [];

      const results = await client
        .select()
        .from(projects)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(projects.name);

      // Get ticket counts
      const projectResults: ProjectResult[] = [];

      for (const p of results) {
        const countResult = await client
          .select({ count: sql<number>`COUNT(*)` })
          .from(tickets)
          .where(eq(tickets.projectId, p.id));

        projectResults.push({
          id: p.id,
          name: p.name,
          key: p.key,
          description: p.description || undefined,
          icon: p.icon || undefined,
          color: p.color || undefined,
          status: p.status,
          ticketCount: countResult[0]?.count || 0,
        });
      }

      // Build hint for AI about next actions
      const projectKeys = projectResults.map(p => p.key).join(', ');
      const hint = projectResults.length > 0
        ? `NEXT STEP: To create a ticket, call create_ticket with one of these projectKeys: ${projectKeys}`
        : `No projects found. Create a project first with create_project, then create tickets in it.`;

      // Build markdown output
      let output: string;
      if (projectResults.length === 0) {
        output = '## Projects\n\nNo projects found. Use `create_project` to create one.';
      } else {
        const lines = projectResults.map(
          p => `- **${p.name}** (${p.key}) — ${p.ticketCount ?? 0} tickets`
        );
        output = `## Projects\n\n${lines.join('\n')}`;
      }

      return {
        success: true,
        data: { projects: projectResults, hint },
        output,
      };
    } catch (error) {
      logger.error('[profClaw] List projects error:', error instanceof Error ? error : undefined);
      return {
        success: false,
        error: {
          code: 'LIST_FAILED',
          message: error instanceof Error ? error.message : 'Failed to list projects',
        },
      };
    }
  },
};

// =============================================================================
// Update Ticket Tool
// =============================================================================

export const updateTicketTool: ToolDefinition<UpdateTicketParams, TicketResult> = {
  name: 'update_ticket',
  description: `Update an existing ticket's status, priority, description, or other fields.`,
  category: 'profclaw',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: UpdateTicketParamsSchema,
  isAvailable: checkDatabaseAvailability,
  examples: [
    { description: 'Mark ticket done', params: { ticketKey: 'PC-123', status: 'done' } },
    { description: 'Update priority', params: { ticketKey: 'PC-123', priority: 'critical' } },
  ],

  async execute(_context: ToolExecutionContext, params: UpdateTicketParams): Promise<ToolResult<TicketResult>> {
    try {
      const client = getDb();

      // Get existing ticket
      const ticket = await getTicketByKey(params.ticketKey);
      if (!ticket) {
        return {
          success: false,
          error: {
            code: 'TICKET_NOT_FOUND',
            message: `Ticket "${params.ticketKey}" not found`,
          },
        };
      }

      // Build update object — updatedAt must be Date (schema uses mode: "timestamp")
      const updates: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (params.title !== undefined) updates.title = params.title;
      if (params.description !== undefined) updates.description = params.description;
      if (params.status !== undefined) updates.status = params.status;
      if (params.priority !== undefined) updates.priority = params.priority;
      if (params.type !== undefined) updates.type = params.type;
      if (params.labels !== undefined) updates.labels = params.labels;
      if (params.storyPoints !== undefined) updates.estimate = params.storyPoints;

      await client.update(tickets).set(updates).where(eq(tickets.id, ticket.id));

      // Get updated ticket
      const updated = await getTicketByKey(params.ticketKey);

      logger.info(`[profClaw] Updated ticket ${params.ticketKey}`);

      const data: TicketResult = {
        id: updated!.id,
        key: params.ticketKey,
        title: updated!.title,
        description: updated!.description || undefined,
        status: updated!.status,
        type: updated!.type,
        priority: updated!.priority,
        labels: updated!.labels || undefined,
        storyPoints: updated!.estimate || undefined,
        projectKey: updated!.projectKey,
        createdAt: formatDateSafe(updated!.createdAt),
        url: `/tickets/${updated!.id}`,
      };

      // Build change summary
      const changes: string[] = [];
      if (params.status !== undefined) changes.push(`- Status: ${ticket.status} → ${params.status}`);
      if (params.priority !== undefined) changes.push(`- Priority: ${ticket.priority} → ${params.priority}`);
      if (params.type !== undefined) changes.push(`- Type: ${ticket.type} → ${params.type}`);
      if (params.title !== undefined) changes.push(`- Title: ${params.title}`);
      if (params.labels !== undefined) changes.push(`- Labels: ${params.labels.join(', ')}`);
      if (params.storyPoints !== undefined) changes.push(`- Story Points: ${params.storyPoints}`);
      const output = `## Ticket Updated\n**${params.ticketKey}** — ${updated!.title}\n${changes.join('\n')}`;

      return { success: true, data, output };
    } catch (error) {
      logger.error('[profClaw] Update ticket error:', error instanceof Error ? error : undefined);
      return {
        success: false,
        error: {
          code: 'UPDATE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to update ticket',
        },
      };
    }
  },
};

// =============================================================================
// Get Ticket Tool
// =============================================================================

export const getTicketTool: ToolDefinition<GetTicketParams, TicketResult> = {
  name: 'get_ticket',
  description: `Get details of a specific ticket by its key.`,
  category: 'profclaw',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: GetTicketParamsSchema,
  isAvailable: checkDatabaseAvailability,
  examples: [{ description: 'Get ticket details', params: { ticketKey: 'PC-123' } }],

  async execute(_context: ToolExecutionContext, params: GetTicketParams): Promise<ToolResult<TicketResult>> {
    try {
      const ticket = await getTicketByKey(params.ticketKey);
      if (!ticket) {
        return {
          success: false,
          error: {
            code: 'TICKET_NOT_FOUND',
            message: `Ticket "${params.ticketKey}" not found`,
          },
        };
      }

      const data: TicketResult = {
        id: ticket.id,
        key: params.ticketKey,
        title: ticket.title,
        description: ticket.description || undefined,
        status: ticket.status,
        type: ticket.type,
        priority: ticket.priority,
        labels: ticket.labels || undefined,
        storyPoints: ticket.estimate || undefined,
        projectKey: ticket.projectKey,
        createdAt: formatDateSafe(ticket.createdAt),
        url: `/tickets/${ticket.id}`,
      };

      const labelsLine = ticket.labels?.length ? `\n- Labels: ${(ticket.labels as string[]).join(', ')}` : '';
      const descLine = ticket.description ? `\n\n${ticket.description}` : '';
      const output = `## ${params.ticketKey} — ${ticket.title}\n- Status: ${ticket.status}\n- Type: ${ticket.type}\n- Priority: ${ticket.priority}${labelsLine}${descLine}`;

      return { success: true, data, output };
    } catch (error) {
      logger.error('[profClaw] Get ticket error:', error instanceof Error ? error : undefined);
      return {
        success: false,
        error: {
          code: 'GET_FAILED',
          message: error instanceof Error ? error.message : 'Failed to get ticket',
        },
      };
    }
  },
};

// =============================================================================
// Exports
// =============================================================================

export const profclawTools = [
  createTicketTool,
  createProjectTool,
  listTicketsTool,
  listProjectsTool,
  updateTicketTool,
  getTicketTool,
];
