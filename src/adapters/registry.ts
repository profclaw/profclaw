import type {
  AgentAdapter,
  AgentAdapterFactory,
  AgentConfig,
  AgentRegistry,
} from '../types/agent.js';
import type { Task } from '../types/task.js';
import { createOpenClawAdapter } from './openclaw.js';
import { createClaudeCodeAdapter } from './claude-code.js';
import { createOllamaAdapter } from './ollama.js';

/**
 * Default Agent Registry Implementation
 *
 * Manages multiple agent adapters and routes tasks to the appropriate agent.
 */
export class DefaultAgentRegistry implements AgentRegistry {
  private factories = new Map<string, AgentAdapterFactory>();
  private adapters = new Map<string, AgentAdapter>();
  private configs = new Map<string, AgentConfig>();
  private cachedAdapterTypes: string[] | null = null;

  constructor() {
    // Register built-in adapters
    this.registerAdapter('openclaw', createOpenClawAdapter);
    this.registerAdapter('claude-code', createClaudeCodeAdapter);
    this.registerAdapter('ollama', createOllamaAdapter);
  }

  /**
   * Register a new adapter factory
   */
  registerAdapter(type: string, factory: AgentAdapterFactory): void {
    this.factories.set(type, factory);
    this.cachedAdapterTypes = null;
  }

  /**
   * Create and register an adapter instance from config
   */
  createAdapter(config: AgentConfig): AgentAdapter {
    const factory = this.factories.get(config.type);
    if (!factory) {
      throw new Error(`Unknown adapter type: ${config.type}`);
    }

    const adapter = factory(config);
    this.adapters.set(config.id, adapter);
    this.configs.set(config.id, config);

    return adapter;
  }

  /**
   * Get all registered adapter types
   */
  getAdapterTypes(): string[] {
    if (this.cachedAdapterTypes) {
      return this.cachedAdapterTypes;
    }
    this.cachedAdapterTypes = Array.from(this.factories.keys());
    return this.cachedAdapterTypes;
  }

  /**
   * Get adapter by instance ID
   */
  getAdapter(id: string): AgentAdapter | undefined {
    return this.adapters.get(id);
  }

  /**
   * Get all active (enabled) adapters
   */
  getActiveAdapters(): AgentAdapter[] {
    const active: AgentAdapter[] = [];
    for (const [id, config] of this.configs) {
      if (config.enabled) {
        const adapter = this.adapters.get(id);
        if (adapter) {
          active.push(adapter);
        }
      }
    }
    return active;
  }

  /**
   * Find the best adapter for a task based on:
   * 1. Explicit assignment (task.assignedAgent)
   * 2. Label matching
   * 3. Capability matching
   * 4. Priority weighting
   */
  findAdapterForTask(task: Task): AgentAdapter | undefined {
    // If explicitly assigned, use that adapter
    if (task.assignedAgent) {
      // Check by ID first
      const adapter = this.adapters.get(task.assignedAgent);
      if (adapter) return adapter;

      // Check by type
      for (const [id, config] of this.configs) {
        if (config.type === task.assignedAgent && config.enabled) {
          return this.adapters.get(id);
        }
      }
    }

    // Score each adapter
    const scores: Array<{ adapter: AgentAdapter; score: number }> = [];
    const taskType = this.inferTaskType(task);

    for (const [id, config] of this.configs) {
      if (!config.enabled) continue;

      const adapter = this.adapters.get(id);
      if (!adapter) continue;

      let score = config.priority || 1;

      // Label matching
      if (config.labels && task.labels.length > 0) {
        const matchingLabels = task.labels.filter((l) =>
          config.labels!.includes(l)
        );
        score += matchingLabels.length * 10;
      }

      // Task type matching
      if (config.taskTypes && config.taskTypes.length > 0) {
        if (config.taskTypes.includes(taskType)) {
          score += 20;
        }
      }

      scores.push({ adapter, score });
    }

    // Sort by score descending and return best match
    scores.sort((a, b) => b.score - a.score);
    return scores[0]?.adapter;
  }

  /**
   * Infer task type from labels and content
   */
  private inferTaskType(task: Task): string {
    const labels = task.labels.map((l) => l.toLowerCase());
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
   * Get adapter config by ID
   */
  getConfig(id: string): AgentConfig | undefined {
    return this.configs.get(id);
  }

  /**
   * Update adapter config
   */
  updateConfig(id: string, updates: Partial<AgentConfig>): void {
    const config = this.configs.get(id);
    if (config) {
      this.configs.set(id, { ...config, ...updates });
    }
  }
}

// Singleton instance
let registry: AgentRegistry | null = null;

export function getAgentRegistry(): AgentRegistry {
  if (!registry) {
    registry = new DefaultAgentRegistry();
  }
  return registry;
}
