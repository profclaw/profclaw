/**
 * Git Tools
 *
 * Git operations for version control tasks.
 */

import { z } from 'zod';
import { spawn, spawnSync } from 'child_process';
import type { ToolDefinition, ToolResult, ToolExecutionContext, ToolAvailability } from '../types.js';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// Availability Check
// =============================================================================

/** Cache git availability to avoid repeated system calls */
let gitAvailabilityCache: ToolAvailability | null = null;

/**
 * Check if git is available on the system
 * Caches result since git installation doesn't change during runtime
 */
function checkGitAvailability(): ToolAvailability {
  if (gitAvailabilityCache) {
    return gitAvailabilityCache;
  }

  try {
    const result = spawnSync('git', ['--version'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });

    if (result.status === 0) {
      gitAvailabilityCache = { available: true };
    } else {
      gitAvailabilityCache = {
        available: false,
        reason: 'Git command failed',
      };
    }
  } catch {
    gitAvailabilityCache = {
      available: false,
      reason: 'Git is not installed',
    };
  }

  return gitAvailabilityCache;
}

// =============================================================================
// Schemas
// =============================================================================

const GitStatusParamsSchema = z.object({
  path: z.string().optional().describe('Repository path (defaults to workdir)'),
  short: z.boolean().optional().describe('Show short format'),
});

const GitDiffParamsSchema = z.object({
  path: z.string().optional().describe('Repository path'),
  file: z.string().optional().describe('Specific file to diff'),
  staged: z.boolean().optional().describe('Show staged changes'),
  commit: z.string().optional().describe('Compare against commit'),
});

const GitLogParamsSchema = z.object({
  path: z.string().optional().describe('Repository path'),
  count: z.number().optional().default(10).describe('Number of commits'),
  oneline: z.boolean().optional().default(true).describe('One line format'),
  author: z.string().optional().describe('Filter by author'),
  since: z.string().optional().describe('Since date (e.g., "2 weeks ago")'),
});

const GitCommitParamsSchema = z.object({
  path: z.string().optional().describe('Repository path'),
  message: z.string().describe('Commit message'),
  all: z.boolean().optional().describe('Stage all modified files'),
  amend: z.boolean().optional().describe('Amend previous commit'),
});

const GitBranchParamsSchema = z.object({
  path: z.string().optional().describe('Repository path'),
  list: z.boolean().optional().describe('List branches'),
  create: z.string().optional().describe('Create new branch'),
  delete: z.string().optional().describe('Delete branch'),
  checkout: z.string().optional().describe('Switch to branch'),
});

const GitStashParamsSchema = z.object({
  path: z.string().optional().describe('Repository path'),
  action: z.enum(['push', 'pop', 'list', 'show', 'drop', 'clear']).default('list'),
  message: z.string().optional().describe('Stash message (for push)'),
  index: z.number().optional().describe('Stash index (for pop/show/drop)'),
});

const GitRemoteParamsSchema = z.object({
  path: z.string().optional().describe('Repository path'),
  action: z.enum(['fetch', 'pull', 'push']).describe('Remote action'),
  remote: z.string().optional().default('origin').describe('Remote name'),
  branch: z.string().optional().describe('Branch name'),
  force: z.boolean().optional().describe('Force push (dangerous)'),
});

export type GitStatusParams = z.infer<typeof GitStatusParamsSchema>;
export type GitDiffParams = z.infer<typeof GitDiffParamsSchema>;
export type GitLogParams = z.infer<typeof GitLogParamsSchema>;
export type GitCommitParams = z.infer<typeof GitCommitParamsSchema>;
export type GitBranchParams = z.infer<typeof GitBranchParamsSchema>;
export type GitStashParams = z.infer<typeof GitStashParamsSchema>;
export type GitRemoteParams = z.infer<typeof GitRemoteParamsSchema>;

// =============================================================================
// Helper Functions
// =============================================================================

async function runGit(
  args: string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn('git', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    if (signal) {
      signal.addEventListener('abort', () => proc.kill('SIGTERM'));
    }

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 1,
      });
    });

    proc.on('error', (error) => {
      resolve({
        success: false,
        stdout: '',
        stderr: error.message,
        exitCode: 1,
      });
    });
  });
}

// =============================================================================
// Git Status Tool
// =============================================================================

export const gitStatusTool: ToolDefinition<GitStatusParams, GitResult> = {
  name: 'git_status',
  description: 'Show the working tree status. Lists staged, unstaged, and untracked files.',
  category: 'execution',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: GitStatusParamsSchema,
  isAvailable: checkGitAvailability,
  examples: [
    { description: 'Check status', params: {} },
    { description: 'Short format', params: { short: true } },
  ],

  async execute(context: ToolExecutionContext, params: GitStatusParams): Promise<ToolResult<GitResult>> {
    const cwd = params.path ?? context.workdir;
    const args = ['status'];
    if (params.short) args.push('-s');

    logger.debug(`[Git] Running: git ${args.join(' ')}`, { component: 'GitTool' });

    const result = await runGit(args, cwd, context.signal);

    return {
      success: result.success,
      data: {
        command: `git ${args.join(' ')}`,
        output: result.stdout,
        exitCode: result.exitCode,
      },
      output: result.stdout || result.stderr || '(no output)',
      error: result.success ? undefined : {
        code: 'GIT_ERROR',
        message: result.stderr || `Exit code: ${result.exitCode}`,
      },
    };
  },
};

// =============================================================================
// Git Diff Tool
// =============================================================================

export const gitDiffTool: ToolDefinition<GitDiffParams, GitResult> = {
  name: 'git_diff',
  description: 'Show changes between commits, working tree, and staging area.',
  category: 'execution',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: GitDiffParamsSchema,
  isAvailable: checkGitAvailability,
  examples: [
    { description: 'Show unstaged changes', params: {} },
    { description: 'Show staged changes', params: { staged: true } },
    { description: 'Diff specific file', params: { file: 'src/index.ts' } },
  ],

  async execute(context: ToolExecutionContext, params: GitDiffParams): Promise<ToolResult<GitResult>> {
    const cwd = params.path ?? context.workdir;
    const args = ['diff'];
    if (params.staged) args.push('--staged');
    if (params.commit) args.push(params.commit);
    if (params.file) args.push('--', params.file);

    const result = await runGit(args, cwd, context.signal);

    return {
      success: result.success,
      data: {
        command: `git ${args.join(' ')}`,
        output: result.stdout,
        exitCode: result.exitCode,
      },
      output: result.stdout || '(no changes)',
      error: result.success ? undefined : {
        code: 'GIT_ERROR',
        message: result.stderr || `Exit code: ${result.exitCode}`,
      },
    };
  },
};

// =============================================================================
// Git Log Tool
// =============================================================================

export const gitLogTool: ToolDefinition<GitLogParams, GitResult> = {
  name: 'git_log',
  description: 'Show commit history with various formatting options.',
  category: 'execution',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: GitLogParamsSchema,
  isAvailable: checkGitAvailability,
  examples: [
    { description: 'Recent commits', params: { count: 10 } },
    { description: 'By author', params: { author: 'john', count: 20 } },
  ],

  async execute(context: ToolExecutionContext, params: GitLogParams): Promise<ToolResult<GitResult>> {
    const cwd = params.path ?? context.workdir;
    const args = ['log', `-${params.count}`];
    if (params.oneline) args.push('--oneline');
    if (params.author) args.push(`--author=${params.author}`);
    if (params.since) args.push(`--since="${params.since}"`);

    const result = await runGit(args, cwd, context.signal);

    return {
      success: result.success,
      data: {
        command: `git ${args.join(' ')}`,
        output: result.stdout,
        exitCode: result.exitCode,
      },
      output: result.stdout || '(no commits)',
      error: result.success ? undefined : {
        code: 'GIT_ERROR',
        message: result.stderr || `Exit code: ${result.exitCode}`,
      },
    };
  },
};

// =============================================================================
// Git Commit Tool
// =============================================================================

export const gitCommitTool: ToolDefinition<GitCommitParams, GitResult> = {
  name: 'git_commit',
  description: 'Create a new commit with staged changes.',
  category: 'execution',
  securityLevel: 'moderate',
  requiresApproval: true,
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: GitCommitParamsSchema,
  isAvailable: checkGitAvailability,
  examples: [
    { description: 'Simple commit', params: { message: 'Fix bug' } },
    { description: 'Commit all', params: { message: 'Update files', all: true } },
  ],

  async execute(context: ToolExecutionContext, params: GitCommitParams): Promise<ToolResult<GitResult>> {
    const cwd = params.path ?? context.workdir;
    const args = ['commit'];
    if (params.all) args.push('-a');
    if (params.amend) args.push('--amend');
    args.push('-m', params.message);

    const result = await runGit(args, cwd, context.signal);

    return {
      success: result.success,
      data: {
        command: `git ${args.join(' ')}`,
        output: result.stdout,
        exitCode: result.exitCode,
      },
      output: result.stdout || result.stderr || '(no output)',
      error: result.success ? undefined : {
        code: 'GIT_ERROR',
        message: result.stderr || `Exit code: ${result.exitCode}`,
      },
    };
  },
};

// =============================================================================
// Git Branch Tool
// =============================================================================

export const gitBranchTool: ToolDefinition<GitBranchParams, GitResult> = {
  name: 'git_branch',
  description: 'List, create, delete, or switch branches.',
  category: 'execution',
  securityLevel: 'moderate',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: GitBranchParamsSchema,
  isAvailable: checkGitAvailability,
  examples: [
    { description: 'List branches', params: { list: true } },
    { description: 'Create branch', params: { create: 'feature/new' } },
    { description: 'Switch branch', params: { checkout: 'main' } },
  ],

  async execute(context: ToolExecutionContext, params: GitBranchParams): Promise<ToolResult<GitResult>> {
    const cwd = params.path ?? context.workdir;
    let args: string[];

    if (params.checkout) {
      args = ['checkout', params.checkout];
    } else if (params.create) {
      args = ['checkout', '-b', params.create];
    } else if (params.delete) {
      args = ['branch', '-d', params.delete];
    } else {
      args = ['branch', '-a'];
    }

    const result = await runGit(args, cwd, context.signal);

    return {
      success: result.success,
      data: {
        command: `git ${args.join(' ')}`,
        output: result.stdout,
        exitCode: result.exitCode,
      },
      output: result.stdout || result.stderr || '(no output)',
      error: result.success ? undefined : {
        code: 'GIT_ERROR',
        message: result.stderr || `Exit code: ${result.exitCode}`,
      },
    };
  },
};

// =============================================================================
// Git Stash Tool
// =============================================================================

export const gitStashTool: ToolDefinition<GitStashParams, GitResult> = {
  name: 'git_stash',
  description: 'Stash changes for later use.',
  category: 'execution',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: GitStashParamsSchema,
  isAvailable: checkGitAvailability,
  examples: [
    { description: 'List stashes', params: { action: 'list' } },
    { description: 'Stash changes', params: { action: 'push', message: 'WIP' } },
    { description: 'Pop stash', params: { action: 'pop' } },
  ],

  async execute(context: ToolExecutionContext, params: GitStashParams): Promise<ToolResult<GitResult>> {
    const cwd = params.path ?? context.workdir;
    const args = ['stash', params.action];

    if (params.action === 'push' && params.message) {
      args.push('-m', params.message);
    }
    if (['pop', 'show', 'drop'].includes(params.action) && params.index !== undefined) {
      args.push(`stash@{${params.index}}`);
    }

    const result = await runGit(args, cwd, context.signal);

    return {
      success: result.success,
      data: {
        command: `git ${args.join(' ')}`,
        output: result.stdout,
        exitCode: result.exitCode,
      },
      output: result.stdout || result.stderr || '(no stashes)',
      error: result.success ? undefined : {
        code: 'GIT_ERROR',
        message: result.stderr || `Exit code: ${result.exitCode}`,
      },
    };
  },
};

// =============================================================================
// Git Remote Tool
// =============================================================================

export const gitRemoteTool: ToolDefinition<GitRemoteParams, GitResult> = {
  name: 'git_remote',
  description: 'Fetch, pull, or push to remote repositories.',
  category: 'execution',
  securityLevel: 'moderate',
  requiresApproval: true,
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: GitRemoteParamsSchema,
  isAvailable: checkGitAvailability,
  examples: [
    { description: 'Fetch updates', params: { action: 'fetch' } },
    { description: 'Pull changes', params: { action: 'pull' } },
    { description: 'Push changes', params: { action: 'push' } },
  ],

  async execute(context: ToolExecutionContext, params: GitRemoteParams): Promise<ToolResult<GitResult>> {
    const cwd = params.path ?? context.workdir;
    const args = [params.action, params.remote];

    if (params.branch) args.push(params.branch);
    if (params.action === 'push' && params.force) args.push('--force');

    const result = await runGit(args, cwd, context.signal);

    return {
      success: result.success,
      data: {
        command: `git ${args.join(' ')}`,
        output: result.stdout,
        exitCode: result.exitCode,
      },
      output: result.stdout || result.stderr || '(no output)',
      error: result.success ? undefined : {
        code: 'GIT_ERROR',
        message: result.stderr || `Exit code: ${result.exitCode}`,
      },
    };
  },
};

// =============================================================================
// Types
// =============================================================================

export interface GitResult {
  command: string;
  output: string;
  exitCode: number;
}
