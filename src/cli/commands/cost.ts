import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import { createTable, error, spinner, formatCost, formatTokens } from '../utils/output.js';

export function costCommands() {
  const cost = new Command('cost')
    .description('View cost analytics');

  // Cost summary
  cost
    .command('summary')
    .alias('sum')
    .description('Show cost summary')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const spin = spinner('Fetching cost data...').start();
      const result = await api.get<any>('/api/costs/summary');
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to fetch cost data');
        process.exit(1);
      }

      const data = result.data!;

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      console.log('\n## Cost Summary\n');
      console.log(`Total Cost:   ${formatCost(data.totalCost || 0)}`);
      console.log(`Total Tokens: ${formatTokens(data.totalTokens || 0)}`);
      console.log(`Task Count:   ${data.taskCount || 0}`);

      if (data.daily && Object.keys(data.daily).length > 0) {
        console.log('\n### Daily Breakdown');
        const table = createTable(['Date', 'Cost', 'Tokens']);
        for (const day of Object.entries(data.daily).slice(-7)) {
          const [date, info] = day as [string, { cost: number; tokens: number }];
          table.push([date, formatCost(info.cost), formatTokens(info.tokens)]);
        }
        console.log(table.toString());
      }
    });

  // Budget status
  cost
    .command('budget')
    .description('Show budget status')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const spin = spinner('Fetching budget...').start();
      const result = await api.get<any>('/api/costs/budget');
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to fetch budget');
        process.exit(1);
      }

      const budget = result.data!;

      if (options.json) {
        console.log(JSON.stringify(budget, null, 2));
        return;
      }

      console.log('\n## Budget Status\n');

      const spent = budget.spent || 0;
      const limit = budget.limit || 0;
      const percentage = budget.percentage || 0;

      console.log(`Spent:     ${formatCost(spent)}`);
      console.log(`Limit:     ${formatCost(limit)}`);
      console.log(`Remaining: ${formatCost(budget.remaining || 0)}`);
      console.log('');

      // Progress bar
      const barWidth = 40;
      const filledWidth = Math.min(Math.round((percentage / 100) * barWidth), barWidth);
      const emptyWidth = barWidth - filledWidth;

      let barColor = chalk.green;
      if (percentage >= 80) barColor = chalk.red;
      else if (percentage >= 50) barColor = chalk.yellow;

      const progressBar = barColor('█'.repeat(filledWidth)) + chalk.dim('░'.repeat(emptyWidth));
      console.log(`[${progressBar}] ${percentage.toFixed(0)}%`);

      if (budget.status === 'exceeded') {
        console.log(chalk.red('\n⚠ Budget exceeded!'));
      } else if (budget.status === 'warning') {
        console.log(chalk.yellow('\n⚠ Approaching budget limit'));
      }
    });

  // Analytics
  cost
    .command('analytics')
    .alias('stats')
    .description('Show detailed cost analytics')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const spin = spinner('Fetching analytics...').start();
      const result = await api.get<any>('/api/costs/analytics');
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to fetch analytics');
        process.exit(1);
      }

      const data = result.data!;

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      console.log('\n## Cost Analytics\n');
      console.log(`Total Cost:   ${formatCost(data.totalCost || 0)}`);
      console.log(`Total Tokens: ${formatTokens(data.totalTokens || 0)}`);

      if (data.byModel && Object.keys(data.byModel).length > 0) {
        console.log('\n### By Model');
        const table = createTable(['Model', 'Cost', 'Tokens']);
        for (const [model, info] of Object.entries(data.byModel) as [string, any][]) {
          table.push([model, formatCost(info.cost), formatTokens(info.tokens)]);
        }
        console.log(table.toString());
      }

      if (data.byAgent && Object.keys(data.byAgent).length > 0) {
        console.log('\n### By Agent');
        const table = createTable(['Agent', 'Cost', 'Tokens']);
        for (const [agent, info] of Object.entries(data.byAgent) as [string, any][]) {
          table.push([agent, formatCost(info.cost), formatTokens(info.tokens)]);
        }
        console.log(table.toString());
      }

      if (data.daily && data.daily.length > 0) {
        console.log('\n### Daily (Last 7 Days)');
        const table = createTable(['Date', 'Cost', 'Tokens']);
        for (const day of data.daily.slice(-7)) {
          table.push([day.date, formatCost(day.cost), formatTokens(day.tokens)]);
        }
        console.log(table.toString());
      }
    });

  return cost;
}
