import { Command } from 'commander';
import chalk from 'chalk';
import * as os from 'os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { api } from '../utils/api.js';
import { success, error, info, spinner } from '../utils/output.js';

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
  if (major >= 22) {
    return { name: 'Node.js', status: 'pass', message: `${version}` };
  }
  return {
    name: 'Node.js',
    status: 'fail',
    message: `${version} (requires >= 22)`,
    fix: 'nvm install 22',
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

      const checks: Array<{ name: string; fn: () => Promise<CheckResult> }> = [
        { name: 'Node.js', fn: checkNode },
        { name: 'Config', fn: checkConfigFiles },
        { name: 'Port', fn: checkPort },
        { name: 'Redis', fn: checkRedis },
        { name: 'Ollama', fn: checkOllama },
        { name: 'Server', fn: checkServer },
        { name: 'Database', fn: checkDatabase },
        { name: 'AI Provider', fn: checkProvider },
        { name: 'Memory', fn: checkMemory },
        { name: 'Disk', fn: checkDiskSpace },
        { name: 'Cloudflared', fn: checkCloudflared },
        { name: 'Tailscale', fn: checkTailscale },
      ];

      const results: CheckResult[] = [];

      for (const check of checks) {
        const spin = spinner(`Checking ${check.name}...`).start();
        try {
          const result = await check.fn();
          results.push(result);
          spin.stop();
          formatCheck(result);
        } catch (err) {
          spin.stop();
          const result: CheckResult = {
            name: check.name,
            status: 'fail',
            message: err instanceof Error ? err.message : 'Unknown error',
          };
          results.push(result);
          formatCheck(result);
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
      const total = results.length;
      if (failed === 0 && warnings === 0) {
        success(`All ${total} checks passed`);
      } else if (failed === 0) {
        info(`${passed}/${total} passed, ${warnings} warnings`);
      } else {
        error(`${passed}/${total} passed, ${warnings} warnings, ${failed} failed`);
        process.exitCode = 1;
      }
      console.log('');
    });

  return cmd;
}
