import { Command } from 'commander';
import chalk from 'chalk';
import { getConfig } from '../utils/config.js';
import { api } from '../utils/api.js';
import { spinner, error, createTable, formatRelativeTime } from '../utils/output.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  id?: string;
  level: LogLevel;
  component?: string;
  message: string;
  timestamp: string;
  meta?: Record<string, unknown>;
}

interface LogsResponse {
  logs: LogEntry[];
  total: number;
}

function levelColor(level: LogLevel): string {
  switch (level) {
    case 'debug': return chalk.dim(level.toUpperCase());
    case 'info':  return chalk.blue(level.toUpperCase());
    case 'warn':  return chalk.yellow(level.toUpperCase());
    case 'error': return chalk.red(level.toUpperCase());
    default:      return String(level).toUpperCase();
  }
}

function parseSince(since: string): number {
  const match = /^(\d+)([smhd])$/.exec(since);
  if (!match) return Date.now() - 60 * 60 * 1000; // default 1h
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return Date.now() - value * (multipliers[unit] ?? 3600000);
}

export function logsCommand(): Command {
  const cmd = new Command('logs')
    .description('View and filter server logs')
    .option('--level <level>', 'Filter by log level (debug|info|warn|error)')
    .option('--component <name>', 'Filter by component name')
    .option('--since <duration>', 'Show logs since duration (e.g. 1h, 30m, 2d)', '1h')
    .option('-l, --limit <n>', 'Max log entries to show', '50')
    .option('-f, --follow', 'Follow log stream (SSE)')
    .option('--json', 'Output as JSON');

  cmd.action(async (options: {
    level?: string;
    component?: string;
    since: string;
    limit: string;
    follow?: boolean;
    json?: boolean;
  }) => {
    if (options.follow) {
      await followLogs(options);
      return;
    }

    const spin = spinner('Fetching logs...').start();
    try {
      const params = new URLSearchParams({ limit: options.limit });
      if (options.level) params.set('level', options.level);
      if (options.component) params.set('component', options.component);
      if (options.since) params.set('since', String(parseSince(options.since)));

      const result = await api.get<LogsResponse>(`/api/logs?${params}`);
      spin.stop();
      if (!result.ok) { error(result.error || 'Failed to fetch logs'); process.exit(1); }

      const { logs } = result.data!;

      if (options.json) { console.log(JSON.stringify(logs, null, 2)); return; }

      if (logs.length === 0) {
        console.log(chalk.dim('No logs found for the given filters.'));
        return;
      }

      const table = createTable(['Time', 'Level', 'Component', 'Message']);
      for (const entry of logs) {
        table.push([
          formatRelativeTime(entry.timestamp),
          levelColor(entry.level),
          chalk.dim(entry.component || '-'),
          entry.message,
        ]);
      }
      console.log(table.toString());
      console.log(chalk.dim(`\nShowing ${logs.length} log entries`));
    } catch (err) {
      spin.stop();
      error(err instanceof Error ? err.message : 'Unknown error');
      process.exit(1);
    }
  });

  return cmd;
}

async function followLogs(options: {
  level?: string;
  component?: string;
  since: string;
  json?: boolean;
}): Promise<void> {
  const config = getConfig();
  const baseUrl = config.apiUrl || 'http://localhost:3000';
  const params = new URLSearchParams({ stream: '1' });
  if (options.level) params.set('level', options.level);
  if (options.component) params.set('component', options.component);

  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  if (config.apiToken) headers['Authorization'] = `Bearer ${config.apiToken}`;

  console.log(chalk.dim(`Following logs... (Ctrl+C to stop)\n`));

  try {
    const response = await fetch(`${baseUrl}/api/logs?${params}`, { headers });
    if (!response.ok || !response.body) {
      error(`Failed to connect to log stream: HTTP ${response.status}`);
      process.exit(1);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const raw = line.slice(6).trim();
          if (!raw || raw === '[DONE]') continue;
          try {
            const entry = JSON.parse(raw) as LogEntry;
            if (options.json) {
              console.log(JSON.stringify(entry));
            } else {
              const time = new Date(entry.timestamp).toISOString().slice(11, 23);
              const level = levelColor(entry.level);
              const component = entry.component ? chalk.dim(`[${entry.component}] `) : '';
              console.log(`${chalk.dim(time)} ${level} ${component}${entry.message}`);
            }
          } catch {
            // ignore parse errors on stream
          }
        }
      }
    }
  } catch (err) {
    error(err instanceof Error ? err.message : 'Stream error');
    process.exit(1);
  }
}
