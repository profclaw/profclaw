import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveLimits, runVerifiedGoal, defaultFailureScore } from '../verified-run.js';
import type { AgentAttemptInput, AgentAttemptResult, AgentRunner } from '../verified-run.js';
import { GitRunWorkspace } from '../verified-run-git.js';
import type { RunWorkspace, WorkspaceChange } from '../verified-run-git.js';
import { CommandVerifier } from '../verifier.js';
import type { Verifier, VerifierResult } from '../verifier.js';

// Fakes

class FakeWorkspace implements RunWorkspace {
  path = '/fake/ws';
  branch = 'profclaw/run-test';
  files = new Map<string, string>();
  private snapshots = new Map<string, Map<string, string>>();
  restores: string[] = [];
  disposed = false;
  private counter = 0;

  async prepare(): Promise<string> {
    return this.snap();
  }
  private snap(): string {
    const id = `ref${this.counter++}`;
    this.snapshots.set(id, new Map(this.files));
    return id;
  }
  async checkpoint(): Promise<string> {
    return this.snap();
  }
  async restore(ref: string): Promise<void> {
    this.restores.push(ref);
    this.files = new Map(this.snapshots.get(ref));
  }
  async changedFiles(): Promise<WorkspaceChange[]> {
    return [...this.files.keys()].map((relPath) => ({
      path: join(this.path, relPath),
      relPath,
      status: 'created' as const,
      original: null,
    }));
  }
  async dispose(): Promise<void> {
    this.disposed = true;
  }
}

/** Agent whose behaviour per attempt is scripted. */
class ScriptedAgent implements AgentRunner {
  inputs: AgentAttemptInput[] = [];
  constructor(
    private readonly ws: FakeWorkspace,
    private readonly script: Array<(ws: FakeWorkspace) => void | Promise<void>>,
    private readonly cost: { tokens: number; usd: number } = { tokens: 100, usd: 0.01 },
  ) {}
  async runAttempt(input: AgentAttemptInput): Promise<AgentAttemptResult> {
    this.inputs.push(input);
    const step = this.script[Math.min(input.attempt - 1, this.script.length - 1)];
    await step(this.ws);
    return { summary: `attempt ${input.attempt}`, tokensUsed: this.cost.tokens, costUsd: this.cost.usd };
  }
}

const fail = (output: string): VerifierResult => ({
  passed: false, exitCode: 1, timedOut: false, durationMs: 1, output, truncated: false,
});
const pass = (): VerifierResult => ({
  passed: true, exitCode: 0, timedOut: false, durationMs: 1, output: 'ok', truncated: false,
});

class ScriptedVerifier implements Verifier {
  calls = 0;
  constructor(private readonly results: VerifierResult[]) {}
  async verify(): Promise<VerifierResult> {
    return this.results[Math.min(this.calls++, this.results.length - 1)];
  }
}

const noCheckpoints = { save: async (): Promise<void> => undefined };

let reportDir: string;
beforeEach(async () => {
  reportDir = await mkdtemp(join(tmpdir(), 'vrun-report-'));
});
afterEach(async () => {
  await rm(reportDir, { recursive: true, force: true });
});

function run(
  ws: FakeWorkspace,
  agent: AgentRunner,
  verifier: Verifier,
  limits: Parameters<typeof runVerifiedGoal>[0]['limits'] = {},
) {
  return runVerifiedGoal({
    goal: 'fix the bug',
    verifyCommand: 'pnpm test',
    agent,
    createVerifier: () => verifier,
    projectRoot: reportDir,
    reportDir,
    workspace: ws,
    checkpoints: noCheckpoints,
    runId: 'test',
    env: {},
    limits,
  });
}

describe('resolveLimits', () => {
  it('prefers flags over env over defaults', () => {
    const l = resolveLimits({ maxAttempts: 2 }, { PROFCLAW_RUN_MAX_ATTEMPTS: '9', PROFCLAW_RUN_MAX_COST_USD: '1.5' });
    expect(l.maxAttempts).toBe(2);
    expect(l.maxCostUsd).toBe(1.5);
    expect(l.breakerThreshold).toBe(3);
  });

  it('ignores invalid env values and clamps attempts to at least 1', () => {
    const l = resolveLimits({}, { PROFCLAW_RUN_MAX_ATTEMPTS: 'abc', PROFCLAW_RUN_BREAKER_THRESHOLD: '0' });
    expect(l.maxAttempts).toBe(5);
    expect(l.breakerThreshold).toBe(1);
  });
});

describe('defaultFailureScore', () => {
  it('is 0 on pass and counts failure lines otherwise', () => {
    expect(defaultFailureScore(pass())).toBe(0);
    expect(defaultFailureScore(fail('FAIL a\nok b\nError: c'))).toBe(2);
    expect(defaultFailureScore(fail('something odd'))).toBe(1);
  });
});

describe('runVerifiedGoal', () => {
  it('stops immediately when the first attempt verifies', async () => {
    const ws = new FakeWorkspace();
    const agent = new ScriptedAgent(ws, [(w) => void w.files.set('a.ts', 'x')]);
    const res = await run(ws, agent, new ScriptedVerifier([pass()]));
    expect(res.verified).toBe(true);
    expect(res.stopReason).toBe('verified');
    expect(res.attempts).toHaveLength(1);
    expect(res.changedFiles.map((f) => f.relPath)).toEqual(['a.ts']);
    expect(res.totalTokens).toBe(100);
  });

  it('feeds trimmed failure back and succeeds on retry', async () => {
    const ws = new FakeWorkspace();
    const agent = new ScriptedAgent(ws, [() => undefined]);
    const res = await run(ws, agent, new ScriptedVerifier([fail('FAIL foo.test'), pass()]));
    expect(res.verified).toBe(true);
    expect(res.attempts.map((a) => a.outcome)).toEqual(['improved', 'verified']);
    expect(agent.inputs[0].feedback).toBeUndefined();
    expect(agent.inputs[1].feedback).toContain('FAIL foo.test');
    expect(agent.inputs[1].feedback).toContain('pnpm test');
  });

  it('rolls back to the last good checkpoint when an attempt is worse', async () => {
    const ws = new FakeWorkspace();
    const agent = new ScriptedAgent(ws, [
      (w) => void w.files.set('good.ts', '1'),
      (w) => void w.files.set('bad.ts', '2'),
      () => undefined,
    ]);
    const verifier = new ScriptedVerifier([
      fail('FAIL one'),
      fail('FAIL one\nFAIL two\nFAIL three'),
      pass(),
    ]);
    const res = await run(ws, agent, verifier);
    expect(res.attempts.map((a) => a.outcome)).toEqual(['improved', 'worse', 'verified']);
    expect(res.attempts[1].rolledBack).toBe(true);
    expect(ws.restores).toHaveLength(1);
    expect([...ws.files.keys()]).toEqual(['good.ts']);
  });

  it('stops at max attempts', async () => {
    const ws = new FakeWorkspace();
    const agent = new ScriptedAgent(ws, [() => undefined]);
    const res = await run(ws, agent, new ScriptedVerifier([fail('FAIL a\nFAIL b'), fail('FAIL a'), fail('FAIL a')]), {
      maxAttempts: 3,
      breakerThreshold: 99,
    });
    expect(res.verified).toBe(false);
    expect(res.stopReason).toBe('max_attempts');
    expect(res.attempts).toHaveLength(3);
  });

  it('stops on the token budget', async () => {
    const ws = new FakeWorkspace();
    const agent = new ScriptedAgent(ws, [() => undefined], { tokens: 600, usd: 0 });
    const res = await run(ws, agent, new ScriptedVerifier([fail('FAIL')]), { maxTokens: 1000, breakerThreshold: 99 });
    expect(res.stopReason).toBe('token_budget');
    expect(res.attempts).toHaveLength(2);
  });

  it('stops on the dollar budget', async () => {
    const ws = new FakeWorkspace();
    const agent = new ScriptedAgent(ws, [() => undefined], { tokens: 1, usd: 0.4 });
    const res = await run(ws, agent, new ScriptedVerifier([fail('FAIL')]), { maxCostUsd: 1, breakerThreshold: 99 });
    expect(res.stopReason).toBe('cost_budget');
    expect(res.totalCostUsd).toBeCloseTo(1.2);
  });

  it('trips the circuit breaker after repeated non-improving attempts', async () => {
    const ws = new FakeWorkspace();
    const agent = new ScriptedAgent(ws, [() => undefined]);
    const res = await run(ws, agent, new ScriptedVerifier([fail('FAIL')]), {
      maxAttempts: 10,
      breakerThreshold: 3,
    });
    // attempt 1 improves from infinity, attempts 2-4 are unchanged failures
    expect(res.stopReason).toBe('circuit_open');
    expect(res.attempts).toHaveLength(4);
  });

  it('treats an agent crash as a rolled back failed attempt and continues', async () => {
    const ws = new FakeWorkspace();
    const agent = new ScriptedAgent(ws, [
      () => {
        throw new Error('model exploded');
      },
      () => undefined,
    ]);
    const res = await run(ws, agent, new ScriptedVerifier([pass()]));
    expect(res.attempts[0].outcome).toBe('agent_error');
    expect(res.attempts[0].agentError).toBe('model exploded');
    expect(res.attempts[0].rolledBack).toBe(true);
    expect(res.verified).toBe(true);
    expect(agent.inputs[1].feedback).toContain('model exploded');
  });

  it('honours an abort signal', async () => {
    const ws = new FakeWorkspace();
    const controller = new AbortController();
    controller.abort();
    const res = await runVerifiedGoal({
      goal: 'g', verifyCommand: 'v', agent: new ScriptedAgent(ws, [() => undefined]),
      createVerifier: () => new ScriptedVerifier([pass()]), projectRoot: reportDir, reportDir,
      workspace: ws, checkpoints: noCheckpoints, env: {}, signal: controller.signal,
    });
    expect(res.stopReason).toBe('aborted');
    expect(res.attempts).toHaveLength(0);
  });

  it('writes an evidence report with goal, attempts, verifier, files and cost', async () => {
    const ws = new FakeWorkspace();
    const agent = new ScriptedAgent(ws, [(w) => void w.files.set('src/a.ts', 'x')]);
    const res = await run(ws, agent, new ScriptedVerifier([fail('FAIL foo'), pass()]));
    expect(res.reportPath).toBeDefined();
    const md = await readFile(res.reportPath as string, 'utf-8');
    expect(md).toContain('VERIFIED');
    expect(md).toContain('fix the bug');
    expect(md).toContain('`pnpm test`');
    expect(md).toContain('FAIL foo');
    expect(md).toContain('src/a.ts');
    expect(md).toContain('$0.0200');
    expect(md).toContain('never pushes');
    expect(md.includes(String.fromCharCode(0x2013)) || md.includes(String.fromCharCode(0x2014))).toBe(false);
  });

  it('removes the worktree only when asked', async () => {
    const ws = new FakeWorkspace();
    await runVerifiedGoal({
      goal: 'g', verifyCommand: 'v', agent: new ScriptedAgent(ws, [() => undefined]),
      createVerifier: () => new ScriptedVerifier([pass()]), projectRoot: reportDir, reportDir,
      workspace: ws, checkpoints: noCheckpoints, env: {}, removeWorktree: true,
    });
    expect(ws.disposed).toBe(true);
  });
});

describe('GitRunWorkspace with a real repo', () => {
  let repo: string;
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf-8' }).trim();

  beforeEach(async () => {
    repo = await realpath(await mkdtemp(join(tmpdir(), 'vrun-repo-')));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@t.t');
    git('config', 'user.name', 't');
    await writeFile(join(repo, 'status.txt'), 'broken\n');
    await mkdir(join(repo, '.profclaw'), { recursive: true });
    await writeFile(join(repo, '.gitignore'), '.profclaw/\n');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('isolates, verifies with a real command, rolls back and reports', async () => {
    // Attempt 1 edits status to "half" (still failing). Attempt 2 makes a
    // worse failure and must be rolled back. Attempt 3 fixes it.
    const agent: AgentRunner = {
      async runAttempt(input) {
        const file = join(input.workdir, 'status.txt');
        if (input.attempt === 1) await writeFile(file, 'half\n');
        if (input.attempt === 2) {
          await writeFile(file, 'worse\n');
          await writeFile(join(input.workdir, 'junk.txt'), 'junk\n');
        }
        if (input.attempt === 3) await writeFile(file, 'fixed\n');
        return { summary: `a${input.attempt}`, tokensUsed: 10, costUsd: 0 };
      },
    };
    // Verify prints more failure lines for "worse", one for "half".
    const verifyCmd =
      'v=$(cat status.txt); [ "$v" = fixed ] && exit 0; ' +
      'if [ "$v" = worse ]; then echo "FAIL a"; echo "FAIL b"; echo "FAIL c"; else echo "FAIL a"; fi; exit 1';

    const res = await runVerifiedGoal({
      goal: 'make it fixed',
      verifyCommand: verifyCmd,
      agent,
      createVerifier: (cwd) => new CommandVerifier(verifyCmd, { cwd, timeoutMs: 10_000, maxOutputChars: 1000 }),
      projectRoot: repo,
      env: {},
      limits: { breakerThreshold: 99 },
    });

    expect(res.verified).toBe(true);
    expect(res.attempts.map((a) => a.outcome)).toEqual(['improved', 'worse', 'verified']);
    expect(res.branch).toBe('profclaw/run-' + res.runId);
    // junk from the rolled back attempt is gone
    expect(existsSync(join(res.workspacePath, 'junk.txt'))).toBe(false);
    expect(res.changedFiles).toEqual([{ relPath: 'status.txt', status: 'modified' }]);
    expect(res.diff).toContain('-broken');
    expect(res.diff).toContain('+fixed');
    // main tree untouched, nothing pushed (no remote exists)
    expect(await readFile(join(repo, 'status.txt'), 'utf-8')).toBe('broken\n');
    expect(git('branch', '--list', res.branch)).toContain(res.branch);
    expect(existsSync(res.reportPath as string)).toBe(true);
  });
});
