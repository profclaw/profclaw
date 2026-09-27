/**
 * Verified Run
 *
 * "Done means verified, not claimed." Runs an agent toward a goal inside an
 * isolated worktree and only reports success when an objective verifier
 * command (tests, typecheck, lint, build, custom) exits 0.
 *
 * Loop: attempt -> verify -> (pass: stop) | (fail: feed trimmed output back,
 * roll back to the last good checkpoint if the attempt made things worse) ->
 * retry. Stops on pass, max attempts, token or dollar budget, or the circuit
 * breaker. The agent sits behind AgentRunner so the loop is testable without
 * an LLM. Nothing here pushes or opens a PR.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';
import { ToolCircuitBreaker } from './circuit-breaker.js';
import { CheckpointManager } from './checkpoint-manager.js';
import { SessionDiffTracker } from './session-diff.js';
import { formatFailureFeedback } from './verifier.js';
import type { Verifier, VerifierResult } from './verifier.js';
import { GitRunWorkspace } from './verified-run-git.js';
import { sha256Hex } from './receipt/receipt-writer.js';
import type { ReceiptDataMap, ReceiptEventType, ReceiptSink } from './receipt/receipt-types.js';
import type { RunWorkspace, WorkspaceChange } from './verified-run-git.js';

// Agent interface

export interface AgentAttemptInput {
  goal: string;
  /** 1-based attempt number */
  attempt: number;
  /** Trimmed verifier failure from the previous attempt, when there is one */
  feedback?: string;
  /** Directory the agent must work in (the isolated worktree) */
  workdir: string;
  verifyCommand: string;
  signal?: AbortSignal;
}

export interface AgentAttemptResult {
  summary: string;
  tokensUsed: number;
  costUsd: number;
  /** Model the attempt ran on, when the runner chose one */
  model?: string;
  /** Fraction of prompt tokens served from cache (0 to 1), when known */
  cacheHitRate?: number;
  /** Token breakdown, when the runner knows it (recorded in the run receipt) */
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
}

/** The only seam to an LLM. Real integrations and test fakes implement this. */
export interface AgentRunner {
  runAttempt(input: AgentAttemptInput): Promise<AgentAttemptResult>;
}

// Configuration

export interface VerifiedRunLimits {
  maxAttempts: number;
  /** 0 disables the guard */
  maxTokens: number;
  /** 0 disables the guard */
  maxCostUsd: number;
  breakerThreshold: number;
  breakerWindowMs: number;
  verifyTimeoutMs: number;
  maxOutputChars: number;
  /** 1 runs the verifier once before attempt 1 to measure the starting state, 0 skips it */
  baseline: number;
}

export const DEFAULT_LIMITS: VerifiedRunLimits = {
  maxAttempts: 5,
  maxTokens: 0,
  maxCostUsd: 0,
  breakerThreshold: 3,
  breakerWindowMs: 3_600_000,
  verifyTimeoutMs: 600_000,
  maxOutputChars: 4_000,
  baseline: 1,
};

function envNumber(env: NodeJS.ProcessEnv, key: string): number | undefined {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Precedence: explicit flag > PROFCLAW_RUN_* env var > default. */
export function resolveLimits(
  flags: Partial<VerifiedRunLimits>,
  env: NodeJS.ProcessEnv = process.env,
): VerifiedRunLimits {
  const pick = (key: keyof VerifiedRunLimits, envKey: string): number =>
    flags[key] ?? envNumber(env, envKey) ?? DEFAULT_LIMITS[key];
  const limits: VerifiedRunLimits = {
    maxAttempts: pick('maxAttempts', 'PROFCLAW_RUN_MAX_ATTEMPTS'),
    maxTokens: pick('maxTokens', 'PROFCLAW_RUN_MAX_TOKENS'),
    maxCostUsd: pick('maxCostUsd', 'PROFCLAW_RUN_MAX_COST_USD'),
    breakerThreshold: pick('breakerThreshold', 'PROFCLAW_RUN_BREAKER_THRESHOLD'),
    breakerWindowMs: pick('breakerWindowMs', 'PROFCLAW_RUN_BREAKER_WINDOW_MS'),
    verifyTimeoutMs: pick('verifyTimeoutMs', 'PROFCLAW_RUN_VERIFY_TIMEOUT_MS'),
    maxOutputChars: pick('maxOutputChars', 'PROFCLAW_RUN_MAX_OUTPUT_CHARS'),
    baseline: pick('baseline', 'PROFCLAW_RUN_BASELINE'),
  };
  limits.maxAttempts = Math.max(1, Math.floor(limits.maxAttempts));
  limits.breakerThreshold = Math.max(1, Math.floor(limits.breakerThreshold));
  return limits;
}

// Results

export type StopReason =
  | 'verified'
  | 'max_attempts'
  | 'token_budget'
  | 'cost_budget'
  | 'circuit_open'
  | 'aborted'
  | 'already_passing';

export type AttemptOutcome = 'verified' | 'improved' | 'unchanged' | 'worse' | 'agent_error';

export interface AttemptRecord {
  attempt: number;
  outcome: AttemptOutcome;
  agentSummary: string;
  agentError?: string;
  verifier?: VerifierResult;
  /** Failure signal used for better/worse comparison (lower is better) */
  failureScore?: number;
  rolledBack: boolean;
  tokensUsed: number;
  costUsd: number;
  model?: string;
  cacheHitRate?: number;
}

export interface VerifiedRunResult {
  runId: string;
  goal: string;
  verifyCommand: string;
  verified: boolean;
  stopReason: StopReason;
  attempts: AttemptRecord[];
  totalTokens: number;
  totalCostUsd: number;
  branch: string;
  workspacePath: string;
  changedFiles: Array<{ relPath: string; status: string }>;
  diff: string;
  reportPath?: string;
}

export type RunEvent =
  | { type: 'start'; runId: string; branch: string; workspacePath: string }
  | { type: 'attempt_start'; attempt: number }
  | { type: 'attempt_end'; record: AttemptRecord }
  | { type: 'stop'; reason: StopReason };

export interface VerifiedRunOptions {
  goal: string;
  verifyCommand: string;
  agent: AgentRunner;
  /** Builds the verifier for a given workspace directory */
  createVerifier: (cwd: string) => Verifier;
  /** Repo root; the worktree and the report live under .profclaw/ inside it */
  projectRoot: string;
  limits?: Partial<VerifiedRunLimits>;
  env?: NodeJS.ProcessEnv;
  runId?: string;
  branchName?: string;
  /** Injected in tests; defaults to a git worktree */
  workspace?: RunWorkspace;
  checkpoints?: Pick<CheckpointManager, 'save'>;
  /** Directory for evidence.md; defaults to <projectRoot>/.profclaw/runs/<runId> */
  reportDir?: string;
  /** Remove the worktree at the end (the branch is always kept) */
  removeWorktree?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => void;
  /** Lower is better. Default counts failure-looking lines in verifier output. */
  scoreFailure?: (result: VerifierResult) => number;
  /** Records a tamper-evident receipt of the run when set (see docs/specs/run-receipt-v0.md) */
  receipt?: ReceiptSink;
  /** Tool name and version written to the receipt's run_start */
  toolInfo?: { name: string; version: string };
}

// Failure scoring

const FAILURE_LINE = /\b(error|errors|fail|failed|failing|failure|assertionerror)\b|✗|✘/i;

/** Number of failure-looking output lines, minimum 1 for any failed run. */
export function defaultFailureScore(result: VerifierResult): number {
  if (result.passed) return 0;
  const lines = result.output.split('\n').filter((l) => FAILURE_LINE.test(l)).length;
  return Math.max(1, lines);
}

// Run loop

export async function runVerifiedGoal(options: VerifiedRunOptions): Promise<VerifiedRunResult> {
  const limits = resolveLimits(options.limits ?? {}, options.env ?? process.env);
  const runId = options.runId ?? randomUUID().slice(0, 8);
  const score = options.scoreFailure ?? defaultFailureScore;
  const env = options.env ?? process.env;
  const emit = options.onEvent ?? ((): void => undefined);
  const workspace =
    options.workspace ?? new GitRunWorkspace(options.projectRoot, runId, options.branchName);
  const checkpoints = options.checkpoints ?? new CheckpointManager(options.projectRoot);
  const breaker = new ToolCircuitBreaker(limits.breakerThreshold, limits.breakerWindowMs);
  const breakerKey = 'verified-run';

  const rcpt = <K extends ReceiptEventType>(type: K, data: ReceiptDataMap[K]): void =>
    recordReceipt(options.receipt, type, data);

  const baseRef = await workspace.prepare();
  rcpt('run_start', {
    goal: options.goal,
    verifyCommand: options.verifyCommand,
    repoHead: baseRef,
    branch: workspace.branch,
    tool: options.toolInfo ?? { name: 'profclaw', version: 'unknown' },
  });
  emit({ type: 'start', runId, branch: workspace.branch, workspacePath: workspace.path });
  const verifier = options.createVerifier(workspace.path);

  const attempts: AttemptRecord[] = [];
  let goodRef = baseRef;
  let bestScore = Number.POSITIVE_INFINITY;
  let feedback: string | undefined;
  let totalTokens = 0;
  let totalCost = 0;
  let stopReason: StopReason = 'max_attempts';

  const budgetStop = (): StopReason | null => {
    if (limits.maxTokens > 0 && totalTokens >= limits.maxTokens) return 'token_budget';
    if (limits.maxCostUsd > 0 && totalCost >= limits.maxCostUsd) return 'cost_budget';
    return null;
  };
  const breakerOpen = (): boolean => breaker.getStatus().get(breakerKey)?.state === 'open';

  // Measure the starting state so attempt 1 can be judged (and rolled back) like any other,
  // and so the agent sees the real failure output from the first attempt.
  let alreadyPassing = false;
  if (limits.baseline > 0) {
    const baseline = await verifier.verify();
    rcpt('verifier_result', verifierData(0, options.verifyCommand, baseline, score(baseline)));
    if (baseline.passed) {
      alreadyPassing = true;
      stopReason = 'already_passing';
    } else {
      bestScore = score(baseline);
      feedback = formatFailureFeedback(baseline, options.verifyCommand);
    }
  }

  for (let attempt = 1; attempt <= limits.maxAttempts && !alreadyPassing; attempt++) {
    if (options.signal?.aborted) {
      stopReason = 'aborted';
      break;
    }
    const preStop = budgetStop();
    if (preStop) {
      stopReason = preStop;
      break;
    }

    emit({ type: 'attempt_start', attempt });
    rcpt('attempt_start', { attempt });
    const record: AttemptRecord = {
      attempt,
      outcome: 'agent_error',
      agentSummary: '',
      rolledBack: false,
      tokensUsed: 0,
      costUsd: 0,
    };

    try {
      const result = await options.agent.runAttempt({
        goal: options.goal,
        attempt,
        feedback,
        workdir: workspace.path,
        verifyCommand: options.verifyCommand,
        signal: options.signal,
      });
      record.agentSummary = result.summary;
      record.tokensUsed = result.tokensUsed;
      record.costUsd = result.costUsd;
      record.model = result.model;
      record.cacheHitRate = result.cacheHitRate;
      totalTokens += result.tokensUsed;
      totalCost += result.costUsd;
      rcpt('usage', {
        attempt,
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
        cacheReadTokens: result.usage?.cacheReadTokens ?? 0,
        cacheWriteTokens: result.usage?.cacheWriteTokens ?? 0,
        totalTokens: result.tokensUsed,
        costUsd: result.costUsd,
        ...(result.model ? { model: result.model } : {}),
      });
    } catch (error: unknown) {
      record.agentError = error instanceof Error ? error.message : String(error);
      logger.warn('[VerifiedRun] Agent attempt threw', { attempt, error: record.agentError });
      await workspace.restore(goodRef);
      record.rolledBack = true;
      rcpt('rollback', { attempt, reason: `agent error: ${record.agentError}` });
      breaker.recordFailure(breakerKey);
      feedback = `The previous attempt crashed: ${record.agentError}. The workspace was restored to the last good state.`;
      attempts.push(record);
      rcpt('attempt_end', { attempt, outcome: record.outcome, rolledBack: record.rolledBack });
      emit({ type: 'attempt_end', record });
      const stop = budgetStop() ?? (breakerOpen() ? 'circuit_open' : null);
      if (stop) {
        stopReason = stop;
        break;
      }
      continue;
    }

    const verdict = await verifier.verify();
    record.verifier = verdict;
    record.failureScore = score(verdict);
    rcpt('verifier_result', verifierData(attempt, options.verifyCommand, verdict, record.failureScore));

    if (verdict.passed) {
      record.outcome = 'verified';
      await workspace.checkpoint(`attempt ${attempt} verified`);
      attempts.push(record);
      rcpt('attempt_end', { attempt, outcome: record.outcome, rolledBack: false });
      emit({ type: 'attempt_end', record });
      stopReason = 'verified';
      break;
    }

    if (record.failureScore > bestScore) {
      record.outcome = 'worse';
      await workspace.restore(goodRef);
      record.rolledBack = true;
      rcpt('rollback', {
        attempt,
        reason: `failure score ${record.failureScore} is worse than the best so far (${bestScore})`,
      });
      breaker.recordFailure(breakerKey);
    } else {
      const improved = record.failureScore < bestScore;
      record.outcome = improved ? 'improved' : 'unchanged';
      goodRef = await workspace.checkpoint(`attempt ${attempt} (${record.outcome})`);
      bestScore = record.failureScore;
      if (improved) breaker.recordSuccess(breakerKey);
      else breaker.recordFailure(breakerKey);
      await saveExecutorCheckpoint(checkpoints, runId, options.goal, attempt, limits, totalTokens, totalCost, verdict);
    }

    feedback = formatFailureFeedback(verdict, options.verifyCommand);
    attempts.push(record);
    rcpt('attempt_end', { attempt, outcome: record.outcome, rolledBack: record.rolledBack });
    emit({ type: 'attempt_end', record });

    const stop = budgetStop() ?? (breakerOpen() ? 'circuit_open' : null);
    if (stop) {
      stopReason = stop;
      break;
    }
  }

  emit({ type: 'stop', reason: stopReason });

  const changes = await workspace.changedFiles();
  const diff = await buildDiff(changes);
  if (options.receipt) {
    for (const change of changes) {
      rcpt('file_change', await fileChangeData(change, env));
    }
    rcpt('run_end', {
      stopReason,
      verified: stopReason === 'verified',
      totals: { attempts: attempts.length, totalTokens, costUsd: totalCost, filesChanged: changes.length },
    });
  }
  const result: VerifiedRunResult = {
    runId,
    goal: options.goal,
    verifyCommand: options.verifyCommand,
    verified: stopReason === 'verified',
    stopReason,
    attempts,
    totalTokens,
    totalCostUsd: totalCost,
    branch: workspace.branch,
    workspacePath: workspace.path,
    changedFiles: changes.map((c) => ({ relPath: c.relPath, status: c.status })),
    diff,
  };

  const reportDir = options.reportDir ?? join(options.projectRoot, '.profclaw', 'runs', runId);
  await mkdir(reportDir, { recursive: true });
  result.reportPath = join(reportDir, 'evidence.md');
  await writeFile(result.reportPath, buildEvidenceReport(result, limits), 'utf-8');

  if (options.removeWorktree) await workspace.dispose();
  return result;
}

// Receipt helpers

/** Receipt writing is best effort: a failure is logged and never fails the run. */
function recordReceipt<K extends ReceiptEventType>(
  sink: ReceiptSink | undefined,
  type: K,
  data: ReceiptDataMap[K],
): void {
  if (!sink) return;
  try {
    sink.append(type, data);
  } catch (error: unknown) {
    logger.warn('[VerifiedRun] Failed to write receipt event', {
      type,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function verifierData(
  attempt: number,
  command: string,
  result: VerifierResult,
  failureScore: number,
): ReceiptDataMap['verifier_result'] {
  return {
    attempt,
    command,
    exitCode: result.exitCode,
    passed: result.passed,
    output: result.output,
    failureScore,
    durationMs: result.durationMs,
    timedOut: result.timedOut,
  };
}

/** Largest per-file diff embedded in a receipt (env PROFCLAW_RECEIPT_MAX_DIFF_CHARS). */
function maxDiffChars(env: NodeJS.ProcessEnv): number {
  const n = Number(env['PROFCLAW_RECEIPT_MAX_DIFF_CHARS']);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200_000;
}

async function fileChangeData(change: WorkspaceChange, env: NodeJS.ProcessEnv): Promise<ReceiptDataMap['file_change']> {
  let after: string | null = null;
  try {
    after = sha256Hex(await readFile(change.path));
  } catch {
    after = null;
  }
  const diff = await buildDiff([change]);
  const cap = maxDiffChars(env);
  return {
    path: change.relPath,
    status: change.status,
    beforeSha256: change.original === null ? null : sha256Hex(change.original),
    afterSha256: after,
    diffSha256: sha256Hex(diff),
    ...(diff.length <= cap ? { diff } : { diffTruncated: true }),
  };
}

async function saveExecutorCheckpoint(
  store: Pick<CheckpointManager, 'save'>,
  runId: string,
  goal: string,
  attempt: number,
  limits: VerifiedRunLimits,
  tokens: number,
  cost: number,
  verdict: VerifierResult,
): Promise<void> {
  try {
    const now = Date.now();
    await store.save({
      sessionId: `verified-run-${runId}`,
      taskDescription: goal,
      currentStep: attempt,
      totalSteps: limits.maxAttempts,
      messages: [],
      tokensUsed: tokens,
      estimatedCost: cost,
      toolCallHistory: [],
      remainingWork: verdict.output.slice(0, 500),
      createdAt: now,
      updatedAt: now,
    });
  } catch (error: unknown) {
    // Persistence is best effort: the git checkpoint is the source of truth.
    logger.warn('[VerifiedRun] Failed to persist checkpoint metadata', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function buildDiff(changes: WorkspaceChange[]): Promise<string> {
  const tracker = new SessionDiffTracker();
  for (const change of changes) {
    if (change.status === 'created' || change.original === null) tracker.recordCreated(change.path);
    else tracker.recordOriginal(change.path, change.original);
  }
  const raw = await tracker.generateDiff();
  // Show workspace-relative paths in the diff headers.
  let out = raw;
  for (const change of changes) out = out.split(change.path).join(change.relPath);
  return out;
}

// Evidence report

export function buildEvidenceReport(result: VerifiedRunResult, limits: VerifiedRunLimits): string {
  const lines: string[] = [];
  const status = result.verified
    ? 'VERIFIED'
    : result.stopReason === 'already_passing'
      ? 'NOT RUN (verifier already passes)'
      : 'NOT VERIFIED';
  lines.push(`# Evidence report: ${status}`, '');
  lines.push(`- Run: \`${result.runId}\``);
  lines.push(`- Goal: ${result.goal}`);
  lines.push(`- Verifier: \`${result.verifyCommand}\``);
  lines.push(`- Stop reason: ${result.stopReason}`);
  lines.push(`- Branch: \`${result.branch}\` (local only, not pushed)`);
  lines.push(`- Worktree: \`${result.workspacePath}\``, '');

  lines.push('## Cost', '');
  lines.push(`- Attempts: ${result.attempts.length} of ${limits.maxAttempts}`);
  lines.push(`- Tokens: ${result.totalTokens}${limits.maxTokens > 0 ? ` (limit ${limits.maxTokens})` : ''}`);
  lines.push(`- Cost: $${result.totalCostUsd.toFixed(4)}${limits.maxCostUsd > 0 ? ` (limit $${limits.maxCostUsd})` : ''}`, '');

  lines.push('## Attempts', '');
  for (const a of result.attempts) {
    lines.push(`### Attempt ${a.attempt}: ${a.outcome}${a.rolledBack ? ' (rolled back)' : ''}`, '');
    if (a.agentSummary) lines.push(`Agent: ${a.agentSummary}`, '');
    if (a.agentError) lines.push(`Agent error: ${a.agentError}`, '');
    if (a.verifier) {
      const v = a.verifier;
      lines.push(
        `Verifier: ${v.passed ? 'PASS' : 'FAIL'}, exit ${v.exitCode === null ? 'n/a' : v.exitCode}${v.timedOut ? ', timed out' : ''}, ${v.durationMs}ms`,
        '',
      );
      if (v.output) lines.push('```', v.output, '```', '');
    }
    lines.push(`Tokens: ${a.tokensUsed}, cost: $${a.costUsd.toFixed(4)}`, '');
  }

  lines.push('## Files changed', '');
  if (result.changedFiles.length === 0) lines.push('None.', '');
  else {
    for (const f of result.changedFiles) lines.push(`- ${f.status}: \`${f.relPath}\``);
    lines.push('');
  }
  if (result.diff) lines.push('## Diff', '', '```diff', result.diff.trimEnd(), '```', '');
  if (result.verified) {
    lines.push('## Next step', '', `Review the branch \`${result.branch}\` and open a PR manually if it looks right. profClaw never pushes or opens PRs on its own.`, '');
  }
  return lines.join('\n');
}
