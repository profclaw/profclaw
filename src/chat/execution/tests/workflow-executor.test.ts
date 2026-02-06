import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowExecutor } from '../workflows/executor.js';
import type {
  WorkflowDefinition,
  WorkflowExecutionContext,
  WorkflowExecuteOptions,
  WorkflowStep,
  WorkflowStepResult,
} from '../workflows/types.js';
import type { ToolResult } from '../types.js';

// =============================================================================
// Helpers
// =============================================================================

function makeStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id: 'step-1',
    name: 'Test Step',
    tool: 'exec',
    params: { command: 'echo hello' },
    continueOnError: false,
    ...overrides,
  };
}

function makeWorkflow(
  steps: WorkflowStep[],
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  return {
    id: 'wf-test',
    name: 'Test Workflow',
    description: 'A test workflow',
    triggers: ['test'],
    steps,
    ...overrides,
  };
}

function makeContext(
  toolExecutor: WorkflowExecutionContext['toolExecutor'],
  overrides: Partial<WorkflowExecutionContext> = {},
): WorkflowExecutionContext {
  return {
    conversationId: 'conv-123',
    toolExecutor,
    ...overrides,
  };
}

function successResult(data?: unknown, output?: string): ToolResult {
  return { success: true, data, output };
}

function failResult(code: string, message: string): ToolResult {
  return { success: false, error: { code, message } };
}

// =============================================================================
// WorkflowExecutor - basic execution
// =============================================================================

describe('WorkflowExecutor', () => {
  let executor: WorkflowExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new WorkflowExecutor();
  });

  // ---------------------------------------------------------------------------
  // Happy path - single and multi-step workflows
  // ---------------------------------------------------------------------------

  describe('basic step execution', () => {
    it('executes a single step and returns completed summary', async () => {
      const toolExecutor = vi.fn().mockResolvedValue(successResult('output'));
      const workflow = makeWorkflow([makeStep()]);
      const context = makeContext(toolExecutor);

      const summary = await executor.execute(workflow, context);

      expect(summary.workflowId).toBe('wf-test');
      expect(summary.name).toBe('Test Workflow');
      expect(summary.totalSteps).toBe(1);
      expect(summary.completedSteps).toBe(1);
      expect(summary.failedSteps).toBe(0);
      expect(summary.skippedSteps).toBe(0);
      expect(summary.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('calls toolExecutor with the correct tool name and params', async () => {
      const toolExecutor = vi.fn().mockResolvedValue(successResult());
      const step = makeStep({ tool: 'read_file', params: { path: '/tmp/test.txt' } });
      const workflow = makeWorkflow([step]);
      const context = makeContext(toolExecutor);

      await executor.execute(workflow, context);

      expect(toolExecutor).toHaveBeenCalledWith('read_file', { path: '/tmp/test.txt' });
    });

    it('executes multiple steps in sequence', async () => {
      const calls: string[] = [];
      const toolExecutor = vi.fn().mockImplementation(async (tool: string) => {
        calls.push(tool);
        return successResult();
      });

      const steps = [
        makeStep({ id: 'step-1', tool: 'read_file' }),
        makeStep({ id: 'step-2', tool: 'write_file' }),
        makeStep({ id: 'step-3', tool: 'exec' }),
      ];
      const workflow = makeWorkflow(steps);
      const context = makeContext(toolExecutor);

      const summary = await executor.execute(workflow, context);

      expect(summary.completedSteps).toBe(3);
      expect(calls).toEqual(['read_file', 'write_file', 'exec']);
    });

    it('calls onStepStart and onStepComplete hooks for each step', async () => {
      const toolExecutor = vi.fn().mockResolvedValue(successResult('done'));
      const steps = [
        makeStep({ id: 'step-1', name: 'Step One' }),
        makeStep({ id: 'step-2', name: 'Step Two' }),
      ];
      const workflow = makeWorkflow(steps);
      const onStepStart = vi.fn();
      const onStepComplete = vi.fn();
      const context = makeContext(toolExecutor, { onStepStart, onStepComplete });

      await executor.execute(workflow, context);

      expect(onStepStart).toHaveBeenCalledTimes(2);
      expect(onStepComplete).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Variable interpolation
  // ---------------------------------------------------------------------------

  describe('variable interpolation', () => {
    it('interpolates {{variable}} placeholders in step params', async () => {
      const toolExecutor = vi.fn().mockResolvedValue(successResult());
      const step = makeStep({
        id: 'step-1',
        tool: 'read_file',
        params: { path: '{{filePath}}' },
      });
      const workflow = makeWorkflow([step], {
        variables: { filePath: '/home/user/doc.txt' },
      });
      const context = makeContext(toolExecutor);

      await executor.execute(workflow, context);

      expect(toolExecutor).toHaveBeenCalledWith('read_file', { path: '/home/user/doc.txt' });
    });

    it('interpolates context variables over workflow variables', async () => {
      const toolExecutor = vi.fn().mockResolvedValue(successResult());
      const step = makeStep({
        id: 'step-1',
        params: { value: '{{color}}' },
      });
      const workflow = makeWorkflow([step], { variables: { color: 'blue' } });
      const context = makeContext(toolExecutor, { variables: { color: 'red' } });

      await executor.execute(workflow, context);

      expect(toolExecutor).toHaveBeenCalledWith(expect.any(String), { value: 'red' });
    });

    it('leaves missing placeholder as empty string', async () => {
      const toolExecutor = vi.fn().mockResolvedValue(successResult());
      const step = makeStep({ params: { value: '{{missingVar}}' } });
      const workflow = makeWorkflow([step]);
      const context = makeContext(toolExecutor);

      await executor.execute(workflow, context);

      expect(toolExecutor).toHaveBeenCalledWith(expect.any(String), { value: '' });
    });

    it('captures step output into variables for use in later steps', async () => {
      const toolExecutor = vi
        .fn()
        .mockResolvedValueOnce({ success: true, output: 'captured-value' })
        .mockResolvedValueOnce(successResult());

      const steps = [
        makeStep({
          id: 'step-1',
          tool: 'exec',
          params: { command: 'echo hi' },
          captureOutput: 'output',
        }),
        makeStep({
          id: 'step-2',
          tool: 'write_file',
          params: { content: '{{output}}' },
        }),
      ];
      const workflow = makeWorkflow(steps);
      const context = makeContext(toolExecutor);

      await executor.execute(workflow, context);

      expect(toolExecutor).toHaveBeenNthCalledWith(2, 'write_file', {
        content: 'captured-value',
      });
    });

    it('captures data field when captureOutput is "data"', async () => {
      const toolExecutor = vi
        .fn()
        .mockResolvedValueOnce({ success: true, data: { key: 'dataval' } })
        .mockResolvedValueOnce(successResult());

      const steps = [
        makeStep({ id: 's1', captureOutput: 'data' }),
        makeStep({ id: 's2', params: { input: '{{data}}' } }),
      ];
      const workflow = makeWorkflow(steps);
      const context = makeContext(toolExecutor);

      await executor.execute(workflow, context);

      // data was an object - it should be JSON-stringified in the interpolation
      const call2Params = toolExecutor.mock.calls[1][1] as Record<string, unknown>;
      expect(call2Params.input).toContain('dataval');
    });

    it('puts captured outputs in summary.outputs', async () => {
      const toolExecutor = vi
        .fn()
        .mockResolvedValueOnce({ success: true, output: 'hello-world' })
        .mockResolvedValueOnce(successResult());

      const steps = [
        makeStep({ id: 's1', captureOutput: 'output' }),
        makeStep({ id: 's2' }),
      ];
      const workflow = makeWorkflow(steps);
      const context = makeContext(toolExecutor);

      const summary = await executor.execute(workflow, context);

      expect(summary.outputs['output']).toBe('hello-world');
    });
  });

  // ---------------------------------------------------------------------------
  // Condition evaluation
  // ---------------------------------------------------------------------------

  describe('condition evaluation', () => {
    it('skips a step when its condition evaluates to false (empty string)', async () => {
      const toolExecutor = vi.fn().mockResolvedValue(successResult());
      const steps = [
        makeStep({
          id: 'step-1',
          condition: '{{shouldRun}}',
          tool: 'exec',
        }),
      ];
      const workflow = makeWorkflow(steps, { variables: { shouldRun: '' } });
      const context = makeContext(toolExecutor);

      const summary = await executor.execute(workflow, context);

      expect(toolExecutor).not.toHaveBeenCalled();
      expect(summary.skippedSteps).toBe(1);
      expect(summary.completedSteps).toBe(0);
    });

    it('runs a step when its condition evaluates to true', async () => {
      const toolExecutor = vi.fn().mockResolvedValue(successResult());
      const step = makeStep({ condition: '{{shouldRun}}' });
      const workflow = makeWorkflow([step], { variables: { shouldRun: 'true' } });
      const context = makeContext(toolExecutor);

      const summary = await executor.execute(workflow, context);

      expect(toolExecutor).toHaveBeenCalledTimes(1);
      expect(summary.completedSteps).toBe(1);
    });

    it('evaluates strict equality condition (=== match)', async () => {
      const toolExecutor = vi.fn().mockResolvedValue(successResult());
      const step = makeStep({ condition: '{{mode}} === production' });
      const workflow = makeWorkflow([step], { variables: { mode: 'production' } });
      const context = makeContext(toolExecutor);

      const summary = await executor.execute(workflow, context);

      expect(summary.completedSteps).toBe(1);
    });

    it('skips step when strict equality condition does not match', async () => {
      const toolExecutor = vi.fn().mockResolvedValue(successResult());
      const step = makeStep({ condition: '{{mode}} === production' });
      const workflow = makeWorkflow([step], { variables: { mode: 'dev' } });
      const context = makeContext(toolExecutor);

      const summary = await executor.execute(workflow, context);

      expect(summary.skippedSteps).toBe(1);
      expect(toolExecutor).not.toHaveBeenCalled();
    });

    it('evaluates !== condition correctly', async () => {
      const toolExecutor = vi.fn().mockResolvedValue(successResult());
      const step = makeStep({ condition: '{{env}} !== production' });
      const workflow = makeWorkflow([step], { variables: { env: 'staging' } });
      const context = makeContext(toolExecutor);

      const summary = await executor.execute(workflow, context);

      expect(summary.completedSteps).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Failure handling and continueOnError
  // ---------------------------------------------------------------------------

  describe('failure handling', () => {
    it('stops workflow on step failure when continueOnError is false', async () => {
      const toolExecutor = vi
        .fn()
        .mockResolvedValueOnce(failResult('ERR', 'step one failed'))
        .mockResolvedValueOnce(successResult());

      const steps = [
        makeStep({ id: 'step-1', continueOnError: false }),
        makeStep({ id: 'step-2' }),
      ];
      const workflow = makeWorkflow(steps);
      const context = makeContext(toolExecutor);

      const summary = await executor.execute(workflow, context);

      expect(summary.failedSteps).toBe(1);
      expect(summary.completedSteps).toBe(0);
      // Second step was never called
      expect(toolExecutor).toHaveBeenCalledTimes(1);
    });

    it('continues to next step when continueOnError is true', async () => {
      const toolExecutor = vi
        .fn()
        .mockResolvedValueOnce(failResult('ERR', 'step one failed'))
        .mockResolvedValueOnce(successResult());

      const steps = [
        makeStep({ id: 'step-1', continueOnError: true }),
        makeStep({ id: 'step-2' }),
      ];
      const workflow = makeWorkflow(steps);
      const context = makeContext(toolExecutor);

      const summary = await executor.execute(workflow, context);

      expect(summary.failedSteps).toBe(1);
      expect(summary.completedSteps).toBe(1);
      expect(toolExecutor).toHaveBeenCalledTimes(2);
    });

    it('step error message is captured in step result', async () => {
      const toolExecutor = vi.fn().mockResolvedValue(failResult('CRASH', 'it blew up'));
      const step = makeStep({ continueOnError: true });
      const workflow = makeWorkflow([step]);
      const onStepComplete = vi.fn();
      const context = makeContext(toolExecutor, { onStepComplete });

      await executor.execute(workflow, context);

      const stepResult: WorkflowStepResult = onStepComplete.mock.calls[0][1];
      expect(stepResult.status).toBe('failed');
      expect(stepResult.error).toBe('it blew up');
    });

    it('records durationMs for each step', async () => {
      const toolExecutor = vi.fn().mockResolvedValue(successResult());
      const step = makeStep();
      const workflow = makeWorkflow([step]);
      const onStepComplete = vi.fn();
      const context = makeContext(toolExecutor, { onStepComplete });

      await executor.execute(workflow, context);

      const stepResult: WorkflowStepResult = onStepComplete.mock.calls[0][1];
      expect(stepResult.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Step timeout
  // ---------------------------------------------------------------------------

  describe('step timeout', () => {
    it('returns STEP_TIMEOUT error when step exceeds timeoutMs', async () => {
      const toolExecutor = vi.fn().mockImplementation(
        () => new Promise<ToolResult>((resolve) => setTimeout(() => resolve(successResult()), 500)),
      );
      const step = makeStep({ timeoutMs: 10, continueOnError: true });
      const workflow = makeWorkflow([step]);
      const onStepComplete = vi.fn();
      const context = makeContext(toolExecutor, { onStepComplete });

      const summary = await executor.execute(workflow, context);

      expect(summary.failedSteps).toBe(1);
      const stepResult: WorkflowStepResult = onStepComplete.mock.calls[0][1];
      expect(stepResult.error).toMatch(/timed out/i);
    }, 2000);

    it('succeeds normally when step completes before timeoutMs', async () => {
      const toolExecutor = vi.fn().mockResolvedValue(successResult('fast'));
      const step = makeStep({ timeoutMs: 5000 });
      const workflow = makeWorkflow([step]);
      const context = makeContext(toolExecutor);

      const summary = await executor.execute(workflow, context);

      expect(summary.completedSteps).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Cancellation via AbortSignal
  // ---------------------------------------------------------------------------

  describe('workflow cancellation', () => {
    it('stops mid-workflow when external signal is aborted between steps', async () => {
      const abortController = new AbortController();

      const toolExecutor = vi.fn().mockImplementation(async () => {
        // Abort the controller after the first tool call
        abortController.abort();
        return successResult('done');
      });

      const steps = [makeStep({ id: 's1' }), makeStep({ id: 's2' })];
      const workflow = makeWorkflow(steps);
      const context = makeContext(toolExecutor, { signal: abortController.signal });

      const summary = await executor.execute(workflow, context);

      // First step ran before abort; second step should be cancelled
      expect(toolExecutor).toHaveBeenCalledTimes(1);
      expect(summary.completedSteps).toBe(1);
    });

    it('stops after in-progress step when signal is aborted mid-workflow', async () => {
      const abortController = new AbortController();

      const toolExecutor = vi.fn().mockImplementation(async () => {
        abortController.abort();
        return successResult('done');
      });

      const steps = [
        makeStep({ id: 's1' }),
        makeStep({ id: 's2' }),
        makeStep({ id: 's3' }),
      ];
      const workflow = makeWorkflow(steps);
      const context = makeContext(toolExecutor, { signal: abortController.signal });

      const summary = await executor.execute(workflow, context);

      // First step ran, subsequent steps should be skipped/cancelled
      expect(toolExecutor).toHaveBeenCalledTimes(1);
      expect(summary.completedSteps).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // skipSteps option
  // ---------------------------------------------------------------------------

  describe('options.skipSteps', () => {
    it('skips steps listed in skipSteps', async () => {
      const toolExecutor = vi.fn().mockResolvedValue(successResult());
      const steps = [
        makeStep({ id: 's1', tool: 'exec' }),
        makeStep({ id: 's2', tool: 'read_file' }),
        makeStep({ id: 's3', tool: 'write_file' }),
      ];
      const workflow = makeWorkflow(steps);
      const context = makeContext(toolExecutor);
      const options: WorkflowExecuteOptions = { skipSteps: ['s2'] };

      const summary = await executor.execute(workflow, context, options);

      expect(summary.skippedSteps).toBe(1);
      expect(summary.completedSteps).toBe(2);
      expect(toolExecutor).not.toHaveBeenCalledWith('read_file', expect.anything());
    });

    it('skips multiple steps in skipSteps', async () => {
      const toolExecutor = vi.fn().mockResolvedValue(successResult());
      const steps = [
        makeStep({ id: 's1' }),
        makeStep({ id: 's2' }),
        makeStep({ id: 's3' }),
      ];
      const workflow = makeWorkflow(steps);
      const context = makeContext(toolExecutor);
      const options: WorkflowExecuteOptions = { skipSteps: ['s1', 's3'] };

      const summary = await executor.execute(workflow, context, options);

      expect(summary.skippedSteps).toBe(2);
      expect(summary.completedSteps).toBe(1);
      expect(toolExecutor).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // options.overrides
  // ---------------------------------------------------------------------------

  describe('options.overrides', () => {
    it('overrides step params with values from options.overrides', async () => {
      const toolExecutor = vi.fn().mockResolvedValue(successResult());
      const step = makeStep({ id: 's1', params: { path: '/original/path.txt' } });
      const workflow = makeWorkflow([step]);
      const context = makeContext(toolExecutor);
      const options: WorkflowExecuteOptions = {
        overrides: { 's1': { path: '/overridden/path.txt' } },
      };

      await executor.execute(workflow, context, options);

      expect(toolExecutor).toHaveBeenCalledWith(expect.any(String), {
        path: '/overridden/path.txt',
      });
    });

    it('merges overrides with base params (overrides win)', async () => {
      const toolExecutor = vi.fn().mockResolvedValue(successResult());
      const step = makeStep({
        id: 's1',
        params: { path: '/original.txt', mode: 'read' },
      });
      const workflow = makeWorkflow([step]);
      const context = makeContext(toolExecutor);
      const options: WorkflowExecuteOptions = {
        overrides: { 's1': { mode: 'write' } },
      };

      await executor.execute(workflow, context, options);

      expect(toolExecutor).toHaveBeenCalledWith(expect.any(String), {
        path: '/original.txt',
        mode: 'write',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // WorkflowSummary aggregation
  // ---------------------------------------------------------------------------

  describe('WorkflowSummary aggregation', () => {
    it('correctly tallies completed, failed, and skipped steps', async () => {
      const toolExecutor = vi
        .fn()
        .mockResolvedValueOnce(successResult())   // s1 - completed
        .mockResolvedValueOnce(failResult('ERR', 'fail'))  // s2 - failed
        .mockResolvedValueOnce(successResult());  // s3 - completed

      const steps = [
        makeStep({ id: 's1', continueOnError: true }),
        makeStep({ id: 's2', continueOnError: true }),
        makeStep({ id: 's3', condition: '{{skip}}' }), // will be skipped (empty var)
      ];
      const workflow = makeWorkflow(steps);
      const context = makeContext(toolExecutor);

      const summary = await executor.execute(workflow, context);

      expect(summary.completedSteps).toBe(1); // s1
      expect(summary.failedSteps).toBe(1);    // s2
      expect(summary.skippedSteps).toBe(1);   // s3 (condition = empty string)
      expect(summary.totalSteps).toBe(3);
    });

    it('totalDurationMs is a non-negative number', async () => {
      const toolExecutor = vi.fn().mockResolvedValue(successResult());
      const workflow = makeWorkflow([makeStep()]);
      const context = makeContext(toolExecutor);

      const summary = await executor.execute(workflow, context);

      expect(summary.totalDurationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
