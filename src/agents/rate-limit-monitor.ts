/**
 * Rate Limit Monitor
 *
 * Tracks API rate limit state per provider by parsing standard x-ratelimit-*
 * response headers. Surfaces warnings when usage thresholds are reached and
 * can suggest alternative providers when limits are critical.
 */

// === Types ===

export interface RateLimitState {
  provider: string;
  model: string;
  requestsUsed: number;
  requestsLimit?: number;
  tokensUsed: number;
  tokensLimit?: number;
  /** Unix timestamp (ms) when limits reset */
  resetAt?: number;
  warningLevel: 'none' | 'info' | 'warning' | 'critical';
}

export interface WarnResult {
  warn: boolean;
  message: string;
  level: RateLimitState['warningLevel'];
}

// === Constants ===

const THRESHOLD_INFO = 0.75;
const THRESHOLD_WARNING = 0.90;
const THRESHOLD_CRITICAL = 0.95;

// Provider preference order for suggesting alternatives (prefer local)
const PROVIDER_PREFERENCE = ['ollama', 'anthropic', 'openai', 'azure', 'google', 'cerebras'];

function defaultState(provider: string): RateLimitState {
  return {
    provider,
    model: 'unknown',
    requestsUsed: 0,
    tokensUsed: 0,
    warningLevel: 'none',
  };
}

/**
 * Parse a reset timestamp header value.
 * Accepts either a Unix timestamp (seconds) or a relative duration like "1m30s".
 */
function parseResetHeader(value: string): number | undefined {
  const trimmed = value.trim();

  // ISO 8601 / epoch seconds (pure number)
  const asNumber = Number(trimmed);
  if (!isNaN(asNumber) && asNumber > 0) {
    // If it looks like seconds since epoch (> year 2000), treat as epoch seconds
    if (asNumber > 1_000_000_000) {
      return asNumber * 1000; // convert to ms
    }
    // Otherwise treat as seconds from now
    return Date.now() + asNumber * 1000;
  }

  // Relative duration: e.g. "1m30s", "45s", "2m"
  const durationMatch = trimmed.match(/^(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/);
  if (durationMatch) {
    const minutes = parseInt(durationMatch[1] ?? '0', 10);
    const seconds = parseFloat(durationMatch[2] ?? '0');
    const totalMs = (minutes * 60 + seconds) * 1000;
    if (totalMs > 0) {
      return Date.now() + totalMs;
    }
  }

  return undefined;
}

function computeWarningLevel(used: number, limit: number): RateLimitState['warningLevel'] {
  const ratio = used / limit;
  if (ratio >= THRESHOLD_CRITICAL) return 'critical';
  if (ratio >= THRESHOLD_WARNING) return 'warning';
  if (ratio >= THRESHOLD_INFO) return 'info';
  return 'none';
}

// === RateLimitMonitor ===

export class RateLimitMonitor {
  private states: Map<string, RateLimitState>;

  constructor() {
    this.states = new Map();
  }

  /**
   * Update rate limit state from API response headers.
   * Parses the standard x-ratelimit-* header set used by OpenAI-compatible APIs
   * and Anthropic:
   *   x-ratelimit-limit-requests
   *   x-ratelimit-remaining-requests
   *   x-ratelimit-limit-tokens
   *   x-ratelimit-remaining-tokens
   *   x-ratelimit-reset-requests
   *   x-ratelimit-reset-tokens
   */
  updateFromHeaders(provider: string, headers: Record<string, string>): void {
    const state = this.getOrCreate(provider);

    const limitRequests = headers['x-ratelimit-limit-requests'];
    const remainingRequests = headers['x-ratelimit-remaining-requests'];
    const limitTokens = headers['x-ratelimit-limit-tokens'];
    const remainingTokens = headers['x-ratelimit-remaining-tokens'];
    const resetRequests = headers['x-ratelimit-reset-requests'];
    const resetTokens = headers['x-ratelimit-reset-tokens'];

    if (limitRequests !== undefined) {
      state.requestsLimit = parseInt(limitRequests, 10);
    }
    if (remainingRequests !== undefined && state.requestsLimit !== undefined) {
      const remaining = parseInt(remainingRequests, 10);
      state.requestsUsed = state.requestsLimit - remaining;
    }

    if (limitTokens !== undefined) {
      state.tokensLimit = parseInt(limitTokens, 10);
    }
    if (remainingTokens !== undefined && state.tokensLimit !== undefined) {
      const remaining = parseInt(remainingTokens, 10);
      state.tokensUsed = state.tokensLimit - remaining;
    }

    // Pick the earliest reset timestamp if both are present
    const resetMs = [resetRequests, resetTokens]
      .filter((v): v is string => v !== undefined)
      .map(parseResetHeader)
      .filter((v): v is number => v !== undefined)
      .sort((a, b) => a - b)[0];

    if (resetMs !== undefined) {
      state.resetAt = resetMs;
    }

    // Recalculate warning level — use whichever ratio is higher
    let highestLevel: RateLimitState['warningLevel'] = 'none';

    if (state.requestsLimit && state.requestsLimit > 0) {
      const reqLevel = computeWarningLevel(state.requestsUsed, state.requestsLimit);
      if (levelIndex(reqLevel) > levelIndex(highestLevel)) {
        highestLevel = reqLevel;
      }
    }
    if (state.tokensLimit && state.tokensLimit > 0) {
      const tokLevel = computeWarningLevel(state.tokensUsed, state.tokensLimit);
      if (levelIndex(tokLevel) > levelIndex(highestLevel)) {
        highestLevel = tokLevel;
      }
    }

    state.warningLevel = highestLevel;
  }

  /** Get current rate limit state for a provider. */
  getState(provider: string): RateLimitState | undefined {
    return this.states.get(provider);
  }

  /**
   * Check whether the user should be warned about rate limit usage.
   * Returns the highest-severity warning across requests and tokens.
   */
  shouldWarn(provider: string): WarnResult {
    const state = this.states.get(provider);
    if (!state || state.warningLevel === 'none') {
      return { warn: false, message: '', level: 'none' };
    }

    const parts: string[] = [];

    if (state.requestsLimit && state.requestsLimit > 0) {
      const pct = Math.round((state.requestsUsed / state.requestsLimit) * 100);
      parts.push(`${pct}% of request quota used`);
    }
    if (state.tokensLimit && state.tokensLimit > 0) {
      const pct = Math.round((state.tokensUsed / state.tokensLimit) * 100);
      parts.push(`${pct}% of token quota used`);
    }

    let resetNote = '';
    if (state.resetAt) {
      const remainMs = state.resetAt - Date.now();
      if (remainMs > 0) {
        const remainSec = Math.ceil(remainMs / 1000);
        const mins = Math.floor(remainSec / 60);
        const secs = remainSec % 60;
        resetNote = mins > 0
          ? ` (resets in ${mins}m ${secs}s)`
          : ` (resets in ${secs}s)`;
      }
    }

    const prefix = state.warningLevel === 'critical'
      ? 'Rate limit critical'
      : state.warningLevel === 'warning'
        ? 'Approaching rate limit'
        : 'Rate limit notice';

    const message = `${prefix} [${provider}]: ${parts.join(', ')}${resetNote}`;

    return {
      warn: true,
      message,
      level: state.warningLevel,
    };
  }

  /**
   * Suggest an alternative provider when the given provider is at a high usage level.
   * Returns undefined if no switch is recommended.
   */
  suggestAlternative(provider: string, availableProviders: string[]): string | undefined {
    const state = this.states.get(provider);
    if (!state || levelIndex(state.warningLevel) < levelIndex('warning')) {
      return undefined;
    }

    // Find a provider with no warning or lower warning level
    const candidates = availableProviders
      .filter(p => p !== provider)
      .sort((a, b) => {
        // Prefer low-warning providers first, then follow preference order
        const aLevel = levelIndex(this.states.get(a)?.warningLevel ?? 'none');
        const bLevel = levelIndex(this.states.get(b)?.warningLevel ?? 'none');
        if (aLevel !== bLevel) return aLevel - bLevel;
        return PROVIDER_PREFERENCE.indexOf(a) - PROVIDER_PREFERENCE.indexOf(b);
      });

    return candidates[0];
  }

  /** Return a snapshot of all tracked provider states. */
  getAll(): RateLimitState[] {
    return Array.from(this.states.values()).map(s => ({ ...s }));
  }

  // Private helpers

  private getOrCreate(provider: string): RateLimitState {
    let state = this.states.get(provider);
    if (!state) {
      state = defaultState(provider);
      this.states.set(provider, state);
    }
    return state;
  }
}

// Numeric ordering of warning levels (for comparison)
function levelIndex(level: RateLimitState['warningLevel']): number {
  switch (level) {
    case 'none':     return 0;
    case 'info':     return 1;
    case 'warning':  return 2;
    case 'critical': return 3;
  }
}

// === Singleton ===

let _monitor: RateLimitMonitor | undefined;

export function getRateLimitMonitor(): RateLimitMonitor {
  if (!_monitor) {
    _monitor = new RateLimitMonitor();
  }
  return _monitor;
}
