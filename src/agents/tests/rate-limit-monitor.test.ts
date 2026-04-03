import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RateLimitMonitor, getRateLimitMonitor } from '../rate-limit-monitor.js';

describe('RateLimitMonitor', () => {
  let monitor: RateLimitMonitor;

  beforeEach(() => {
    monitor = new RateLimitMonitor();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // === updateFromHeaders ===

  describe('updateFromHeaders', () => {
    it('parses request and token limits from headers', () => {
      monitor.updateFromHeaders('anthropic', {
        'x-ratelimit-limit-requests': '1000',
        'x-ratelimit-remaining-requests': '800',
        'x-ratelimit-limit-tokens': '100000',
        'x-ratelimit-remaining-tokens': '70000',
      });

      const state = monitor.getState('anthropic');
      expect(state).toBeDefined();
      expect(state?.requestsLimit).toBe(1000);
      expect(state?.requestsUsed).toBe(200);
      expect(state?.tokensLimit).toBe(100000);
      expect(state?.tokensUsed).toBe(30000);
    });

    it('creates a new state entry on first call', () => {
      expect(monitor.getState('openai')).toBeUndefined();
      monitor.updateFromHeaders('openai', {
        'x-ratelimit-limit-requests': '500',
        'x-ratelimit-remaining-requests': '499',
      });
      expect(monitor.getState('openai')).toBeDefined();
    });

    it('accumulates usage across multiple calls', () => {
      monitor.updateFromHeaders('openai', {
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '90',
      });
      monitor.updateFromHeaders('openai', {
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '80',
      });

      const state = monitor.getState('openai');
      expect(state?.requestsUsed).toBe(20);
    });

    it('sets warningLevel to none when usage is below 75%', () => {
      monitor.updateFromHeaders('azure', {
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '30', // 70% used
      });
      expect(monitor.getState('azure')?.warningLevel).toBe('none');
    });

    it('sets warningLevel to info at 75% usage', () => {
      monitor.updateFromHeaders('azure', {
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '24', // 76% used
      });
      expect(monitor.getState('azure')?.warningLevel).toBe('info');
    });

    it('sets warningLevel to warning at 90% usage', () => {
      monitor.updateFromHeaders('azure', {
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '9', // 91% used
      });
      expect(monitor.getState('azure')?.warningLevel).toBe('warning');
    });

    it('sets warningLevel to critical at 95% usage', () => {
      monitor.updateFromHeaders('azure', {
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '4', // 96% used
      });
      expect(monitor.getState('azure')?.warningLevel).toBe('critical');
    });

    it('uses highest level between requests and tokens', () => {
      monitor.updateFromHeaders('anthropic', {
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '50',  // 50% — none
        'x-ratelimit-limit-tokens': '100000',
        'x-ratelimit-remaining-tokens': '3000',  // 97% — critical
      });
      expect(monitor.getState('anthropic')?.warningLevel).toBe('critical');
    });

    it('parses relative duration reset header (e.g. "1m30s")', () => {
      monitor.updateFromHeaders('openai', {
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '50',
        'x-ratelimit-reset-requests': '1m30s',
      });
      const state = monitor.getState('openai');
      const expectedResetAt = Date.now() + 90_000;
      expect(state?.resetAt).toBe(expectedResetAt);
    });

    it('parses epoch seconds reset header', () => {
      const futureEpoch = Math.floor(Date.now() / 1000) + 60;
      monitor.updateFromHeaders('openai', {
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '50',
        'x-ratelimit-reset-requests': String(futureEpoch),
      });
      const state = monitor.getState('openai');
      expect(state?.resetAt).toBe(futureEpoch * 1000);
    });

    it('picks the earliest reset time when both request and token resets are present', () => {
      const now = Date.now();
      monitor.updateFromHeaders('openai', {
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '50',
        'x-ratelimit-reset-requests': '30s',   // now + 30 000
        'x-ratelimit-reset-tokens': '2m',       // now + 120 000
      });
      const state = monitor.getState('openai');
      expect(state?.resetAt).toBe(now + 30_000);
    });

    it('ignores headers with missing limit values (cannot compute used)', () => {
      monitor.updateFromHeaders('google', {
        'x-ratelimit-remaining-requests': '50', // no limit header
      });
      const state = monitor.getState('google');
      expect(state?.requestsUsed).toBe(0);
      expect(state?.requestsLimit).toBeUndefined();
    });
  });

  // === getState ===

  describe('getState', () => {
    it('returns undefined for unknown providers', () => {
      expect(monitor.getState('unknown-provider')).toBeUndefined();
    });
  });

  // === shouldWarn ===

  describe('shouldWarn', () => {
    it('returns warn=false for providers with no state', () => {
      const result = monitor.shouldWarn('mystery');
      expect(result.warn).toBe(false);
      expect(result.level).toBe('none');
    });

    it('returns warn=false when warningLevel is none', () => {
      monitor.updateFromHeaders('ollama', {
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '50',
      });
      const result = monitor.shouldWarn('ollama');
      expect(result.warn).toBe(false);
    });

    it('returns warn=true with a message for info level', () => {
      monitor.updateFromHeaders('anthropic', {
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '20', // 80%
      });
      const result = monitor.shouldWarn('anthropic');
      expect(result.warn).toBe(true);
      expect(result.level).toBe('info');
      expect(result.message).toContain('anthropic');
      expect(result.message).toContain('80%');
    });

    it('returns warn=true with critical level message', () => {
      monitor.updateFromHeaders('azure', {
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '2', // 98%
      });
      const result = monitor.shouldWarn('azure');
      expect(result.warn).toBe(true);
      expect(result.level).toBe('critical');
      expect(result.message).toMatch(/critical/i);
    });

    it('includes time-to-reset in message when resetAt is set', () => {
      const resetAt = Date.now() + 90_000; // 90 s from now
      monitor.updateFromHeaders('openai', {
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '4', // 96%
        'x-ratelimit-reset-requests': '1m30s',
      });
      const result = monitor.shouldWarn('openai');
      expect(result.warn).toBe(true);
      // Should mention the reset time
      expect(result.message).toMatch(/resets in/i);
      void resetAt; // satisfy linter
    });
  });

  // === suggestAlternative ===

  describe('suggestAlternative', () => {
    it('returns undefined when warning level is below warning threshold', () => {
      monitor.updateFromHeaders('openai', {
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '30', // 70% — none
      });
      const suggestion = monitor.suggestAlternative('openai', ['ollama', 'anthropic']);
      expect(suggestion).toBeUndefined();
    });

    it('suggests an alternative provider when at warning level', () => {
      monitor.updateFromHeaders('azure', {
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '5', // 95% — critical
      });
      const suggestion = monitor.suggestAlternative('azure', ['ollama', 'anthropic', 'openai']);
      expect(suggestion).toBe('ollama'); // prefer local first
    });

    it('returns undefined when no other providers are available', () => {
      monitor.updateFromHeaders('openai', {
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '2',
      });
      const suggestion = monitor.suggestAlternative('openai', ['openai']);
      expect(suggestion).toBeUndefined();
    });

    it('prefers low-usage providers over high-usage ones', () => {
      // anthropic at 95%, ollama at 20%
      monitor.updateFromHeaders('anthropic', {
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '5', // 95% — primary hitting limit
      });
      monitor.updateFromHeaders('cerebras', {
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '2', // 98% — also stressed
      });
      // ollama has no state = 'none' level implicitly
      const suggestion = monitor.suggestAlternative('anthropic', ['cerebras', 'ollama']);
      expect(suggestion).toBe('ollama');
    });
  });

  // === getAll ===

  describe('getAll', () => {
    it('returns empty array when no providers tracked', () => {
      expect(monitor.getAll()).toEqual([]);
    });

    it('returns snapshots for all tracked providers', () => {
      monitor.updateFromHeaders('openai', {
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '90',
      });
      monitor.updateFromHeaders('anthropic', {
        'x-ratelimit-limit-requests': '200',
        'x-ratelimit-remaining-requests': '150',
      });

      const all = monitor.getAll();
      expect(all).toHaveLength(2);
      expect(all.map(s => s.provider)).toContain('openai');
      expect(all.map(s => s.provider)).toContain('anthropic');
    });

    it('returns copies, not live references', () => {
      monitor.updateFromHeaders('openai', {
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '90',
      });

      const [snapshot] = monitor.getAll();
      snapshot.requestsUsed = 9999;

      expect(monitor.getState('openai')?.requestsUsed).toBe(10);
    });
  });

  // === Singleton ===

  describe('getRateLimitMonitor', () => {
    it('returns the same instance on repeated calls', () => {
      const a = getRateLimitMonitor();
      const b = getRateLimitMonitor();
      expect(a).toBe(b);
    });
  });
});
