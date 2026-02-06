import type { Context } from 'hono';
import type { CreateTaskInput } from '../types/task.js';
import { createContextualLogger } from '../utils/logger.js';

const log = createContextualLogger('Jira');

/**
 * Jira Webhook Integration
 *
 * Receives webhooks from Jira and creates tasks from issues.
 *
 * Supported events:
 * - jira:issue_created
 * - jira:issue_updated
 */

const JIRA_AI_TASK_LABEL = process.env.JIRA_AI_TASK_LABEL || 'ai-task';
const WEBHOOK_SECRET = process.env.JIRA_WEBHOOK_SECRET || '';

/**
 * Verify Jira webhook token
 *
 * Checks for ?token=SECRET in query params
 */
export function verifyJiraToken(c: Context): boolean {
  if (!WEBHOOK_SECRET) {
    log.warn('JIRA_WEBHOOK_SECRET not set - skipping verification');
    return true;
  }

  const token = c.req.query('token');
  return token === WEBHOOK_SECRET;
}

/**
 * Handle Jira webhook
 */
export async function handleJiraWebhook(
  c: Context
): Promise<CreateTaskInput | null> {
  // Verify token
  if (!verifyJiraToken(c)) {
    throw new Error('Invalid webhook token');
  }

  const rawBody = await c.req.text();
  const payload = JSON.parse(rawBody) as JiraWebhookPayload;
  const { webhookEvent, issue } = payload;

  log.info('Jira webhook received', { webhookEvent, issueKey: issue.key });

  // Only handle created or updated events
  if (webhookEvent !== 'jira:issue_created' && webhookEvent !== 'jira:issue_updated') {
    return null;
  }

  // Check for AI label
  const hasAiLabel = issue.fields.labels?.includes(JIRA_AI_TASK_LABEL);
  if (!hasAiLabel) {
    log.info('Issue does not have AI label, skipping', { issueKey: issue.key });
    return null;
  }

  // Construct source URL (convert API URL to browser URL)
  // e.g. https://site.atlassian.net/rest/api/2/issue/10001 -> https://site.atlassian.net/browse/TEST-1
  let sourceUrl = undefined;
  if (issue.self) {
    try {
      const baseUrl = new URL(issue.self).origin;
      sourceUrl = `${baseUrl}/browse/${issue.key}`;
    } catch {
      // Ignore URL parsing error
    }
  }

  return {
    title: `Jira Issue ${issue.key}: ${issue.fields.summary}`,
    description: issue.fields.description || undefined,
    prompt: buildPromptFromJiraIssue(issue),
    priority: getPriorityFromJiraPriority(issue.fields.priority?.name),
    source: 'jira' as const,
    sourceId: issue.key,
    sourceUrl,
    labels: issue.fields.labels || [],
    metadata: {
      issueId: issue.id,
      key: issue.key,
      reporter: issue.fields.reporter?.displayName,
      reporterEmail: issue.fields.reporter?.emailAddress,
      status: issue.fields.status?.name,
      created: issue.fields.created,
    },
  };
}

/**
 * Build AI prompt from Jira issue
 */
function buildPromptFromJiraIssue(issue: JiraIssue): string {
  const parts: string[] = [];

  parts.push(`Jira Issue ${issue.key}: ${issue.fields.summary}`);

  if (issue.fields.description) {
    parts.push('\n## Issue Description:');
    parts.push(issue.fields.description);
  }

  parts.push('\n## Task:');
  parts.push('Please analyze this Jira issue and implement the requested work.');
  parts.push('Create atomic commits with clear messages.');

  return parts.join('\n');
}

/**
 * Get priority from Jira priority name
 */
function getPriorityFromJiraPriority(priorityName?: string): number {
  if (!priorityName) return 3;

  const name = priorityName.toLowerCase();

  if (name.includes('critical') || name.includes('highest')) return 1;
  if (name.includes('high')) return 2;
  if (name.includes('low') || name.includes('lowest')) return 4;

  return 3; // Default medium
}

// Jira API Types (simplified)

interface JiraWebhookPayload {
  webhookEvent: string;
  issue: JiraIssue;
  timestamp: number;
}

interface JiraIssue {
  id: string;
  self: string;
  key: string;
  fields: {
    summary: string;
    description: string | null;
    priority?: {
      name: string;
      id: string;
    };
    status?: {
      name: string;
      id: string;
    };
    labels?: string[];
    reporter?: {
      accountId: string;
      displayName: string;
      emailAddress?: string;
    };
    created: string;
    updated: string;
  };
}
