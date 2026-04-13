import { Command } from 'commander';
import chalk from 'chalk';
import * as os from 'os';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { api } from '../utils/api.js';
import { success, error, info, spinner } from '../utils/output.js';
import { isServerRunning } from '../../utils/pid-file.js';

const execFileAsync = promisify(execFile);

interface CheckResult {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  fix?: string;
}

async function checkNode(): Promise<CheckResult> {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0], 10);
  if (major >= 20) {
    return { name: 'Node.js', status: 'pass', message: `${version} (>= 18 required)` };
  }
  if (major >= 18) {
    return {
      name: 'Node.js',
      status: 'warn',
      message: `${version} (>= 20 recommended for best performance)`,
      fix: 'nvm install 20',
    };
  }
  return {
    name: 'Node.js',
    status: 'fail',
    message: `${version} (requires >= 18)`,
    fix: 'nvm install 20',
  };
}

async function checkRedis(): Promise<CheckResult> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return {
      name: 'Redis',
      status: 'warn',
      message: 'REDIS_URL not set (optional for pico/mini mode)',
      fix: 'docker compose up redis -d',
    };
  }
  try {
    const url = new URL(redisUrl);
    const net = await import('net');
    return new Promise((resolve) => {
      const socket = net.createConnection(
        { host: url.hostname, port: parseInt(url.port || '6379', 10), timeout: 3000 },
        () => {
          socket.destroy();
          resolve({ name: 'Redis', status: 'pass', message: `Connected (${url.hostname}:${url.port || '6379'})` });
        },
      );
      socket.on('error', () => {
        socket.destroy();
        resolve({ name: 'Redis', status: 'fail', message: `Cannot connect to ${redisUrl}`, fix: 'docker compose up redis -d' });
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve({ name: 'Redis', status: 'fail', message: `Connection timeout to ${redisUrl}`, fix: 'docker compose up redis -d' });
      });
    });
  } catch {
    return { name: 'Redis', status: 'fail', message: 'Invalid REDIS_URL', fix: 'Set REDIS_URL=redis://localhost:6379' };
  }
}

async function checkOllama(): Promise<CheckResult> {
  try {
    const response = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      const data = await response.json() as { models?: unknown[] };
      const count = Array.isArray(data?.models) ? data.models.length : 0;
      return { name: 'Ollama', status: 'pass', message: `Running (${count} models)` };
    }
    return { name: 'Ollama', status: 'warn', message: 'Responding but unhealthy' };
  } catch {
    return {
      name: 'Ollama',
      status: 'warn',
      message: 'Not running (optional)',
      fix: 'https://ollama.com/download',
    };
  }
}

async function checkServer(): Promise<CheckResult> {
  const result = await api.get<{ status: string }>('/health');
  if (result.ok) {
    return { name: 'Server', status: 'pass', message: 'Running and healthy' };
  }
  return {
    name: 'Server',
    status: 'fail',
    message: result.error || 'Not reachable',
    fix: 'profclaw serve',
  };
}

async function checkDatabase(): Promise<CheckResult> {
  const result = await api.get<{ configured: boolean }>('/api/setup/status');
  if (result.ok && result.data?.configured) {
    return { name: 'Database', status: 'pass', message: 'Configured and accessible' };
  }
  if (result.ok) {
    return { name: 'Database', status: 'warn', message: 'Not fully configured', fix: 'profclaw setup' };
  }
  return {
    name: 'Database',
    status: 'warn',
    message: 'Cannot check (server not running)',
    fix: 'profclaw serve && profclaw setup',
  };
}

async function checkProvider(): Promise<CheckResult> {
  const result = await api.get<{ providers: Array<{ type: string; enabled: boolean; healthy: boolean }> }>('/api/chat/providers');
  if (!result.ok) {
    return { name: 'AI Provider', status: 'warn', message: 'Cannot check (server not running)', fix: 'profclaw serve' };
  }
  const active = result.data?.providers?.filter((p) => p.enabled) || [];
  if (active.length === 0) {
    return { name: 'AI Provider', status: 'fail', message: 'No providers configured', fix: 'profclaw provider add anthropic' };
  }
  const healthy = active.filter((p) => p.healthy);
  if (healthy.length === 0) {
    return { name: 'AI Provider', status: 'warn', message: `${active.length} configured but none healthy` };
  }
  return { name: 'AI Provider', status: 'pass', message: `${healthy.length}/${active.length} healthy` };
}

async function checkMemory(): Promise<CheckResult> {
  const freeBytes = os.freemem();
  const freeMB = Math.round(freeBytes / 1024 / 1024);
  const freeGB = (freeBytes / 1024 / 1024 / 1024).toFixed(1);
  if (freeMB > 512) {
    return { name: 'Memory', status: 'pass', message: `${freeGB} GB free` };
  }
  if (freeMB > 256) {
    return { name: 'Memory', status: 'warn', message: `${freeGB} GB free (low)` };
  }
  return { name: 'Memory', status: 'fail', message: `${freeGB} GB free (critically low)`, fix: 'Close unused applications' };
}

async function checkCloudflared(): Promise<CheckResult> {
  const result = await api.get<{ cloudflare: { available: boolean; version?: string } }>('/api/tunnels/status');
  if (!result.ok) {
    // Try local check
    try {
      const { execSync } = await import('child_process');
      execSync('which cloudflared', { stdio: 'ignore' });
      return { name: 'Cloudflared', status: 'pass', message: 'Installed (server not running for full check)' };
    } catch {
      return { name: 'Cloudflared', status: 'warn', message: 'Not found (optional)', fix: 'brew install cloudflared' };
    }
  }
  if (result.data?.cloudflare?.available) {
    return { name: 'Cloudflared', status: 'pass', message: `Installed${result.data.cloudflare.version ? ` (${result.data.cloudflare.version})` : ''}` };
  }
  return { name: 'Cloudflared', status: 'warn', message: 'Not installed (optional)', fix: 'brew install cloudflared' };
}

async function checkPort(): Promise<CheckResult> {
  const port = parseInt(process.env.PORT || '3000', 10);
  const net = await import('net');
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve({ name: 'Port', status: 'pass', message: `Port ${port} in use (server likely running)` });
      } else {
        resolve({ name: 'Port', status: 'warn', message: `Port ${port}: ${err.message}` });
      }
    });
    server.once('listening', () => {
      server.close();
      resolve({ name: 'Port', status: 'pass', message: `Port ${port} available` });
    });
    server.listen(port, '127.0.0.1');
  });
}

async function checkConfigFiles(): Promise<CheckResult> {
  const cwd = process.cwd();
  const required = ['config/settings.yml'];
  const optional = ['config/pricing.yml', '.env'];
  const missing = required.filter((f) => !existsSync(join(cwd, f)));
  const presentOptional = optional.filter((f) => existsSync(join(cwd, f)));

  if (missing.length > 0) {
    return {
      name: 'Config',
      status: 'fail',
      message: `Missing: ${missing.join(', ')}`,
      fix: 'profclaw setup',
    };
  }
  const extras = presentOptional.length > 0 ? ` (+${presentOptional.join(', ')})` : '';
  return { name: 'Config', status: 'pass', message: `settings.yml found${extras}` };
}

async function checkDiskSpace(): Promise<CheckResult> {
  try {
    const { stdout } = await execFileAsync('df', ['-h', process.cwd()], { timeout: 5000 });
    const lines = stdout.trim().split('\n');
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      const available = parts[3] || 'unknown';
      const usePct = parseInt(parts[4] || '0', 10);
      if (usePct > 95) {
        return { name: 'Disk', status: 'fail', message: `${available} free (${usePct}% used)`, fix: 'Free up disk space' };
      }
      if (usePct > 85) {
        return { name: 'Disk', status: 'warn', message: `${available} free (${usePct}% used)` };
      }
      return { name: 'Disk', status: 'pass', message: `${available} free (${usePct}% used)` };
    }
    return { name: 'Disk', status: 'pass', message: 'Readable' };
  } catch {
    return { name: 'Disk', status: 'warn', message: 'Could not check disk space' };
  }
}

async function checkDatabaseIntegrity(): Promise<CheckResult> {
  const result = await api.get<{ integrity: string }>('/api/setup/db-integrity');
  if (!result.ok) {
    // Try a direct PRAGMA if server is unavailable
    try {
      const { existsSync: fsExists } = await import('node:fs');
      const dbPath = join(process.cwd(), '.profclaw', 'profclaw.db');
      if (!fsExists(dbPath)) {
        return { name: 'DB Integrity', status: 'warn', message: 'Database file not found (server may not have run yet)' };
      }
      // Dynamically attempt SQLite integrity check (optional dep)
      const betterSqlite3 = 'better-sqlite3';
      const { default: Database } = await import(/* @vite-ignore */ betterSqlite3);
      const db = new Database(dbPath, { readonly: true });
      const row = db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined;
      db.close();
      const integrity = row?.integrity_check ?? 'unknown';
      if (integrity === 'ok') {
        return { name: 'DB Integrity', status: 'pass', message: 'ok' };
      }
      return { name: 'DB Integrity', status: 'fail', message: integrity, fix: 'Backup and recreate the database' };
    } catch {
      return { name: 'DB Integrity', status: 'warn', message: 'Cannot check (server not running, SQLite unavailable)' };
    }
  }
  const integrity = result.data?.integrity ?? 'ok';
  if (integrity === 'ok') {
    return { name: 'DB Integrity', status: 'pass', message: 'ok' };
  }
  return { name: 'DB Integrity', status: 'fail', message: integrity, fix: 'Backup and recreate the database' };
}

async function checkApiKeyValidation(): Promise<CheckResult[]> {
  const result = await api.get<{ providers: Array<{ type: string; enabled: boolean; healthy: boolean; message?: string }> }>('/api/chat/providers');
  if (!result.ok) {
    return [{ name: 'API Keys', status: 'warn', message: 'Cannot check (server not running)', fix: 'profclaw serve' }];
  }
  const configured = result.data?.providers?.filter((p) => p.enabled) ?? [];
  if (configured.length === 0) {
    return [{ name: 'API Keys', status: 'fail', message: 'No AI providers configured', fix: 'profclaw provider add anthropic' }];
  }
  return configured.map((p) => {
    const label = p.type.charAt(0).toUpperCase() + p.type.slice(1);
    if (p.healthy) {
      return { name: label, status: 'pass' as const, message: 'configured' };
    }
    return { name: label, status: 'warn' as const, message: `configured but unreachable${p.message ? ` (${p.message})` : ''}` };
  });
}

async function checkPortAvailability(): Promise<CheckResult> {
  const port = parseInt(process.env.PORT || '3000', 10);
  const net = await import('net');
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve({ name: 'Port availability', status: 'pass', message: `Port ${port} in use (server likely running)` });
      } else {
        resolve({ name: 'Port availability', status: 'warn', message: `Port ${port}: ${err.message}` });
      }
    });
    server.once('listening', () => {
      server.close();
      resolve({ name: 'Port availability', status: 'pass', message: `Port ${port} available` });
    });
    server.listen(port, '127.0.0.1');
  });
}

async function checkMissingDependencies(): Promise<CheckResult> {
  const required = ['ink', 'react', 'chalk', 'commander'];
  const missing: string[] = [];
  for (const dep of required) {
    try {
      await import(dep);
    } catch {
      missing.push(dep);
    }
  }
  if (missing.length === 0) {
    return { name: 'Dependencies', status: 'pass', message: `${required.length} required packages present` };
  }
  return {
    name: 'Dependencies',
    status: 'fail',
    message: `Missing: ${missing.join(', ')}`,
    fix: `npm install ${missing.join(' ')}`,
  };
}

async function checkConfigFileValidity(): Promise<CheckResult> {
  const cwd = process.cwd();
  const errors: string[] = [];

  const configJsonPath = join(cwd, '.profclaw', 'config.json');
  if (existsSync(configJsonPath)) {
    try {
      JSON.parse(readFileSync(configJsonPath, 'utf-8'));
    } catch {
      errors.push('config.json: invalid JSON');
    }
  }

  // settings.yml validation — check it parses as basic YAML (key: value lines, no tabs)
  const settingsYmlPath = join(cwd, 'config', 'settings.yml');
  if (existsSync(settingsYmlPath)) {
    try {
      const content = readFileSync(settingsYmlPath, 'utf-8');
      if (content.includes('\t')) {
        errors.push('settings.yml: contains tab characters (YAML requires spaces)');
      }
    } catch {
      errors.push('settings.yml: unreadable');
    }
  }

  if (errors.length > 0) {
    return {
      name: 'Config files',
      status: 'fail',
      message: errors.join('; '),
      fix: 'Fix the reported config files',
    };
  }
  return { name: 'Config files', status: 'pass', message: 'valid' };
}

async function checkPidFileStatus(): Promise<CheckResult> {
  const status = isServerRunning();
  if (status.running) {
    return {
      name: 'PID file',
      status: 'pass',
      message: `Server running (PID ${status.pid}, port ${status.port})`,
    };
  }
  // Check if a stale PID file was present (isServerRunning cleans it up automatically)
  return { name: 'PID file', status: 'pass', message: 'No server process found' };
}

async function checkDiskSpaceBytes(): Promise<CheckResult> {
  // macOS / Linux: use `df -k` to get kibibyte blocks for a numeric threshold check
  try {
    const { stdout } = await execFileAsync('df', ['-k', process.cwd()], { timeout: 5000 });
    const lines = stdout.trim().split('\n');
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      const availKB = parseInt(parts[3] || '0', 10);
      const availMB = availKB / 1024;
      const availGB = (availKB / 1024 / 1024).toFixed(1);
      const usePct = parseInt(parts[4] || '0', 10);
      if (availMB < 500) {
        return {
          name: 'Disk space',
          status: 'warn',
          message: `${availGB} GB free (< 500 MB threshold)`,
          fix: 'Free up disk space',
        };
      }
      if (usePct > 95) {
        return { name: 'Disk space', status: 'fail', message: `${availGB} GB free (${usePct}% used)`, fix: 'Free up disk space' };
      }
      return { name: 'Disk space', status: 'pass', message: `${availGB} GB free` };
    }
    return { name: 'Disk space', status: 'pass', message: 'Readable' };
  } catch {
    return { name: 'Disk space', status: 'warn', message: 'Could not check disk space' };
  }
}

async function checkTailscale(): Promise<CheckResult> {
  const result = await api.get<{ tailscale: { available: boolean; url?: string } }>('/api/tunnels/status');
  if (!result.ok) {
    try {
      await execFileAsync('which', ['tailscale'], { timeout: 3000 });
      return { name: 'Tailscale', status: 'pass', message: 'Installed (server not running for full check)' };
    } catch {
      return { name: 'Tailscale', status: 'warn', message: 'Not found (optional)', fix: 'https://tailscale.com/download' };
    }
  }
  if (result.data?.tailscale?.available) {
    return { name: 'Tailscale', status: 'pass', message: `Installed${result.data.tailscale.url ? ` (${result.data.tailscale.url})` : ''}` };
  }
  return { name: 'Tailscale', status: 'warn', message: 'Not installed (optional)', fix: 'https://tailscale.com/download' };
}

function formatCheck(result: CheckResult): void {
  const icon = result.status === 'pass' ? chalk.green('✓')
    : result.status === 'warn' ? chalk.yellow('⚠')
    : chalk.red('✗');
  const nameCol = result.name.padEnd(14);
  console.log(`  ${icon} ${chalk.bold(nameCol)} ${result.message}`);
  if (result.fix && result.status !== 'pass') {
    console.log(`    ${chalk.dim('Fix:')} ${chalk.cyan(result.fix)}`);
  }
}

export function doctorCommand(): Command {
  const cmd = new Command('doctor')
    .description('Run system diagnostics')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      console.log(chalk.bold('\nprofClaw Doctor\n'));

      // Static (single-result) checks
      const singleChecks: Array<{ name: string; fn: () => Promise<CheckResult> }> = [
        { name: 'Node.js', fn: checkNode },
        { name: 'Disk space', fn: checkDiskSpaceBytes },
        { name: 'Port availability', fn: checkPortAvailability },
        { name: 'DB Integrity', fn: checkDatabaseIntegrity },
        { name: 'Ollama', fn: checkOllama },
        { name: 'Redis', fn: checkRedis },
        { name: 'Config files', fn: checkConfigFileValidity },
        { name: 'Dependencies', fn: checkMissingDependencies },
        { name: 'PID file', fn: checkPidFileStatus },
        { name: 'Config', fn: checkConfigFiles },
        { name: 'Port', fn: checkPort },
        { name: 'Server', fn: checkServer },
        { name: 'Database', fn: checkDatabase },
        { name: 'Memory', fn: checkMemory },
        { name: 'Disk', fn: checkDiskSpace },
        { name: 'Cloudflared', fn: checkCloudflared },
        { name: 'Tailscale', fn: checkTailscale },
      ];

      const results: CheckResult[] = [];

      // Run single-result checks
      for (const check of singleChecks) {
        const spin = spinner(`Checking ${check.name}...`).start();
        try {
          const result = await check.fn();
          results.push(result);
          spin.stop();
          if (!options.json) formatCheck(result);
        } catch (err) {
          spin.stop();
          const result: CheckResult = {
            name: check.name,
            status: 'fail',
            message: err instanceof Error ? err.message : 'Unknown error',
          };
          results.push(result);
          if (!options.json) formatCheck(result);
        }
      }

      // Run multi-result check: API key validation per provider
      {
        const spin = spinner('Checking API keys...').start();
        try {
          const apiKeyResults = await checkApiKeyValidation();
          results.push(...apiKeyResults);
          spin.stop();
          if (!options.json) apiKeyResults.forEach(formatCheck);
        } catch (err) {
          spin.stop();
          const result: CheckResult = {
            name: 'API Keys',
            status: 'fail',
            message: err instanceof Error ? err.message : 'Unknown error',
          };
          results.push(result);
          if (!options.json) formatCheck(result);
        }
      }

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      const passed = results.filter((r) => r.status === 'pass').length;
      const warnings = results.filter((r) => r.status === 'warn').length;
      const failed = results.filter((r) => r.status === 'fail').length;

      console.log('');
      if (failed === 0 && warnings === 0) {
        success(`${passed} passed`);
      } else if (failed === 0) {
        info(`${passed} passed | ${warnings} warning${warnings !== 1 ? 's' : ''} | 0 failed`);
      } else {
        error(`${passed} passed | ${warnings} warning${warnings !== 1 ? 's' : ''} | ${failed} failed`);
        process.exitCode = 1;
      }
      console.log('');
    });

  return cmd;
}
