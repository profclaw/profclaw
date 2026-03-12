#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import figlet from 'figlet';
import { taskCommands } from './commands/task.js';
import { ticketCommands } from './commands/ticket.js';
import { summaryCommands } from './commands/summary.js';
import { agentCommands } from './commands/agent.js';
import { configCommands } from './commands/config.js';
import { costCommands } from './commands/cost.js';
import { serveCommand } from './commands/serve.js';
import { toolsCommands } from './commands/tools.js';
import { authCommands } from './commands/auth.js';
import { setupCommand } from './commands/setup.js';
import { onboardCommand } from './commands/onboard.js';
import { pluginCommands } from './commands/plugin.js';

const VERSION = '2.0.0';

// ASCII Banner
function showBanner(): void {
  const banner = figlet.textSync('profClaw', {
    font: 'Standard',
    horizontalLayout: 'default',
  });

  console.log(chalk.cyan(banner));
  console.log(chalk.dim('  AI Agent Task Orchestrator'));
  console.log(chalk.dim(`  Version ${VERSION}\n`));
}

// Create main program
const program = new Command();

program
  .name('profclaw')
  .description('profClaw - AI Agent Task Orchestration')
  .version(VERSION, '-v, --version', 'Output the current version')
  .option('--json', 'Output results as JSON')
  .option('-q, --quiet', 'Suppress non-essential output');

// Register command groups
program.addCommand(taskCommands());
program.addCommand(ticketCommands());
program.addCommand(summaryCommands());
program.addCommand(agentCommands());
program.addCommand(configCommands());
program.addCommand(costCommands());
program.addCommand(serveCommand());
program.addCommand(toolsCommands());
program.addCommand(authCommands());
program.addCommand(setupCommand());
program.addCommand(onboardCommand());
program.addCommand(pluginCommands());

// Default action (no command) - show banner and help
program.action(() => {
  showBanner();
  console.log(chalk.yellow('Quick Start:'));
  console.log('  profclaw onboard          Zero-to-running wizard (new users)');
  console.log('  profclaw setup            Configure AI provider, admin, etc.');
  console.log('  profclaw serve            Start the server');
  console.log('  profclaw task list        List all tasks');
  console.log('  profclaw ticket list      List AI-native tickets');
  console.log('  profclaw ticket create    Create a new ticket');
  console.log('  profclaw config get       View current settings');
  console.log('');
  console.log(chalk.yellow('Auth & Users:'));
  console.log('  profclaw auth invite      Generate invite codes');
  console.log('  profclaw auth list-users  List all users');
  console.log('  profclaw auth set-mode    Set registration mode');
  console.log('');
  console.log(chalk.yellow('Tool Testing:'));
  console.log('  profclaw tools list       List all execution tools');
  console.log('  profclaw tools run <cmd>  Execute a shell command');
  console.log('  profclaw tools sysinfo    Show system information');
  console.log('  profclaw tools git-status Show git status');
  console.log('');
  console.log(chalk.dim('Run `profclaw --help` for all commands'));
});

// Parse and execute
program.parse();
