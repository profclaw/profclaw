import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import { spinner, success, error, info, warn, createTable, formatRelativeTime, truncate } from '../utils/output.js';

interface Webhook {
  id: string;
  url: string;
  secret?: string;
  enabled: boolean;
  createdAt: string;
  lastDeliveryAt?: string;
  deliveryCount?: number;
}

interface WebhooksResponse {
  webhooks: Webhook[];
}

interface WebhookDelivery {
  id: string;
  webhookId: string;
  status: number;
  duration?: number;
  createdAt: string;
  event: string;
}

interface DeliveryHistoryResponse {
  deliveries: WebhookDelivery[];
}

export function webhooksCommands(): Command {
  const cmd = new Command('webhooks')
    .description('Manage webhook endpoints');

  cmd
    .command('list')
    .alias('ls')
    .description('List configured webhooks')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const spin = spinner('Fetching webhooks...').start();
      try {
        const result = await api.get<WebhooksResponse>('/api/webhooks');
        spin.stop();
        if (!result.ok) { error(result.error || 'Failed to fetch webhooks'); process.exit(1); }
        const { webhooks } = result.data!;
        if (options.json) { console.log(JSON.stringify(webhooks, null, 2)); return; }
        if (webhooks.length === 0) { info('No webhooks configured.'); return; }
        const table = createTable(['ID', 'URL', 'Enabled', 'Deliveries', 'Last Delivery']);
        for (const w of webhooks) {
          table.push([
            chalk.dim(truncate(w.id, 12)),
            truncate(w.url, 40),
            w.enabled ? chalk.green('yes') : chalk.dim('no'),
            String(w.deliveryCount ?? 0),
            formatRelativeTime(w.lastDeliveryAt),
          ]);
        }
        console.log(table.toString());
        console.log(chalk.dim(`\n${webhooks.length} webhook${webhooks.length !== 1 ? 's' : ''}`));
      } catch (err) {
        spin.stop();
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  cmd
    .command('create <url>')
    .description('Create a new webhook')
    .option('--secret <secret>', 'Signing secret for payload verification')
    .option('--json', 'Output as JSON')
    .action(async (url: string, options: { secret?: string; json?: boolean }) => {
      const spin = spinner('Creating webhook...').start();
      try {
        const result = await api.post<Webhook>('/api/webhooks', { url, secret: options.secret });
        spin.stop();
        if (!result.ok) { error(result.error || 'Failed to create webhook'); process.exit(1); }
        if (options.json) { console.log(JSON.stringify(result.data, null, 2)); return; }
        const w = result.data!;
        success(`Webhook created`);
        console.log(chalk.dim(`  ID:  ${w.id}`));
        console.log(chalk.dim(`  URL: ${w.url}`));
      } catch (err) {
        spin.stop();
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  cmd
    .command('delete <id>')
    .description('Delete a webhook')
    .option('--yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: { yes?: boolean; json?: boolean }) => {
      if (!options.yes) {
        const { createInterface } = await import('readline');
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const confirmed = await new Promise<boolean>((resolve) => {
          rl.question(`Delete webhook ${id}? (y/N) `, (ans) => { rl.close(); resolve(ans.toLowerCase() === 'y'); });
        });
        if (!confirmed) { info('Aborted.'); return; }
      }
      const spin = spinner('Deleting webhook...').start();
      try {
        const result = await api.delete(`/api/webhooks/${id}`);
        spin.stop();
        if (!result.ok) { error(result.error || 'Failed to delete webhook'); process.exit(1); }
        if (options.json) { console.log(JSON.stringify({ ok: true, id }, null, 2)); return; }
        success(`Webhook ${id} deleted`);
      } catch (err) {
        spin.stop();
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  cmd
    .command('test <id>')
    .description('Send a test delivery to a webhook')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      const spin = spinner(`Sending test to webhook ${id}...`).start();
      try {
        const result = await api.post<{ status: number; ok: boolean }>(`/api/webhooks/${id}/test`);
        spin.stop();
        if (!result.ok) { error(result.error || 'Test delivery failed'); process.exit(1); }
        if (options.json) { console.log(JSON.stringify(result.data, null, 2)); return; }
        const data = result.data!;
        if (data.ok) {
          success(`Test delivery succeeded (HTTP ${data.status})`);
        } else {
          warn(`Test delivery returned HTTP ${data.status}`);
        }
      } catch (err) {
        spin.stop();
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  cmd
    .command('history <id>')
    .description('Show delivery history for a webhook')
    .option('-l, --limit <n>', 'Max deliveries to show', '20')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: { limit: string; json?: boolean }) => {
      const spin = spinner('Fetching delivery history...').start();
      try {
        const result = await api.get<DeliveryHistoryResponse>(
          `/api/webhooks/${id}/history?limit=${options.limit}`
        );
        spin.stop();
        if (!result.ok) { error(result.error || 'Failed to fetch history'); process.exit(1); }
        const { deliveries } = result.data!;
        if (options.json) { console.log(JSON.stringify(deliveries, null, 2)); return; }
        if (deliveries.length === 0) { info('No deliveries recorded.'); return; }
        const table = createTable(['ID', 'Event', 'Status', 'Duration', 'Time']);
        for (const d of deliveries) {
          const statusColor = d.status >= 200 && d.status < 300 ? chalk.green : chalk.red;
          table.push([
            chalk.dim(truncate(d.id, 12)),
            d.event,
            statusColor(String(d.status)),
            d.duration != null ? `${d.duration}ms` : chalk.dim('-'),
            formatRelativeTime(d.createdAt),
          ]);
        }
        console.log(table.toString());
      } catch (err) {
        spin.stop();
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  return cmd;
}
