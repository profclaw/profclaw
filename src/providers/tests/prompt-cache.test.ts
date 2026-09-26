import { describe, it, expect } from 'vitest';
import type { ModelMessage, ToolSet } from 'ai';
import { tool, jsonSchema } from 'ai';
import {
  aggregateStepUsage,
  applyAnthropicMessageCache,
  applyAnthropicToolCache,
  cacheHitRate,
  calculateCachedInputCost,
  extractCacheUsage,
  getCacheConfigForModel,
  getPromptCacheConfig,
} from '../prompt-cache.js';

const on = getPromptCacheConfig({});

describe('getPromptCacheConfig', () => {
  it('uses defaults', () => {
    expect(on).toEqual({ enabled: true, ttl: '5m', readMultiplier: 0.1, writeMultiplier: 1.25 });
  });

  it('reads overrides from env and ignores invalid values', () => {
    const cfg = getPromptCacheConfig({
      PROFCLAW_PROMPT_CACHE: 'off',
      PROFCLAW_PROMPT_CACHE_TTL: '1h',
      PROFCLAW_CACHE_READ_MULTIPLIER: '0.5',
      PROFCLAW_CACHE_WRITE_MULTIPLIER: 'abc',
    });
    expect(cfg).toEqual({ enabled: false, ttl: '1h', readMultiplier: 0.5, writeMultiplier: 1.25 });
  });
});

describe('applyAnthropicMessageCache', () => {
  const messages: ModelMessage[] = [
    { role: 'system', content: 'stable' },
    { role: 'system', content: 'volatile' },
    { role: 'user', content: 'hi' },
  ];

  it('marks first and last leading system messages only', () => {
    const out = applyAnthropicMessageCache(messages, 'anthropic', on);
    expect(out[0].providerOptions).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' } } });
    expect(out[1].providerOptions).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' } } });
    expect(out[2].providerOptions).toBeUndefined();
    expect(messages[0].providerOptions).toBeUndefined();
  });

  it('passes ttl for 1h cache', () => {
    const out = applyAnthropicMessageCache(messages, 'anthropic', { ...on, ttl: '1h' });
    expect(out[0].providerOptions).toEqual({ anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } } });
  });

  it('is a no-op for other providers, when disabled, or without a system message', () => {
    expect(applyAnthropicMessageCache(messages, 'openai', on)).toBe(messages);
    expect(applyAnthropicMessageCache(messages, 'anthropic', { ...on, enabled: false })).toBe(messages);
    const noSystem: ModelMessage[] = [{ role: 'user', content: 'x' }];
    expect(applyAnthropicMessageCache(noSystem, 'anthropic', on)).toBe(noSystem);
  });

  it('produces byte-identical prefixes for identical stable input', () => {
    const a = applyAnthropicMessageCache([{ role: 'system', content: 's' }, { role: 'user', content: '1' }], 'anthropic', on);
    const b = applyAnthropicMessageCache([{ role: 'system', content: 's' }, { role: 'user', content: '2' }], 'anthropic', on);
    expect(JSON.stringify(a[0])).toBe(JSON.stringify(b[0]));
  });
});

describe('applyAnthropicToolCache', () => {
  const mk = (): ToolSet => ({
    zeta: tool({ description: 'z', inputSchema: jsonSchema({ type: 'object', properties: {} }) }),
    alpha: tool({ description: 'a', inputSchema: jsonSchema({ type: 'object', properties: {} }) }),
  });

  it('sorts tools and marks only the last one', () => {
    const out = applyAnthropicToolCache(mk(), 'anthropic', on);
    expect(Object.keys(out)).toEqual(['alpha', 'zeta']);
    expect(out.alpha.providerOptions).toBeUndefined();
    expect(out.zeta.providerOptions).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' } } });
  });

  it('is a no-op for non-anthropic providers', () => {
    const tools = mk();
    expect(applyAnthropicToolCache(tools, 'openai', on)).toBe(tools);
  });
});

describe('extractCacheUsage', () => {
  it('reads AI SDK v6 inputTokenDetails', () => {
    const usage = {
      inputTokens: 1000,
      outputTokens: 50,
      inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 800, cacheWriteTokens: 100 },
    };
    expect(extractCacheUsage(usage)).toEqual({
      promptTokens: 1000, completionTokens: 50, cacheReadTokens: 800, cacheWriteTokens: 100,
    });
  });

  it('falls back to cachedInputTokens (OpenAI style)', () => {
    const r = extractCacheUsage({ inputTokens: 500, outputTokens: 5, cachedInputTokens: 300 });
    expect(r.cacheReadTokens).toBe(300);
    expect(r.cacheWriteTokens).toBe(0);
  });

  it('falls back to raw Anthropic counters and legacy token names', () => {
    const r = extractCacheUsage({
      promptTokens: 10,
      completionTokens: 2,
      raw: { cache_read_input_tokens: 7, cache_creation_input_tokens: 3 },
    });
    expect(r).toEqual({ promptTokens: 10, completionTokens: 2, cacheReadTokens: 7, cacheWriteTokens: 3 });
  });

  it('returns zeros for missing usage', () => {
    expect(extractCacheUsage(undefined)).toEqual({
      promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    });
  });
});

describe('cost and hit rate', () => {
  it('applies read and write multipliers to the input rate', () => {
    // 100 uncached + 800 read (0.1x) + 100 write (1.25x) = 100 + 80 + 125 = 305 effective tokens
    const cost = calculateCachedInputCost(1000, 800, 100, 3, on);
    expect(cost).toBeCloseTo((305 / 1_000_000) * 3, 10);
  });

  it('honours custom multipliers', () => {
    const cost = calculateCachedInputCost(1000, 1000, 0, 10, { ...on, readMultiplier: 0.5 });
    expect(cost).toBeCloseTo((500 / 1_000_000) * 10, 10);
  });

  it('computes hit rate safely', () => {
    expect(cacheHitRate(800, 1000)).toBe(0.8);
    expect(cacheHitRate(0, 0)).toBe(0);
  });
});

describe('aggregateStepUsage', () => {
  it('sums tokens and cache counts across steps', () => {
    const steps = [
      { usage: { inputTokens: 100, outputTokens: 10, inputTokenDetails: { cacheReadTokens: 40, cacheWriteTokens: 20 } } },
      { usage: { inputTokens: 150, outputTokens: 30, inputTokenDetails: { cacheReadTokens: 100, cacheWriteTokens: 0 } } },
    ];
    expect(aggregateStepUsage(steps, { inputTokens: 150, outputTokens: 30 })).toEqual({
      promptTokens: 250,
      completionTokens: 40,
      cacheReadTokens: 140,
      cacheWriteTokens: 20,
    });
  });

  it('falls back to run-level usage when there are no steps', () => {
    expect(aggregateStepUsage(undefined, { inputTokens: 5, outputTokens: 2 }).promptTokens).toBe(5);
  });
});

describe('getCacheConfigForModel', () => {
  it('uses the documented read multiplier for Opus 5.5 and Fable 5.1', () => {
    expect(getCacheConfigForModel('claude-opus-5-5', {}).readMultiplier).toBe(0.05);
    expect(getCacheConfigForModel('anthropic/claude-fable-5-1', {}).readMultiplier).toBe(0.025);
  });

  it('keeps the default for other models', () => {
    expect(getCacheConfigForModel('claude-sonnet-5', {}).readMultiplier).toBe(0.1);
    expect(getCacheConfigForModel('claude-haiku-4-5-20251001', {}).readMultiplier).toBe(0.1);
  });

  it('lets an explicit env multiplier win over the per-model default', () => {
    const cfg = getCacheConfigForModel('claude-opus-5-5', { PROFCLAW_CACHE_READ_MULTIPLIER: '0.2' });
    expect(cfg.readMultiplier).toBe(0.2);
  });

  it('prices a cache read cheaper on Opus 5.5 than on Sonnet 5 at the same input rate', () => {
    const opus = calculateCachedInputCost(10_000, 10_000, 0, 4, getCacheConfigForModel('claude-opus-5-5', {}));
    const sonnet = calculateCachedInputCost(10_000, 10_000, 0, 4, getCacheConfigForModel('claude-sonnet-5', {}));
    expect(opus).toBeLessThan(sonnet);
  });
});
