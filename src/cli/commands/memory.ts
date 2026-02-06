import * as readline from 'readline';
import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import {
  createTable,
  success,
  error,
  warn,
  spinner,
  truncate,
  formatRelativeTime,
} from '../utils/output.js';

interface MemoryChunk {
  id: string;
  content: string;
  file: string;
  score: number;
}

interface SearchResponse {
  query: string;
  method: string;
  chunks: MemoryChunk[];
  totalCandidates: number;
}

interface StatsResponse {
  stats: {
    totalChunks: number;
    totalFiles: number;
    totalTokensEstimate?: number;
    embeddingModel?: string;
    cachedEmbeddings?: number;
    lastSyncAt?: string | null;
  };
}

interface SyncResponse {
  message: string;
  synced: number;
  added: number;
  updated: number;
  removed: number;
}

interface MemoryFile {
  path: string;
  chunkCount: number;
  lastModified: string;
}

interface FilesResponse {
  files: MemoryFile[];
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

export function memoryCommands(): Command {
  const cmd = new Command('memory').description('Manage memory index');

  // Search memory
  cmd
    .command('search <query>')
    .description('Search memory for relevant chunks')
    .option('-l, --limit <n>', 'Max results to return', '10')
    .option('--json', 'Output as JSON')
    .action(async (query: string, options: { limit: string; json?: boolean }) => {
      const spin = spinner('Searching memory...').start();
      const result = await api.post<SearchResponse>('/api/memory/search', {
        query,
        maxResults: parseInt(options.limit),
      });
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to search memory');
        process.exit(1);
      }

      const { chunks, totalCandidates } = result.data!;

      if (options.json) {
        console.log(JSON.stringify(result.data, null, 2));
        return;
      }

      if (chunks.length === 0) {
        console.log('No results found.');
        return;
      }

      const table = createTable(['Score', 'File', 'Content']);

      for (const chunk of chunks) {
        table.push([
          chalk.cyan(chunk.score.toFixed(3)),
          chalk.dim(truncate(chunk.file, 40)),
          truncate(chunk.content, 60),
        ]);
      }

      console.log(table.toString());
      console.log(`\nFound ${chunks.length} results from ${totalCandidates} candidates`);
    });

  // Memory stats
  cmd
    .command('stats')
    .description('Show memory index statistics')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const spin = spinner('Fetching memory stats...').start();
      const result = await api.get<StatsResponse>('/api/memory/stats');
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to fetch memory stats');
        process.exit(1);
      }

      const { stats } = result.data!;

      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }

      console.log(`\n${chalk.bold('Memory Index Stats')}`);
      console.log(`${chalk.dim('Chunks:')}      ${chalk.white(stats.totalChunks)}`);
      console.log(`${chalk.dim('Files:')}       ${chalk.white(stats.totalFiles)}`);
      console.log(`${chalk.dim('Tokens:')}      ${chalk.white(stats.totalTokensEstimate ?? 0)}`);
      if (stats.embeddingModel) {
        console.log(`${chalk.dim('Embedding:')}   ${chalk.white(stats.embeddingModel)}`);
      }
      if (stats.lastSyncAt) {
        console.log(`${chalk.dim('Last Sync:')}   ${chalk.white(stats.lastSyncAt)}`);
      }
    });

  // Sync memory
  cmd
    .command('sync')
    .description('Sync memory index from disk')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const spin = spinner('Syncing memory...').start();
      const result = await api.post<SyncResponse>('/api/memory/sync', {});
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to sync memory');
        process.exit(1);
      }

      const data = result.data!;

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      success(data.message);
      console.log(`  Added:   ${chalk.green(data.added)}`);
      console.log(`  Updated: ${chalk.yellow(data.updated)}`);
      console.log(`  Removed: ${chalk.red(data.removed)}`);
      console.log(`  Total:   ${chalk.white(data.synced)}`);
    });

  // List files
  cmd
    .command('files')
    .alias('ls')
    .description('List indexed memory files')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const spin = spinner('Fetching memory files...').start();
      const result = await api.get<FilesResponse>('/api/memory/files');
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to fetch memory files');
        process.exit(1);
      }

      const { files } = result.data!;

      if (options.json) {
        console.log(JSON.stringify(files, null, 2));
        return;
      }

      if (files.length === 0) {
        console.log('No files indexed.');
        return;
      }

      const table = createTable(['Path', 'Chunks', 'Last Modified']);

      for (const file of files) {
        table.push([
          file.path,
          String(file.chunkCount),
          formatRelativeTime(file.lastModified),
        ]);
      }

      console.log(table.toString());
    });

  // Clear memory
  cmd
    .command('clear')
    .description('Clear all memory')
    .option('--yes', 'Skip confirmation prompt')
    .option('--json', 'Output as JSON')
    .action(async (options: { yes?: boolean; json?: boolean }) => {
      if (!options.yes) {
        warn(chalk.red('This will permanently delete all memory chunks and the index.'));
        const confirmed = await confirm('Are you sure you want to clear all memory?');
        if (!confirmed) {
          console.log('Aborted.');
          return;
        }
      }

      const spin = spinner('Clearing memory...').start();
      const result = await api.delete('/api/memory/all');
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to clear memory');
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify({ ok: true }, null, 2));
        return;
      }

      success('Memory cleared.');
    });

  return cmd;
}
