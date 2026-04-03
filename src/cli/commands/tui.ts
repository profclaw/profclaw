import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import { spinner, error, createTable, formatRelativeTime, truncate } from '../utils/output.js';

async function launchInkDashboard(): Promise<void> {
  // Check if we have a real TTY (Ink needs raw mode)
  if (!process.stdin.isTTY) {
    console.error(chalk.red('Error: Ink TUI requires an interactive terminal (TTY).'));
    console.error(chalk.dim('Run this command directly in your terminal, not piped.'));
    process.exit(1);
  }

  // Dynamic import so ink is only loaded when --ink flag is used
  const { render } = await import('ink');
  const React = await import('react');
  const { DashboardApp } = await import('../ink/DashboardApp.js');
  const { waitUntilExit } = render(React.createElement(DashboardApp));
  await waitUntilExit();
}

interface SystemStatus {
  version: string;
  uptime: number;
  mode: string;
  healthy: boolean;
}

interface ActiveSession {
  id: string;
  title: string;
  updatedAt: string;
  model?: string;
}

interface RecentTask {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
}

interface ProviderHealth {
  type: string;
  healthy: boolean;
  latencyMs?: number;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

function taskStatusColor(status: string): string {
  const colors: Record<string, (s: string) => string> = {
    completed: chalk.green,
    in_progress: chalk.cyan,
    pending: chalk.yellow,
    failed: chalk.red,
    cancelled: chalk.gray,
  };
  return (colors[status] ?? chalk.white)(status);
}

async function renderDashboard(): Promise<void> {
  const spin = spinner('Loading dashboard...').start();

  const [systemResult, sessionsResult, tasksResult, providersResult] = await Promise.allSettled([
    api.get<SystemStatus>('/api/health'),
    api.get<{ conversations: ActiveSession[] }>('/api/chat/conversations?limit=5'),
    api.get<{ tasks: RecentTask[] }>('/api/tasks?limit=5&sort=updatedAt'),
    api.get<{ providers: ProviderHealth[] }>('/api/chat/providers'),
  ]);

  spin.stop();

  // System status header
  console.clear();
  console.log(chalk.cyan.bold('  profClaw Dashboard'));
  console.log(chalk.dim('  ' + '─'.repeat(50)));
  console.log();

  // System info
  if (systemResult.status === 'fulfilled' && systemResult.value.ok) {
    const sys = systemResult.value.data!;
    console.log(chalk.bold('  System'));
    console.log(`    Version:  ${sys.version || chalk.dim('-')}`);
    console.log(`    Mode:     ${chalk.cyan(sys.mode || 'mini')}`);
    console.log(`    Uptime:   ${sys.uptime ? formatUptime(sys.uptime) : chalk.dim('-')}`);
    console.log(`    Status:   ${sys.healthy ? chalk.green('● healthy') : chalk.red('● unhealthy')}`);
  } else {
    console.log(chalk.bold('  System'));
    console.log(`    ${chalk.red('Unable to connect to profClaw server.')}`);
    console.log(`    ${chalk.dim('Is it running? Try: profclaw serve')}`);
  }
  console.log();

  // Provider health
  console.log(chalk.bold('  AI Providers'));
  if (providersResult.status === 'fulfilled' && providersResult.value.ok) {
    const { providers } = providersResult.value.data!;
    if (providers.length === 0) {
      console.log(`    ${chalk.dim('No providers configured')}`);
    } else {
      const table = createTable(['Provider', 'Status', 'Latency']);
      for (const p of providers) {
        table.push([
          p.type,
          p.healthy ? chalk.green('● ok') : chalk.red('● down'),
          p.latencyMs != null ? `${p.latencyMs}ms` : chalk.dim('-'),
        ]);
      }
      console.log(table.toString().split('\n').map((l) => '    ' + l).join('\n'));
    }
  } else {
    console.log(`    ${chalk.dim('Failed to load providers')}`);
  }
  console.log();

  // Recent sessions
  console.log(chalk.bold('  Recent Sessions'));
  if (sessionsResult.status === 'fulfilled' && sessionsResult.value.ok) {
    const { conversations } = sessionsResult.value.data!;
    if (conversations.length === 0) {
      console.log(`    ${chalk.dim('No sessions yet')}`);
    } else {
      const table = createTable(['ID', 'Title', 'Updated']);
      for (const s of conversations) {
        table.push([
          chalk.dim(truncate(s.id, 8)),
          truncate(s.title || 'Untitled', 35),
          formatRelativeTime(s.updatedAt),
        ]);
      }
      console.log(table.toString().split('\n').map((l) => '    ' + l).join('\n'));
    }
  } else {
    console.log(`    ${chalk.dim('Failed to load sessions')}`);
  }
  console.log();

  // Recent tasks
  console.log(chalk.bold('  Recent Tasks'));
  if (tasksResult.status === 'fulfilled' && tasksResult.value.ok) {
    const { tasks } = tasksResult.value.data!;
    if (tasks.length === 0) {
      console.log(`    ${chalk.dim('No tasks yet')}`);
    } else {
      const table = createTable(['ID', 'Title', 'Status', 'Updated']);
      for (const t of tasks) {
        table.push([
          chalk.dim(truncate(t.id, 8)),
          truncate(t.title, 30),
          taskStatusColor(t.status),
          formatRelativeTime(t.updatedAt),
        ]);
      }
      console.log(table.toString().split('\n').map((l) => '    ' + l).join('\n'));
    }
  } else {
    console.log(`    ${chalk.dim('Failed to load tasks')}`);
  }

  console.log();
  console.log(chalk.dim('  Run `profclaw --help` for all commands'));
  console.log();
}

export function tuiCommand(): Command {
  const cmd = new Command('tui')
    .description('Show terminal dashboard')
    .option('--watch', 'Refresh dashboard every 5 seconds')
    .option('--interval <seconds>', 'Refresh interval in seconds', '5')
    .option('--ink', 'Launch rich interactive Ink dashboard (tabs, auto-refresh, keyboard nav)');

  cmd.action(async (options: { watch?: boolean; interval: string; ink?: boolean }) => {
    if (options.ink) {
      try {
        await launchInkDashboard();
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to launch Ink dashboard');
        process.exit(1);
      }
      return;
    }

    try {
      await renderDashboard();

      if (options.watch) {
        const interval = parseInt(options.interval, 10) * 1000;
        console.log(chalk.dim(`  Refreshing every ${options.interval}s... (Ctrl+C to stop)`));
        const timer = setInterval(async () => {
          await renderDashboard();
        }, interval);

        process.on('SIGINT', () => {
          clearInterval(timer);
          process.exit(0);
        });
        // Keep process alive
        await new Promise<void>(() => { /* resolved by SIGINT */ });
      }
    } catch (err) {
      error(err instanceof Error ? err.message : 'Unknown error');
      process.exit(1);
    }
  });

  return cmd;
}
