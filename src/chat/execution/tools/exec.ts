/**
 * Exec Tool
 *
 * Execute shell commands with safety controls.
 * Supports background execution, PTY, and output streaming.
 */

import { z } from 'zod';
import { spawn } from 'child_process';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import { logger } from '../../../utils/logger.js';

// Schema

const ExecParamsSchema = z.object({
  command: z.string().min(1).describe('Shell command to execute'),
  workdir: z.string().optional().describe('Working directory (defaults to current)'),
  env: z.record(z.string()).optional().describe('Environment variables'),
  timeout: z.number().optional().describe('Timeout in seconds (default: 300)'),
  background: z.boolean().optional().describe('Run in background immediately'),
  pty: z.boolean().optional().describe('Enable PTY mode for interactive terminal commands'),
});

export type ExecParams = z.infer<typeof ExecParamsSchema>;

// Constants

const DEFAULT_TIMEOUT_SEC = 300;
const MAX_OUTPUT_CHARS = 200_000;
const YIELD_MS = 10_000; // Background after 10s if not finished

// PTY spawn helper - dynamically imported to allow graceful fallback

async function spawnWithPty(
  command: string,
  options: {
    shell: string;
    cwd: string;
    env: Record<string, string | undefined>;
    cols?: number;
    rows?: number;
  }
): Promise<{
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (ev: { exitCode: number; signal?: number }) => void) => void;
  kill: (signal?: string) => void;
  pid: number;
}> {
  // Dynamic import allows graceful fallback if native module fails to load
  const pty = await import('node-pty');

  const ptyProc = pty.spawn(options.shell, ['-c', command], {
    name: 'xterm-256color',
    cols: options.cols ?? 220,
    rows: options.rows ?? 50,
    cwd: options.cwd,
    env: options.env as Record<string, string>,
    encoding: 'utf8',
  });

  return {
    pid: ptyProc.pid,
    onData: (cb) => {
      ptyProc.onData(cb);
    },
    onExit: (cb) => {
      ptyProc.onExit(cb);
    },
    kill: (signal) => {
      ptyProc.kill(signal);
    },
  };
}

// Tool Definition

export const execTool: ToolDefinition<ExecParams, ExecResult> = {
  name: 'exec',
  description: `Execute shell commands. Commands run in a shell with access to standard Unix tools.
Use for: running scripts, git operations, package management, file manipulation.
The command output is captured and returned. Long-running commands can be backgrounded.
Use pty: true for interactive commands that require a terminal (e.g. npm, yarn, interactive CLIs).`,
  category: 'execution',
  securityLevel: 'moderate',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: ExecParamsSchema,
  examples: [
    { description: 'List files', params: { command: 'ls -la' } },
    { description: 'Git status', params: { command: 'git status' } },
    { description: 'Run npm install', params: { command: 'npm install' } },
    { description: 'Interactive CLI via PTY', params: { command: 'npm run build', pty: true } },
  ],

  async execute(context: ToolExecutionContext, params: ExecParams): Promise<ToolResult<ExecResult>> {
    const { sessionManager, signal, onProgress } = context;
    const workdir = params.workdir ?? context.workdir;
    const timeoutSec = params.timeout ?? DEFAULT_TIMEOUT_SEC;
    const usePty = params.pty ?? false;

    // Create session for tracking
    const session = sessionManager.create({
      toolCallId: context.toolCallId,
      toolName: 'exec',
      conversationId: context.conversationId,
      command: params.command,
      workdir,
      status: 'pending',
      stdout: '',
      stderr: '',
      maxOutputChars: MAX_OUTPUT_CHARS,
      truncated: false,
      backgrounded: params.background ?? false,
      notifyOnExit: true,
    });

    // PTY execution path
    if (usePty) {
      return executePty(params, context, session.id, workdir, timeoutSec, signal, onProgress);
    }

    // Standard execution path
    return executeStandard(params, context, session.id, workdir, timeoutSec, signal, onProgress, sessionManager);
  },
};

// Standard (non-PTY) execution

function executeStandard(
  params: ExecParams,
  context: ToolExecutionContext,
  sessionId: string,
  workdir: string,
  timeoutSec: number,
  signal: AbortSignal | undefined,
  onProgress: ToolExecutionContext['onProgress'],
  sessionManager: ToolExecutionContext['sessionManager']
): Promise<ToolResult<ExecResult>> {
  return new Promise((resolve) => {
    const startedAt = Date.now();

    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
    const shellArgs = process.platform === 'win32' ? ['/c', params.command] : ['-c', params.command];

    const env = {
      ...process.env,
      ...context.env,
      ...params.env,
      PWD: workdir,
    };

    logger.debug(`[ExecTool] Running: ${params.command}`, { component: 'ExecTool' });

    const proc = spawn(shell, shellArgs, {
      cwd: workdir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });

    (sessionManager as unknown as { attachProcess: (id: string, proc: unknown) => void })
      .attachProcess?.(sessionId, proc);

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let yielded = false;

    const resolveAsBackgrounded = () => {
      if (yielded || proc.exitCode !== null) {
        return;
      }

      yielded = true;
      (sessionManager as unknown as { background: (id: string) => void }).background?.(sessionId);

      resolve({
        success: true,
        data: {
          status: 'running',
          sessionId,
          pid: proc.pid,
          output: stdout || '(running...)',
        },
        output: `Command running in background (session ${sessionId}). Use session_status to check progress.`,
        isRunning: true,
        isBackgrounded: true,
        sessionId,
      });
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, timeoutSec * 1000);

    const yieldTimer = params.background ? null : setTimeout(resolveAsBackgrounded, YIELD_MS);

    if (signal) {
      signal.addEventListener('abort', () => {
        if (!yielded) {
          proc.kill('SIGTERM');
        }
      });
    }

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;

      if (onProgress && !yielded) {
        onProgress({ type: 'output', content: text, timestamp: Date.now() });
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;

      if (onProgress && !yielded) {
        onProgress({ type: 'output', content: `stderr: ${text}`, timestamp: Date.now() });
      }
    });

    proc.on('close', (code, exitSignal) => {
      clearTimeout(timeout);
      if (yieldTimer) clearTimeout(yieldTimer);

      if (yielded) return;

      const durationMs = Date.now() - startedAt;
      const success = code === 0 && !timedOut;

      if (stdout.length > MAX_OUTPUT_CHARS) {
        stdout = `[...truncated...]\n${stdout.slice(-MAX_OUTPUT_CHARS)}`;
      }
      if (stderr.length > MAX_OUTPUT_CHARS) {
        stderr = `[...truncated...]\n${stderr.slice(-MAX_OUTPUT_CHARS)}`;
      }

      let output = stdout || '';
      if (stderr) {
        output += `\n--- stderr ---\n${stderr}`;
      }

      if (timedOut) {
        output += `\n\nCommand timed out after ${timeoutSec} seconds`;
      } else if (code !== 0) {
        output += `\n\nCommand exited with code ${code}`;
        if (exitSignal) {
          output += ` (signal: ${exitSignal})`;
        }
      }

      resolve({
        success,
        data: {
          status: success ? 'completed' : 'failed',
          exitCode: code,
          exitSignal: exitSignal?.toString() ?? undefined,
          stdout,
          stderr,
          durationMs,
          timedOut,
        },
        output: output.trim() || '(no output)',
        durationMs,
        sessionId,
        error: success
          ? undefined
          : {
              code: timedOut ? 'TIMEOUT' : 'EXIT_ERROR',
              message: timedOut
                ? `Command timed out after ${timeoutSec}s`
                : `Command exited with code ${code}`,
            },
      });
    });

    proc.on('error', (error) => {
      clearTimeout(timeout);
      if (yieldTimer) clearTimeout(yieldTimer);

      if (!yielded) {
        resolve({
          success: false,
          error: {
            code: 'SPAWN_ERROR',
            message: error.message,
          },
          output: `Failed to execute command: ${error.message}`,
          sessionId,
        });
      }
    });

    if (params.background) {
      resolveAsBackgrounded();
    }
  });
}

// PTY execution

async function executePty(
  params: ExecParams,
  context: ToolExecutionContext,
  sessionId: string,
  workdir: string,
  timeoutSec: number,
  signal: AbortSignal | undefined,
  onProgress: ToolExecutionContext['onProgress']
): Promise<ToolResult<ExecResult>> {
  const startedAt = Date.now();

  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';

  const env: Record<string, string | undefined> = {
    ...process.env,
    ...context.env,
    ...params.env,
    PWD: workdir,
    TERM: 'xterm-256color',
  };

  logger.debug(`[ExecTool] Running (PTY): ${params.command}`, { component: 'ExecTool' });

  let ptyProc: Awaited<ReturnType<typeof spawnWithPty>>;

  try {
    ptyProc = await spawnWithPty(params.command, {
      shell,
      cwd: workdir,
      env,
    });
  } catch (importError) {
    // Graceful fallback: node-pty not available (native module missing/incompatible)
    logger.warn(`[ExecTool] node-pty unavailable, falling back to standard spawn: ${importError instanceof Error ? importError.message : String(importError)}`, {
      component: 'ExecTool',
    });

    return executeStandard(
      params,
      context,
      sessionId,
      workdir,
      timeoutSec,
      signal,
      onProgress,
      context.sessionManager
    );
  }

  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let settled = false;

    const settle = (result: ToolResult<ExecResult>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolve(result);
    };

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      try {
        ptyProc.kill('SIGKILL');
      } catch {
        // process may already be gone
      }

      const durationMs = Date.now() - startedAt;
      settle({
        success: false,
        data: {
          status: 'failed',
          exitCode: null,
          output: output.length > MAX_OUTPUT_CHARS
            ? `[...truncated...]\n${output.slice(-MAX_OUTPUT_CHARS)}`
            : output,
          durationMs,
          timedOut: true,
        },
        output: `${output}\n\nCommand timed out after ${timeoutSec} seconds`.trim() || '(no output)',
        durationMs,
        sessionId,
        error: {
          code: 'TIMEOUT',
          message: `Command timed out after ${timeoutSec}s`,
        },
      });
    }, timeoutSec * 1000);

    if (signal) {
      signal.addEventListener('abort', () => {
        if (!settled) {
          try {
            ptyProc.kill('SIGTERM');
          } catch {
            // process may already be gone
          }
        }
      });
    }

    ptyProc.onData((data) => {
      output += data;

      if (onProgress && !settled) {
        onProgress({ type: 'output', content: data, timestamp: Date.now() });
      }
    });

    ptyProc.onExit(({ exitCode, signal: exitSignal }) => {
      if (timedOut) return;

      const durationMs = Date.now() - startedAt;
      const success = exitCode === 0;

      let finalOutput = output;
      if (finalOutput.length > MAX_OUTPUT_CHARS) {
        finalOutput = `[...truncated...]\n${finalOutput.slice(-MAX_OUTPUT_CHARS)}`;
      }

      let outputMsg = finalOutput;
      if (!success) {
        outputMsg += `\n\nCommand exited with code ${exitCode}`;
        if (exitSignal !== undefined) {
          outputMsg += ` (signal: ${exitSignal})`;
        }
      }

      settle({
        success,
        data: {
          status: success ? 'completed' : 'failed',
          exitCode,
          exitSignal: exitSignal !== undefined ? String(exitSignal) : undefined,
          stdout: finalOutput,
          stderr: '',
          durationMs,
          timedOut: false,
        },
        output: outputMsg.trim() || '(no output)',
        durationMs,
        sessionId,
        error: success
          ? undefined
          : {
              code: 'EXIT_ERROR',
              message: `Command exited with code ${exitCode}`,
            },
      });
    });
  });
}

// Types (exported for use in index.ts)

export interface ExecResult {
  status: 'completed' | 'failed' | 'running';
  exitCode?: number | null;
  exitSignal?: string;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  timedOut?: boolean;
  sessionId?: string;
  pid?: number;
  output?: string;
}
