/**
 * Multi-Agent Orchestrator
 *
 * Enables spawning, managing, and merging results from sub-agents.
 * Supports orchestration patterns:
 *   - Fan-out: N parallel workers + 1 synthesizer
 *   - Pipeline: sequential agent chain (A -> B -> C)
 *   - Debate: 2+ agents argue, 1 judges
 *
 * Each sub-agent gets an isolated session with scoped tool access.
 * Parent can set token budgets, timeouts, and tool policies per child.
 */

import { randomUUID } from 'node:crypto';
import { createContextualLogger } from '../utils/logger.js';

const log = createContextualLogger('Orchestrator');

// Types

export type OrchestrationPattern = 'fan_out' | 'pipeline' | 'debate' | 'custom';

export interface SubAgentConfig {
  id: string;
  name: string;
  /** The prompt/task for this sub-agent */
  prompt: string;
  /** System prompt override */
  systemPrompt?: string;
  /** AI model to use */
  model?: string;
  /** Max tokens this agent can consume */
  maxTokens?: number;
  /** Timeout in ms (default: 300000 = 5min) */
  timeoutMs?: number;
  /** Which tools this agent can access (empty = all) */
  allowedTools?: string[];
  /** Thinking effort */
  effort?: 'low' | 'medium' | 'high';
}

export interface SubAgentResult {
  agentId: string;
  agentName: string;
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
  tokensUsed?: number;
}

export interface OrchestrationConfig {
  /** Unique ID for this orchestration */
  id: string;
  /** Human-readable name */
  name: string;
  /** Which pattern to use */
  pattern: OrchestrationPattern;
  /** Sub-agent configurations */
  agents: SubAgentConfig[];
  /** For fan_out: prompt for the synthesizer that merges results */
  synthesizerPrompt?: string;
  /** For debate: prompt for the judge */
  judgePrompt?: string;
  /** For pipeline: output of agent N becomes input context for agent N+1 */
  pipelineContext?: boolean;
  /** Overall timeout for the entire orchestration */
  timeoutMs?: number;
  /** Cancel all children if any fails */
  failFast?: boolean;
}

export interface OrchestrationResult {
  id: string;
  pattern: OrchestrationPattern;
  success: boolean;
  /** Individual agent results */
  agentResults: SubAgentResult[];
  /** Synthesized/final output */
  finalOutput: string;
  totalDurationMs: number;
  totalTokens: number;
  error?: string;
}

// Active orchestrations for cancellation
const activeOrchestrations = new Map<string, AbortController>();

/**
 * Run a sub-agent in an isolated session.
 */
async function runSubAgent(
  config: SubAgentConfig,
  contextInput?: string,
  signal?: AbortSignal,
): Promise<SubAgentResult> {
  const startTime = Date.now();

  try {
    const { executeAgenticChat } = await import('../chat/agentic-executor.js');
    const { createChatToolHandler } = await import('../chat/tool-handler.js');

    const conversationId = `orchestrator-${config.id}-${randomUUID()}`;

    const toolHandler = await createChatToolHandler({
      conversationId,
      securityMode: 'full',
    });

    // Filter tools if restricted
    const allTools = toolHandler.getTools();
    const tools = config.allowedTools?.length
      ? allTools.filter((t) => config.allowedTools!.includes(t.name))
      : allTools;

    // Build the prompt - inject pipeline context if provided
    let fullPrompt = config.prompt;
    if (contextInput) {
      fullPrompt = `Context from previous step:\n${contextInput}\n\nYour task:\n${config.prompt}`;
    }

    const response = await Promise.race([
      executeAgenticChat({
        conversationId,
        messages: [{
          id: randomUUID(),
          role: 'user',
          content: fullPrompt,
          timestamp: new Date().toISOString(),
        }],
        systemPrompt: config.systemPrompt || 'You are a focused AI agent working on a specific sub-task. Be concise and thorough.',
        model: config.model,
        effort: config.effort || 'medium',
        toolHandler,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      }),
      new Promise<never>((_, reject) => {
        const timeout = config.timeoutMs || 300000;
        const timer = setTimeout(() => reject(new Error(`Sub-agent "${config.name}" timed out after ${timeout}ms`)), timeout);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error(`Sub-agent "${config.name}" cancelled`));
        });
      }),
    ]);

    return {
      agentId: config.id,
      agentName: config.name,
      success: true,
      output: response.content,
      durationMs: Date.now() - startTime,
      tokensUsed: response.usage?.totalTokens,
    };
  } catch (error) {
    return {
      agentId: config.id,
      agentName: config.name,
      success: false,
      output: '',
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Execute a fan-out orchestration: run N agents in parallel, then synthesize.
 */
async function executeFanOut(
  config: OrchestrationConfig,
  signal: AbortSignal,
): Promise<OrchestrationResult> {
  const startTime = Date.now();

  // Run all agents in parallel
  const results = await Promise.allSettled(
    config.agents.map((agent) => runSubAgent(agent, undefined, signal)),
  );

  const agentResults: SubAgentResult[] = results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      agentId: config.agents[i].id,
      agentName: config.agents[i].name,
      success: false,
      output: '',
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      durationMs: Date.now() - startTime,
    };
  });

  // Synthesize results
  let finalOutput = '';
  if (config.synthesizerPrompt) {
    const synthesisInput = agentResults
      .filter((r) => r.success)
      .map((r) => `[${r.agentName}]:\n${r.output}`)
      .join('\n\n---\n\n');

    const synthesisResult = await runSubAgent({
      id: 'synthesizer',
      name: 'Synthesizer',
      prompt: `${config.synthesizerPrompt}\n\nResults from ${agentResults.filter((r) => r.success).length} agents:\n\n${synthesisInput}`,
      model: config.agents[0]?.model,
      effort: 'medium',
    }, undefined, signal);

    agentResults.push(synthesisResult);
    finalOutput = synthesisResult.output;
  } else {
    finalOutput = agentResults
      .filter((r) => r.success)
      .map((r) => `## ${r.agentName}\n${r.output}`)
      .join('\n\n');
  }

  const totalTokens = agentResults.reduce((sum, r) => sum + (r.tokensUsed || 0), 0);

  return {
    id: config.id,
    pattern: 'fan_out',
    success: agentResults.some((r) => r.success),
    agentResults,
    finalOutput,
    totalDurationMs: Date.now() - startTime,
    totalTokens,
  };
}

/**
 * Execute a pipeline orchestration: A -> B -> C
 * Output of each agent becomes context for the next.
 */
async function executePipeline(
  config: OrchestrationConfig,
  signal: AbortSignal,
): Promise<OrchestrationResult> {
  const startTime = Date.now();
  const agentResults: SubAgentResult[] = [];
  let lastOutput = '';

  for (const agent of config.agents) {
    if (signal.aborted) break;

    const result = await runSubAgent(agent, lastOutput || undefined, signal);
    agentResults.push(result);

    if (!result.success && config.failFast) {
      return {
        id: config.id,
        pattern: 'pipeline',
        success: false,
        agentResults,
        finalOutput: '',
        totalDurationMs: Date.now() - startTime,
        totalTokens: agentResults.reduce((sum, r) => sum + (r.tokensUsed || 0), 0),
        error: `Pipeline failed at step "${agent.name}": ${result.error}`,
      };
    }

    if (result.success) {
      lastOutput = result.output;
    }
  }

  return {
    id: config.id,
    pattern: 'pipeline',
    success: agentResults.some((r) => r.success),
    agentResults,
    finalOutput: lastOutput,
    totalDurationMs: Date.now() - startTime,
    totalTokens: agentResults.reduce((sum, r) => sum + (r.tokensUsed || 0), 0),
  };
}

/**
 * Execute a debate orchestration: agents argue, judge decides.
 */
async function executeDebate(
  config: OrchestrationConfig,
  signal: AbortSignal,
): Promise<OrchestrationResult> {
  const startTime = Date.now();

  // Run debaters in parallel
  const debaterResults = await Promise.allSettled(
    config.agents.map((agent) => runSubAgent(agent, undefined, signal)),
  );

  const agentResults: SubAgentResult[] = debaterResults.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      agentId: config.agents[i].id,
      agentName: config.agents[i].name,
      success: false,
      output: '',
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      durationMs: Date.now() - startTime,
    };
  });

  // Judge the debate
  let finalOutput = '';
  if (config.judgePrompt) {
    const debateInput = agentResults
      .filter((r) => r.success)
      .map((r) => `[${r.agentName}] argues:\n${r.output}`)
      .join('\n\n---\n\n');

    const judgeResult = await runSubAgent({
      id: 'judge',
      name: 'Judge',
      prompt: `${config.judgePrompt}\n\nArguments:\n\n${debateInput}`,
      model: config.agents[0]?.model,
      effort: 'high',
    }, undefined, signal);

    agentResults.push(judgeResult);
    finalOutput = judgeResult.output;
  } else {
    finalOutput = agentResults.filter((r) => r.success).map((r) => r.output).join('\n\n');
  }

  return {
    id: config.id,
    pattern: 'debate',
    success: agentResults.some((r) => r.success),
    agentResults,
    finalOutput,
    totalDurationMs: Date.now() - startTime,
    totalTokens: agentResults.reduce((sum, r) => sum + (r.tokensUsed || 0), 0),
  };
}

// Public API

/**
 * Execute an orchestration.
 */
export async function orchestrate(config: OrchestrationConfig): Promise<OrchestrationResult> {
  const abortController = new AbortController();
  activeOrchestrations.set(config.id, abortController);

  // Overall timeout
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  if (config.timeoutMs) {
    timeoutHandle = setTimeout(() => abortController.abort(), config.timeoutMs);
  }

  log.info(`Starting orchestration: ${config.name} (${config.pattern}) with ${config.agents.length} agents`);

  try {
    let result: OrchestrationResult;

    switch (config.pattern) {
      case 'fan_out':
        result = await executeFanOut(config, abortController.signal);
        break;
      case 'pipeline':
        result = await executePipeline(config, abortController.signal);
        break;
      case 'debate':
        result = await executeDebate(config, abortController.signal);
        break;
      case 'custom':
        // Custom: just run all in parallel (same as fan_out without synthesis)
        result = await executeFanOut({ ...config, synthesizerPrompt: undefined }, abortController.signal);
        break;
      default:
        throw new Error(`Unknown orchestration pattern: ${config.pattern}`);
    }

    log.info(`Orchestration complete: ${config.name} - ${result.success ? 'success' : 'failed'} in ${result.totalDurationMs}ms (${result.totalTokens} tokens)`);

    return result;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    activeOrchestrations.delete(config.id);
  }
}

/**
 * Cancel a running orchestration.
 */
export function cancelOrchestration(id: string): boolean {
  const controller = activeOrchestrations.get(id);
  if (controller) {
    controller.abort();
    activeOrchestrations.delete(id);
    log.info(`Cancelled orchestration: ${id}`);
    return true;
  }
  return false;
}

/**
 * List active orchestrations.
 */
export function listActiveOrchestrations(): string[] {
  return [...activeOrchestrations.keys()];
}

// ---------------------------------------------------------------------------
// Class-based AgentOrchestrator
// ---------------------------------------------------------------------------

/**
 * A single unit of work dispatched to a sub-agent.
 */
export interface SubAgentTask {
  id: string;
  description: string;
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  tokensUsed: number;
}

/**
 * Configuration for AgentOrchestrator.
 */
export interface OrchestratorConfig {
  /** Maximum number of sub-tasks running concurrently (default: 3). */
  maxConcurrent: number;
  /** Timeout per sub-task in ms (default: 300_000). */
  timeoutMs: number;
  model?: string;
  provider?: string;
}

const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxConcurrent: 3,
  timeoutMs: 300_000,
};

// Singleton instance
let _instance: AgentOrchestrator | undefined;

/**
 * Class-based orchestrator for fan-out parallel sub-agent tasks.
 *
 * The caller provides an `apiCall` function that wraps the actual LLM API —
 * following the same injected-client pattern used by ContextCompactor.
 *
 * Usage:
 * ```ts
 * const orch = getAgentOrchestrator({ maxConcurrent: 2 });
 * const results = await orch.dispatch([
 *   { description: 'Summarise file A', prompt: '...' },
 *   { description: 'Summarise file B', prompt: '...' },
 * ], myApiCall);
 * console.log(orch.synthesize(results));
 * ```
 */
export class AgentOrchestrator {
  private readonly tasks: Map<string, SubAgentTask> = new Map();
  private readonly config: OrchestratorConfig;
  /** Number of tasks currently in the 'running' state. */
  private running = 0;
  /** Cancelled task IDs — checked before executing. */
  private readonly cancelled = new Set<string>();

  constructor(config?: Partial<OrchestratorConfig>) {
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Dispatch multiple sub-tasks in parallel, respecting `maxConcurrent`.
   * Resolves when every task has either completed, failed, or timed out.
   */
  async dispatch(
    taskDefs: Array<{ description: string; prompt: string }>,
    apiCall: (prompt: string) => Promise<string>,
  ): Promise<SubAgentTask[]> {
    // Build task objects
    const newTasks: SubAgentTask[] = taskDefs.map((def) => ({
      id: randomUUID(),
      description: def.description,
      prompt: def.prompt,
      status: 'pending',
      tokensUsed: 0,
    }));

    for (const task of newTasks) {
      this.tasks.set(task.id, task);
    }

    // Semaphore: release a "slot" whenever a task finishes so the next one starts.
    const queue = [...newTasks];
    const workers: Promise<void>[] = [];

    const next = (): Promise<void> => {
      const task = queue.shift();
      if (!task) return Promise.resolve();

      if (this.cancelled.has(task.id)) {
        task.status = 'failed';
        task.error = 'Task was cancelled before it started';
        return next();
      }

      this.running++;
      return this.runTask(task, apiCall).then(() => {
        this.running--;
        return next();
      });
    };

    // Seed up to maxConcurrent workers.
    const concurrency = Math.min(this.config.maxConcurrent, newTasks.length);
    for (let i = 0; i < concurrency; i++) {
      workers.push(next());
    }

    await Promise.all(workers);
    return newTasks;
  }

  /**
   * Run a single sub-agent task with timeout and cancellation support.
   * Mutates `task` in place and returns it.
   */
  async runTask(
    task: SubAgentTask,
    apiCall: (prompt: string) => Promise<string>,
  ): Promise<SubAgentTask> {
    if (this.cancelled.has(task.id)) {
      task.status = 'failed';
      task.error = 'Task was cancelled';
      task.completedAt = Date.now();
      return task;
    }

    task.status = 'running';
    task.startedAt = Date.now();

    const timeoutMs = this.config.timeoutMs;

    try {
      const result = await Promise.race([
        apiCall(task.prompt),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Task "${task.description}" timed out after ${timeoutMs}ms`)),
            timeoutMs,
          ),
        ),
      ]);

      // Re-check cancellation — task may have been cancelled while the API call was in flight.
      if (this.cancelled.has(task.id)) {
        task.status = 'failed';
        task.error = 'Task was cancelled';
      } else {
        task.status = 'completed';
        task.result = result;
      }
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : String(error);
      log.warn(`Sub-agent task failed: ${task.description} — ${task.error}`);
    } finally {
      task.completedAt = Date.now();
    }

    return task;
  }

  /**
   * Return a snapshot of all tasks tracked by this orchestrator.
   */
  getStatus(): SubAgentTask[] {
    return [...this.tasks.values()];
  }

  /**
   * Mark a task as cancelled.  If it is still pending it will be skipped
   * entirely; if it is already running the next post-API-call check will
   * mark it failed.
   */
  cancel(taskId: string): void {
    this.cancelled.add(taskId);
    const task = this.tasks.get(taskId);
    if (task && task.status === 'pending') {
      task.status = 'failed';
      task.error = 'Task was cancelled';
      task.completedAt = Date.now();
      log.info(`Cancelled pending task: ${taskId}`);
    }
  }

  /**
   * Build a markdown summary of completed task results.
   *
   * ```markdown
   * ## Task Results
   * ### 1. Summarise file A ✓
   * <result text>
   * ### 2. Summarise file B ✗
   * Error: timed out after 300000ms
   * ```
   */
  synthesize(tasks: SubAgentTask[]): string {
    const lines: string[] = ['## Task Results', ''];

    tasks.forEach((task, index) => {
      const marker = task.status === 'completed' ? '✓' : '✗';
      lines.push(`### ${index + 1}. ${task.description} ${marker}`);

      if (task.status === 'completed' && task.result) {
        lines.push(task.result);
      } else if (task.status === 'failed') {
        lines.push(`Error: ${task.error ?? 'Unknown error'}`);
      } else {
        lines.push(`Status: ${task.status}`);
      }

      lines.push('');
    });

    return lines.join('\n').trimEnd();
  }

  /**
   * Wait until all currently-tracked tasks have left the 'pending' or
   * 'running' state, or until the optional `timeoutMs` elapses.
   *
   * Resolves with the current task snapshot once settled.
   */
  async waitAll(timeoutMs?: number): Promise<SubAgentTask[]> {
    const poll = (): boolean =>
      [...this.tasks.values()].every(
        (t) => t.status === 'completed' || t.status === 'failed',
      );

    if (poll()) return this.getStatus();

    const deadline = timeoutMs ? Date.now() + timeoutMs : Infinity;
    const INTERVAL = 50;

    return new Promise<SubAgentTask[]>((resolve) => {
      const check = (): void => {
        if (poll()) {
          resolve(this.getStatus());
          return;
        }
        if (Date.now() >= deadline) {
          resolve(this.getStatus());
          return;
        }
        setTimeout(check, INTERVAL);
      };
      setTimeout(check, INTERVAL);
    });
  }
}

/**
 * Return a lazily-created singleton `AgentOrchestrator`.
 * Pass `config` on first call to customise defaults; subsequent calls with
 * a different config will replace the singleton.
 */
export function getAgentOrchestrator(
  config?: Partial<OrchestratorConfig>,
): AgentOrchestrator {
  if (!_instance || config) {
    _instance = new AgentOrchestrator(config);
  }
  return _instance;
}
