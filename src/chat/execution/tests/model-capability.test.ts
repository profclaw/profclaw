import { describe, expect, it } from 'vitest';

import {
  detectModelCapability,
  getMaxSchemaTokens,
  getModelRouting,
  getRecommendedTier,
} from '../model-capability.js';

// ===========================================================================
// detectModelCapability
// ===========================================================================

describe('detectModelCapability', () => {
  describe('reasoning models', () => {
    it.each([
      'claude-opus-4',
      'claude-sonnet-4.6',
      'gpt-4o',
      'gpt-4-turbo',
      'o1-preview',
      'gemini-2-pro',
      'deepseek-chat',
      'deepseek-r1',
      'llama-3.3-70b',
      'qwen-max',
      'grok-3',
    ])('returns reasoning for %s', (modelId) => {
      expect(detectModelCapability(modelId)).toBe('reasoning');
    });
  });

  describe('instruction models', () => {
    it.each([
      'claude-haiku-4.5',
      'gpt-4o-mini',
      'gemini-1.5-flash',
      'llama-3.1-8b',
      'mixtral-8x7b',
      'qwen-turbo',
      'Phi-4',
      'command-r',
    ])('returns instruction for %s', (modelId) => {
      expect(detectModelCapability(modelId)).toBe('instruction');
    });
  });

  describe('basic models (unknown/unmatched)', () => {
    it.each([
      'my-custom-model',
      'tiny-7b',
      'random-text',
    ])('returns basic for %s', (modelId) => {
      expect(detectModelCapability(modelId)).toBe('basic');
    });
  });

  describe('case insensitivity', () => {
    it('returns reasoning for CLAUDE-OPUS-4 (uppercased)', () => {
      expect(detectModelCapability('CLAUDE-OPUS-4')).toBe('reasoning');
    });

    it('returns reasoning for GPT-4O (uppercased)', () => {
      expect(detectModelCapability('GPT-4O')).toBe('reasoning');
    });

    it('returns instruction for CLAUDE-HAIKU-4.5 (uppercased)', () => {
      expect(detectModelCapability('CLAUDE-HAIKU-4.5')).toBe('instruction');
    });

    it('returns instruction for GPT-4O-MINI (uppercased)', () => {
      expect(detectModelCapability('GPT-4O-MINI')).toBe('instruction');
    });
  });

  describe('disambiguation', () => {
    it('gpt-4o-mini is instruction, not reasoning like gpt-4o', () => {
      expect(detectModelCapability('gpt-4o')).toBe('reasoning');
      expect(detectModelCapability('gpt-4o-mini')).toBe('instruction');
    });

    it('command-r-plus is reasoning, not instruction like command-r', () => {
      expect(detectModelCapability('command-r-plus')).toBe('reasoning');
      expect(detectModelCapability('command-r')).toBe('instruction');
    });
  });
});

// ===========================================================================
// getRecommendedTier
// ===========================================================================

describe('getRecommendedTier', () => {
  it('maps basic to essential', () => {
    expect(getRecommendedTier('basic')).toBe('essential');
  });

  it('maps instruction to standard', () => {
    expect(getRecommendedTier('instruction')).toBe('standard');
  });

  it('maps reasoning to full', () => {
    expect(getRecommendedTier('reasoning')).toBe('full');
  });
});

// ===========================================================================
// getMaxSchemaTokens
// ===========================================================================

describe('getMaxSchemaTokens', () => {
  it('returns 2000 for basic', () => {
    expect(getMaxSchemaTokens('basic')).toBe(2000);
  });

  it('returns 6000 for instruction', () => {
    expect(getMaxSchemaTokens('instruction')).toBe(6000);
  });

  it('returns 20000 for reasoning', () => {
    expect(getMaxSchemaTokens('reasoning')).toBe(20000);
  });
});

// ===========================================================================
// getModelRouting
// ===========================================================================

describe('getModelRouting', () => {
  it('returns reasoning composite for claude-opus-4', () => {
    const routing = getModelRouting('claude-opus-4');
    expect(routing).toEqual({
      capability: 'reasoning',
      tier: 'full',
      maxSchemaTokens: 20000,
    });
  });

  it('returns instruction composite for gpt-4o-mini', () => {
    const routing = getModelRouting('gpt-4o-mini');
    expect(routing).toEqual({
      capability: 'instruction',
      tier: 'standard',
      maxSchemaTokens: 6000,
    });
  });

  it('returns basic composite for unknown-model', () => {
    const routing = getModelRouting('unknown-model');
    expect(routing).toEqual({
      capability: 'basic',
      tier: 'essential',
      maxSchemaTokens: 2000,
    });
  });

  it('returns an object with exactly capability, tier, and maxSchemaTokens keys', () => {
    const routing = getModelRouting('claude-opus-4');
    expect(Object.keys(routing).sort()).toEqual(['capability', 'maxSchemaTokens', 'tier']);
  });
});
