/**
 * GLINR Gateway Module
 *
 * Unified interface for routing and executing tasks across multiple AI agents.
 * Similar to OpenClaw's gateway pattern but enhanced with:
 *
 * - Scoring-based agent selection
 * - Workflow templates for autonomous execution
 * - Historical performance tracking
 * - Load balancing across agents
 *
 * Usage:
 *
 * ```typescript
 * import { getGateway } from './gateway/index.js';
 *
 * const gateway = getGateway();
 *
 * const response = await gateway.execute({
 *   task: myTask,
 *   workflow: 'autonomous',
 *   autonomous: true,
 * });
 *
 * if (response.success) {
 *   console.log('Task completed:', response.result);
 *   console.log('Agent used:', response.agent.name);
 *   console.log('Workflow:', response.workflow);
 * }
 * ```
 */

// TODO(@copilot): Generate unit tests for this module
// Key functions to test: getGateway, createGateway, GatewayRouter, getWorkflow, getAllWorkflows, inferWorkflow, interpolateTemplate
// Test file location: src/gateway/tests/index.test.ts

// Types
export type {
  Gateway,
  GatewayConfig,
  GatewayRequest,
  GatewayResponse,
  GatewayContext,
  GatewayError,
  GatewayErrorCode,
  GatewayMetrics,
  AgentInfo,
  AgentScore,
  RoutingDecision,
  WorkflowType,
  WorkflowTemplate,
  WorkflowStep,
  WorkflowExecution,
  StepResult,
  Artifact,
} from './types.js';

// Router
export {
  GatewayRouter,
  getGateway,
  createGateway,
} from './router.js';

// Workflows
export {
  workflows,
  getWorkflow,
  getAllWorkflows,
  inferWorkflow,
  interpolateTemplate,
} from './workflows.js';
