import type { ToolResult } from '../types.js';
import { createContextualLogger } from '../../../utils/logger.js';

const log = createContextualLogger('Workflow');
import type {
  WorkflowDefinition,
  WorkflowExecution,
  WorkflowExecutionContext,
  WorkflowExecuteOptions,
  WorkflowStep,
  WorkflowSummary,
} from './types.js';

// Map from executionId -> AbortController for cancellation
const activeExecutions = new Map<string, AbortController>();

/**
 * Interpolate {{variableName}} placeholders in a string value.
 * Supports dot notation for nested access: {{step1.output.field}}
 */
function interpolateString(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
    const trimmed = key.trim();
    const parts = trimmed.split('.');
    let value: unknown = variables;
    for (const part of parts) {
      if (value !== null && typeof value === 'object') {
        value = (value as Record<string, unknown>)[part];
      } else {
        value = undefined;
        break;
      }
    }
    if (value === undefined || value === null) {
      return '';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  });
}

/**
 * Recursively interpolate {{variable}} placeholders in any value.
 * Handles strings, arrays, and plain objects.
 */
function interpolateValue(value: unknown, variables: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    return interpolateString(value, variables);
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateValue(item, variables));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = interpolateValue(v, variables);
    }
    return result;
  }
  return value;
}

/**
 * Evaluate a simple boolean condition against variables.
 * Supports: {{var}} === value, {{var}} !== value, {{var}} (truthy check)
 */
function evaluateCondition(condition: string, variables: Record<string, unknown>): boolean {
  const interpolated = interpolateString(condition, variables);

  // Handle strict equality: lhs === rhs
  const strictEqMatch = interpolated.match(/^(.+?)\s*===\s*(.+)$/);
  if (strictEqMatch) {
    const lhs = strictEqMatch[1].trim().replace(/^["']|["']$/g, '');
    const rhs = strictEqMatch[2].trim().replace(/^["']|["']$/g, '');
    return lhs === rhs;
  }

  // Handle strict inequality: lhs !== rhs
  const strictNeqMatch = interpolated.match(/^(.+?)\s*!==\s*(.+)$/);
  if (strictNeqMatch) {
    const lhs = strictNeqMatch[1].trim().replace(/^["']|["']$/g, '');
    const rhs = strictNeqMatch[2].trim().replace(/^["']|["']$/g, '');
    return lhs !== rhs;
  }

  // Truthy check
  const trimmed = interpolated.trim();
  return trimmed !== '' && trimmed !== 'false' && trimmed !== '0' && trimmed !== 'null';
}

/**
 * Extract a value from a ToolResult using the captureOutput path.
 * Checks result.output (string), result.data (object), then the entire result.
 */
function extractOutput(result: ToolResult, captureOutput: string): unknown {
  if (captureOutput === 'output') return result.output;
  if (captureOutput === 'data') return result.data;
  if (captureOutput === 'success') return result.success;

  // Try nested path on data
  if (result.data !== undefined && result.data !== null && typeof result.data === 'object') {
    const parts = captureOutput.split('.');
    let value: unknown = result.data;
    for (const part of parts) {
      if (value !== null && typeof value === 'object') {
        value = (value as Record<string, unknown>)[part];
      } else {
        value = undefined;
        break;
      }
    }
    if (value !== undefined) return value;
  }

  // Fall back to raw output string
  return result.output ?? result.data;
}

/** Generate a unique execution ID */
function generateExecutionId(workflowId: string, conversationId: string): string {
  return `${workflowId}:${conversationId}:${Date.now()}`;
}

export class WorkflowExecutor {
  /**
   * Execute a workflow step by step, returning a summary of all results.
   * Supports variable interpolation, conditional steps, and cancellation.
   */
  async execute(
    workflow: WorkflowDefinition,
    context: WorkflowExecutionContext,
    options: WorkflowExecuteOptions = {},
  ): Promise<WorkflowSummary> {
    const executionId = generateExecutionId(workflow.id, context.conversationId);
    const abortController = new AbortController();
    activeExecutions.set(executionId, abortController);

    // Forward external abort signal into our controller
    if (context.signal) {
      context.signal.addEventListener('abort', () => abortController.abort());
    }

    const startedAt = Date.now();
    const variables: Record<string, unknown> = {
      ...(workflow.variables ?? {}),
      ...(context.variables ?? {}),
    };

    const execution: WorkflowExecution = {
      workflowId: workflow.id,
      conversationId: context.conversationId,
      status: 'running',
      currentStep: 0,
      stepResults: workflow.steps.map((step) => ({
        stepId: step.id,
        toolName: step.tool,
        status: 'pending',
      })),
      variables,
      startedAt,
    };

    const outputs: Record<string, unknown> = {};
    let fatalError: string | undefined;

    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];

      // Check for cancellation
      if (abortController.signal.aborted) {
        execution.status = 'cancelled';
        execution.stepResults[i].status = 'skipped';
        break;
      }

      // Check explicit skip list
      if (options.skipSteps?.includes(step.id)) {
        execution.stepResults[i].status = 'skipped';
        continue;
      }

      // Evaluate step condition
      if (step.condition) {
        const shouldRun = evaluateCondition(step.condition, variables);
        if (!shouldRun) {
          execution.stepResults[i].status = 'skipped';
          continue;
        }
      }

      execution.currentStep = i;
      execution.stepResults[i].status = 'running';
      context.onStepStart?.(step, i);

      const stepStartMs = Date.now();
      const stepType = step.type || 'tool';
      let stepResult: ToolResult;

      if (stepType === 'parallel' && step.parallelSteps?.length) {
        stepResult = await this.executeParallelSteps(step.parallelSteps, variables, context, options);
      } else if (stepType === 'agent_session' && step.prompt) {
        stepResult = await this.executeAgentStep(step, variables);
      } else {
        stepResult = await this.executeStep(step, variables, context, options);
      }
      const durationMs = Date.now() - stepStartMs;

      execution.stepResults[i] = {
        stepId: step.id,
        toolName: step.tool,
        status: stepResult.success ? 'completed' : 'failed',
        output: stepResult.output ?? stepResult.data,
        error: stepResult.error?.message,
        durationMs,
      };

      // Capture output into variables
      if (step.captureOutput && stepResult.success) {
        const captured = extractOutput(stepResult, step.captureOutput);
        variables[step.captureOutput] = captured;
        outputs[step.captureOutput] = captured;
      }

      context.onStepComplete?.(step, execution.stepResults[i]);

      // Handle failure
      if (!stepResult.success && !step.continueOnError) {
        fatalError = stepResult.error?.message ?? `Step "${step.name}" failed`;
        execution.status = 'failed';
        execution.error = fatalError;
        break;
      }
    }

    activeExecutions.delete(executionId);
    execution.completedAt = Date.now();

    if (execution.status === 'running') {
      execution.status = 'completed';
    }

    const completedSteps = execution.stepResults.filter((r) => r.status === 'completed').length;
    const failedSteps = execution.stepResults.filter((r) => r.status === 'failed').length;
    const skippedSteps = execution.stepResults.filter((r) => r.status === 'skipped').length;

    return {
      workflowId: workflow.id,
      name: workflow.name,
      totalSteps: workflow.steps.length,
      completedSteps,
      failedSteps,
      skippedSteps,
      totalDurationMs: execution.completedAt - startedAt,
      outputs,
    };
  }

  /** Cancel a running workflow by its execution ID */
  cancel(executionId: string): void {
    const controller = activeExecutions.get(executionId);
    if (controller) {
      controller.abort();
      activeExecutions.delete(executionId);
    }
  }

  /** Execute a single workflow step, applying param interpolation and overrides */
  private async executeStep(
    step: WorkflowStep,
    variables: Record<string, unknown>,
    context: WorkflowExecutionContext,
    options: WorkflowExecuteOptions,
  ): Promise<ToolResult> {
    // Build params with interpolation
    const baseParams = interpolateValue(step.params, variables) as Record<string, unknown>;
    const overrides = options.overrides?.[step.id] ?? {};
    const params: Record<string, unknown> = { ...baseParams, ...overrides };

    // Apply step-level timeout if specified
    if (step.timeoutMs !== undefined) {
      const timeoutPromise = new Promise<ToolResult>((_, reject) =>
        setTimeout(() => reject(new Error(`Step "${step.name}" timed out after ${step.timeoutMs}ms`)), step.timeoutMs),
      );
      try {
        return await Promise.race([
          context.toolExecutor(step.tool, params),
          timeoutPromise,
        ]);
      } catch (error) {
        log.error('Step timed out', error instanceof Error ? error : new Error(String(error)), { stepId: step.id });
        return {
          success: false,
          error: {
            code: 'STEP_TIMEOUT',
            message: error instanceof Error ? error.message : 'Step timed out',
          },
        };
      }
    }

    try {
      return await context.toolExecutor(step.tool, params);
    } catch (error) {
      log.error('Step threw error', error instanceof Error ? error : new Error(String(error)), { stepId: step.id });
      return {
        success: false,
        error: {
          code: 'STEP_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error in step',
        },
      };
    }
  }

  /**
   * Execute multiple steps concurrently (fan-out).
   * All parallel steps run at once; results are merged.
   * Fails only if ALL parallel steps fail.
   */
  private async executeParallelSteps(
    steps: WorkflowStep[],
    variables: Record<string, unknown>,
    context: WorkflowExecutionContext,
    options: WorkflowExecuteOptions,
  ): Promise<ToolResult> {
    const results = await Promise.allSettled(
      steps.map((step) => this.executeStep(step, variables, context, options)),
    );

    const outputs: Record<string, unknown> = {};
    let anySuccess = false;
    const errors: string[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const step = steps[i];
      if (result.status === 'fulfilled') {
        if (result.value.success) {
          anySuccess = true;
          if (step.captureOutput) {
            outputs[step.captureOutput] = extractOutput(result.value, step.captureOutput);
            variables[step.captureOutput] = outputs[step.captureOutput];
          }
        } else {
          errors.push(`${step.name}: ${result.value.error?.message || 'failed'}`);
        }
      } else {
        errors.push(`${step.name}: ${result.reason}`);
      }
    }

    return {
      success: anySuccess,
      output: JSON.stringify(outputs),
      data: outputs,
      error: errors.length > 0 ? { code: 'PARALLEL_ERRORS', message: errors.join('; ') } : undefined,
    };
  }

  /**
   * Execute an agent session step - spawns an isolated AI agent.
   * The agent runs a prompt with tool access and returns the result.
   */
  private async executeAgentStep(
    step: WorkflowStep,
    variables: Record<string, unknown>,
  ): Promise<ToolResult> {
    try {
      const { executeAgenticChat } = await import('../../agentic-executor.js');
      const { createChatToolHandler } = await import('../../tool-handler.js');

      const prompt = interpolateString(step.prompt || '', variables);
      const conversationId = `workflow-agent-${crypto.randomUUID()}`;

      const toolHandler = await createChatToolHandler({
        conversationId,
        securityMode: 'full',
      });

      const tools = toolHandler.getTools();

      const response = await Promise.race([
        executeAgenticChat({
          conversationId,
          messages: [{
            id: crypto.randomUUID(),
            role: 'user',
            content: prompt,
            timestamp: new Date().toISOString(),
          }],
          systemPrompt: 'You are an AI agent executing a workflow step. Complete the task concisely.',
          model: step.model,
          effort: 'medium',
          toolHandler,
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Agent step timed out')), step.timeoutMs || 300000),
        ),
      ]);

      return {
        success: true,
        output: response.content,
        data: { content: response.content, model: response.model, tokens: response.usage?.totalTokens },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'AGENT_STEP_ERROR',
          message: error instanceof Error ? error.message : 'Agent step failed',
        },
      };
    }
  }
}
