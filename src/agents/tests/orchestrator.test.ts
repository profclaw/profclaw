import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentOrchestrator, getAgentOrchestrator } from '../orchestrator.js';
import type { SubAgentTask } from '../orchestrator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Instant-resolve apiCall — returns the prompt echoed back. */
function makeInstantApi(prefix = 'result:'): (prompt: string) => Promise<string> {
  return (prompt) => Promise.resolve(`${prefix} ${prompt}`);
}

/** apiCall that resolves after `delayMs`. */
function makeSlowApi(delayMs: number, result = 'slow-result'): (prompt: string) => Promise<string> {
  return () =>
    new Promise<string>((resolve) => {
      setTimeout(() => resolve(result), delayMs);
    });
}

/** apiCall that always rejects. */
function makeFailingApi(message = 'API error'): (prompt: string) => Promise<string> {
  return () => Promise.reject(new Error(message));
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

describe('AgentOrchestrator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // dispatch – all tasks complete
  // -------------------------------------------------------------------------

  it('dispatches 3 tasks and all complete successfully', async () => {
    const orch = new AgentOrchestrator();
    const apiCall = makeInstantApi();

    const promise = orch.dispatch(
      [
        { description: 'Task A', prompt: 'Do A' },
        { description: 'Task B', prompt: 'Do B' },
        { description: 'Task C', prompt: 'Do C' },
      ],
      apiCall,
    );

    // Flush all micro/macro tasks
    await vi.runAllTimersAsync();
    const results = await promise;

    expect(results).toHaveLength(3);
    for (const task of results) {
      expect(task.status).toBe('completed');
      expect(task.result).toMatch(/^result:/);
      expect(task.startedAt).toBeTypeOf('number');
      expect(task.completedAt).toBeTypeOf('number');
      expect(task.tokensUsed).toBe(0);
    }
  });

  // -------------------------------------------------------------------------
  // dispatch – concurrency is respected
  // -------------------------------------------------------------------------

  it('respects maxConcurrent — only N tasks run at once', async () => {
    const orch = new AgentOrchestrator({ maxConcurrent: 2 });

    let concurrent = 0;
    let maxObserved = 0;

    const apiCall = (): Promise<string> => {
      concurrent++;
      maxObserved = Math.max(maxObserved, concurrent);
      return new Promise<string>((resolve) => {
        setTimeout(() => {
          concurrent--;
          resolve('done');
        }, 100);
      });
    };

    const promise = orch.dispatch(
      [
        { description: 'T1', prompt: 'p1' },
        { description: 'T2', prompt: 'p2' },
        { description: 'T3', prompt: 'p3' },
        { description: 'T4', prompt: 'p4' },
      ],
      apiCall,
    );

    // Advance 100 ms — first two tasks complete, next two start.
    vi.advanceTimersByTime(100);
    // Advance another 100 ms — last two tasks complete.
    vi.advanceTimersByTime(100);

    await vi.runAllTimersAsync();
    await promise;

    expect(maxObserved).toBeLessThanOrEqual(2);
  });

  // -------------------------------------------------------------------------
  // runTask – timeout produces failed status
  // -------------------------------------------------------------------------

  it('task timeout marks status as failed', async () => {
    const orch = new AgentOrchestrator({ timeoutMs: 500 });

    const task: SubAgentTask = {
      id: 'timeout-task',
      description: 'Slow task',
      prompt: 'take forever',
      status: 'pending',
      tokensUsed: 0,
    };

    // API that never resolves within timeout
    const apiCall = makeSlowApi(10_000);

    const promise = orch.runTask(task, apiCall);

    // Advance past the 500 ms timeout
    vi.advanceTimersByTime(600);

    const result = await promise;

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/timed out/i);
    expect(result.completedAt).toBeTypeOf('number');
  });

  // -------------------------------------------------------------------------
  // cancel – stops a pending task
  // -------------------------------------------------------------------------

  it('cancel marks a pending task as failed before it runs', async () => {
    const orch = new AgentOrchestrator({ maxConcurrent: 1 });

    // Block the first slot so the second task stays pending
    const apiCall = makeSlowApi(200);

    const promise = orch.dispatch(
      [
        { description: 'Blocker', prompt: 'slow' },
        { description: 'Target', prompt: 'cancel me' },
      ],
      apiCall,
    );

    // Give dispatcher time to start and register tasks
    vi.advanceTimersByTime(10);

    // Find the pending 'Target' task and cancel it
    const status = orch.getStatus();
    const target = status.find((t) => t.description === 'Target');
    expect(target).toBeDefined();
    orch.cancel(target!.id);

    expect(target!.status).toBe('failed');
    expect(target!.error).toMatch(/cancelled/i);

    // Complete the blocker
    vi.advanceTimersByTime(300);
    await vi.runAllTimersAsync();
    await promise;
  });

  // -------------------------------------------------------------------------
  // synthesize – builds correct markdown
  // -------------------------------------------------------------------------

  describe('synthesize', () => {
    it('renders completed tasks with ✓ and their result', () => {
      const orch = new AgentOrchestrator();

      const tasks: SubAgentTask[] = [
        {
          id: '1',
          description: 'Analyse repo',
          prompt: '',
          status: 'completed',
          result: 'Found 3 issues.',
          tokensUsed: 0,
        },
      ];

      const output = orch.synthesize(tasks);

      expect(output).toContain('## Task Results');
      expect(output).toContain('### 1. Analyse repo ✓');
      expect(output).toContain('Found 3 issues.');
    });

    it('renders failed tasks with ✗ and their error', () => {
      const orch = new AgentOrchestrator();

      const tasks: SubAgentTask[] = [
        {
          id: '2',
          description: 'Write report',
          prompt: '',
          status: 'failed',
          error: 'Timed out after 300000ms',
          tokensUsed: 0,
        },
      ];

      const output = orch.synthesize(tasks);

      expect(output).toContain('### 1. Write report ✗');
      expect(output).toContain('Error: Timed out after 300000ms');
    });

    it('renders mixed results in order', () => {
      const orch = new AgentOrchestrator();

      const tasks: SubAgentTask[] = [
        {
          id: 'a',
          description: 'Step 1',
          prompt: '',
          status: 'completed',
          result: 'OK',
          tokensUsed: 0,
        },
        {
          id: 'b',
          description: 'Step 2',
          prompt: '',
          status: 'failed',
          error: 'Network error',
          tokensUsed: 0,
        },
      ];

      const output = orch.synthesize(tasks);
      const step1Pos = output.indexOf('### 1. Step 1 ✓');
      const step2Pos = output.indexOf('### 2. Step 2 ✗');

      expect(step1Pos).toBeGreaterThanOrEqual(0);
      expect(step2Pos).toBeGreaterThan(step1Pos);
    });
  });

  // -------------------------------------------------------------------------
  // getAgentOrchestrator – singleton factory
  // -------------------------------------------------------------------------

  it('getAgentOrchestrator returns an AgentOrchestrator instance', () => {
    vi.useRealTimers(); // not timer-dependent
    const orch = getAgentOrchestrator({ maxConcurrent: 1 });
    expect(orch).toBeInstanceOf(AgentOrchestrator);
    vi.useFakeTimers();
  });

  // -------------------------------------------------------------------------
  // apiCall failure — task is marked failed, not thrown
  // -------------------------------------------------------------------------

  it('failing apiCall marks the task as failed without rejecting dispatch', async () => {
    const orch = new AgentOrchestrator();
    const apiCall = makeFailingApi('upstream error');

    const promise = orch.dispatch(
      [{ description: 'Bad task', prompt: 'doomed' }],
      apiCall,
    );

    await vi.runAllTimersAsync();
    const results = await promise;

    expect(results[0].status).toBe('failed');
    expect(results[0].error).toBe('upstream error');
  });
});
