/**
 * Linear Webhook Integration
 * 
 * Handles webhooks from Linear to automatically create tasks when:
 * - Issues are created with specific labels
 * - Issues are updated with AI-task label
 * - Issues have specific commands in comments
 */

import type { Context } from 'hono';
import { createHmac, timingSafeEqual } from 'crypto';
import type { CreateTaskInput } from '../types/task.js';
import { logger } from '../utils/logger.js';

/**
 * Linear webhook event types
 */
type LinearWebhookEvent = 
  | 'Issue'
  | 'IssueLabel'
  | 'Comment'
  | 'Project'
  | 'User';

/**
 * Linear webhook action types
 */
type LinearWebhookAction = 
  | 'create'
  | 'update'
  | 'remove';

/**
 * Linear webhook payload structure
 */
interface LinearWebhookPayload {
  action: LinearWebhookAction;
  type: LinearWebhookEvent;
  data: unknown;
  url: string;
  organizationId: string;
  webhookTimestamp: number;
  webhookId: string;
}

/**
 * Linear issue data structure
 */
interface LinearIssue {
  id: string;
  identifier: string; // e.g., "ENG-123"
  title: string;
  description?: string;
  state: {
    id: string;
    name: string;
    type: string;
  };
  priority: number; // 0 (no priority) to 4 (urgent)
  labels?: Array<{
    id: string;
    name: string;
  }>;
  assignee?: {
    id: string;
    name: string;
    email: string;
  };
  team: {
    id: string;
    name: string;
    key: string;
  };
  project?: {
    id: string;
    name: string;
  };
  url: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Linear comment data structure
 */
interface LinearComment {
  id: string;
  body: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
  issue: LinearIssue;
  createdAt: string;
  url: string;
}

/**
 * Verify Linear webhook signature
 */
function verifyLinearSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.LINEAR_WEBHOOK_SECRET;

  if (!secret) {
    logger.warn('LINEAR_WEBHOOK_SECRET not configured');
    return false;
  }

  try {
    // Compute HMAC-SHA256 signature
    const expectedSignature = createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    // Timing-safe comparison
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch (error) {
    logger.error('Linear signature verification failed', error as Error);
    return false;
  }
}

/**
 * Verify webhook timestamp to prevent replay attacks
 */
function verifyTimestamp(webhookTimestamp: number): boolean {
  const now = Date.now();
  const diff = Math.abs(now - webhookTimestamp);
  const maxAge = 5 * 60 * 1000; // 5 minutes

  if (diff > maxAge) {
    logger.warn('Linear webhook timestamp too old', {
      webhookTimestamp,
      currentTime: now,
      diffMs: diff,
    });
    return false;
  }

  return true;
}

/**
 * Map Linear priority to task priority
 */
function mapLinearPriority(linearPriority: number): 'critical' | 'high' | 'medium' | 'low' {
  switch (linearPriority) {
    case 4: // Urgent
      return 'critical';
    case 3: // High
      return 'high';
    case 2: // Medium
      return 'medium';
    case 1: // Low
    case 0: // No priority
    default:
      return 'low';
  }
}

/**
 * Get task priority from Linear labels
 */
function getPriorityFromLabels(
  labels: Array<{ name: string }> | undefined
): 'critical' | 'high' | 'medium' | 'low' | undefined {
  if (!labels || labels.length === 0) return undefined;

  const labelNames = labels.map((l) => l.name.toLowerCase());

  if (labelNames.some((name) => name.includes('critical') || name.includes('urgent'))) {
    return 'critical';
  }
  if (labelNames.some((name) => name.includes('high') || name.includes('priority'))) {
    return 'high';
  }
  if (labelNames.some((name) => name.includes('medium'))) {
    return 'medium';
  }
  if (labelNames.some((name) => name.includes('low'))) {
    return 'low';
  }

  return undefined;
}

/**
 * Check if issue should trigger AI task
 */
function shouldCreateTask(issue: LinearIssue): boolean {
  const aiTaskLabel = process.env.LINEAR_AI_TASK_LABEL || 'ai-task';
  
  if (!issue.labels) return false;

  return issue.labels.some((label) => label.name.toLowerCase() === aiTaskLabel.toLowerCase());
}

/**
 * Build prompt from issue
 */
function buildPromptFromIssue(issue: LinearIssue): string {
  let prompt = `# Linear Issue: ${issue.identifier} - ${issue.title}\n\n`;

  if (issue.description) {
    prompt += `## Description\n${issue.description}\n\n`;
  }

  if (issue.labels && issue.labels.length > 0) {
    prompt += `## Labels\n${issue.labels.map((l) => l.name).join(', ')}\n\n`;
  }

  if (issue.project) {
    prompt += `## Project\n${issue.project.name}\n\n`;
  }

  prompt += `## Team\n${issue.team.name}\n\n`;
  prompt += `## State\n${issue.state.name}\n\n`;

  if (issue.assignee) {
    prompt += `## Assigned To\n${issue.assignee.name}\n\n`;
  }

  prompt += `## Task\nPlease analyze this issue and provide implementation guidance or create a solution.\n`;

  return prompt;
}

/**
 * Handle Linear webhook
 */
export async function handleLinearWebhook(c: Context): Promise<CreateTaskInput | null> {
  const correlationId = c.req.header('X-Correlation-ID') || 'linear-webhook';

  // Get raw body for signature verification
  const rawBody = await c.req.text();
  
  // Parse payload
  let payload: LinearWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    logger.error('Failed to parse Linear webhook payload', error as Error, { correlationId });
    throw new Error('Invalid JSON payload');
  }

  logger.info('Linear webhook received', {
    correlationId,
    type: payload.type,
    action: payload.action,
    webhookId: payload.webhookId,
  });

  // Verify signature
  const signature = c.req.header('Linear-Signature');
  if (!signature) {
    throw new Error('Missing Linear-Signature header');
  }

  if (!verifyLinearSignature(rawBody, signature)) {
    throw new Error('Invalid Linear webhook signature');
  }

  // Verify timestamp to prevent replay attacks
  if (!verifyTimestamp(payload.webhookTimestamp)) {
    throw new Error('Webhook timestamp too old');
  }

  // Handle different event types
  switch (payload.type) {
    case 'Issue':
      return handleIssueEvent(payload, correlationId);
    
    case 'Comment':
      return handleCommentEvent(payload, correlationId);
    
    case 'IssueLabel':
      return handleIssueLabelEvent(payload, correlationId);
    
    default:
      logger.debug('Linear webhook event type not handled', {
        correlationId,
        type: payload.type,
      });
      return null;
  }
}

/**
 * Handle Issue events (create, update)
 */
function handleIssueEvent(
  payload: LinearWebhookPayload,
  correlationId: string
): CreateTaskInput | null {
  const issue = payload.data as LinearIssue;

  logger.info('Linear issue event', {
    correlationId,
    action: payload.action,
    issueId: issue.identifier,
    title: issue.title,
  });

  // Only process create and update actions
  if (payload.action !== 'create' && payload.action !== 'update') {
    logger.debug('Linear issue action not processed', {
      correlationId,
      action: payload.action,
    });
    return null;
  }

  // Check if issue has AI task label
  if (!shouldCreateTask(issue)) {
    logger.debug('Linear issue does not have AI task label', {
      correlationId,
      issueId: issue.identifier,
      labels: issue.labels?.map((l) => l.name),
    });
    return null;
  }

  // Determine priority (label-based overrides Linear priority)
  const labelPriority = getPriorityFromLabels(issue.labels);
  const stringPriority = labelPriority || mapLinearPriority(issue.priority);
  
  // Map to numeric priority (1-4)
  const priorityMap: Record<string, number> = {
    critical: 1,
    high: 2,
    medium: 3,
    low: 4,
  };

  // Create task input
  const taskInput: CreateTaskInput = {
    title: `${issue.identifier}: ${issue.title}`,
    description: issue.description || issue.title,
    prompt: buildPromptFromIssue(issue),
    priority: priorityMap[stringPriority],
    source: 'linear_issue',
    sourceId: issue.id,
    sourceUrl: issue.url,
    labels: issue.labels?.map((l) => l.name) || [],
    metadata: {
      identifier: issue.identifier,
      teamKey: issue.team.key,
      teamName: issue.team.name,
      state: issue.state.name,
      projectName: issue.project?.name,
      assignee: issue.assignee?.email,
    },
  };

  logger.info('Linear task created from issue', {
    correlationId,
    issueId: issue.identifier,
    priority: stringPriority,
  });

  return taskInput;
}

/**
 * Handle Comment events
 */
function handleCommentEvent(
  payload: LinearWebhookPayload,
  correlationId: string
): CreateTaskInput | null {
  if (payload.action !== 'create') {
    return null;
  }

  const comment = payload.data as LinearComment;

  logger.info('Linear comment event', {
    correlationId,
    issueId: comment.issue.identifier,
    commentId: comment.id,
  });

  // Check for AI command in comment (e.g., "/ai-do")
  const aiCommandPattern = /\/ai-do\s+(.+)/i;
  const match = comment.body.match(aiCommandPattern);

  if (!match) {
    logger.debug('Linear comment does not contain AI command', {
      correlationId,
      commentId: comment.id,
    });
    return null;
  }

  const instruction = match[1].trim();

  // Build prompt from comment instruction
  const prompt = `# Linear Issue: ${comment.issue.identifier} - ${comment.issue.title}\n\n`;
  const fullPrompt = 
    prompt +
    (comment.issue.description ? `## Issue Description\n${comment.issue.description}\n\n` : '') +
    `## AI Instruction\n${instruction}\n\n` +
    `Requested by: ${comment.user.name}\n`;

  // Map priority
  const stringPriority = mapLinearPriority(comment.issue.priority);
  const priorityMap: Record<string, number> = {
    critical: 1,
    high: 2,
    medium: 3,
    low: 4,
  };

  const taskInput: CreateTaskInput = {
    title: `${comment.issue.identifier}: ${instruction.substring(0, 100)}`,
    description: instruction,
    prompt: fullPrompt,
    priority: priorityMap[stringPriority],
    source: 'linear_comment',
    sourceId: comment.id,
    sourceUrl: comment.url,
    labels: comment.issue.labels?.map((l) => l.name) || [],
    metadata: {
      issueId: comment.issue.id,
      identifier: comment.issue.identifier,
      commentUser: comment.user.email,
    },
  };

  logger.info('Linear task created from comment', {
    correlationId,
    issueId: comment.issue.identifier,
    commentId: comment.id,
  });

  return taskInput;
}

/**
 * Handle IssueLabel events (label added/removed)
 */
function handleIssueLabelEvent(
  payload: LinearWebhookPayload,
  correlationId: string
): CreateTaskInput | null {
  // When ai-task label is added, treat it like issue creation
  if (payload.action === 'create') {
    const data = payload.data;
    
    // data.issue should contain the issue information
    if (typeof data === 'object' && data !== null && 'issue' in data && data.issue) {
      return handleIssueEvent(
        { ...payload, type: 'Issue', action: 'update', data: data.issue as LinearIssue },
        correlationId
      );
    }
  }

  return null;
}
