import { describe, it, expect } from "vitest";
import { DefaultAgentRegistry } from "./registry.js";
import type {
  AgentAdapterFactory,
  AgentAdapter,
  AgentHealth,
} from "../types/agent.js";
import type { Task, TaskResult } from "../types/task.js";

describe("DefaultAgentRegistry", () => {
  const mockFactory: AgentAdapterFactory = (config): AgentAdapter => ({
    type: config.type,
    name: `Mock ${config.type}`,
    description: "Mock adapter for testing",
    capabilities: ["code_generation"],
    healthCheck: async (): Promise<AgentHealth> => ({
      healthy: true,
      latencyMs: 0,
      message: "Mock is healthy",
      lastChecked: new Date(),
    }),
    executeTask: async (task: Task): Promise<TaskResult> => ({
      success: true,
      output: "Mock task completed",
      duration: 100,
    }),
  });

  it("should return default adapter types", () => {
    const registry = new DefaultAgentRegistry();
    const types = registry.getAdapterTypes();
    expect(types).toContain("openclaw");
    expect(types).toContain("claude-code");
    expect(types).toContain("ollama");
  });

  it("should return new adapter types after registration", () => {
    const registry = new DefaultAgentRegistry();
    registry.registerAdapter("test-adapter", mockFactory);
    const types = registry.getAdapterTypes();
    expect(types).toContain("test-adapter");
    expect(types).toContain("openclaw");
    expect(types).toContain("claude-code");
  });

  it("should maintain the cached list correctly", () => {
    const registry = new DefaultAgentRegistry();
    let types = registry.getAdapterTypes();
    expect(types.length).toBe(3);

    registry.registerAdapter("test-adapter-1", mockFactory);
    types = registry.getAdapterTypes();
    expect(types).toContain("test-adapter-1");
    expect(types.length).toBe(4);

    registry.registerAdapter("test-adapter-2", mockFactory);
    types = registry.getAdapterTypes();
    expect(types).toContain("test-adapter-2");
    expect(types.length).toBe(5);
  });
});
