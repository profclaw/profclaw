/** Workflow definition - YAML/JSON compatible structure */
export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  /** Keywords that trigger this workflow */
  triggers: string[];
  /** Sequential steps */
  steps: WorkflowStep[];
  /** Variables available to all steps */
  variables?: Record<string, unknown>;
}

export interface WorkflowStep {
  id: string;
  name: string;
  /** Tool to execute */
  tool: string;
  /** Parameters - supports {{variable}} interpolation from previous step outputs */
  params: Record<string, unknown>;
  /** Condition to skip this step (simple expression) */
  condition?: string;
  /** Which output field to capture for later steps */
  captureOutput?: string;
  /** Whether failure of this step is fatal */
  continueOnError?: boolean;
  /** Timeout override in ms */
  timeoutMs?: number;
}

export interface WorkflowExecution {
  workflowId: string;
  conversationId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  currentStep: number;
  stepResults: WorkflowStepResult[];
  variables: Record<string, unknown>;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

export interface WorkflowStepResult {
  stepId: string;
  toolName: string;
  status: 'pending' | 'running' | 'completed' | 'skipped' | 'failed';
  output?: unknown;
  error?: string;
  durationMs?: number;
}

export interface WorkflowSummary {
  workflowId: string;
  name: string;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  totalDurationMs: number;
  outputs: Record<string, unknown>;
}

export interface WorkflowExecutionContext {
  conversationId: string;
  /** Function to execute a tool by name */
  toolExecutor: (toolName: string, params: Record<string, unknown>) => Promise<import('../types.js').ToolResult>;
  /** Initial variables */
  variables?: Record<string, unknown>;
  signal?: AbortSignal;
  onStepStart?: (step: WorkflowStep, index: number) => void;
  onStepComplete?: (step: WorkflowStep, result: WorkflowStepResult) => void;
}

export interface WorkflowExecuteOptions {
  /** Steps to skip by ID */
  skipSteps?: string[];
  /** Override params for specific steps */
  overrides?: Record<string, Record<string, unknown>>;
}

export interface WorkflowMatch {
  workflow: WorkflowDefinition;
  /** Confidence score 0-1 */
  confidence: number;
  extractedVariables: Record<string, string>;
}
