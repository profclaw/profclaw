import chalk from 'chalk';
import Table from 'cli-table3';
import ora, { Ora } from 'ora';

// Status colors
export const statusColors: Record<string, (s: string) => string> = {
  pending: chalk.yellow,
  queued: chalk.blue,
  running: chalk.cyan,
  completed: chalk.green,
  failed: chalk.red,
  cancelled: chalk.gray,
};

/**
 * Format a status with color
 */
export function formatStatus(status: string): string {
  const colorFn = statusColors[status] || chalk.white;
  return colorFn(status.toUpperCase());
}

/**
 * Format a date for display
 */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return chalk.dim('-');
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString();
}

/**
 * Format a relative time (e.g., "2m ago")
 */
export function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) return chalk.dim('-');
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = Date.now();
  const diff = now - d.getTime();

  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

/**
 * Create a styled table
 */
export function createTable(headers: string[]): InstanceType<typeof Table> {
  return new Table({
    head: headers.map((h) => chalk.bold.white(h)),
    style: {
      head: [],
      border: ['dim'],
    },
    chars: {
      'top': '─',
      'top-mid': '┬',
      'top-left': '┌',
      'top-right': '┐',
      'bottom': '─',
      'bottom-mid': '┴',
      'bottom-left': '└',
      'bottom-right': '┘',
      'left': '│',
      'left-mid': '├',
      'mid': '─',
      'mid-mid': '┼',
      'right': '│',
      'right-mid': '┤',
      'middle': '│',
    },
  });
}

/**
 * Print success message
 */
export function success(message: string): void {
  console.log(chalk.green('✓') + ' ' + message);
}

/**
 * Print error message
 */
export function error(message: string): void {
  console.error(chalk.red('✗') + ' ' + message);
}

/**
 * Print warning message
 */
export function warn(message: string): void {
  console.log(chalk.yellow('⚠') + ' ' + message);
}

/**
 * Print info message
 */
export function info(message: string): void {
  console.log(chalk.blue('ℹ') + ' ' + message);
}

/**
 * Create a spinner
 */
export function spinner(text: string): Ora {
  return ora({
    text,
    spinner: 'dots',
  });
}

/**
 * Output data in JSON or table format
 */
export function output(data: unknown, options: { json?: boolean }): void {
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
  } else if (Array.isArray(data)) {
    console.log(data);
  } else {
    console.log(data);
  }
}

/**
 * Truncate a string with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Format a cost value
 */
export function formatCost(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

/**
 * Format a token count
 */
export function formatTokens(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}
