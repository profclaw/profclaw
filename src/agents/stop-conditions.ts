/**
 * Agent Stop Conditions
 *
 * Functions that determine when an agent should stop execution.
 * Modeled after Vercel AI SDK v5.0 stopWhen API patterns.
 */

import type { AgentState, StopCondition } from './types.js';

// Step Count Conditions

/**
 * Stop when step count reaches a specific number.
 * This is the safety limit to prevent runaway agents.
 */
export function stepCountIs(maxSteps: number): StopCondition {
  return {
    name: `stepCount:${maxSteps}`,
    check: (state) => state.currentStep >= maxSteps,
  };
}

/**
 * Stop when step count exceeds a threshold.
 */
export function stepCountExceeds(threshold: number): StopCondition {
  return {
    name: `stepCountExceeds:${threshold}`,
    check: (state) => state.currentStep > threshold,
  };
}

// Tool Call Conditions

/**
 * Stop when a specific tool has been called.
 */
export function hasToolCall(toolName: string): StopCondition {
  return {
    name: `hasToolCall:${toolName}`,
    check: (state) => state.toolCallHistory.some((t) => t.name === toolName && t.status === 'executed'),
  };
}

/**
 * Stop when any of the specified tools has been called.
 */
export function hasAnyToolCall(toolNames: string[]): StopCondition {
  return {
    name: `hasAnyToolCall:${toolNames.join(',')}`,
    check: (state) =>
      state.toolCallHistory.some((t) => toolNames.includes(t.name) && t.status === 'executed'),
  };
}

/**
 * Stop when a specific tool has been called N times.
 */
export function toolCallCount(toolName: string, count: number): StopCondition {
  return {
    name: `toolCallCount:${toolName}:${count}`,
    check: (state) => {
      const calls = state.toolCallHistory.filter((t) => t.name === toolName && t.status === 'executed');
      return calls.length >= count;
    },
  };
}

/**
 * Stop when total tool calls exceed a limit.
 */
export function totalToolCalls(maxCalls: number): StopCondition {
  return {
    name: `totalToolCalls:${maxCalls}`,
    check: (state) => state.toolCallHistory.filter((t) => t.status === 'executed').length >= maxCalls,
  };
}

// Budget Conditions

/**
 * Stop when token budget is exceeded.
 */
export function budgetExceeded(): StopCondition {
  return {
    name: 'budgetExceeded',
    check: (state) => state.usedBudget >= state.maxBudget,
  };
}

/**
 * Stop when remaining budget is below a threshold.
 */
export function budgetBelowThreshold(threshold: number): StopCondition {
  return {
    name: `budgetBelowThreshold:${threshold}`,
    check: (state) => state.maxBudget - state.usedBudget < threshold,
  };
}

/**
 * Stop when budget usage percentage exceeds a limit.
 */
export function budgetPercentageExceeds(percentage: number): StopCondition {
  return {
    name: `budgetPercentage:${percentage}`,
    check: (state) => {
      const usagePercent = (state.usedBudget / state.maxBudget) * 100;
      return usagePercent >= percentage;
    },
  };
}

// Task Completion Conditions

/**
 * Stop when the complete_task tool has been called successfully.
 * This is the primary way for the agent to signal task completion.
 */
export function taskCompleted(): StopCondition {
  return {
    name: 'taskCompleted',
    check: (state) => {
      // Check if complete_task was called and executed successfully
      return state.toolCallHistory.some(
        (t) =>
          t.name === 'complete_task' &&
          t.status === 'executed' &&
          t.result &&
          typeof t.result === 'object' &&
          (t.result as Record<string, unknown>).complete === true
      );
    },
  };
}

/**
 * Stop when the model's response indicates completion.
 * Checks the last result for done/complete flags.
 */
export function modelIndicatesCompletion(): StopCondition {
  return {
    name: 'modelIndicatesCompletion',
    check: (_state, lastResult) => {
      if (typeof lastResult === 'object' && lastResult !== null) {
        const result = lastResult as Record<string, unknown>;
        return result.done === true || result.complete === true || result.finished === true;
      }
      return false;
    },
  };
}

/**
 * Stop when no tool calls are made in the last step AND the agent has never
 * executed any tools. This handles simple text-only responses (e.g. "hello")
 * without prematurely killing multi-step workflows where the AI pauses to
 * think between tool calls.
 */
export function noToolCallsInLastStep(): StopCondition {
  return {
    name: 'noToolCallsInLastStep',
    check: (state, lastResult) => {
      // If tools have been executed previously, the agent is mid-workflow —
      // don't stop just because the current step has no tool calls.
      if (state.toolCallHistory.some((t) => t.status === 'executed')) {
        return false;
      }

      // No tools ever executed — check if this step also has none
      if (typeof lastResult === 'object' && lastResult !== null) {
        const result = lastResult as { steps?: Array<{ toolCalls?: unknown[] }> };
        if (result.steps && result.steps.length > 0) {
          const lastStep = result.steps[result.steps.length - 1];
          return !lastStep.toolCalls || lastStep.toolCalls.length === 0;
        }
      }
      return false;
    },
  };
}

// Repeat Detection

/**
 * Stop when the same tool is called with the same arguments repeatedly.
 * Prevents infinite loops where the AI keeps retrying a failing tool.
 */
export function sameToolRepeated(maxRepeats: number = 3): StopCondition {
  return {
    name: `sameToolRepeated:${maxRepeats}`,
    check: (state) => {
      const history = state.toolCallHistory;
      if (history.length < maxRepeats) return false;

      // Check the last N entries
      const lastN = history.slice(-maxRepeats);
      const firstName = lastN[0].name;
      const firstArgs = JSON.stringify(lastN[0].args);

      return lastN.every(
        (t) => t.name === firstName && JSON.stringify(t.args) === firstArgs
      );
    },
  };
}

// Error Conditions

/**
 * Stop when a tool call fails.
 */
export function toolCallFailed(): StopCondition {
  return {
    name: 'toolCallFailed',
    check: (state) => state.toolCallHistory.some((t) => t.status === 'failed'),
  };
}

/**
 * Stop when multiple tool calls have failed.
 */
export function consecutiveFailures(count: number): StopCondition {
  return {
    name: `consecutiveFailures:${count}`,
    check: (state) => {
      const history = state.toolCallHistory;
      if (history.length < count) return false;

      // Check last N calls
      const lastN = history.slice(-count);
      return lastN.every((t) => t.status === 'failed');
    },
  };
}

// Time Conditions

/**
 * Stop when execution time exceeds a limit.
 */
export function timeoutExceeded(timeoutMs: number): StopCondition {
  return {
    name: `timeout:${timeoutMs}ms`,
    check: (state) => Date.now() - state.createdAt >= timeoutMs,
  };
}

// Composite Conditions

/**
 * Stop when ANY of the provided conditions are met (OR logic).
 */
export function anyOf(conditions: StopCondition[]): StopCondition {
  return {
    name: `anyOf:[${conditions.map((c) => c.name).join(',')}]`,
    check: async (state, lastResult) => {
      for (const condition of conditions) {
        if (await condition.check(state, lastResult)) {
          return true;
        }
      }
      return false;
    },
  };
}

/**
 * Stop when ALL of the provided conditions are met (AND logic).
 */
export function allOf(conditions: StopCondition[]): StopCondition {
  return {
    name: `allOf:[${conditions.map((c) => c.name).join(',')}]`,
    check: async (state, lastResult) => {
      for (const condition of conditions) {
        if (!(await condition.check(state, lastResult))) {
          return false;
        }
      }
      return true;
    },
  };
}

/**
 * Negate a condition.
 */
export function not(condition: StopCondition): StopCondition {
  return {
    name: `not:${condition.name}`,
    check: async (state, lastResult) => !(await condition.check(state, lastResult)),
  };
}

// Custom Condition Builder

/**
 * Create a custom stop condition with a check function.
 */
export function custom(
  name: string,
  check: (state: AgentState, lastResult: unknown) => boolean | Promise<boolean>
): StopCondition {
  return { name, check };
}

// Default Stop Conditions

/**
 * Default stop conditions for profClaw agents.
 * These provide safety limits while allowing task completion.
 */
export const defaultStopConditions: StopCondition[] = [
  // Safety limits
  stepCountIs(100), // Hard limit on steps
  budgetExceeded(), // Token budget protection
  timeoutExceeded(5 * 60 * 1000), // 5 minute timeout

  // Task completion - multiple ways to complete
  taskCompleted(), // Primary completion signal via complete_task tool
  noToolCallsInLastStep(), // Complete if AI responds without tools (simple messages)

  // Error handling
  consecutiveFailures(3), // Stop after 3 consecutive failures
  sameToolRepeated(3), // Stop if same tool+args called 3 times in a row
];

/**
 * Minimal stop conditions for simple tasks.
 */
export const minimalStopConditions: StopCondition[] = [
  stepCountIs(20), // Lower step limit
  taskCompleted(),
  toolCallFailed(),
];

/**
 * Strict stop conditions for budget-sensitive operations.
 */
export const strictStopConditions: StopCondition[] = [
  stepCountIs(50),
  budgetPercentageExceeds(80),
  taskCompleted(),
  consecutiveFailures(2),
  timeoutExceeded(2 * 60 * 1000), // 2 minute timeout
];
