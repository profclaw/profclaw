import * as readline from 'readline';
import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import {
  createTable,
  success,
  error,
  spinner,
  truncate,
  formatRelativeTime,
} from '../utils/output.js';

interface Conversation {
  id: string;
  title: string;
  presetId?: string;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
  model?: string;
  provider?: string;
}

interface Message {
  role: string;
  content: string;
  createdAt: string;
}

interface ConversationsResponse {
  conversations: Conversation[];
  total: number;
}

interface ConversationDetailResponse {
  conversation: Conversation;
  messages: Message[];
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

function colorRole(role: string): string {
  if (role === 'user') return chalk.green(role);
  if (role === 'assistant') return chalk.cyan(role);
  if (role === 'system') return chalk.yellow(role);
  return chalk.dim(role);
}

export function sessionCommands(): Command {
  const cmd = new Command('session').description('Manage chat sessions');

  // List sessions
  cmd
    .command('list')
    .alias('ls')
    .description('List chat sessions')
    .option('-l, --limit <n>', 'Max sessions to show', '20')
    .option('--json', 'Output as JSON')
    .action(async (options: { limit: string; json?: boolean }) => {
      const spin = spinner('Fetching sessions...').start();
      const result = await api.get<ConversationsResponse>(
        `/api/chat/conversations?limit=${options.limit}`
      );
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to fetch sessions');
        process.exit(1);
      }

      const { conversations } = result.data!;

      if (options.json) {
        console.log(JSON.stringify(conversations, null, 2));
        return;
      }

      if (conversations.length === 0) {
        console.log('No sessions found.');
        return;
      }

      const table = createTable(['ID', 'Title', 'Preset', 'Updated']);

      for (const conv of conversations) {
        table.push([
          chalk.dim(truncate(conv.id, 8)),
          truncate(conv.title || 'Untitled', 40),
          conv.presetId || conv.model || chalk.dim('-'),
          formatRelativeTime(conv.updatedAt),
        ]);
      }

      console.log(table.toString());
    });

  // Show session details
  cmd
    .command('show <id>')
    .description('Show session details and message preview')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      const spin = spinner('Fetching session...').start();
      const result = await api.get<ConversationDetailResponse>(
        `/api/chat/conversations/${id}`
      );
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to fetch session');
        process.exit(1);
      }

      const { conversation, messages } = result.data!;

      if (options.json) {
        console.log(JSON.stringify(result.data, null, 2));
        return;
      }

      console.log(`\n${chalk.bold('Session Details')}`);
      console.log(`${chalk.dim('ID:')}            ${conversation.id}`);
      console.log(`${chalk.dim('Title:')}         ${conversation.title || 'Untitled'}`);
      console.log(`${chalk.dim('Created:')}       ${formatRelativeTime(conversation.createdAt)}`);
      console.log(`${chalk.dim('Preset:')}        ${conversation.presetId || '-'}`);
      console.log(`${chalk.dim('Messages:')}      ${messages.length}`);

      if (messages.length > 0) {
        console.log(`\n${chalk.bold('Recent Messages')} ${chalk.dim('(last 5)')}`);
        const preview = messages.slice(-5);
        for (const msg of preview) {
          const role = colorRole(msg.role);
          const content = truncate(
            typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            100
          );
          console.log(`  ${role}: ${chalk.dim(content)}`);
        }
      }
    });

  // Kill (delete) a session
  cmd
    .command('kill <id>')
    .description('Delete a chat session')
    .option('--yes', 'Skip confirmation prompt')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: { yes?: boolean; json?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm(`Delete session ${id}?`);
        if (!confirmed) {
          console.log('Aborted.');
          return;
        }
      }

      const spin = spinner('Deleting session...').start();
      const result = await api.delete(`/api/chat/conversations/${id}`);
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to delete session');
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify({ ok: true, id }, null, 2));
        return;
      }

      success(`Session ${id} deleted.`);
    });

  // Clear all sessions
  cmd
    .command('clear')
    .description('Delete all chat sessions')
    .option('--yes', 'Skip confirmation prompt')
    .option('--json', 'Output as JSON')
    .action(async (options: { yes?: boolean; json?: boolean }) => {
      const fetchSpin = spinner('Fetching sessions...').start();
      const listResult = await api.get<ConversationsResponse>(
        '/api/chat/conversations?limit=1000'
      );
      fetchSpin.stop();

      if (!listResult.ok) {
        error(listResult.error || 'Failed to fetch sessions');
        process.exit(1);
      }

      const { conversations } = listResult.data!;

      if (conversations.length === 0) {
        console.log('No sessions to delete.');
        return;
      }

      if (!options.yes) {
        const confirmed = await confirm(
          `Delete all ${conversations.length} sessions?`
        );
        if (!confirmed) {
          console.log('Aborted.');
          return;
        }
      }

      const deleteSpin = spinner(`Deleting ${conversations.length} sessions...`).start();
      let deleted = 0;
      let failed = 0;

      for (const conv of conversations) {
        const result = await api.delete(`/api/chat/conversations/${conv.id}`);
        if (result.ok) {
          deleted++;
        } else {
          failed++;
        }
      }

      deleteSpin.stop();

      if (options.json) {
        console.log(JSON.stringify({ deleted, failed }, null, 2));
        return;
      }

      success(`Deleted ${deleted} session${deleted !== 1 ? 's' : ''}.`);
      if (failed > 0) {
        error(`Failed to delete ${failed} session${failed !== 1 ? 's' : ''}.`);
      }
    });

  return cmd;
}
