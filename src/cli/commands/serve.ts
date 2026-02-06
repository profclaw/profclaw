import { Command } from 'commander';
import chalk from 'chalk';
import figlet from 'figlet';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { existsSync } from 'fs';

export function serveCommand() {
  const serve = new Command('serve')
    .description('Start the GLINR API server')
    .option('-p, --port <port>', 'Port to listen on', '3000')
    .option('--no-cron', 'Disable cron jobs')
    .option('--dev', 'Run in development mode with watch')
    .action(async (options) => {
      // Show banner
      const banner = figlet.textSync('GLINR', { font: 'Standard' });
      console.log(chalk.cyan(banner));
      console.log(chalk.dim('  AI Agent Task Orchestrator\n'));

      // Set environment variables
      const env = {
        ...process.env,
        PORT: options.port,
        ENABLE_CRON: options.cron === false ? 'false' : 'true',
      };

      // Determine the project root (look for package.json)
      const projectRoot = process.cwd();
      let command: string;
      let args: string[];

      if (options.dev) {
        console.log(chalk.blue('Starting in development mode with watch...\n'));
        command = 'npx';
        args = ['tsx', 'watch', 'src/server.ts'];
      } else {
        // Check if we're running from a built version
        const hasDistServer = existsSync(resolve(projectRoot, 'dist/server.js'));
        if (hasDistServer) {
          command = 'node';
          args = [resolve(projectRoot, 'dist/server.js')];
        } else {
          command = 'npx';
          args = ['tsx', 'src/server.ts'];
        }
        console.log(chalk.blue(`Starting server on port ${options.port}...\n`));
      }

      // Spawn the server process
      const child = spawn(command, args, {
        cwd: projectRoot,
        env,
        stdio: 'inherit',
      });

      // Handle signals
      process.on('SIGINT', () => {
        child.kill('SIGINT');
      });

      process.on('SIGTERM', () => {
        child.kill('SIGTERM');
      });

      child.on('exit', (code) => {
        process.exit(code || 0);
      });
    });

  return serve;
}
