/** Workflow definition - YAML/JSON compatible structure */
export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  /** Keywords that trigger this workflow */
  triggers: string[];
  /** Sequential steps (or parallel groups) */
  steps: WorkflowStep[];
  /** Variables available to all steps */
  variables?: Record<string, unknown>;
  /** Schedule trigger - cron expression to auto-run this workflow */
  schedule?: {
    cron?: string;
    intervalMs?: number;
    timezone?: string;
  };
  /** Delivery configuration - where to send final output */
  delivery?: {
    channels: Array<{
      type: 'telegram' | 'slack' | 'discord' | 'webhook';
      target: string;
    }>;
    /** Which step output(s) to include in delivery */
    includeOutputs?: string[];
    /** Template for formatting the delivery message */
    template?: string;
  };
  /** Max duration for entire workflow (ms) */
  timeoutMs?: number;
}

export type WorkflowStepType = 'tool' | 'agent_session' | 'deliver' | 'parallel';

export interface WorkflowStep {
  id: string;
  name: string;
  /** Step type - defaults to 'tool' for backwards compatibility */
  type?: WorkflowStepType;
  /** Tool to execute (for type=tool) */
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
  /** For type=parallel: steps to run concurrently */
  parallelSteps?: WorkflowStep[];
  /** For type=agent_session: AI prompt to execute */
  prompt?: string;
  /** For type=agent_session: AI model override */
  model?: string;
  /** For type=deliver: delivery target override */
  deliverTo?: {
    type: 'telegram' | 'slack' | 'discord' | 'webhook';
    target: string;
  };
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
