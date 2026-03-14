/**
 * Issue Poller
 *
 * Polls GitHub for new issues labeled with ai-task that aren't in the queue yet.
 * Configurable via POLL_INTERVAL_ISSUES env var (default: 2 minutes).
 */

import { addTask, getTask } from '../queue/index.js';
import { createContextualLogger } from '../utils/logger.js';
import type { CreateTaskInput } from '../types/task.js';

const log = createContextualLogger('IssuePoller');

// Configurable interval (default: 2 minutes, env var in ms)
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_ISSUES || '120000', 10);
const AI_TASK_LABEL = process.env.GITHUB_AI_TASK_LABEL || 'ai-task';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const REPOS_TO_POLL = (process.env.GITHUB_REPOS_TO_POLL || '').split(',').filter(Boolean);

let pollerInterval: NodeJS.Timeout | null = null;

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  labels: Array<{ name: string }>;
  user: { login: string };
  created_at: string;
  pull_request?: unknown;
}

/**
 * Fetch open issues with ai-task label from a repo
 */
async function fetchOpenIssues(owner: string, repo: string): Promise<GitHubIssue[]> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues?state=open&labels=${AI_TASK_LABEL}&per_page=20`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'profclaw',
        },
      }
    );

    if (!response.ok) {
      log.warn(`Failed to fetch issues from ${owner}/${repo}`, { status: response.status });
      return [];
    }

    const issues = await response.json() as GitHubIssue[];

    // Filter out pull requests (GitHub API returns PRs in issues endpoint)
    return issues.filter(issue => !issue.pull_request);
  } catch (error) {
    log.error(`Error fetching issues from ${owner}/${repo}`, error instanceof Error ? error : undefined);
    return [];
  }
}

/**
 * Build task input from GitHub issue
 */
function issueToTask(issue: GitHubIssue, repo: string): CreateTaskInput {
  return {
    title: issue.title,
    description: issue.body || undefined,
    prompt: buildPromptFromIssue(issue, repo),
    priority: getPriorityFromLabels(issue.labels),
    source: 'github_issue',
    sourceId: issue.number.toString(),
    sourceUrl: issue.html_url,
    repository: repo,
    labels: issue.labels.map(l => l.name),
    metadata: {
      issueNumber: issue.number,
      author: issue.user.login,
      createdAt: issue.created_at,
      polled: true, // Mark as polled vs webhook
    },
  };
}

/**
 * Build autonomous prompt from issue
 */
function buildPromptFromIssue(issue: GitHubIssue, repo: string): string {
  const repoName = repo.split('/').pop();

  return `You are an autonomous AI developer working on ${repo}.

## Task: ${issue.title}

## Issue Description
${issue.body || 'No description provided.'}

## Workflow (FOLLOW EXACTLY)
1. cd ~/openclaw-workdir/${repoName}
2. git fetch origin && git checkout main && git pull
3. git checkout -b fix/issue-${issue.number}
4. Analyze the issue and implement the solution
5. Run build/tests to verify: pnpm install && pnpm build
6. Stage changes: git add -A
7. Commit with message following conventional commits:
   git commit -m "feat: <description>

Closes #${issue.number}

Co-Authored-By: profClaw <bot@profclaw.ai>"
8. Push: git push -u origin HEAD
9. Create PR: gh pr create --title "<title>" --body "Closes #${issue.number}"

## On Errors
- Fix any build/lint errors before committing
- If blocked, explain clearly what's wrong
- Never leave uncommitted changes

## Output
When done, provide:
- Summary of changes made
- Files modified
- PR URL
- Any concerns or follow-up items`;
}

/**
 * Get priority from labels
 */
function getPriorityFromLabels(labels: Array<{ name: string }>): number {
  const names = labels.map(l => l.name.toLowerCase());
  if (names.includes('critical') || names.includes('p0')) return 1;
  if (names.includes('high') || names.includes('p1')) return 2;
  if (names.includes('low') || names.includes('p3')) return 4;
  return 3;
}

/**
 * Poll all configured repos for new issues
 */
async function pollForIssues(): Promise<void> {
  if (!GITHUB_TOKEN) {
    log.debug('No GITHUB_TOKEN configured, skipping poll');
    return;
  }

  if (REPOS_TO_POLL.length === 0) {
    return; // Silent - no repos configured
  }

  log.debug(`Polling ${REPOS_TO_POLL.length} repos`);

  for (const repo of REPOS_TO_POLL) {
    const [owner, repoName] = repo.split('/');
    if (!owner || !repoName) continue;

    const issues = await fetchOpenIssues(owner, repoName);

    for (const issue of issues) {
      // Check if already in queue by sourceId
      const existingTask = getTask(`github_issue_${issue.number}_${repo}`);

      if (!existingTask) {
        log.info(`Found new issue #${issue.number} in ${repo}`, { title: issue.title });

        try {
          const task = await addTask(issueToTask(issue, repo));
          log.info(`Created task for issue #${issue.number}`, { taskId: task.id });
        } catch (error) {
          log.error(`Failed to create task for issue #${issue.number}`, error instanceof Error ? error : undefined);
        }
      }
    }
  }
}

/**
 * Start the issue poller
 */
export function startIssuePoller(): void {
  if (pollerInterval) {
    return; // Already running
  }

  log.info(`Starting issue poller`, { intervalMs: POLL_INTERVAL });

  // Run immediately on start
  pollForIssues().catch((e) => log.error('Poll failed', e instanceof Error ? e : undefined));

  // Then run at configured interval
  pollerInterval = setInterval(() => {
    pollForIssues().catch((e) => log.error('Poll failed', e instanceof Error ? e : undefined));
  }, POLL_INTERVAL);
}

/**
 * Stop the issue poller
 */
export function stopIssuePoller(): void {
  if (pollerInterval) {
    clearInterval(pollerInterval);
    pollerInterval = null;
    log.debug('Stopped');
  }
}
