import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import {
  getConfig,
  saveConfig,
  getConfigPath,
  type CLIConfig,
} from '../utils/config.js';
import { createTable, success, error, info, spinner } from '../utils/output.js';

export function configCommands() {
  const config = new Command('config')
    .description('Manage configuration');

  // Get config
  config
    .command('get [key]')
    .description('Get configuration value(s)')
    .option('--json', 'Output as JSON')
    .option('--server', 'Get server-side settings')
    .action(async (key, options) => {
      if (options.server) {
        // Get server-side settings
        const spin = spinner('Fetching settings...').start();
        const result = await api.get<{ settings: any }>('/api/settings');
        spin.stop();

        if (!result.ok) {
          error(result.error || 'Failed to fetch settings');
          process.exit(1);
        }

        const settings = result.data!.settings;

        if (options.json) {
          console.log(JSON.stringify(key ? settings[key] : settings, null, 2));
          return;
        }

        if (key) {
          if (settings[key] !== undefined) {
            console.log(JSON.stringify(settings[key], null, 2));
          } else {
            error(`Setting "${key}" not found`);
            process.exit(1);
          }
        } else {
          console.log('\n## Server Settings\n');
          for (const [category, values] of Object.entries(settings)) {
            console.log(chalk.bold(`${category}:`));
            for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
              console.log(`  ${k}: ${typeof v === 'string' && v.includes('••••') ? chalk.dim(v) : JSON.stringify(v)}`);
            }
            console.log('');
          }
        }
        return;
      }

      // Get CLI config
      const cliConfig = getConfig();

      if (options.json) {
        console.log(JSON.stringify(key ? cliConfig[key as keyof CLIConfig] : cliConfig, null, 2));
        return;
      }

      if (key) {
        const value = cliConfig[key as keyof CLIConfig];
        if (value !== undefined) {
          console.log(value);
        } else {
          error(`Config key "${key}" not found`);
          console.log('\nAvailable keys: apiUrl, apiToken, defaultAgent, outputFormat');
          process.exit(1);
        }
      } else {
        console.log('\n## CLI Configuration\n');
        console.log(`Config file: ${getConfigPath()}`);
        console.log('');

        const table = createTable(['Key', 'Value']);
        table.push(['apiUrl', cliConfig.apiUrl]);
        table.push(['apiToken', cliConfig.apiToken ? chalk.dim('••••••••') : '-']);
        table.push(['defaultAgent', cliConfig.defaultAgent || '-']);
        table.push(['outputFormat', cliConfig.outputFormat]);
        console.log(table.toString());

        console.log('\nUse --server to view server-side settings');
      }
    });

  // Set config
  config
    .command('set <key> <value>')
    .description('Set configuration value')
    .option('--server', 'Set server-side setting')
    .action(async (key, value, options) => {
      if (options.server) {
        // Parse the key as category.key format
        const [category, settingKey] = key.split('.');
        if (!category || !settingKey) {
          error('Server settings must be in format: category.key (e.g., system.telemetry)');
          process.exit(1);
        }

        // Parse value as JSON if possible
        let parsedValue: unknown = value;
        try {
          parsedValue = JSON.parse(value);
        } catch {
          // Keep as string
        }

        const spin = spinner('Updating settings...').start();
        const result = await api.patch('/api/settings', {
          [category]: { [settingKey]: parsedValue },
        });
        spin.stop();

        if (!result.ok) {
          error(result.error || 'Failed to update settings');
          process.exit(1);
        }

        success(`Server setting ${key} updated`);
        return;
      }

      // Set CLI config
      const validKeys: (keyof CLIConfig)[] = ['apiUrl', 'apiToken', 'defaultAgent', 'outputFormat'];

      if (!validKeys.includes(key as keyof CLIConfig)) {
        error(`Invalid config key: ${key}`);
        console.log(`\nValid keys: ${validKeys.join(', ')}`);
        process.exit(1);
      }

      saveConfig({ [key]: value } as Partial<CLIConfig>);
      success(`Config ${key} updated`);
    });

  // Reset config
  config
    .command('reset')
    .description('Reset configuration to defaults')
    .option('--server', 'Reset server-side settings')
    .action(async (options) => {
      if (options.server) {
        const spin = spinner('Resetting server settings...').start();
        const result = await api.post('/api/settings/reset');
        spin.stop();

        if (!result.ok) {
          error(result.error || 'Failed to reset settings');
          process.exit(1);
        }

        success('Server settings reset to defaults');
        return;
      }

      // Reset CLI config
      saveConfig({
        apiUrl: 'http://localhost:3000',
        apiToken: undefined,
        defaultAgent: undefined,
        outputFormat: 'table',
      });
      success('CLI configuration reset to defaults');
    });

  // Show config file path
  config
    .command('path')
    .description('Show configuration file path')
    .action(() => {
      console.log(getConfigPath());
    });

  // Login with API token
  config
    .command('login')
    .description('Configure API authentication')
    .option('-t, --token <token>', 'API token')
    .option('-u, --url <url>', 'API URL')
    .action(async (options) => {
      if (options.url) {
        saveConfig({ apiUrl: options.url });
        info(`API URL set to ${options.url}`);
      }

      if (options.token) {
        saveConfig({ apiToken: options.token });
        success('API token saved');

        // Test connection
        const spin = spinner('Testing connection...').start();
        const result = await api.get('/health');
        spin.stop();

        if (result.ok) {
          success('Connection successful');
        } else {
          error(`Connection failed: ${result.error}`);
        }
        return;
      }

      // Interactive mode (just show instructions for now)
      console.log('\n## Authentication Setup\n');
      console.log('Set your API token:');
      console.log('  profclaw config login --token <your-token>');
      console.log('');
      console.log('Or set via environment:');
      console.log('  export PROFCLAW_API_TOKEN=<your-token>');
    });

  return config;
}
