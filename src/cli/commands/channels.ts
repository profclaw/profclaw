import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import { spinner, success, error, info, createTable, truncate } from '../utils/output.js';

type ChannelProvider = 'slack' | 'discord' | 'telegram' | 'whatsapp' | 'webchat' | 'matrix' | 'sms' | 'email';

interface Channel {
  provider: ChannelProvider;
  enabled: boolean;
  configured: boolean;
  healthy?: boolean;
  config?: Record<string, unknown>;
}

interface ChannelsResponse {
  channels: Channel[];
}

interface ChannelConfigResponse {
  provider: ChannelProvider;
  config: Record<string, unknown>;
}

interface ChannelTestResponse {
  provider: ChannelProvider;
  healthy: boolean;
  message?: string;
}

export function channelsCommands(): Command {
  const cmd = new Command('channels')
    .description('Manage messaging channel configuration');

  cmd
    .command('list')
    .alias('ls')
    .description('List all messaging channels')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const spin = spinner('Fetching channels...').start();
      try {
        const result = await api.get<ChannelsResponse>('/api/channels');
        spin.stop();
        if (!result.ok) { error(result.error || 'Failed to fetch channels'); process.exit(1); }
        const { channels } = result.data!;
        if (options.json) { console.log(JSON.stringify(channels, null, 2)); return; }
        if (channels.length === 0) { info('No channels configured.'); return; }
        const table = createTable(['Provider', 'Enabled', 'Configured', 'Health']);
        for (const c of channels) {
          const healthDisplay = c.healthy == null
            ? chalk.dim('-')
            : c.healthy ? chalk.green('healthy') : chalk.red('unhealthy');
          table.push([
            c.provider,
            c.enabled ? chalk.green('yes') : chalk.dim('no'),
            c.configured ? chalk.green('yes') : chalk.yellow('no'),
            healthDisplay,
          ]);
        }
        console.log(table.toString());
      } catch (err) {
        spin.stop();
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  cmd
    .command('enable <provider>')
    .description('Enable a messaging channel provider')
    .option('--json', 'Output as JSON')
    .action(async (provider: string, options: { json?: boolean }) => {
      const spin = spinner(`Enabling ${provider}...`).start();
      try {
        const result = await api.post<Channel>(`/api/channels/${provider}/enable`);
        spin.stop();
        if (!result.ok) { error(result.error || `Failed to enable ${provider}`); process.exit(1); }
        if (options.json) { console.log(JSON.stringify(result.data, null, 2)); return; }
        success(`Channel ${chalk.cyan(provider)} enabled`);
      } catch (err) {
        spin.stop();
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  cmd
    .command('disable <provider>')
    .description('Disable a messaging channel provider')
    .option('--json', 'Output as JSON')
    .action(async (provider: string, options: { json?: boolean }) => {
      const spin = spinner(`Disabling ${provider}...`).start();
      try {
        const result = await api.post<Channel>(`/api/channels/${provider}/disable`);
        spin.stop();
        if (!result.ok) { error(result.error || `Failed to disable ${provider}`); process.exit(1); }
        if (options.json) { console.log(JSON.stringify(result.data, null, 2)); return; }
        success(`Channel ${chalk.cyan(provider)} disabled`);
      } catch (err) {
        spin.stop();
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  cmd
    .command('config <provider>')
    .description('Show channel configuration')
    .option('--json', 'Output as JSON')
    .action(async (provider: string, options: { json?: boolean }) => {
      const spin = spinner(`Fetching ${provider} config...`).start();
      try {
        const result = await api.get<ChannelConfigResponse>(`/api/channels/${provider}/config`);
        spin.stop();
        if (!result.ok) { error(result.error || `Failed to fetch ${provider} config`); process.exit(1); }
        const { config } = result.data!;
        if (options.json) { console.log(JSON.stringify(config, null, 2)); return; }
        console.log(`\n${chalk.bold(`${provider} Configuration`)}`);
        for (const [key, val] of Object.entries(config)) {
          const display = typeof val === 'string' && val.length > 20
            ? truncate(val, 40)
            : String(val);
          console.log(`  ${chalk.dim(key.padEnd(20))} ${display}`);
        }
        console.log();
      } catch (err) {
        spin.stop();
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  cmd
    .command('test <provider>')
    .description('Test a channel connection')
    .option('--json', 'Output as JSON')
    .action(async (provider: string, options: { json?: boolean }) => {
      const spin = spinner(`Testing ${provider}...`).start();
      try {
        const result = await api.post<ChannelTestResponse>(`/api/channels/${provider}/test`);
        spin.stop();
        if (!result.ok) { error(result.error || `Failed to test ${provider}`); process.exit(1); }
        if (options.json) { console.log(JSON.stringify(result.data, null, 2)); return; }
        const data = result.data!;
        if (data.healthy) {
          success(`${chalk.cyan(provider)} is healthy`);
        } else {
          error(`${chalk.cyan(provider)} is unhealthy: ${data.message || 'Unknown error'}`);
        }
      } catch (err) {
        spin.stop();
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  return cmd;
}
