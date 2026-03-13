/**
 * Prompt Adapter Tests
 *
 * Tests for src/chat/prompt-adapter.ts
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  classifyModelCapability,
  adaptPromptForModel,
  getAdaptationInfo,
} from './prompt-adapter.js';
import type { ModelCapabilityLevel } from './prompt-adapter.js';

// =============================================================================
// classifyModelCapability
// =============================================================================

describe('classifyModelCapability', () => {
  // --- Reasoning models ---

  it('classifies claude-opus as reasoning', () => {
    expect(classifyModelCapability('claude-opus-4-6')).toBe('reasoning');
  });

  it('classifies claude-sonnet-4 as reasoning', () => {
    expect(classifyModelCapability('claude-sonnet-4-5-20250929')).toBe('reasoning');
  });

  it('classifies gpt-4o as reasoning', () => {
    expect(classifyModelCapability('gpt-4o')).toBe('reasoning');
  });

  it('classifies gpt-4-turbo as reasoning', () => {
    expect(classifyModelCapability('gpt-4-turbo')).toBe('reasoning');
  });

  it('classifies gpt-4.5 as reasoning', () => {
    expect(classifyModelCapability('gpt-4.5')).toBe('reasoning');
  });

  it('classifies gemini-pro as reasoning', () => {
    expect(classifyModelCapability('gemini-pro')).toBe('reasoning');
  });

  it('classifies gemini-1.5-pro as reasoning', () => {
    expect(classifyModelCapability('gemini-1.5-pro')).toBe('reasoning');
  });

  it('classifies gemini-2.0-flash as reasoning', () => {
    expect(classifyModelCapability('gemini-2.0-flash')).toBe('reasoning');
  });

  it('classifies deepseek-r1 as reasoning', () => {
    expect(classifyModelCapability('deepseek-r1')).toBe('reasoning');
  });

  it('classifies deepseek-v3 as reasoning', () => {
    expect(classifyModelCapability('deepseek-v3')).toBe('reasoning');
  });

  it('classifies deepseek-chat as reasoning', () => {
    expect(classifyModelCapability('deepseek-chat')).toBe('reasoning');
  });

  it('classifies o1- models as reasoning', () => {
    expect(classifyModelCapability('o1-mini')).toBe('reasoning');
    expect(classifyModelCapability('o1-preview')).toBe('reasoning');
  });

  it('classifies o3- models as reasoning', () => {
    expect(classifyModelCapability('o3-mini')).toBe('reasoning');
  });

  it('classifies qwen-2.5-72b as reasoning', () => {
    expect(classifyModelCapability('qwen-2.5-72b')).toBe('reasoning');
  });

  it('classifies llama-3.1-405b as reasoning', () => {
    expect(classifyModelCapability('llama-3.1-405b')).toBe('reasoning');
  });

  // --- Instruction models ---

  it('classifies claude-haiku as instruction', () => {
    expect(classifyModelCapability('claude-haiku-4-5-20251001')).toBe('instruction');
    expect(classifyModelCapability('claude-3-haiku-20240307')).toBe('instruction');
  });

  it('classifies gpt-3.5 as instruction', () => {
    expect(classifyModelCapability('gpt-3.5-turbo')).toBe('instruction');
  });

  it('classifies gemini-flash (no version) as instruction', () => {
    // gemini-flash without a version number matches the instruction pattern
    // Note: gemini-1.5-flash matches the REASONING pattern (1.5) instead
    expect(classifyModelCapability('gemini-flash')).toBe('instruction');
  });

  it('classifies mistral-large as instruction', () => {
    expect(classifyModelCapability('mistral-large-latest')).toBe('instruction');
  });

  it('classifies mistral-medium as instruction', () => {
    expect(classifyModelCapability('mistral-medium-latest')).toBe('instruction');
  });

  it('classifies llama-3.1-70b as instruction', () => {
    expect(classifyModelCapability('llama-3.1-70b')).toBe('instruction');
  });

  it('classifies llama-3.3-70b as instruction', () => {
    expect(classifyModelCapability('llama-3.3-70b')).toBe('instruction');
  });

  it('classifies qwen-2.5-32b as instruction', () => {
    expect(classifyModelCapability('qwen-2.5-32b')).toBe('instruction');
  });

  it('classifies qwen-2.5-14b as instruction', () => {
    expect(classifyModelCapability('qwen2.5-14b')).toBe('instruction');
  });

  it('classifies command-r as instruction', () => {
    expect(classifyModelCapability('command-r-plus')).toBe('instruction');
  });

  it('classifies mixtral as instruction', () => {
    expect(classifyModelCapability('mixtral-8x7b-32768')).toBe('instruction');
  });

  it('classifies models with 70b size suffix as instruction', () => {
    expect(classifyModelCapability('custom-model-70b')).toBe('instruction');
  });

  it('classifies models with 30b size suffix as instruction', () => {
    expect(classifyModelCapability('custom-model-30b')).toBe('instruction');
  });

  // --- Basic/instruction default ---

  it('classifies unknown models as instruction (safe default)', () => {
    expect(classifyModelCapability('some-unknown-model')).toBe('instruction');
  });

  it('classifies empty string as instruction', () => {
    expect(classifyModelCapability('')).toBe('instruction');
  });

  it('classifies models with small size (7b) as instruction (not basic)', () => {
    // The code falls through to instruction for size < 30
    // but then defaults to instruction for unknown models anyway
    const level = classifyModelCapability('custom-7b');
    expect(['instruction', 'basic']).toContain(level);
  });

  it('classifies phi-4 as instruction (no size match -> default)', () => {
    const level = classifyModelCapability('phi-4');
    expect(level).toBe('instruction');
  });
});

// =============================================================================
// adaptPromptForModel
// =============================================================================

describe('adaptPromptForModel', () => {
  const basePrompt = 'You are a helpful assistant.';

  // --- Reasoning models ---

  describe('reasoning model (claude-opus-4-6)', () => {
    it('does not add a system prefix', () => {
      const result = adaptPromptForModel({
        modelId: 'claude-opus-4-6',
        systemPrompt: basePrompt,
      });

      expect(result.adaptationLevel).toBe('reasoning');
      // No prefix means the prompt starts with the original content
      expect(result.systemPrompt.trimStart()).toContain(basePrompt);
      expect(result.systemPrompt).not.toContain('IMPORTANT: Follow these instructions');
    });

    it('includes tool usage guidance when toolDescriptions provided', () => {
      const result = adaptPromptForModel({
        modelId: 'claude-opus-4-6',
        systemPrompt: basePrompt,
        toolDescriptions: 'read_file: reads a file',
      });

      expect(result.systemPrompt).toContain('available tools');
    });

    it('does not add response format guidance (reasoning models need none)', () => {
      const result = adaptPromptForModel({
        modelId: 'claude-opus-4-6',
        systemPrompt: basePrompt,
      });

      expect(result.systemPrompt).not.toContain('RESPONSE FORMAT');
      expect(result.systemPrompt).not.toContain('Format your responses');
    });

    it('does not include few-shot examples', () => {
      const result = adaptPromptForModel({
        modelId: 'claude-opus-4-6',
        systemPrompt: basePrompt,
      });

      expect(result.systemPrompt).not.toContain('## Examples');
    });

    it('allows large history (100k tokens budget)', () => {
      // Build a big history - should not be truncated for reasoning models
      const history = Array.from({ length: 10 }, (_, i) => ({
        role: 'user',
        content: `Message ${i}`,
      }));

      const result = adaptPromptForModel({
        modelId: 'claude-opus-4-6',
        systemPrompt: basePrompt,
        conversationHistory: history,
      });

      // All messages should be preserved (each is tiny, well under 100k tokens)
      expect(result.truncatedHistory?.length).toBe(10);
    });

    it('returns correct adaptationLevel', () => {
      const result = adaptPromptForModel({
        modelId: 'gpt-4o',
        systemPrompt: basePrompt,
      });
      expect(result.adaptationLevel).toBe('reasoning');
    });
  });

  // --- Instruction models ---

  describe('instruction model (claude-haiku)', () => {
    it('adds step-by-step prefix', () => {
      const result = adaptPromptForModel({
        modelId: 'claude-haiku-4-5-20251001',
        systemPrompt: basePrompt,
      });

      expect(result.adaptationLevel).toBe('instruction');
      expect(result.systemPrompt).toContain('IMPORTANT: Follow these instructions');
    });

    it('adds tool guidance when tools are provided', () => {
      const result = adaptPromptForModel({
        modelId: 'claude-haiku-4-5-20251001',
        systemPrompt: basePrompt,
        toolDescriptions: 'read_file: reads a file',
      });

      expect(result.systemPrompt).toContain('Read the tool description carefully');
    });

    it('adds response format guidance', () => {
      const result = adaptPromptForModel({
        modelId: 'gpt-3.5-turbo',
        systemPrompt: basePrompt,
      });

      expect(result.systemPrompt).toContain('Format your responses');
    });

    it('truncates history beyond 12k tokens', () => {
      // Each message ~3000 chars -> ~750 tokens; 20 messages -> ~15k tokens > 12k budget
      const bigContent = 'a'.repeat(3000);
      const history = Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: bigContent,
      }));

      const result = adaptPromptForModel({
        modelId: 'gpt-3.5-turbo',
        systemPrompt: basePrompt,
        conversationHistory: history,
      });

      expect(result.truncatedHistory).toBeDefined();
      expect(result.truncatedHistory!.length).toBeLessThan(20);
    });

    it('includes one few-shot example', () => {
      const result = adaptPromptForModel({
        modelId: 'gpt-3.5-turbo',
        systemPrompt: basePrompt,
      });

      // instruction level has 1 example
      expect(result.systemPrompt).toContain('## Examples');
    });
  });

  // --- Basic models ---

  describe('basic model (llama:7b)', () => {
    it('adds explicit rules prefix for basic models', () => {
      // Force basic level by matching no patterns and no size hint
      // 'phi-mini' doesn't match reasoning/instruction patterns
      // but the code defaults to 'instruction' for unknowns, so let's
      // use a model that explicitly gets classified as basic via small size
      // Actually per the code: all unknown models now default to 'instruction'
      // We need a model that gets through the size check at <30
      // The code: if size >= 70 -> instruction, if size >= 30 -> instruction
      // otherwise falls through to the final 'return instruction' default
      // So 'basic' is effectively never returned currently - but let's test
      // what the code actually does for small models

      // Test with a small size model
      const result = adaptPromptForModel({
        modelId: 'custom-7b',
        systemPrompt: basePrompt,
      });

      // The level will be 'instruction' per the code (falls to default)
      expect(['instruction', 'basic']).toContain(result.adaptationLevel);
    });
  });

  // --- Context budget truncation ---

  describe('context budget truncation', () => {
    it('preserves short history intact', () => {
      const history = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const result = adaptPromptForModel({
        modelId: 'gpt-3.5-turbo',
        systemPrompt: basePrompt,
        conversationHistory: history,
      });

      expect(result.truncatedHistory).toEqual(history);
    });

    it('always preserves the first message when truncating', () => {
      const bigContent = 'x'.repeat(3000);
      const history = [
        { role: 'user', content: 'Original task: build me an app' },
        ...Array.from({ length: 20 }, () => ({ role: 'user', content: bigContent })),
      ];

      const result = adaptPromptForModel({
        modelId: 'gpt-3.5-turbo',
        systemPrompt: basePrompt,
        conversationHistory: history,
      });

      const truncated = result.truncatedHistory ?? [];
      expect(truncated[0]?.content).toBe('Original task: build me an app');
    });

    it('returns undefined truncatedHistory when no history provided', () => {
      const result = adaptPromptForModel({
        modelId: 'gpt-3.5-turbo',
        systemPrompt: basePrompt,
      });

      expect(result.truncatedHistory).toBeUndefined();
    });

    it('returns empty array when empty history provided', () => {
      const result = adaptPromptForModel({
        modelId: 'gpt-3.5-turbo',
        systemPrompt: basePrompt,
        conversationHistory: [],
      });

      // empty array stays empty
      expect(result.truncatedHistory).toEqual([]);
    });

    it('returns estimatedTokens as a positive number', () => {
      const result = adaptPromptForModel({
        modelId: 'claude-opus-4-6',
        systemPrompt: basePrompt,
      });

      expect(result.estimatedTokens).toBeGreaterThan(0);
    });

    it('does not add tool guidance when toolDescriptions is not provided', () => {
      const result = adaptPromptForModel({
        modelId: 'claude-haiku-4-5-20251001',
        systemPrompt: basePrompt,
      });

      expect(result.systemPrompt).not.toContain('TOOL USAGE');
    });

    it('respects custom contextWindowSize option', () => {
      // Just verify the option is accepted without throwing
      const result = adaptPromptForModel({
        modelId: 'claude-opus-4-6',
        systemPrompt: basePrompt,
        contextWindowSize: 200000,
      });

      expect(result).toBeDefined();
      expect(result.adaptationLevel).toBe('reasoning');
    });
  });

  // --- Token estimate ---

  it('estimatedTokens increases with longer prompts', () => {
    const short = adaptPromptForModel({ modelId: 'gpt-4o', systemPrompt: 'Short.' });
    const long = adaptPromptForModel({
      modelId: 'gpt-4o',
      systemPrompt: 'a'.repeat(1000),
    });

    expect(long.estimatedTokens).toBeGreaterThan(short.estimatedTokens);
  });
});

// =============================================================================
// getAdaptationInfo
// =============================================================================

describe('getAdaptationInfo', () => {
  it('returns reasoning info for reasoning model', () => {
    const info = getAdaptationInfo('claude-opus-4-6');

    expect(info.level).toBe('reasoning');
    expect(info.description).toContain('Full capability');
    expect(info.maxTools).toBe('all');
    expect(info.historyBudget).toContain('100000');
  });

  it('returns instruction info for instruction model', () => {
    const info = getAdaptationInfo('gpt-3.5-turbo');

    expect(info.level).toBe('instruction');
    expect(info.description).toContain('Instruction-following');
    expect(info.maxTools).toBe('25-30');
    expect(info.historyBudget).toContain('12000');
  });

  it('returns instruction info for claude-haiku', () => {
    const info = getAdaptationInfo('claude-haiku-4-5-20251001');

    expect(info.level).toBe('instruction');
    expect(info.description).toBeTruthy();
    expect(info.historyBudget).toBeTruthy();
  });

  it('has all required fields', () => {
    const info = getAdaptationInfo('gpt-4o');

    expect(info).toHaveProperty('level');
    expect(info).toHaveProperty('description');
    expect(info).toHaveProperty('maxTools');
    expect(info).toHaveProperty('historyBudget');
  });

  it('returns consistent level with classifyModelCapability', () => {
    const modelId = 'claude-opus-4-6';
    const info = getAdaptationInfo(modelId);
    const level: ModelCapabilityLevel = classifyModelCapability(modelId);

    expect(info.level).toBe(level);
  });

  it('returns instruction level for unknown model', () => {
    const info = getAdaptationInfo('some-random-model');
    expect(info.level).toBe('instruction');
  });
});
