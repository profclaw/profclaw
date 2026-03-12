/**
 * GitHub PR Tool
 *
 * GitHub Pull Request operations using the gh CLI.
 */

import { z } from 'zod';
import { spawn } from 'child_process';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// Schema
// =============================================================================

const GithubPrParamsSchema = z.object({
  action: z.enum(['create', 'get', 'list', 'comment', 'merge', 'diff']).describe('PR action to perform'),
  repo: z.string().optional().describe('owner/repo (auto-detected from git remote if omitted)'),
  pr_number: z.number().optional().describe('PR number (required for get, comment, merge, diff)'),
  title: z.string().optional().describe('PR title (required for create)'),
  body: z.string().optional().describe('PR body or comment text'),
  base: z.string().optional().default('main').describe('Base branch for create'),
  head: z.string().optional().describe('Head branch for create (defaults to current branch)'),
});

export type GithubPrParams = z.infer<typeof GithubPrParamsSchema>;

// =============================================================================
// Constants
// =============================================================================

const MAX_OUTPUT_CHARS = 100_000;
const GH_TIMEOUT_MS = 30_000;

// =============================================================================
// Tool Definition
// =============================================================================

export const githubPrTool: ToolDefinition<GithubPrParams, GithubPrResult> = {
  name: 'github_pr',
  description: `GitHub Pull Request operations. Create, list, get, comment on, merge, and diff PRs.
Requires the gh CLI to be installed and authenticated.
Repo is auto-detected from git remote if not specified.`,
  category: 'execution',
  securityLevel: 'moderate',
  requiresApproval: true,
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: GithubPrParamsSchema,
  examples: [
    { description: 'List open PRs', params: { action: 'list' } },
    { description: 'Get PR details', params: { action: 'get', pr_number: 42 } },
    { description: 'Create a PR', params: { action: 'create', title: 'Add feature X', body: 'Description here' } },
  ],

  isAvailable(): { available: boolean; reason?: string } {
    return { available: true, reason: 'gh CLI required' };
  },

  async execute(context: ToolExecutionContext, params: GithubPrParams): Promise<ToolResult<GithubPrResult>> {
    try {
      const args = buildGhArgs(params);
      const output = await runGh(args, context.workdir);

      logger.debug(`[GitHub] ${params.action} completed`, { component: 'GitHub' });

      return {
        success: true,
        data: {
          action: params.action,
          output,
          pr_number: params.pr_number,
        },
        output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      if (message.includes('is required for') || message.startsWith('Unknown action:')) {
        return {
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message,
          },
        };
      }

      if (message.includes('not found') || message.includes('not installed')) {
        return {
          success: false,
          error: {
            code: 'GH_NOT_FOUND',
            message: 'GitHub CLI (gh) is not installed or not in PATH. Install it from https://cli.github.com',
          },
        };
      }

      if (message.includes('not logged in') || message.includes('auth')) {
        return {
          success: false,
          error: {
            code: 'GH_AUTH_REQUIRED',
            message: 'GitHub CLI requires authentication. Run: gh auth login',
          },
        };
      }

      return {
        success: false,
        error: {
          code: 'GH_ERROR',
          message: `GitHub operation failed: ${message}`,
        },
      };
    }
  },
};

// =============================================================================
// Helpers
// =============================================================================

function buildGhArgs(params: GithubPrParams): string[] {
  const args: string[] = ['pr'];
  const repoArgs = params.repo ? ['-R', params.repo] : [];

  switch (params.action) {
    case 'list':
      args.push('list', '--json', 'number,title,state,author,updatedAt,headRefName', ...repoArgs);
      break;

    case 'get':
      if (!params.pr_number) throw new Error('pr_number is required for get action');
      args.push('view', String(params.pr_number), ...repoArgs);
      break;

    case 'create':
      if (!params.title) throw new Error('title is required for create action');
      args.push('create', '--title', params.title);
      if (params.body) args.push('--body', params.body);
      if (params.base) args.push('--base', params.base);
      if (params.head) args.push('--head', params.head);
      args.push(...repoArgs);
      break;

    case 'comment':
      if (!params.pr_number) throw new Error('pr_number is required for comment action');
      if (!params.body) throw new Error('body is required for comment action');
      args.push('comment', String(params.pr_number), '--body', params.body, ...repoArgs);
      break;

    case 'merge':
      if (!params.pr_number) throw new Error('pr_number is required for merge action');
      args.push('merge', String(params.pr_number), '--merge', ...repoArgs);
      break;

    case 'diff':
      if (!params.pr_number) throw new Error('pr_number is required for diff action');
      args.push('diff', String(params.pr_number), ...repoArgs);
      break;

    default:
      throw new Error(`Unknown action: ${params.action}`);
  }

  return args;
}

function runGh(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('gh', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('GitHub CLI timed out'));
    }, GH_TIMEOUT_MS);

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > MAX_OUTPUT_CHARS) {
        stdout = stdout.slice(0, MAX_OUTPUT_CHARS) + '\n...(truncated)';
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout.trim() || '(no output)');
      } else {
        reject(new Error(stderr.trim() || `gh exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('gh CLI not found. Install from https://cli.github.com'));
      } else {
        reject(err);
      }
    });
  });
}

// =============================================================================
// Types
// =============================================================================

export interface GithubPrResult {
  action: string;
  output: string;
  pr_number?: number;
  url?: string;
}
