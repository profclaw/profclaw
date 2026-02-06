import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import { spinner, success, error, info, createTable, formatRelativeTime, truncate } from '../utils/output.js';

type PolicyLevel = 'permissive' | 'standard' | 'strict';

interface SecurityStatus {
  policy: PolicyLevel;
  pendingApprovals: number;
  lastAudit?: string;
}

interface AuditEntry {
  id: string;
  action: string;
  actor: string;
  target: string;
  result: 'approved' | 'denied' | 'pending';
  createdAt: string;
}

interface AuditResponse {
  entries: AuditEntry[];
}

interface ApprovalItem {
  id: string;
  action: string;
  requestedBy: string;
  description: string;
  createdAt: string;
}

const VALID_POLICIES: PolicyLevel[] = ['permissive', 'standard', 'strict'];

function policyColor(level: PolicyLevel): string {
  if (level === 'permissive') return chalk.green(level);
  if (level === 'standard') return chalk.yellow(level);
  return chalk.red(level);
}

export function securityCommands(): Command {
  const cmd = new Command('security')
    .description('Manage security policies and audit logs');

  cmd
    .command('status')
    .description('Show current security status')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const spin = spinner('Fetching security status...').start();
      try {
        const result = await api.get<SecurityStatus>('/api/security/status');
        spin.stop();
        if (!result.ok) { error(result.error || 'Failed to fetch security status'); process.exit(1); }
        const data = result.data!;
        if (options.json) { console.log(JSON.stringify(data, null, 2)); return; }
        console.log(`\n${chalk.bold('Security Status')}`);
        console.log(`  ${chalk.dim('Policy:')}           ${policyColor(data.policy)}`);
        console.log(`  ${chalk.dim('Pending Approvals:')} ${data.pendingApprovals > 0 ? chalk.yellow(data.pendingApprovals) : chalk.dim('0')}`);
        console.log(`  ${chalk.dim('Last Audit:')}       ${formatRelativeTime(data.lastAudit)}`);
        if (data.pendingApprovals > 0) {
          info(`\n${data.pendingApprovals} item${data.pendingApprovals !== 1 ? 's' : ''} pending review. Run: profclaw security audit`);
        }
        console.log();
      } catch (err) {
        spin.stop();
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  cmd
    .command('set-policy <level>')
    .description(`Set security policy level (${VALID_POLICIES.join('|')})`)
    .option('--json', 'Output as JSON')
    .action(async (level: string, options: { json?: boolean }) => {
      if (!VALID_POLICIES.includes(level as PolicyLevel)) {
        error(`Invalid policy. Must be one of: ${VALID_POLICIES.join(', ')}`);
        process.exit(1);
      }
      const spin = spinner(`Setting policy to ${level}...`).start();
      try {
        const result = await api.post<SecurityStatus>('/api/security/policy', { level });
        spin.stop();
        if (!result.ok) { error(result.error || 'Failed to set policy'); process.exit(1); }
        if (options.json) { console.log(JSON.stringify(result.data, null, 2)); return; }
        success(`Security policy set to ${policyColor(level as PolicyLevel)}`);
      } catch (err) {
        spin.stop();
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  cmd
    .command('audit')
    .description('Show security audit log')
    .option('-l, --limit <n>', 'Max entries to show', '20')
    .option('--pending', 'Show only pending approvals')
    .option('--json', 'Output as JSON')
    .action(async (options: { limit: string; pending?: boolean; json?: boolean }) => {
      const spin = spinner('Fetching audit log...').start();
      try {
        const params = new URLSearchParams({ limit: options.limit });
        if (options.pending) params.set('result', 'pending');
        const result = await api.get<AuditResponse>(`/api/security/audit?${params}`);
        spin.stop();
        if (!result.ok) { error(result.error || 'Failed to fetch audit log'); process.exit(1); }
        const { entries } = result.data!;
        if (options.json) { console.log(JSON.stringify(entries, null, 2)); return; }
        if (entries.length === 0) { info('No audit entries found.'); return; }
        const table = createTable(['ID', 'Action', 'Actor', 'Target', 'Result', 'Time']);
        for (const e of entries) {
          const resultColor = e.result === 'approved' ? chalk.green
            : e.result === 'denied' ? chalk.red
            : chalk.yellow;
          table.push([
            chalk.dim(truncate(e.id, 12)),
            truncate(e.action, 20),
            truncate(e.actor, 16),
            truncate(e.target, 20),
            resultColor(e.result),
            formatRelativeTime(e.createdAt),
          ]);
        }
        console.log(table.toString());
      } catch (err) {
        spin.stop();
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  cmd
    .command('approve <id>')
    .description('Approve a pending security request')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      const spin = spinner(`Approving request ${id}...`).start();
      try {
        const result = await api.post<ApprovalItem>(`/api/security/approve/${id}`);
        spin.stop();
        if (!result.ok) { error(result.error || 'Failed to approve request'); process.exit(1); }
        if (options.json) { console.log(JSON.stringify(result.data, null, 2)); return; }
        success(`Request ${id} approved`);
      } catch (err) {
        spin.stop();
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  cmd
    .command('deny <id>')
    .description('Deny a pending security request')
    .option('--reason <reason>', 'Reason for denial')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: { reason?: string; json?: boolean }) => {
      const spin = spinner(`Denying request ${id}...`).start();
      try {
        const result = await api.post<ApprovalItem>(`/api/security/deny/${id}`, { reason: options.reason });
        spin.stop();
        if (!result.ok) { error(result.error || 'Failed to deny request'); process.exit(1); }
        if (options.json) { console.log(JSON.stringify(result.data, null, 2)); return; }
        success(`Request ${id} denied`);
      } catch (err) {
        spin.stop();
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  return cmd;
}
