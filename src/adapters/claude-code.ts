import type {
  AgentAdapter,
  AgentCapability,
  AgentConfig,
  AgentHealth,
} from "../types/agent.js";
import type { Task, TaskResult, TaskArtifact } from "../types/task.js";
import { spawn } from "child_process";

/**
 * Claude Code Agent Adapter
 *
 * Executes tasks using the Claude Code CLI (claude command).
 * This adapter spawns claude processes to execute tasks.
 *
 * @see https://claude.ai/claude-code
 */
export class ClaudeCodeAdapter implements AgentAdapter {
  readonly type = "claude-code";
  readonly name = "Claude Code";
  readonly description = "Anthropic Claude Code CLI - agentic coding assistant";
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
  ];

  private readonly claudePath: string;
  private readonly workingDir: string;
  private readonly timeout: number;
  private readonly model: string;

  constructor(config: AgentConfig) {
    const { claudePath, workingDir, timeout, model } = config.config as {
      claudePath?: string;
      workingDir?: string;
      timeout?: number;
      model?: string;
    };

    this.claudePath = claudePath || "claude";
    this.workingDir = workingDir || process.cwd();
    this.timeout = timeout || 600000; // 10 minutes default
    this.model = model || "sonnet"; // or 'opus'
  }

  /**
   * Check if Claude Code CLI is available
   */
  async healthCheck(): Promise<AgentHealth> {
    const startTime = Date.now();
    try {
      const result = await this.runCommand(["--version"]);
      const latencyMs = Date.now() - startTime;

      return {
        healthy: result.success,
        latencyMs,
        message: result.success
          ? `Claude Code ${result.output.trim()}`
          : result.error,
        lastChecked: new Date(),
      };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - startTime,
        message:
          error instanceof Error ? error.message : "Claude Code CLI not found",
        lastChecked: new Date(),
      };
    }
  }

  /**
   * Execute a task via Claude Code CLI
   */
  async executeTask(task: Task): Promise<TaskResult> {
    const startTime = Date.now();

    try {
      // Determine working directory
      const cwd = task.repository
        ? `${this.workingDir}/${task.repository.split("/").pop()}`
        : this.workingDir;

      // Build the prompt
      const prompt = this.buildPrompt(task);

      // Execute via claude CLI with --print flag for non-interactive mode
      const result = await this.runCommand(
        [
          "--print", // Non-interactive, output result
          "--model",
          this.model,
          "--dangerously-skip-permissions", // Auto-approve (use with caution!)
          prompt,
        ],
        cwd,
      );

      if (!result.success) {
        return {
          success: false,
          output: result.output,
          duration: Date.now() - startTime,
          error: {
            code: "CLAUDE_ERROR",
            message: result.error || "Claude Code execution failed",
          },
        };
      }

      // Extract artifacts from output
      const artifacts = this.extractArtifacts(result.output);

      return {
        success: true,
        output: result.output,
        artifacts,
        duration: Date.now() - startTime,
        metadata: {
          model: this.model,
        },
      };
    } catch (error) {
      return {
        success: false,
        output: "",
        duration: Date.now() - startTime,
        error: {
          code: "EXECUTION_ERROR",
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
      };
    }
  }

  /**
   * Build prompt for Claude Code
   */
  private buildPrompt(task: Task): string {
    const parts: string[] = [];

    parts.push(`Task: ${task.title}`);

    if (task.description) {
      parts.push(`\nContext: ${task.description}`);
    }

    if (task.sourceUrl) {
      parts.push(`\nSource: ${task.sourceUrl}`);
    }

    parts.push(`\nInstructions: ${task.prompt}`);

    parts.push(`\nWhen done, provide a summary of changes made.`);

    return parts.join("\n");
  }

  /**
   * Run a claude command
   */
  private runCommand(
    args: string[],
    cwd?: string,
  ): Promise<{ success: boolean; output: string; error?: string }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.claudePath, args, {
        cwd: cwd || this.workingDir,
        timeout: this.timeout,
        env: {
          ...process.env,
          // Ensure non-interactive mode
          CI: "true",
        },
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      proc.stdout?.on("data", (data) => {
        stdoutChunks.push(Buffer.from(data));
      });

      proc.stderr?.on("data", (data) => {
        stderrChunks.push(Buffer.from(data));
      });

      proc.on("close", (code) => {
        clearTimeout(timeoutId);
        const stdout = Buffer.concat(stdoutChunks).toString();
        const stderr = Buffer.concat(stderrChunks).toString();
        resolve({
          success: code === 0,
          output: stdout,
          error: stderr || undefined,
        });
      });

      proc.on("error", (error) => {
        clearTimeout(timeoutId);
        const stdout = Buffer.concat(stdoutChunks).toString();
        reject(error ?? new Error("Unknown error"));
      });

      const timeoutId = setTimeout(() => {
        const stdout = Buffer.concat(stdoutChunks).toString();
        const stderr = Buffer.concat(stderrChunks).toString();
        resolve({
          success: false,
          output: stdout,
          error: stderr || `Command timed out after ${this.timeout}ms`,
        });
      }, this.timeout + 100);
    });
  }

  /**
   * Extract artifacts from Claude Code output
   */
  private extractArtifacts(output: string): TaskArtifact[] {
    const artifacts: TaskArtifact[] = [];

    // Parse for commits
    const commitPattern = /(?:commit|committed(?: as)?|sha)[:\s]+([a-f0-9]{6,40})/gi;
    let match;
    while ((match = commitPattern.exec(output)) !== null) {
      artifacts.push({ type: "commit", sha: match[1] });
    }

    // Parse for PR URLs
    const prPattern = /https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/g;
    while ((match = prPattern.exec(output)) !== null) {
      artifacts.push({
        type: "pull_request",
        url: match[0],
      });
    }

    // Parse for created/modified files (from tool use output)
    const filePattern =
      /(?:Created|Modified|Wrote|Edited):\s*([a-zA-Z0-9_\-./]+)/gi;
    while ((match = filePattern.exec(output)) !== null) {
      artifacts.push({ type: "file", path: match[1] });
    }

    return artifacts;
  }
}

/**
 * Factory function for creating Claude Code adapters
 */
export function createClaudeCodeAdapter(config: AgentConfig): AgentAdapter {
  return new ClaudeCodeAdapter(config);
}
