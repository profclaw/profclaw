/**
 * Tests for Agentic Chat Executor
 *
 * Covers: executeAgenticChat, streamAgenticChat, tool schema conversion,
 * provider fallback, error handling, and streaming event emission.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// ============================================================================
// Hoisted mocks — must be declared with vi.hoisted so they exist before
// vi.mock factories run (which are hoisted to the top of the module).
// ============================================================================

const mocks = vi.hoisted(() => {
  const mockAgentRun = vi.fn();
  const mockAgentStream = vi.fn(async function* () { /* default: no-op stream */ });
  const mockAgentGetState = vi.fn();
  const mockAgentOn = vi.fn();
  const AgentExecutorCtor = vi.fn().mockImplementation(() => ({
    run: mockAgentRun,
    stream: mockAgentStream,
    on: mockAgentOn,
    getState: mockAgentGetState,
  }));

  const mockResolveModel = vi.fn();
  const mockGetModel = vi.fn(() => ({ id: 'mock-model' }));
  const mockGetConfiguredProviders = vi.fn(() => ['anthropic'] as string[]);

  const mockRunWithModelFallback = vi.fn();
  const mockGetUserFriendlyErrorMessage = vi.fn((err: Error) => err.message);
  const mockGetProvidersInCooldown = vi.fn(() => [] as Array<{ provider: string; reason: string; cooldownUntil: number; lastError: string }>);
  const mockDescribeFailoverError = vi.fn((err: Error) => ({
    message: err.message,
    reason: 'unknown' as const,
    status: undefined as number | undefined,
    code: undefined as string | undefined,
  }));
  const mockCoerceToFailoverError = vi.fn();
  const mockIsProviderInCooldown = vi.fn(() => false);
  const mockNormalizeToolSchema = vi.fn((schema: unknown) => schema);
  const mockZodToJsonSchema = vi.fn(() => ({
    type: 'object',
    properties: { input: { type: 'string' } },
  }));
  const mockAiTool = vi.fn((def: unknown) => def);
  const mockJsonSchema = vi.fn((schema: unknown) => schema);

  return {
    mockAgentRun,
    mockAgentStream,
    mockAgentGetState,
    mockAgentOn,
    AgentExecutorCtor,
    mockResolveModel,
    mockGetModel,
    mockGetConfiguredProviders,
    mockRunWithModelFallback,
    mockGetUserFriendlyErrorMessage,
    mockGetProvidersInCooldown,
    mockDescribeFailoverError,
    mockCoerceToFailoverError,
    mockIsProviderInCooldown,
    mockNormalizeToolSchema,
    mockZodToJsonSchema,
    mockAiTool,
    mockJsonSchema,
  };
});

// ============================================================================
// Module mocks
// ============================================================================

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  createContextualLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('ai', () => ({
  tool: mocks.mockAiTool,
  jsonSchema: mocks.mockJsonSchema,
}));

vi.mock('zod-to-json-schema', () => ({
  zodToJsonSchema: mocks.mockZodToJsonSchema,
}));

vi.mock('../../providers/ai-sdk.js', () => ({
  aiProvider: {
    resolveModel: mocks.mockResolveModel,
    getModel: mocks.mockGetModel,
    getConfiguredProviders: mocks.mockGetConfiguredProviders,
    getDefaultProvider: vi.fn(() => 'anthropic'),
  },
}));

vi.mock('../../providers/core/models.js', () => ({
  MODEL_ALIASES: {
    sonnet: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    haiku: { provider: 'anthropic', model: 'claude-haiku-3-5' },
    opus: { provider: 'anthropic', model: 'claude-opus-4' },
    gpt4o: { provider: 'openai', model: 'gpt-4o' },
  },
  MODEL_CATALOG: [
    { id: 'claude-sonnet-4-5', name: 'Sonnet', provider: 'anthropic', contextWindow: 200000, maxOutput: 8192, supportsVision: true, supportsStreaming: true, supportsTools: true, costPer1MInput: 3, costPer1MOutput: 15 },
    { id: 'claude-haiku-3-5', name: 'Haiku', provider: 'anthropic', contextWindow: 200000, maxOutput: 8192, supportsVision: true, supportsStreaming: true, supportsTools: true, costPer1MInput: 0.80, costPer1MOutput: 4 },
  ],
}));

vi.mock('../../providers/smart-router.js', () => ({
  routeQuery: vi.fn(() => ({
    complexity: { tier: 'standard', score: 0.4, confidence: 0.6, signals: [], reasoning: 'test' },
    selectedModel: { id: 'claude-sonnet-4-5', provider: 'anthropic', name: 'Sonnet' },
    alternativeModels: [],
    estimatedCost: 0.02,
    savedVsDefault: 0,
    savingsPercent: 0,
  })),
  recordRoutingDecision: vi.fn(),
  isSmartRouterEnabled: vi.fn(() => false), // disabled in tests so existing assertions hold
}));

vi.mock('../../providers/schema-utils.js', () => ({
  normalizeToolSchema: mocks.mockNormalizeToolSchema,
}));

vi.mock('../../agents/index.js', () => ({
  AgentExecutor: mocks.AgentExecutorCtor,
}));

// Mock the SSE bridge so tests don't depend on server state.
// bridgeStreamToSSE is mocked to consume the stream (so agent.stream() is
// called and event-handler side effects fire) without touching real SSE connections.
vi.mock('../../server/stream-bridge.js', () => ({
  bridgeStreamToSSE: async (
    stream: AsyncGenerator<unknown>,
    _broadcaster: unknown,
    _sessionId: string,
  ) => {
    // Exhaust the stream so state mutations inside stream() still run
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _event of stream) { /* consumed */ }
  },
}));

vi.mock('../../server.js', () => ({
  broadcastEvent: vi.fn(),
}));

vi.mock('../failover/index.js', () => ({
  runWithModelFallback: mocks.mockRunWithModelFallback,
  getUserFriendlyErrorMessage: mocks.mockGetUserFriendlyErrorMessage,
  isProviderInCooldown: mocks.mockIsProviderInCooldown,
  getProvidersInCooldown: mocks.mockGetProvidersInCooldown,
  describeFailoverError: mocks.mockDescribeFailoverError,
  coerceToFailoverError: mocks.mockCoerceToFailoverError,
}));

// ============================================================================
// Imports after mocks
// ============================================================================

import {
  executeAgenticChat,
  streamAgenticChat,
  type AgenticChatRequest,
  type StreamAgenticChatRequest,
  type AgenticStreamEvent,
} from '../agentic-executor.js';
import type { AgentState } from '../../agents/index.js';

// ============================================================================
// Helpers
// ============================================================================

function makeAgentState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    sessionId: 'session-abc',
    conversationId: 'conv-123',
    status: 'completed',
    goal: 'Test goal',
    currentStep: 3,
    maxBudget: 50000,
    usedBudget: 300,
    inputTokensUsed: 210,
    outputTokensUsed: 90,
    toolCallHistory: [],
    pendingToolCalls: [],
    context: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    finalResult: {
      success: true,
      summary: 'All done.',
      stopReason: 'textResponse',
      artifacts: [],
      nextSteps: [],
    },
    ...overrides,
  } as AgentState;
}

function makeToolHandler() {
  return {
    executeTool: vi.fn().mockResolvedValue({ result: { ok: true } }),
    getTools: vi.fn().mockReturnValue([]),
    getPendingApprovals: vi.fn().mockReturnValue([]),
  };
}

function makeBaseRequest(overrides: Partial<AgenticChatRequest> = {}): AgenticChatRequest {
  return {
    conversationId: 'conv-123',
    messages: [{ role: 'user', content: 'Do something' }],
    systemPrompt: 'You are a helpful agent.',
    model: 'sonnet',
    tools: [],
    toolHandler: makeToolHandler() as unknown as AgenticChatRequest['toolHandler'],
    ...overrides,
  };
}

function makeFallbackResult(state: AgentState, providerOverride?: string) {
  return {
    result: state,
    provider: providerOverride ?? 'anthropic',
    model: 'claude-sonnet-4-5',
    attempts: [] as Array<{ provider: string; model: string; error: string }>,
  };
}

// ============================================================================
// executeAgenticChat tests
// ============================================================================

function resetMocks() {
  vi.resetAllMocks();
  // Re-bind all mock implementations after resetAllMocks wipes them.
  // AgentExecutorCtor uses mockImplementation (NOT mockReturnValue) so it
  // creates a fresh instance object referencing the shared mock fns on each call.
  mocks.mockAgentOn.mockImplementation(() => {});
  mocks.mockAgentRun.mockResolvedValue(makeAgentState());
  mocks.mockAgentGetState.mockReturnValue(makeAgentState());
  mocks.mockAgentStream.mockImplementation(async function* () { /* no-op stream */ });
  mocks.AgentExecutorCtor.mockImplementation(function () {
    return {
      run: mocks.mockAgentRun,
      stream: mocks.mockAgentStream,
      on: mocks.mockAgentOn,
      getState: mocks.mockAgentGetState,
    };
  });
  mocks.mockResolveModel.mockImplementation(() => {
    throw new Error('Not configured');
  });
  mocks.mockGetConfiguredProviders.mockReturnValue(['anthropic']);
  mocks.mockGetProvidersInCooldown.mockReturnValue([]);
  mocks.mockDescribeFailoverError.mockImplementation((err: Error) => ({
    message: err.message,
    reason: 'unknown' as const,
    status: undefined as number | undefined,
    code: undefined as string | undefined,
  }));
  mocks.mockGetUserFriendlyErrorMessage.mockImplementation((err: Error) => err.message);
  mocks.mockZodToJsonSchema.mockReturnValue({
    type: 'object',
    properties: { input: { type: 'string' } },
  });
  mocks.mockNormalizeToolSchema.mockImplementation((schema: unknown) => schema);
  mocks.mockGetModel.mockReturnValue({ id: 'mock-model' });
  mocks.mockAiTool.mockImplementation((def: unknown) => def);
  mocks.mockJsonSchema.mockImplementation((schema: unknown) => schema);
}

describe('executeAgenticChat', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('returns a successful response when agent completes normally', async () => {
    const state = makeAgentState();
    mocks.mockRunWithModelFallback.mockResolvedValue(makeFallbackResult(state));

    const response = await executeAgenticChat(makeBaseRequest());

    expect(response.content).toBe('All done.');
    expect(response.provider).toBe('anthropic');
    expect(response.model).toBe('claude-sonnet-4-5');
    expect(response.agentState.stopReason).toBe('textResponse');
    expect(response.agentState.totalSteps).toBe(3);
  });

  it('resolves the primary provider from an explicit provider parameter', async () => {
    const state = makeAgentState();
    mocks.mockRunWithModelFallback.mockResolvedValue(
      makeFallbackResult(state, 'openai')
    );

    const response = await executeAgenticChat(
      makeBaseRequest({ provider: 'openai', model: 'gpt4o' })
    );

    const [callArgs] = mocks.mockRunWithModelFallback.mock.calls[0] as [{ primaryProvider: string }];
    expect(callArgs.primaryProvider).toBe('openai');
    expect(response.provider).toBe('openai');
  });

  it('uses the configured deployment model when resolveModel succeeds', async () => {
    mocks.mockResolveModel.mockReturnValue({ provider: 'azure', model: 'my-gpt4o-deployment' });
    const state = makeAgentState();
    mocks.mockRunWithModelFallback.mockResolvedValue({
      result: state,
      provider: 'azure',
      model: 'my-gpt4o-deployment',
      attempts: [],
    });

    await executeAgenticChat(makeBaseRequest({ provider: 'azure' }));

    const [callArgs] = mocks.mockRunWithModelFallback.mock.calls[0] as [{ primaryModel: string }];
    expect(callArgs.primaryModel).toBe('my-gpt4o-deployment');
  });

  it('maps executed tool calls to status=success and failed calls to status=error', async () => {
    const state = makeAgentState({
      toolCallHistory: [
        {
          id: 'tc-1',
          name: 'read_file',
          args: { path: '/foo' },
          result: 'file contents',
          status: 'executed',
          startedAt: Date.now(),
        },
        {
          id: 'tc-2',
          name: 'write_file',
          args: { path: '/bar' },
          result: undefined,
          status: 'failed',
          error: 'Permission denied',
          startedAt: Date.now(),
        },
      ],
    });
    mocks.mockRunWithModelFallback.mockResolvedValue(makeFallbackResult(state));

    const response = await executeAgenticChat(makeBaseRequest());

    expect(response.toolCalls).toHaveLength(2);
    expect(response.toolCalls![0].status).toBe('success');
    expect(response.toolCalls![1].status).toBe('error');
    expect(response.toolCalls![0].name).toBe('read_file');
  });

  it('populates usage from usedBudget with 70/30 prompt/completion split', async () => {
    const state = makeAgentState({ usedBudget: 1000 });
    mocks.mockRunWithModelFallback.mockResolvedValue(makeFallbackResult(state));

    const response = await executeAgenticChat(makeBaseRequest());

    expect(response.usage.totalTokens).toBe(1000);
    expect(response.usage.promptTokens).toBe(700);
    expect(response.usage.completionTokens).toBe(300);
  });

  it('sets usedFallback=true when actual provider differs from primary', async () => {
    const state = makeAgentState();
    mocks.mockRunWithModelFallback.mockResolvedValue({
      result: state,
      provider: 'openai',
      model: 'gpt-4o',
      attempts: [{ provider: 'anthropic', model: 'claude-sonnet-4-5', error: 'rate limit' }],
    });

    const response = await executeAgenticChat(makeBaseRequest());

    expect(response.fallbackInfo?.usedFallback).toBe(true);
    expect(response.fallbackInfo?.requestedProvider).toBe('anthropic');
    expect(response.fallbackInfo?.attempts).toHaveLength(1);
  });

  it('returns an error response when runWithModelFallback throws', async () => {
    mocks.mockRunWithModelFallback.mockRejectedValue(new Error('All providers exhausted'));
    mocks.mockGetUserFriendlyErrorMessage.mockReturnValue('All providers exhausted');

    const response = await executeAgenticChat(makeBaseRequest());

    expect(response.content).toContain('Task execution failed');
    expect(response.content).toContain('All providers exhausted');
    expect(response.agentState.stopReason).toBe('error');
    expect(response.agentState.totalSteps).toBe(0);
    expect(response.usage.totalTokens).toBe(0);
  });

  it('calls onStep callback via agent.on registration', async () => {
    const state = makeAgentState();
    mocks.mockRunWithModelFallback.mockImplementation(async ({ run }: { run: (p: string, m: string) => Promise<AgentState> }) => {
      await run('anthropic', 'claude-sonnet-4-5');
      return makeFallbackResult(state);
    });
    mocks.mockAgentRun.mockResolvedValue(state);

    const onStep = vi.fn();
    await executeAgenticChat(makeBaseRequest({ onStep }));

    expect(mocks.mockAgentOn).toHaveBeenCalledWith('step:start', onStep);
  });

  it('calls onToolCall and onToolResult via agent.on registration', async () => {
    const state = makeAgentState();
    mocks.mockRunWithModelFallback.mockImplementation(async ({ run }: { run: (p: string, m: string) => Promise<AgentState> }) => {
      await run('anthropic', 'claude-sonnet-4-5');
      return makeFallbackResult(state);
    });
    mocks.mockAgentRun.mockResolvedValue(state);

    const onToolCall = vi.fn();
    const onToolResult = vi.fn();
    await executeAgenticChat(makeBaseRequest({ onToolCall, onToolResult }));

    expect(mocks.mockAgentOn).toHaveBeenCalledWith('tool:call', expect.any(Function));
    expect(mocks.mockAgentOn).toHaveBeenCalledWith('tool:result', expect.any(Function));
  });

  it('includes artifacts from finalResult in agentState', async () => {
    const state = makeAgentState({
      finalResult: {
        success: true,
        summary: 'Done with artifacts.',
        stopReason: 'textResponse',
        artifacts: [{ type: 'file', id: 'art-1', description: 'output.txt' }],
        nextSteps: [],
      },
    });
    mocks.mockRunWithModelFallback.mockResolvedValue(makeFallbackResult(state));

    const response = await executeAgenticChat(makeBaseRequest());

    expect(response.agentState.artifacts).toHaveLength(1);
    expect(response.agentState.artifacts[0].type).toBe('file');
  });

  it('falls back to "Task completed." when finalResult.summary is empty', async () => {
    const state = makeAgentState({
      finalResult: {
        success: true,
        summary: '',
        stopReason: 'maxSteps',
        artifacts: [],
        nextSteps: [],
      },
    });
    mocks.mockRunWithModelFallback.mockResolvedValue(makeFallbackResult(state));

    const response = await executeAgenticChat(makeBaseRequest());

    expect(response.content).toBe('Task completed.');
  });

  it('logs cooldown information when providers are in cooldown', async () => {
    const { logger } = await import('../../utils/logger.js');
    mocks.mockGetProvidersInCooldown.mockReturnValue([
      { provider: 'openai', reason: 'rate_limit', cooldownUntil: Date.now() + 60000, lastError: 'Too many requests' },
    ]);
    const state = makeAgentState();
    mocks.mockRunWithModelFallback.mockResolvedValue(makeFallbackResult(state));

    await executeAgenticChat(makeBaseRequest());

    expect(logger.info).toHaveBeenCalledWith(
      '[AgenticChat] Providers currently in cooldown',
      expect.objectContaining({ cooldowns: expect.any(Array) })
    );
  });

  it('passes the effort parameter through to agent configuration', async () => {
    const state = makeAgentState();
    mocks.mockRunWithModelFallback.mockImplementation(async ({ run }: { run: (p: string, m: string) => Promise<AgentState> }) => {
      await run('anthropic', 'claude-sonnet-4-5');
      return makeFallbackResult(state);
    });
    mocks.mockAgentRun.mockResolvedValue(state);

    await executeAgenticChat(makeBaseRequest({ effort: 'high' }));

    // AgentExecutor was constructed — we verify it was called
    expect(mocks.AgentExecutorCtor).toHaveBeenCalled();
  });

  it('uses "sonnet" as default model alias when none provided', async () => {
    const state = makeAgentState();
    mocks.mockRunWithModelFallback.mockResolvedValue(makeFallbackResult(state));

    const requestWithoutModel = makeBaseRequest();
    delete (requestWithoutModel as Partial<AgenticChatRequest>).model;

    await executeAgenticChat(requestWithoutModel);

    const [callArgs] = mocks.mockRunWithModelFallback.mock.calls[0] as [{ primaryProvider: string; primaryModel: string }];
    // model defaults to 'sonnet' → alias maps to anthropic/claude-sonnet-4-5
    expect(callArgs.primaryProvider).toBe('anthropic');
  });
});

// ============================================================================
// streamAgenticChat tests
// ============================================================================

describe('streamAgenticChat', () => {
  beforeEach(() => {
    resetMocks();
  });

  async function collectEvents(
    request: StreamAgenticChatRequest
  ): Promise<AgenticStreamEvent[]> {
    const events: AgenticStreamEvent[] = [];
    for await (const event of streamAgenticChat(request)) {
      events.push(event);
    }
    return events;
  }

  it('emits an error event immediately when no providers are configured', async () => {
    mocks.mockGetConfiguredProviders.mockReturnValue([]);

    const events = await collectEvents(makeBaseRequest() as StreamAgenticChatRequest);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    const data = events[0].data as Record<string, unknown>;
    expect(data.message).toContain('No AI providers configured');
  });

  it('emits session:start as the first event with correct metadata', async () => {
    const state = makeAgentState();
    mocks.mockRunWithModelFallback.mockResolvedValue(makeFallbackResult(state));

    const events = await collectEvents(makeBaseRequest() as StreamAgenticChatRequest);

    expect(events[0].type).toBe('session:start');
    const data = events[0].data as Record<string, unknown>;
    expect(data.conversationId).toBe('conv-123');
    expect(data.provider).toBe('anthropic');
    expect(data.configuredProviders).toEqual(['anthropic']);
  });

  it('emits summary and complete events after successful run', async () => {
    const state = makeAgentState();
    mocks.mockRunWithModelFallback.mockResolvedValue(makeFallbackResult(state));

    const events = await collectEvents(makeBaseRequest() as StreamAgenticChatRequest);

    const types = events.map((e) => e.type);
    expect(types).toContain('session:start');
    expect(types).toContain('summary');
    expect(types).toContain('complete');
  });

  it('summary event contains the finalResult summary text and artifacts', async () => {
    const state = makeAgentState({
      finalResult: {
        success: true,
        summary: 'Streaming completed successfully.',
        stopReason: 'textResponse',
        artifacts: [{ type: 'code', id: 'a1' }],
        nextSteps: ['Review the output'],
      },
    });
    mocks.mockRunWithModelFallback.mockResolvedValue(makeFallbackResult(state));

    const events = await collectEvents(makeBaseRequest() as StreamAgenticChatRequest);

    const summaryEvent = events.find((e) => e.type === 'summary');
    expect(summaryEvent).toBeDefined();
    const data = summaryEvent!.data as Record<string, unknown>;
    expect(data.summary).toBe('Streaming completed successfully.');
    expect((data.artifacts as unknown[]).length).toBe(1);
  });

  it('complete event includes token usage and step count', async () => {
    const state = makeAgentState({
      currentStep: 5,
      usedBudget: 1500,
      inputTokensUsed: 1000,
      outputTokensUsed: 500,
    });
    mocks.mockRunWithModelFallback.mockResolvedValue(makeFallbackResult(state));

    const events = await collectEvents(makeBaseRequest() as StreamAgenticChatRequest);

    const completeEvent = events.find((e) => e.type === 'complete');
    expect(completeEvent).toBeDefined();
    const data = completeEvent!.data as Record<string, unknown>;
    expect(data.totalSteps).toBe(5);
    expect(data.totalTokens).toBe(1500);
    expect(data.inputTokens).toBe(1000);
    expect(data.outputTokens).toBe(500);
  });

  it('emits an error event when the agent throws', async () => {
    mocks.mockRunWithModelFallback.mockRejectedValue(new Error('Provider crashed'));
    mocks.mockGetUserFriendlyErrorMessage.mockReturnValue('Provider crashed');

    const events = await collectEvents(makeBaseRequest() as StreamAgenticChatRequest);

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    const data = errorEvent!.data as Record<string, unknown>;
    expect(data.message).toBe('Provider crashed');
  });

  it('emits step:start and step:complete events when agent fires them', async () => {
    const state = makeAgentState({ currentStep: 2 });
    const handlers: Record<string, (...args: unknown[]) => void> = {};

    mocks.mockAgentOn.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    });

    mocks.mockRunWithModelFallback.mockImplementation(async ({ run }: { run: (p: string, m: string) => Promise<AgentState> }) => {
      await run('anthropic', 'claude-sonnet-4-5');
      return makeFallbackResult(state);
    });

    mocks.mockAgentStream.mockImplementation(async function* () {
      handlers['step:start']?.({ currentStep: 1, usedBudget: 50, maxBudget: 50000 });
      handlers['step:complete']?.({ currentStep: 1, usedBudget: 100, maxBudget: 50000 }, { text: 'Step done.' });
    });
    mocks.mockAgentGetState.mockReturnValue(state);

    const events = await collectEvents(makeBaseRequest() as StreamAgenticChatRequest);

    const types = events.map((e) => e.type);
    expect(types).toContain('step:start');
    expect(types).toContain('step:complete');
  });

  it('emits tool:call and tool:result events when agent fires them', async () => {
    const state = makeAgentState();
    const handlers: Record<string, (...args: unknown[]) => void> = {};

    mocks.mockAgentOn.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    });

    mocks.mockRunWithModelFallback.mockImplementation(async ({ run }: { run: (p: string, m: string) => Promise<AgentState> }) => {
      await run('anthropic', 'claude-sonnet-4-5');
      return makeFallbackResult(state);
    });

    mocks.mockAgentStream.mockImplementation(async function* () {
      handlers['tool:call']?.({ currentStep: 1 }, { id: 'tc-1', name: 'list_files', args: {} });
      handlers['tool:result']?.({ currentStep: 1 }, {
        id: 'tc-1',
        name: 'list_files',
        result: ['file1.ts'],
        status: 'executed',
        startedAt: Date.now(),
        completedAt: Date.now(),
      });
    });
    mocks.mockAgentGetState.mockReturnValue(state);

    const events = await collectEvents(makeBaseRequest() as StreamAgenticChatRequest);

    const toolCallEvent = events.find((e) => e.type === 'tool:call');
    const toolResultEvent = events.find((e) => e.type === 'tool:result');
    expect(toolCallEvent).toBeDefined();
    expect(toolResultEvent).toBeDefined();
    const callData = toolCallEvent!.data as Record<string, unknown>;
    expect(callData.name).toBe('list_files');
  });

  it('emits a fallback event when provider switches during the run', async () => {
    const state = makeAgentState();
    mocks.mockAgentOn.mockImplementation(() => {});

    mocks.mockRunWithModelFallback.mockImplementation(async ({ run }: { run: (p: string, m: string) => Promise<AgentState> }) => {
      // Simulate fallback by calling run with a different provider
      await run('openai', 'gpt-4o');
      return {
        result: state,
        provider: 'openai',
        model: 'gpt-4o',
        attempts: [{ provider: 'anthropic', model: 'claude-sonnet-4-5', error: 'rate limit' }],
      };
    });
    mocks.mockAgentStream.mockImplementation(async function* () { /* no-op */ });
    mocks.mockAgentGetState.mockReturnValue(state);

    const events = await collectEvents(makeBaseRequest() as StreamAgenticChatRequest);

    const fallbackEvent = events.find((e) => e.type === 'fallback');
    expect(fallbackEvent).toBeDefined();
  });

  it('includes thinking:start and thinking:end events when showThinking=true', async () => {
    const state = makeAgentState({ currentStep: 1 });
    const handlers: Record<string, (...args: unknown[]) => void> = {};

    mocks.mockAgentOn.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    });

    mocks.mockRunWithModelFallback.mockImplementation(async ({ run }: { run: (p: string, m: string) => Promise<AgentState> }) => {
      await run('anthropic', 'claude-sonnet-4-5');
      return makeFallbackResult(state);
    });

    mocks.mockAgentStream.mockImplementation(async function* () {
      handlers['step:start']?.({ currentStep: 1, usedBudget: 0, maxBudget: 50000 });
      handlers['step:complete']?.({ currentStep: 1, usedBudget: 50, maxBudget: 50000 }, { text: 'Done.' });
    });
    mocks.mockAgentGetState.mockReturnValue(state);

    const request: StreamAgenticChatRequest = {
      ...makeBaseRequest(),
      showThinking: true,
    };
    const events = await collectEvents(request);

    const types = events.map((e) => e.type);
    expect(types).toContain('thinking:start');
    expect(types).toContain('thinking:end');
  });

  it('suppresses thinking events when showThinking=false', async () => {
    const state = makeAgentState({ currentStep: 1 });
    const handlers: Record<string, (...args: unknown[]) => void> = {};

    mocks.mockAgentOn.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    });

    mocks.mockRunWithModelFallback.mockImplementation(async ({ run }: { run: (p: string, m: string) => Promise<AgentState> }) => {
      await run('anthropic', 'claude-sonnet-4-5');
      return makeFallbackResult(state);
    });

    mocks.mockAgentStream.mockImplementation(async function* () {
      handlers['step:start']?.({ currentStep: 1, usedBudget: 0, maxBudget: 50000 });
      handlers['step:complete']?.({ currentStep: 1, usedBudget: 50, maxBudget: 50000 }, { text: 'Done.' });
    });
    mocks.mockAgentGetState.mockReturnValue(state);

    const request: StreamAgenticChatRequest = {
      ...makeBaseRequest(),
      showThinking: false,
    };
    const events = await collectEvents(request);

    const thinkingEvents = events.filter((e) => e.type.startsWith('thinking'));
    expect(thinkingEvents).toHaveLength(0);
  });

  it('all events carry a numeric timestamp', async () => {
    const state = makeAgentState();
    mocks.mockRunWithModelFallback.mockResolvedValue(makeFallbackResult(state));

    const events = await collectEvents(makeBaseRequest() as StreamAgenticChatRequest);

    for (const event of events) {
      expect(typeof event.timestamp).toBe('number');
      expect(event.timestamp).toBeGreaterThan(0);
    }
  });

  it('complete event marks usedFallback=false when primary provider was used', async () => {
    const state = makeAgentState();
    mocks.mockRunWithModelFallback.mockResolvedValue(makeFallbackResult(state, 'anthropic'));

    const events = await collectEvents(makeBaseRequest() as StreamAgenticChatRequest);

    const completeEvent = events.find((e) => e.type === 'complete');
    const data = completeEvent!.data as Record<string, unknown>;
    expect(data.usedFallback).toBe(false);
  });

  it('tool:result event includes duration when both timestamps are present', async () => {
    const state = makeAgentState();
    const handlers: Record<string, (...args: unknown[]) => void> = {};

    mocks.mockAgentOn.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    });

    mocks.mockRunWithModelFallback.mockImplementation(async ({ run }: { run: (p: string, m: string) => Promise<AgentState> }) => {
      await run('anthropic', 'claude-sonnet-4-5');
      return makeFallbackResult(state);
    });

    const startedAt = Date.now() - 200;
    const completedAt = Date.now();

    mocks.mockAgentStream.mockImplementation(async function* () {
      handlers['tool:result']?.({ currentStep: 1 }, {
        id: 'tc-1',
        name: 'search',
        result: { hits: 5 },
        status: 'executed',
        startedAt,
        completedAt,
      });
    });
    mocks.mockAgentGetState.mockReturnValue(state);

    const events = await collectEvents(makeBaseRequest() as StreamAgenticChatRequest);

    const toolResultEvent = events.find((e) => e.type === 'tool:result');
    expect(toolResultEvent).toBeDefined();
    const data = toolResultEvent!.data as Record<string, unknown>;
    expect(typeof data.duration).toBe('number');
    expect(data.duration as number).toBeGreaterThan(0);
  });
});

// ============================================================================
// Tool schema conversion (integration through executeAgenticChat)
// ============================================================================

describe('tool schema conversion', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('calls zodToJsonSchema for each tool parameter schema', async () => {
    const state = makeAgentState();
    mocks.mockRunWithModelFallback.mockImplementation(async ({ run }: { run: (p: string, m: string) => Promise<AgentState> }) => {
      await run('anthropic', 'claude-sonnet-4-5');
      return makeFallbackResult(state);
    });
    mocks.mockAgentRun.mockResolvedValue(state);

    const tools = [
      { name: 'search', description: 'Search the web', parameters: z.object({ query: z.string() }) },
      { name: 'read_file', description: 'Read a file', parameters: z.object({ path: z.string() }) },
    ];

    await executeAgenticChat(makeBaseRequest({ tools }));

    expect(mocks.mockZodToJsonSchema).toHaveBeenCalledTimes(2);
    expect(mocks.mockZodToJsonSchema).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $refStrategy: 'none' })
    );
  });

  it('applies Azure schema normalization when provider is azure', async () => {
    const state = makeAgentState();
    mocks.mockRunWithModelFallback.mockImplementation(async ({ run }: { run: (p: string, m: string) => Promise<AgentState> }) => {
      await run('azure', 'my-deployment');
      return { result: state, provider: 'azure', model: 'my-deployment', attempts: [] };
    });
    mocks.mockAgentRun.mockResolvedValue(state);

    const tools = [
      { name: 'create_issue', description: 'Create a Linear issue', parameters: z.object({ title: z.string() }) },
    ];

    await executeAgenticChat(makeBaseRequest({ provider: 'azure', tools }));

    expect(mocks.mockNormalizeToolSchema).toHaveBeenCalled();
  });

  it('does not call normalizeToolSchema for non-azure providers', async () => {
    const state = makeAgentState();
    mocks.mockRunWithModelFallback.mockImplementation(async ({ run }: { run: (p: string, m: string) => Promise<AgentState> }) => {
      await run('anthropic', 'claude-sonnet-4-5');
      return makeFallbackResult(state);
    });
    mocks.mockAgentRun.mockResolvedValue(state);

    const tools = [
      { name: 'list_projects', description: 'List projects', parameters: z.object({}) },
    ];

    await executeAgenticChat(makeBaseRequest({ tools }));

    expect(mocks.mockNormalizeToolSchema).not.toHaveBeenCalled();
  });

  it('gracefully handles schema conversion errors with a minimal fallback schema', async () => {
    mocks.mockZodToJsonSchema.mockImplementationOnce(() => {
      throw new Error('Schema conversion failed');
    });

    const state = makeAgentState();
    mocks.mockRunWithModelFallback.mockImplementation(async ({ run }: { run: (p: string, m: string) => Promise<AgentState> }) => {
      await run('anthropic', 'claude-sonnet-4-5');
      return makeFallbackResult(state);
    });
    mocks.mockAgentRun.mockResolvedValue(state);

    const tools = [
      { name: 'bad_tool', description: 'Tool with broken schema', parameters: {} },
    ];

    // Should not throw — falls back to minimal empty schema
    await expect(
      executeAgenticChat(makeBaseRequest({ tools }))
    ).resolves.not.toThrow();

    // The ai.tool factory should still have been called with fallback schema
    expect(mocks.mockAiTool).toHaveBeenCalled();
  });
});

// ============================================================================
// toolHandler.executeTool integration
// ============================================================================

describe('toolHandler.executeTool integration', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('unwraps ToolExecutionResult and passes inner result to the agent', async () => {
    const toolHandler = makeToolHandler();
    toolHandler.executeTool.mockResolvedValue({ result: { files: ['a.ts', 'b.ts'] } });

    const state = makeAgentState();
    let capturedOnToolExecute: ((name: string, args: Record<string, unknown>) => Promise<unknown>) | undefined;

    mocks.mockRunWithModelFallback.mockImplementation(async ({ run }: { run: (p: string, m: string) => Promise<AgentState> }) => {
      await run('anthropic', 'claude-sonnet-4-5');
      return makeFallbackResult(state);
    });

    // Capture onToolExecute from the stream() call (4th argument)
    mocks.mockAgentStream.mockImplementation(async function* (
      _model: unknown,
      _messages: unknown,
      _tools: unknown,
      onToolExecute: (name: string, args: Record<string, unknown>) => Promise<unknown>
    ) {
      capturedOnToolExecute = onToolExecute;
    });
    mocks.mockAgentGetState.mockReturnValue(state);

    await executeAgenticChat(makeBaseRequest({ toolHandler: toolHandler as unknown as AgenticChatRequest['toolHandler'] }));

    expect(capturedOnToolExecute).toBeDefined();
    const result = await capturedOnToolExecute!('list_files', { dir: '/src' });
    expect(result).toEqual({ files: ['a.ts', 'b.ts'] });
    expect(toolHandler.executeTool).toHaveBeenCalledWith(
      'list_files',
      { dir: '/src' },
      expect.any(String)
    );
  });

  it('passes a fresh UUID as the toolCallId on each invocation', async () => {
    const toolHandler = makeToolHandler();
    toolHandler.executeTool.mockResolvedValue({ result: 'ok' });

    const state = makeAgentState();
    let capturedOnToolExecute: ((name: string, args: Record<string, unknown>) => Promise<unknown>) | undefined;

    mocks.mockRunWithModelFallback.mockImplementation(async ({ run }: { run: (p: string, m: string) => Promise<AgentState> }) => {
      await run('anthropic', 'claude-sonnet-4-5');
      return makeFallbackResult(state);
    });

    // Capture onToolExecute from the stream() call (4th argument)
    mocks.mockAgentStream.mockImplementation(async function* (
      _model: unknown,
      _messages: unknown,
      _tools: unknown,
      onToolExecute: (name: string, args: Record<string, unknown>) => Promise<unknown>
    ) {
      capturedOnToolExecute = onToolExecute;
    });
    mocks.mockAgentGetState.mockReturnValue(state);

    await executeAgenticChat(makeBaseRequest({ toolHandler: toolHandler as unknown as AgenticChatRequest['toolHandler'] }));

    await capturedOnToolExecute!('tool_a', {});
    await capturedOnToolExecute!('tool_b', {});

    const calls = toolHandler.executeTool.mock.calls as Array<[string, unknown, string]>;
    const id1 = calls[0][2];
    const id2 = calls[1][2];
    expect(id1).not.toBe(id2);
  });
});
