import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import { spinner } from '../utils/output.js';

interface HealthResponse {
  status: string;
  version: string;
  mode?: string;
  service?: string;
  uptime?: number;
  system?: { deploymentMode?: string };
  agents?: Record<string, { healthy: boolean }>;
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
