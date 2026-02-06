import { Command } from 'commander';
import chalk from 'chalk';
import figlet from 'figlet';
import { spawn, type ChildProcess } from 'child_process';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { createServer } from 'net';
import { success, error, info, warn } from '../utils/output.js';

const MAX_RESTART_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const CRASH_WINDOW_MS = 10000;
const HEALTH_CHECK_DELAY_MS = 3000;
const HEALTH_CHECK_TIMEOUT_MS = 5000;

interface RestartState {
  attempts: number;
  lastCrashTime: number;
  shuttingDown: boolean;
}

function checkPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(true);
      }
    });
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
  });
}

async function healthCheck(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function getBackoffMs(attempt: number): number {
  const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt);
  return Math.min(backoff, MAX_BACKOFF_MS);
}

export function serveCommand() {
  const serve = new Command('serve')
    .description('Start the profClaw API server')
    .option('-p, --port <port>', 'Port to listen on', '3000')
    .option('--no-cron', 'Disable cron jobs')
    .option('--dev', 'Run in development mode with watch')
    .option('--no-restart', 'Disable auto-restart on crash')
    .action(async (options) => {
      // Show banner
      const banner = figlet.textSync('profClaw', { font: 'Standard' });
      console.log(chalk.cyan(banner));
      console.log(chalk.dim('  AI Agent Task Orchestrator\n'));

      const port = parseInt(options.port, 10);

      // Pre-flight: check port availability
      const portAvailable = await checkPortAvailable(port);
      if (!portAvailable) {
        error(`Port ${port} is already in use.`);
        info('Options:');
        console.log(`  1. Stop the existing process: ${chalk.cyan(`lsof -ti:${port} | xargs kill`)}`);
        console.log(`  2. Use a different port: ${chalk.cyan(`profclaw serve -p ${port + 1}`)}`);
        process.exit(1);
      }

      // Set environment variables
      const env = {
        ...process.env,
        PORT: options.port,
        ENABLE_CRON: options.cron === false ? 'false' : 'true',
      };

      // Determine the project root
      const projectRoot = process.cwd();
      let command: string;
      let args: string[];

      if (options.dev) {
        console.log(chalk.blue('Starting in development mode with watch...\n'));
        command = 'npx';
        args = ['tsx', 'watch', 'src/server.ts'];
      } else {
        const hasDistServer = existsSync(resolve(projectRoot, 'dist/server.js'));
        if (hasDistServer) {
          command = 'node';
          args = [resolve(projectRoot, 'dist/server.js')];
        } else {
          command = 'npx';
          args = ['tsx', 'src/server.ts'];
        }
        console.log(chalk.blue(`Starting server on port ${options.port}...\n`));
      }

      const autoRestart = options.restart !== false && !options.dev;
      const state: RestartState = {
        attempts: 0,
        lastCrashTime: 0,
        shuttingDown: false,
      };

      function spawnServer(): ChildProcess {
        const child = spawn(command, args, {
          cwd: projectRoot,
          env,
          stdio: 'inherit',
        });

        child.on('exit', (code, signal) => {
          if (state.shuttingDown) {
            process.exit(code || 0);
            return;
          }

          // Signal-based exit (user Ctrl+C forwarded) - clean exit
          if (signal === 'SIGINT' || signal === 'SIGTERM') {
            process.exit(0);
            return;
          }

          // Clean exit
          if (code === 0) {
            process.exit(0);
            return;
          }

          // Crash detected
          const now = Date.now();

          // Reset attempt counter if the server ran for a while before crashing
          if (now - state.lastCrashTime > CRASH_WINDOW_MS * MAX_RESTART_ATTEMPTS) {
            state.attempts = 0;
          }

          state.lastCrashTime = now;
          state.attempts++;

          if (!autoRestart) {
            error(`Server exited with code ${code}. Auto-restart is disabled.`);
            process.exit(code || 1);
            return;
          }

          if (state.attempts > MAX_RESTART_ATTEMPTS) {
            error(`Server crashed ${state.attempts} times in quick succession. Giving up.`);
            info('Check logs and fix the issue, then run: profclaw serve');
            process.exit(1);
            return;
          }

          const backoff = getBackoffMs(state.attempts - 1);
          warn(`Server crashed (exit code ${code}). Restart attempt ${state.attempts}/${MAX_RESTART_ATTEMPTS} in ${Math.round(backoff / 1000)}s...`);

          setTimeout(() => {
            if (state.shuttingDown) return;
            info('Restarting server...');
            spawnServer();
          }, backoff);
        });

        // Run health check after startup delay (not in dev mode)
        if (!options.dev) {
          setTimeout(async () => {
            if (state.shuttingDown) return;
            const healthy = await healthCheck(port);
            if (healthy) {
              success(`Server healthy on port ${port}`);
            } else {
              warn('Server may not be fully ready yet. Check logs above.');
            }
          }, HEALTH_CHECK_DELAY_MS);
        }

        return child;
      }

      const currentChild = spawnServer();

      // Handle signals - forward to child, prevent restart
      const shutdown = (sig: NodeJS.Signals) => {
        state.shuttingDown = true;
        currentChild.kill(sig);
      };

      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
    });

  return serve;
}
