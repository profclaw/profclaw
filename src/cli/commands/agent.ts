import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import { createTable, error, spinner, success } from '../utils/output.js';

interface Agent {
  type: string;
  name: string;
  description?: string;
  capabilities?: string[];
  healthy: boolean;
  stats?: {
    completed: number;
    failed: number;
    avgDuration: number;
  };
}

export function agentCommands() {
  const agent = new Command('agent')
    .description('Manage AI agents');

  // List agents
  agent
    .command('list')
    .alias('ls')
    .description('List available agents')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const spin = spinner('Fetching agents...').start();
      const result = await api.get<{ agents: Agent[] }>('/api/agents');
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to fetch agents');
        process.exit(1);
      }

      const { agents } = result.data!;

      if (options.json) {
        console.log(JSON.stringify(agents, null, 2));
        return;
      }

      if (agents.length === 0) {
        console.log('No agents configured.');
        console.log('\nConfigure agents in config/agents.yml');
        return;
      }

      const table = createTable(['Type', 'Name', 'Status', 'Completed', 'Failed']);

      for (const a of agents) {
        const status = a.healthy
          ? chalk.green('● Healthy')
          : chalk.red('● Unhealthy');

        table.push([
          a.type,
          a.name,
          status,
          String(a.stats?.completed || 0),
          String(a.stats?.failed || 0),
        ]);
      }

      console.log(table.toString());
    });

  // Check agent health
  agent
    .command('status')
    .alias('health')
    .description('Check agent health status')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const spin = spinner('Checking health...').start();
      const result = await api.get<any>('/health');
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Health check failed');
        process.exit(1);
      }

      const health = result.data!;

      if (options.json) {
        console.log(JSON.stringify(health, null, 2));
        return;
      }

      console.log(`\nGLINR Task Manager v${health.version}`);
      console.log(`Status: ${health.status === 'ok' ? chalk.green('OK') : chalk.red('ERROR')}`);
      console.log(`Timestamp: ${health.timestamp}`);

      if (health.agents) {
        console.log('\n### Agent Status');
        const table = createTable(['Agent', 'Status', 'Last Check']);

        for (const [agent, status] of Object.entries(health.agents) as [string, any][]) {
          const isHealthy = status.healthy !== false;
          table.push([
            agent,
            isHealthy ? chalk.green('Healthy') : chalk.red('Unhealthy'),
            status.lastCheck || '-',
          ]);
        }

        console.log(table.toString());
      }
    });

  // Show agent types
  agent
    .command('types')
    .description('List available agent types')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const spin = spinner('Fetching agent types...').start();
      const result = await api.get<{ types: string[] }>('/api/agents/types');
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to fetch agent types');
        process.exit(1);
      }

      const { types } = result.data!;

      if (options.json) {
        console.log(JSON.stringify(types, null, 2));
        return;
      }

      console.log('\nAvailable Agent Types:');
      for (const type of types) {
        console.log(`  - ${type}`);
      }
    });

  return agent;
}
