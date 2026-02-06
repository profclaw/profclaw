/**
 * Skill CLI Commands
 *
 * Manage profClaw skills from the command line.
 *
 * Usage:
 *   profclaw skill list
 *   profclaw skill info <name>
 *   profclaw skill enable <name>
 *   profclaw skill disable <name>
 *   profclaw skill reload
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import { createTable, success, error, info, spinner, truncate } from '../utils/output.js';

interface SkillStats {
  invocations?: number;
  avgDurationMs?: number;
  lastUsed?: string;
}

interface Skill {
  name: string;
  description: string;
  enabled: boolean;
  source: string;
  eligible?: boolean;
  capabilities?: string[];
  dependencies?: string[];
  stats?: SkillStats;
}

interface SkillListResponse {
  skills: Skill[];
  stats: {
    total: number;
    enabled: number;
    disabled: number;
  };
}

interface ToggleResponse {
  name: string;
  enabled: boolean;
}

interface ReloadResponse {
  message: string;
  stats: {
    total: number;
    loaded: number;
    failed: number;
  };
}

export function skillCommands(): Command {
  const cmd = new Command('skill')
    .description('Manage profClaw skills');

  // profclaw skill list
  cmd
    .command('list')
    .alias('ls')
    .description('List all skills')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const spin = spinner('Fetching skills...').start();
      const result = await api.get<SkillListResponse>('/api/skills');
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to fetch skills');
        process.exit(1);
      }

      const { skills, stats } = result.data!;

      if (options.json) {
        console.log(JSON.stringify(result.data, null, 2));
        return;
      }

      if (skills.length === 0) {
        info('No skills found.');
        return;
      }

      const table = createTable(['Name', 'Enabled', 'Source', 'Description']);

      for (const s of skills) {
        const enabledDisplay = s.enabled
          ? chalk.green('✓ yes')
          : chalk.red('✗ no');

        table.push([
          s.name,
          enabledDisplay,
          s.source,
          truncate(s.description, 50),
        ]);
      }

      console.log(table.toString());
      const disabledCount = stats.total - stats.enabled;
      console.log(
        chalk.dim(
          `\n${stats.enabled} enabled, ${disabledCount} disabled, ${stats.total} total`
        )
      );
    });

  // profclaw skill info <name>
  cmd
    .command('info <name>')
    .description('Show detailed information about a skill')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: { json?: boolean }) => {
      const spin = spinner(`Fetching skill ${name}...`).start();
      const result = await api.get<Skill>(`/api/skills/${name}`);
      spin.stop();

      if (!result.ok) {
        error(result.error || `Skill not found: ${name}`);
        process.exit(1);
      }

      const skill = result.data!;

      if (options.json) {
        console.log(JSON.stringify(skill, null, 2));
        return;
      }

      const label = (text: string) => chalk.bold.white(text + ':');
      const val = (text: string | undefined | null) =>
        text ? text : chalk.dim('none');

      console.log('');
      console.log(`${label('Name')}         ${chalk.cyan(skill.name)}`);
      console.log(`${label('Description')}  ${val(skill.description)}`);
      console.log(
        `${label('Enabled')}      ${skill.enabled ? chalk.green('yes') : chalk.red('no')}`
      );
      console.log(`${label('Source')}       ${val(skill.source)}`);

      if (skill.eligible != null) {
        console.log(
          `${label('Eligible')}     ${skill.eligible ? chalk.green('yes') : chalk.yellow('no')}`
        );
      }

      if (skill.capabilities && skill.capabilities.length > 0) {
        console.log(`${label('Capabilities')} ${skill.capabilities.join(', ')}`);
      }

      if (skill.dependencies && skill.dependencies.length > 0) {
        console.log(`${label('Dependencies')} ${skill.dependencies.join(', ')}`);
      }

      if (skill.stats) {
        console.log('');
        console.log(chalk.bold.white('Stats:'));
        if (skill.stats.invocations != null) {
          console.log(`  Invocations: ${skill.stats.invocations}`);
        }
        if (skill.stats.avgDurationMs != null) {
          console.log(`  Avg duration: ${skill.stats.avgDurationMs}ms`);
        }
        if (skill.stats.lastUsed) {
          console.log(`  Last used: ${skill.stats.lastUsed}`);
        }
      }

      console.log('');
    });

  // profclaw skill enable <name>
  cmd
    .command('enable <name>')
    .description('Enable a skill')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: { json?: boolean }) => {
      const checkSpin = spinner(`Checking skill ${name}...`).start();
      const checkResult = await api.get<Skill>(`/api/skills/${name}`);
      checkSpin.stop();

      if (!checkResult.ok) {
        error(checkResult.error || `Skill not found: ${name}`);
        process.exit(1);
      }

      if (checkResult.data!.enabled) {
        info(`Skill ${chalk.cyan(name)} is already enabled`);
        return;
      }

      const spin = spinner(`Enabling ${name}...`).start();
      const result = await api.post<ToggleResponse>(`/api/skills/${name}/toggle`);
      spin.stop();

      if (!result.ok) {
        error(result.error || `Failed to enable ${name}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(result.data, null, 2));
        return;
      }

      success(`Skill ${chalk.cyan(name)} enabled`);
    });

  // profclaw skill disable <name>
  cmd
    .command('disable <name>')
    .description('Disable a skill')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: { json?: boolean }) => {
      const checkSpin = spinner(`Checking skill ${name}...`).start();
      const checkResult = await api.get<Skill>(`/api/skills/${name}`);
      checkSpin.stop();

      if (!checkResult.ok) {
        error(checkResult.error || `Skill not found: ${name}`);
        process.exit(1);
      }

      if (!checkResult.data!.enabled) {
        info(`Skill ${chalk.cyan(name)} is already disabled`);
        return;
      }

      const spin = spinner(`Disabling ${name}...`).start();
      const result = await api.post<ToggleResponse>(`/api/skills/${name}/toggle`);
      spin.stop();

      if (!result.ok) {
        error(result.error || `Failed to disable ${name}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(result.data, null, 2));
        return;
      }

      success(`Skill ${chalk.cyan(name)} disabled`);
    });

  // profclaw skill reload
  cmd
    .command('reload')
    .description('Reload all skills from disk')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const spin = spinner('Reloading skills...').start();
      const result = await api.post<ReloadResponse>('/api/skills/reload');
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to reload skills');
        process.exit(1);
      }

      const { message, stats } = result.data!;

      if (options.json) {
        console.log(JSON.stringify(result.data, null, 2));
        return;
      }

      success(message);
      console.log(
        chalk.dim(
          `${stats.loaded} loaded, ${stats.failed} failed, ${stats.total} total`
        )
      );
    });

  return cmd;
}
