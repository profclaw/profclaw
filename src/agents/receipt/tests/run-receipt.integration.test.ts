import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runVerifiedGoal } from '../../verified-run.js';
import type { AgentAttemptInput, AgentAttemptResult, AgentRunner } from '../../verified-run.js';
import type { RunWorkspace, WorkspaceChange } from '../../verified-run-git.js';
import type { Verifier, VerifierResult } from '../../verifier.js';
import { ReceiptWriter } from '../receipt-writer.js';
import { verifyReceiptText, parseReceiptText } from '../receipt-verify.js';
import type { ReceiptEvent } from '../receipt-types.js';

class FakeWorkspace implements RunWorkspace {
  path = '/fake/ws';
  branch = 'profclaw/run-test';
  files = new Map<string, string>();
  private snapshots = new Map<string, Map<string, string>>();
  private counter = 0;
  private snap(): string {
    const id = `ref${this.counter++}`;
    this.snapshots.set(id, new Map(this.files));
    return id;
  }
  async prepare(): Promise<string> { return this.snap(); }
  async checkpoint(): Promise<string> { return this.snap(); }
  async restore(ref: string): Promise<void> { this.files = new Map(this.snapshots.get(ref)); }
  async changedFiles(): Promise<WorkspaceChange[]> {
    return [...this.files.keys()].map((relPath) => ({ path: join(this.path, relPath), relPath, status: 'created' as const, original: null }));
  }
  async dispose(): Promise<void> { return; }
}

const res = (passed: boolean, output: string): VerifierResult => ({ passed, exitCode: passed ? 0 : 1, timedOut: false, durationMs: 1, output, truncated: false });

class ScriptedVerifier implements Verifier {
  calls = 0;
  constructor(private readonly results: VerifierResult[]) {}
  async verify(): Promise<VerifierResult> { return this.results[Math.min(this.calls++, this.results.length - 1)]; }
}

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'receipt-int-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('runVerifiedGoal receipt', () => {
  it('records a verifiable receipt: baseline, a rolled back attempt, then a verified one', async () => {
    const ws = new FakeWorkspace();
    const agent: AgentRunner = {
      async runAttempt(input: AgentAttemptInput): Promise<AgentAttemptResult> {
        ws.files.set('fix.js', `attempt ${input.attempt} API_KEY=sk-abcdefghijklmnopqrstuvwx`);
        return {
          summary: 's', tokensUsed: 150, costUsd: 0.02, model: 'fake-model',
          usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 20, cacheWriteTokens: 5 },
        };
      },
    };
    const verifier = new ScriptedVerifier([
      res(false, 'FAIL one'),
      res(false, 'FAIL one\nFAIL two\nFAIL three'),
      res(true, 'ok'),
    ]);
    const path = join(dir, 'receipt.jsonl');
    const receipt = new ReceiptWriter({ path });
    const result = await runVerifiedGoal({
      goal: 'fix the bug',
      verifyCommand: 'pnpm test',
      agent,
      createVerifier: () => verifier,
      projectRoot: dir,
      reportDir: dir,
      workspace: ws,
      checkpoints: { save: async (): Promise<void> => undefined },
      runId: 'test',
      env: {},
      limits: { baseline: 1 },
      receipt,
      toolInfo: { name: 'profclaw', version: 'test' },
    });
    expect(result.verified).toBe(true);

    const text = await readFile(path, 'utf-8');
    const v = verifyReceiptText(text);
    expect(v.ok).toBe(true);

    const events: ReceiptEvent[] = parseReceiptText(text);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('run_start');
    expect(types[types.length - 1]).toBe('run_end');
    expect(types).toContain('rollback');
    expect(types.filter((t) => t === 'attempt_start').length).toBe(2);
    expect(types.filter((t) => t === 'usage').length).toBe(2);
    expect(types.filter((t) => t === 'verifier_result').length).toBe(3);

    const usage = events.find((e) => e.type === 'usage');
    expect(usage?.type === 'usage' && usage.data.cacheReadTokens).toBe(20);
    const end = events[events.length - 1];
    expect(end.type === 'run_end' && end.data.verified).toBe(true);
    expect(end.type === 'run_end' && end.data.totals.attempts).toBe(2);
    expect(text).not.toContain('sk-abcdefghijklmnopqrstuvwx');

    // Tamper: flip the verified flag in run_end without rehashing.
    const tampered = text.replace('"verified":true', '"verified":false');
    expect(tampered).not.toBe(text);
    const bad = verifyReceiptText(tampered);
    expect(bad.ok).toBe(false);
    expect(bad.firstBadSeq).toBe(events.length - 1);
  });

  it('a run without a receipt option still works, and a crashed loop leaves a truncated receipt', async () => {
    const ws = new FakeWorkspace();
    const agent: AgentRunner = { runAttempt: async () => ({ summary: 's', tokensUsed: 0, costUsd: 0 }) };
    const path = join(dir, 'receipt.jsonl');
    const receipt = new ReceiptWriter({ path });
    const boom: Verifier = { verify: async (): Promise<VerifierResult> => { throw new Error('verifier exploded'); } };
    await expect(
      runVerifiedGoal({
        goal: 'g', verifyCommand: 'x', agent, createVerifier: () => boom, projectRoot: dir, reportDir: dir,
        workspace: ws, checkpoints: { save: async (): Promise<void> => undefined }, runId: 't', env: {}, limits: { baseline: 0 }, receipt,
      }),
    ).rejects.toThrow('verifier exploded');
    const v = verifyReceiptText(await readFile(path, 'utf-8'));
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('truncated');
  });
});
