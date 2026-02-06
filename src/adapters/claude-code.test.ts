import { describe, it, expect, beforeEach, vi } from "vitest";
import { ClaudeCodeAdapter, createClaudeCodeAdapter } from "./claude-code.js";
import type { AgentConfig } from "../types/agent.js";
import type { Task } from "../types/task.js";
import { TaskStatus, TaskSource } from "../types/task.js";
import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import { EventEmitter } from "events";

// Mock child_process
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

describe("ClaudeCodeAdapter", () => {
  const mockConfig: AgentConfig = {
    id: "test-claude-1",
    type: "claude-code",
    enabled: true,
    maxConcurrent: 3,
    priority: 90,
    config: {
      claudePath: "/usr/local/bin/claude",
      workingDir: "/tmp/claude-work",
      timeout: 15000,
      model: "opus",
    },
  };

  const mockTask: Task = {
    id: "task-456",
    title: "Add user authentication",
    description: "Implement JWT-based authentication",
    prompt: "Add JWT authentication middleware to the Express app",
    priority: 1,
    source: TaskSource.JIRA,
    sourceId: "PROJ-789",
    sourceUrl: "https://company.atlassian.net/browse/PROJ-789",
    repository: "company/api",
    branch: "develop",
    labels: ["feature", "security"],
    status: TaskStatus.QUEUED,
    createdAt: new Date(),
    updatedAt: new Date(),
    attempts: 0,
    maxAttempts: 3,
    metadata: {},
  };

  // Helper to create a mock child process
  function createMockProcess(): ChildProcess {
    const mockProcess = new EventEmitter() as ChildProcess;
    mockProcess.stdout = new EventEmitter() as any;
    mockProcess.stderr = new EventEmitter() as any;
    mockProcess.stdin = {
      write: vi.fn(),
      end: vi.fn(),
    } as any;
    return mockProcess;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with provided config", () => {
      const adapter = new ClaudeCodeAdapter(mockConfig);
      expect(adapter.type).toBe("claude-code");
      expect(adapter.name).toBe("Claude Code");
      expect(adapter.capabilities).toContain("code_generation");
      expect(adapter.capabilities).toContain("research");
      expect(adapter.capabilities).toContain("git_operations");
    });

    it("should use default values when config is minimal", () => {
      const minimalConfig: AgentConfig = {
        id: "test-claude-2",
        type: "claude-code",
        enabled: true,
        maxConcurrent: 3,
        priority: 90,
        config: {},
      };

      const adapter = new ClaudeCodeAdapter(minimalConfig);
      expect(adapter).toBeDefined();
      expect(adapter.type).toBe("claude-code");
    });

    it("should use custom model from config", () => {
      const adapter = new ClaudeCodeAdapter(mockConfig);
      // Model is private, but we can verify it works in execution
      expect(adapter).toBeDefined();
    });
  });

  describe("healthCheck", () => {
    it("should return healthy status when claude CLI is available", async () => {
      const adapter = new ClaudeCodeAdapter(mockConfig);
      const mockProcess = createMockProcess();

      (spawn as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockProcess);

      // Simulate process completion
      setTimeout(() => {
        mockProcess.stdout?.emit(
          "data",
          Buffer.from("claude version 1.0.0\\n"),
        );
        mockProcess.emit("close", 0);
      }, 10);

      const health = await adapter.healthCheck();

      expect(health.healthy).toBe(true);
      expect(health.message).toContain("Claude Code");
      expect(health.message).toContain("1.0.0");
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
      expect(health.lastChecked).toBeInstanceOf(Date);
    });

    it("should return unhealthy status on command failure", async () => {
      const adapter = new ClaudeCodeAdapter(mockConfig);
      const mockProcess = createMockProcess();

      (spawn as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockProcess);

      // Simulate process failure
      setTimeout(() => {
        mockProcess.stderr?.emit("data", Buffer.from("command not found\\n"));
        mockProcess.emit("close", 1);
      }, 10);

      const health = await adapter.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.message).toContain("command not found");
    });

    it("should return unhealthy status on process error", async () => {
      const adapter = new ClaudeCodeAdapter(mockConfig);
      const mockProcess = createMockProcess();

      (spawn as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockProcess);

      // Simulate process error
      setTimeout(() => {
        mockProcess.emit(
          "error",
          new Error("ENOENT: no such file or directory"),
        );
      }, 10);

      const health = await adapter.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.message).toContain("ENOENT");
    });
  });

  describe("executeTask", () => {
    it("should successfully execute a task", async () => {
      const adapter = new ClaudeCodeAdapter(mockConfig);
      const mockProcess = createMockProcess();

      (spawn as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockProcess);

      // Simulate successful execution
      setTimeout(() => {
        const output = `Task completed.
commit abc123def456
Created: src/middleware/auth.ts
Modified: src/server.ts`;
        mockProcess.stdout?.emit("data", Buffer.from(output));
        mockProcess.emit("close", 0);
      }, 10);

      const result = await adapter.executeTask(mockTask);

      expect(result.success).toBe(true);
      expect(result.output).toContain("Task completed");
      expect(result.artifacts).toBeDefined();
      expect(result.artifacts!.length).toBeGreaterThan(0);
      expect(result.duration).toBeGreaterThanOrEqual(0);

      // Verify spawn was called with correct arguments
      expect(spawn).toHaveBeenCalledWith(
        "/usr/local/bin/claude",
        expect.arrayContaining([
          "--print",
          "--model",
          "opus",
          "--dangerously-skip-permissions",
        ]),
        expect.objectContaining({
          cwd: "/tmp/claude-work/api",
          env: expect.objectContaining({
            CI: "true",
          }),
        }),
      );
    });

    it("should handle task failure (non-zero exit code)", async () => {
      const adapter = new ClaudeCodeAdapter(mockConfig);
      const mockProcess = createMockProcess();

      (spawn as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockProcess);

      setTimeout(() => {
        mockProcess.stdout?.emit("data", Buffer.from("Partial output"));
        mockProcess.stderr?.emit("data", Buffer.from("Build failed"));
        mockProcess.emit("close", 1);
      }, 10);

      const result = await adapter.executeTask(mockTask);

      expect(result.success).toBe(false);
      expect(result.output).toContain("Partial output");
      expect(result.error?.code).toBe("CLAUDE_ERROR");
      expect(result.error?.message).toContain("Build failed");
    });

    it("should handle process errors", async () => {
      const adapter = new ClaudeCodeAdapter(mockConfig);
      const mockProcess = createMockProcess();

      (spawn as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockProcess);

      setTimeout(() => {
        mockProcess.emit("error", new Error("Spawn failed"));
      }, 10);

      const result = await adapter.executeTask(mockTask);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("EXECUTION_ERROR");
      expect(result.error?.message).toBe("Spawn failed");
      expect(result.error?.stack).toBeDefined();
    });

    it("should use custom working directory from repository", async () => {
      const adapter = new ClaudeCodeAdapter(mockConfig);
      const mockProcess = createMockProcess();

      (spawn as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockProcess);

      setTimeout(() => {
        mockProcess.emit("close", 0);
      }, 10);

      await adapter.executeTask(mockTask);

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          cwd: "/tmp/claude-work/api",
        }),
      );
    });

    it("should fall back to base directory if no repository", async () => {
      const adapter = new ClaudeCodeAdapter(mockConfig);
      const taskWithoutRepo = { ...mockTask, repository: undefined };
      const mockProcess = createMockProcess();

      (spawn as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockProcess);

      setTimeout(() => {
        mockProcess.emit("close", 0);
      }, 10);

      await adapter.executeTask(taskWithoutRepo);

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          cwd: "/tmp/claude-work",
        }),
      );
    });

    it("should handle multi-byte characters in output", async () => {
      const adapter = new ClaudeCodeAdapter(mockConfig);
      const mockProcess = createMockProcess();

      (spawn as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockProcess);

      setTimeout(() => {
        // Simulate multi-byte UTF-8 characters split across chunks
        mockProcess.stdout?.emit("data", Buffer.from("Task ✅ "));
        mockProcess.stdout?.emit("data", Buffer.from("完成"));
        mockProcess.emit("close", 0);
      }, 10);

      const result = await adapter.executeTask(mockTask);

      expect(result.success).toBe(true);
      expect(result.output).toContain("✅");
      expect(result.output).toContain("完成");
    });
  });

  describe("buildPrompt", () => {
    it("should include all task information", async () => {
      const adapter = new ClaudeCodeAdapter(mockConfig);

      // Capture the prompt argument
      let capturedPrompt = "";
      (spawn as ReturnType<typeof vi.fn>).mockImplementation((cmd, args) => {
        capturedPrompt = args[args.length - 1] as string;
        const proc = createMockProcess();
        setTimeout(() => proc.emit("close", 0), 10);
        return proc;
      });

      await adapter.executeTask(mockTask);

      expect(capturedPrompt).toContain("Add user authentication");
      expect(capturedPrompt).toContain("Implement JWT-based authentication");
      expect(capturedPrompt).toContain(
        "https://company.atlassian.net/browse/PROJ-789",
      );
      expect(capturedPrompt).toContain("Add JWT authentication middleware");
      expect(capturedPrompt).toContain("summary of changes");
    });

    it("should handle task without optional fields", async () => {
      const adapter = new ClaudeCodeAdapter(mockConfig);
      const minimalTask: Task = {
        ...mockTask,
        description: undefined,
        sourceUrl: undefined,
      };

      const mockProcess = createMockProcess();
      (spawn as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockProcess);

      setTimeout(() => {
        mockProcess.emit("close", 0);
      }, 10);

      const result = await adapter.executeTask(minimalTask);
      expect(result.success).toBe(true);
    });
  });

  describe("extractArtifacts", () => {
    it("should extract commit SHAs", async () => {
      const adapter = new ClaudeCodeAdapter(mockConfig);
      const mockProcess = createMockProcess();

      (spawn as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockProcess);

      setTimeout(() => {
        const output = "commit abc1234 and commit def5678";
        mockProcess.stdout?.emit("data", Buffer.from(output));
        mockProcess.emit("close", 0);
      }, 10);

      const result = await adapter.executeTask(mockTask);

      const commits = result.artifacts?.filter((a) => a.type === "commit");
      expect(commits).toHaveLength(2);
      expect(commits?.[0].sha).toBe("abc1234");
      expect(commits?.[1].sha).toBe("def5678");
    });

    it("should extract PR URLs", async () => {
      const adapter = new ClaudeCodeAdapter(mockConfig);
      const mockProcess = createMockProcess();

      (spawn as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockProcess);

      setTimeout(() => {
        const output = "Created PR: https://github.com/company/api/pull/42";
        mockProcess.stdout?.emit("data", Buffer.from(output));
        mockProcess.emit("close", 0);
      }, 10);

      const result = await adapter.executeTask(mockTask);

      const prs = result.artifacts?.filter((a) => a.type === "pull_request");
      expect(prs).toHaveLength(1);
      expect(prs?.[0].url).toBe("https://github.com/company/api/pull/42");
    });

    it("should extract file paths from tool output", async () => {
      const adapter = new ClaudeCodeAdapter(mockConfig);
      const mockProcess = createMockProcess();

      (spawn as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockProcess);

      setTimeout(() => {
        const output = `
Created: src/auth.ts
Modified: package.json
Wrote: README.md
Edited: tsconfig.json
        `;
        mockProcess.stdout?.emit("data", Buffer.from(output));
        mockProcess.emit("close", 0);
      }, 10);

      const result = await adapter.executeTask(mockTask);

      const files = result.artifacts?.filter((a) => a.type === "file");
      expect(files).toHaveLength(4);
      expect(files?.map((f) => f.path)).toContain("src/auth.ts");
      expect(files?.map((f) => f.path)).toContain("package.json");
      expect(files?.map((f) => f.path)).toContain("README.md");
      expect(files?.map((f) => f.path)).toContain("tsconfig.json");
    });

    it("should extract multiple artifact types", async () => {
      const adapter = new ClaudeCodeAdapter(mockConfig);
      const mockProcess = createMockProcess();

      (spawn as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockProcess);

      setTimeout(() => {
        const output = `
Task completed successfully!
commit abc123
Created: src/middleware/auth.ts
https://github.com/company/api/pull/99
Modified: src/server.ts
        `;
        mockProcess.stdout?.emit("data", Buffer.from(output));
        mockProcess.emit("close", 0);
      }, 10);

      const result = await adapter.executeTask(mockTask);

      expect(result.artifacts).toHaveLength(4);
      expect(result.artifacts?.some((a) => a.type === "commit")).toBe(true);
      expect(result.artifacts?.some((a) => a.type === "pull_request")).toBe(
        true,
      );
      expect(result.artifacts?.some((a) => a.type === "file")).toBe(true);
    });

    it("should handle output with no artifacts", async () => {
      const adapter = new ClaudeCodeAdapter(mockConfig);
      const mockProcess = createMockProcess();

      (spawn as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockProcess);

      setTimeout(() => {
        mockProcess.stdout?.emit(
          "data",
          Buffer.from("Task analysis complete."),
        );
        mockProcess.emit("close", 0);
      }, 10);

      const result = await adapter.executeTask(mockTask);

      expect(result.artifacts).toHaveLength(0);
    });
  });

  describe("runCommand timeout handling", () => {
    it("should respect timeout configuration", async () => {
      const adapter = new ClaudeCodeAdapter(mockConfig);
      const mockProcess = createMockProcess();

      (spawn as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockProcess);

      setTimeout(() => {
        mockProcess.emit("close", 0);
      }, 10);

      // Verify timeout is passed to spawn
      await adapter.executeTask(mockTask);

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          timeout: 15000,
        }),
      );
    });
  });

  describe("error edge cases", () => {
    it("should handle unknown error types", async () => {
      const adapter = new ClaudeCodeAdapter(mockConfig);
      const mockProcess = createMockProcess();

      (spawn as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockProcess);

      setTimeout(() => {
        mockProcess.emit("error", "string error instead of Error object");
      }, 10);

      const result = await adapter.executeTask(mockTask);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("EXECUTION_ERROR");
      expect(result.error?.message).toBe(
        "string error instead of Error object",
      );
    });
  });
});

describe("createClaudeCodeAdapter", () => {
  it("should create a ClaudeCodeAdapter instance", () => {
    const config: AgentConfig = {
      id: "test-claude-factory",
      type: "claude-code",
      enabled: true,
      maxConcurrent: 3,
      priority: 90,
      config: {},
    };

    const adapter = createClaudeCodeAdapter(config);

    expect(adapter).toBeInstanceOf(ClaudeCodeAdapter);
    expect(adapter.type).toBe("claude-code");
  });
});
