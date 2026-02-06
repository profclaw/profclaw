import type {
  AgentAdapter,
  AgentCapability,
  AgentConfig,
  AgentHealth,
} from "../types/agent.js";
import type { Task, TaskResult, TaskArtifact } from "../types/task.js";

// Regex patterns for artifact extraction
// Defined at module scope to avoid recompilation
const COMMIT_PATTERN = /(?:commit|committed(?: as)?|sha)[:\s]+([a-f0-9]{6,40})/gi;
const PR_PATTERN = /https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/g;
const FILE_PATTERN =
  /(?:created|modified|edited|wrote|updated|deleted)[:\s]+(?:file\s+)?[`"]?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`"]?/gi;

/**
 * OpenClaw Agent Adapter
 *
 * Communicates with OpenClaw gateway via REST API to execute tasks.
 * OpenClaw is an autonomous AI agent that can code, browse, manage files, etc.
 *
 * @see https://docs.openclaw.ai/
 */
export class OpenClawAdapter implements AgentAdapter {
  readonly type = "openclaw";
  readonly name = "OpenClaw";
  readonly description =
    "Open-source autonomous AI agent with 124k+ GitHub stars";
  readonly capabilities: AgentCapability[] = [
    "code_generation",
    "code_review",
    "bug_fix",
    "testing",
    "documentation",
    "refactoring",
    "research",
    "git_operations",
    "file_operations",
    "web_browsing",
    "api_calls",
  ];

  private readonly baseUrl: string;
  private readonly token: string;
  private readonly workingDir: string;
  private readonly timeout: number;

  constructor(config: AgentConfig) {
    const { baseUrl, token, workingDir, timeout } = config.config as {
      baseUrl?: string;
      token?: string;
      workingDir?: string;
      timeout?: number;
    };

    this.baseUrl =
      baseUrl || process.env.OPENCLAW_BASE_URL || "http://localhost:18789";
    this.token = token || process.env.OPENCLAW_GATEWAY_TOKEN || "";
    this.workingDir =
      workingDir || process.env.OPENCLAW_WORKING_DIR || "~/openclaw-workdir";
    this.timeout = timeout || 300000; // 5 minutes default

    if (!this.token) {
      throw new Error("OpenClaw gateway token is required");
    }
  }

  /**
   * Check if OpenClaw gateway is healthy
   */
  async healthCheck(): Promise<AgentHealth> {
    const startTime = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/api/health`, {
        method: "GET",
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });

      const latencyMs = Date.now() - startTime;

      if (response.ok) {
        return {
          healthy: true,
          latencyMs,
          message: "OpenClaw gateway is healthy",
          lastChecked: new Date(),
        };
      }

      return {
        healthy: false,
        latencyMs,
        message: `Gateway returned ${response.status}: ${response.statusText}`,
        lastChecked: new Date(),
      };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - startTime,
        message: error instanceof Error ? error.message : "Unknown error",
        lastChecked: new Date(),
      };
    }
  }

  /**
   * Execute a task via OpenClaw
   */
  async executeTask(task: Task): Promise<TaskResult> {
    const startTime = Date.now();

    try {
      // Build the prompt with context
      const fullPrompt = this.buildPrompt(task);

      // Send to OpenClaw gateway
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          message: fullPrompt,
          options: {
            workingDir: task.repository
              ? `${this.workingDir}/${task.repository.split("/").pop()}`
              : this.workingDir,
            // Request structured output for better parsing
            systemPrompt: this.getSystemPrompt(task),
          },
        }),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          output: "",
          duration: Date.now() - startTime,
          error: {
            code: `HTTP_${response.status}`,
            message: `OpenClaw API error: ${response.status} - ${errorText}`,
          },
        };
      }

      const result = (await response.json()) as OpenClawResponse;

      // Parse the response and extract artifacts
      const artifacts = extractArtifacts(result);

      return {
        success: true,
        output: result.message || result.response || "",
        artifacts,
        tokensUsed: result.usage
          ? {
              input: result.usage.prompt_tokens || 0,
              output: result.usage.completion_tokens || 0,
              total: result.usage.total_tokens || 0,
            }
          : undefined,
        duration: Date.now() - startTime,
      };
    } catch (error) {
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
   * Build the full autonomous prompt for OpenClaw
   */
  private buildPrompt(task: Task): string {
    const repoName = task.repository?.split("/").pop() || "project";
    const issueNumber = task.sourceId || "N/A";

    return `You are an autonomous AI developer. Complete this task independently.

## Task: ${task.title}
${task.description ? `\n### Description\n${task.description}` : ""}

### Source
${task.sourceUrl ? `- Issue: ${task.sourceUrl}` : ""}
${task.repository ? `- Repository: ${task.repository}` : ""}
${task.labels && task.labels.length > 0 ? `- Labels: ${task.labels.join(", ")}` : ""}

### Instructions
${task.prompt}

## Workflow (FOLLOW EXACTLY)

1. **Setup**
   \`\`\`bash
   cd ~/openclaw-workdir/${repoName}
   git fetch origin
   git checkout main && git pull origin main
   git checkout -b fix/issue-${issueNumber}
   \`\`\`

2. **Implement** - Make the necessary changes

3. **Verify**
   \`\`\`bash
   pnpm install && pnpm build
   \`\`\`
   Fix any errors before proceeding.

4. **Commit**
   \`\`\`bash
   git add -A
   git commit -m "feat: <short description>

   ${task.sourceId ? `Closes #${task.sourceId}` : ""}

   Co-Authored-By: Glinr <bot@glincker.com>"
   \`\`\`

5. **Push & PR**
   \`\`\`bash
   git push -u origin HEAD
   gh pr create --title "${task.title}" --body "Closes #${issueNumber}"
   \`\`\`

## Rules
- Fix ALL build errors before committing
- If blocked, explain clearly what's wrong
- Never leave uncommitted changes
- Keep commits atomic and focused

## Output Required
When done, report:
1. Summary of changes
2. Files modified
3. PR URL (required)
4. Any concerns`;
  }

  /**
   * System prompt for structured task execution
   */
  private getSystemPrompt(task: Task): string {
    return `You are executing a task from an automated task queue.

Task ID: ${task.id}
Source: ${task.source}
Priority: ${task.priority}

Guidelines:
- Focus on completing the specific task requested
- Make atomic, well-documented changes
- Commit with clear messages referencing the task
- Report any blockers or questions clearly
- Do not make changes outside the scope of this task`;
  }

  /**
   * Get request headers
   */
  private getHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
    };
  }
}

// OpenClaw API response type
export interface OpenClawResponse {
  message?: string;
  response?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  artifacts?: TaskArtifact[];
}

/**
 * Extract artifacts (commits, PRs, files) from OpenClaw response
 */
export function extractArtifacts(result: OpenClawResponse): TaskArtifact[] {
  const artifacts: TaskArtifact[] = [];

  // Parse the response text for commits
  COMMIT_PATTERN.lastIndex = 0;
  let match;
  while ((match = COMMIT_PATTERN.exec(result.message || "")) !== null) {
    artifacts.push({
      type: "commit",
      sha: match[1],
    });
  }

  // Parse for PR URLs
  PR_PATTERN.lastIndex = 0;
  while ((match = PR_PATTERN.exec(result.message || "")) !== null) {
    artifacts.push({
      type: "pull_request",
      url: match[0],
      metadata: {
        owner: match[1],
        repo: match[2],
        number: parseInt(match[3]),
      },
    });
  }

  // Parse for file paths (simple heuristic)
  FILE_PATTERN.lastIndex = 0;
  while ((match = FILE_PATTERN.exec(result.message || "")) !== null) {
    artifacts.push({
      type: "file",
      path: match[1],
    });
  }

  // Add any artifacts from structured response
  if (result.artifacts) {
    artifacts.push(...result.artifacts);
  }

  return artifacts;
}

/**
 * Factory function for creating OpenClaw adapters
 */
export function createOpenClawAdapter(config: AgentConfig): AgentAdapter {
  return new OpenClawAdapter(config);
}
