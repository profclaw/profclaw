/**
 * Verified Run CLI Command
 *
 * Usage:
 *   profclaw run "<goal>" --verify "pnpm test"                 (built-in agent)
 *   profclaw run "<goal>" --verify "pnpm test" --agent-cmd "my-agent-cli"
 *
 * Done means verified: the run only succeeds when the verify command exits 0.
 * Work happens in an isolated git worktree on a local branch. Nothing is
 * pushed and no PR is opened.
 *
 * By default the built-in model-backed agent runs inside the worktree, starting
 * on the smart router's cheap model and escalating a tier after repeated
 * verifier failures. --agent-cmd overrides it with an external agent; the goal
 * and feedback are written to that agent's stdin, never interpolated into a
 * shell string.
 */

import { spawn } from 'node:child_process';
import { Command } from 'commander';
import { CommandVerifier } from '../../agents/verifier.js';
import { runVerifiedGoal, resolveLimits } from '../../agents/verified-run.js';
import { createDefaultExecutorRunner } from '../../agents/executor-runner.js';
import type { RunnerEvent } from '../../agents/executor-runner.js';
import type {
  AgentAttemptInput,
  AgentAttemptResult,
  AgentRunner,
  AttemptRecord,
  RunEvent,
  VerifiedRunLimits,
} from '../../agents/verified-run.js';
import { error, info, success, warn, formatCost, formatTokens } from '../utils/output.js';

interface RunCliOptions {
  verify: string;
  agentCmd?: string;
  model?: string;
  escalateAfter?: string;
  maxAttempts?: string;
  maxTokens?: string;
  maxCost?: string;
  breaker?: string;
  verifyTimeout?: string;
  branch?: string;
  cleanup?: boolean;
  json?: boolean;
}

/** Runs an external agent command, feeding the prompt on stdin. */
export class CommandAgent implements AgentRunner {
  constructor(private readonly command: string) {}

  runAttempt(input: AgentAttemptInput): Promise<AgentAttemptResult> {
    const prompt = buildPrompt(input);
    return new Promise((resolve, reject) => {
      const child = spawn('/bin/sh', ['-c', this.command], {
        cwd: input.workdir,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (d: Buffer) => {
        out = (out + d.toString('utf-8')).slice(-4000);
      });
      child.stderr.on('data', (d: Buffer) => {
        out = (out + d.toString('utf-8')).slice(-4000);
      });
      input.signal?.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });
      child.on('error', reject);
      child.on('close', (code: number | null) => {
        if (code === 0) resolve({ summary: out.trim().slice(-500), tokensUsed: 0, costUsd: 0 });
        else reject(new Error(`agent command exited with code ${code ?? 'null'}: ${out.trim().slice(-500)}`));
      });
      child.stdin.on('error', () => undefined);
      child.stdin.end(prompt);
    });
  }
}

export function buildPrompt(input: AgentAttemptInput): string {
  const parts = [
    `Goal: ${input.goal}`,
    `Work only inside: ${input.workdir}`,
    `Your work is judged by running: ${input.verifyCommand}`,
    'Do not push to any remote or open pull requests.',
  ];
  if (input.feedback) parts.push('', `Attempt ${input.attempt}. Previous attempt feedback:`, input.feedback);
  return parts.join('\n') + '\n';
}

function parseNumber(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
  return n;
}

function formatAttemptUsage(record: AttemptRecord): string {
  const parts = [`${formatTokens(record.tokensUsed)} tokens`];
  if (record.cacheHitRate !== undefined) parts.push(`cache hit ${(record.cacheHitRate * 100).toFixed(0)}%`);
  parts.push(formatCost(record.costUsd));
  if (record.model) parts.push(record.model);
  return parts.join(', ');
}

function printRunnerEvent(event: RunnerEvent): void {
  const { attempt, choice, escalated } = event;
  const prefix = escalated ? 'Escalating to' : 'Using';
  info(`Attempt ${attempt}: ${prefix} ${choice.provider}/${choice.model} (${choice.tier})`);
}

function printEvent(event: RunEvent): void {
  if (event.type === 'start') info(`Run ${event.runId} on branch ${event.branch}`);
  else if (event.type === 'attempt_start') info(`Attempt ${event.attempt}...`);
  else if (event.type === 'attempt_end') {
    const { record } = event;
    const line = `Attempt ${record.attempt}: ${record.outcome}${record.rolledBack ? ' (rolled back)' : ''} [${formatAttemptUsage(record)}]`;
    if (record.outcome === 'verified') success(line);
    else warn(line);
  }
}

export function runCommand(): Command {
  return new Command('run')
    .description('Run an agent toward a goal and only finish when a verify command passes')
    .argument('<goal>', 'What the agent should accomplish')
    .requiredOption('--verify <command>', 'Command that must exit 0 (tests, typecheck, lint, build)')
    .option('--agent-cmd <command>', 'External agent command (overrides the built-in agent); receives the prompt on stdin')
    .option('--model <ids>', 'Model, or comma separated ladder cheapest first (env PROFCLAW_RUN_MODEL); default: smart router')
    .option('--escalate-after <n>', 'Verifier failures in a row before moving up a model tier, 0 disables (env PROFCLAW_RUN_ESCALATE_AFTER)')
    .option('--max-attempts <n>', 'Maximum attempts (env PROFCLAW_RUN_MAX_ATTEMPTS)')
    .option('--max-tokens <n>', 'Token budget, 0 disables (env PROFCLAW_RUN_MAX_TOKENS)')
    .option('--max-cost <usd>', 'Dollar budget, 0 disables (env PROFCLAW_RUN_MAX_COST_USD)')
    .option('--breaker <n>', 'Non-improving attempts before the circuit breaker trips (env PROFCLAW_RUN_BREAKER_THRESHOLD)')
    .option('--verify-timeout <ms>', 'Verifier timeout (env PROFCLAW_RUN_VERIFY_TIMEOUT_MS)')
    .option('--branch <name>', 'Branch name for the run (default profclaw/run-<id>)')
    .option('--cleanup', 'Remove the worktree afterwards (the branch is kept)')
    .option('--json', 'Output the result as JSON')
    .action(async (goal: string, options: RunCliOptions) => {
      try {
        const flags: Partial<VerifiedRunLimits> = {
          maxAttempts: parseNumber(options.maxAttempts, '--max-attempts'),
          maxTokens: parseNumber(options.maxTokens, '--max-tokens'),
          maxCostUsd: parseNumber(options.maxCost, '--max-cost'),
          breakerThreshold: parseNumber(options.breaker, '--breaker'),
          verifyTimeoutMs: parseNumber(options.verifyTimeout, '--verify-timeout'),
        };
        for (const key of Object.keys(flags) as Array<keyof VerifiedRunLimits>) {
          if (flags[key] === undefined) delete flags[key];
        }
        const verifyCommand = options.verify;
        const limits = resolveLimits(flags);
        const agent: AgentRunner = options.agentCmd
          ? new CommandAgent(options.agentCmd)
          : await createDefaultExecutorRunner({
              goal,
              model: options.model,
              config: { escalateAfter: parseNumber(options.escalateAfter, '--escalate-after') },
              maxTokens: limits.maxTokens,
              maxCostUsd: limits.maxCostUsd,
              onEvent: options.json ? undefined : printRunnerEvent,
            });
        const result = await runVerifiedGoal({
          goal,
          verifyCommand,
          agent,
          projectRoot: process.cwd(),
          limits: flags,
          branchName: options.branch,
          removeWorktree: options.cleanup,
          onEvent: options.json ? undefined : printEvent,
          createVerifier: (cwd) =>
            new CommandVerifier(verifyCommand, {
              cwd,
              timeoutMs: flags.verifyTimeoutMs ?? Number(process.env.PROFCLAW_RUN_VERIFY_TIMEOUT_MS ?? 600_000),
              maxOutputChars: Number(process.env.PROFCLAW_RUN_MAX_OUTPUT_CHARS ?? 4_000),
            }),
        });

        if (options.json) {
          console.log(JSON.stringify({ ...result, diff: undefined }, null, 2));
        } else if (result.verified) {
          success(`Verified after ${result.attempts.length} attempt(s), cost ${formatCost(result.totalCostUsd)}`);
          info(`Branch ${result.branch} is ready for review (not pushed).`);
          if (result.reportPath) info(`Evidence: ${result.reportPath}`);
        } else {
          error(`Not verified (${result.stopReason}) after ${result.attempts.length} attempt(s)`);
          if (result.reportPath) info(`Report: ${result.reportPath}`);
        }
        process.exitCode = result.verified ? 0 : 1;
      } catch (err: unknown) {
        error(err instanceof Error ? err.message : 'Verified run failed');
        process.exitCode = 1;
      }
    });
}
