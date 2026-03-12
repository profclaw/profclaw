/**
 * Plugin CLI Commands
 *
 * Manage profClaw plugins from the command line.
 *
 * Usage:
 *   profclaw plugin create <name> --type tool
 *   profclaw plugin list
 *   profclaw plugin install <package>
 *   profclaw plugin uninstall <package>
 *   profclaw plugin search <query>
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { scaffoldPlugin } from '../../plugins/scaffolder.js';
import type { PluginTemplateType } from '../../plugins/scaffolder.js';
import { getMarketplace } from '../../plugins/marketplace.js';
import { getClawHubClient } from '../../plugins/clawhub.js';
import { success, error, info } from '../utils/output.js';

export function pluginCommands(): Command {
  const cmd = new Command('plugin')
    .description('Manage profClaw plugins');

  // profclaw plugin create <name>
  cmd
    .command('create <name>')
    .description('Scaffold a new plugin project')
    .option('-t, --type <type>', 'Plugin type: tool, channel, integration, skill', 'tool')
    .option('-d, --description <desc>', 'Plugin description')
    .option('-a, --author <author>', 'Plugin author')
    .option('-o, --output <dir>', 'Output directory')
    .action((name: string, opts: { type: string; description?: string; author?: string; output?: string }) => {
      const validTypes: PluginTemplateType[] = ['tool', 'channel', 'integration', 'skill'];
      const pluginType = opts.type as PluginTemplateType;

      if (!validTypes.includes(pluginType)) {
        error(`Invalid plugin type: ${opts.type}. Must be one of: ${validTypes.join(', ')}`);
        process.exit(1);
      }

      const result = scaffoldPlugin({
        name,
        type: pluginType,
        description: opts.description,
        author: opts.author,
        outputDir: opts.output,
      });

      if (result.success) {
        success(`Plugin scaffolded at ${chalk.cyan(`profclaw-plugin-${name}/`)}`);
        console.log('');
        info('Files created:');
        for (const file of result.files) {
          console.log(`  ${file}`);
        }
        console.log('');
        info('Next steps:');
        console.log(`  cd profclaw-plugin-${name}`);
        console.log('  npm install');
        console.log('  npm run dev');
        console.log(`  # Copy to ~/.profclaw/plugins/${name}/ to test`);
      } else {
        error(`Failed to scaffold plugin: ${result.error ?? 'Unknown error'}`);
        process.exit(1);
      }
    });

  // profclaw plugin list
  cmd
    .command('list')
    .description('List installed plugins')
    .option('--clawhub', 'Also show ClawHub installed skills')
    .action(async (opts: { clawhub?: boolean }) => {
      try {
        // Show locally loaded plugins via plugin loader
        const { loadPlugins } = await import('../../plugins/loader.js');
        const loaded = await loadPlugins();

        if (loaded.length === 0) {
          info('No plugins loaded from plugin directories.');
        } else {
          console.log(chalk.bold('\nLoaded Plugins:\n'));
          for (const { plugin, source, path } of loaded) {
            const meta = plugin.metadata;
            const features: string[] = [];
            if (plugin.tools?.length) features.push(`${plugin.tools.length} tools`);
            if (plugin.searchProvider) features.push('search');
            if (plugin.skills?.length) features.push(`${plugin.skills.length} skills`);

            console.log(`  ${chalk.cyan(meta.name)} ${chalk.dim(`v${meta.version}`)}`);
            console.log(`    ${chalk.dim(meta.description)}`);
            console.log(`    Source: ${source} | Features: ${features.join(', ') || 'none'}`);
            console.log(`    Path: ${chalk.dim(path)}`);
            console.log('');
          }
        }

        // Show marketplace-tracked plugins
        const marketplace = getMarketplace();
        const installed = marketplace.listInstalled();

        if (installed.length > 0) {
          console.log(chalk.bold('Marketplace Plugins:\n'));
          for (const p of installed) {
            const status = p.enabled ? chalk.green('enabled') : chalk.dim('disabled');
            console.log(`  ${chalk.cyan(p.name)}@${p.version} [${status}] (${p.source})`);
          }
          console.log('');
        }

        if (opts.clawhub) {
          const hub = getClawHubClient();
          const hubInstalled = hub.listInstalled();
          if (hubInstalled.length > 0) {
            console.log(chalk.bold(`ClawHub Skills (${hubInstalled.length}):\n`));
            for (const s of hubInstalled) {
              console.log(`  ${chalk.cyan(s.name)} from ${chalk.dim(s.repo)}`);
            }
            console.log('');
          } else {
            info('No ClawHub skills installed.');
          }
        }

        if (loaded.length === 0 && installed.length === 0) {
          info('Install plugins: profclaw plugin install <name>');
          info('Create a plugin: profclaw plugin create <name>');
        }
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to list plugins');
      }
    });

  // profclaw plugin install <package>
  cmd
    .command('install <package>')
    .description('Install a plugin from npm (e.g., profclaw-plugin-github or just "github")')
    .option('-v, --version <version>', 'Specific version to install')
    .action(async (packageName: string, opts: { version?: string }) => {
      const fullName = packageName.startsWith('profclaw-plugin-') || packageName.startsWith('@profclaw/')
        ? packageName
        : `profclaw-plugin-${packageName}`;

      const marketplace = getMarketplace();
      try {
        info(`Installing ${fullName}...`);
        const result = await marketplace.install(fullName, opts.version);
        success(`Installed ${result.name}@${result.version}`);
        info('Restart profClaw to load the plugin.');
      } catch (err) {
        error(err instanceof Error ? err.message : `Failed to install ${fullName}`);
        info('Check that the package exists on npm: https://www.npmjs.com');
        process.exit(1);
      }
    });

  // profclaw plugin uninstall <package>
  cmd
    .command('uninstall <package>')
    .description('Uninstall a plugin')
    .action(async (packageName: string) => {
      const fullName = packageName.startsWith('profclaw-plugin-') || packageName.startsWith('@profclaw/')
        ? packageName
        : `profclaw-plugin-${packageName}`;

      const marketplace = getMarketplace();
      try {
        await marketplace.uninstall(fullName);
        success(`Uninstalled ${fullName}`);
        info('Restart profClaw for changes to take effect.');
      } catch (err) {
        error(err instanceof Error ? err.message : `Failed to uninstall ${fullName}`);
        process.exit(1);
      }
    });

  // profclaw plugin search [query]
  cmd
    .command('search [query]')
    .description('Search for plugins on npm and ClawHub')
    .option('--npm-only', 'Search npm only')
    .option('--clawhub-only', 'Search ClawHub only')
    .action(async (query: string | undefined, opts: { npmOnly?: boolean; clawhubOnly?: boolean }) => {
      if (!opts.clawhubOnly) {
        info('Searching npm...');
        const marketplace = getMarketplace();
        try {
          const results = await marketplace.search(query);
          if (results.length > 0) {
            console.log(chalk.bold(`\nnpm results (${results.length}):\n`));
            for (const p of results) {
              const cat = chalk.dim(`[${p.category}]`);
              console.log(`  ${chalk.cyan(p.name)} ${cat}`);
              if (p.description) console.log(`    ${p.description}`);
            }
            console.log('');
          } else {
            info('No npm results found.');
          }
        } catch {
          info('npm search unavailable (no network or npm not installed).');
        }
      }

      if (!opts.npmOnly) {
        info('Searching ClawHub...');
        const hub = getClawHubClient();
        try {
          const results = await hub.search(query);
          if (results.length > 0) {
            console.log(chalk.bold(`\nClawHub results (${results.length}):\n`));
            for (const s of results.slice(0, 20)) {
              const stars = s.stars > 0 ? chalk.dim(` (${s.stars} stars)`) : '';
              console.log(`  ${chalk.cyan(`${s.author}/${s.name}`)}${stars}`);
              if (s.description) console.log(`    ${s.description}`);
            }
            console.log('');
            info('Install a ClawHub skill: profclaw plugin install --clawhub <author/name>');
          } else {
            info('No ClawHub results found.');
          }
        } catch {
          info('ClawHub search unavailable.');
        }
      }
    });

  return cmd;
}
