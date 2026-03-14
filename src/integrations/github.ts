import type { Context } from 'hono';
import { createHmac, timingSafeEqual } from 'crypto';
import type { CreateTaskInput } from '../types/task.js';
import { createContextualLogger } from '../utils/logger.js';

const log = createContextualLogger('GitHub');

/**
 * GitHub Webhook Integration
 *
 * Receives webhooks from GitHub and creates tasks from issues/PRs.
 *
 * Supported events:
 * - issues.opened - New issue created
 * - issues.labeled - Issue labeled (e.g., "ai-task")
 * - issue_comment.created - Comment on issue (can trigger task)
 * - pull_request.opened - New PR opened
 * - pull_request.review_requested - Review requested
 */

// Label that triggers AI task creation
const AI_TASK_LABEL = process.env.GITHUB_AI_TASK_LABEL || 'ai-task';
const AI_REVIEW_LABEL = process.env.GITHUB_AI_REVIEW_LABEL || 'ai-review';
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';

/**
 * GitHub webhook event types we handle
 */
type GitHubEvent =
  | 'issues'
  | 'issue_comment'
  | 'pull_request'
  | 'pull_request_review'
  | 'ping';

/**
 * Verify GitHub webhook signature
 */
export function verifyGitHubSignature(
  payload: string,
  signature: string | undefined
): boolean {
  if (!WEBHOOK_SECRET) {
    log.warn('GITHUB_WEBHOOK_SECRET not set - skipping signature verification');
    return true;
  }

  if (!signature) {
    return false;
  }

  const expectedSignature = `sha256=${createHmac('sha256', WEBHOOK_SECRET)
    .update(payload)
    .digest('hex')}`;

  try {
    return timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

/**
 * Handle GitHub webhook
 */
export async function handleGitHubWebhook(
  c: Context
): Promise<CreateTaskInput | null> {
  const event = c.req.header('X-GitHub-Event') as GitHubEvent;
  const signature = c.req.header('X-Hub-Signature-256');
  const deliveryId = c.req.header('X-GitHub-Delivery');

  const rawBody = await c.req.text();

  // Verify signature
  if (!verifyGitHubSignature(rawBody, signature)) {
    throw new Error('Invalid webhook signature');
  }

  const payload = JSON.parse(rawBody);

  log.info('GitHub webhook received', { event, deliveryId });

  switch (event) {
    case 'ping':
      log.info('GitHub ping received');
      return null;

    case 'issues':
      return handleIssueEvent(payload);

    case 'issue_comment':
      return handleIssueCommentEvent(payload);

    case 'pull_request':
      return handlePullRequestEvent(payload);

    default:
      log.info('Unhandled event', { event });
      return null;
  }
}

/**
 * Handle issue events
 */
function handleIssueEvent(payload: GitHubIssuePayload): CreateTaskInput | null {
  const { action, issue, repository } = payload;

  // Only handle opened issues or when ai-task label is added
  if (action === 'opened') {
    // Check if issue has the AI task label
    const hasAiLabel = issue.labels?.some(
      (l) => l.name === AI_TASK_LABEL || l.name === AI_REVIEW_LABEL
    );
    if (!hasAiLabel) {
      log.info('Issue opened without AI label, skipping', { issueNumber: issue.number });
      return null;
    }
  } else if (action === 'labeled') {
    // Check if the added label is an AI label
    const labelAdded = payload.label?.name;
    if (labelAdded !== AI_TASK_LABEL && labelAdded !== AI_REVIEW_LABEL) {
      return null;
    }
  } else {
    return null;
  }

  // Create task from issue
  return {
    title: issue.title,
    description: issue.body || undefined,
    prompt: buildPromptFromIssue(issue),
    priority: getPriorityFromLabels(issue.labels || []),
    source: 'github_issue' as const,
    sourceId: issue.number.toString(),
    sourceUrl: issue.html_url,
    repository: repository.full_name,
    labels: (issue.labels || []).map((l) => l.name),
    metadata: {
      issueNumber: issue.number,
      author: issue.user.login,
      createdAt: issue.created_at,
    },
  };
}

/**
 * Handle issue comment events (for trigger commands like /ai-do)
 */
function handleIssueCommentEvent(
  payload: GitHubIssueCommentPayload
): CreateTaskInput | null {
  const { action, issue, comment, repository } = payload;

  if (action !== 'created') return null;

  // Check for trigger commands in comment
  const body = comment.body.trim();
  const triggerMatch = body.match(/^\/ai(?:-do)?\s+(.+)/is);

  if (!triggerMatch) {
    return null;
  }

  const prompt = triggerMatch[1].trim();

  log.info('AI trigger command received', { issueNumber: issue.number, promptPreview: prompt.substring(0, 50) });

  return {
    title: `AI Task: ${issue.title}`,
    description: `Triggered by @${comment.user.login} in issue #${issue.number}`,
    prompt: prompt,
    priority: 2, // High priority for manual triggers
    source: 'github_issue' as const,
    sourceId: issue.number.toString(),
    sourceUrl: issue.html_url,
    repository: repository.full_name,
    labels: (issue.labels || []).map((l) => l.name),
    metadata: {
      issueNumber: issue.number,
      triggeredBy: comment.user.login,
      triggerCommentId: comment.id,
      triggerCommentUrl: comment.html_url,
    },
  };
}

/**
 * Handle pull request events
 */
function handlePullRequestEvent(
  payload: GitHubPullRequestPayload
): CreateTaskInput | null {
  const { action, pull_request, repository } = payload;

  // Handle review requests
  if (action === 'review_requested') {
    return {
      title: `Review PR: ${pull_request.title}`,
      description: pull_request.body || undefined,
      prompt: buildReviewPrompt(pull_request),
      priority: 2,
      source: 'github_pr' as const,
      sourceId: pull_request.number.toString(),
      sourceUrl: pull_request.html_url,
      repository: repository.full_name,
      branch: pull_request.head.ref,
      labels: (pull_request.labels || []).map((l) => l.name),
      metadata: {
        prNumber: pull_request.number,
        author: pull_request.user.login,
        baseBranch: pull_request.base.ref,
        headBranch: pull_request.head.ref,
      },
    };
  }

  // Handle opened PRs with ai-review label
  if (action === 'opened' || action === 'labeled') {
    const hasReviewLabel = pull_request.labels?.some(
      (l) => l.name === AI_REVIEW_LABEL
    );
    if (!hasReviewLabel) return null;

    return {
      title: `Review PR: ${pull_request.title}`,
      description: pull_request.body || undefined,
      prompt: buildReviewPrompt(pull_request),
      priority: 2,
      source: 'github_pr' as const,
      sourceId: pull_request.number.toString(),
      sourceUrl: pull_request.html_url,
      repository: repository.full_name,
      branch: pull_request.head.ref,
      labels: (pull_request.labels || []).map((l) => l.name),
      metadata: {
        prNumber: pull_request.number,
        author: pull_request.user.login,
      },
    };
  }

  return null;
}

/**
 * Build AI prompt from GitHub issue
 */
function buildPromptFromIssue(issue: GitHubIssue): string {
  const parts: string[] = [];

  parts.push(`GitHub Issue #${issue.number}: ${issue.title}`);

  if (issue.body) {
    parts.push('\n## Issue Description:');
    parts.push(issue.body);
  }

  parts.push('\n## Task:');
  parts.push('Please analyze this issue and implement a solution.');
  parts.push('If this is a bug, fix it. If this is a feature request, implement it.');
  parts.push('Create atomic commits with clear messages.');
  parts.push('If you need clarification, note what questions you have.');

  return parts.join('\n');
}

/**
 * Build AI prompt for PR review
 */
function buildReviewPrompt(pr: GitHubPullRequest): string {
  return `Please review Pull Request #${pr.number}: ${pr.title}

## PR Description:
${pr.body || 'No description provided.'}

## Review Tasks:
1. Check the code changes for correctness and best practices
2. Look for potential bugs, security issues, or performance problems
3. Verify the changes match the PR description
4. Suggest improvements if applicable
5. Add a review comment summarizing your findings

Be constructive and specific in your feedback.`;
}

/**
 * Get priority from issue labels
 */
function getPriorityFromLabels(labels: GitHubLabel[]): number {
  const labelNames = labels.map((l) => l.name.toLowerCase());

  if (labelNames.includes('critical') || labelNames.includes('p0')) return 1;
  if (labelNames.includes('high') || labelNames.includes('p1')) return 2;
  if (labelNames.includes('low') || labelNames.includes('p3')) return 4;

  return 3; // Default medium
}

// GitHub API types (simplified)
interface GitHubLabel {
  name: string;
}

interface GitHubUser {
  login: string;
}

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  user: GitHubUser;
  labels: GitHubLabel[] | null;
  created_at: string;
}

interface GitHubComment {
  id: number;
  body: string;
  html_url: string;
  user: GitHubUser;
}

interface GitHubRepository {
  full_name: string;
}

interface GitHubPullRequest {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  user: GitHubUser;
  labels: GitHubLabel[] | null;
  head: { ref: string };
  base: { ref: string };
}

interface GitHubIssuePayload {
  action: string;
  issue: GitHubIssue;
  repository: GitHubRepository;
  label?: GitHubLabel;
}

interface GitHubIssueCommentPayload {
  action: string;
  issue: GitHubIssue;
  comment: GitHubComment;
  repository: GitHubRepository;
}

interface GitHubPullRequestPayload {
  action: string;
  pull_request: GitHubPullRequest;
  repository: GitHubRepository;
}
