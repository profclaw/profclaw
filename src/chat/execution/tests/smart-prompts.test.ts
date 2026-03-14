import { describe, expect, it } from 'vitest';
import { buildToolPrompt, getHistoryBudget, estimateTokens, truncateHistory } from '../smart-prompts.js';

describe('buildToolPrompt', () => {
  it('reasoning: returns non-empty string containing chain multiple tool calls phrase', () => {
    const prompt = buildToolPrompt('reasoning');
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain('Chain multiple tool calls');
  });

  it('instruction: returns non-empty string containing one tool at a time phrase', () => {
    const prompt = buildToolPrompt('instruction');
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain('one tool at a time');
  });

  it('basic: returns non-empty string containing RULES: and EXAMPLES OF CORRECT TOOL USAGE', () => {
    const prompt = buildToolPrompt('basic');
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain('RULES:');
    expect(prompt).toContain('EXAMPLES OF CORRECT TOOL USAGE');
  });

  it('reasoning prompt is shorter than basic prompt (less hand-holding)', () => {
    const reasoningPrompt = buildToolPrompt('reasoning');
    const basicPrompt = buildToolPrompt('basic');
    expect(reasoningPrompt.length).toBeLessThan(basicPrompt.length);
  });
});

describe('getHistoryBudget', () => {
  it('(128000, reasoning) -> 103000 (128000 - 25000)', () => {
    expect(getHistoryBudget(128000, 'reasoning')).toBe(103000);
  });

  it('(128000, instruction) -> 120000 (128000 - 8000)', () => {
    expect(getHistoryBudget(128000, 'instruction')).toBe(120000);
  });

  it('(128000, basic) -> 125000 (128000 - 3000)', () => {
    expect(getHistoryBudget(128000, 'basic')).toBe(125000);
  });

  it('(4000, reasoning) -> 1000 (minimum floor, max(1000, 4000 - 25000))', () => {
    expect(getHistoryBudget(4000, 'reasoning')).toBe(1000);
  });

  it('budget is always >= 1000 for all capability levels', () => {
    const capabilities = ['reasoning', 'instruction', 'basic'] as const;
    for (const cap of capabilities) {
      expect(getHistoryBudget(0, cap)).toBeGreaterThanOrEqual(1000);
      expect(getHistoryBudget(100, cap)).toBeGreaterThanOrEqual(1000);
      expect(getHistoryBudget(1000, cap)).toBeGreaterThanOrEqual(1000);
    }
  });
});

describe('estimateTokens', () => {
  it('empty string -> 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it("'hello' (5 chars) -> 2 (ceil(5/4))", () => {
    expect(estimateTokens('hello')).toBe(2);
  });

  it("'a'.repeat(100) -> 25", () => {
    expect(estimateTokens('a'.repeat(100))).toBe(25);
  });
});

describe('truncateHistory', () => {
  it('empty messages array returns empty', () => {
    expect(truncateHistory([], 1000)).toEqual([]);
  });

  it('all messages fit: returns all messages unchanged', () => {
    const messages = [
      { role: 'system', content: 'You are a helper.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];
    const result = truncateHistory(messages, 10000);
    expect(result).toEqual(messages);
  });

  it('keeps system message (role=system) always, even when over budget', () => {
    const systemContent = 'You are a system.';
    const messages = [
      { role: 'system', content: systemContent },
      { role: 'user', content: 'a'.repeat(10000) },
      { role: 'assistant', content: 'b'.repeat(10000) },
    ];
    // Very tight budget - only system message tokens fit
    const systemTokens = Math.ceil(systemContent.length / 4);
    const result = truncateHistory(messages, systemTokens);
    expect(result[0]).toEqual({ role: 'system', content: systemContent });
  });

  it('truncates old messages when over budget, keeping most recent', () => {
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'a'.repeat(400) },   // old - 100 tokens
      { role: 'assistant', content: 'b'.repeat(400) }, // old - 100 tokens
      { role: 'user', content: 'c'.repeat(400) },   // recent - 100 tokens
      { role: 'assistant', content: 'd'.repeat(400) }, // recent - 100 tokens
    ];
    // Budget for system (1 token) + ~2 recent messages (200 tokens), not enough for all 4
    const result = truncateHistory(messages, 205);
    // System message must be present
    expect(result.some((m) => m.role === 'system')).toBe(true);
    // Most recent messages should be kept
    const nonSystem = result.filter((m) => m.role !== 'system');
    expect(nonSystem.length).toBeGreaterThan(0);
    // The most recent user message should appear if any non-system messages fit
    const lastKept = nonSystem[nonSystem.length - 1];
    expect(lastKept.content).toBe('d'.repeat(400));
  });

  it('drops oldest non-system messages first', () => {
    const messages = [
      { role: 'user', content: 'first message - should be dropped' },
      { role: 'assistant', content: 'second message - should be dropped' },
      { role: 'user', content: 'third message - should be kept' },
      { role: 'assistant', content: 'fourth message - should be kept' },
    ];
    // Only budget for the last two messages (each ~8 tokens = 32 chars / 4)
    const result = truncateHistory(messages, 17);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('third message - should be kept');
    expect(result[1].content).toBe('fourth message - should be kept');
  });
});
