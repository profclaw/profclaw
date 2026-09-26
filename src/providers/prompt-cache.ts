/**
 * Prompt caching helpers
 *
 * Anthropic requires explicit cache breakpoints (providerOptions.anthropic.cacheControl).
 * The cached prefix order is: tools, then system, then messages. A breakpoint on the
 * last system message therefore caches tool schemas and the system prompt together;
 * an extra breakpoint on the last tool lets the tool block hit even if the system
 * prompt changes. OpenAI caches automatically and only reports cached token counts.
 *
 * Cache multipliers are relative to the base input price and are env-configurable.
 */

import type { ModelMessage, ToolSet } from 'ai';

export interface PromptCacheConfig {
  enabled: boolean;
  ttl: '5m' | '1h';
  /** Cost of a cache read relative to base input price */
  readMultiplier: number;
  /** Cost of a cache write relative to base input price */
  writeMultiplier: number;
}

export interface CacheUsage {
  /** Total prompt tokens, including cached reads and writes */
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

const DEFAULT_READ_MULTIPLIER = 0.1;
const DEFAULT_WRITE_MULTIPLIER = 1.25;

function parseMultiplier(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Read cache settings from env on each call so tests and runtime changes apply. */
export function getPromptCacheConfig(env: NodeJS.ProcessEnv = process.env): PromptCacheConfig {
  const disabled = (env['PROFCLAW_PROMPT_CACHE'] ?? '').toLowerCase();
  return {
    enabled: !['0', 'false', 'off', 'no'].includes(disabled),
    ttl: env['PROFCLAW_PROMPT_CACHE_TTL'] === '1h' ? '1h' : '5m',
    readMultiplier: parseMultiplier(env['PROFCLAW_CACHE_READ_MULTIPLIER'], DEFAULT_READ_MULTIPLIER),
    writeMultiplier: parseMultiplier(env['PROFCLAW_CACHE_WRITE_MULTIPLIER'], DEFAULT_WRITE_MULTIPLIER),
  };
}

function cacheProviderOptions(config: PromptCacheConfig): {
  anthropic: { cacheControl: { type: 'ephemeral'; ttl?: '1h' } };
} {
  return {
    anthropic: {
      cacheControl: config.ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' },
    },
  };
}

/**
 * Add cache breakpoints to the leading system block: one on the first system message
 * (the stable prompt) and one on the last leading system message. Callers put volatile
 * per-request context in a later system message so the first breakpoint still hits
 * across requests. History after the system block stays outside the cached prefix.
 * Returns a new array; inputs are not mutated.
 */
export function applyAnthropicMessageCache<T extends ModelMessage>(
  messages: T[],
  provider: string,
  config: PromptCacheConfig = getPromptCacheConfig(),
): T[] {
  if (provider !== 'anthropic' || !config.enabled) return messages;

  let lastSystem = -1;
  for (let i = 0; i < messages.length && messages[i].role === 'system'; i++) {
    lastSystem = i;
  }
  if (lastSystem < 0) return messages;

  return messages.map((msg, i) =>
    i === 0 || i === lastSystem
      ? { ...msg, providerOptions: { ...msg.providerOptions, ...cacheProviderOptions(config) } }
      : msg,
  );
}

/**
 * Return tools in a deterministic (name-sorted) order with a cache breakpoint on the
 * last one. Object key order in the request body affects the prefix bytes, so sorting
 * keeps the tool block byte-stable across steps and sessions.
 */
export function applyAnthropicToolCache<T extends ToolSet>(
  tools: T,
  provider: string,
  config: PromptCacheConfig = getPromptCacheConfig(),
): T {
  if (provider !== 'anthropic' || !config.enabled) return tools;
  const names = Object.keys(tools).sort();
  if (names.length === 0) return tools;

  const sorted: ToolSet = {};
  names.forEach((name, i) => {
    const def = tools[name];
    sorted[name] = i === names.length - 1
      ? { ...def, providerOptions: { ...def.providerOptions, ...cacheProviderOptions(config) } }
      : def;
  });
  return sorted as T;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function rec(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/**
 * Normalize AI SDK usage (v6 shape, legacy promptTokens shape, or raw provider
 * counters) into total prompt tokens plus cache read/write counts.
 * In AI SDK v6, inputTokens already includes cached reads and writes.
 */
export function extractCacheUsage(usage: unknown): CacheUsage {
  const u = rec(usage);
  if (!u) return { promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

  const details = rec(u['inputTokenDetails']);
  const raw = rec(u['raw']);

  const cacheReadTokens =
    num(details?.['cacheReadTokens']) ??
    num(u['cachedInputTokens']) ??
    num(raw?.['cache_read_input_tokens']) ??
    num(rec(raw?.['prompt_tokens_details'])?.['cached_tokens']) ??
    0;
  const cacheWriteTokens =
    num(details?.['cacheWriteTokens']) ??
    num(raw?.['cache_creation_input_tokens']) ??
    0;

  return {
    promptTokens: num(u['inputTokens']) ?? num(u['promptTokens']) ?? 0,
    completionTokens: num(u['outputTokens']) ?? num(u['completionTokens']) ?? 0,
    cacheReadTokens,
    cacheWriteTokens,
  };
}

/**
 * Input cost in USD for a prompt that may include cached tokens.
 * Uncached tokens bill at the base rate, reads and writes at the multiplied rate.
 */
export function calculateCachedInputCost(
  promptTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
  inputRatePer1M: number,
  config: PromptCacheConfig = getPromptCacheConfig(),
): number {
  const cached = cacheReadTokens + cacheWriteTokens;
  const uncached = Math.max(0, promptTokens - cached);
  const effective =
    uncached +
    cacheReadTokens * config.readMultiplier +
    cacheWriteTokens * config.writeMultiplier;
  return (effective / 1_000_000) * inputRatePer1M;
}

/** Fraction of prompt tokens served from cache (0 when there were no prompt tokens). */
export function cacheHitRate(cacheReadTokens: number, promptTokens: number): number {
  return promptTokens > 0 ? Math.min(1, cacheReadTokens / promptTokens) : 0;
}
