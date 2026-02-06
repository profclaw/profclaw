import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import { success, error, spinner } from '../utils/output.js';

interface TunnelStatus {
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
    authenticated?: boolean;
  };
}

interface QuickTunnelResponse {
  url: string;
  port: number;
}

export function tunnelCommands(): Command {
  const cmd = new Command('tunnel')
    .description('Manage tunnels (Cloudflare, Tailscale)');

  // status (default)
  cmd
    .command('status', { isDefault: true })
    .description('Show tunnel status')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const spin = spinner('Fetching tunnel status...').start();
      const result = await api.get<TunnelStatus>('/api/tunnels/status');
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to fetch tunnel status');
        process.exit(1);
      }

      const data = result.data!;

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      const cf = data.cloudflare;
      const ts = data.tailscale;

      console.log();
      console.log(chalk.bold('Cloudflare Tunnel'));
      if (!cf.available) {
        console.log(`  Status:    ${chalk.dim('not available')}`);
      } else {
        const cfStatus = cf.running ? chalk.green('running') : chalk.red('stopped');
        console.log(`  Status:    ${cfStatus}`);
        if (cf.activeUrl) {
          console.log(`  URL:       ${cf.activeUrl}`);
        }
        if (cf.version) {
          console.log(`  Version:   ${cf.version}`);
        }
      }

      console.log();
      console.log(chalk.bold('Tailscale'));
      if (!ts.available) {
        console.log(`  Status:    ${chalk.dim('not available')}`);
      } else {
        const tsStatus = ts.serving ? chalk.green('connected') : chalk.red('not running');
        console.log(`  Status:    ${tsStatus}`);
        if (ts.url) {
          console.log(`  URL:       ${ts.url}`);
        }
        if (ts.tailnet) {
          console.log(`  Tailnet:   ${ts.tailnet}`);
        }
      }

      console.log();
    });

  // start
  cmd
    .command('start')
    .description('Start a Cloudflare quick tunnel')
    .option('--port <n>', 'Local port to expose', '3000')
    .option('--json', 'Output as JSON')
    .action(async (options: { port?: string; json?: boolean }) => {
      const port = parseInt(options.port ?? '3000', 10);
      const spin = spinner('Starting Cloudflare tunnel...').start();
      const result = await api.post<QuickTunnelResponse>('/api/tunnels/cloudflare/quick', { port });
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to start tunnel');
        process.exit(1);
      }

      const data = result.data!;

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      success(`Tunnel started`);
      console.log(`\n  ${chalk.bold('URL:')} ${chalk.cyan(data.url)}\n`);
    });

  // stop
  cmd
    .command('stop')
    .description('Stop the active Cloudflare tunnel')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const spin = spinner('Stopping tunnel...').start();
      const result = await api.post('/api/tunnels/cloudflare/stop');
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to stop tunnel');
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(result.data, null, 2));
        return;
      }

      success('Tunnel stopped');
    });

  // tailscale
  cmd
    .command('tailscale')
    .description('Show detailed Tailscale status')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const spin = spinner('Fetching Tailscale status...').start();
      const result = await api.get<TunnelStatus['tailscale']>('/api/tunnels/tailscale/status');
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to fetch Tailscale status');
        process.exit(1);
      }

      const data = result.data!;

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      console.log();
      console.log(chalk.bold('Tailscale Status'));
      console.log(`  Available:  ${data.available ? chalk.green('yes') : chalk.red('no')}`);
      console.log(`  Serving:    ${data.serving ? chalk.green('yes') : chalk.dim('no')}`);
      console.log(`  Funneling:  ${data.funneling ? chalk.green('yes') : chalk.dim('no')}`);
      if (data.url) {
        console.log(`  URL:        ${data.url}`);
      }
      if (data.tailnet) {
        console.log(`  Tailnet:    ${data.tailnet}`);
      }
      console.log();
    });

  return cmd;
}
