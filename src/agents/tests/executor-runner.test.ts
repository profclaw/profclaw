import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LanguageModel, ModelMessage, ToolSet } from 'ai';
import {
  ExecutorRunner,
  buildModelLadder,
  computeCostUsd,
  resolveRunnerConfig,
} from '../executor-runner.js';
import type { AgentLoop, CreateLoopArgs, ModelChoice } from '../executor-runner.js';
import type { ToolExecuteHandler } from '../executor.js';
import type { AgentState } from '../types.js';
import { runVerifiedGoal } from '../verified-run.js';
import type { AgentAttemptInput } from '../verified-run.js';
import type { RunWorkspace, WorkspaceChange } from '../verified-run-git.js';
import type { Verifier, VerifierResult } from '../verifier.js';
import { getPromptCacheConfig } from '../../providers/prompt-cache.js';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  createContextualLogger: vi.fn(() => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  })),
}));

// Fakes

interface FakeStep {
  input: number;
  output: number;
  cacheRead?: number;
}

interface FakeScript {
  steps: FakeStep[];
  toolCalls?: Array<[string, Record<string, unknown>]>;
  failWith?: string;
}

class FakeLoop implements AgentLoop {
  static created: FakeLoop[] = [];
  static scripts: FakeScript[] = [];
  static defaultScript: FakeScript = { steps: [{ input: 1000, output: 1000 }] };

  args: CreateLoopArgs;
  models: unknown[] = [];
  messages: ModelMessage[] = [];
  cancelled = false;
  toolResults: unknown[] = [];
  private listeners: Array<(state: AgentState, result: unknown) => void> = [];
  private state: AgentState;

  constructor(args: CreateLoopArgs) {
    this.args = args;
    this.state = {
      sessionId: args.sessionId,
      conversationId: args.sessionId,
      status: 'idle',
      goal: args.goal,
      currentStep: 0,
      maxBudget: args.config.maxBudget ?? 0,
      usedBudget: 0,
      inputTokensUsed: 0,
      outputTokensUsed: 0,
      toolCallHistory: [],
      pendingToolCalls: [],
      context: {},
      createdAt: 0,
      updatedAt: 0,
    };
    FakeLoop.created.push(this);
  }

  on(_event: 'step:complete', listener: (state: AgentState, result: unknown) => void): unknown {
    this.listeners.push(listener);
    return this;
  }

  cancel(): void {
    this.cancelled = true;
  }

  getState(): AgentState {
    return { ...this.state };
  }

  async run(
    model: LanguageModel,
    messages: ModelMessage[],
    _tools: ToolSet,
    onToolExecute?: ToolExecuteHandler,
  ): Promise<AgentState> {
    const script = FakeLoop.scripts.shift() ?? FakeLoop.defaultScript;
    this.models.push(model);
    this.messages = messages;
    for (const [name, args] of script.toolCalls ?? []) {
      this.toolResults.push(await onToolExecute?.(name, args));
    }
    for (const step of script.steps) {
      if (this.cancelled) break;
      this.state.inputTokensUsed += step.input;
      this.state.outputTokensUsed += step.output;
      this.state.usedBudget += step.input + step.output;
      this.state.currentStep++;
      for (const l of this.listeners) {
        l(this.state, { usage: { inputTokens: step.input, outputTokens: step.output, cachedInputTokens: step.cacheRead ?? 0 } });
      }
    }
    if (script.failWith) throw new Error(script.failWith);
    this.state.status = this.cancelled ? 'cancelled' : 'completed';
    this.state.finalResult = {
      success: true,
      summary: 'fake done',
      artifacts: [],
      stopReason: 'done',
      totalSteps: this.state.currentStep,
      totalTokens: this.state.usedBudget,
    };
    return this.state;
  }
}

class StaticWorkspace implements RunWorkspace {
  branch = 'profclaw/run-test';
  constructor(readonly path: string) {}
  async prepare(): Promise<string> {
    return 'ref0';
  }
  async checkpoint(): Promise<string> {
    return 'ref';
  }
  async restore(): Promise<void> {
    await writeFile(join(this.path, '.restored'), '');
  }
  async changedFiles(): Promise<WorkspaceChange[]> {
    return [];
  }
  async dispose(): Promise<void> {}
}

/** Fails until the given call number, then passes; the failure count keeps shrinking. */
class CountingVerifier implements Verifier {
  private calls = 0;
  constructor(private readonly passOn: number) {}
  async verify(): Promise<VerifierResult> {
    this.calls++;
    const passed = this.calls >= this.passOn;
    return {
      passed,
      exitCode: passed ? 0 : 1,
      output: passed ? '' : Array.from({ length: 10 - this.calls }, () => 'error: nope').join('\n'),
      durationMs: 1,
      timedOut: false,
    };
  }
}

const LADDER: ModelChoice[] = [
  { provider: 'anthropic', model: 'cheap', costPer1MInput: 10, costPer1MOutput: 30, tier: 'trivial' },
  { provider: 'anthropic', model: 'mid', costPer1MInput: 10, costPer1MOutput: 30, tier: 'standard' },
  { provider: 'anthropic', model: 'top', costPer1MInput: 10, costPer1MOutput: 30, tier: 'complex' },
];

let workdir: string;

function makeRunner(overrides: Partial<ConstructorParameters<typeof ExecutorRunner>[0]> = {}): {
  runner: ExecutorRunner;
  modelsRequested: string[];
} {
  const modelsRequested: string[] = [];
  const runner = new ExecutorRunner({
    ladder: LADDER,
    createModel: async (choice) => {
      modelsRequested.push(choice.model);
      return { id: choice.model } as unknown as LanguageModel;
    },
    createLoop: (args) => new FakeLoop(args),
    env: {},
    ...overrides,
  });
  return { runner, modelsRequested };
}

function attempt(n: number, feedback?: string): AgentAttemptInput {
  return { goal: 'fix it', attempt: n, feedback, workdir, verifyCommand: 'pnpm test' };
}

beforeEach(async () => {
  FakeLoop.created = [];
  FakeLoop.scripts = [];
  FakeLoop.defaultScript = { steps: [{ input: 1000, output: 1000 }] };
  workdir = await realpath(await mkdtemp(join(tmpdir(), 'runner-')));
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

// Tests

describe('cascade escalation', () => {
  it('stays on the cheap model until two failures in a row, then moves up a tier', async () => {
    const { runner, modelsRequested } = makeRunner();
    await runner.runAttempt(attempt(1));
    await runner.runAttempt(attempt(2, 'fail 1'));
    await runner.runAttempt(attempt(3, 'fail 2'));
    await runner.runAttempt(attempt(4, 'fail 3'));
    await runner.runAttempt(attempt(5, 'fail 4'));
    await runner.runAttempt(attempt(6, 'fail 5'));
    expect(modelsRequested).toEqual(['cheap', 'cheap', 'mid', 'mid', 'top', 'top']);
  });

  it('never goes past the top tier', async () => {
    const { runner, modelsRequested } = makeRunner({ config: { escalateAfter: 1 } });
    for (let i = 1; i <= 6; i++) await runner.runAttempt(attempt(i, i > 1 ? 'x' : undefined));
    expect(modelsRequested.at(-1)).toBe('top');
  });

  it('threshold comes from config or PROFCLAW_RUN_ESCALATE_AFTER, 0 disables', async () => {
    expect(resolveRunnerConfig({}, { PROFCLAW_RUN_ESCALATE_AFTER: '3' }).escalateAfter).toBe(3);
    expect(resolveRunnerConfig({ escalateAfter: 1 }, { PROFCLAW_RUN_ESCALATE_AFTER: '3' }).escalateAfter).toBe(1);
    const { runner, modelsRequested } = makeRunner({ config: { escalateAfter: 0 } });
    for (let i = 1; i <= 5; i++) await runner.runAttempt(attempt(i, i > 1 ? 'x' : undefined));
    expect(new Set(modelsRequested)).toEqual(new Set(['cheap']));
  });

  it('escalates through runVerifiedGoal when the verifier fails twice in a row', async () => {
    const { runner, modelsRequested } = makeRunner();
    const result = await runVerifiedGoal({
      goal: 'fix it',
      verifyCommand: 'pnpm test',
      agent: runner,
      projectRoot: workdir,
      reportDir: join(workdir, 'report'),
      workspace: new StaticWorkspace(workdir),
      checkpoints: { save: async () => undefined },
      createVerifier: () => new CountingVerifier(3),
      limits: { maxAttempts: 5 },
      env: {},
    });
    expect(result.verified).toBe(true);
    expect(modelsRequested).toEqual(['cheap', 'cheap', 'mid']);
    expect(result.attempts.map((a) => a.model)).toEqual(['cheap', 'cheap', 'mid']);
  });
});

describe('budget', () => {
  it('reports tokens and dollars per attempt, and the loop stops on the cost budget', async () => {
    // 100k in + 0 out at $10 per 1M = $1.00 per attempt
    FakeLoop.defaultScript = { steps: [{ input: 100_000, output: 0 }] };
    const { runner } = makeRunner({ maxCostUsd: 2.5 });
    const result = await runVerifiedGoal({
      goal: 'fix it',
      verifyCommand: 'pnpm test',
      agent: runner,
      projectRoot: workdir,
      reportDir: join(workdir, 'report'),
      workspace: new StaticWorkspace(workdir),
      checkpoints: { save: async () => undefined },
      createVerifier: () => new CountingVerifier(99),
      limits: { maxAttempts: 10, maxCostUsd: 2.5, breakerThreshold: 99 },
      env: {},
    });
    expect(result.stopReason).toBe('cost_budget');
    expect(result.attempts).toHaveLength(3);
    expect(result.attempts[0].tokensUsed).toBe(100_000);
    expect(result.attempts[0].costUsd).toBeCloseTo(1, 6);
    expect(result.totalCostUsd).toBeCloseTo(3, 6);
  });

  it('cancels an attempt mid-flight once the remaining cost budget is spent', async () => {
    FakeLoop.defaultScript = {
      steps: [
        { input: 100_000, output: 0 },
        { input: 100_000, output: 0 },
        { input: 100_000, output: 0 },
      ],
    };
    const { runner } = makeRunner({ maxCostUsd: 1.5 });
    const result = await runner.runAttempt(attempt(1));
    expect(FakeLoop.created[0].cancelled).toBe(true);
    expect(result.tokensUsed).toBe(200_000);
    expect(result.costUsd).toBeCloseTo(2, 6);
    expect(result.summary).toMatch(/cost budget/);
  });

  it('caps each attempt to the remaining token budget', async () => {
    const { runner } = makeRunner({ maxTokens: 5_000, config: { attemptTokenBudget: 100_000 } });
    await runner.runAttempt(attempt(1));
    expect(FakeLoop.created[0].args.config.maxBudget).toBe(5_000);
    await runner.runAttempt(attempt(2, 'x'));
    // 2000 tokens spent in attempt 1
    expect(FakeLoop.created[1].args.config.maxBudget).toBe(3_000);
  });

  it('prices cache reads with the cache multiplier and reports the hit rate', async () => {
    FakeLoop.defaultScript = { steps: [{ input: 100_000, output: 0, cacheRead: 80_000 }] };
    const { runner } = makeRunner();
    const result = await runner.runAttempt(attempt(1));
    // 20k fresh + 80k * 0.1 = 28k units at $10/1M
    expect(result.costUsd).toBeCloseTo(0.28, 6);
    expect(result.cacheHitRate).toBeCloseTo(0.8, 6);
    expect(
      computeCostUsd(LADDER[0], { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, getPromptCacheConfig({})),
    ).toBeCloseTo(10, 6);
  });

  it('throws when the agent fails before spending anything, keeps partial spend otherwise', async () => {
    FakeLoop.scripts = [{ steps: [], failWith: 'no api key' }];
    const { runner } = makeRunner();
    await expect(runner.runAttempt(attempt(1))).rejects.toThrow('no api key');

    FakeLoop.scripts = [{ steps: [{ input: 10, output: 10 }], failWith: 'boom' }];
    const result = await runner.runAttempt(attempt(2, 'x'));
    expect(result.tokensUsed).toBe(20);
    expect(result.summary).toMatch(/boom/);
  });
});

describe('worktree confinement', () => {
  it('passes the goal and trimmed verifier feedback to the agent', async () => {
    const { runner } = makeRunner();
    await runner.runAttempt(attempt(2, 'FAIL src/a.test.ts expected 1'));
    const user = FakeLoop.created[0].messages.find((m) => m.role === 'user');
    expect(String(user?.content)).toContain('Goal: fix it');
    expect(String(user?.content)).toContain('FAIL src/a.test.ts expected 1');
    expect(String(user?.content)).toContain('pnpm test');
  });

  it('runs tools with the worktree as cwd and root', async () => {
    FakeLoop.defaultScript = {
      steps: [{ input: 1, output: 1 }],
      toolCalls: [
        ['write_file', { path: 'sub/a.txt', content: 'hi' }],
        ['bash', { command: 'pwd && cat sub/a.txt' }],
      ],
    };
    const { runner } = makeRunner();
    await runner.runAttempt(attempt(1));
    expect(await readFile(join(workdir, 'sub', 'a.txt'), 'utf-8')).toBe('hi');
    const bash = FakeLoop.created[0].toolResults[1] as { success: boolean; data: { output: string } };
    expect(bash.success).toBe(true);
    expect(bash.data.output).toContain(workdir);
    expect(bash.data.output).toContain('hi');
  });

  it('rejects path escapes, symlink escapes and .git writes', async () => {
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'outside-')));
    try {
      await symlink(outside, join(workdir, 'link'));
      await mkdir(join(workdir, '.git'));
      FakeLoop.defaultScript = {
        steps: [{ input: 1, output: 1 }],
        toolCalls: [
          ['write_file', { path: '../escape.txt', content: 'x' }],
          ['write_file', { path: join(outside, 'abs.txt'), content: 'x' }],
          ['write_file', { path: 'link/sneaky.txt', content: 'x' }],
          ['write_file', { path: '.git/hooks-x', content: 'x' }],
          ['read_file', { path: '/etc/passwd' }],
        ],
      };
      const { runner } = makeRunner();
      await runner.runAttempt(attempt(1));
      const results = FakeLoop.created[0].toolResults as Array<{ success: boolean }>;
      expect(results.every((r) => r.success === false)).toBe(true);
      expect(existsSync(join(outside, 'sneaky.txt'))).toBe(false);
      expect(existsSync(join(outside, 'abs.txt'))).toBe(false);
      expect(existsSync(join(workdir, '..', 'escape.txt'))).toBe(false);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('denies pushes and PR commands through the permission model', async () => {
    FakeLoop.defaultScript = {
      steps: [{ input: 1, output: 1 }],
      toolCalls: [
        ['bash', { command: 'git push origin HEAD' }],
        ['bash', { command: 'echo ok && git -C . push --force' }],
        ['bash', { command: 'gh pr create --fill' }],
        ['git_push', {}],
        ['bash', { command: 'echo fine' }],
      ],
    };
    const { runner } = makeRunner();
    await runner.runAttempt(attempt(1));
    const results = FakeLoop.created[0].toolResults as Array<{ success: boolean }>;
    expect(results.map((r) => r.success)).toEqual([false, false, false, false, true]);
  });
});

describe('model ladder', () => {
  it('starts at the router pick and only climbs upward, without duplicates', () => {
    const ladder = buildModelLadder('rename a variable', new Set(['anthropic', 'openai']));
    expect(ladder.length).toBeGreaterThan(0);
    const ids = ladder.map((c) => c.model);
    expect(new Set(ids).size).toBe(ids.length);
    const order = ['trivial', 'standard', 'complex'];
    const idx = ladder.map((c) => order.indexOf(c.tier as string));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it('pins an explicit comma separated ladder in order', () => {
    const ladder = buildModelLadder('x', new Set(), 'anthropic/model-a, anthropic/model-b');
    expect(ladder.map((c) => c.model)).toEqual(['model-a', 'model-b']);
    expect(ladder.every((c) => c.tier === 'pinned')).toBe(true);
  });

  it('errors with no providers and no --model', () => {
    expect(() => buildModelLadder('x', new Set())).toThrow(/No model provider/);
  });
});
