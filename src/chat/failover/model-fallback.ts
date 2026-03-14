/**
 * Model Fallback System
 *
 * Provides automatic failover between AI providers when requests fail.
 * Based on OpenClaw's sophisticated model fallback patterns.
 */

import { logger } from '../../utils/logger.js';
import type { ProviderType } from '../../providers/index.js';
import type { FallbackAttempt, ModelFallbackResult, ProviderCooldown, FailoverReason } from './types.js';
import {
  FailoverError,
  coerceToFailoverError,
  describeFailoverError,
  isFailoverError,
  shouldRethrowWithoutFallback,
  getUserFriendlyErrorMessage,
} from './error.js';

// Cooldown Management

/**
 * Cooldown durations by failure reason (in milliseconds)
 */
const COOLDOWN_DURATIONS: Record<FailoverReason, number> = {
  rate_limit: 60000, // 1 minute for rate limits
  billing: 300000, // 5 minutes for billing issues
  auth: 300000, // 5 minutes for auth issues (need user action)
  timeout: 30000, // 30 seconds for timeouts
  format: 0, // No cooldown for format errors (may be request-specific)
  unknown: 60000, // 1 minute for unknown errors
};

/**
 * In-memory provider cooldown tracking
 * Maps provider name to cooldown entry
 */
const providerCooldowns = new Map<string, ProviderCooldown>();

/**
 * Check if a provider is currently in cooldown
 */
export function isProviderInCooldown(provider: string): boolean {
  const cooldown = providerCooldowns.get(provider);
  if (!cooldown) return false;

  if (Date.now() >= cooldown.cooldownUntil) {
    // Cooldown expired, remove it
    providerCooldowns.delete(provider);
    return false;
  }

  return true;
}

/**
 * Get the remaining cooldown time for a provider
 */
export function getProviderCooldownRemaining(provider: string): number {
  const cooldown = providerCooldowns.get(provider);
  if (!cooldown) return 0;

  const remaining = cooldown.cooldownUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}

/**
 * Put a provider into cooldown
 */
export function setProviderCooldown(provider: string, reason: FailoverReason, error: string): void {
  const duration = COOLDOWN_DURATIONS[reason] || COOLDOWN_DURATIONS.unknown;
  if (duration === 0) return;

  providerCooldowns.set(provider, {
    provider,
    reason,
    cooldownUntil: Date.now() + duration,
    lastError: error,
  });

  logger.info('[ModelFallback] Provider put in cooldown', {
    provider,
    reason,
    durationMs: duration,
    error: error.substring(0, 100),
  });
}

/**
 * Clear cooldown for a provider (e.g., after successful request)
 */
export function clearProviderCooldown(provider: string): void {
  providerCooldowns.delete(provider);
}

/**
 * Get all providers currently in cooldown
 */
export function getProvidersInCooldown(): ProviderCooldown[] {
  const now = Date.now();
  const result: ProviderCooldown[] = [];

  for (const [provider, cooldown] of providerCooldowns.entries()) {
    if (now < cooldown.cooldownUntil) {
      result.push(cooldown);
    } else {
      providerCooldowns.delete(provider);
    }
  }

  return result;
}

// Model Candidate Resolution

/**
 * Model candidate for fallback
 */
interface ModelCandidate {
  provider: ProviderType;
  model: string;
}

/**
 * Default models for each provider
 */
const DEFAULT_MODELS: Partial<Record<ProviderType, string>> = {
  anthropic: 'claude-sonnet-4-5-20251014',
  openai: 'gpt-4.1',
  azure: 'default', // Uses configured deployment - not hardcoded
  google: 'gemini-2.5-pro-preview-05-06',
  groq: 'llama-3.3-70b-versatile',
  ollama: 'llama3.2',
  openrouter: 'anthropic/claude-3.5-sonnet',
  xai: 'grok-2',
  mistral: 'mistral-large-latest',
  cohere: 'command-r-plus',
  perplexity: 'llama-3.1-sonar-huge-128k-online',
  deepseek: 'deepseek-chat',
  together: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  cerebras: 'llama3.1-70b',
  fireworks: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
  copilot: 'gpt-4o',
  bedrock: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  zhipu: 'glm-4-plus',
  moonshot: 'moonshot-v1-32k',
  qwen: 'qwen-max',
  replicate: 'meta/llama-3.1-405b-instruct',
  'github-models': 'gpt-4o',
};

/**
 * Preferred fallback order for providers
 */
const FALLBACK_PROVIDER_ORDER: ProviderType[] = [
  'anthropic',
  'openai',
  'google',
  'azure',
  'bedrock',
  'groq',
  'openrouter',
  'mistral',
  'deepseek',
  'together',
  'xai',
  'zhipu',
  'moonshot',
  'qwen',
  'cohere',
  'perplexity',
  'fireworks',
  'cerebras',
  'replicate',
  'github-models',
  'ollama',
  'copilot',
];

/**
 * Model resolver function type
 * Returns the configured model for a provider, or undefined if not configured
 */
export type ModelResolver = (provider: ProviderType) => string | undefined;

/**
 * Build the list of model candidates for fallback
 */
export function buildFallbackCandidates(params: {
  primaryProvider: ProviderType;
  primaryModel: string;
  configuredProviders: ProviderType[];
  fallbackOverrides?: string[];
  /** Optional resolver to get provider-specific configured models */
  modelResolver?: ModelResolver;
}): ModelCandidate[] {
  const seen = new Set<string>();
  const candidates: ModelCandidate[] = [];

  const addCandidate = (provider: ProviderType, model: string) => {
    const key = `${provider}/${model}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ provider, model });
  };

  // 1. Add primary model first
  addCandidate(params.primaryProvider, params.primaryModel);

  // 2. If fallback overrides are provided, use those
  if (params.fallbackOverrides && params.fallbackOverrides.length > 0) {
    for (const fallback of params.fallbackOverrides) {
      const parts = fallback.split('/');
      if (parts.length === 2) {
        const [provider, model] = parts;
        if (params.configuredProviders.includes(provider as ProviderType)) {
          addCandidate(provider as ProviderType, model);
        }
      }
    }
    return candidates;
  }

  // 3. Add other configured providers in preferred order
  for (const provider of FALLBACK_PROVIDER_ORDER) {
    if (provider === params.primaryProvider) continue;
    if (!params.configuredProviders.includes(provider)) continue;

    // Use the resolver if provided (gets user's configured model for provider)
    // Otherwise fall back to hardcoded defaults
    const model = params.modelResolver?.(provider) || DEFAULT_MODELS[provider] || 'default';
    addCandidate(provider, model);
  }

  return candidates;
}

// Run With Model Fallback

/**
 * Run an operation with automatic model fallback.
 * Tries the primary provider first, then falls back to other providers on failure.
 *
 * @param params.primaryProvider - The primary provider to try first
 * @param params.primaryModel - The primary model to try first
 * @param params.configuredProviders - List of all configured/available providers
 * @param params.fallbackOverrides - Optional explicit fallback list (e.g., ["openai/gpt-4", "anthropic/claude-3"])
 * @param params.modelResolver - Optional resolver to get provider-specific configured models
 * @param params.run - The operation to run with provider and model
 * @param params.onError - Optional callback when an attempt fails
 * @returns Result with the successful provider/model and attempt history
 */
export async function runWithModelFallback<T>(params: {
  primaryProvider: ProviderType;
  primaryModel: string;
  configuredProviders: ProviderType[];
  fallbackOverrides?: string[];
  /** Resolver to get the configured model for a provider (e.g., Azure deployment name) */
  modelResolver?: ModelResolver;
  run: (provider: ProviderType, model: string) => Promise<T>;
  onError?: (attempt: {
    provider: ProviderType;
    model: string;
    error: unknown;
    attempt: number;
    total: number;
  }) => void | Promise<void>;
}): Promise<ModelFallbackResult<T>> {
  const candidates = buildFallbackCandidates({
    primaryProvider: params.primaryProvider,
    primaryModel: params.primaryModel,
    configuredProviders: params.configuredProviders,
    fallbackOverrides: params.fallbackOverrides,
    modelResolver: params.modelResolver,
  });

  const attempts: FallbackAttempt[] = [];
  let lastError: unknown;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];

    // Check if provider is in cooldown
    if (isProviderInCooldown(candidate.provider)) {
      const remaining = getProviderCooldownRemaining(candidate.provider);
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        error: `Provider ${candidate.provider} is in cooldown (${Math.ceil(remaining / 1000)}s remaining)`,
        reason: 'rate_limit',
        skippedDueToCooldown: true,
      });
      continue;
    }

    try {
      logger.debug('[ModelFallback] Trying candidate', {
        provider: candidate.provider,
        model: candidate.model,
        attempt: i + 1,
        total: candidates.length,
      });

      const result = await params.run(candidate.provider, candidate.model);

      // Success! Clear any cooldown for this provider
      clearProviderCooldown(candidate.provider);

      return {
        result,
        provider: candidate.provider,
        model: candidate.model,
        attempts,
      };
    } catch (err) {
      // Check if this is a user abort that shouldn't trigger fallback
      if (shouldRethrowWithoutFallback(err)) {
        throw err;
      }

      // Try to classify the error
      const normalized = coerceToFailoverError(err, {
        provider: candidate.provider,
        model: candidate.model,
      });

      // If we couldn't classify it as a failover error, it may be a code bug - rethrow
      if (!normalized && !isFailoverError(err)) {
        // Check if the error at least looks like a provider error
        const message = err instanceof Error ? err.message : String(err);
        const looksLikeProviderError =
          message.includes('API') ||
          message.includes('request') ||
          message.includes('connection') ||
          message.includes('timeout') ||
          message.includes('error');

        if (!looksLikeProviderError) {
          throw err;
        }
      }

      lastError = normalized || err;
      const described = describeFailoverError(lastError);

      // Record the attempt
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        error: described.message,
        reason: described.reason,
        status: described.status,
        code: described.code,
      });

      // Put provider in cooldown if appropriate
      if (described.reason) {
        setProviderCooldown(candidate.provider, described.reason, described.message);
      }

      // Notify about the error
      await params.onError?.({
        provider: candidate.provider,
        model: candidate.model,
        error: lastError,
        attempt: i + 1,
        total: candidates.length,
      });

      logger.warn('[ModelFallback] Attempt failed', {
        provider: candidate.provider,
        model: candidate.model,
        error: described.message,
        reason: described.reason,
        attempt: i + 1,
        total: candidates.length,
      });
    }
  }

  // All attempts failed
  if (attempts.length <= 1 && lastError) {
    // Single attempt, throw the original error
    throw lastError;
  }

  // Multiple attempts, create a summary error
  const summary =
    attempts.length > 0
      ? attempts
          .map(
            (attempt) =>
              `${attempt.provider}/${attempt.model}: ${attempt.error}${
                attempt.reason ? ` (${attempt.reason})` : ''
              }`
          )
          .join(' | ')
      : 'unknown';

  throw new FailoverError(`All ${attempts.length} providers failed: ${summary}`, {
    reason: 'unknown',
    cause: lastError instanceof Error ? lastError : undefined,
  });
}

/**
 * Convenience wrapper for simple fallback scenarios
 */
export async function runWithFallback<T>(params: {
  primary: { provider: ProviderType; model: string };
  fallbacks: Array<{ provider: ProviderType; model: string }>;
  run: (provider: ProviderType, model: string) => Promise<T>;
}): Promise<ModelFallbackResult<T>> {
  const allProviders = [params.primary, ...params.fallbacks].map((p) => p.provider);

  return runWithModelFallback({
    primaryProvider: params.primary.provider,
    primaryModel: params.primary.model,
    configuredProviders: [...new Set(allProviders)],
    fallbackOverrides: params.fallbacks.map((f) => `${f.provider}/${f.model}`),
    run: params.run,
  });
}

export { FailoverError, getUserFriendlyErrorMessage };
