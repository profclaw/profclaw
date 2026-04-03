import { Command } from 'commander';
import chalk from 'chalk';
import { TranscriptStore } from '../../agents/transcript.js';
import {
  createTable,
  error,
  formatRelativeTime,
  truncate,
} from '../utils/output.js';

function getStore(): TranscriptStore {
  return new TranscriptStore(process.cwd());
}

export function historyCommands(): Command {
  const cmd = new Command('history').description('View and search conversation history');

  // -------------------------------------------------------------------
  // profclaw history
  // -------------------------------------------------------------------
  cmd
    .command('list', { isDefault: true })
    .alias('ls')
    .description('List recent conversation sessions')
    .option('-l, --limit <n>', 'Max sessions to show', '20')
    .option('--offset <n>', 'Skip first N sessions', '0')
    .option('--json', 'Output as JSON')
    .action(async (options: { limit: string; offset: string; json?: boolean }) => {
      const store = getStore();
      const sessions = store.listSessions({
        limit: parseInt(options.limit, 10),
        offset: parseInt(options.offset, 10),
      });

      if (options.json) {
        console.log(JSON.stringify(sessions, null, 2));
        return;
      }

      if (sessions.length === 0) {
        console.log(chalk.dim('No sessions found.'));
        return;
      }

      const table = createTable(['Session ID', 'Title', 'Messages', 'Tokens', 'Last Active']);

      for (const s of sessions) {
        table.push([
          chalk.dim(s.sessionId.slice(0, 12)),
          truncate(s.title, 40),
          String(s.messageCount),
          chalk.dim(String(s.tokensUsed)),
          formatRelativeTime(new Date(s.lastActivityAt)),
        ]);
      }

      console.log(`\n${chalk.bold('Conversation History')}`);
      console.log(table.toString());
      console.log(chalk.dim(`\nShowing ${sessions.length} session(s)`));
    });

  // -------------------------------------------------------------------
  // profclaw history search <query>
  // -------------------------------------------------------------------
  cmd
    .command('search <query>')
    .description('Search across all transcript entries')
    .option('-s, --session <sessionId>', 'Restrict search to a specific session')
    .option('-l, --limit <n>', 'Max results to return', '20')
    .option('--json', 'Output as JSON')
    .action(
      async (
        query: string,
        options: { session?: string; limit: string; json?: boolean },
      ) => {
        const store = getStore();
        const results = store.search(query, {
          sessionId: options.session,
          limit: parseInt(options.limit, 10),
        });

        if (options.json) {
          console.log(JSON.stringify(results, null, 2));
          return;
        }

        if (results.length === 0) {
          console.log(chalk.dim(`No matches found for "${query}".`));
          return;
        }

        const table = createTable(['Session', 'Line', 'Type', 'Content']);

        for (const r of results) {
          table.push([
            chalk.dim(r.sessionId.slice(0, 12)),
            chalk.dim(String(r.lineNumber)),
            chalk.cyan(r.entry.type),
            truncate(r.entry.content, 60),
          ]);
        }

        console.log(`\n${chalk.bold(`Search results for "${query}"`)}`);
        console.log(table.toString());
        console.log(chalk.dim(`\nFound ${results.length} match(es)`));
      },
    );

  // -------------------------------------------------------------------
  // profclaw history show <sessionId>
  // -------------------------------------------------------------------
  cmd
    .command('show <sessionId>')
    .description('Show the full transcript for a session')
    .option('--json', 'Output as JSON')
    .option('--no-color', 'Disable color output')
    .action(async (sessionId: string, options: { json?: boolean; color: boolean }) => {
      const store = getStore();
      const entries = store.getSession(sessionId);

      if (entries.length === 0) {
        error(`No transcript found for session: ${sessionId}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(entries, null, 2));
        return;
      }

      console.log(`\n${chalk.bold('Transcript')} ${chalk.dim(sessionId)}\n`);

      for (const entry of entries) {
        const ts = new Date(entry.timestamp).toLocaleTimeString();
        const label = entryLabel(entry.type);

        console.log(`${chalk.dim(ts)} ${label}`);
        console.log(chalk.white(entry.content));

        if (entry.metadata?.toolName) {
          console.log(chalk.dim(`  tool: ${entry.metadata.toolName}`));
        }
        if (entry.metadata?.tokensUsed) {
          console.log(chalk.dim(`  tokens: ${entry.metadata.tokensUsed}`));
        }

        console.log();
      }
    });

  return cmd;
}

function entryLabel(type: string): string {
  switch (type) {
    case 'user':
      return chalk.green('> User');
    case 'assistant':
      return chalk.blue('~ Assistant');
    case 'tool_call':
      return chalk.yellow('# Tool Call');
    case 'tool_result':
      return chalk.yellow('# Tool Result');
    case 'system':
      return chalk.dim('* System');
    case 'error':
      return chalk.red('! Error');
    default:
      return chalk.dim(type);
  }
}
