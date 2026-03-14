import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext, ToolSession } from '../types.js';

const { mockAgentsDeps } = vi.hoisted(() => ({
  mockAgentsDeps: {
    getAgentRegistry: vi.fn(),
  },
}));

vi.mock('../../../adapters/registry.js', () => ({
  getAgentRegistry: mockAgentsDeps.getAgentRegistry,
}));

import { agentsListTool } from './agents-list.js';

function createContext(): ToolExecutionContext {
  return {
    toolCallId: 'tool-call-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    workdir: '/tmp',
    env: {},
    securityPolicy: { mode: 'ask' },
    sessionManager: {
      create(session: Omit<ToolSession, 'id' | 'createdAt'>): ToolSession {
        return {
          ...session,
          id: 'session-1',
          createdAt: Date.now(),
        };
      },
      get() {
        return undefined;
      },
      update() {},
      list() {
        return [];
      },
      async kill() {},
      cleanup() {},
    },
  };
}

describe('agents list tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters to healthy agents when healthyOnly is enabled', async () => {
    const healthyAdapter = {
      type: 'claude-code',
      name: 'Claude Code',
      description: 'Terminal coding agent',
      capabilities: ['bug_fix', 'testing'],
      healthCheck: vi.fn().mockResolvedValue({
        healthy: true,
        message: 'ok',
        latencyMs: 120,
        lastChecked: new Date('2026-03-12T00:00:00Z'),
      }),
    };
    const failingAdapter = {
      type: 'ollama',
      name: 'Ollama',
      description: 'Local model',
      capabilities: ['code_generation'],
      healthCheck: vi.fn().mockRejectedValue(new Error('offline')),
    };

    mockAgentsDeps.getAgentRegistry.mockReturnValue({
      getAdapterTypes: () => ['claude-code', 'ollama'],
      getActiveAdapters: () => [healthyAdapter, failingAdapter],
    });

    const result = await agentsListTool.execute(createContext(), {
      healthyOnly: true,
      includeDetails: true,
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      total: 1,
      activeCount: 2,
      adapterTypes: ['claude-code', 'ollama'],
      agents: [
        expect.objectContaining({
          type: 'claude-code',
          name: 'Claude Code',
          health: expect.objectContaining({
            healthy: true,
            latencyMs: 120,
          }),
        }),
      ],
    });
    expect(failingAdapter.healthCheck).toHaveBeenCalledOnce();
    expect(result.output).toContain('Claude Code');
    expect(result.output).not.toContain('Ollama');
  });

  it('filters by capability and omits health details when includeDetails is false', async () => {
    const adapter = {
      type: 'openclaw',
      name: 'OpenClaw',
      description: 'Autonomous agent',
      capabilities: ['code_generation', 'testing'],
      healthCheck: vi.fn(),
    };

    mockAgentsDeps.getAgentRegistry.mockReturnValue({
      getAdapterTypes: () => ['openclaw'],
      getActiveAdapters: () => [adapter],
    });

    const result = await agentsListTool.execute(createContext(), {
      capability: 'testing',
      includeDetails: false,
    });

    expect(result.success).toBe(true);
    expect(adapter.healthCheck).not.toHaveBeenCalled();
    expect(result.data?.agents).toEqual([
      expect.objectContaining({
        type: 'openclaw',
        capabilities: ['code_generation', 'testing'],
        health: undefined,
      }),
    ]);
  });
});
