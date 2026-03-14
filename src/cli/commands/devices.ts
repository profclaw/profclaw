import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import { spinner, success, error, info, createTable, formatRelativeTime, truncate } from '../utils/output.js';

interface Device {
  id: string;
  name: string;
  platform: string;
  paired: boolean;
  lastSeen?: string;
  version?: string;
}

interface DevicesResponse {
  devices: Device[];
}

interface PairResponse {
  device: Device;
}

export function devicesCommands(): Command {
  const cmd = new Command('devices')
    .description('Manage paired devices');

  cmd
    .command('list')
    .alias('ls')
    .description('List paired devices')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const spin = spinner('Fetching devices...').start();
      try {
        const result = await api.get<DevicesResponse>('/api/devices');
        spin.stop();
        if (!result.ok) { error(result.error || 'Failed to fetch devices'); process.exit(1); }
        const { devices } = result.data!;
        if (options.json) { console.log(JSON.stringify(devices, null, 2)); return; }
        if (devices.length === 0) { info('No paired devices.'); return; }
        const table = createTable(['ID', 'Name', 'Platform', 'Version', 'Last Seen']);
        for (const d of devices) {
          table.push([
            chalk.dim(truncate(d.id, 12)),
            d.name,
            d.platform || chalk.dim('-'),
            d.version || chalk.dim('-'),
            formatRelativeTime(d.lastSeen),
          ]);
        }
        console.log(table.toString());
        console.log(chalk.dim(`\n${devices.length} device${devices.length !== 1 ? 's' : ''}`));
      } catch (err) {
        spin.stop();
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  cmd
    .command('pair <code>')
    .description('Pair a device using a pairing code')
    .option('--json', 'Output as JSON')
    .action(async (code: string, options: { json?: boolean }) => {
      const spin = spinner(`Pairing device with code ${code}...`).start();
      try {
        const result = await api.post<PairResponse>('/api/devices/pair', { code });
        spin.stop();
        if (!result.ok) { error(result.error || 'Pairing failed'); process.exit(1); }
        if (options.json) { console.log(JSON.stringify(result.data, null, 2)); return; }
        const device = result.data!.device;
        success(`Device paired: ${chalk.cyan(device.name)}`);
        console.log(chalk.dim(`  ID: ${device.id}`));
        console.log(chalk.dim(`  Platform: ${device.platform}`));
      } catch (err) {
        spin.stop();
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  cmd
    .command('unpair <id>')
    .description('Unpair a device by ID')
    .option('--yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: { yes?: boolean; json?: boolean }) => {
      if (!options.yes) {
        const { createInterface } = await import('readline');
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const confirmed = await new Promise<boolean>((resolve) => {
          rl.question(`Unpair device ${id}? (y/N) `, (ans) => { rl.close(); resolve(ans.toLowerCase() === 'y'); });
        });
        if (!confirmed) { info('Aborted.'); return; }
      }
      const spin = spinner(`Unpairing device ${id}...`).start();
      try {
        const result = await api.delete(`/api/devices/${id}`);
        spin.stop();
        if (!result.ok) { error(result.error || 'Failed to unpair device'); process.exit(1); }
        if (options.json) { console.log(JSON.stringify({ ok: true, id }, null, 2)); return; }
        success(`Device ${id} unpaired`);
      } catch (err) {
        spin.stop();
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  cmd
    .command('info <id>')
    .description('Show device details')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      const spin = spinner('Fetching device info...').start();
      try {
        const result = await api.get<Device>(`/api/devices/${id}`);
        spin.stop();
        if (!result.ok) { error(result.error || 'Failed to fetch device'); process.exit(1); }
        const d = result.data!;
        if (options.json) { console.log(JSON.stringify(d, null, 2)); return; }
        console.log(`\n${chalk.bold('Device Info')}`);
        console.log(`  ${chalk.dim('ID:')}       ${d.id}`);
        console.log(`  ${chalk.dim('Name:')}     ${d.name}`);
        console.log(`  ${chalk.dim('Platform:')} ${d.platform || '-'}`);
        console.log(`  ${chalk.dim('Version:')}  ${d.version || '-'}`);
        console.log(`  ${chalk.dim('Paired:')}   ${d.paired ? chalk.green('yes') : chalk.red('no')}`);
        console.log(`  ${chalk.dim('Last Seen:')} ${formatRelativeTime(d.lastSeen)}`);
        console.log();
      } catch (err) {
        spin.stop();
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  return cmd;
}
