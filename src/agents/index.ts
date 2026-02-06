/**
 * GLINR Agent System
 *
 * Public exports for the agentic loop system.
 */

// =============================================================================
// Types
// =============================================================================

export type {
  AgentStatus,
  ToolCallStatus,
  ToolCallRecord,
  AgentState,
  AgentContext,
  AgentArtifact,
  AgentResult,
  StopCondition,
  AgentConfig,
  AgentEvents,
  StepContext,
  ThinkingEffort,
} from './types.js';

export { EFFORT_BUDGET_MAP } from './types.js';

// =============================================================================
// Executor
// =============================================================================

export { AgentExecutor, createAgent, createSimpleAgent, createComplexAgent } from './executor.js';

// =============================================================================
// Stop Conditions
// =============================================================================

export {
  // Step conditions
  stepCountIs,
  stepCountExceeds,
  // Tool conditions
  hasToolCall,
  hasAnyToolCall,
  toolCallCount,
  totalToolCalls,
  sameToolRepeated,
  // Budget conditions
  budgetExceeded,
  budgetBelowThreshold,
  budgetPercentageExceeds,
  // Task completion conditions
  taskCompleted,
  modelIndicatesCompletion,
  noToolCallsInLastStep,
  // Error conditions
  toolCallFailed,
  consecutiveFailures,
  // Time conditions
  timeoutExceeded,
  // Composite conditions
  anyOf,
  allOf,
  not,
  custom,
  // Presets
  defaultStopConditions,
  minimalStopConditions,
  strictStopConditions,
} from './stop-conditions.js';
