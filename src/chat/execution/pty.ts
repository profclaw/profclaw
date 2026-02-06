/**
 * PTY (Pseudo-Terminal) Support
 *
 * Provides interactive terminal support for commands that require TTY.
 * Uses node-pty for cross-platform PTY handling.
 *
 * Use cases:
 * - Interactive installers (npm init, create-react-app)
 * - Text editors (vim, nano)
 * - Pagers (less, more)
 * - Password prompts
 * - SSH sessions
 */

import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { logger } from '../../utils/logger.js';
import { redactSecrets, isSecretsDetectionEnabled } from './secrets.js';

// =============================================================================
// Types
// =============================================================================

export interface PTYSession {
  id: string;
  pid: number;
  command: string;
  cols: number;
  rows: number;
  status: 'running' | 'exited';
  exitCode?: number;
  output: string;
  createdAt: Date;
  exitedAt?: Date;
}

export interface PTYOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number; // ms
  maxOutputChars?: number;
}

export interface PTYResult {
  success: boolean;
  exitCode: number;
  output: string;
  durationMs: number;
  truncated: boolean;
  secretsRedacted: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_OUTPUT = 200_000;

// =============================================================================
// PTY Manager
// =============================================================================

export class PTYManager extends EventEmitter {
  private sessions: Map<string, {
    pty: pty.IPty;
    session: PTYSession;
    outputBuffer: string;
    listeners: Set<(data: string) => void>;
  }> = new Map();

  private sessionCounter = 0;

  /**
   * Spawn a new PTY session
   */
  spawn(
    command: string,
    args: string[] = [],
    options: PTYOptions = {}
  ): PTYSession {
    const id = `pty_${Date.now()}_${++this.sessionCounter}`;
    const cols = options.cols ?? DEFAULT_COLS;
    const rows = options.rows ?? DEFAULT_ROWS;

    // Determine shell
    const shell = process.platform === 'win32'
      ? process.env.ComSpec || 'cmd.exe'
      : process.env.SHELL || '/bin/bash';

    // Build args
    const shellArgs = process.platform === 'win32'
      ? ['/c', command, ...args]
      : ['-c', `${command} ${args.join(' ')}`];

    logger.debug(`[PTY] Spawning: ${command}`, { id, cols, rows });

    // Spawn PTY
    const ptyProcess = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: options.cwd ?? process.cwd(),
      env: {
        ...process.env,
        ...options.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    });

    const session: PTYSession = {
      id,
      pid: ptyProcess.pid,
      command,
      cols,
      rows,
      status: 'running',
      output: '',
      createdAt: new Date(),
    };

    const entry = {
      pty: ptyProcess,
      session,
      outputBuffer: '',
      listeners: new Set<(data: string) => void>(),
    };

    this.sessions.set(id, entry);

    // Handle data
    ptyProcess.onData((data: string) => {
      entry.outputBuffer += data;
      session.output = entry.outputBuffer;

      // Truncate if needed
      const maxChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT;
      if (entry.outputBuffer.length > maxChars) {
        entry.outputBuffer = `[...truncated...]\n${entry.outputBuffer.slice(-maxChars)}`;
        session.output = entry.outputBuffer;
      }

      // Notify listeners
      for (const listener of entry.listeners) {
        listener(data);
      }

      this.emit('data', id, data);
    });

    // Handle exit
    ptyProcess.onExit(({ exitCode }) => {
      session.status = 'exited';
      session.exitCode = exitCode;
      session.exitedAt = new Date();

      logger.debug(`[PTY] Exited: ${id}`, { exitCode });
      this.emit('exit', id, exitCode);
    });

    return session;
  }

  /**
   * Execute a command and wait for completion
   */
  async execute(
    command: string,
    args: string[] = [],
    options: PTYOptions = {}
  ): Promise<PTYResult> {
    const startTime = Date.now();
    const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    const maxOutput = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT;

    const session = this.spawn(command, args, options);
    const entry = this.sessions.get(session.id);
    if (!entry) {
      throw new Error('Failed to create PTY session');
    }

    return new Promise<PTYResult>((resolve) => {
      let timedOut = false;

      // Timeout handler
      const timeoutId = setTimeout(() => {
        timedOut = true;
        this.kill(session.id);
      }, timeout);

      // Wait for exit
      const exitHandler = (id: string, exitCode: number) => {
        if (id !== session.id) return;

        clearTimeout(timeoutId);
        this.off('exit', exitHandler);

        const durationMs = Date.now() - startTime;
        let output = entry.outputBuffer;
        let secretsRedacted = false;

        // Redact secrets if enabled
        if (isSecretsDetectionEnabled()) {
          output = redactSecrets(output);
          secretsRedacted = output !== entry.outputBuffer;
        }

        // Clean up session after a delay
        setTimeout(() => this.cleanup(session.id), 5000);

        resolve({
          success: !timedOut && exitCode === 0,
          exitCode: timedOut ? -1 : exitCode,
          output: output.trim() || '(no output)',
          durationMs,
          truncated: entry.outputBuffer.length >= maxOutput,
          secretsRedacted,
        });
      };

      this.on('exit', exitHandler);
    });
  }

  /**
   * Write input to PTY
   */
  write(sessionId: string, data: string): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry || entry.session.status !== 'running') {
      return false;
    }

    entry.pty.write(data);
    return true;
  }

  /**
   * Resize PTY dimensions
   */
  resize(sessionId: string, cols: number, rows: number): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry || entry.session.status !== 'running') {
      return false;
    }

    entry.pty.resize(cols, rows);
    entry.session.cols = cols;
    entry.session.rows = rows;
    return true;
  }

  /**
   * Kill a PTY session
   */
  kill(sessionId: string, signal: string = 'SIGTERM'): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry || entry.session.status !== 'running') {
      return false;
    }

    try {
      entry.pty.kill(signal);
      return true;
    } catch (error) {
      logger.warn(`[PTY] Failed to kill session ${sessionId}`, { error });
      return false;
    }
  }

  /**
   * Get session info
   */
  getSession(sessionId: string): PTYSession | null {
    return this.sessions.get(sessionId)?.session ?? null;
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): PTYSession[] {
    return Array.from(this.sessions.values())
      .filter((e) => e.session.status === 'running')
      .map((e) => e.session);
  }

  /**
   * Subscribe to session output
   */
  subscribe(sessionId: string, listener: (data: string) => void): () => void {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      return () => {};
    }

    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
  }

  /**
   * Clean up completed session
   */
  cleanup(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (entry) {
      if (entry.session.status === 'running') {
        this.kill(sessionId);
      }
      entry.listeners.clear();
      this.sessions.delete(sessionId);
      logger.debug(`[PTY] Cleaned up session: ${sessionId}`);
    }
  }

  /**
   * Clean up all sessions
   */
  cleanupAll(): void {
    for (const sessionId of this.sessions.keys()) {
      this.cleanup(sessionId);
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let _ptyManager: PTYManager | null = null;

export function getPTYManager(): PTYManager {
  if (!_ptyManager) {
    _ptyManager = new PTYManager();
  }
  return _ptyManager;
}

// =============================================================================
// Helper: Check if command needs PTY
// =============================================================================

const PTY_REQUIRED_COMMANDS = new Set([
  'vim', 'vi', 'nvim', 'nano', 'emacs',
  'less', 'more', 'man',
  'top', 'htop', 'btop',
  'ssh', 'telnet',
  'ftp', 'sftp',
  'mysql', 'psql', 'mongo', 'redis-cli',
  'python', 'python3', 'node', 'irb', 'rails',
  'bash', 'zsh', 'sh', 'fish',
]);

const PTY_HINT_PATTERNS = [
  /npm\s+init/i,
  /yarn\s+init/i,
  /npx\s+create-/i,
  /\bpassword\b/i,
  /\bsudo\b/,
  /--interactive/i,
  /-i\b/,
];

/**
 * Check if a command likely requires PTY
 */
export function commandNeedsPTY(command: string): boolean {
  // Extract base command
  const parts = command.trim().split(/\s+/);
  const baseCmd = parts[0]?.split('/').pop() ?? '';

  // Check known PTY-required commands
  if (PTY_REQUIRED_COMMANDS.has(baseCmd)) {
    return true;
  }

  // Check hint patterns
  return PTY_HINT_PATTERNS.some((p) => p.test(command));
}
