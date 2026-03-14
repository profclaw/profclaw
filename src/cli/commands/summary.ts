import { Command } from 'commander';
import { api } from '../utils/api.js';
import type { FileChange, SummaryStats } from '../../types/summary.js';
import {
  createTable,
  formatRelativeTime,
  truncate,
  error,
  spinner,
} from '../utils/output.js';

interface Summary {
  id: string;
  title: string;
  agent: string;
  taskType?: string;
  whatChanged: string;
  createdAt: string;
}

type SummaryDetails = Summary & {
  whyChanged?: string;
  howChanged?: string;
  filesChanged?: FileChange[];
};

export function summaryCommands() {
  const summary = new Command('summary')
    .description('Browse AI work summaries');

  // List summaries
  summary
    .command('list')
    .alias('ls')
    .description('List recent summaries')
    .option('-a, --agent <agent>', 'Filter by agent')
    .option('-l, --limit <n>', 'Limit results', '20')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const spin = spinner('Fetching summaries...').start();

      const params = new URLSearchParams();
      if (options.agent) params.set('agent', options.agent);
      params.set('limit', options.limit);

      const result = await api.get<{ summaries: Summary[] }>(
        `/api/summaries/recent?${params}`
      );

      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to fetch summaries');
        process.exit(1);
      }

      const { summaries } = result.data!;

      if (options.json) {
        console.log(JSON.stringify(summaries, null, 2));
        return;
      }

      if (summaries.length === 0) {
        console.log('No summaries found.');
        return;
      }

      const table = createTable(['ID', 'Title', 'Agent', 'Type', 'Created']);

      for (const s of summaries) {
        table.push([
          s.id.slice(0, 8),
          truncate(s.title, 35),
          s.agent,
          s.taskType || '-',
          formatRelativeTime(s.createdAt),
        ]);
      }

      console.log(table.toString());
    });

  // Show summary details
  summary
    .command('show <id>')
    .alias('get')
    .description('Show summary details')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      const spin = spinner('Fetching summary...').start();
      const result = await api.get<{ summary: SummaryDetails }>(`/api/summaries/${id}`);
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Summary not found');
        process.exit(1);
      }

      const { summary } = result.data!;

      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }

      console.log(`\n## ${summary.title}\n`);
      console.log(`Agent: ${summary.agent}`);
      console.log(`Type: ${summary.taskType || 'Unknown'}`);
      console.log(`Created: ${formatRelativeTime(summary.createdAt)}\n`);

      console.log('### What Changed');
      console.log(summary.whatChanged);

      if (summary.whyChanged) {
        console.log('\n### Why');
        console.log(summary.whyChanged);
      }

      if (summary.howChanged) {
        console.log('\n### How');
        console.log(summary.howChanged);
      }

      if (summary.filesChanged && summary.filesChanged.length > 0) {
        console.log('\n### Files Changed');
        for (const f of summary.filesChanged) {
          console.log(`  - ${typeof f === 'string' ? f : f.path}`);
        }
      }
    });

  // Search summaries
  summary
    .command('search <query>')
    .description('Search summaries')
    .option('-l, --limit <n>', 'Limit results', '10')
    .option('--json', 'Output as JSON')
    .action(async (query, options) => {
      const spin = spinner('Searching...').start();

      const params = new URLSearchParams();
      params.set('q', query);
      params.set('limit', options.limit);

      const result = await api.get<{ summaries: Summary[] }>(
        `/api/summaries/search?${params}`
      );

      spin.stop();

      if (!result.ok) {
        error(result.error || 'Search failed');
        process.exit(1);
      }

      const { summaries } = result.data!;

      if (options.json) {
        console.log(JSON.stringify(summaries, null, 2));
        return;
      }

      if (summaries.length === 0) {
        console.log(`No results for "${query}"`);
        return;
      }

      const table = createTable(['ID', 'Title', 'Agent', 'Created']);

      for (const s of summaries) {
        table.push([
          s.id.slice(0, 8),
          truncate(s.title, 40),
          s.agent,
          formatRelativeTime(s.createdAt),
        ]);
      }

      console.log(table.toString());
      console.log(`\nFound ${summaries.length} results for "${query}"`);
    });

  // Stats
  summary
    .command('stats')
    .description('Show summary statistics')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const spin = spinner('Fetching stats...').start();
      const result = await api.get<SummaryStats>('/api/summaries/stats');
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to fetch stats');
        process.exit(1);
      }

      const stats = result.data!;

      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }

      console.log('\n## Summary Statistics\n');
      console.log(`Total Summaries: ${stats.totalCount}`);
      console.log(`Total Tokens: ${stats.totalTokens?.toLocaleString() || 0}`);
      console.log(`Total Cost: $${(stats.totalCost || 0).toFixed(4)}`);
      console.log(`Files Changed: ${stats.filesChangedCount}`);

      if (stats.byAgent && Object.keys(stats.byAgent).length > 0) {
        console.log('\n### By Agent');
        const table = createTable(['Agent', 'Count']);
        for (const [agent, count] of Object.entries(stats.byAgent)) {
          table.push([agent, String(count)]);
        }
        console.log(table.toString());
      }
    });

  return summary;
}
