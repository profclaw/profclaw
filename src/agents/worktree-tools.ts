/**
 * Worktree-confined tools for the verified-run agent.
 *
 * A small coding toolset (read, write, list, shell, complete) whose every file
 * operation is resolved against a single root directory, the run's git
 * worktree. Paths that escape the root (via `..`, absolute paths or symlinks)
 * are rejected, writes into `.git` are refused, and shell commands that push
 * or open pull requests are denied. Cautious and dangerous tools also go
 * through the existing PermissionManager (src/agents/permissions.ts).
 *
 * Limitation: the shell tool runs with the worktree as cwd and a scrubbed
 * environment, but a shell cannot be fully sandboxed without OS-level
 * isolation. Pattern screening is a guard rail, not a jail.
 */

import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { jsonSchema, tool } from 'ai';
import type { ToolSet } from 'ai';
import { PermissionManager } from './permissions.js';
import type { ToolExecuteHandler } from './executor.js';

export interface WorktreeToolsOptions {
  /** Root every file operation is confined to */
  workdir: string;
  permissions?: PermissionManager;
  /** Kill shell commands after this long */
  commandTimeoutMs: number;
  /** Cap on text returned to the model per tool call */
  maxOutputChars: number;
}

export interface WorktreeToolset {
  tools: ToolSet;
  execute: ToolExecuteHandler;
}

/** Tools the agent must never be given, denied even if requested by name. */
const DENIED_TOOLS = new Set(['git_push', 'git_force_push']);

/** Shell commands that would publish work. Screened before execution. */
const BLOCKED_COMMAND_PATTERNS: RegExp[] = [
  /\bgit\b[^;&|\n]*\bpush\b/,
  /\bgh\s+(pr|repo|release|api|workflow)\b/,
  /\bgit\b[^;&|\n]*\bremote\s+(add|set-url)\b/,
  /\bgit\b[^;&|\n]*--receive-pack\b/,
];

/** Environment variables that carry credentials for remotes. */
const SCRUBBED_ENV_KEYS = ['GITHUB_TOKEN', 'GH_TOKEN', 'GITLAB_TOKEN', 'GIT_ASKPASS', 'SSH_AUTH_SOCK'];

export function isBlockedCommand(command: string): boolean {
  return BLOCKED_COMMAND_PATTERNS.some((p) => p.test(command));
}

/** Non-interactive policy: allow everything except publishing actions. */
export function createRunPermissionManager(): PermissionManager {
  const manager = new PermissionManager();
  manager.setPromptCallback(async (toolName, args) => {
    if (DENIED_TOOLS.has(toolName)) return 'deny';
    if (toolName === 'bash') {
      const command = getString(args, 'command');
      if (command !== undefined && isBlockedCommand(command)) return 'deny';
    }
    return 'allow';
  });
  return manager;
}

function getString(args: unknown, key: string): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  if (rel === '') return true;
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Resolve `requested` against `root` and guarantee the result stays inside it,
 * including through symlinks (checked on the deepest existing ancestor).
 */
export async function confinePath(root: string, requested: string): Promise<string> {
  const absolute = resolve(root, requested);
  if (!isInside(root, absolute)) throw new Error(`Path escapes the worktree: ${requested}`);

  const rootReal = await realpath(root);
  let probe = absolute;
  for (;;) {
    try {
      const real = await realpath(probe);
      if (!isInside(rootReal, real)) throw new Error(`Path escapes the worktree via symlink: ${requested}`);
      return absolute;
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith('Path escapes')) throw error;
      const parent = dirname(probe);
      if (parent === probe) throw new Error(`Cannot resolve path: ${requested}`);
      probe = parent;
    }
  }
}

function truncateTail(text: string, max: number): string {
  return text.length <= max ? text : `...[truncated]\n${text.slice(-max)}`;
}

function runShell(
  command: string,
  cwd: string,
  timeoutMs: number,
  maxChars: number,
): Promise<{ exitCode: number | null; output: string; timedOut: boolean }> {
  return new Promise((resolvePromise) => {
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    for (const key of SCRUBBED_ENV_KEYS) delete env[key];
    const child = spawn('/bin/sh', ['-c', command], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let timedOut = false;
    const append = (d: Buffer): void => {
      output = (output + d.toString('utf-8')).slice(-maxChars * 2);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', (err: Error) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: null, output: err.message, timedOut });
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: code, output: truncateTail(output, maxChars), timedOut });
    });
  });
}

function schemaTool(description: string, properties: Record<string, { type: 'string' }>, required: string[]): ToolSet[string] {
  return tool({
    description,
    inputSchema: jsonSchema<Record<string, unknown>>({
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    }),
  });
}

export function createWorktreeToolset(options: WorktreeToolsOptions): WorktreeToolset {
  const { workdir, commandTimeoutMs, maxOutputChars } = options;
  const permissions = options.permissions ?? createRunPermissionManager();

  const tools: ToolSet = {
    read_file: schemaTool('Read a UTF-8 text file inside the working directory.', { path: { type: 'string' } }, ['path']),
    write_file: schemaTool(
      'Create or overwrite a file inside the working directory. Parent directories are created.',
      { path: { type: 'string' }, content: { type: 'string' } },
      ['path', 'content'],
    ),
    list_files: schemaTool(
      'List entries of a directory inside the working directory (default: the root).',
      { path: { type: 'string' } },
      [],
    ),
    bash: schemaTool(
      'Run a shell command with the working directory as cwd. Use it to run tests and the verify command. Pushing and opening pull requests is forbidden.',
      { command: { type: 'string' } },
      ['command'],
    ),
    complete_task: schemaTool(
      'Call when the goal is done. Provide a short summary of what changed.',
      { summary: { type: 'string' } },
      ['summary'],
    ),
  };

  const execute: ToolExecuteHandler = async (name, args) => {
    if (DENIED_TOOLS.has(name)) return { success: false, error: `Tool "${name}" is not allowed in a verified run` };
    if (!(name in tools)) return { success: false, error: `Unknown tool "${name}"` };

    const verdict = await permissions.check(name, args);
    if (!verdict.allowed) return { success: false, error: verdict.reason ?? `Permission denied for "${name}"` };

    try {
      switch (name) {
        case 'read_file': {
          const path = getString(args, 'path');
          if (path === undefined) return { success: false, error: 'path is required' };
          const target = await confinePath(workdir, path);
          const text = await readFile(target, 'utf-8');
          return { success: true, data: { content: truncateTail(text, maxOutputChars) } };
        }
        case 'write_file': {
          const path = getString(args, 'path');
          const content = getString(args, 'content');
          if (path === undefined || content === undefined) return { success: false, error: 'path and content are required' };
          const target = await confinePath(workdir, path);
          const rel = relative(workdir, target);
          if (rel === '.git' || rel.startsWith(`.git${sep}`)) return { success: false, error: 'Writing into .git is not allowed' };
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, content, 'utf-8');
          return { success: true, data: { path: rel, bytes: Buffer.byteLength(content) } };
        }
        case 'list_files': {
          const target = await confinePath(workdir, getString(args, 'path') ?? '.');
          const entries = await readdir(target, { withFileTypes: true });
          const names = entries
            .filter((e) => e.name !== '.git')
            .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
            .sort();
          return { success: true, data: { entries: names } };
        }
        case 'bash': {
          const command = getString(args, 'command');
          if (command === undefined) return { success: false, error: 'command is required' };
          if (isBlockedCommand(command)) {
            return { success: false, error: 'Command denied: pushing and opening pull requests are not allowed' };
          }
          const result = await runShell(command, workdir, commandTimeoutMs, maxOutputChars);
          return {
            success: result.exitCode === 0,
            data: { exitCode: result.exitCode, timedOut: result.timedOut, output: result.output },
            ...(result.exitCode === 0 ? {} : { error: `exit ${result.exitCode ?? 'null'}${result.timedOut ? ' (timed out)' : ''}` }),
          };
        }
        case 'complete_task':
          return { success: true, data: { summary: getString(args, 'summary') ?? 'Done' } };
        default:
          return { success: false, error: `Unknown tool "${name}"` };
      }
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : 'Tool failed' };
    }
  };

  return { tools, execute };
}
