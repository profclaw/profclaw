import type { Task, TaskResult, TaskArtifact } from '../types/task.js';
import type { AgentAdapter, AgentCapability, AgentHealth } from '../types/agent.js';
import type {
  Gateway,
  GatewayConfig,
  GatewayRequest,
  GatewayResponse,
  GatewayError,
  AgentScore,
  RoutingDecision,
  WorkflowExecution,
  StepResult,
  Artifact,
  WorkflowTemplate,
  WorkflowType,
} from './types.js';
import { getWorkflow, getAllWorkflows, inferWorkflow, interpolateTemplate } from './workflows.js';
import { getAgentRegistry } from '../adapters/registry.js';

/**
 * Default gateway configuration
 */
const DEFAULT_CONFIG: GatewayConfig = {
  defaultTimeoutMs: 5 * 60 * 1000, // 5 minutes
  maxConcurrent: 10,
  defaultAutonomous: false,
  defaultWorkflow: 'autonomous',
  minAgentScore: 10,
  useHistoricalScoring: true,
};

/**
 * Historical success tracking for agents
 */
interface AgentHistory {
  agentId: string;
  totalTasks: number;
  successfulTasks: number;
  averageDurationMs: number;
  lastUsed: Date;
}

/**
 * Cooldown tracking for agents after failures
 */
interface AgentCooldown {
  agentId: string;
  failedAt: Date;
  consecutiveFailures: number;
}

/**
 * Gateway Router Implementation
 *
 * Routes tasks to appropriate agents based on:
 * - Explicit assignment
 * - Capability matching
 * - Label matching
 * - Historical performance
 * - Current load
 */
export class GatewayRouter implements Gateway {
  private config: GatewayConfig;
  private history: Map<string, AgentHistory> = new Map();
  private currentLoad: Map<string, number> = new Map();
  private cooldowns: Map<string, AgentCooldown> = new Map();
  private activeRequests = 0;

  // Cooldown settings
  private readonly baseCooldownMs = 30000; // 30 seconds base cooldown
  private readonly maxCooldownMs = 300000; // 5 minutes max cooldown
  private readonly cooldownMultiplier = 2; // Exponential backoff

  constructor(config: Partial<GatewayConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a gateway request
   */
  async execute(request: GatewayRequest): Promise<GatewayResponse> {
    const startTime = Date.now();
    let routingTimeMs = 0;
    let executionTimeMs = 0;

    // Check concurrent request limit
    if (this.activeRequests >= this.config.maxConcurrent) {
      return this.createErrorResponse(
        request,
        {
          code: 'RATE_LIMITED',
          message: 'Too many concurrent requests',
          retryable: true,
          suggestedAction: 'Wait and retry',
        },
        startTime
      );
    }

    this.activeRequests++;

    try {
      // Route to best agent
      const routingStart = Date.now();
      const routing = await this.routeTask(request);
      routingTimeMs = Date.now() - routingStart;

      if (!routing.selectedAgent) {
        this.activeRequests--;
        return this.createErrorResponse(
          request,
          {
            code: 'NO_AGENT_AVAILABLE',
            message: routing.reason,
            retryable: true,
            suggestedAction: 'Check agent availability or adjust task requirements',
            details: { scores: routing.scores },
          },
          startTime,
          routing
        );
      }

      // Check agent health
      const health = await routing.selectedAgent.healthCheck();
      if (!health.healthy) {
        this.activeRequests--;
        return this.createErrorResponse(
          request,
          {
            code: 'AGENT_UNHEALTHY',
            message: `Agent ${routing.selectedAgent.name} is not healthy: ${health.message}`,
            retryable: true,
            suggestedAction: 'Try a different agent or wait',
          },
          startTime,
          routing
        );
      }

      // Increment load counter
      this.incrementLoad(routing.selectedAgentId);

      // Execute workflow or single task
      const executionStart = Date.now();
      let result;
      let workflowExecution: WorkflowExecution | undefined;

      const workflowType = request.workflow || inferWorkflow(request.task);
      const workflow = getWorkflow(workflowType);

      if (workflow && workflow.steps.length > 0 && (request.autonomous ?? this.config.defaultAutonomous)) {
        // Execute as workflow
        const { result: workflowResult, execution } = await this.executeWorkflow(
          request,
          routing.selectedAgent,
          workflow
        );
        result = workflowResult;
        workflowExecution = execution;
      } else {
        // Execute as single task
        result = await this.executeWithTimeout(
          routing.selectedAgent.executeTask(request.task),
          request.timeoutMs || this.config.defaultTimeoutMs
        );
      }

      executionTimeMs = Date.now() - executionStart;

      // Update history
      this.updateHistory(routing.selectedAgentId, result.success, executionTimeMs);

      // Decrement load counter
      this.decrementLoad(routing.selectedAgentId);
      this.activeRequests--;

      return {
        success: result.success,
        result,
        agent: {
          type: routing.selectedAgent.type,
          name: routing.selectedAgent.name,
          instanceId: routing.selectedAgentId,
        },
        routing: {
          method: routing.method,
          scores: routing.scores,
          reason: routing.reason,
          routingTimeMs,
        },
        workflow: workflowExecution,
        error: result.success ? undefined : {
          code: 'EXECUTION_FAILED',
          message: result.error?.message || 'Task execution failed',
          retryable: true,
          details: result.error,
        },
        metrics: {
          totalTimeMs: Date.now() - startTime,
          routingTimeMs,
          executionTimeMs,
          tokenUsage: result.tokensUsed ? {
            inputTokens: result.tokensUsed.input,
            outputTokens: result.tokensUsed.output,
            totalTokens: result.tokensUsed.total,
            estimatedCostUsd: result.cost?.amount || 0,
          } : undefined,
          retryCount: 0,
        },
      };
    } catch (error) {
      this.activeRequests--;
      return this.createErrorResponse(
        request,
        {
          code: 'EXECUTION_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error',
          retryable: true,
        },
        startTime
      );
    }
  }

  /**
   * Route task to best available agent
   */
  private async routeTask(request: GatewayRequest): Promise<{
    selectedAgent?: AgentAdapter;
    selectedAgentId: string;
    method: RoutingDecision['method'];
    scores: AgentScore[];
    reason: string;
  }> {
    const registry = getAgentRegistry();
    const scores: AgentScore[] = [];

    // Check for explicit assignment
    if (request.preferredAgent) {
      const adapter = registry.getAdapter(request.preferredAgent);
      if (adapter) {
        return {
          selectedAgent: adapter,
          selectedAgentId: request.preferredAgent,
          method: 'explicit',
          scores: [],
          reason: `Explicitly assigned to ${adapter.name}`,
        };
      }
    }

    // Check task-level assignment
    if (request.task.assignedAgent) {
      const adapter = registry.getAdapter(request.task.assignedAgent);
      if (adapter) {
        return {
          selectedAgent: adapter,
          selectedAgentId: request.task.assignedAgent,
          method: 'explicit',
          scores: [],
          reason: `Task assigned to ${adapter.name}`,
        };
      }
    }

    // Score all available agents
    const activeAdapters = registry.getActiveAdapters();
    const inferredType = this.inferTaskType(request.task);
    const requiredCapabilities = this.getRequiredCapabilities(request);

    for (const adapter of activeAdapters) {
      const agentId = adapter.type; // Use type as ID for now
      const score = this.scoreAgent(adapter, agentId, request, inferredType, requiredCapabilities);
      scores.push(score);
    }

    // Sort by total score descending
    scores.sort((a, b) => b.totalScore - a.totalScore);

    // Find best eligible agent
    const bestScore = scores.find(s => s.eligible);

    if (!bestScore) {
      return {
        selectedAgentId: '',
        method: 'fallback',
        scores,
        reason: 'No eligible agents found',
      };
    }

    // Check minimum score threshold
    if (bestScore.totalScore < this.config.minAgentScore) {
      return {
        selectedAgentId: '',
        method: 'fallback',
        scores,
        reason: `Best score (${bestScore.totalScore}) below minimum threshold (${this.config.minAgentScore})`,
      };
    }

    const adapter = registry.getAdapter(bestScore.agentId) ||
                    activeAdapters.find(a => a.type === bestScore.agentType);

    return {
      selectedAgent: adapter,
      selectedAgentId: bestScore.agentId,
      method: bestScore.breakdown.labelMatch > 0 ? 'label_match' :
              bestScore.breakdown.capabilityMatch > 0 ? 'capability_match' : 'priority',
      scores,
      reason: `Selected ${adapter?.name} with score ${bestScore.totalScore}`,
    };
  }

  /**
   * Score an agent for a task
   */
  private scoreAgent(
    adapter: AgentAdapter,
    agentId: string,
    request: GatewayRequest,
    taskType: string,
    requiredCapabilities: AgentCapability[]
  ): AgentScore {
    const breakdown = {
      capabilityMatch: 0,
      labelMatch: 0,
      priorityWeight: 0,
      loadPenalty: 0,
      historicalSuccess: 0,
      cooldownPenalty: 0,
    };

    let eligible = true;
    let reason: string | undefined;

    // Check cooldown status
    const cooldown = this.cooldowns.get(agentId);
    if (cooldown) {
      const cooldownDuration = this.calculateCooldownDuration(cooldown.consecutiveFailures);
      const elapsed = Date.now() - cooldown.failedAt.getTime();

      if (elapsed < cooldownDuration) {
        // Agent is still in cooldown
        eligible = false;
        reason = `Agent in cooldown (${Math.ceil((cooldownDuration - elapsed) / 1000)}s remaining)`;
        breakdown.cooldownPenalty = -100; // Heavy penalty to ensure it's not selected
      } else {
        // Cooldown expired, but apply a small penalty based on recent failures
        breakdown.cooldownPenalty = -Math.min(cooldown.consecutiveFailures * 3, 15);
      }
    }

    // Capability matching (0-30 points)
    if (requiredCapabilities.length > 0) {
      const matched = requiredCapabilities.filter(cap =>
        adapter.capabilities.includes(cap)
      );
      breakdown.capabilityMatch = Math.round((matched.length / requiredCapabilities.length) * 30);

      if (matched.length === 0) {
        eligible = false;
        reason = 'No matching capabilities';
      }
    } else {
      breakdown.capabilityMatch = 15; // Default if no specific requirements
    }

    // Label matching (0-20 points)
    const taskLabels = request.task.labels.map(l => l.toLowerCase());
    const agentLabels = ['bug_fix', 'feature', 'testing', 'docs', 'refactor']
      .filter(t => adapter.capabilities.includes(t as AgentCapability));

    if (taskLabels.length > 0) {
      const matchedLabels = taskLabels.filter(l => {
        const normalizedLabel = l.replace(/-/g, '_');
        return agentLabels.some(al => al.includes(normalizedLabel) || normalizedLabel.includes(al));
      });
      breakdown.labelMatch = Math.min(matchedLabels.length * 5, 20);
    }

    // Priority weight (0-10 points)
    // Higher priority adapters get more points
    breakdown.priorityWeight = 5;

    // Load penalty (0 to -10 points)
    const currentLoad = this.currentLoad.get(agentId) || 0;
    breakdown.loadPenalty = -Math.min(currentLoad * 2, 10);

    // Historical success rate (0-20 points)
    if (this.config.useHistoricalScoring) {
      const history = this.history.get(agentId);
      if (history && history.totalTasks > 0) {
        const successRate = history.successfulTasks / history.totalTasks;
        breakdown.historicalSuccess = Math.round(successRate * 20);
      } else {
        breakdown.historicalSuccess = 10; // Default for new agents
      }
    }

    const totalScore =
      breakdown.capabilityMatch +
      breakdown.labelMatch +
      breakdown.priorityWeight +
      breakdown.loadPenalty +
      breakdown.historicalSuccess +
      (breakdown.cooldownPenalty || 0);

    return {
      agentType: adapter.type,
      agentId,
      totalScore,
      breakdown,
      eligible,
      reason,
    };
  }

  /**
   * Execute a workflow
   */
  private async executeWorkflow(
    request: GatewayRequest,
    agent: AgentAdapter,
    workflow: WorkflowTemplate
  ): Promise<{ result: TaskResult; execution: WorkflowExecution }> {
    const execution: WorkflowExecution = {
      workflowType: workflow.type,
      currentStep: 0,
      totalSteps: workflow.steps.length,
      completedSteps: [],
      status: 'running',
      startedAt: new Date(),
    };

    let lastOutput = '';
    const artifacts: Artifact[] = [];
    let overallSuccess = true;

    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      execution.currentStep = i + 1;

      const stepResult: StepResult = {
        stepId: step.id,
        status: 'running',
        startedAt: new Date(),
        retryCount: 0,
      };

      // Interpolate prompt template
      const prompt = interpolateTemplate(step.promptTemplate, {
        task: request.task,
        previousStep: { output: lastOutput },
      });

      // Create a task for this step
      const stepTask: Task = {
        ...request.task,
        id: `${request.task.id}-step-${step.id}`,
        title: `${request.task.title} - ${step.name}`,
        prompt,
      };

      // Execute step with retries
      let success = false;
      let error: string | undefined;
      let retryCount = 0;

      while (!success && retryCount <= step.maxRetries) {
        try {
          const result = await this.executeWithTimeout(
            agent.executeTask(stepTask),
            step.timeoutMs
          );

          if (result.success) {
            success = true;
            lastOutput = result.output || '';
            stepResult.output = lastOutput;

            // Extract artifacts from TaskResult.artifacts (TaskArtifact[])
            if (result.artifacts && Array.isArray(result.artifacts)) {
              for (const artifact of result.artifacts) {
                if (artifact.type === 'commit') {
                  artifacts.push({
                    type: 'commit',
                    name: artifact.sha || 'unknown',
                    value: artifact.sha || artifact.url || '',
                  });
                } else if (artifact.type === 'pull_request') {
                  artifacts.push({
                    type: 'pr',
                    name: artifact.url || 'unknown',
                    value: artifact.url || '',
                  });
                } else if (artifact.type === 'file') {
                  artifacts.push({
                    type: 'file',
                    name: artifact.path || 'unknown',
                    value: artifact.path || '',
                  });
                }
              }
            }
          } else {
            error = result.error?.message || 'Step failed';
            retryCount++;
          }
        } catch (e) {
          error = e instanceof Error ? e.message : 'Unknown error';
          retryCount++;
        }
      }

      stepResult.retryCount = retryCount;
      stepResult.completedAt = new Date();

      if (success) {
        stepResult.status = 'completed';
        stepResult.artifacts = artifacts.filter(a =>
          a.name.includes(step.id) || step.expectedOutputs.some(o => a.name.includes(o))
        );
      } else if (step.optional) {
        stepResult.status = 'skipped';
        stepResult.error = error;
      } else {
        stepResult.status = 'failed';
        stepResult.error = error;
        overallSuccess = false;

        if (!workflow.continueOnFailure) {
          execution.status = 'failed';
          execution.completedAt = new Date();
          execution.completedSteps.push(stepResult);
          break;
        }
      }

      execution.completedSteps.push(stepResult);
    }

    if (overallSuccess) {
      execution.status = 'completed';
    }
    execution.completedAt = new Date();

    // Convert gateway artifacts back to TaskArtifact format
    const taskArtifacts: TaskArtifact[] = artifacts.map(a => {
      if (a.type === 'commit') {
        return { type: 'commit' as const, sha: a.value };
      } else if (a.type === 'pr') {
        return { type: 'pull_request' as const, url: a.value };
      } else {
        return { type: 'file' as const, path: a.value };
      }
    });

    return {
      result: {
        success: overallSuccess,
        output: lastOutput,
        artifacts: taskArtifacts,
      },
      execution,
    };
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Execution timeout')), timeoutMs);
    });

    return Promise.race([promise, timeout]);
  }

  /**
   * Infer task type from content
   */
  private inferTaskType(task: Task): string {
    const labels = task.labels.map(l => l.toLowerCase());
    const content = `${task.title} ${task.description || ''} ${task.prompt}`.toLowerCase();

    if (labels.includes('bug') || content.includes('fix')) return 'bug_fix';
    if (labels.includes('feature') || content.includes('implement')) return 'feature';
    if (labels.includes('test') || content.includes('test')) return 'testing';
    if (labels.includes('docs') || content.includes('documentation')) return 'docs';
    if (labels.includes('refactor') || content.includes('refactor')) return 'refactor';
    if (content.includes('review')) return 'code_review';

    return 'general';
  }

  /**
   * Get required capabilities for request
   */
  private getRequiredCapabilities(request: GatewayRequest): AgentCapability[] {
    const workflowType = request.workflow || inferWorkflow(request.task);
    const workflow = getWorkflow(workflowType);

    if (workflow) {
      return workflow.requiredCapabilities;
    }

    // Default capabilities based on task type
    const taskType = this.inferTaskType(request.task);
    const capMap: Record<string, AgentCapability[]> = {
      bug_fix: ['bug_fix', 'code_generation'],
      feature: ['code_generation', 'file_operations'],
      testing: ['testing', 'code_generation'],
      docs: ['documentation'],
      refactor: ['refactoring', 'code_generation'],
      code_review: ['code_review'],
      general: ['code_generation'],
    };

    return capMap[taskType] || ['code_generation'];
  }

  /**
   * Create error response
   */
  private createErrorResponse(
    request: GatewayRequest,
    error: GatewayError,
    startTime: number,
    routing?: { scores: AgentScore[]; reason: string }
  ): GatewayResponse {
    return {
      success: false,
      agent: {
        type: 'none',
        name: 'No agent',
      },
      routing: {
        method: 'fallback',
        scores: routing?.scores || [],
        reason: routing?.reason || error.message,
        routingTimeMs: 0,
      },
      error,
      metrics: {
        totalTimeMs: Date.now() - startTime,
        routingTimeMs: 0,
        executionTimeMs: 0,
        retryCount: 0,
      },
    };
  }

  /**
   * Update agent history and cooldown status
   */
  private updateHistory(agentId: string, success: boolean, durationMs: number): void {
    // Update history
    const history = this.history.get(agentId) || {
      agentId,
      totalTasks: 0,
      successfulTasks: 0,
      averageDurationMs: 0,
      lastUsed: new Date(),
    };

    history.totalTasks++;
    if (success) history.successfulTasks++;

    // Rolling average for duration
    history.averageDurationMs =
      (history.averageDurationMs * (history.totalTasks - 1) + durationMs) / history.totalTasks;

    history.lastUsed = new Date();
    this.history.set(agentId, history);

    // Update cooldown status
    this.updateCooldown(agentId, success);
  }

  /**
   * Increment load counter
   */
  private incrementLoad(agentId: string): void {
    this.currentLoad.set(agentId, (this.currentLoad.get(agentId) || 0) + 1);
  }

  /**
   * Decrement load counter
   */
  private decrementLoad(agentId: string): void {
    const current = this.currentLoad.get(agentId) || 0;
    if (current > 0) {
      this.currentLoad.set(agentId, current - 1);
    }
  }

  /**
   * Calculate cooldown duration based on consecutive failures
   * Uses exponential backoff: 30s, 60s, 120s, 240s, max 300s
   */
  private calculateCooldownDuration(consecutiveFailures: number): number {
    const duration = this.baseCooldownMs * Math.pow(this.cooldownMultiplier, consecutiveFailures - 1);
    return Math.min(duration, this.maxCooldownMs);
  }

  /**
   * Update cooldown status for an agent
   * Called on task failure to track consecutive failures
   */
  private updateCooldown(agentId: string, success: boolean): void {
    if (success) {
      // Success clears cooldown
      this.cooldowns.delete(agentId);
    } else {
      // Failure increments cooldown
      const existing = this.cooldowns.get(agentId);
      this.cooldowns.set(agentId, {
        agentId,
        failedAt: new Date(),
        consecutiveFailures: existing ? existing.consecutiveFailures + 1 : 1,
      });
    }
  }

  // Gateway interface methods

  /**
   * Get gateway status with metrics
   */
  getStatus(): {
    online: boolean;
    activeRequests: number;
    maxConcurrent: number;
    agentLoads: Record<string, number>;
    history: Array<{
      agentId: string;
      totalTasks: number;
      successfulTasks: number;
      successRate: number;
      averageDurationMs: number;
      lastUsed: Date;
    }>;
    uptime: number;
  } {
    const historyEntries = Array.from(this.history.entries()).map(([agentId, h]) => ({
      agentId,
      totalTasks: h.totalTasks,
      successfulTasks: h.successfulTasks,
      successRate: h.totalTasks > 0 ? h.successfulTasks / h.totalTasks : 0,
      averageDurationMs: h.averageDurationMs,
      lastUsed: h.lastUsed,
    }));

    const agentLoads: Record<string, number> = {};
    this.currentLoad.forEach((load, agentId) => {
      agentLoads[agentId] = load;
    });

    return {
      online: true,
      activeRequests: this.activeRequests,
      maxConcurrent: this.config.maxConcurrent,
      agentLoads,
      history: historyEntries,
      uptime: process.uptime() * 1000,
    };
  }

  getAgents(): AgentAdapter[] {
    return getAgentRegistry().getActiveAdapters();
  }

  async getAgentHealth(agentId: string): Promise<AgentHealth> {
    const adapter = getAgentRegistry().getAdapter(agentId);
    if (!adapter) {
      return {
        healthy: false,
        message: 'Agent not found',
        lastChecked: new Date(),
      };
    }
    return adapter.healthCheck();
  }

  getConfig(): GatewayConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<GatewayConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getWorkflowTemplates(): WorkflowTemplate[] {
    return getAllWorkflows();
  }

  getWorkflow(type: WorkflowType): WorkflowTemplate | undefined {
    return getWorkflow(type);
  }
}

// Singleton instance
let gateway: Gateway | null = null;

/**
 * Get the gateway singleton
 */
export function getGateway(config?: Partial<GatewayConfig>): Gateway {
  if (!gateway) {
    gateway = new GatewayRouter(config);
  }
  return gateway;
}

/**
 * Create a new gateway instance (for testing)
 */
export function createGateway(config?: Partial<GatewayConfig>): Gateway {
  return new GatewayRouter(config);
}
