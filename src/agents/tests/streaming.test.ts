/**
 * AgentExecutor stream() tests
 *
 * Verifies that the async generator yields events in the correct order,
 * handles tool errors, hook lifecycle integration, context compaction,
 * and that run() maintains backward compatibility.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentExecutor } from '../executor.js';
import { generateText } from 'ai';
import type { AgentEvent } from '../events.js';
import { getHookRegistry } from '../../hooks/registry.js';
import type { HookRegistry } from '../../hooks/registry.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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

// HookRegistry is NOT mocked — we use the real singleton so we can register
// test hooks. We clear it in beforeEach to keep tests isolated.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all events from the stream into an array. */
async function collectStream(
  executor: AgentExecutor,
  generateTextImpl: (opts: Record<string, unknown>) => Promise<unknown>,
): Promise<AgentEvent[]> {
  (generateText as ReturnType<typeof vi.fn>).mockImplementation(generateTextImpl);

  const events: AgentEvent[] = [];
  for await (const event of executor.stream({} as never, [], {})) {
    events.push(event);
  }
  return events;
}

/** Minimal generateText mock for a single text-only step. */
function makeTextOnlyMock(text = 'Hello, done.') {
  return async (opts: Record<string, unknown>) => {
    const onStepFinish = opts['onStepFinish'] as ((step: Record<string, unknown>) => void) | undefined;
    onStepFinish?.({
      text,
      toolCalls: [],
      toolResults: [],
      usage: { promptTokens: 5, completionTokens: 3 },
      finishReason: 'stop',
    });
    return {
      text,
      toolCalls: [],
      toolResults: [],
      usage: { promptTokens: 5, completionTokens: 3 },
      totalUsage: { promptTokens: 5, completionTokens: 3 },
      steps: [{ text, toolCalls: [], toolResults: [], usage: { promptTokens: 5, completionTokens: 3 } }],
      response: { messages: [] },
    };
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentExecutor stream()', () => {
  let executor: AgentExecutor;
  let hookRegistry: HookRegistry;

  beforeEach(() => {
    vi.resetAllMocks();
    // Clear the singleton hook registry so hooks from one test don't bleed into another
    hookRegistry = getHookRegistry();
    hookRegistry.clear();
    executor = new AgentExecutor('sess-1', 'conv-1', 'stream test goal');
  });

  // -------------------------------------------------------------------------
  it('yields session:start as the very first event', async () => {
    const events = await collectStream(executor, makeTextOnlyMock());

    expect(events[0]).toMatchObject({
      type: 'session:start',
      sessionId: 'sess-1',
    });
    expect(events[0].type).toBe('session:start');
  });

  // -------------------------------------------------------------------------
  it('yields session:complete as the last event on success', async () => {
    const events = await collectStream(executor, makeTextOnlyMock());

    const last = events[events.length - 1];
    expect(last.type).toBe('session:complete');
    if (last.type === 'session:complete') {
      expect(last.totalSteps).toBeGreaterThanOrEqual(1);
      expect(typeof last.totalTokens).toBe('number');
    }
  });

  // -------------------------------------------------------------------------
  it('yields tool:call before tool:result for a successful tool', async () => {
    const toolCallId = 'tc-abc';

    const onToolExecute = vi.fn().mockResolvedValue({ output: 'ok' });

    (generateText as ReturnType<typeof vi.fn>).mockImplementation(async (opts: Record<string, unknown>) => {
      // Simulate the SDK calling the wrapped execute directly
      const wrappedTools = opts['tools'] as Record<string, { execute: (a: Record<string, unknown>, o: { toolCallId: string }) => Promise<unknown> }>;
      await wrappedTools['my-tool'].execute({ x: 1 }, { toolCallId });

      const onStepFinish = opts['onStepFinish'] as ((step: Record<string, unknown>) => void) | undefined;
      onStepFinish?.({
        text: 'Done.',
        toolCalls: [{ toolCallId, toolName: 'my-tool', args: { x: 1 } }],
        toolResults: [{ toolCallId, toolName: 'my-tool', result: { output: 'ok' } }],
        usage: { promptTokens: 2, completionTokens: 2 },
        finishReason: 'tool-calls',
      });

      return {
        text: 'Done.',
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 2, completionTokens: 2 },
        totalUsage: { promptTokens: 2, completionTokens: 2 },
        steps: [],
        response: { messages: [] },
      };
    });

    const events: AgentEvent[] = [];
    for await (const event of executor.stream({} as never, [], { 'my-tool': {} as never }, onToolExecute)) {
      events.push(event);
    }

    const toolCallIdx = events.findIndex((e) => e.type === 'tool:call');
    const toolResultIdx = events.findIndex((e) => e.type === 'tool:result');

    expect(toolCallIdx).toBeGreaterThanOrEqual(0);
    expect(toolResultIdx).toBeGreaterThan(toolCallIdx);
  });

  // -------------------------------------------------------------------------
  it('yields correct event ordering: session:start → step:start → step:complete → session:complete', async () => {
    const events = await collectStream(executor, makeTextOnlyMock());

    const types = events.map((e) => e.type);

    const sessionStartIdx = types.indexOf('session:start');
    const stepStartIdx = types.indexOf('step:start');
    const stepCompleteIdx = types.indexOf('step:complete');
    const sessionCompleteIdx = types.indexOf('session:complete');

    expect(sessionStartIdx).toBe(0);
    expect(stepStartIdx).toBeGreaterThan(sessionStartIdx);
    expect(stepCompleteIdx).toBeGreaterThan(stepStartIdx);
    expect(sessionCompleteIdx).toBeGreaterThan(stepCompleteIdx);
  });

  // -------------------------------------------------------------------------
  it('yields tool:error when the tool throws', async () => {
    const toolCallId = 'tc-err';
    const onToolExecute = vi.fn().mockRejectedValue(new Error('tool exploded'));

    (generateText as ReturnType<typeof vi.fn>).mockImplementation(async (opts: Record<string, unknown>) => {
      const wrappedTools = opts['tools'] as Record<string, { execute: (a: Record<string, unknown>, o: { toolCallId: string }) => Promise<unknown> }>;
      await wrappedTools['bad-tool'].execute({}, { toolCallId });

      const onStepFinish = opts['onStepFinish'] as ((step: Record<string, unknown>) => void) | undefined;
      onStepFinish?.({
        text: '',
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 0, completionTokens: 0 },
        finishReason: 'stop',
      });

      return {
        text: '',
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 0, completionTokens: 0 },
        totalUsage: { promptTokens: 0, completionTokens: 0 },
        steps: [],
        response: { messages: [] },
      };
    });

    const events: AgentEvent[] = [];
    for await (const event of executor.stream({} as never, [], { 'bad-tool': {} as never }, onToolExecute)) {
      events.push(event);
    }

    const errorEvent = events.find((e) => e.type === 'tool:error');
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === 'tool:error') {
      expect(errorEvent.error).toContain('tool exploded');
      expect(errorEvent.toolCallId).toBe(toolCallId);
    }
  });

  // -------------------------------------------------------------------------
  it('run() returns the same AgentState as before (backward compatibility)', async () => {
    (generateText as ReturnType<typeof vi.fn>).mockImplementation(makeTextOnlyMock('Summary text'));

    const newExecutor = new AgentExecutor('sess-bc', 'conv-bc', 'compat test');
    const state = await newExecutor.run({} as never, [], {});

    expect(state.sessionId).toBe('sess-bc');
    expect(state.status).toBe('completed');
    expect(state.finalResult).toBeDefined();
    expect(state.finalResult?.success).toBe(true);
    expect(state.finalResult?.summary).toBe('Summary text');
  });

  // -------------------------------------------------------------------------
  it('yields session:error and does not throw when generateText rejects', async () => {
    (generateText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('model unavailable'));

    const events: AgentEvent[] = [];
    let caughtError: Error | undefined;

    try {
      for await (const event of executor.stream({} as never, [], {})) {
        events.push(event);
      }
    } catch (err) {
      caughtError = err as Error;
    }

    const errorEvent = events.find((e) => e.type === 'session:error');
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === 'session:error') {
      expect(errorEvent.error).toContain('model unavailable');
    }
    // The error is re-thrown after the consumer has seen the session:error event
    expect(caughtError?.message).toContain('model unavailable');
  });

  // -------------------------------------------------------------------------
  // Hook integration tests
  // -------------------------------------------------------------------------

  it('beforeToolCall hook with proceed:false skips tool execution and yields tool:error', async () => {
    const toolCallId = 'tc-blocked';
    const onToolExecute = vi.fn().mockResolvedValue({ output: 'should not run' });

    // Register a hook that blocks the tool
    hookRegistry.register({
      name: 'block-test-tool',
      point: 'beforeToolCall',
      priority: 1,
      handler: async () => ({ proceed: false }),
    });

    (generateText as ReturnType<typeof vi.fn>).mockImplementation(async (opts: Record<string, unknown>) => {
      const wrappedTools = opts['tools'] as Record<string, { execute: (a: Record<string, unknown>, o: { toolCallId: string }) => Promise<unknown> }>;
      await wrappedTools['blocked-tool'].execute({ x: 1 }, { toolCallId });

      const onStepFinish = opts['onStepFinish'] as ((step: Record<string, unknown>) => void) | undefined;
      onStepFinish?.({
        text: 'Done.',
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 1, completionTokens: 1 },
        finishReason: 'stop',
      });

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

    const events: AgentEvent[] = [];
    for await (const event of executor.stream({} as never, [], { 'blocked-tool': {} as never }, onToolExecute)) {
      events.push(event);
    }

    // The real onToolExecute should NOT have been called
    expect(onToolExecute).not.toHaveBeenCalled();

    // A tool:error event should be present with the block reason
    const errorEvent = events.find((e) => e.type === 'tool:error');
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === 'tool:error') {
      expect(errorEvent.toolCallId).toBe(toolCallId);
      expect(errorEvent.error).toContain('blocked by hook');
    }

    // tool:call should NOT have been emitted (the hook blocked before that)
    const callEvent = events.find((e) => e.type === 'tool:call');
    expect(callEvent).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  it('afterToolCall hook receives the tool result', async () => {
    const toolCallId = 'tc-after';
    const onToolExecute = vi.fn().mockResolvedValue({ output: 'hello' });

    const afterHandler = vi.fn().mockResolvedValue({ proceed: true });

    hookRegistry.register({
      name: 'capture-after',
      point: 'afterToolCall',
      priority: 1,
      handler: afterHandler,
    });

    (generateText as ReturnType<typeof vi.fn>).mockImplementation(async (opts: Record<string, unknown>) => {
      const wrappedTools = opts['tools'] as Record<string, { execute: (a: Record<string, unknown>, o: { toolCallId: string }) => Promise<unknown> }>;
      await wrappedTools['after-tool'].execute({ x: 2 }, { toolCallId });

      const onStepFinish = opts['onStepFinish'] as ((step: Record<string, unknown>) => void) | undefined;
      onStepFinish?.({
        text: 'Done.',
        toolCalls: [{ toolCallId, toolName: 'after-tool', args: { x: 2 } }],
        toolResults: [{ toolCallId, toolName: 'after-tool', result: { output: 'hello' } }],
        usage: { promptTokens: 2, completionTokens: 2 },
        finishReason: 'tool-calls',
      });

      return {
        text: 'Done.',
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 2, completionTokens: 2 },
        totalUsage: { promptTokens: 2, completionTokens: 2 },
        steps: [],
        response: { messages: [] },
      };
    });

    for await (const _event of executor.stream({} as never, [], { 'after-tool': {} as never }, onToolExecute)) {
      // drain
    }

    // afterToolCall handler should have been called once
    expect(afterHandler).toHaveBeenCalledOnce();

    // The hook context should contain the tool result
    const hookCtx = afterHandler.mock.calls[0][0] as Record<string, unknown>;
    expect(hookCtx['hookPoint']).toBe('afterToolCall');
    expect(hookCtx['toolName']).toBe('after-tool');
    expect(hookCtx['toolResult']).toBeDefined();
  });

  // -------------------------------------------------------------------------
  it('context compaction triggers when messages exceed the threshold', async () => {
    // Build a large message list that exceeds the default 70k-token threshold
    // Each fake message has ~300 chars × 4 chars/token ≈ 75 tokens; we need
    // ~1000 messages to exceed the executor's compactionThreshold (70% of
    // maxBudget=100k = 70k tokens). We reduce the threshold by creating an
    // executor with a tiny maxBudget so compaction fires with fewer messages.
    const smallBudgetExecutor = new AgentExecutor('sess-compact', 'conv-compact', 'compaction test', {
      maxBudget: 400, // tiny budget; compactionThreshold = 280 tokens
    });

    // Create enough messages to exceed 280 estimated tokens
    // Each message with 100-char content ≈ 25 tokens; 15 messages ≈ 375 tokens
    const largeMessages = Array.from({ length: 15 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `${'x'.repeat(100)} message number ${i}`,
    }));

    let capturedMessages: typeof largeMessages | undefined;

    (generateText as ReturnType<typeof vi.fn>).mockImplementation(async (opts: Record<string, unknown>) => {
      // Capture the messages actually passed to generateText
      capturedMessages = opts['messages'] as typeof largeMessages;

      const onStepFinish = opts['onStepFinish'] as ((step: Record<string, unknown>) => void) | undefined;
      onStepFinish?.({
        text: 'Compaction done.',
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 5, completionTokens: 3 },
        finishReason: 'stop',
      });

      return {
        text: 'Compaction done.',
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 5, completionTokens: 3 },
        totalUsage: { promptTokens: 5, completionTokens: 3 },
        steps: [],
        response: { messages: [] },
      };
    });

    for await (const _event of smallBudgetExecutor.stream({} as never, largeMessages, {})) {
      // drain
    }

    // After compaction the message list passed to generateText should be
    // shorter than the original (compacted messages replace old turns with a summary)
    expect(capturedMessages).toBeDefined();
    expect(capturedMessages!.length).toBeLessThan(largeMessages.length);

    // The compacted context should contain a system-role summary message
    const hasSummaryMessage = capturedMessages!.some(
      (m) => m.role === 'system' && typeof m.content === 'string' && m.content.includes('Conversation Summary'),
    );
    expect(hasSummaryMessage).toBe(true);
  });
});
