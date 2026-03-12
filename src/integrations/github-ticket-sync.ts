/**
 * GitHub Ticket Sync Handler
 *
 * Handles GitHub webhooks to update synced tickets.
 * This is separate from the task creation handler (github.ts).
 */

import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { getDb } from '../storage/index.js';
import {
  tickets,
  ticketExternalLinks,
  ticketComments,
  ticketHistory,
  githubCommentSyncs,
} from '../storage/schema.js';
import { findOrCreateLabel, setTicketLabels } from '../labels/index.js';

// Types
export interface GitHubWebhookResult {
  action: 'created' | 'updated' | 'ignored' | 'comment_created' | 'comment_updated' | 'comment_deleted';
  ticketId?: string;
  commentId?: string;
  reason?: string;
}

interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: 'open' | 'closed';
  state_reason?: 'completed' | 'not_planned' | 'reopened' | null;
  user: { login: string };
  labels: Array<{ name: string; color?: string }>;
  assignees?: Array<{ login: string }>;
  created_at: string;
  updated_at: string;
}

interface GitHubComment {
  id: number;
  body: string;
  html_url: string;
  user: { login: string; avatar_url?: string };
  created_at: string;
  updated_at: string;
}

interface GitHubRepository {
  id: number;
  full_name: string;
  owner: { login: string };
  name: string;
}

// =============================================================================
// STATUS MAPPING
// =============================================================================

type TicketStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';

function mapGitHubStateToStatus(state: string, stateReason?: string | null): TicketStatus {
  if (state === 'open') return 'todo';
  if (state === 'closed') {
    if (stateReason === 'completed') return 'done';
    if (stateReason === 'not_planned') return 'cancelled';
    return 'done';
  }
  return 'backlog';
}

function mapPriorityFromLabels(labels: Array<{ name: string }>): string {
  const labelNames = labels.map((l) => l.name.toLowerCase());

  if (labelNames.includes('critical') || labelNames.includes('p0') || labelNames.includes('priority: critical')) {
    return 'urgent';
  }
  if (labelNames.includes('high') || labelNames.includes('p1') || labelNames.includes('priority: high')) {
    return 'high';
  }
  if (labelNames.includes('low') || labelNames.includes('p3') || labelNames.includes('priority: low')) {
    return 'low';
  }
  return 'medium';
}

function mapTypeFromLabels(labels: Array<{ name: string }>): string {
  const labelNames = labels.map((l) => l.name.toLowerCase());

  if (labelNames.includes('bug') || labelNames.includes('type: bug')) return 'bug';
  if (labelNames.includes('feature') || labelNames.includes('type: feature') || labelNames.includes('enhancement')) {
    return 'feature';
  }
  if (labelNames.includes('epic') || labelNames.includes('type: epic')) return 'epic';
  if (labelNames.includes('story') || labelNames.includes('user story')) return 'story';
  return 'task';
}

// =============================================================================
// FIND SYNCED TICKET
// =============================================================================

async function findSyncedTicket(
  repository: GitHubRepository,
  issue: GitHubIssue
): Promise<{ ticketId: string; linkId: string; projectId: string } | null> {
  const db = getDb();
  if (!db) return null;

  // Look for external link by various ID patterns
  const possibleExternalIds = [
    `${repository.owner.login}/${repository.name}#${issue.number}`,
    `${repository.full_name}#${issue.number}`,
    issue.id.toString(),
    `#${issue.number}`,
  ];

  for (const externalId of possibleExternalIds) {
    const link = await db
      .select({
        ticketId: ticketExternalLinks.ticketId,
        linkId: ticketExternalLinks.id,
      })
      .from(ticketExternalLinks)
      .where(
        and(
          eq(ticketExternalLinks.platform, 'github'),
          eq(ticketExternalLinks.externalId, externalId),
          eq(ticketExternalLinks.syncEnabled, true)
        )
      )
      .limit(1);

    if (link[0]) {
      // Get project ID from ticket
      const ticket = await db
        .select({ projectId: tickets.projectId })
        .from(tickets)
        .where(eq(tickets.id, link[0].ticketId))
        .limit(1);

      return {
        ticketId: link[0].ticketId,
        linkId: link[0].linkId,
        projectId: ticket[0]?.projectId || '',
      };
    }
  }

  return null;
}

// =============================================================================
// ISSUE EVENT HANDLERS
// =============================================================================

/**
 * Handle issue opened/edited/closed/reopened events
 */
export async function handleIssueEvent(
  action: string,
  issue: GitHubIssue,
  repository: GitHubRepository
): Promise<GitHubWebhookResult> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  // Find synced ticket
  const synced = await findSyncedTicket(repository, issue);

  if (!synced) {
    // No synced ticket found - could create one here if auto-import enabled
    return { action: 'ignored', reason: 'ticket_not_synced' };
  }

  const { ticketId, projectId } = synced;
  const now = new Date();

  // Map GitHub state to profClaw status
  const newStatus = mapGitHubStateToStatus(issue.state, issue.state_reason);
  const newPriority = mapPriorityFromLabels(issue.labels);
  const newType = mapTypeFromLabels(issue.labels);
  const newAssignee = issue.assignees?.[0]?.login || null;

  // Get current ticket for comparison
  const currentTicket = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);

  if (!currentTicket[0]) {
    return { action: 'ignored', reason: 'ticket_not_found' };
  }

  const current = currentTicket[0];
  const changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];

  // Track changes for history
  if (current.title !== issue.title) {
    changes.push({ field: 'title', oldValue: current.title, newValue: issue.title });
  }
  if (current.description !== (issue.body || '')) {
    changes.push({ field: 'description', oldValue: current.description || '', newValue: issue.body || '' });
  }
  if (current.status !== newStatus) {
    changes.push({ field: 'status', oldValue: current.status, newValue: newStatus });
  }
  if (current.priority !== newPriority) {
    changes.push({ field: 'priority', oldValue: current.priority, newValue: newPriority });
  }
  if (current.type !== newType) {
    changes.push({ field: 'type', oldValue: current.type, newValue: newType });
  }
  if (current.assignee !== newAssignee) {
    changes.push({ field: 'assignee', oldValue: current.assignee, newValue: newAssignee });
  }

  // If no changes, skip
  if (changes.length === 0) {
    return { action: 'ignored', reason: 'no_changes' };
  }

  // Update ticket
  await db.update(tickets).set({
    title: issue.title,
    description: issue.body || '',
    status: newStatus,
    priority: newPriority,
    type: newType,
    assignee: newAssignee,
    updatedAt: now,
  }).where(eq(tickets.id, ticketId));

  // Record history for each change
  for (const change of changes) {
    await db.insert(ticketHistory).values({
      id: randomUUID(),
      ticketId,
      field: change.field,
      oldValue: change.oldValue,
      newValue: change.newValue,
      changedByType: 'human',
      changedByName: issue.user.login,
      changedByPlatform: 'github',
      timestamp: now,
    });
  }

  // Sync labels if project ID is available
  if (projectId && issue.labels.length > 0) {
    try {
      const labelIds: string[] = [];
      for (const ghLabel of issue.labels) {
        const label = await findOrCreateLabel(projectId, ghLabel.name, {
          color: ghLabel.color ? `#${ghLabel.color}` : undefined,
          externalSource: 'github',
          externalId: ghLabel.name,
        });
        labelIds.push(label.id);
      }
      await setTicketLabels(ticketId, labelIds);
    } catch (e) {
      console.warn('[GitHub Sync] Failed to sync labels:', e);
    }
  }

  // Update last synced timestamp
  await db.update(ticketExternalLinks).set({
    lastSyncedAt: now,
    syncError: null,
  }).where(eq(ticketExternalLinks.ticketId, ticketId));

  console.log(`[GitHub Sync] Updated ticket ${ticketId} from issue #${issue.number}: ${changes.map(c => c.field).join(', ')}`);

  return { action: 'updated', ticketId };
}

/**
 * Handle issue labeled/unlabeled events
 */
export async function handleIssueLabelEvent(
  action: 'labeled' | 'unlabeled',
  issue: GitHubIssue,
  repository: GitHubRepository,
  label: { name: string; color?: string }
): Promise<GitHubWebhookResult> {
  const synced = await findSyncedTicket(repository, issue);

  if (!synced) {
    return { action: 'ignored', reason: 'ticket_not_synced' };
  }

  // Re-sync all labels from current issue state
  return handleIssueEvent('labeled', issue, repository);
}

// =============================================================================
// COMMENT EVENT HANDLERS
// =============================================================================

/**
 * Handle issue comment created event
 */
export async function handleCommentCreated(
  issue: GitHubIssue,
  comment: GitHubComment,
  repository: GitHubRepository
): Promise<GitHubWebhookResult> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const synced = await findSyncedTicket(repository, issue);

  if (!synced) {
    return { action: 'ignored', reason: 'ticket_not_synced' };
  }

  const { ticketId, linkId } = synced;

  // Check if comment already synced
  const existingSync = await db
    .select()
    .from(githubCommentSyncs)
    .where(eq(githubCommentSyncs.githubCommentId, comment.id))
    .limit(1);

  if (existingSync[0]) {
    return { action: 'ignored', reason: 'comment_already_synced' };
  }

  // Create comment
  const commentId = randomUUID();
  const now = new Date();

  await db.insert(ticketComments).values({
    id: commentId,
    ticketId,
    content: comment.body,
    authorType: 'human',
    authorName: comment.user.login,
    authorPlatform: 'github',
    authorAvatarUrl: comment.user.avatar_url,
    source: 'github',
    externalId: comment.id.toString(),
    isAiResponse: false,
    createdAt: now,
    updatedAt: now,
  });

  // Track sync
  await db.insert(githubCommentSyncs).values({
    id: randomUUID(),
    ticketExternalLinkId: linkId,
    commentId,
    githubCommentId: comment.id,
    createdAt: now,
  });

  console.log(`[GitHub Sync] Created comment ${commentId} from GitHub comment #${comment.id}`);

  return { action: 'comment_created', ticketId, commentId };
}

/**
 * Handle issue comment edited event
 */
export async function handleCommentEdited(
  issue: GitHubIssue,
  comment: GitHubComment,
  repository: GitHubRepository
): Promise<GitHubWebhookResult> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const synced = await findSyncedTicket(repository, issue);

  if (!synced) {
    return { action: 'ignored', reason: 'ticket_not_synced' };
  }

  // Find synced comment
  const syncRecord = await db
    .select()
    .from(githubCommentSyncs)
    .where(eq(githubCommentSyncs.githubCommentId, comment.id))
    .limit(1);

  if (!syncRecord[0]) {
    // Comment wasn't synced before - create it now
    return handleCommentCreated(issue, comment, repository);
  }

  // Update comment
  await db.update(ticketComments).set({
    content: comment.body,
    updatedAt: new Date(),
  }).where(eq(ticketComments.id, syncRecord[0].commentId));

  console.log(`[GitHub Sync] Updated comment ${syncRecord[0].commentId} from GitHub comment #${comment.id}`);

  return { action: 'comment_updated', ticketId: synced.ticketId, commentId: syncRecord[0].commentId };
}

/**
 * Handle issue comment deleted event
 */
export async function handleCommentDeleted(
  issue: GitHubIssue,
  comment: GitHubComment,
  repository: GitHubRepository
): Promise<GitHubWebhookResult> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const synced = await findSyncedTicket(repository, issue);

  if (!synced) {
    return { action: 'ignored', reason: 'ticket_not_synced' };
  }

  // Find synced comment
  const syncRecord = await db
    .select()
    .from(githubCommentSyncs)
    .where(eq(githubCommentSyncs.githubCommentId, comment.id))
    .limit(1);

  if (!syncRecord[0]) {
    return { action: 'ignored', reason: 'comment_not_synced' };
  }

  // Delete sync record and comment
  await db.delete(githubCommentSyncs).where(eq(githubCommentSyncs.id, syncRecord[0].id));
  await db.delete(ticketComments).where(eq(ticketComments.id, syncRecord[0].commentId));

  console.log(`[GitHub Sync] Deleted comment ${syncRecord[0].commentId}`);

  return { action: 'comment_deleted', ticketId: synced.ticketId };
}

// =============================================================================
// MAIN WEBHOOK HANDLER
// =============================================================================

/**
 * Process GitHub webhook for ticket sync
 * Call this from the sync routes after signature verification
 */
export async function processGitHubWebhookForTicketSync(
  event: string,
  payload: any
): Promise<GitHubWebhookResult> {
  try {
    if (event === 'issues') {
      const { action, issue, repository, label } = payload;

      if (action === 'labeled' || action === 'unlabeled') {
        return handleIssueLabelEvent(action, issue, repository, label);
      }

      if (['opened', 'edited', 'closed', 'reopened', 'assigned', 'unassigned'].includes(action)) {
        return handleIssueEvent(action, issue, repository);
      }
    }

    if (event === 'issue_comment') {
      const { action, issue, comment, repository } = payload;

      if (action === 'created') {
        return handleCommentCreated(issue, comment, repository);
      }
      if (action === 'edited') {
        return handleCommentEdited(issue, comment, repository);
      }
      if (action === 'deleted') {
        return handleCommentDeleted(issue, comment, repository);
      }
    }

    return { action: 'ignored', reason: `unhandled_event: ${event}` };
  } catch (error) {
    console.error('[GitHub Sync] Error processing webhook:', error);
    throw error;
  }
}
