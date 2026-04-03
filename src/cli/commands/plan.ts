/**
 * Plan Mode CLI Commands
 *
 * View and manage agent plans created during plan-mode sessions.
 *
 * Usage:
 *   profclaw plan list
 *   profclaw plan show <id>
 *   profclaw plan approve <id>
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { planManager } from '../../agents/plan-mode.js';
import {
  createTable,
  formatRelativeTime,
  success,
  error,
  warn,
  truncate,
} from '../utils/output.js';
import type { Plan, PlanStep } from '../../agents/plan-mode.js';

// ─── Status formatting ───────────────────────────────────────────────────────

const PLAN_STATUS_COLORS: Record<Plan['status'], (s: string) => string> = {
  draft: chalk.yellow,
  approved: chalk.blue,
  in_progress: chalk.cyan,
  completed: chalk.green,
  rejected: chalk.red,
};

const STEP_STATUS_SYMBOLS: Record<PlanStep['status'], string> = {
  pending: chalk.dim('○'),
  in_progress: chalk.cyan('◑'),
  completed: chalk.green('●'),
  skipped: chalk.gray('–'),
};

function formatPlanStatus(status: Plan['status']): string {
  const colorFn = PLAN_STATUS_COLORS[status] ?? chalk.white;
  return colorFn(status.toUpperCase().replace('_', ' '));
}

// ─── Command builder ─────────────────────────────────────────────────────────

export function planCommands(): Command {
  const plan = new Command('plan').description('Manage agent implementation plans');

  // ── list ──────────────────────────────────────────────────────────────────
  plan
    .command('list')
    .alias('ls')
    .description('List all plans')
    .option('-s, --status <status>', 'Filter by status (draft|approved|in_progress|completed|rejected)')
    .option('--json', 'Output as JSON')
    .action((options: { status?: string; json?: boolean }) => {
      let plans = planManager.list();

      if (options.status) {
        plans = plans.filter((p) => p.status === options.status);
      }

      if (options.json) {
        console.log(JSON.stringify(plans, null, 2));
        return;
      }

      if (plans.length === 0) {
        console.log(chalk.dim('No plans found.'));
        return;
      }

      const table = createTable(['ID', 'Title', 'Status', 'Steps', 'Created']);

      for (const p of plans) {
        const doneSteps = p.steps.filter((s) => s.status === 'completed' || s.status === 'skipped').length;
        table.push([
          p.id.slice(0, 8),
          truncate(p.title, 40),
          formatPlanStatus(p.status),
          `${doneSteps}/${p.steps.length}`,
          formatRelativeTime(new Date(p.createdAt)),
        ]);
      }

      console.log(table.toString());
      console.log(chalk.dim(`\n${plans.length} plan(s) total`));
    });

  // ── show ──────────────────────────────────────────────────────────────────
  plan
    .command('show <id>')
    .alias('get')
    .description('Show plan details and step list')
    .option('--json', 'Output as JSON')
    .action((id: string, options: { json?: boolean }) => {
      // Support partial ID prefix matching
      const allPlans = planManager.list();
      const found = allPlans.find((p) => p.id === id || p.id.startsWith(id));

      if (!found) {
        error(`Plan not found: ${id}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(found, null, 2));
        return;
      }

      console.log('');
      console.log(chalk.bold(`Plan: ${found.id}`));
      console.log(`Title:   ${found.title}`);
      console.log(`Status:  ${formatPlanStatus(found.status)}`);
      console.log(`Created: ${formatRelativeTime(new Date(found.createdAt))}`);
      if (found.approvedAt) {
        console.log(`Approved: ${formatRelativeTime(new Date(found.approvedAt))}`);
      }
      if (found.completedAt) {
        console.log(`Completed: ${formatRelativeTime(new Date(found.completedAt))}`);
      }
      if (found.rejectionReason) {
        console.log(`Rejection reason: ${chalk.red(found.rejectionReason)}`);
      }
      if (found.taskId) {
        console.log(`Task ID: ${found.taskId}`);
      }

      console.log('');
      console.log(chalk.bold('Steps:'));
      for (const step of found.steps) {
        const symbol = STEP_STATUS_SYMBOLS[step.status];
        const effort = step.estimatedEffort ? chalk.dim(` [${step.estimatedEffort}]`) : '';
        console.log(`  ${symbol} ${step.index}. ${step.description}${effort}`);
        if (step.files && step.files.length > 0) {
          for (const f of step.files) {
            console.log(`       ${chalk.dim(f)}`);
          }
        }
      }
      console.log('');
    });

  // ── approve ───────────────────────────────────────────────────────────────
  plan
    .command('approve <id>')
    .description('Approve a pending plan so the agent can begin implementation')
    .option('--json', 'Output as JSON')
    .action((id: string, options: { json?: boolean }) => {
      const allPlans = planManager.list();
      const found = allPlans.find((p) => p.id === id || p.id.startsWith(id));

      if (!found) {
        error(`Plan not found: ${id}`);
        process.exit(1);
      }

      if (found.status !== 'draft') {
        warn(`Plan ${found.id.slice(0, 8)} is already ${found.status}, cannot approve.`);
        process.exit(1);
      }

      try {
        const approved = planManager.approve(found.id);

        if (options.json) {
          console.log(JSON.stringify(approved, null, 2));
          return;
        }

        success(`Plan approved: ${approved.id.slice(0, 8)} — "${approved.title}"`);
        console.log(chalk.dim('The agent will now begin implementation.'));
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to approve plan');
        process.exit(1);
      }
    });

  // ── reject ────────────────────────────────────────────────────────────────
  plan
    .command('reject <id>')
    .description('Reject a pending plan')
    .option('-r, --reason <reason>', 'Reason for rejection')
    .option('--json', 'Output as JSON')
    .action((id: string, options: { reason?: string; json?: boolean }) => {
      const allPlans = planManager.list();
      const found = allPlans.find((p) => p.id === id || p.id.startsWith(id));

      if (!found) {
        error(`Plan not found: ${id}`);
        process.exit(1);
      }

      if (found.status !== 'draft') {
        warn(`Plan ${found.id.slice(0, 8)} is already ${found.status}, cannot reject.`);
        process.exit(1);
      }

      try {
        const rejected = planManager.reject(found.id, options.reason);

        if (options.json) {
          console.log(JSON.stringify(rejected, null, 2));
          return;
        }

        console.log(chalk.red('✗') + ` Plan rejected: ${rejected.id.slice(0, 8)}`);
        if (options.reason) {
          console.log(chalk.dim(`Reason: ${options.reason}`));
        }
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to reject plan');
        process.exit(1);
      }
    });

  return plan;
}
