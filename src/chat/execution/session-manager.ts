/**
 * Session Manager
 *
 * Tracks running tool execution sessions (processes).
 * Handles backgrounding, output collection, and cleanup.
 */

import type {
  SessionManager,
  ToolSession,
  SessionFilter,
} from "./types.js";
import { logger } from "../../utils/logger.js";
import {
  hasSecrets,
  isSecretsDetectionEnabled,
  redactSecrets,
} from "./secrets.js";
import { randomUUID } from "crypto";
import type { ChildProcess } from "child_process";

// Constants

const DEFAULT_MAX_OUTPUT_CHARS = 200_000;
const TAIL_CHARS = 10_000; // Keep last 10k chars for display
const SESSION_CLEANUP_INTERVAL_MS = 60_000;
const SESSION_MAX_AGE_MS = 3600_000; // 1 hour
const MAX_SESSIONS = 500;

const redactSessionOutput = (text: string): string => {
  if (!text) {
    return text;
  }
  if (!isSecretsDetectionEnabled()) {
    return text;
  }
  if (!hasSecrets(text)) {
    return text;
  }
  return redactSecrets(text);
};

// Session Manager Implementation

export class ToolSessionManager implements SessionManager {
  private sessions: Map<string, ManagedSession> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.cleanupTimer = setInterval(
      () => this.cleanup(),
      SESSION_CLEANUP_INTERVAL_MS,
    );
  }

  /**
   * Create a new session
   */
  create(data: Omit<ToolSession, "id" | "createdAt">): ToolSession {
    // Enforce max sessions
    if (this.sessions.size >= MAX_SESSIONS) {
      this.cleanupOldestSessions(50);
    }

    const id = this.generateSessionId();
    const session: ToolSession = {
      id,
      createdAt: Date.now(),
      ...data,
    };

    const managed: ManagedSession = {
      session,
      process: null,
      outputBuffer: [],
      listeners: new Set(),
    };

    this.sessions.set(id, managed);
    logger.debug(`[SessionManager] Created session: ${id}`, {
      component: "SessionManager",
    });

    return session;
  }

  /**
   * Get a session by ID
   */
  get(sessionId: string): ToolSession | undefined {
    return this.sessions.get(sessionId)?.session;
  }

  /**
   * Update a session
   */
  update(sessionId: string, update: Partial<ToolSession>): void {
    const managed = this.sessions.get(sessionId);
    if (managed) {
      Object.assign(managed.session, update);
    }
  }

  /**
   * List sessions with optional filtering
   */
  list(filter?: SessionFilter): ToolSession[] {
    let sessions = Array.from(this.sessions.values()).map((m) => m.session);

    if (filter?.conversationId) {
      sessions = sessions.filter(
        (s) => s.conversationId === filter.conversationId,
      );
    }
    if (filter?.toolName) {
      sessions = sessions.filter((s) => s.toolName === filter.toolName);
    }
    if (filter?.status?.length) {
      sessions = sessions.filter((s) => filter.status!.includes(s.status));
    }
    if (filter?.since) {
      sessions = sessions.filter((s) => s.createdAt >= filter.since!);
    }

    return sessions;
  }

  /**
   * Kill a running session
   */
  async kill(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;

    const { session, process } = managed;

    if (process && session.status === "running") {
      try {
        // Try SIGTERM first
        process.kill("SIGTERM");

        // Force kill after 5 seconds
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            if (!process.killed) {
              process.kill("SIGKILL");
            }
            resolve();
          }, 5000);

          process.once("exit", () => {
            clearTimeout(timeout);
            resolve();
          });
        });

        session.status = "killed";
        session.completedAt = Date.now();
        logger.info(`[SessionManager] Killed session: ${sessionId}`, {
          component: "SessionManager",
        });
      } catch (error) {
        logger.error(
          `[SessionManager] Failed to kill session: ${sessionId}`,
          error instanceof Error ? error : undefined,
        );
      }
    }
  }

  /**
   * Cleanup old/completed sessions
   */
  cleanup(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [id, managed] of this.sessions) {
      const { session } = managed;

      // Remove completed sessions older than max age
      if (
        ["completed", "failed", "killed", "timeout"].includes(session.status) &&
        now - session.createdAt > SESSION_MAX_AGE_MS
      ) {
        toDelete.push(id);
      }

      // Remove very old pending sessions
      if (
        session.status === "pending" &&
        now - session.createdAt > SESSION_MAX_AGE_MS * 2
      ) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.sessions.delete(id);
    }

    if (toDelete.length > 0) {
      logger.debug(`[SessionManager] Cleaned up ${toDelete.length} sessions`, {
        component: "SessionManager",
      });
    }
  }

  // Extended Methods

  /**
   * Attach a process to a session
   */
  attachProcess(sessionId: string, process: ChildProcess): void {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;

    managed.process = process;
    managed.session.pid = process.pid;
    managed.session.status = "running";
    managed.session.startedAt = Date.now();

    // Set up output collection
    process.stdout?.on("data", (data: Buffer) => {
      this.appendOutput(sessionId, "stdout", data.toString());
    });

    process.stderr?.on("data", (data: Buffer) => {
      this.appendOutput(sessionId, "stderr", data.toString());
    });

    process.on("exit", (code, signal) => {
      this.handleProcessExit(sessionId, code, signal);
    });

    process.on("error", (error) => {
      logger.error(`[SessionManager] Process error: ${sessionId}`, error);
      managed.session.status = "failed";
      managed.session.stderr += `\nProcess error: ${error.message}`;
    });
  }

  /**
   * Append output to a session
   */
  appendOutput(
    sessionId: string,
    stream: "stdout" | "stderr",
    data: string,
  ): void {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;

    const { session, listeners } = managed;
    const maxChars = session.maxOutputChars || DEFAULT_MAX_OUTPUT_CHARS;
    const sanitizedData = redactSessionOutput(data);

    // Append to appropriate stream
    if (stream === "stdout") {
      session.stdout += sanitizedData;
    } else {
      session.stderr += sanitizedData;
    }

    // Check for truncation
    const totalChars = session.stdout.length + session.stderr.length;
    if (totalChars > maxChars && !session.truncated) {
      session.truncated = true;

      // Keep only the tail
      if (session.stdout.length > TAIL_CHARS) {
        session.stdout = `[...truncated...]\n${session.stdout.slice(-TAIL_CHARS)}`;
      }
      if (session.stderr.length > TAIL_CHARS) {
        session.stderr = `[...truncated...]\n${session.stderr.slice(-TAIL_CHARS)}`;
      }
    }

    // Notify listeners
    for (const listener of listeners) {
      try {
        listener({ stream, data: sanitizedData, sessionId });
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Subscribe to session output
   */
  subscribe(sessionId: string, listener: SessionOutputListener): () => void {
    const managed = this.sessions.get(sessionId);
    if (!managed) {
      return () => {};
    }

    managed.listeners.add(listener);
    return () => managed.listeners.delete(listener);
  }

  /**
   * Get session output (combined stdout + stderr)
   */
  getOutput(sessionId: string): string {
    const session = this.get(sessionId);
    if (!session) return "";

    // Interleave stdout and stderr for display
    let output = session.stdout;
    if (session.stderr) {
      output += session.stderr
        .split("\n")
        .map((line) => `stderr: ${line}`)
        .join("\n");
    }
    return output;
  }

  /**
   * Get tail of session output
   */
  getTail(sessionId: string, chars: number = TAIL_CHARS): string {
    const output = this.getOutput(sessionId);
    if (output.length <= chars) return output;
    return `[...]\n${output.slice(-chars)}`;
  }

  /**
   * Mark session as backgrounded
   */
  background(sessionId: string): void {
    const managed = this.sessions.get(sessionId);
    if (managed) {
      managed.session.backgrounded = true;
      logger.debug(`[SessionManager] Backgrounded session: ${sessionId}`, {
        component: "SessionManager",
      });
    }
  }

  /**
   * Write to session stdin
   */
  write(sessionId: string, data: string): boolean {
    const managed = this.sessions.get(sessionId);
    if (!managed?.process?.stdin) return false;

    try {
      managed.process.stdin.write(data);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Destroy the session manager
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Kill all running processes
    for (const managed of this.sessions.values()) {
      if (managed.process && managed.session.status === "running") {
        try {
          managed.process.kill("SIGKILL");
        } catch {
          // Ignore
        }
      }
    }

    this.sessions.clear();
  }

  // Private Methods

  private generateSessionId(): string {
    // Short 8-char ID for display
    return randomUUID().slice(0, 8);
  }

  private handleProcessExit(
    sessionId: string,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;

    const { session } = managed;
    session.exitCode = code;
    session.exitSignal = signal?.toString() ?? null;
    session.completedAt = Date.now();

    if (code === 0 && !signal) {
      session.status = "completed";
    } else if (signal === "SIGTERM" || signal === "SIGKILL") {
      session.status = "killed";
    } else {
      session.status = "failed";
    }

    logger.debug(
      `[SessionManager] Session ${sessionId} exited: code=${code}, signal=${signal}`,
      { component: "SessionManager" },
    );

    // Notify if backgrounded
    if (session.backgrounded && session.notifyOnExit) {
      // TODO: Send notification to chat
    }
  }

  private cleanupOldestSessions(count: number): void {
    const sorted = Array.from(this.sessions.entries())
      .filter(([_, m]) => m.session.status !== "running")
      .sort((a, b) => a[1].session.createdAt - b[1].session.createdAt);

    for (let i = 0; i < count && i < sorted.length; i++) {
      this.sessions.delete(sorted[i][0]);
    }
  }
}

// Types

interface ManagedSession {
  session: ToolSession;
  process: ChildProcess | null;
  outputBuffer: string[];
  listeners: Set<SessionOutputListener>;
}

export type SessionOutputListener = (event: {
  sessionId: string;
  stream: "stdout" | "stderr";
  data: string;
}) => void;

// Singleton

let sessionManager: ToolSessionManager | null = null;

export function getSessionManager(): ToolSessionManager {
  if (!sessionManager) {
    sessionManager = new ToolSessionManager();
  }
  return sessionManager;
}
