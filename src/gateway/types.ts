import type { Task, TaskResult } from '../types/task.js';
import type { AgentAdapter, AgentCapability } from '../types/agent.js';

/**
 * Gateway Request - incoming task routing request
 */
export interface GatewayRequest {
  /** The task to route and execute */
  task: Task;

  /** Preferred agent (optional) */
  preferredAgent?: string;

  /** Workflow template to use (optional) */
  workflow?: WorkflowType;

  /** Maximum execution time in milliseconds */
  timeoutMs?: number;

  /** Priority override (1-5, 1 being highest) */
  priority?: number;

  /** Whether to run autonomously without human-in-the-loop */
  autonomous?: boolean;

  /** Additional context for the task */
  context?: GatewayContext;
}

/**
 * Context passed through the gateway
 */
export interface GatewayContext {
  /** Repository information */
  repository?: {
    owner: string;
    name: string;
    branch?: string;
    path?: string;
  };

  /** Related issues/PRs */
  linkedIssues?: string[];
  linkedPRs?: string[];

  /** Previous task results for continuity */
  previousTasks?: string[];

  /** User preferences */
  preferences?: Record<string, unknown>;

  /** Environment variables to pass */
  env?: Record<string, string>;
}

/**
 * Gateway Response - result of routing and execution
 */
export interface GatewayResponse {
  /** Whether the request was successful */
  success: boolean;

  /** The task result from the agent */
  result?: TaskResult;

  /** Which agent handled the request */
  agent: AgentInfo;

  /** Routing decision details */
  routing: RoutingDecision;

  /** Workflow execution details (if applicable) */
  workflow?: WorkflowExecution;

  /** Error information if failed */
  error?: GatewayError;

  /** Metrics and timing */
  metrics: GatewayMetrics;
}

/**
 * Agent information in response
 */
export interface AgentInfo {
  type: string;
  name: string;
  instanceId?: string;
}

/**
 * Routing decision breakdown
 */
export interface RoutingDecision {
  /** How the agent was selected */
  method: 'explicit' | 'label_match' | 'capability_match' | 'priority' | 'fallback';

  /** Score breakdown for each considered agent */
  scores: AgentScore[];

  /** Why this agent was selected */
  reason: string;

  /** Time taken to route (ms) */
  routingTimeMs: number;
}

/**
 * Agent scoring for routing
 */
export interface AgentScore {
  agentType: string;
  agentId: string;
  totalScore: number;
  breakdown: {
    capabilityMatch: number;
    labelMatch: number;
    priorityWeight: number;
    loadPenalty: number;
    historicalSuccess: number;
  };
  eligible: boolean;
  reason?: string;
}

/**
 * Workflow types supported
 */
export type WorkflowType =
  | 'autonomous'      // Full auto: setup → implement → test → commit → push
  | 'review'          // Code review workflow
  | 'fix'             // Bug fix workflow
  | 'feature'         // Feature development workflow
  | 'refactor'        // Code refactoring workflow
  | 'test'            // Testing/QA workflow
  | 'docs'            // Documentation workflow
  | 'custom';         // Custom workflow from template

/**
 * Workflow step definition
 */
export interface WorkflowStep {
  id: string;
  name: string;
  description: string;
  order: number;

  /** Prompt template for this step */
  promptTemplate: string;

  /** Expected outputs from this step */
  expectedOutputs: string[];

  /** Whether this step can be skipped */
  optional: boolean;

  /** Max retries for this step */
  maxRetries: number;

  /** Timeout for this step (ms) */
  timeoutMs: number;

  /** Validation function name */
  validation?: string;
}

/**
 * Workflow template definition
 */
export interface WorkflowTemplate {
  type: WorkflowType;
  name: string;
  description: string;
  steps: WorkflowStep[];

  /** Required capabilities for this workflow */
  requiredCapabilities: AgentCapability[];

  /** Default timeout for the entire workflow */
  defaultTimeoutMs: number;

  /** Whether to continue on step failure */
  continueOnFailure: boolean;
}

/**
 * Workflow execution tracking
 */
export interface WorkflowExecution {
  workflowType: WorkflowType;
  currentStep: number;
  totalSteps: number;
  completedSteps: StepResult[];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: Date;
  completedAt?: Date;
}

/**
 * Individual step result
 */
export interface StepResult {
  stepId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  output?: string;
  artifacts?: Artifact[];
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  retryCount: number;
}

/**
 * Artifact produced during workflow
 */
export interface Artifact {
  type: 'commit' | 'pr' | 'file' | 'test_result' | 'coverage' | 'log';
  name: string;
  value: string;
  metadata?: Record<string, unknown>;
}

/**
 * Gateway error details
 */
export interface GatewayError {
  code: GatewayErrorCode;
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
  suggestedAction?: string;
}

/**
 * Gateway error codes
 */
export type GatewayErrorCode =
  | 'NO_AGENT_AVAILABLE'
  | 'AGENT_UNHEALTHY'
  | 'ROUTING_FAILED'
  | 'EXECUTION_FAILED'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'WORKFLOW_FAILED'
  | 'VALIDATION_FAILED'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED';

/**
 * Gateway metrics
 */
export interface GatewayMetrics {
  /** Total time from request to response */
  totalTimeMs: number;

  /** Time spent routing */
  routingTimeMs: number;

  /** Time spent executing */
  executionTimeMs: number;

  /** Token usage (if tracked) */
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };

  /** Number of retries */
  retryCount: number;
}

/**
 * Gateway configuration
 */
export interface GatewayConfig {
  /** Default timeout for requests */
  defaultTimeoutMs: number;

  /** Maximum concurrent requests */
  maxConcurrent: number;

  /** Whether to enable autonomous mode by default */
  defaultAutonomous: boolean;

  /** Default workflow for tasks without explicit workflow */
  defaultWorkflow: WorkflowType;

  /** Minimum score required for agent selection */
  minAgentScore: number;

  /** Whether to use historical success rates in scoring */
  useHistoricalScoring: boolean;

  /** Rate limiting configuration */
  rateLimit?: {
    maxRequestsPerMinute: number;
    maxRequestsPerHour: number;
  };
}

/**
 * Gateway status information
 */
export interface GatewayStatus {
  /** Whether the gateway is operational */
  online: boolean;

  /** Number of currently active requests */
  activeRequests: number;

  /** Maximum concurrent requests allowed */
  maxConcurrent: number;

  /** Current load per agent */
  agentLoads: Record<string, number>;

  /** Historical performance per agent */
  history: Array<{
    agentId: string;
    totalTasks: number;
    successfulTasks: number;
    successRate: number;
    averageDurationMs: number;
    lastUsed: Date;
  }>;

  /** Gateway uptime in milliseconds */
  uptime: number;
}

/**
 * Gateway interface
 */
export interface Gateway {
  /** Route and execute a task */
  execute(request: GatewayRequest): Promise<GatewayResponse>;

  /** Get gateway status with metrics */
  getStatus(): GatewayStatus;

  /** Get available agents */
  getAgents(): AgentAdapter[];

  /** Get agent health status */
  getAgentHealth(agentId: string): Promise<import('../types/agent.js').AgentHealth>;

  /** Get gateway configuration */
  getConfig(): GatewayConfig;

  /** Update gateway configuration */
  updateConfig(config: Partial<GatewayConfig>): void;

  /** Get workflow templates */
  getWorkflowTemplates(): WorkflowTemplate[];

  /** Get workflow by type */
  getWorkflow(type: WorkflowType): WorkflowTemplate | undefined;
}
