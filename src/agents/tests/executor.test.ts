import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentExecutor } from '../executor.js';
import { generateText } from 'ai';

// Mock the ai package
vi.mock('ai', () => ({
  generateText: vi.fn(),
  stepCountIs: vi.fn(() => () => false),
  hasToolCall: vi.fn(() => () => false),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  createContextualLogger: vi.fn(() => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  })),
}));

describe('AgentExecutor', () => {
  let executor: AgentExecutor;
  const sessionId = 'session-123';
  const conversationId = 'conv-456';
  const goal = 'Test agent goal';

  beforeEach(() => {
    vi.resetAllMocks();
    executor = new AgentExecutor(sessionId, conversationId, goal);
  });

  it('should initialize with correct state', () => {
    const state = executor.getState();
    expect(state.sessionId).toBe(sessionId);
    expect(state.status).toBe('idle');
    expect(state.goal).toBe(goal);
    expect(state.currentStep).toBe(0);
  });

  it('should run and stop when no tools are called (simple text response)', async () => {
    // With the new approach, generateText is called once. The SDK calls onStepFinish
    // for each step internally. We simulate this by capturing and calling onStepFinish.
    (generateText as any).mockImplementation(async (opts: any) => {
      // Simulate one step with no tool calls (text-only response)
      if (opts.onStepFinish) {
        opts.onStepFinish({
          text: 'Hello, I am done.',
          toolCalls: [],
          toolResults: [],
          usage: { promptTokens: 10, completionTokens: 5 },
          finishReason: 'stop',
        });
      }

      return {
        text: 'Hello, I am done.',
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 10, completionTokens: 5 },
        totalUsage: { promptTokens: 10, completionTokens: 5 },
        steps: [{
          text: 'Hello, I am done.',
          toolCalls: [],
          toolResults: [],
          usage: { promptTokens: 10, completionTokens: 5 },
        }],
        response: { messages: [] },
      };
    });

    const state = await executor.run({} as any, [], {});

    // The checkCustomStopConditions will detect text-only + no tool history and set status to completed
    expect(state.status).toBe('completed');
    expect(state.currentStep).toBe(1);
    expect(state.usedBudget).toBe(15);
    expect(state.finalResult?.success).toBe(true);
    expect(state.finalResult?.stopReason).toBe('textResponse');
    expect(state.finalResult?.summary).toBe('Hello, I am done.');
  });

  it('should execute tools and track results via onStepFinish', async () => {
    (generateText as any).mockImplementation(async (opts: any) => {
      // Step 1: model calls a tool, SDK executes it, calls onStepFinish
      if (opts.onStepFinish) {
        opts.onStepFinish({
          text: 'Calling tool...',
          toolCalls: [{ toolCallId: 'call-1', toolName: 'test-tool', args: { arg: 1 } }],
          toolResults: [{ toolCallId: 'call-1', toolName: 'test-tool', result: { result: 'tool-output' } }],
          usage: { promptTokens: 10, completionTokens: 10 },
          finishReason: 'tool-calls',
        });
      }

      return {
        text: 'Done.',
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 10, completionTokens: 5 },
        totalUsage: { promptTokens: 20, completionTokens: 15 },
        steps: [
          {
            text: 'Calling tool...',
            toolCalls: [{ toolCallId: 'call-1', toolName: 'test-tool', args: { arg: 1 } }],
            toolResults: [{ toolCallId: 'call-1', toolName: 'test-tool', result: { result: 'tool-output' } }],
            usage: { promptTokens: 10, completionTokens: 10 },
          },
        ],
        response: { messages: [] },
      };
    });

    const onToolExecute = vi.fn().mockResolvedValue({ result: 'tool-output' });

    const state = await executor.run({} as any, [], { 'test-tool': {} }, onToolExecute);

    expect(state.currentStep).toBe(1);
    expect(state.toolCallHistory).toHaveLength(1);
    expect(state.toolCallHistory[0].name).toBe('test-tool');
    expect(state.toolCallHistory[0].result).toEqual({ result: 'tool-output' });
    expect(state.toolCallHistory[0].status).toBe('executed');
  });

  it('should extract context from tool results', async () => {
    (generateText as any).mockImplementation(async (opts: any) => {
      if (opts.onStepFinish) {
        opts.onStepFinish({
          text: 'Listing projects...',
          toolCalls: [{ toolCallId: 'call-1', toolName: 'list_projects', args: {} }],
          toolResults: [{
            toolCallId: 'call-1',
            toolName: 'list_projects',
            result: { data: { projects: [{ id: 'p1', key: 'PROJ', name: 'Project 1' }] } },
          }],
          usage: { promptTokens: 0, completionTokens: 0 },
          finishReason: 'tool-calls',
        });
      }

      return {
        text: 'Done.',
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 0, completionTokens: 0 },
        totalUsage: { promptTokens: 0, completionTokens: 0 },
        steps: [{
          text: 'Listing projects...',
          toolCalls: [{ toolCallId: 'call-1', toolName: 'list_projects', args: {} }],
          toolResults: [{
            toolCallId: 'call-1',
            toolName: 'list_projects',
            result: { data: { projects: [{ id: 'p1', key: 'PROJ', name: 'Project 1' }] } },
          }],
          usage: { promptTokens: 0, completionTokens: 0 },
        }],
        response: { messages: [] },
      };
    });

    const onToolExecute = vi.fn().mockResolvedValue({
      data: { projects: [{ id: 'p1', key: 'PROJ', name: 'Project 1' }] },
    });

    const state = await executor.run({} as any, [], { 'list_projects': {} }, onToolExecute);

    expect(state.context.availableProjects).toHaveLength(1);
    expect(state.context.availableProjects![0].key).toBe('PROJ');
  });

  it('should handle tool failure and record error status', async () => {
    (generateText as any).mockImplementation(async (opts: any) => {
      if (opts.onStepFinish) {
        // Step with a tool call that returned an error result
        opts.onStepFinish({
          text: 'Calling tool...',
          toolCalls: [{ toolCallId: 'call-1', toolName: 'fail-tool', args: {} }],
          toolResults: [{
            toolCallId: 'call-1',
            toolName: 'fail-tool',
            result: { error: 'Tool error', success: false, canRetry: true, suggestion: 'Try something else' },
          }],
          usage: { promptTokens: 0, completionTokens: 0 },
          finishReason: 'tool-calls',
        });
      }

      return {
        text: 'Fallback response.',
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 0, completionTokens: 0 },
        totalUsage: { promptTokens: 0, completionTokens: 0 },
        steps: [{
          text: 'Calling tool...',
          toolCalls: [{ toolCallId: 'call-1', toolName: 'fail-tool', args: {} }],
          toolResults: [{
            toolCallId: 'call-1',
            toolName: 'fail-tool',
            result: { error: 'Tool error', success: false, canRetry: true, suggestion: 'Try something else' },
          }],
          usage: { promptTokens: 0, completionTokens: 0 },
        }],
        response: { messages: [] },
      };
    });

    const onToolExecute = vi.fn().mockRejectedValue(new Error('Tool error'));

    const state = await executor.run({} as any, [], { 'fail-tool': {} }, onToolExecute);

    expect(state.toolCallHistory[0].status).toBe('failed');
    expect(state.toolCallHistory[0].error).toBe('Tool error');
  });

  it('should emit events during execution', async () => {
    (generateText as any).mockImplementation(async (opts: any) => {
      if (opts.onStepFinish) {
        opts.onStepFinish({
          text: 'Hi',
          toolCalls: [],
          toolResults: [],
          usage: { promptTokens: 1, completionTokens: 1 },
          finishReason: 'stop',
        });
      }

      return {
        text: 'Hi',
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 1, completionTokens: 1 },
        totalUsage: { promptTokens: 1, completionTokens: 1 },
        steps: [{ text: 'Hi', toolCalls: [], toolResults: [], usage: { promptTokens: 1, completionTokens: 1 } }],
        response: { messages: [] },
      };
    });

    const startSpy = vi.fn();
    const stepStartSpy = vi.fn();

    executor.on('start', startSpy);
    executor.on('step:start', stepStartSpy);

    await executor.run({} as any, [], {});

    expect(startSpy).toHaveBeenCalled();
    expect(stepStartSpy).toHaveBeenCalled();
  });

  it('should stop when max steps reached via stopWhen', async () => {
    const smallExecutor = new AgentExecutor(sessionId, conversationId, goal, { maxSteps: 2 });

    (generateText as any).mockImplementation(async (opts: any) => {
      // Simulate 2 steps with tool calls
      if (opts.onStepFinish) {
        opts.onStepFinish({
          text: 'Step 1',
          toolCalls: [{ toolCallId: 'c1', toolName: 't', args: {} }],
          toolResults: [{ toolCallId: 'c1', toolName: 't', result: { success: true } }],
          usage: { promptTokens: 1, completionTokens: 1 },
          finishReason: 'tool-calls',
        });
        opts.onStepFinish({
          text: 'Step 2',
          toolCalls: [{ toolCallId: 'c2', toolName: 't', args: {} }],
          toolResults: [{ toolCallId: 'c2', toolName: 't', result: { success: true } }],
          usage: { promptTokens: 1, completionTokens: 1 },
          finishReason: 'tool-calls',
        });
      }

      return {
        text: 'Done.',
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 1, completionTokens: 1 },
        totalUsage: { promptTokens: 2, completionTokens: 2 },
        steps: [
          { text: 'Step 1', toolCalls: [{ toolCallId: 'c1', toolName: 't', args: {} }], toolResults: [{ toolCallId: 'c1', toolName: 't', result: { success: true } }], usage: { promptTokens: 1, completionTokens: 1 } },
          { text: 'Step 2', toolCalls: [{ toolCallId: 'c2', toolName: 't', args: {} }], toolResults: [{ toolCallId: 'c2', toolName: 't', result: { success: true } }], usage: { promptTokens: 1, completionTokens: 1 } },
        ],
        response: { messages: [] },
      };
    });

    const state = await smallExecutor.run({} as any, [], { 't': {} }, async () => ({ success: true }));

    // SDK's stopWhen handles the actual stopping, our onStepFinish tracks steps
    expect(state.currentStep).toBe(2);
    // Verify generateText was called with stopWhen containing step count limit
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        stopWhen: expect.any(Array),
      })
    );
  });

  it('should return a timeout error result when a tool exceeds stepTimeoutMs', async () => {
    // Create executor with a very short timeout
    const timeoutExecutor = new AgentExecutor(sessionId, conversationId, goal, {
      stepTimeoutMs: 50,
    });

    // The onToolExecute never resolves within 50ms
    const slowTool = vi.fn(() => new Promise<never>(() => { /* never resolves */ }));

    let capturedResult: unknown;

    (generateText as any).mockImplementation(async (opts: any) => {
      // Simulate the SDK calling our wrapped execute function directly
      const wrappedTools = opts.tools as Record<string, { execute: (args: Record<string, unknown>) => Promise<unknown> }>;
      capturedResult = await wrappedTools['slow-tool'].execute({});

      if (opts.onStepFinish) {
        opts.onStepFinish({
          text: 'Got timeout result.',
          toolCalls: [],
          toolResults: [],
          usage: { promptTokens: 1, completionTokens: 1 },
          finishReason: 'stop',
        });
      }

      return {
        text: 'Done.',
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 1, completionTokens: 1 },
        totalUsage: { promptTokens: 1, completionTokens: 1 },
        steps: [],
        response: { messages: [] },
      };
    });

    await timeoutExecutor.run({} as any, [], { 'slow-tool': {} }, slowTool);

    expect(capturedResult).toMatchObject({
      success: false,
      canRetry: true,
      error: expect.stringContaining('timed out after 50ms'),
    });
  });

  it('should clear the timeout timer when a tool completes before the deadline', async () => {
    // Confirm that fast tools do NOT trigger the timeout error path
    const fastExecutor = new AgentExecutor(sessionId, conversationId, goal, {
      stepTimeoutMs: 5000,
    });

    const fastTool = vi.fn().mockResolvedValue({ result: 'fast-output' });
    let capturedResult: unknown;

    (generateText as any).mockImplementation(async (opts: any) => {
      const wrappedTools = opts.tools as Record<string, { execute: (args: Record<string, unknown>) => Promise<unknown> }>;
      capturedResult = await wrappedTools['fast-tool'].execute({});

      if (opts.onStepFinish) {
        opts.onStepFinish({
          text: 'Got fast result.',
          toolCalls: [],
          toolResults: [],
          usage: { promptTokens: 1, completionTokens: 1 },
          finishReason: 'stop',
        });
      }

      return {
        text: 'Done.',
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 1, completionTokens: 1 },
        totalUsage: { promptTokens: 1, completionTokens: 1 },
        steps: [],
        response: { messages: [] },
      };
    });

    await fastExecutor.run({} as any, [], { 'fast-tool': {} }, fastTool);

    // Should be the actual tool result (not a timeout error)
    // ResultStore stores and returns the parsed value
    expect(capturedResult).not.toMatchObject({ success: false });
    expect(capturedResult).toMatchObject({ result: 'fast-output' });
  });

  it('should cancel execution', async () => {
    (generateText as any).mockImplementation(async () => {
      executor.cancel();
      // Simulate that abort causes the function to throw or return early
      const error = new Error('Aborted');
      error.name = 'AbortError';
      throw error;
    });

    const state = await executor.run({} as any, [], {});
    expect(state.status).toBe('cancelled');
  });
});
