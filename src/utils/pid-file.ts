import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PROFCLAW_DIR = '.profclaw';
const PID_FILENAME = 'server.pid';

function getPidPath(): string {
  return join(process.cwd(), PROFCLAW_DIR, PID_FILENAME);
}

export interface PidData {
  pid: number;
  port: number;
  startedAt: number;
}

/**
 * Write PID file with process info.
 * Creates .profclaw/ directory if it doesn't exist.
 */
export function writePidFile(port: number): void {
  const dir = join(process.cwd(), PROFCLAW_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const data: PidData = {
    pid: process.pid,
    port,
    startedAt: Date.now(),
  };
  writeFileSync(getPidPath(), JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Read PID file.
 * Returns null if the file doesn't exist or contains malformed data.
 */
export function readPidFile(): PidData | null {
  const pidPath = getPidPath();
  if (!existsSync(pidPath)) {
    return null;
  }
  try {
    const raw = readFileSync(pidPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'pid' in parsed &&
      'port' in parsed &&
      'startedAt' in parsed &&
      typeof (parsed as Record<string, unknown>).pid === 'number' &&
      typeof (parsed as Record<string, unknown>).port === 'number' &&
      typeof (parsed as Record<string, unknown>).startedAt === 'number'
    ) {
      return parsed as PidData;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Remove PID file if it exists.
 */
export function removePidFile(): void {
  const pidPath = getPidPath();
  if (existsSync(pidPath)) {
    try {
      unlinkSync(pidPath);
    } catch {
      // Best effort — ignore failures (e.g. race condition on shutdown)
    }
  }
}

export interface ServerRunningResult {
  running: boolean;
  pid?: number;
  port?: number;
}

/**
 * Check if a server process described by the PID file is still alive.
 * If the process is dead but the PID file exists, the stale file is cleaned up.
 */
export function isServerRunning(): ServerRunningResult {
  const data = readPidFile();
  if (!data) {
    return { running: false };
  }

  try {
    // Signal 0 checks process existence without sending a real signal
    process.kill(data.pid, 0);
    return { running: true, pid: data.pid, port: data.port };
  } catch {
    // Process doesn't exist — stale PID file
    removePidFile();
    return { running: false };
  }
}

/**
 * Kill the server described by the PID file using SIGTERM.
 * Polls for up to 5 seconds waiting for the process to exit.
 * Returns true if the process was killed (or was already gone), false on timeout.
 */
export function killExistingServer(): boolean {
  const data = readPidFile();
  if (!data) {
    return false;
  }

  try {
    process.kill(data.pid, 'SIGTERM');
  } catch {
    // Process already gone
    removePidFile();
    return true;
  }

  // Poll up to 5 seconds (50 × 100 ms)
  const MAX_WAIT_MS = 5000;
  const POLL_INTERVAL_MS = 100;
  const start = Date.now();

  while (Date.now() - start < MAX_WAIT_MS) {
    try {
      process.kill(data.pid, 0);
      // Still alive — busy-wait (synchronous polling, acceptable for a CLI shutdown path)
      const pollUntil = Date.now() + POLL_INTERVAL_MS;
      while (Date.now() < pollUntil) {
        // spin wait
      }
    } catch {
      // Process gone
      removePidFile();
      return true;
    }
  }

  return false;
}
