/**
 * Error Recovery Advisor
 *
 * Analyzes API errors and returns an ordered list of recovery actions.
 * The caller drives the actual recovery; this module is purely advisory.
 */

// === Types ===

export interface RecoveryAction {
  type: 'retry' | 'switch_provider' | 'switch_model' | 'reduce_context' | 'wait' | 'abort';
  description: string;
  provider?: string;
  model?: string;
  waitMs?: number;
}

export interface ErrorInput {
  code?: string;
  message: string;
  provider: string;
  model: string;
  statusCode?: number;
}

export interface RecoveryContext {
  availableProviders: string[];
  retryCount: number;
  maxRetries: number;
}

// === Constants ===

const WAIT_RATE_LIMIT_MS = 10_000;   // 10 s initial back-off for 429
const WAIT_OVERLOADED_MS = 5_000;    // 5 s for 503
const WAIT_TIMEOUT_MS = 2_000;       // 2 s before retrying after timeout

// Provider preference for alternatives (local-first)
const PROVIDER_PREFERENCE = ['ollama', 'anthropic', 'openai', 'azure', 'google', 'cerebras'];

// === Helpers ===

function pickAlternativeProvider(current: string, available: string[]): string | undefined {
  return available
    .filter(p => p !== current)
    .sort((a, b) => PROVIDER_PREFERENCE.indexOf(a) - PROVIDER_PREFERENCE.indexOf(b))[0];
}

function containsAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some(n => lower.includes(n));
}

// === ErrorRecoveryAdvisor ===

export class ErrorRecoveryAdvisor {
  /**
   * Analyze an error and return an ordered list of recommended recovery actions.
   *
   * Rules applied (in priority order):
   *   401 / 403 → abort (auth errors cannot be retried)
   *   429 (rate limit) → wait + switch_provider (if available) + retry
   *   503 (server overloaded) → wait + retry
   *   400 (bad request) → reduce_context or switch_model
   *   ECONNREFUSED / ENOTFOUND → switch_provider
   *   timeout → wait briefly + retry with reduce_context hint
   *   context_length_exceeded → reduce_context + switch_model
   *   content filter → switch_model
   *   generic retry-eligible → retry (up to maxRetries)
   */
  advise(error: ErrorInput, context: RecoveryContext): RecoveryAction[] {
    const { statusCode, code, message, provider, model } = error;
    const { availableProviders, retryCount, maxRetries } = context;
    const actions: RecoveryAction[] = [];

    const msgLower = message.toLowerCase();
    const codeLower = (code ?? '').toLowerCase();

    // --- Auth errors: no recovery possible ---
    if (statusCode === 401 || statusCode === 403) {
      actions.push({
        type: 'abort',
        description: `Authentication failed for ${provider}. Check your API key or credentials.`,
      });
      return actions;
    }

    // --- Rate limit (429) ---
    if (statusCode === 429 || containsAny(msgLower, ['rate limit', 'too many requests', 'ratelimit'])) {
      const backOffMs = WAIT_RATE_LIMIT_MS * Math.pow(2, Math.min(retryCount, 3));
      actions.push({
        type: 'wait',
        description: `Rate limit hit on ${provider}. Waiting ${backOffMs / 1000}s before retry.`,
        waitMs: backOffMs,
      });

      const alternative = pickAlternativeProvider(provider, availableProviders);
      if (alternative) {
        actions.push({
          type: 'switch_provider',
          description: `Switch to ${alternative} to avoid rate limit on ${provider}.`,
          provider: alternative,
        });
      }

      if (retryCount < maxRetries) {
        actions.push({
          type: 'retry',
          description: `Retry request on ${provider} after waiting (attempt ${retryCount + 1}/${maxRetries}).`,
        });
      }
      return actions;
    }

    // --- Server overloaded (503) ---
    if (statusCode === 503 || containsAny(msgLower, ['overloaded', 'service unavailable', 'server error'])) {
      actions.push({
        type: 'wait',
        description: `${provider} is overloaded. Waiting ${WAIT_OVERLOADED_MS / 1000}s.`,
        waitMs: WAIT_OVERLOADED_MS,
      });
      if (retryCount < maxRetries) {
        actions.push({
          type: 'retry',
          description: `Retry on ${provider} after server overload (attempt ${retryCount + 1}/${maxRetries}).`,
        });
      }
      return actions;
    }

    // --- Context length exceeded ---
    if (
      containsAny(msgLower, ['context length', 'context_length_exceeded', 'maximum context', 'too long', 'token limit'])
      || codeLower === 'context_length_exceeded'
    ) {
      actions.push({
        type: 'reduce_context',
        description: 'Message is too long for the current model. Reduce context or summarize earlier turns.',
      });
      actions.push({
        type: 'switch_model',
        description: `Switch to a model with a larger context window than ${model}.`,
        model,
      });
      return actions;
    }

    // --- Content filter ---
    if (containsAny(msgLower, ['content filter', 'content_filter', 'safety', 'policy violation', 'blocked'])) {
      actions.push({
        type: 'switch_model',
        description: `Content was filtered by ${provider}. Try a different model with different safety settings.`,
        model,
      });
      actions.push({
        type: 'abort',
        description: 'If the issue persists, rephrase your request to avoid the content filter.',
      });
      return actions;
    }

    // --- Bad request (400) ---
    if (statusCode === 400) {
      actions.push({
        type: 'reduce_context',
        description: 'Request was malformed or too large. Try reducing context size.',
      });
      actions.push({
        type: 'switch_model',
        description: `The model ${model} may not support this request format. Try a different model.`,
        model,
      });
      return actions;
    }

    // --- Connection refused / DNS failure ---
    if (
      codeLower === 'econnrefused'
      || codeLower === 'enotfound'
      || containsAny(msgLower, ['econnrefused', 'enotfound', 'connection refused', 'network error'])
    ) {
      const alternative = pickAlternativeProvider(provider, availableProviders);
      if (alternative) {
        actions.push({
          type: 'switch_provider',
          description: `Cannot reach ${provider}. Switch to ${alternative}.`,
          provider: alternative,
        });
      } else {
        actions.push({
          type: 'abort',
          description: `Cannot reach ${provider} and no alternative providers are available.`,
        });
      }
      return actions;
    }

    // --- Timeout ---
    if (
      codeLower === 'etimedout'
      || codeLower === 'econnaborted'
      || containsAny(msgLower, ['timeout', 'timed out', 'request timeout'])
    ) {
      actions.push({
        type: 'wait',
        description: `Request timed out. Waiting ${WAIT_TIMEOUT_MS / 1000}s before retry.`,
        waitMs: WAIT_TIMEOUT_MS,
      });
      if (retryCount < maxRetries) {
        actions.push({
          type: 'retry',
          description: `Retry with a shorter prompt or context (attempt ${retryCount + 1}/${maxRetries}).`,
        });
        actions.push({
          type: 'reduce_context',
          description: 'Reducing context may help the request complete within the timeout.',
        });
      }
      return actions;
    }

    // --- Generic: retry if budget allows ---
    if (retryCount < maxRetries) {
      actions.push({
        type: 'retry',
        description: `Retry request (attempt ${retryCount + 1}/${maxRetries}).`,
      });
    } else {
      actions.push({
        type: 'abort',
        description: `Max retries (${maxRetries}) reached. Cannot recover automatically.`,
      });
    }

    return actions;
  }
}

// === Singleton ===

let _advisor: ErrorRecoveryAdvisor | undefined;

export function getErrorRecoveryAdvisor(): ErrorRecoveryAdvisor {
  if (!_advisor) {
    _advisor = new ErrorRecoveryAdvisor();
  }
  return _advisor;
}
