import { Command } from 'commander';
import { api } from '../utils/api.js';
import {
  createTable,
  formatStatus,
  formatRelativeTime,
  truncate,
  success,
  error,
  spinner,
} from '../utils/output.js';

interface Task {
  id: string;
  title: string;
  status: string;
  priority: number;
  assignedAgent?: string;
  createdAt: string;
  updatedAt: string;
}

export function taskCommands() {
  const task = new Command('task')
    .description('Manage tasks');

  // List tasks
  task
    .command('list')
    .alias('ls')
    .description('List all tasks')
    .option('-s, --status <status>', 'Filter by status')
    .option('-l, --limit <n>', 'Limit results', '20')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const spin = spinner('Fetching tasks...').start();

      const params = new URLSearchParams();
      if (options.status) params.set('status', options.status);
      params.set('limit', options.limit);

      const result = await api.get<{ tasks: Task[]; count: number }>(
        `/api/tasks?${params}`
      );

      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to fetch tasks');
        process.exit(1);
      }

      const { tasks, count } = result.data!;

      if (options.json) {
        console.log(JSON.stringify(tasks, null, 2));
        return;
      }

      if (tasks.length === 0) {
        console.log('No tasks found.');
        return;
      }

      const table = createTable(['ID', 'Title', 'Status', 'Agent', 'Updated']);

      for (const t of tasks) {
        table.push([
          t.id.slice(0, 8),
          truncate(t.title, 40),
          formatStatus(t.status),
          t.assignedAgent || '-',
          formatRelativeTime(t.updatedAt),
        ]);
      }

      console.log(table.toString());
      console.log(`\nShowing ${tasks.length} of ${count} tasks`);
    });

  // Get task details
  task
    .command('show <id>')
    .alias('get')
    .description('Show task details')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      const spin = spinner('Fetching task...').start();
      const result = await api.get<{ task: Task }>(`/api/tasks/${id}`);
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to fetch task');
        process.exit(1);
      }

      const { task } = result.data!;

      if (options.json) {
        console.log(JSON.stringify(task, null, 2));
        return;
      }

      console.log(`\nTask: ${task.id}`);
      console.log(`Title: ${task.title}`);
      console.log(`Status: ${formatStatus(task.status)}`);
      console.log(`Priority: ${task.priority}`);
      console.log(`Agent: ${task.assignedAgent || 'Not assigned'}`);
      console.log(`Created: ${formatRelativeTime(task.createdAt)}`);
      console.log(`Updated: ${formatRelativeTime(task.updatedAt)}`);
    });

  // Create task
  task
    .command('create <title>')
    .description('Create a new task')
    .option('-d, --description <desc>', 'Task description')
    .option('-p, --priority <n>', 'Priority (1-5)', '3')
    .option('-a, --agent <agent>', 'Assign to agent')
    .option('--json', 'Output as JSON')
    .action(async (title, options) => {
      const spin = spinner('Creating task...').start();

      const result = await api.post<{ task: Task }>('/api/tasks', {
        title,
        description: options.description,
        prompt: options.description || title,
        priority: parseInt(options.priority),
        source: 'cli',
        assignedAgent: options.agent,
      });

      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to create task');
        process.exit(1);
      }

      const { task } = result.data!;

      if (options.json) {
        console.log(JSON.stringify(task, null, 2));
        return;
      }

      success(`Task created: ${task.id}`);
      console.log(`  Title: ${task.title}`);
      console.log(`  Status: ${formatStatus(task.status)}`);
    });

  // Cancel task
  task
    .command('cancel <id>')
    .description('Cancel a running or pending task')
    .action(async (id) => {
      const spin = spinner('Cancelling task...').start();
      const result = await api.post(`/api/tasks/${id}/cancel`);
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to cancel task');
        process.exit(1);
      }

      success(`Task ${id} cancelled`);
    });

  // Retry task
  task
    .command('retry <id>')
    .description('Retry a failed task')
    .action(async (id) => {
      const spin = spinner('Retrying task...').start();
      const result = await api.post<{ task: Task }>(`/api/tasks/${id}/retry`);
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to retry task');
        process.exit(1);
      }

      const { task } = result.data!;
      success(`Task queued for retry: ${task.id}`);
    });

  // Task status (quick status check)
  task
    .command('status [id]')
    .description('Check task status')
    .action(async (id) => {
      if (id) {
        const result = await api.get<{ task: Task }>(`/api/tasks/${id}`);
        if (!result.ok) {
          error(result.error || 'Task not found');
          process.exit(1);
        }
        console.log(formatStatus(result.data!.task.status));
      } else {
        // Show overall status summary
        const result = await api.get<{ tasks: Task[] }>('/api/tasks?limit=1000');
        if (!result.ok) {
          error(result.error || 'Failed to fetch tasks');
          process.exit(1);
        }

        const counts: Record<string, number> = {};
        for (const t of result.data!.tasks) {
          counts[t.status] = (counts[t.status] || 0) + 1;
        }

        const table = createTable(['Status', 'Count']);
        for (const [status, count] of Object.entries(counts)) {
          table.push([formatStatus(status), count.toString()]);
        }
        console.log(table.toString());
      }
    });

  return task;
}
