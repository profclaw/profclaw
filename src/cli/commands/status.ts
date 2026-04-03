import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import { spinner } from '../utils/output.js';
import { isServerRunning } from '../../utils/pid-file.js';

interface QueueDepth {
  pending: number;
  running: number;
  total: number;
}

interface ProcessStats {
  pid: number;
  port: number;
  memoryMb: number;
  cpuLoadAvg: number[];
}

interface HealthResponse {
  status: string;
  version: string;
  mode?: string;
  service?: string;
  uptime?: number;
  system?: { deploymentMode?: string };
  agents?: Record<string, { healthy: boolean }>;
  sseClients?: number;
  activeSessions?: number;
  queueDepth?: QueueDepth;
  process?: ProcessStats;
  lastError?: string;
}

interface ProvidersResponse {
  default: string;
  providers: Array<{
    type: string;
    name?: string;
    enabled: boolean;
    configured?: boolean;
    healthy: boolean;
    latencyMs?: number;
    message?: string;
  }>;
}

interface SkillsResponse {
  skills: Array<{ name: string; enabled: boolean }>;
  stats: { total: number; enabled: number; disabled: number };
}

interface MemoryResponse {
  stats: { totalChunks: number; totalFiles: number; totalTokensEstimate?: number };
}

interface TunnelResponse {
  serverPort: number;
  tailscale: {
    available: boolean;
    serving: boolean;
    funneling: boolean;
    url?: string;
    tailnet?: string;
  };
  cloudflare: {
    available: boolean;
    running: boolean;
    activeUrl?: string;
    version?: string;
  };
}

function formatUptime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  }
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return `${d}d ${h}h`;
}

export function statusCommand(): Command {
  const cmd = new Command('status')
    .description('System status overview')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const spin = spinner('Fetching system status...').start();

      const [health, providers, skills, memory, tunnels] = await Promise.all([
        api.get<HealthResponse>('/health'),
        api.get<ProvidersResponse>('/api/chat/providers'),
        api.get<SkillsResponse>('/api/skills'),
        api.get<MemoryResponse>('/api/memory/stats'),
        api.get<TunnelResponse>('/api/tunnels/status'),
      ]);

      spin.stop();

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              health: health.data,
              providers: providers.data,
              skills: skills.data,
              memory: memory.data,
              tunnels: tunnels.data,
            },
            null,
            2
          )
        );
        return;
      }

      const version = health.data?.version || '?';
      const mode =
        health.data?.mode ||
        health.data?.system?.deploymentMode ||
        process.env['PROFCLAW_MODE'] ||
        'mini';
      const statusText = health.ok
        ? chalk.green('healthy')
        : chalk.red('unhealthy');

      console.log(
        `\nprofClaw v${version} | Mode: ${mode} | Status: ${statusText}\n`
      );

      // PID / port from PID file (fast local read) or health endpoint
      const pidInfo = isServerRunning();
      const pid = health.data?.process?.pid ?? pidInfo.pid;
      const port = health.data?.process?.port ?? pidInfo.port;
      if (pid !== undefined) {
        console.log(`${chalk.bold('Process')}      PID ${pid}${port ? `, port ${port}` : ''}`);
      }

      // Uptime
      if (health.data?.uptime !== undefined) {
        console.log(`${chalk.bold('Uptime')}       ${formatUptime(health.data.uptime)}`);
      }

      // SSE clients
      if (health.data?.sseClients !== undefined) {
        console.log(`${chalk.bold('SSE Clients')}  ${health.data.sseClients}`);
      }

      // Active agent sessions
      if (health.data?.activeSessions !== undefined) {
        console.log(`${chalk.bold('Sessions')}     ${health.data.activeSessions} active`);
      }

      // Queue depth
      if (health.data?.queueDepth !== undefined) {
        const q = health.data.queueDepth;
        console.log(`${chalk.bold('Queue')}        ${q.pending} pending, ${q.running} running`);
      }

      // Memory and CPU
      if (health.data?.process !== undefined) {
        const p = health.data.process;
        const load = p.cpuLoadAvg.length > 0 ? p.cpuLoadAvg[0].toFixed(2) : '?';
        console.log(`${chalk.bold('Resources')}    ${p.memoryMb} MB RSS | CPU load ${load}`);
      }

      // Last error
      if (health.data?.lastError) {
        console.log(`${chalk.bold('Last error')}   ${chalk.red(health.data.lastError)}`);
      }

      console.log('');

      if (providers.ok && providers.data) {
        const active = providers.data.providers.filter((p) => p.enabled || p.configured);
        const healthySummary = active
          .map((p) =>
            p.healthy ? chalk.green(p.type) : chalk.red(p.type)
          )
          .join(', ');
        console.log(
          `${chalk.bold('Providers')}    ${active.length} configured (${healthySummary})`
        );
      } else {
        console.log(
          `${chalk.bold('Providers')}    ${chalk.dim('unavailable')}`
        );
      }

      if (skills.ok && skills.data) {
        const { stats } = skills.data;
        console.log(
          `${chalk.bold('Skills')}       ${stats.total} loaded, ${stats.enabled} enabled`
        );
      }

      if (memory.ok && memory.data) {
        const s = memory.data.stats;
        console.log(
          `${chalk.bold('Memory')}       ${(s.totalChunks ?? 0).toLocaleString()} chunks across ${s.totalFiles ?? 0} files`
        );
      }

      if (tunnels.ok && tunnels.data) {
        const cf = tunnels.data.cloudflare?.running
          ? chalk.green('active')
          : chalk.dim('not running');
        const ts = tunnels.data.tailscale?.available
          ? tunnels.data.tailscale.serving
            ? chalk.green('serving')
            : chalk.dim('connected')
          : chalk.dim('not running');
        console.log(
          `${chalk.bold('Tunnels')}      Cloudflare: ${cf} | Tailscale: ${ts}`
        );
      }

      console.log();
    });

  return cmd;
}
