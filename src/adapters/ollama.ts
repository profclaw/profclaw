import type {
  AgentAdapter,
  AgentCapability,
  AgentConfig,
  AgentHealth,
} from "../types/agent.js";
import type { Task, TaskResult } from "../types/task.js";
import { logger } from "../utils/logger.js";

/**
 * Ollama Agent Adapter
 *
 * Communicates with a local Ollama instance for AI task execution.
 * Perfect for development and testing without burning API tokens.
 *
 * @see https://ollama.ai/
 */
export class OllamaAdapter implements AgentAdapter {
  readonly type = "ollama";
  readonly name = "Ollama";
  readonly description = "Local LLM inference via Ollama - free, private, fast";
  readonly capabilities: AgentCapability[] = [
    "code_generation",
    "code_review",
    "bug_fix",
    "documentation",
    "refactoring",
    "research",
  ];

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeout: number;

  constructor(config: AgentConfig) {
    const { baseUrl, model, timeout } = config.config as {
      baseUrl?: string;
      model?: string;
      timeout?: number;
    };

    this.baseUrl =
      baseUrl || process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    this.model = model || process.env.OLLAMA_MODEL || "llama3.2";
    this.timeout = timeout || 300000; // 5 minutes default
  }

  /**
   * Check if Ollama is available and model is loaded
   */
  async healthCheck(): Promise<AgentHealth> {
    const startTime = Date.now();
    try {
      // Check if Ollama server is running
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        return {
          healthy: false,
          latencyMs,
          message: `Ollama API returned ${response.status}`,
          lastChecked: new Date(),
        };
      }

      // Check if the model is available
      const data = (await response.json()) as {
        models?: Array<{ name: string }>;
      };
      const models = data.models || [];
      const modelNames = models.map((m) => m.name);

      // Check for exact match or partial match (e.g., 'llama3.2' matches 'llama3.2:latest')
      const modelAvailable = modelNames.some(
        (name) => name === this.model || name.startsWith(`${this.model}:`),
      );

      if (!modelAvailable) {
        return {
          healthy: false,
          latencyMs,
          message: `Model '${this.model}' not found. Available: ${modelNames.join(", ")}`,
          lastChecked: new Date(),
          details: { availableModels: modelNames },
        };
      }

      return {
        healthy: true,
        latencyMs,
        message: `Ollama running with model ${this.model}`,
        lastChecked: new Date(),
        details: { model: this.model, availableModels: modelNames },
      };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - startTime,
        message: error instanceof Error ? error.message : "Connection failed",
        lastChecked: new Date(),
      };
    }
  }

  /**
   * Execute a task using Ollama
   */
  async executeTask(task: Task): Promise<TaskResult> {
    const startTime = Date.now();

    try {
      // Build the full prompt
      const systemPrompt = this.getSystemPrompt(task);
      const userPrompt = this.buildPrompt(task);

      logger.info(
        `[Ollama] Executing task ${task.id} with model ${this.model}`,
      );

      // Use the chat endpoint for better conversation handling
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          stream: false,
          options: {
            temperature: 0.7,
            num_predict: 4096, // Max tokens to generate
          },
        }),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[Ollama] API error: ${response.status} - ${errorText}`);
        return {
          success: false,
          output: "",
          duration: Date.now() - startTime,
          error: {
            code: `HTTP_${response.status}`,
            message: `Ollama API error: ${response.status} - ${errorText}`,
          },
        };
      }

      const result = (await response.json()) as OllamaResponse;

      // Extract the message content
      const output = result.message?.content || "";

      // Calculate tokens from response
      const tokensUsed = result.eval_count
        ? {
            input: result.prompt_eval_count || 0,
            output: result.eval_count || 0,
            total: (result.prompt_eval_count || 0) + (result.eval_count || 0),
          }
        : undefined;

      logger.info(
        `[Ollama] Task ${task.id} completed in ${Date.now() - startTime}ms, tokens: ${tokensUsed?.total || "unknown"}`,
      );

      return {
        success: true,
        output,
        duration: Date.now() - startTime,
        tokensUsed,
        // Ollama is free, but we could calculate equivalent cost for comparison
        cost: tokensUsed
          ? {
              amount: 0, // Free!
              currency: "USD",
            }
          : undefined,
      };
    } catch (error) {
      logger.error(`[Ollama] Task execution failed:`, error as Error);
      return {
        success: false,
        output: "",
        duration: Date.now() - startTime,
        error: {
          code: "EXECUTION_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
          stack: error instanceof Error ? error.stack : undefined,
        },
      };
    }
  }

  /**
   * Build the user prompt for the task
   */
  private buildPrompt(task: Task): string {
    let prompt = `## Task: ${task.title}\n\n`;

    if (task.description) {
      prompt += `### Description\n${task.description}\n\n`;
    }

    prompt += `### Instructions\n${task.prompt}\n\n`;

    if (task.repository) {
      prompt += `### Context\n- Repository: ${task.repository}\n`;
    }
    if (task.branch) {
      prompt += `- Branch: ${task.branch}\n`;
    }
    if (task.labels && task.labels.length > 0) {
      prompt += `- Labels: ${task.labels.join(", ")}\n`;
    }

    prompt += `\n### Output Requirements\n`;
    prompt += `Please provide:\n`;
    prompt += `1. A clear explanation of your approach\n`;
    prompt += `2. The code or changes needed\n`;
    prompt += `3. Any additional notes or considerations\n`;

    return prompt;
  }

  /**
   * Get the system prompt for task execution
   */
  private getSystemPrompt(task: Task): string {
    const taskType = this.inferTaskType(task);

    let systemPrompt = `You are an experienced software developer assistant. `;

    switch (taskType) {
      case "bug_fix":
        systemPrompt += `You are fixing a bug. Focus on:
- Identifying the root cause
- Making minimal, targeted changes
- Explaining why the fix works
- Suggesting tests to prevent regression`;
        break;

      case "feature":
        systemPrompt += `You are implementing a new feature. Focus on:
- Understanding the requirements
- Following existing code patterns
- Writing clean, maintainable code
- Including appropriate error handling`;
        break;

      case "code_review":
        systemPrompt += `You are reviewing code. Focus on:
- Code quality and readability
- Potential bugs or edge cases
- Performance considerations
- Security implications`;
        break;

      case "documentation":
        systemPrompt += `You are writing documentation. Focus on:
- Clear, concise explanations
- Practical examples
- Proper formatting
- Keeping docs up-to-date with code`;
        break;

      case "refactoring":
        systemPrompt += `You are refactoring code. Focus on:
- Improving code structure without changing behavior
- Reducing complexity
- Improving readability
- Maintaining backwards compatibility`;
        break;

      default:
        systemPrompt += `Complete the task efficiently and thoroughly.
Provide clear explanations and well-structured output.`;
    }

    return systemPrompt;
  }

  /**
   * Infer task type from labels and content
   */
  private inferTaskType(task: Task): string {
    const labels = (task.labels || []).map((l) => l.toLowerCase());
    const labelSet = new Set(labels);
    const content =
      `${task.title} ${task.description || ""} ${task.prompt}`.toLowerCase();

    if (labelSet.has("bug") || labelSet.has("bugfix")) return "bug_fix";
    if (labelSet.has("feature") || labelSet.has("enhancement"))
      return "feature";
    if (labelSet.has("test") || labelSet.has("testing")) return "testing";
    if (labelSet.has("docs") || labelSet.has("documentation"))
      return "documentation";
    if (labelSet.has("refactor") || labelSet.has("refactoring"))
      return "refactoring";
    if (labelSet.has("review")) return "code_review";

    if (content.includes("fix") || content.includes("bug")) return "bug_fix";
    if (content.includes("implement") || content.includes("add"))
      return "feature";
    if (content.includes("test")) return "testing";
    if (content.includes("document")) return "documentation";
    if (content.includes("refactor")) return "refactoring";
    if (content.includes("review")) return "code_review";

    return "general";
  }
}

/**
 * Ollama API response type
 */
interface OllamaResponse {
  model: string;
  created_at: string;
  message?: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

/**
 * Factory function for creating Ollama adapters
 */
export function createOllamaAdapter(config: AgentConfig): AgentAdapter {
  return new OllamaAdapter(config);
}
