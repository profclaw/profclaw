/**
 * Auto-Serve
 *
 * Automatically starts the profClaw server if it's not running.
 * Inspired by OpenClaw's pattern where the CLI "just works" -
 * you type `openclaw` and it handles server lifecycle.
 *
 * @package profclaw-interactive (future standalone)
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import chalk from 'chalk';

/**
 * Simple .env file parser (no external dependency).
 * Handles KEY=VALUE, KEY="VALUE", comments (#), and empty lines.
 */
function loadDotEnv(filePath: string): Record<string, string> {
  const vars: Record<string, string> = {};
  try {
    if (!existsSync(filePath)) return vars;
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key) vars[key] = value;
    }
  } catch { /* ignore */ }
  return vars;
}

interface ServerStatus {
  running: boolean;
  pid?: number;
  port: number;
  url: string;
}

/**
 * Check if the profClaw server is reachable.
 */
export async function checkServer(baseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${baseUrl}/health`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    clearTimeout(timeout);

    // Verify it's actually profClaw (not some other service on the same port)
    const text = await response.text();
    if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
      // Got HTML - some other service is on this port
      return false;
    }

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Find the server entry point.
 */
function findServerEntry(): string | null {
  // Try common locations relative to the package root
  const candidates = [
    resolve(process.cwd(), 'dist/server.js'),
    resolve(process.cwd(), 'src/server.ts'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Start the profClaw server as a background child process.
 * Returns when the server is healthy or times out.
 */
export async function autoStartServer(options: {
  port?: number;
  baseUrl: string;
  silent?: boolean;
}): Promise<{ success: boolean; pid?: number; error?: string }> {
  const port = options.port || 3000;

  // First check if server is already running
  const alreadyRunning = await checkServer(options.baseUrl);
  if (alreadyRunning) {
    return { success: true };
  }

  if (!options.silent) {
    process.stdout.write(chalk.dim('  Starting server...'));
  }

  const serverEntry = findServerEntry();
  if (!serverEntry) {
    return {
      success: false,
      error: 'Cannot find server entry point. Run `pnpm build` first, or start the server manually with `pnpm dev`.',
    };
  }

  // Determine runner based on file extension
  const isTsFile = serverEntry.endsWith('.ts');
  const runner = isTsFile ? 'tsx' : 'node';

  // Load .env file (no dotenv dependency - simple parser)
  const dotenvVars = loadDotEnv(resolve(process.cwd(), '.env'));

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...dotenvVars,
    PORT: String(port),
    NODE_ENV: process.env.NODE_ENV || 'development',
  };

  // Spawn server as fully detached child (cwd = project root for data/ access)
  // Use 'ignore' for all stdio so the child is truly independent
  // We'll detect readiness via HTTP health checks instead of stdout parsing
  let serverProcess: ChildProcess;
  try {
    serverProcess = spawn(runner, [serverEntry], {
      env,
      cwd: process.cwd(),
      stdio: 'ignore',
      detached: true,
    });
  } catch (error) {
    return {
      success: false,
      error: `Failed to start server: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // Track if process exits early
  let startupError = '';

  serverProcess.on('error', (err) => {
    startupError = err.message;
  });

  serverProcess.on('exit', (code) => {
    if (code !== null && code !== 0) {
      startupError = `Server exited with code ${code}`;
    }
  });

  // Fully detach - CLI can exit and server keeps running
  serverProcess.unref();

  // Wait for server to become healthy
  const maxWaitMs = 15000;
  const pollIntervalMs = 500;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    // Check for early crash
    if (startupError) {
      if (startupError.includes('EADDRINUSE')) {
        return {
          success: false,
          error: `Port ${port} is already in use. Kill the process or use: PORT=${port + 1} profclaw chat`,
        };
      }
      if (startupError.includes('exited with code')) {
        return { success: false, error: `Server crashed: ${startupError.slice(0, 300)}` };
      }
      // Non-fatal stderr (e.g. warnings) - continue waiting
    }

    const healthy = await checkServer(options.baseUrl);
    if (healthy) {
      if (!options.silent) {
        console.log(chalk.green(' ready'));
      }
      return { success: true, pid: serverProcess.pid };
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  return {
    success: false,
    error: startupError
      ? `Server failed: ${startupError.slice(0, 300)}`
      : `Server did not respond within ${maxWaitMs / 1000}s. Try starting manually: pnpm dev`,
  };
}

/**
 * Ensure the server is running. Auto-starts if needed.
 * This is the main entry point for the "just works" pattern.
 */
export async function ensureServer(baseUrl: string, options?: {
  autoStart?: boolean;
  silent?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const isRunning = await checkServer(baseUrl);
  if (isRunning) {
    return { ok: true };
  }

  if (options?.autoStart === false) {
    return {
      ok: false,
      error: `profClaw server is not running at ${baseUrl}. Start it with: pnpm dev`,
    };
  }

  // Extract port from URL
  const portMatch = baseUrl.match(/:(\d+)/);
  const port = portMatch ? parseInt(portMatch[1]) : 3000;

  const result = await autoStartServer({
    port,
    baseUrl,
    silent: options?.silent,
  });

  if (!result.success) {
    return { ok: false, error: result.error };
  }

  return { ok: true };
}
