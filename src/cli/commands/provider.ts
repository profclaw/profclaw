/**
 * Provider CLI Commands
 *
 * Manage AI providers from the command line.
 *
 * Usage:
 *   profclaw provider list
 *   profclaw provider add <type>
 *   profclaw provider remove <type>
 *   profclaw provider test [type]
 *   profclaw provider default [type]
 *   profclaw provider models [type]
 */

import { Command } from 'commander';
import * as readline from 'readline';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import { createTable, success, error, info, spinner, truncate } from '../utils/output.js';

interface ProviderInfo {
  type: string;
  name?: string;
  enabled: boolean;
  healthy: boolean;
  latencyMs?: number;
  message?: string;
  models?: string[];
}

interface ProviderListResponse {
  default: string;
  providers: ProviderInfo[];
}

interface HealthResponse {
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  costPer1MInput?: number;
  costPer1MOutput?: number;
}

interface ModelsResponse {
  models: ModelInfo[];
  aliases: Record<string, string>;
}

interface DefaultResponse {
  provider: string;
}

function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} (y/N) `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

function promptSecret(message: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    process.stdout.write(message);
    const stdin = process.stdin;
    const wasRaw = (stdin as NodeJS.ReadStream & { isRaw?: boolean }).isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    let input = '';
    const onData = (char: Buffer) => {
      const c = char.toString();
      if (c === '\n' || c === '\r') {
        if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        rl.close();
        resolve(input);
      } else if (c === '\u0003') {
        rl.close();
        process.exit(0);
      } else if (c === '\u007f') {
        input = input.slice(0, -1);
      } else {
        input += c;
      }
    };
    stdin.on('data', onData);
  });
}

export function providerCommands(): Command {
  const cmd = new Command('provider')
    .description('Manage AI providers');

  // profclaw provider list
  cmd
    .command('list')
    .alias('ls')
    .description('List configured AI providers')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const spin = spinner('Fetching providers...').start();
      const result = await api.get<ProviderListResponse>('/api/chat/providers');
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to fetch providers');
        process.exit(1);
      }

      const { default: defaultProvider, providers } = result.data!;

      if (options.json) {
        console.log(JSON.stringify(result.data, null, 2));
        return;
      }

      if (providers.length === 0) {
        info('No providers configured.');
        info('Add one: profclaw provider add <type>');
        return;
      }

      const table = createTable(['Type', 'Enabled', 'Default', 'Status']);

      for (const p of providers) {
        const isDefault = p.type === defaultProvider;
        const typeDisplay = isDefault ? chalk.cyan(p.type) + chalk.yellow(' *') : p.type;
        const enabledDisplay = p.enabled ? chalk.green('yes') : chalk.dim('no');
        const defaultDisplay = isDefault ? chalk.yellow('yes') : chalk.dim('no');

        let statusDisplay: string;
        if (p.healthy) {
          const latency = p.latencyMs != null ? chalk.dim(` ${p.latencyMs}ms`) : '';
          statusDisplay = chalk.green('● healthy') + latency;
        } else {
          statusDisplay = chalk.red('● unhealthy');
        }

        table.push([typeDisplay, enabledDisplay, defaultDisplay, statusDisplay]);
      }

      console.log(table.toString());
      console.log(chalk.dim(`\nDefault: ${defaultProvider || 'none'}`));
    });

  // profclaw provider add <type>
  cmd
    .command('add <type>')
    .description('Add and configure an AI provider')
    .option('--json', 'Output as JSON')
    .action(async (type: string, options: { json?: boolean }) => {
      const apiKey = await promptSecret(`Enter API key for ${chalk.cyan(type)}: `);

      if (!apiKey.trim()) {
        error('API key cannot be empty');
        process.exit(1);
      }

      const spin = spinner(`Configuring ${type}...`).start();
      const configResult = await api.post(`/api/chat/providers/${type}/configure`, { type, apiKey });
      spin.stop();

      if (!configResult.ok) {
        error(configResult.error || `Failed to configure ${type}`);
        process.exit(1);
      }

      success(`Provider ${chalk.cyan(type)} configured`);

      const healthSpin = spinner(`Testing ${type}...`).start();
      const healthResult = await api.post<HealthResponse>(`/api/chat/providers/${type}/health`);
      healthSpin.stop();

      if (!healthResult.ok) {
        error(healthResult.error || 'Health check failed');
        return;
      }

      const health = healthResult.data!;

      if (options.json) {
        console.log(JSON.stringify({ type, configured: true, ...health }, null, 2));
        return;
      }

      if (health.healthy) {
        const latency = health.latencyMs != null ? chalk.dim(` (${health.latencyMs}ms)`) : '';
        success(`Health check passed${latency}`);
      } else {
        error(`Health check failed: ${health.error || 'Unknown error'}`);
      }
    });

  // profclaw provider remove <type>
  cmd
    .command('remove <type>')
    .description('Remove a provider configuration')
    .option('--yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(async (type: string, options: { yes?: boolean; json?: boolean }) => {
      if (!options.yes) {
        const ok = await confirm(`Remove provider ${chalk.cyan(type)}?`);
        if (!ok) {
          info('Aborted.');
          return;
        }
      }

      const spin = spinner(`Removing ${type}...`).start();
      const result = await api.patch('/api/settings', {
        providers: { [type]: null },
      });
      spin.stop();

      if (!result.ok) {
        error(result.error || `Failed to remove ${type}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify({ removed: type }, null, 2));
        return;
      }

      success(`Provider ${chalk.cyan(type)} removed`);
    });

  // profclaw provider test [type]
  cmd
    .command('test [type]')
    .description('Test provider health (all or a specific type)')
    .option('--json', 'Output as JSON')
    .action(async (type: string | undefined, options: { json?: boolean }) => {
      if (type) {
        const spin = spinner(`Testing ${type}...`).start();
        const result = await api.post<HealthResponse>(`/api/chat/providers/${type}/health`);
        spin.stop();

        if (!result.ok) {
          error(result.error || `Failed to test ${type}`);
          process.exit(1);
        }

        const health = result.data!;

        if (options.json) {
          console.log(JSON.stringify({ type, ...health }, null, 2));
          return;
        }

        if (health.healthy) {
          const latency = health.latencyMs != null ? ` (${health.latencyMs}ms)` : '';
          success(`${chalk.cyan(type)} is healthy${latency}`);
        } else {
          error(`${chalk.cyan(type)} is unhealthy: ${health.error || 'Unknown error'}`);
        }
        return;
      }

      // Test all configured providers
      const listSpin = spinner('Fetching providers...').start();
      const listResult = await api.get<ProviderListResponse>('/api/chat/providers');
      listSpin.stop();

      if (!listResult.ok) {
        error(listResult.error || 'Failed to fetch providers');
        process.exit(1);
      }

      const active = listResult.data!.providers.filter((p) => p.enabled);

      if (active.length === 0) {
        info('No configured providers to test.');
        return;
      }

      const results: Array<{ type: string; healthy: boolean; latencyMs?: number; error?: string }> = [];

      for (const p of active) {
        const spin = spinner(`Testing ${p.type}...`).start();
        const healthResult = await api.post<HealthResponse>(`/api/chat/providers/${p.type}/health`);
        spin.stop();

        if (healthResult.ok && healthResult.data) {
          results.push({ type: p.type, ...healthResult.data });
        } else {
          results.push({ type: p.type, healthy: false, error: healthResult.error || 'Failed' });
        }
      }

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      const table = createTable(['Provider', 'Status', 'Latency']);
      for (const r of results) {
        const statusDisplay = r.healthy ? chalk.green('● healthy') : chalk.red('● unhealthy');
        const latencyDisplay = r.latencyMs != null ? `${r.latencyMs}ms` : chalk.dim('-');
        table.push([r.type, statusDisplay, latencyDisplay]);
      }
      console.log(table.toString());
    });

  // profclaw provider default [type]
  cmd
    .command('default [type]')
    .description('Get or set the default provider')
    .option('--json', 'Output as JSON')
    .action(async (type: string | undefined, options: { json?: boolean }) => {
      if (!type) {
        const spin = spinner('Fetching providers...').start();
        const result = await api.get<ProviderListResponse>('/api/chat/providers');
        spin.stop();

        if (!result.ok) {
          error(result.error || 'Failed to fetch providers');
          process.exit(1);
        }

        const defaultProvider = result.data!.default;

        if (options.json) {
          console.log(JSON.stringify({ default: defaultProvider }, null, 2));
          return;
        }

        if (defaultProvider) {
          info(`Default provider: ${chalk.cyan(defaultProvider)}`);
        } else {
          info('No default provider set.');
        }
        return;
      }

      const spin = spinner(`Setting default to ${type}...`).start();
      const result = await api.post<DefaultResponse>('/api/chat/providers/default', { provider: type });
      spin.stop();

      if (!result.ok) {
        error(result.error || `Failed to set default provider`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(result.data, null, 2));
        return;
      }

      success(`Default provider set to ${chalk.cyan(type)}`);
    });

  // profclaw provider models [type]
  cmd
    .command('models [type]')
    .description('List available models (optionally filtered by provider)')
    .option('--json', 'Output as JSON')
    .action(async (type: string | undefined, options: { json?: boolean }) => {
      const path = type ? `/api/chat/models?provider=${encodeURIComponent(type)}` : '/api/chat/models';
      const spin = spinner('Fetching models...').start();
      const result = await api.get<ModelsResponse>(path);
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to fetch models');
        process.exit(1);
      }

      const { models } = result.data!;

      if (options.json) {
        console.log(JSON.stringify(result.data, null, 2));
        return;
      }

      if (models.length === 0) {
        info('No models available.');
        return;
      }

      const table = createTable(['Model', 'Provider', 'Context Window', 'Cost (in/out)']);

      for (const m of models) {
        const context = m.contextWindow != null
          ? m.contextWindow >= 1000000
            ? `${(m.contextWindow / 1000000).toFixed(1)}M`
            : `${(m.contextWindow / 1000).toFixed(0)}K`
          : chalk.dim('-');

        const cost = m.costPer1MInput != null && m.costPer1MOutput != null
          ? `$${m.costPer1MInput.toFixed(2)}/$${m.costPer1MOutput.toFixed(2)}`
          : chalk.dim('-');

        table.push([truncate(m.id, 40), m.provider, context, cost]);
      }

      console.log(table.toString());
      console.log(chalk.dim(`\n${models.length} model${models.length !== 1 ? 's' : ''}`));
    });

  return cmd;
}
