/**
 * ExecutorRunner: the built-in model-backed AgentRunner for verified runs.
 *
 * Adapts AgentExecutor to the AgentRunner seam used by runVerifiedGoal:
 * - runs the executor with the run's worktree as the only place it can touch
 *   (worktree-confined tools plus the PermissionManager, never push or PR);
 * - feeds it the goal plus the previous attempt's trimmed verifier output;
 * - reports tokens, dollars and cache hit rate so the loop's budget guard works,
 *   and cancels an attempt mid-flight when the remaining budget is spent;
 * - cascades models: starts on the smart router's cheap pick and moves one
 *   tier up after N consecutive verifier failures (N is configurable).
 *
 * AgentExecutor is used as-is. Cache usage is read from its public
 * `step:complete` event, so the executor internals are not touched.
 */

import { randomUUID } from 'node:crypto';
import type { LanguageModel, ModelMessage, ToolSet } from 'ai';
import { AgentExecutor } from './executor.js';
import type { ToolExecuteHandler } from './executor.js';
import type { AgentConfig, AgentState } from './types.js';
import type { AgentAttemptInput, AgentAttemptResult, AgentRunner } from './verified-run.js';
import { createRunPermissionManager, createWorktreeToolset } from './worktree-tools.js';
import type { PermissionManager } from './permissions.js';
import { classifyComplexity, selectModel } from '../providers/smart-router.js';
import type { ComplexityTier } from '../providers/smart-router.js';
import { getModelInfo, resolveModelAlias } from '../providers/core/models.js';
import type { ProviderType } from '../providers/core/types.js';
import { extractCacheUsage, getPromptCacheConfig } from '../providers/prompt-cache.js';
import type { PromptCacheConfig } from '../providers/prompt-cache.js';

// Model ladder

export interface ModelChoice {
  provider: ProviderType;
  model: string;
  costPer1MInput: number;
  costPer1MOutput: number;
  /** Router tier the pick came from, or 'pinned' for an explicit --model */
  tier: ComplexityTier | 'pinned';
}

const TIER_ORDER: ComplexityTier[] = ['trivial', 'standard', 'complex'];

function toChoice(spec: string, tier: ModelChoice['tier']): ModelChoice {
  const resolved = resolveModelAlias(spec);
  const modelId = resolved?.model ?? spec;
  const info = getModelInfo(modelId);
  const provider = resolved?.provider ?? info?.provider;
  if (!provider) {
    throw new Error(`Unknown model "${spec}". Use an alias, a catalog id, or provider/model.`);
  }
  return {
    provider,
    model: modelId,
    costPer1MInput: info?.costPer1MInput ?? 0,
    costPer1MOutput: info?.costPer1MOutput ?? 0,
    tier,
  };
}

/**
 * Build the ordered list of models an attempt series may use.
 *
 * `modelSpec` (comma separated) pins an explicit ladder, cheapest first.
 * Without it the smart router classifies the goal, picks the cheap model for
 * that tier, and appends the picks for each higher tier (deduplicated).
 */
export function buildModelLadder(
  goal: string,
  availableProviders: Set<ProviderType>,
  modelSpec?: string,
): ModelChoice[] {
  const specs = (modelSpec ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  if (specs.length > 0) return specs.map((s) => toChoice(s, 'pinned'));

  if (availableProviders.size === 0) {
    throw new Error('No model provider is configured. Set a provider API key or pass --model.');
  }
  const complexity = classifyComplexity(goal, { hasCodeContext: true, hasToolUse: true });
  const startIndex = TIER_ORDER.indexOf(complexity.tier);
  const ladder: ModelChoice[] = [];
  for (const tier of TIER_ORDER.slice(startIndex)) {
    const picked = selectModel({ ...complexity, tier }, availableProviders).selectedModel;
    if (!picked.supportsTools) continue;
    if (ladder.some((c) => c.model === picked.id)) continue;
    ladder.push({
      provider: picked.provider,
      model: picked.id,
      costPer1MInput: picked.costPer1MInput,
      costPer1MOutput: picked.costPer1MOutput,
      tier,
    });
  }
  if (ladder.length === 0) throw new Error('The router found no tool-capable model. Pass --model.');
  return ladder;
}

// Cost

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Dollar cost with cache reads and writes priced by their multipliers. */
export function computeCostUsd(choice: ModelChoice, usage: UsageTotals, cache: PromptCacheConfig): number {
  const read = Math.min(usage.cacheReadTokens, usage.inputTokens);
  const write = Math.min(usage.cacheWriteTokens, usage.inputTokens - read);
  const fresh = usage.inputTokens - read - write;
  const inputUnits = fresh + read * cache.readMultiplier + write * cache.writeMultiplier;
  return (inputUnits * choice.costPer1MInput + usage.outputTokens * choice.costPer1MOutput) / 1_000_000;
}

// Configuration

export interface ExecutorRunnerConfig {
  /** Consecutive verifier failures on a model before moving up a tier. 0 disables cascading. */
  escalateAfter: number;
  maxStepsPerAttempt: number;
  /** Token cap per attempt (also bounded by the run's remaining budget) */
  attemptTokenBudget: number;
  commandTimeoutMs: number;
  maxToolOutputChars: number;
}

export const DEFAULT_RUNNER_CONFIG: ExecutorRunnerConfig = {
  escalateAfter: 2,
  maxStepsPerAttempt: 40,
  attemptTokenBudget: 200_000,
  commandTimeoutMs: 120_000,
  maxToolOutputChars: 8_000,
};

function envNumber(env: NodeJS.ProcessEnv, key: string): number | undefined {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Precedence: explicit flag > PROFCLAW_RUN_* env var > default. */
export function resolveRunnerConfig(
  flags: Partial<ExecutorRunnerConfig>,
  env: NodeJS.ProcessEnv = process.env,
): ExecutorRunnerConfig {
  const pick = (key: keyof ExecutorRunnerConfig, envKey: string): number =>
    flags[key] ?? envNumber(env, envKey) ?? DEFAULT_RUNNER_CONFIG[key];
  const cfg: ExecutorRunnerConfig = {
    escalateAfter: Math.floor(pick('escalateAfter', 'PROFCLAW_RUN_ESCALATE_AFTER')),
    maxStepsPerAttempt: Math.max(1, Math.floor(pick('maxStepsPerAttempt', 'PROFCLAW_RUN_MAX_STEPS'))),
    attemptTokenBudget: Math.max(1, Math.floor(pick('attemptTokenBudget', 'PROFCLAW_RUN_ATTEMPT_TOKENS'))),
    commandTimeoutMs: Math.max(1, pick('commandTimeoutMs', 'PROFCLAW_RUN_COMMAND_TIMEOUT_MS')),
    maxToolOutputChars: Math.max(1, Math.floor(pick('maxToolOutputChars', 'PROFCLAW_RUN_TOOL_OUTPUT_CHARS'))),
  };
  return cfg;
}

// Runner

/** The slice of AgentExecutor the runner uses; lets tests inject a fake. */
export interface AgentLoop {
  run(
    model: LanguageModel,
    messages: ModelMessage[],
    tools: ToolSet,
    onToolExecute?: ToolExecuteHandler,
    providerHint?: string,
  ): Promise<AgentState>;
  cancel(): void;
  getState(): AgentState;
  on(event: 'step:complete', listener: (state: AgentState, result: unknown) => void): unknown;
}

export interface CreateLoopArgs {
  sessionId: string;
  goal: string;
  config: Partial<AgentConfig>;
}

export type RunnerEvent =
  | { type: 'model_selected'; attempt: number; choice: ModelChoice; escalated: boolean };

export interface ExecutorRunnerOptions {
  ladder: ModelChoice[];
  createModel: (choice: ModelChoice) => Promise<LanguageModel>;
  config?: Partial<ExecutorRunnerConfig>;
  env?: NodeJS.ProcessEnv;
  /** Run-level budgets (0 disables); attempts are capped to what is left */
  maxTokens?: number;
  maxCostUsd?: number;
  permissions?: PermissionManager;
  createLoop?: (args: CreateLoopArgs) => AgentLoop;
  onEvent?: (event: RunnerEvent) => void;
}

const SYSTEM_PROMPT = [
  'You are a coding agent working toward a goal inside an isolated git worktree.',
  'Use the tools to read and edit files and to run commands. Every path is relative to the working directory and you cannot leave it.',
  'Run the verify command yourself to check your work. The run only counts as done when that command exits 0.',
  'Never push to a remote, never open pull requests, never touch git configuration.',
  'When finished, call complete_task with a short summary.',
].join('\n');

export function buildAgentMessages(input: AgentAttemptInput): ModelMessage[] {
  const lines = [
    `Goal: ${input.goal}`,
    `Verify command (must exit 0): ${input.verifyCommand}`,
    `Attempt ${input.attempt}.`,
  ];
  if (input.feedback) {
    lines.push('', 'The previous attempt did not pass verification. Trimmed verifier output:', input.feedback);
  }
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: lines.join('\n') },
  ];
}

function stepUsage(result: unknown): unknown {
  return typeof result === 'object' && result !== null ? (result as Record<string, unknown>)['usage'] : undefined;
}

export class ExecutorRunner implements AgentRunner {
  private readonly config: ExecutorRunnerConfig;
  private readonly cache: PromptCacheConfig;
  private readonly permissions: PermissionManager;
  private tierIndex = 0;
  private failuresOnTier = 0;
  private spentTokens = 0;
  private spentUsd = 0;

  constructor(private readonly options: ExecutorRunnerOptions) {
    if (options.ladder.length === 0) throw new Error('ExecutorRunner needs at least one model');
    this.config = resolveRunnerConfig(options.config ?? {}, options.env);
    this.cache = getPromptCacheConfig(options.env);
    this.permissions = options.permissions ?? createRunPermissionManager();
  }

  /** Model the next attempt would use (for tests and diagnostics). */
  get currentChoice(): ModelChoice {
    return this.options.ladder[this.tierIndex];
  }

  /**
   * A call that arrives with feedback means the previous attempt failed
   * verification (or crashed). After `escalateAfter` such failures in a row on
   * the same model, move to the next tier up, if there is one.
   */
  private selectChoice(input: AgentAttemptInput): { choice: ModelChoice; escalated: boolean } {
    let escalated = false;
    if (input.feedback !== undefined) this.failuresOnTier++;
    const { escalateAfter } = this.config;
    if (
      escalateAfter > 0 &&
      this.failuresOnTier >= escalateAfter &&
      this.tierIndex < this.options.ladder.length - 1
    ) {
      this.tierIndex++;
      this.failuresOnTier = 0;
      escalated = true;
    }
    return { choice: this.currentChoice, escalated };
  }

  async runAttempt(input: AgentAttemptInput): Promise<AgentAttemptResult> {
    const { choice, escalated } = this.selectChoice(input);
    this.options.onEvent?.({ type: 'model_selected', attempt: input.attempt, choice, escalated });

    const tokenCap = this.options.maxTokens ?? 0;
    const costCap = this.options.maxCostUsd ?? 0;
    const tokensLeft = tokenCap > 0 ? Math.max(1, tokenCap - this.spentTokens) : Number.POSITIVE_INFINITY;
    const costLeft = costCap > 0 ? costCap - this.spentUsd : Number.POSITIVE_INFINITY;
    const attemptBudget = Math.floor(Math.min(this.config.attemptTokenBudget, tokensLeft));

    const toolset = createWorktreeToolset({
      workdir: input.workdir,
      permissions: this.permissions,
      commandTimeoutMs: this.config.commandTimeoutMs,
      maxOutputChars: this.config.maxToolOutputChars,
    });

    const sessionId = `verified-run-${randomUUID().slice(0, 8)}-a${input.attempt}`;
    const loop = (this.options.createLoop ?? defaultCreateLoop)({
      sessionId,
      goal: input.goal,
      config: {
        maxSteps: this.config.maxStepsPerAttempt,
        maxBudget: attemptBudget,
        securityMode: 'sandbox',
        // Tool timeout in the executor must outlast the shell timeout.
        stepTimeoutMs: this.config.commandTimeoutMs + 5_000,
        enableStreaming: false,
      },
    });

    let cacheRead = 0;
    let cacheWrite = 0;
    let budgetStopped = false;
    const usageNow = (state: AgentState): UsageTotals => ({
      inputTokens: state.inputTokensUsed,
      outputTokens: state.outputTokensUsed,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
    });

    loop.on('step:complete', (state, result) => {
      const usage = extractCacheUsage(stepUsage(result));
      cacheRead += usage.cacheReadTokens;
      cacheWrite += usage.cacheWriteTokens;
      if (computeCostUsd(choice, usageNow(state), this.cache) >= costLeft && !budgetStopped) {
        budgetStopped = true;
        loop.cancel();
      }
    });

    input.signal?.addEventListener('abort', () => loop.cancel(), { once: true });

    let failure: string | undefined;
    let finalState: AgentState;
    try {
      const model = await this.options.createModel(choice);
      finalState = await loop.run(model, buildAgentMessages(input), toolset.tools, toolset.execute, choice.provider);
    } catch (error: unknown) {
      failure = error instanceof Error ? error.message : String(error);
      finalState = loop.getState();
    }

    const inputTokens = finalState.inputTokensUsed;
    const outputTokens = finalState.outputTokensUsed;
    const tokens = inputTokens + outputTokens > 0 ? inputTokens + outputTokens : finalState.usedBudget;
    const costUsd = computeCostUsd(choice, usageNow(finalState), this.cache);
    this.spentTokens += tokens;
    this.spentUsd += costUsd;

    // A failure before any tokens were spent is a setup problem (auth, model
    // unavailable): surface it so the loop records an agent error. After real
    // spend, report it in the summary and let the verifier judge the worktree.
    if (failure !== undefined && tokens === 0) throw new Error(failure);

    const summary = this.summarize(finalState, failure, budgetStopped);
    const cacheHitRate = inputTokens > 0 && cacheRead + cacheWrite > 0 ? cacheRead / inputTokens : undefined;
    return { summary, tokensUsed: tokens, costUsd, model: choice.model, cacheHitRate };
  }

  private summarize(state: AgentState, failure: string | undefined, budgetStopped: boolean): string {
    if (budgetStopped) return 'Stopped mid-attempt: the run cost budget was reached.';
    if (failure !== undefined) return `Agent error after partial work: ${failure}`;
    return (state.finalResult?.summary ?? 'Agent finished without a summary.').slice(0, 500);
  }
}

function defaultCreateLoop(args: CreateLoopArgs): AgentLoop {
  return new AgentExecutor(args.sessionId, args.sessionId, args.goal, args.config);
}

// Default wiring (real providers)

export interface DefaultRunnerArgs {
  goal: string;
  /** Comma separated ladder, cheapest first; a single value pins the model */
  model?: string;
  config?: Partial<ExecutorRunnerConfig>;
  maxTokens?: number;
  maxCostUsd?: number;
  env?: NodeJS.ProcessEnv;
  onEvent?: (event: RunnerEvent) => void;
}

/** Build a runner on the configured providers via the smart router. */
export async function createDefaultExecutorRunner(args: DefaultRunnerArgs): Promise<ExecutorRunner> {
  const { aiProvider } = await import('../providers/ai-sdk.js');
  const env = args.env ?? process.env;
  const modelSpec = args.model ?? (env['PROFCLAW_RUN_MODEL']?.trim() || undefined);
  const ladder = buildModelLadder(args.goal, new Set(aiProvider.getConfiguredProviders()), modelSpec);
  return new ExecutorRunner({
    ladder,
    createModel: (choice) => aiProvider.getModel(choice.provider, choice.model),
    config: args.config,
    env,
    maxTokens: args.maxTokens,
    maxCostUsd: args.maxCostUsd,
    onEvent: args.onEvent,
  });
}
