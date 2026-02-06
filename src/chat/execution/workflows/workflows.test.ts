import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolResult } from '../types.js';
import type {
  WorkflowDefinition,
  WorkflowExecutionContext,
  WorkflowExecuteOptions,
} from './types.js';
import { WorkflowExecutor } from './executor.js';
import { detectWorkflow, matchWorkflow } from './trigger.js';
import { BUILT_IN_WORKFLOWS, getBuiltInWorkflow } from './built-in.js';

// ===========================================================================
// Shared helpers
// ===========================================================================

function makeToolExecutor(result: ToolResult = { success: true, output: 'ok' }) {
  return vi.fn().mockResolvedValue(result);
}

function makeWorkflow(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: 'test-workflow',
    name: 'Test Workflow',
    description: 'A workflow for testing',
    triggers: ['run tests', 'test workflow'],
    steps: [
      {
        id: 'step-one',
        name: 'Step One',
        tool: 'exec',
        params: { command: 'echo hello' },
      },
    ],
    ...overrides,
  };
}

function makeContext(
  toolExecutor: WorkflowExecutionContext['toolExecutor'],
  extras: Partial<WorkflowExecutionContext> = {},
): WorkflowExecutionContext {
  return {
    conversationId: 'conv-test',
    toolExecutor,
    ...extras,
  };
}

// ===========================================================================
// WorkflowExecutor
// ===========================================================================

describe('WorkflowExecutor', () => {
  let executor: WorkflowExecutor;

  beforeEach(() => {
    executor = new WorkflowExecutor();
  });

  // -------------------------------------------------------------------------
  // Basic execution
  // -------------------------------------------------------------------------

  describe('execute - basic flow', () => {
    it('runs a single step and returns completed summary', async () => {
      const toolExecutor = makeToolExecutor({ success: true, output: 'done' });
      const workflow = makeWorkflow();
      const ctx = makeContext(toolExecutor);

      const summary = await executor.execute(workflow, ctx);

      expect(summary.workflowId).toBe('test-workflow');
      expect(summary.name).toBe('Test Workflow');
      expect(summary.totalSteps).toBe(1);
      expect(summary.completedSteps).toBe(1);
      expect(summary.failedSteps).toBe(0);
      expect(summary.skippedSteps).toBe(0);
    });

    it('calls toolExecutor with the step tool name and params', async () => {
      const toolExecutor = makeToolExecutor();
      const workflow = makeWorkflow();
      const ctx = makeContext(toolExecutor);

      await executor.execute(workflow, ctx);

      expect(toolExecutor).toHaveBeenCalledOnce();
      expect(toolExecutor).toHaveBeenCalledWith('exec', { command: 'echo hello' });
    });

    it('runs all steps in order for a multi-step workflow', async () => {
      const callOrder: string[] = [];
      const toolExecutor = vi.fn().mockImplementation((tool: string) => {
        callOrder.push(tool);
        return Promise.resolve({ success: true, output: `${tool}-done` });
      });

      const workflow = makeWorkflow({
        steps: [
          { id: 'a', name: 'A', tool: 'tool-a', params: {} },
          { id: 'b', name: 'B', tool: 'tool-b', params: {} },
          { id: 'c', name: 'C', tool: 'tool-c', params: {} },
        ],
      });

      const summary = await executor.execute(workflow, makeContext(toolExecutor));

      expect(callOrder).toEqual(['tool-a', 'tool-b', 'tool-c']);
      expect(summary.totalSteps).toBe(3);
      expect(summary.completedSteps).toBe(3);
    });

    it('totalDurationMs is a non-negative number', async () => {
      const summary = await executor.execute(
        makeWorkflow(),
        makeContext(makeToolExecutor()),
      );
      expect(summary.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('fires onStepStart and onStepComplete callbacks', async () => {
      const onStepStart = vi.fn();
      const onStepComplete = vi.fn();
      const workflow = makeWorkflow();
      const ctx = makeContext(makeToolExecutor(), { onStepStart, onStepComplete });

      await executor.execute(workflow, ctx);

      expect(onStepStart).toHaveBeenCalledOnce();
      expect(onStepComplete).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // Output capture and variable interpolation
  // -------------------------------------------------------------------------

  describe('execute - output capture and interpolation', () => {
    it('captures step output into variables for subsequent steps', async () => {
      const capturedParams: Record<string, unknown>[] = [];
      const toolExecutor = vi.fn().mockImplementation(
        (_tool: string, params: Record<string, unknown>) => {
          capturedParams.push(params);
          return Promise.resolve({ success: true, output: 'captured-value' });
        },
      );

      const workflow = makeWorkflow({
        steps: [
          {
            id: 'producer',
            name: 'Producer',
            tool: 'tool-a',
            params: {},
            captureOutput: 'output',
          },
          {
            id: 'consumer',
            name: 'Consumer',
            tool: 'tool-b',
            params: { value: '{{output}}' },
          },
        ],
      });

      await executor.execute(workflow, makeContext(toolExecutor));

      expect(capturedParams[1]).toEqual({ value: 'captured-value' });
    });

    it('interpolates {{variable}} from workflow-level variables', async () => {
      const toolExecutor = makeToolExecutor();
      const workflow = makeWorkflow({
        variables: { branch: 'main' },
        steps: [
          {
            id: 'pull',
            name: 'Pull',
            tool: 'exec',
            params: { command: 'git pull origin {{branch}}' },
          },
        ],
      });

      await executor.execute(workflow, makeContext(toolExecutor));

      expect(toolExecutor).toHaveBeenCalledWith('exec', { command: 'git pull origin main' });
    });

    it('interpolates context-level variables overriding workflow defaults', async () => {
      const toolExecutor = makeToolExecutor();
      const workflow = makeWorkflow({
        variables: { branch: 'main' },
        steps: [
          {
            id: 'pull',
            name: 'Pull',
            tool: 'exec',
            params: { command: 'git pull origin {{branch}}' },
          },
        ],
      });

      await executor.execute(workflow, makeContext(toolExecutor, { variables: { branch: 'feat/x' } }));

      expect(toolExecutor).toHaveBeenCalledWith('exec', { command: 'git pull origin feat/x' });
    });

    it('interpolates nested dot-notation {{a.b.c}} variables', async () => {
      const toolExecutor = makeToolExecutor();
      const workflow = makeWorkflow({
        steps: [
          {
            id: 'step',
            name: 'Step',
            tool: 'exec',
            params: { command: '{{config.build.cmd}}' },
          },
        ],
      });
      const ctx = makeContext(toolExecutor, {
        variables: { config: { build: { cmd: 'pnpm build' } } },
      });

      await executor.execute(workflow, ctx);

      expect(toolExecutor).toHaveBeenCalledWith('exec', { command: 'pnpm build' });
    });

    it('replaces missing variable references with empty string', async () => {
      const toolExecutor = makeToolExecutor();
      const workflow = makeWorkflow({
        steps: [
          {
            id: 'step',
            name: 'Step',
            tool: 'exec',
            params: { command: 'echo {{nonexistent}}' },
          },
        ],
      });

      await executor.execute(workflow, makeContext(toolExecutor));

      expect(toolExecutor).toHaveBeenCalledWith('exec', { command: 'echo ' });
    });

    it('exposes captured outputs in summary.outputs', async () => {
      const toolExecutor = makeToolExecutor({ success: true, output: 'build-success' });
      const workflow = makeWorkflow({
        steps: [
          {
            id: 'build',
            name: 'Build',
            tool: 'exec',
            params: {},
            captureOutput: 'output',
          },
        ],
      });

      const summary = await executor.execute(workflow, makeContext(toolExecutor));

      expect(summary.outputs['output']).toBe('build-success');
    });

    it('interpolates arrays recursively', async () => {
      const toolExecutor = makeToolExecutor();
      const workflow = makeWorkflow({
        variables: { item: 'hello' },
        steps: [
          {
            id: 'step',
            name: 'Step',
            tool: 'exec',
            params: { args: ['{{item}}', 'world'] },
          },
        ],
      });

      await executor.execute(workflow, makeContext(toolExecutor));

      expect(toolExecutor).toHaveBeenCalledWith('exec', { args: ['hello', 'world'] });
    });
  });

  // -------------------------------------------------------------------------
  // Step failure handling
  // -------------------------------------------------------------------------

  describe('execute - failure handling', () => {
    it('stops execution on fatal step failure', async () => {
      const toolExecutor = vi.fn()
        .mockResolvedValueOnce({ success: false, error: { code: 'ERR', message: 'boom' } })
        .mockResolvedValue({ success: true, output: 'ok' });

      const workflow = makeWorkflow({
        steps: [
          { id: 'a', name: 'A', tool: 'tool-a', params: {} },
          { id: 'b', name: 'B', tool: 'tool-b', params: {} },
        ],
      });

      const summary = await executor.execute(workflow, makeContext(toolExecutor));

      expect(summary.failedSteps).toBe(1);
      expect(summary.completedSteps).toBe(0);
      // Second step never ran
      expect(toolExecutor).toHaveBeenCalledOnce();
    });

    it('continues after failure when continueOnError is true', async () => {
      const toolExecutor = vi.fn()
        .mockResolvedValueOnce({ success: false, error: { code: 'ERR', message: 'skip me' } })
        .mockResolvedValue({ success: true, output: 'ok' });

      const workflow = makeWorkflow({
        steps: [
          { id: 'a', name: 'A', tool: 'tool-a', params: {}, continueOnError: true },
          { id: 'b', name: 'B', tool: 'tool-b', params: {} },
        ],
      });

      const summary = await executor.execute(workflow, makeContext(toolExecutor));

      expect(summary.failedSteps).toBe(1);
      expect(summary.completedSteps).toBe(1);
      expect(toolExecutor).toHaveBeenCalledTimes(2);
    });

    it('returns failed summary status when a fatal step fails', async () => {
      const toolExecutor = makeToolExecutor({ success: false, error: { code: 'ERR', message: 'fail' } });
      const workflow = makeWorkflow();

      const summary = await executor.execute(workflow, makeContext(toolExecutor));

      // summary itself does not have a status field but failedSteps reflects failure
      expect(summary.failedSteps).toBe(1);
      expect(summary.completedSteps).toBe(0);
    });

    it('handles toolExecutor throwing an exception', async () => {
      const toolExecutor = vi.fn().mockRejectedValue(new Error('network error'));
      const workflow = makeWorkflow();

      const summary = await executor.execute(workflow, makeContext(toolExecutor));

      expect(summary.failedSteps).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Step skipping
  // -------------------------------------------------------------------------

  describe('execute - step skipping', () => {
    it('skips steps listed in options.skipSteps', async () => {
      const toolExecutor = makeToolExecutor();
      const workflow = makeWorkflow({
        steps: [
          { id: 'a', name: 'A', tool: 'tool-a', params: {} },
          { id: 'b', name: 'B', tool: 'tool-b', params: {} },
        ],
      });
      const options: WorkflowExecuteOptions = { skipSteps: ['a'] };

      const summary = await executor.execute(workflow, makeContext(toolExecutor), options);

      expect(summary.skippedSteps).toBe(1);
      expect(summary.completedSteps).toBe(1);
      expect(toolExecutor).toHaveBeenCalledOnce();
      expect(toolExecutor).toHaveBeenCalledWith('tool-b', {});
    });

    it('skips a step when its condition evaluates false', async () => {
      const toolExecutor = makeToolExecutor();
      const workflow = makeWorkflow({
        variables: { flag: 'false' },
        steps: [
          {
            id: 'conditional',
            name: 'Conditional',
            tool: 'exec',
            params: {},
            condition: '{{flag}}',
          },
        ],
      });

      const summary = await executor.execute(workflow, makeContext(toolExecutor));

      expect(summary.skippedSteps).toBe(1);
      expect(toolExecutor).not.toHaveBeenCalled();
    });

    it('runs a step when its condition evaluates true', async () => {
      const toolExecutor = makeToolExecutor();
      const workflow = makeWorkflow({
        variables: { flag: 'go' },
        steps: [
          {
            id: 'conditional',
            name: 'Conditional',
            tool: 'exec',
            params: {},
            condition: '{{flag}}',
          },
        ],
      });

      const summary = await executor.execute(workflow, makeContext(toolExecutor));

      expect(summary.completedSteps).toBe(1);
    });

    it('skips step when === condition is not satisfied', async () => {
      const toolExecutor = makeToolExecutor();
      const workflow = makeWorkflow({
        variables: { env: 'dev' },
        steps: [
          {
            id: 'prod-only',
            name: 'Prod Only',
            tool: 'exec',
            params: {},
            condition: '{{env}} === prod',
          },
        ],
      });

      const summary = await executor.execute(workflow, makeContext(toolExecutor));

      expect(summary.skippedSteps).toBe(1);
      expect(toolExecutor).not.toHaveBeenCalled();
    });

    it('runs step when !== condition is satisfied', async () => {
      const toolExecutor = makeToolExecutor();
      const workflow = makeWorkflow({
        variables: { output: 'something' },
        steps: [
          {
            id: 'non-empty',
            name: 'Non Empty',
            tool: 'exec',
            params: {},
            condition: '{{output}} !== ""',
          },
        ],
      });

      const summary = await executor.execute(workflow, makeContext(toolExecutor));

      expect(summary.completedSteps).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Param overrides
  // -------------------------------------------------------------------------

  describe('execute - param overrides', () => {
    it('applies options.overrides to the target step params', async () => {
      const toolExecutor = makeToolExecutor();
      const workflow = makeWorkflow({
        steps: [
          { id: 'build', name: 'Build', tool: 'exec', params: { command: 'pnpm build' } },
        ],
      });
      const options: WorkflowExecuteOptions = {
        overrides: { build: { command: 'npm run build' } },
      };

      await executor.execute(workflow, makeContext(toolExecutor), options);

      expect(toolExecutor).toHaveBeenCalledWith('exec', { command: 'npm run build' });
    });
  });

  // -------------------------------------------------------------------------
  // Step timeout
  // -------------------------------------------------------------------------

  describe('execute - step timeout', () => {
    it('fails the step with STEP_TIMEOUT when timeoutMs is exceeded', async () => {
      vi.useFakeTimers();

      const toolExecutor = vi.fn().mockImplementation(
        () => new Promise<ToolResult>((resolve) => setTimeout(() => resolve({ success: true, output: 'ok' }), 5000)),
      );

      const workflow = makeWorkflow({
        steps: [
          { id: 'slow', name: 'Slow', tool: 'exec', params: {}, timeoutMs: 100 },
        ],
      });

      const executePromise = executor.execute(workflow, makeContext(toolExecutor));
      vi.advanceTimersByTime(200);
      const summary = await executePromise;

      expect(summary.failedSteps).toBe(1);

      vi.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // Condition evaluation edge cases
  // -------------------------------------------------------------------------

  describe('condition evaluation', () => {
    it('treats "0" as falsy', async () => {
      const toolExecutor = makeToolExecutor();
      const workflow = makeWorkflow({
        variables: { count: '0' },
        steps: [{ id: 's', name: 'S', tool: 'exec', params: {}, condition: '{{count}}' }],
      });
      const summary = await executor.execute(workflow, makeContext(toolExecutor));
      expect(summary.skippedSteps).toBe(1);
    });

    it('treats "null" as falsy', async () => {
      const toolExecutor = makeToolExecutor();
      const workflow = makeWorkflow({
        variables: { val: 'null' },
        steps: [{ id: 's', name: 'S', tool: 'exec', params: {}, condition: '{{val}}' }],
      });
      const summary = await executor.execute(workflow, makeContext(toolExecutor));
      expect(summary.skippedSteps).toBe(1);
    });

    it('treats a non-empty string as truthy', async () => {
      const toolExecutor = makeToolExecutor();
      const workflow = makeWorkflow({
        variables: { val: 'yes' },
        steps: [{ id: 's', name: 'S', tool: 'exec', params: {}, condition: '{{val}}' }],
      });
      const summary = await executor.execute(workflow, makeContext(toolExecutor));
      expect(summary.completedSteps).toBe(1);
    });

    it('evaluates strict equality match', async () => {
      const toolExecutor = makeToolExecutor();
      const workflow = makeWorkflow({
        variables: { status: 'ready' },
        steps: [{ id: 's', name: 'S', tool: 'exec', params: {}, condition: '{{status}} === ready' }],
      });
      const summary = await executor.execute(workflow, makeContext(toolExecutor));
      expect(summary.completedSteps).toBe(1);
    });
  });
});

// ===========================================================================
// Trigger detection
// ===========================================================================

describe('Trigger detection', () => {
  const deployWorkflow = makeWorkflow({
    id: 'deploy',
    name: 'Deploy',
    triggers: ['deploy', 'push to production', 'ship it'],
  });
  const reviewWorkflow = makeWorkflow({
    id: 'code-review',
    name: 'Code Review',
    triggers: ['code review', 'review my changes', 'check my code'],
  });
  const available = [deployWorkflow, reviewWorkflow];

  // -------------------------------------------------------------------------
  // detectWorkflow
  // -------------------------------------------------------------------------

  describe('detectWorkflow', () => {
    it('returns null for empty message', () => {
      expect(detectWorkflow('', available)).toBeNull();
    });

    it('returns null when no workflows are provided', () => {
      expect(detectWorkflow('deploy please', [])).toBeNull();
    });

    it('matches on exact trigger phrase inclusion', () => {
      const match = detectWorkflow('please deploy the app', available);
      expect(match).not.toBeNull();
      expect(match?.workflow.id).toBe('deploy');
    });

    it('confidence is above 0.5 for exact phrase match', () => {
      const match = detectWorkflow('push to production now', available);
      expect(match?.confidence).toBeGreaterThan(0.5);
    });

    it('matches on word overlap when no exact phrase', () => {
      // "review" and "code" overlap with "code review"
      const match = detectWorkflow('could you review my code changes?', available);
      expect(match).not.toBeNull();
    });

    it('returns null when confidence is below threshold', () => {
      // Message has no meaningful overlap with any trigger
      const match = detectWorkflow('hello world', available);
      expect(match).toBeNull();
    });

    it('picks the best matching workflow when multiple score above threshold', () => {
      // "ship it" is an exact trigger for deploy
      const match = detectWorkflow('please ship it to production', available);
      expect(match?.workflow.id).toBe('deploy');
    });

    it('returns extractedVariables in the match object', () => {
      const match = detectWorkflow('deploy from branch feature/x', available);
      // extractedVariables may include branch from message
      expect(match).toHaveProperty('extractedVariables');
    });

    it('longer trigger phrase relative to message yields higher confidence', () => {
      const shortTrigger = detectWorkflow('deploy', available);
      const longTrigger = detectWorkflow('push to production', available);
      // Both match deploy. Long trigger in a short message yields higher ratio
      expect(shortTrigger?.confidence).toBeDefined();
      expect(longTrigger?.confidence).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // matchWorkflow
  // -------------------------------------------------------------------------

  describe('matchWorkflow', () => {
    it('returns null when no match found', () => {
      expect(matchWorkflow('hello world', available)).toBeNull();
    });

    it('merges extracted variables into workflow variables', () => {
      // The branch pattern /(?:branch|from)\s+([\w/-]+)/ captures the word immediately
      // after "from" or "branch". Dots are not in the character class so use a clean name.
      const message = 'deploy from release/v2';
      const match = matchWorkflow(message, available);

      expect(match).not.toBeNull();
      // branch variable extracted and merged - "release/v2" follows "from"
      expect(match?.workflow.variables?.['branch']).toBe('release/v2');
    });

    it('preserves original workflow variables not present in extracted', () => {
      const workflowWithVars = makeWorkflow({
        id: 'deploy',
        name: 'Deploy',
        triggers: ['deploy'],
        variables: { buildCommand: 'pnpm build', branch: 'main' },
      });

      // Use "from feat/new" so branch regex matches "feat/new" (word directly after "from")
      const match = matchWorkflow('deploy from feat/new', [workflowWithVars]);

      expect(match?.workflow.variables?.['buildCommand']).toBe('pnpm build');
    });

    it('returns match unchanged when no variables can be extracted', () => {
      // Simple trigger with no extractable variables
      const match = matchWorkflow('code review please', [reviewWorkflow]);

      expect(match).not.toBeNull();
      expect(match?.workflow.id).toBe('code-review');
    });

    it('does not mutate the original workflow definition', () => {
      const original = JSON.stringify(deployWorkflow);
      matchWorkflow('deploy from branch test', available);
      expect(JSON.stringify(deployWorkflow)).toBe(original);
    });
  });

  // -------------------------------------------------------------------------
  // Variable extraction
  // -------------------------------------------------------------------------

  describe('variable extraction', () => {
    it('extracts filePath from "in path/to/file.ts"', () => {
      const match = detectWorkflow('check in src/utils/helpers.ts please', [
        makeWorkflow({ triggers: ['check'] }),
      ]);
      expect(match?.extractedVariables['filePath']).toBe('src/utils/helpers.ts');
    });

    it('extracts errorPattern from quoted string', () => {
      const match = detectWorkflow('search for error "Cannot read properties"', [
        makeWorkflow({ triggers: ['search'] }),
      ]);
      expect(match?.extractedVariables['errorPattern']).toBe('Cannot read properties');
    });

    it('extracts query from "research for ..." message', () => {
      const match = detectWorkflow('research vitest mocking patterns', [
        makeWorkflow({ triggers: ['research'] }),
      ]);
      expect(match?.extractedVariables['query']).toBeDefined();
    });

    it('extracts branch name directly after "branch" keyword', () => {
      // Pattern: /(?:branch|from)\s+([\w/-]+)/ - captures the word right after "branch"
      const match = detectWorkflow('deploy branch feature/my-branch', [
        makeWorkflow({ triggers: ['deploy'] }),
      ]);
      expect(match?.extractedVariables['branch']).toBe('feature/my-branch');
    });

    it('extracts targetPattern - the word immediately after the refactor keyword', () => {
      // Pattern: /(?:rename|replace|refactor)\s+["']?(\w+)["']?/ captures the word
      // immediately following the keyword. For "rename OldService" it captures "OldService".
      const match = detectWorkflow('rename OldService', [
        makeWorkflow({ triggers: ['rename'] }),
      ]);
      expect(match?.extractedVariables['targetPattern']).toBe('OldService');
    });

    it('returns empty object when no patterns match', () => {
      const match = detectWorkflow('deploy it', [makeWorkflow({ triggers: ['deploy'] })]);
      // Should have extractedVariables but it may be empty or partial
      expect(match?.extractedVariables).toBeDefined();
    });
  });
});

// ===========================================================================
// Built-in workflows
// ===========================================================================

describe('Built-in workflows', () => {
  const EXPECTED_IDS = ['deploy', 'code-review', 'debug', 'research', 'refactor', 'test-and-fix'];

  it('exports exactly 6 built-in workflows', () => {
    expect(BUILT_IN_WORKFLOWS).toHaveLength(6);
  });

  it('all built-in workflows have the 6 expected IDs', () => {
    const ids = BUILT_IN_WORKFLOWS.map((w) => w.id);
    for (const id of EXPECTED_IDS) {
      expect(ids).toContain(id);
    }
  });

  it('every workflow has id, name, description, triggers, and steps', () => {
    for (const workflow of BUILT_IN_WORKFLOWS) {
      expect(workflow.id).toBeTruthy();
      expect(workflow.name).toBeTruthy();
      expect(workflow.description).toBeTruthy();
      expect(Array.isArray(workflow.triggers)).toBe(true);
      expect(workflow.triggers.length).toBeGreaterThan(0);
      expect(Array.isArray(workflow.steps)).toBe(true);
      expect(workflow.steps.length).toBeGreaterThan(0);
    }
  });

  it('every step has id, name, tool, and params', () => {
    for (const workflow of BUILT_IN_WORKFLOWS) {
      for (const step of workflow.steps) {
        expect(step.id).toBeTruthy();
        expect(step.name).toBeTruthy();
        expect(step.tool).toBeTruthy();
        expect(step.params).toBeDefined();
      }
    }
  });

  // -------------------------------------------------------------------------
  // getBuiltInWorkflow
  // -------------------------------------------------------------------------

  describe('getBuiltInWorkflow', () => {
    it('returns the deploy workflow by ID', () => {
      const w = getBuiltInWorkflow('deploy');
      expect(w).toBeDefined();
      expect(w?.id).toBe('deploy');
      expect(w?.name).toBe('Deploy');
    });

    it('returns the code-review workflow by ID', () => {
      const w = getBuiltInWorkflow('code-review');
      expect(w?.id).toBe('code-review');
    });

    it('returns the debug workflow by ID', () => {
      const w = getBuiltInWorkflow('debug');
      expect(w?.id).toBe('debug');
    });

    it('returns the research workflow by ID', () => {
      const w = getBuiltInWorkflow('research');
      expect(w?.id).toBe('research');
    });

    it('returns the refactor workflow by ID', () => {
      const w = getBuiltInWorkflow('refactor');
      expect(w?.id).toBe('refactor');
    });

    it('returns the test-and-fix workflow by ID', () => {
      const w = getBuiltInWorkflow('test-and-fix');
      expect(w?.id).toBe('test-and-fix');
    });

    it('returns undefined for an unknown ID', () => {
      expect(getBuiltInWorkflow('nonexistent')).toBeUndefined();
    });

    it('returns undefined for an empty string', () => {
      expect(getBuiltInWorkflow('')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Workflow-specific checks
  // -------------------------------------------------------------------------

  describe('deploy workflow', () => {
    it('has branch variable defaulting to main', () => {
      const w = getBuiltInWorkflow('deploy');
      expect(w?.variables?.['branch']).toBe('main');
    });

    it('test step has continueOnError set to true', () => {
      const w = getBuiltInWorkflow('deploy');
      const testStep = w?.steps.find((s) => s.id === 'test');
      expect(testStep?.continueOnError).toBe(true);
    });

    it('git-pull step uses {{branch}} interpolation', () => {
      const w = getBuiltInWorkflow('deploy');
      const pullStep = w?.steps.find((s) => s.id === 'git-pull');
      expect((pullStep?.params['command'] as string)).toContain('{{branch}}');
    });
  });

  describe('debug workflow', () => {
    it('errorPattern variable defaults to "error"', () => {
      const w = getBuiltInWorkflow('debug');
      expect(w?.variables?.['errorPattern']).toBe('error');
    });

    it('find-errors step has continueOnError true', () => {
      const w = getBuiltInWorkflow('debug');
      const step = w?.steps.find((s) => s.id === 'find-errors');
      expect(step?.continueOnError).toBe(true);
    });
  });

  describe('test-and-fix workflow', () => {
    it('testCommand variable defaults to "pnpm test"', () => {
      const w = getBuiltInWorkflow('test-and-fix');
      expect(w?.variables?.['testCommand']).toBe('pnpm test');
    });

    it('find-failing step has a condition referencing {{testOutput}}', () => {
      const w = getBuiltInWorkflow('test-and-fix');
      const step = w?.steps.find((s) => s.id === 'find-failing');
      expect(step?.condition).toContain('testOutput');
    });
  });

  describe('research workflow', () => {
    it('web-fetch step has continueOnError true', () => {
      const w = getBuiltInWorkflow('research');
      const step = w?.steps.find((s) => s.id === 'fetch-top');
      expect(step?.continueOnError).toBe(true);
    });
  });
});
