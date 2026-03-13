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
});

export type ExecParams = z.infer<typeof ExecParamsSchema>;

// Constants

const DEFAULT_TIMEOUT_SEC = 300;
const MAX_OUTPUT_CHARS = 200_000;
const YIELD_MS = 10_000; // Background after 10s if not finished

// Tool Definition

export const execTool: ToolDefinition<ExecParams, ExecResult> = {
  name: 'exec',
  description: `Execute shell commands. Commands run in a shell with access to standard Unix tools.
Use for: running scripts, git operations, package management, file manipulation.
The command output is captured and returned. Long-running commands can be backgrounded.`,
  category: 'execution',
  securityLevel: 'moderate',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: ExecParamsSchema,
  examples: [
    { description: 'List files', params: { command: 'ls -la' } },
    { description: 'Git status', params: { command: 'git status' } },
    { description: 'Run npm install', params: { command: 'npm install' } },
  ],

  async execute(context: ToolExecutionContext, params: ExecParams): Promise<ToolResult<ExecResult>> {
    const { sessionManager, signal, onProgress } = context;
    const workdir = params.workdir ?? context.workdir;
    const timeoutSec = params.timeout ?? DEFAULT_TIMEOUT_SEC;

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

    return new Promise((resolve) => {
      const startedAt = Date.now();

      // Determine shell
      const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
      const shellArgs = process.platform === 'win32' ? ['/c', params.command] : ['-c', params.command];

      // Build environment
      const env = {
        ...process.env,
        ...context.env,
        ...params.env,
        PWD: workdir,
      };

      logger.debug(`[ExecTool] Running: ${params.command}`, { component: 'ExecTool' });

      // Spawn process
      const proc = spawn(shell, shellArgs, {
        cwd: workdir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      });

      // Attach to session manager
      (sessionManager as unknown as { attachProcess: (id: string, proc: unknown) => void })
        .attachProcess?.(session.id, proc);

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let yielded = false;

      const resolveAsBackgrounded = () => {
        if (yielded || proc.exitCode !== null) {
          return;
        }

        yielded = true;
        (sessionManager as unknown as { background: (id: string) => void }).background?.(
          session.id
        );

        resolve({
          success: true,
          data: {
            status: 'running',
            sessionId: session.id,
            pid: proc.pid,
            output: stdout || '(running...)',
          },
          output: `Command running in background (session ${session.id}). Use session_status to check progress.`,
          isRunning: true,
          isBackgrounded: true,
          sessionId: session.id,
        });
      };

      // Timeout handler
      const timeout = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, timeoutSec * 1000);

      // Yield timer for background execution
      const yieldTimer = params.background
        ? null
        : setTimeout(resolveAsBackgrounded, YIELD_MS);

      // Handle abort signal
      if (signal) {
        signal.addEventListener('abort', () => {
          if (!yielded) {
            proc.kill('SIGTERM');
          }
        });
      }

      // Collect output
      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;

        // Report progress
        if (onProgress && !yielded) {
          onProgress({
            type: 'output',
            content: text,
            timestamp: Date.now(),
          });
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;

        if (onProgress && !yielded) {
          onProgress({
            type: 'output',
            content: `stderr: ${text}`,
            timestamp: Date.now(),
          });
        }
      });

      // Handle completion
      proc.on('close', (code, exitSignal) => {
        clearTimeout(timeout);
        if (yieldTimer) clearTimeout(yieldTimer);

        if (yielded) {
          // Already returned as backgrounded
          return;
        }

        const durationMs = Date.now() - startedAt;
        const success = code === 0 && !timedOut;

        // Truncate if needed
        if (stdout.length > MAX_OUTPUT_CHARS) {
          stdout = `[...truncated...]\n${stdout.slice(-MAX_OUTPUT_CHARS)}`;
        }
        if (stderr.length > MAX_OUTPUT_CHARS) {
          stderr = `[...truncated...]\n${stderr.slice(-MAX_OUTPUT_CHARS)}`;
        }

        // Build output message
        let output = stdout || '';
        if (stderr) {
          output += `\n--- stderr ---\n${stderr}`;
        }

        if (timedOut) {
          output += `\n\n⚠️ Command timed out after ${timeoutSec} seconds`;
        } else if (code !== 0) {
          output += `\n\n❌ Command exited with code ${code}`;
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
          sessionId: session.id,
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
            sessionId: session.id,
          });
        }
      });

      if (params.background) {
        resolveAsBackgrounded();
      }
    });
  },
};

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
