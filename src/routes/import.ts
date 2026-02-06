/**
 * Import API Routes
 *
 * Handles GitHub Projects import wizard endpoints.
 * Supports both PAT and OAuth authentication.
 */

import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import { eq, desc, sql } from 'drizzle-orm';
import { getDb } from '../storage/index.js';
import { githubTokens, projects, projectExternalLinks, tickets, sprints } from '../storage/schema.js';
import {
  validateGitHubToken,
  listGitHubProjects,
  listGitHubRepos,
  getGitHubProjectPreview,
  type GitHubProject,
  type GitHubProjectPreview,
  type GitHubRepo,
} from '../integrations/github-projects.js';
import { getCookie } from 'hono/cookie';
import { validateSession } from '../auth/auth-service.js';
import { oauthAccounts } from '../storage/schema.js';
import { createProject, createProjectExternalLink } from '../projects/index.js';
import { createSprint } from '../projects/index.js';

export const importRoutes = new Hono();

// Types
interface ImportExecuteRequest {
  projectKey: string;
  projectName: string;
  description?: string;
  icon?: string;
  color?: string;
  importIterations: boolean;
  enableSync: boolean;
  preserveTimestamps: boolean;
  selectedItemIds?: string[]; // Only import selected items
  fieldMappings: {
    status: Record<string, string>;
    priority: Record<string, string>;
    type: Record<string, string>;
  };
}

interface DryRunRequest {
  fieldMappings: {
    status: Record<string, string>;
    priority: Record<string, string>;
    type: Record<string, string>;
  };
  selectedItemIds?: string[];
}

// Token storage helpers
async function storeGitHubToken(
  token: string,
  tokenType: 'pat' | 'oauth',
  username?: string,
  scopes?: string
): Promise<string> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const id = randomUUID();
  const now = new Date();

  await db.insert(githubTokens).values({
    id,
    userId: 'default',
    accessToken: token,
    tokenType,
    scopes,
    githubUsername: username,
    createdAt: now,
    updatedAt: now,
  });

  return id;
}

async function getStoredToken(userId?: string): Promise<string | null> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  // If we have a user ID, try OAuth token first
  if (userId) {
    const oauthResult = await db
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, userId))
      .limit(1);

    if (oauthResult[0]?.accessToken) {
      return oauthResult[0].accessToken;
    }
  }

  // Fallback to github_tokens table
  const result = await db
    .select()
    .from(githubTokens)
    .where(eq(githubTokens.userId, userId || 'default'))
    .limit(1);

  return result[0]?.accessToken || null;
}

// Get user from session cookie
async function getUserFromCookie(c: any): Promise<{ id: string; email: string } | null> {
  const token = getCookie(c, 'glinr_session');
  if (!token) return null;

  const user = await validateSession(token);
  return user ? { id: user.id, email: user.email } : null;
}

async function updateStoredToken(
  token: string,
  tokenType: 'pat' | 'oauth',
  username?: string,
  scopes?: string
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const existing = await db
    .select()
    .from(githubTokens)
    .where(eq(githubTokens.userId, 'default'))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(githubTokens)
      .set({
        accessToken: token,
        tokenType,
        scopes,
        githubUsername: username,
        updatedAt: new Date(),
      })
      .where(eq(githubTokens.id, existing[0].id));
  } else {
    await storeGitHubToken(token, tokenType, username, scopes);
  }
}

// =============================================================================
// ROUTES
// =============================================================================

/**
 * POST /api/import/github/validate-token
 * Validate a GitHub token and optionally store it
 */
importRoutes.post('/github/validate-token', async (c) => {
  try {
    const body = await c.req.json();
    const { token, store = true } = body;

    if (!token) {
      return c.json({ error: 'Token is required' }, 400);
    }

    const validation = await validateGitHubToken(token);

    if (!validation.valid) {
      return c.json({
        valid: false,
        error: validation.error,
      }, 400);
    }

    // Store token if requested
    if (store) {
      await updateStoredToken(token, 'pat', validation.username, 'read:project,repo');
    }

    return c.json({
      valid: true,
      username: validation.username,
      stored: store,
    });
  } catch (error) {
    console.error('[Import] Token validation error:', error);
    return c.json({
      valid: false,
      error: error instanceof Error ? error.message : 'Validation failed',
    }, 500);
  }
});

/**
 * GET /api/import/github/status
 * Check if a GitHub token is stored and valid
 */
importRoutes.get('/github/status', async (c) => {
  try {
    const token = await getStoredToken();

    if (!token) {
      return c.json({
        hasToken: false,
        connected: false,
        message: 'No GitHub token stored',
      });
    }

    const validation = await validateGitHubToken(token);

    return c.json({
      hasToken: true,
      connected: validation.valid,
      username: validation.username,
      error: validation.error,
    });
  } catch (error) {
    console.error('[Import] Status check error:', error);
    return c.json({
      connected: false,
      error: error instanceof Error ? error.message : 'Status check failed',
    });
  }
});

/**
 * GET /api/import/github/projects
 * List GitHub Projects V2 accessible by user's token
 */
importRoutes.get('/github/projects', async (c) => {
  try {
    const user = await getUserFromCookie(c);
    const token = await getStoredToken(user?.id);

    if (!token) {
      return c.json({
        error: 'No GitHub token stored. Please connect your GitHub account first.',
      }, 401);
    }

    const projects = await listGitHubProjects(token);

    return c.json({
      projects,
      count: projects.length,
    });
  } catch (error) {
    console.error('[Import] List projects error:', error);
    return c.json({
      error: error instanceof Error ? error.message : 'Failed to list projects',
    }, 500);
  }
});

/**
 * GET /api/import/github/projects/:projectId/preview
 * Get preview data for a GitHub Project
 */
importRoutes.get('/github/projects/:projectId/preview', async (c) => {
  const projectId = c.req.param('projectId');

  try {
    const token = await getStoredToken();

    if (!token) {
      return c.json({
        error: 'No GitHub token stored',
      }, 401);
    }

    const preview = await getGitHubProjectPreview(token, projectId);

    return c.json(preview);
  } catch (error) {
    console.error('[Import] Project preview error:', error);
    return c.json({
      error: error instanceof Error ? error.message : 'Failed to get project preview',
    }, 500);
  }
});

/**
 * POST /api/import/github/projects/:projectId/dry-run
 * Dry run - show what would be created without executing
 */
importRoutes.post('/github/projects/:projectId/dry-run', async (c) => {
  const projectId = c.req.param('projectId');

  try {
    const body: DryRunRequest = await c.req.json();
    const { fieldMappings, selectedItemIds } = body;

    const token = await getStoredToken();
    if (!token) {
      return c.json({ error: 'No GitHub token stored' }, 401);
    }

    const preview = await getGitHubProjectPreview(token, projectId);

    // Filter to selected items if specified
    const itemsToImport = selectedItemIds
      ? preview.items.filter((item) => selectedItemIds.includes(item.id))
      : preview.items;

    // Analyze each item
    const analyzedItems = itemsToImport.map((item) => {
      const conflicts: Array<{
        field: string;
        severity: 'error' | 'warning' | 'info';
        message: string;
        suggestion?: string;
      }> = [];

      // Check status mapping
      const statusMapped = !item.status || !!fieldMappings.status[item.status];
      if (!statusMapped) {
        conflicts.push({
          field: 'status',
          severity: 'warning',
          message: `Status "${item.status}" is not mapped`,
          suggestion: 'Will use default: backlog',
        });
      }

      // Check priority mapping
      const priorityMapped = !item.priority || !!fieldMappings.priority[item.priority];
      if (!priorityMapped) {
        conflicts.push({
          field: 'priority',
          severity: 'warning',
          message: `Priority "${item.priority}" is not mapped`,
          suggestion: 'Will use default: medium',
        });
      }

      // Check type mapping
      const typeMapped = !item.type || !!fieldMappings.type[item.type];
      if (!typeMapped) {
        conflicts.push({
          field: 'type',
          severity: 'warning',
          message: `Type "${item.type}" is not mapped`,
          suggestion: 'Will use default: task',
        });
      }

      return {
        id: item.id,
        source: item,
        target: {
          title: item.title,
          description: item.body || '',
          status: item.status ? fieldMappings.status[item.status] || 'backlog' : 'backlog',
          priority: item.priority ? fieldMappings.priority[item.priority] || 'medium' : 'medium',
          type: item.type ? fieldMappings.type[item.type] || 'task' : 'task',
          labels: item.labels,
          assignee: item.assignees[0] || null,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        },
        mappingStatus: {
          status: statusMapped ? 'mapped' : 'unmapped',
          priority: priorityMapped ? 'mapped' : 'unmapped',
          type: typeMapped ? 'mapped' : 'unmapped',
        },
        conflicts,
      };
    });

    // Calculate unmapped values
    const unmappedValues = {
      status: [] as string[],
      priority: [] as string[],
      type: [] as string[],
    };

    const seenStatus = new Set<string>();
    const seenPriority = new Set<string>();
    const seenType = new Set<string>();

    for (const item of itemsToImport) {
      if (item.status && !fieldMappings.status[item.status] && !seenStatus.has(item.status)) {
        unmappedValues.status.push(item.status);
        seenStatus.add(item.status);
      }
      if (item.priority && !fieldMappings.priority[item.priority] && !seenPriority.has(item.priority)) {
        unmappedValues.priority.push(item.priority);
        seenPriority.add(item.priority);
      }
      if (item.type && !fieldMappings.type[item.type] && !seenType.has(item.type)) {
        unmappedValues.type.push(item.type);
        seenType.add(item.type);
      }
    }

    const warningCount = analyzedItems.filter((i) => i.conflicts.some((c) => c.severity === 'warning')).length;
    const errorCount = analyzedItems.filter((i) => i.conflicts.some((c) => c.severity === 'error')).length;

    return c.json({
      success: true,
      summary: {
        totalItems: preview.items.length,
        itemsToCreate: itemsToImport.length,
        itemsToSkip: preview.items.length - itemsToImport.length,
        iterations: preview.iterations.length,
        conflicts: {
          errors: errorCount,
          warnings: warningCount,
        },
        unmappedValues,
      },
      items: analyzedItems,
      iterations: preview.iterations,
      fieldMappings,
    });
  } catch (error) {
    console.error('[Import] Dry run error:', error);
    return c.json({
      error: error instanceof Error ? error.message : 'Dry run failed',
    }, 500);
  }
});

/**
 * POST /api/import/github/projects/:projectId/execute
 * Execute the import
 */
importRoutes.post('/github/projects/:projectId/execute', async (c) => {
  const githubProjectId = c.req.param('projectId');

  try {
    const body: ImportExecuteRequest = await c.req.json();
    const {
      projectKey,
      projectName,
      description,
      icon,
      color,
      importIterations,
      enableSync,
      preserveTimestamps = true,
      selectedItemIds,
      fieldMappings,
    } = body;

    // Validate required fields
    if (!projectKey || !projectName) {
      return c.json({
        error: 'projectKey and projectName are required',
      }, 400);
    }

    const token = await getStoredToken();
    if (!token) {
      return c.json({ error: 'No GitHub token stored' }, 401);
    }

    // Get full project data
    const preview = await getGitHubProjectPreview(token, githubProjectId);

    // Filter to selected items if specified
    const itemsToImport = selectedItemIds
      ? preview.items.filter((item) => selectedItemIds.includes(item.id))
      : preview.items;

    // Create GLINR project
    const glinrProject = await createProject({
      key: projectKey.toUpperCase(),
      name: projectName,
      description: description || preview.project.title,
      icon: icon || 'github',
      color: color || '#24292f',
    });

    // Create external link for sync
    const externalLink = await createProjectExternalLink(glinrProject.id, {
      platform: 'github',
      externalId: githubProjectId,
      externalUrl: preview.project.url,
    });

    // Import iterations as sprints
    const createdSprints: any[] = [];
    const iterationToSprintMap = new Map<string, string>();

    if (importIterations && preview.iterations.length > 0) {
      for (const iteration of preview.iterations) {
        const sprint = await createSprint(glinrProject.id, {
          name: iteration.title,
          startDate: iteration.startDate,
          endDate: calculateEndDate(iteration.startDate, iteration.duration),
        });
        createdSprints.push(sprint);
        iterationToSprintMap.set(iteration.title, sprint.id);
      }
    }

    // Import items as tickets
    const db = getDb();
    if (!db) throw new Error('Database not initialized');

    const createdTickets: any[] = [];
    const now = new Date();
    const importedAt = now;

    for (const item of itemsToImport) {
      const ticketId = randomUUID();

      // Map fields using provided mappings
      const status = mapField(item.status, fieldMappings.status, 'backlog');
      const priority = mapField(item.priority, fieldMappings.priority, 'medium');
      const type = mapField(item.type, fieldMappings.type, 'task');

      // Get next sequence
      const sequenceResult = await db
        .select({ sequence: tickets.sequence })
        .from(tickets)
        .where(eq(tickets.projectId, glinrProject.id))
        .orderBy(desc(tickets.sequence))
        .limit(1);
      const nextSequence = ((sequenceResult[0]?.sequence as number) || 0) + 1;

      // Preserve original timestamps or use current time
      const createdAt = preserveTimestamps && item.createdAt
        ? new Date(item.createdAt)
        : now;
      const updatedAt = preserveTimestamps && item.updatedAt
        ? new Date(item.updatedAt)
        : now;

      await db.insert(tickets).values({
        id: ticketId,
        sequence: nextSequence,
        projectId: glinrProject.id,
        title: item.title,
        description: item.body || '',
        type,
        priority,
        status,
        labels: item.labels,
        assignee: item.assignees[0] || null,
        createdAt,
        updatedAt,
        createdBy: 'github-import', // Mark as imported
      } as any);

      createdTickets.push({
        id: ticketId,
        sequence: nextSequence,
        title: item.title,
        githubUrl: item.url,
        githubIssueNumber: item.issueNumber,
        originalCreatedAt: item.createdAt,
      });

      // Create external link for the ticket (for bidirectional sync)
      if (item.issueNumber && item.repoOwner && item.repoName) {
        await db.insert(await import('../storage/schema.js').then(m => m.ticketExternalLinks)).values({
          id: randomUUID(),
          ticketId,
          platform: 'github',
          externalId: `${item.repoOwner}/${item.repoName}#${item.issueNumber}`,
          externalUrl: item.url,
          syncEnabled: enableSync,
          syncDirection: 'bidirectional',
          createdAt: importedAt,
        });
      }
    }

    return c.json({
      success: true,
      project: glinrProject,
      externalLink,
      summary: {
        projectCreated: true,
        projectKey: glinrProject.key,
        sprintsCreated: createdSprints.length,
        ticketsCreated: createdTickets.length,
        syncEnabled: enableSync,
      },
      tickets: createdTickets.slice(0, 10), // First 10 for preview
    });
  } catch (error: any) {
    console.error('[Import] Execute error:', error);

    // Check for unique constraint violation
    if (error.message?.includes('UNIQUE constraint failed')) {
      return c.json({
        error: 'Project key already exists. Please choose a different key.',
      }, 409);
    }

    return c.json({
      error: error instanceof Error ? error.message : 'Import failed',
    }, 500);
  }
});

/**
 * GET /api/import/github/repos
 * List GitHub repositories accessible by the user's token
 */
importRoutes.get('/github/repos', async (c) => {
  try {
    const user = await getUserFromCookie(c);
    const token = await getStoredToken(user?.id);

    if (!token) {
      return c.json({
        error: 'No GitHub token found. Please connect your GitHub account.',
      }, 401);
    }

    const repos = await listGitHubRepos(token, 100);

    // Filter out archived repos by default
    const activeRepos = repos.filter((r) => !r.isArchived);

    return c.json({
      repos: activeRepos,
      count: activeRepos.length,
      archivedCount: repos.length - activeRepos.length,
    });
  } catch (error) {
    console.error('[Import] List repos error:', error);
    return c.json({
      error: error instanceof Error ? error.message : 'Failed to list repositories',
    }, 500);
  }
});

/**
 * DELETE /api/import/github/disconnect
 * Remove stored GitHub token
 */
importRoutes.delete('/github/disconnect', async (c) => {
  try {
    const db = getDb();
    if (!db) throw new Error('Database not initialized');

    await db.delete(githubTokens).where(eq(githubTokens.userId, 'default'));

    return c.json({
      success: true,
      message: 'GitHub disconnected',
    });
  } catch (error) {
    console.error('[Import] Disconnect error:', error);
    return c.json({
      error: error instanceof Error ? error.message : 'Disconnect failed',
    }, 500);
  }
});

// =============================================================================
// HELPERS
// =============================================================================

function mapField(
  value: string | undefined,
  mapping: Record<string, string>,
  defaultValue: string
): string {
  if (!value) return defaultValue;
  return mapping[value] || defaultValue;
}

function calculateEndDate(startDate: string, durationDays: number): string {
  const start = new Date(startDate);
  start.setDate(start.getDate() + durationDays);
  return start.toISOString().split('T')[0];
}
