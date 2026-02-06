import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import {
  createTable,
  formatRelativeTime,
  truncate,
  success,
  error,
  spinner,
  info,
} from '../utils/output.js';

// === Types (matching src/tickets/types.ts) ===

interface Ticket {
  id: string;
  sequence: number;
  title: string;
  description?: string;
  type: string;
  priority: string;
  status: string;
  labels: string[];
  assignee?: string;
  assigneeAgent?: string;
  parentId?: string;
  createdAt: string;
  updatedAt: string;
  dueDate?: string;
  createdBy: string;
  aiAgent?: string;
}

interface TicketComment {
  id: string;
  ticketId: string;
  content: string;
  author: {
    type: string;
    name: string;
    platform: string;
  };
  createdAt: string;
}

interface ExternalLink {
  id: string;
  platform: string;
  externalId: string;
  externalUrl?: string;
  syncEnabled: boolean;
}

// === Formatting Helpers ===

const priorityColors: Record<string, (s: string) => string> = {
  critical: chalk.red,
  high: chalk.yellow,
  medium: chalk.blue,
  low: chalk.dim,
  none: chalk.gray,
};

const statusColors: Record<string, (s: string) => string> = {
  backlog: chalk.gray,
  todo: chalk.yellow,
  in_progress: chalk.cyan,
  in_review: chalk.magenta,
  done: chalk.green,
  cancelled: chalk.dim,
};

const typeIcons: Record<string, string> = {
  task: '📋',
  bug: '🐛',
  feature: '✨',
  epic: '🏔️',
  story: '📖',
  subtask: '📌',
};

function formatTicketStatus(status: string): string {
  const colorFn = statusColors[status] || chalk.white;
  return colorFn(status.replace('_', ' ').toUpperCase());
}

function formatPriority(priority: string): string {
  const colorFn = priorityColors[priority] || chalk.white;
  return colorFn(priority.toUpperCase());
}

function formatType(type: string): string {
  const icon = typeIcons[type] || '📋';
  return `${icon} ${type}`;
}

function formatSequenceId(sequence: number): string {
  return chalk.cyan(`GLINR-${sequence}`);
}

// === CLI Commands ===

export function ticketCommands() {
  const ticket = new Command('ticket')
    .description('Manage AI-native tickets')
    .alias('tkt');

  // List tickets
  ticket
    .command('list')
    .alias('ls')
    .description('List all tickets')
    .option('-s, --status <status>', 'Filter by status (backlog,todo,in_progress,in_review,done,cancelled)')
    .option('-t, --type <type>', 'Filter by type (task,bug,feature,epic,story,subtask)')
    .option('-p, --priority <priority>', 'Filter by priority (critical,high,medium,low,none)')
    .option('-a, --agent <agent>', 'Filter by assigned agent')
    .option('--search <term>', 'Search in title/description')
    .option('-l, --limit <n>', 'Limit results', '20')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const spin = spinner('Fetching tickets...').start();

      const params = new URLSearchParams();
      if (options.status) params.set('status', options.status);
      if (options.type) params.set('type', options.type);
      if (options.priority) params.set('priority', options.priority);
      if (options.agent) params.set('assigneeAgent', options.agent);
      if (options.search) params.set('search', options.search);
      params.set('limit', options.limit);

      const result = await api.get<{ tickets: Ticket[]; total: number }>(
        `/api/tickets?${params}`
      );

      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to fetch tickets');
        process.exit(1);
      }

      const { tickets, total } = result.data!;

      if (options.json) {
        console.log(JSON.stringify(tickets, null, 2));
        return;
      }

      if (tickets.length === 0) {
        console.log('No tickets found.');
        return;
      }

      const table = createTable(['ID', 'Title', 'Type', 'Status', 'Priority', 'Agent', 'Updated']);

      for (const t of tickets) {
        table.push([
          formatSequenceId(t.sequence),
          truncate(t.title, 35),
          formatType(t.type),
          formatTicketStatus(t.status),
          formatPriority(t.priority),
          t.assigneeAgent || chalk.dim('-'),
          formatRelativeTime(t.updatedAt),
        ]);
      }

      console.log(table.toString());
      console.log(`\nShowing ${tickets.length} of ${total} tickets`);
    });

  // Get ticket details
  ticket
    .command('show <id>')
    .alias('get')
    .description('Show ticket details')
    .option('--comments', 'Include comments')
    .option('--links', 'Include external links')
    .option('--history', 'Include history')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      const spin = spinner('Fetching ticket...').start();

      const include = [];
      if (options.comments) include.push('comments');
      if (options.links) include.push('links');
      if (options.history) include.push('history');

      const query = include.length ? `?include=${include.join(',')}` : '';
      const result = await api.get<{ ticket: Ticket & { comments?: TicketComment[]; externalLinks?: ExternalLink[] } }>(
        `/api/tickets/${id}${query}`
      );

      spin.stop();

      if (!result.ok) {
        error(result.error || 'Ticket not found');
        process.exit(1);
      }

      const { ticket: t } = result.data!;

      if (options.json) {
        console.log(JSON.stringify(t, null, 2));
        return;
      }

      console.log('');
      console.log(chalk.bold(`${formatSequenceId(t.sequence)} - ${t.title}`));
      console.log(chalk.dim('─'.repeat(50)));
      console.log(`Type:     ${formatType(t.type)}`);
      console.log(`Status:   ${formatTicketStatus(t.status)}`);
      console.log(`Priority: ${formatPriority(t.priority)}`);
      console.log(`Agent:    ${t.assigneeAgent || chalk.dim('Not assigned')}`);
      console.log(`Created:  ${formatRelativeTime(t.createdAt)} by ${t.createdBy}`);
      console.log(`Updated:  ${formatRelativeTime(t.updatedAt)}`);

      if (t.labels.length > 0) {
        console.log(`Labels:   ${t.labels.map(l => chalk.bgGray(` ${l} `)).join(' ')}`);
      }

      if (t.dueDate) {
        console.log(`Due:      ${new Date(t.dueDate).toLocaleDateString()}`);
      }

      if (t.description) {
        console.log('');
        console.log(chalk.bold('Description:'));
        console.log(t.description);
      }

      // Show comments if requested
      if (options.comments && t.comments && t.comments.length > 0) {
        console.log('');
        console.log(chalk.bold('Comments:'));
        for (const c of t.comments) {
          const authorColor = c.author.type === 'ai' ? chalk.cyan : chalk.green;
          console.log(`  ${authorColor(c.author.name)} (${formatRelativeTime(c.createdAt)}):`);
          console.log(`    ${c.content.split('\n').join('\n    ')}`);
        }
      }

      // Show external links if requested
      if (options.links && t.externalLinks && t.externalLinks.length > 0) {
        console.log('');
        console.log(chalk.bold('External Links:'));
        for (const link of t.externalLinks) {
          const syncIcon = link.syncEnabled ? chalk.green('↔') : chalk.dim('⏸');
          console.log(`  ${syncIcon} ${chalk.bold(link.platform)}: ${link.externalId}`);
          if (link.externalUrl) {
            console.log(`    ${chalk.dim(link.externalUrl)}`);
          }
        }
      }
    });

  // Create ticket
  ticket
    .command('create <title>')
    .description('Create a new ticket')
    .option('-d, --description <desc>', 'Ticket description')
    .option('-t, --type <type>', 'Ticket type (task,bug,feature,epic,story,subtask)', 'task')
    .option('-p, --priority <priority>', 'Priority (critical,high,medium,low,none)', 'medium')
    .option('-s, --status <status>', 'Initial status', 'backlog')
    .option('-a, --agent <agent>', 'Assign to AI agent')
    .option('-l, --labels <labels>', 'Comma-separated labels')
    .option('--parent <id>', 'Parent ticket ID (for subtasks)')
    .option('--json', 'Output as JSON')
    .action(async (title, options) => {
      const spin = spinner('Creating ticket...').start();

      const result = await api.post<{ ticket: Ticket }>('/api/tickets', {
        title,
        description: options.description,
        type: options.type,
        priority: options.priority,
        status: options.status,
        assigneeAgent: options.agent,
        labels: options.labels ? options.labels.split(',').map((l: string) => l.trim()) : [],
        parentId: options.parent,
        createdBy: 'human',
      });

      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to create ticket');
        process.exit(1);
      }

      const { ticket: t } = result.data!;

      if (options.json) {
        console.log(JSON.stringify(t, null, 2));
        return;
      }

      success(`Ticket created: ${formatSequenceId(t.sequence)}`);
      console.log(`  Title:    ${t.title}`);
      console.log(`  Type:     ${formatType(t.type)}`);
      console.log(`  Status:   ${formatTicketStatus(t.status)}`);
      console.log(`  Priority: ${formatPriority(t.priority)}`);
    });

  // Update ticket
  ticket
    .command('update <id>')
    .description('Update a ticket')
    .option('-t, --title <title>', 'New title')
    .option('-d, --description <desc>', 'New description')
    .option('--type <type>', 'New type')
    .option('-p, --priority <priority>', 'New priority')
    .option('-a, --agent <agent>', 'Assign to AI agent')
    .option('-l, --labels <labels>', 'New labels (comma-separated)')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      const updates: Record<string, unknown> = {};
      if (options.title) updates.title = options.title;
      if (options.description) updates.description = options.description;
      if (options.type) updates.type = options.type;
      if (options.priority) updates.priority = options.priority;
      if (options.agent) updates.assigneeAgent = options.agent;
      if (options.labels) updates.labels = options.labels.split(',').map((l: string) => l.trim());

      if (Object.keys(updates).length === 0) {
        error('No updates specified. Use --help to see options.');
        process.exit(1);
      }

      const spin = spinner('Updating ticket...').start();
      const result = await api.patch<{ ticket: Ticket }>(`/api/tickets/${id}`, updates);
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to update ticket');
        process.exit(1);
      }

      const { ticket: t } = result.data!;

      if (options.json) {
        console.log(JSON.stringify(t, null, 2));
        return;
      }

      success(`Ticket ${formatSequenceId(t.sequence)} updated`);
    });

  // Transition status
  ticket
    .command('transition <id> <status>')
    .alias('move')
    .description('Change ticket status (backlog,todo,in_progress,in_review,done,cancelled)')
    .option('--json', 'Output as JSON')
    .action(async (id, status, options) => {
      const validStatuses = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'];
      if (!validStatuses.includes(status)) {
        error(`Invalid status: ${status}. Valid: ${validStatuses.join(', ')}`);
        process.exit(1);
      }

      const spin = spinner(`Moving ticket to ${status}...`).start();
      const result = await api.post<{ ticket: Ticket }>(`/api/tickets/${id}/transition`, { status });
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to transition ticket');
        process.exit(1);
      }

      const { ticket: t } = result.data!;

      if (options.json) {
        console.log(JSON.stringify(t, null, 2));
        return;
      }

      success(`Ticket ${formatSequenceId(t.sequence)} moved to ${formatTicketStatus(status)}`);
    });

  // Assign to agent
  ticket
    .command('assign <id> <agent>')
    .description('Assign ticket to an AI agent')
    .action(async (id, agent) => {
      const spin = spinner(`Assigning to ${agent}...`).start();
      const result = await api.post<{ ticket: Ticket }>(`/api/tickets/${id}/assign-agent`, { agent });
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to assign ticket');
        process.exit(1);
      }

      const { ticket: t } = result.data!;
      success(`Ticket ${formatSequenceId(t.sequence)} assigned to ${chalk.cyan(agent)}`);
    });

  // Add comment
  ticket
    .command('comment <id> <content>')
    .description('Add a comment to a ticket')
    .option('--json', 'Output as JSON')
    .action(async (id, content, options) => {
      const spin = spinner('Adding comment...').start();
      const result = await api.post<{ comment: TicketComment }>(`/api/tickets/${id}/comments`, {
        content,
        authorName: 'CLI User',
        authorType: 'human',
      });
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to add comment');
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(result.data!.comment, null, 2));
        return;
      }

      success('Comment added');
    });

  // Link to external platform
  ticket
    .command('link <id> <platform> <external-id>')
    .description('Link ticket to external platform (github,linear,jira,plane)')
    .option('-u, --url <url>', 'External URL')
    .option('--json', 'Output as JSON')
    .action(async (id, platform, externalId, options) => {
      const validPlatforms = ['github', 'linear', 'jira', 'plane', 'monday'];
      if (!validPlatforms.includes(platform)) {
        error(`Invalid platform: ${platform}. Valid: ${validPlatforms.join(', ')}`);
        process.exit(1);
      }

      const spin = spinner(`Linking to ${platform}...`).start();
      const result = await api.post<{ link: ExternalLink }>(`/api/tickets/${id}/links`, {
        platform,
        externalId,
        externalUrl: options.url,
      });
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to create link');
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(result.data!.link, null, 2));
        return;
      }

      success(`Linked to ${chalk.bold(platform)}: ${externalId}`);
    });

  // Delete ticket
  ticket
    .command('delete <id>')
    .alias('rm')
    .description('Delete a ticket')
    .option('-f, --force', 'Skip confirmation')
    .action(async (id, options) => {
      if (!options.force) {
        info(`To confirm deletion, run: glinr ticket delete ${id} --force`);
        return;
      }

      const spin = spinner('Deleting ticket...').start();
      const result = await api.delete(`/api/tickets/${id}`);
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to delete ticket');
        process.exit(1);
      }

      success(`Ticket ${id} deleted`);
    });

  // Quick status overview
  ticket
    .command('status')
    .description('Show ticket status overview')
    .action(async () => {
      const spin = spinner('Fetching status...').start();
      const result = await api.get<{ tickets: Ticket[] }>('/api/tickets?limit=1000');
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to fetch tickets');
        process.exit(1);
      }

      const counts: Record<string, number> = {};
      const byType: Record<string, number> = {};
      const byAgent: Record<string, number> = {};

      for (const t of result.data!.tickets) {
        counts[t.status] = (counts[t.status] || 0) + 1;
        byType[t.type] = (byType[t.type] || 0) + 1;
        if (t.assigneeAgent) {
          byAgent[t.assigneeAgent] = (byAgent[t.assigneeAgent] || 0) + 1;
        }
      }

      console.log(chalk.bold('\nBy Status:'));
      const statusTable = createTable(['Status', 'Count']);
      for (const [status, count] of Object.entries(counts)) {
        statusTable.push([formatTicketStatus(status), count.toString()]);
      }
      console.log(statusTable.toString());

      console.log(chalk.bold('\nBy Type:'));
      const typeTable = createTable(['Type', 'Count']);
      for (const [type, count] of Object.entries(byType)) {
        typeTable.push([formatType(type), count.toString()]);
      }
      console.log(typeTable.toString());

      if (Object.keys(byAgent).length > 0) {
        console.log(chalk.bold('\nBy Agent:'));
        const agentTable = createTable(['Agent', 'Tickets']);
        for (const [agent, count] of Object.entries(byAgent)) {
          agentTable.push([chalk.cyan(agent), count.toString()]);
        }
        console.log(agentTable.toString());
      }

      console.log(`\n${chalk.bold('Total:')} ${result.data!.tickets.length} tickets`);
    });

  return ticket;
}
