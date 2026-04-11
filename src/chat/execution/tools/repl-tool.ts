/**
 * REPL Tool
 *
 * Execute code in persistent REPL sessions.
 * State (variables, imports) survives between calls within the same session.
 * Supports Node.js and Python 3.
 */

import { z } from 'zod';
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { randomUUID } from 'node:crypto';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import { logger } from '../../../utils/logger.js';

// Types

export interface REPLSession {
  id: string;
  language: 'node' | 'python';
  process: ChildProcess;
  output: string[];
  createdAt: number;
}

export interface REPLResult {
  output: string;
  sessionId: string;
  language: 'node' | 'python';
  error?: string;
}

// Module-level session registry

const sessions = new Map<string, REPLSession>();

// Constants

const REPL_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 50_000;
const MAX_OUTPUT_HISTORY = 50;

// Prompt patterns that indicate the REPL is ready for next input
const NODE_PROMPT_RE = /^> $/m;
const PYTHON_PROMPT_RE = /^>>> $/m;

/**
 * Retrieve an existing session or create a new one.
 */
function getOrCreateSession(language: 'node' | 'python', sessionId?: string): REPLSession {
  if (sessionId) {
    const existing = sessions.get(sessionId);
    if (existing) return existing;
  }

  const id = sessionId ?? randomUUID();

  const command = language === 'node' ? 'node' : 'python3';
  const args = language === 'node' ? ['-i'] : ['-i', '-u'];

  const proc = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  const session: REPLSession = {
    id,
    language,
    process: proc,
    output: [],
    createdAt: Date.now(),
  };

  proc.on('close', () => {
    sessions.delete(id);
    logger.debug(`[ReplTool] Session ${id} closed`, { component: 'ReplTool' });
  });

  proc.on('error', (err) => {
    logger.warn(`[ReplTool] Session ${id} process error: ${err.message}`, { component: 'ReplTool' });
    sessions.delete(id);
  });

  sessions.set(id, session);
  logger.debug(`[ReplTool] Created session ${id} (${language})`, { component: 'ReplTool' });

  return session;
}

/**
 * Write code to a REPL session and collect output until the prompt reappears.
 * Returns a promise that resolves with the captured output string.
 */
function executeInSession(session: REPLSession, code: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { process: proc, language } = session;
    const promptRe = language === 'node' ? NODE_PROMPT_RE : PYTHON_PROMPT_RE;

    if (!proc.stdin || !proc.stdout || !proc.stderr) {
      reject(new Error('REPL process streams unavailable'));
      return;
    }

    let collected = '';
    let settled = false;

    const settle = (result: string, err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      proc.stdout?.removeListener('data', onData);
      proc.stderr?.removeListener('data', onData);
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    };

    const onData = (chunk: Buffer) => {
      collected += chunk.toString();

      // Truncate if runaway output
      if (collected.length > MAX_OUTPUT_CHARS) {
        collected = `[...truncated...]\n${collected.slice(-MAX_OUTPUT_CHARS)}`;
      }

      // Check for the prompt — indicates execution is complete
      if (promptRe.test(collected)) {
        // Strip the trailing prompt line from the output
        const cleaned = collected.replace(/\n?> $|\n?>>> $/m, '').trim();
        settle(cleaned);
      }
    };

    const timeoutHandle = setTimeout(() => {
      settle('', new Error(`REPL execution timed out after ${REPL_TIMEOUT_MS / 1000}s`));
    }, REPL_TIMEOUT_MS);

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);

    // Send code followed by a newline so the REPL executes it
    const input = code.endsWith('\n') ? code : `${code}\n`;
    proc.stdin.write(input);
  });
}

// Schema

const ReplExecuteParamsSchema = z.object({
  code: z.string().min(1).describe('Code to execute in the REPL'),
  language: z.enum(['node', 'python']).default('node').describe('REPL language runtime'),
  sessionId: z.string().optional().describe('Reuse an existing session ID. Omit to create a new session.'),
});

export type ReplExecuteParams = z.infer<typeof ReplExecuteParamsSchema>;

// Tool Definition

export const replTool: ToolDefinition<ReplExecuteParams, REPLResult> = {
  name: 'repl_execute',
  description: `Execute code in a persistent REPL session. State persists between calls (variables, imports stay alive). Use for iterative exploration, testing code snippets, or running multi-step computations.

Examples:
- node: assign variables, require modules, test expressions
- python: import libraries, define functions, explore data

The sessionId returned can be passed back to reuse the same session.`,
  category: 'execution',
  securityLevel: 'dangerous',
  parameters: ReplExecuteParamsSchema,
  examples: [
    { description: 'Run a Node.js snippet', params: { code: 'const x = 42; x * 2', language: 'node' } },
    { description: 'Run Python', params: { code: 'import sys; sys.version', language: 'python' } },
    { description: 'Reuse a session', params: { code: 'x + 1', language: 'node', sessionId: 'existing-session-id' } },
  ],

  async execute(_context: ToolExecutionContext, params: ReplExecuteParams): Promise<ToolResult<REPLResult>> {
    const { code, language, sessionId } = params;

    let session: REPLSession;
    try {
      session = getOrCreateSession(language, sessionId);
    } catch (error) {
      return {
        success: false,
        output: `Failed to create REPL session: ${error instanceof Error ? error.message : String(error)}`,
        error: {
          code: 'SESSION_CREATE_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }

    try {
      const output = await executeInSession(session, code);

      // Store output in session history (capped to prevent unbounded growth)
      session.output.push(output);
      if (session.output.length > MAX_OUTPUT_HISTORY) {
        session.output.splice(0, session.output.length - MAX_OUTPUT_HISTORY);
      }

      const result: REPLResult = {
        output,
        sessionId: session.id,
        language,
      };

      return {
        success: true,
        data: result,
        output: output || '(no output)',
        sessionId: session.id,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Remove dead session on timeout/error
      if (error instanceof Error && error.message.includes('timed out')) {
        sessions.delete(session.id);
      }

      return {
        success: false,
        output: `REPL execution failed: ${message}`,
        error: {
          code: 'REPL_EXECUTION_FAILED',
          message,
        },
        sessionId: session.id,
      };
    }
  },
};

// Exported helpers for testing and session management

/** List all active REPL session IDs */
export function listReplSessions(): string[] {
  return Array.from(sessions.keys());
}

/** Terminate and remove a session by ID */
export function closeReplSession(id: string): boolean {
  const session = sessions.get(id);
  if (!session) return false;

  try {
    session.process.kill('SIGTERM');
  } catch {
    // already dead
  }

  sessions.delete(id);
  return true;
}

/** Exposed for tests — direct access to the internal session map */
export function getReplSessionsMap(): Map<string, REPLSession> {
  return sessions;
}
