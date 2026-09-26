import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateText } from 'ai';
import { AgentExecutor } from '../executor.js';
import { trackChatUsage } from '../../costs/token-tracker.js';

vi.mock('ai', () => ({
  generateText: vi.fn(),
  stepCountIs: vi.fn(() => () => false),
  hasToolCall: vi.fn(() => () => false),
}));

vi.mock('../../costs/token-tracker.js', () => ({
  trackChatUsage: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  createContextualLogger: vi.fn(() => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  })),
}));

describe('AgentExecutor usage tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes each step usage, including cache tokens, to the token tracker', async () => {
    const stepUsage = {
      inputTokens: 1000,
      outputTokens: 50,
      inputTokenDetails: { cacheReadTokens: 800, cacheWriteTokens: 100 },
    };
    vi.mocked(generateText).mockImplementation((async (opts: {
      onStepFinish?: (step: unknown) => void;
    }) => {
      opts.onStepFinish?.({ text: 'done', toolCalls: [], toolResults: [], usage: stepUsage });
      return {
        text: 'done',
        toolCalls: [],
        toolResults: [],
        usage: stepUsage,
        totalUsage: stepUsage,
        steps: [{ text: 'done', toolCalls: [], toolResults: [], usage: stepUsage }],
        response: { messages: [] },
      };
    }) as unknown as typeof generateText);

    const executor = new AgentExecutor('s-usage', 'c-usage', 'goal');
    const model = { modelId: 'claude-sonnet-4-5' } as unknown as Parameters<AgentExecutor['run']>[0];
    await executor.run(model, [], {});

    expect(trackChatUsage).toHaveBeenCalledTimes(1);
    expect(trackChatUsage).toHaveBeenCalledWith('claude-sonnet-4-5', 1050, 1000, 50, {
      cacheReadTokens: 800,
      cacheWriteTokens: 100,
    });
  });
});
