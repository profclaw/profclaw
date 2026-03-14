import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { RateLimiter, getRateLimiter, initRateLimiter } from '../rate-limiter.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    limiter?.destroy?.();
    vi.useRealTimers();
  });

  // ===========================================================================
  // Disabled limiter
  // ===========================================================================

  describe('disabled', () => {
    it('allows everything when disabled', () => {
      limiter = new RateLimiter({ enabled: false });

      const result = limiter.check({
        userId: 'user-1',
        conversationId: 'conv-1',
        toolName: 'exec',
      });

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(Infinity);
    });

    it('returns Infinity limit when disabled', () => {
      limiter = new RateLimiter({ enabled: false });
      const result = limiter.check({ conversationId: 'c1', toolName: 'exec' });
      expect(result.limit).toBe(Infinity);
    });

    it('getStatus also allows when disabled', () => {
      limiter = new RateLimiter({ enabled: false });
      const result = limiter.getStatus({ conversationId: 'c1', toolName: 'exec' });
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(Infinity);
    });
  });

  // ===========================================================================
  // Global limit
  // ===========================================================================

  describe('global limit', () => {
    it('enforces global rate limit', () => {
      limiter = new RateLimiter({
        enabled: true,
        globalLimit: 3,
        globalWindowMs: 60_000,
        userLimit: 1000,
        conversationLimit: 1000,
        defaultToolLimit: 1000,
      });

      const ctx = { userId: 'u1', conversationId: 'c1', toolName: 'exec' };

      expect(limiter.check(ctx).allowed).toBe(true);
      expect(limiter.check(ctx).allowed).toBe(true);
      expect(limiter.check(ctx).allowed).toBe(true);

      const fourth = limiter.check(ctx);
      expect(fourth.allowed).toBe(false);
      expect(fourth.limitType).toBe('global');
      expect(fourth.remaining).toBe(0);
    });

    it('resets after window expires', () => {
      limiter = new RateLimiter({
        enabled: true,
        globalLimit: 1,
        globalWindowMs: 10_000,
        userLimit: 1000,
        conversationLimit: 1000,
        defaultToolLimit: 1000,
      });

      const ctx = { userId: 'u1', conversationId: 'c1', toolName: 'exec' };

      expect(limiter.check(ctx).allowed).toBe(true);
      expect(limiter.check(ctx).allowed).toBe(false);

      // Advance past window
      vi.advanceTimersByTime(10_001);

      expect(limiter.check(ctx).allowed).toBe(true);
    });

    it('provides retryAfter on global limit exceeded', () => {
      limiter = new RateLimiter({
        enabled: true,
        globalLimit: 1,
        globalWindowMs: 30_000,
        userLimit: 1000,
        conversationLimit: 1000,
        defaultToolLimit: 1000,
      });

      const ctx = { conversationId: 'c1', toolName: 'exec' };
      limiter.check(ctx);
      const result = limiter.check(ctx);

      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // User limit
  // ===========================================================================

  describe('user limit', () => {
    it('enforces per-user rate limit', () => {
      limiter = new RateLimiter({
        enabled: true,
        userLimit: 2,
        userWindowMs: 60_000,
        globalLimit: 1000,
        conversationLimit: 1000,
        defaultToolLimit: 1000,
      });

      expect(limiter.check({ userId: 'u1', conversationId: 'c1', toolName: 'exec' }).allowed).toBe(true);
      expect(limiter.check({ userId: 'u1', conversationId: 'c1', toolName: 'exec' }).allowed).toBe(true);

      const third = limiter.check({ userId: 'u1', conversationId: 'c1', toolName: 'exec' });
      expect(third.allowed).toBe(false);
      expect(third.limitType).toBe('user');
    });

    it('tracks users independently', () => {
      limiter = new RateLimiter({
        enabled: true,
        userLimit: 1,
        userWindowMs: 60_000,
        globalLimit: 1000,
        conversationLimit: 1000,
        defaultToolLimit: 1000,
      });

      expect(limiter.check({ userId: 'u1', conversationId: 'c1', toolName: 'exec' }).allowed).toBe(true);
      expect(limiter.check({ userId: 'u2', conversationId: 'c1', toolName: 'exec' }).allowed).toBe(true);

      // u1 exhausted, u2 still fine
      expect(limiter.check({ userId: 'u1', conversationId: 'c1', toolName: 'exec' }).allowed).toBe(false);
    });

    it('resets per-user limit after window expires', () => {
      limiter = new RateLimiter({
        enabled: true,
        userLimit: 1,
        userWindowMs: 5_000,
        globalLimit: 1000,
        conversationLimit: 1000,
        defaultToolLimit: 1000,
      });

      const ctx = { userId: 'u1', conversationId: 'c1', toolName: 'exec' };
      expect(limiter.check(ctx).allowed).toBe(true);
      expect(limiter.check(ctx).allowed).toBe(false);

      vi.advanceTimersByTime(5_001);

      expect(limiter.check(ctx).allowed).toBe(true);
    });

    it('skips user check when userId is not provided', () => {
      limiter = new RateLimiter({
        enabled: true,
        userLimit: 1,
        userWindowMs: 60_000,
        globalLimit: 1000,
        conversationLimit: 1000,
        defaultToolLimit: 1000,
      });

      // No userId - should not be blocked by user limit
      expect(limiter.check({ conversationId: 'c1', toolName: 'exec' }).allowed).toBe(true);
      expect(limiter.check({ conversationId: 'c1', toolName: 'exec' }).allowed).toBe(true);
    });
  });

  // ===========================================================================
  // Conversation limit
  // ===========================================================================

  describe('conversation limit', () => {
    it('enforces per-conversation rate limit', () => {
      limiter = new RateLimiter({
        enabled: true,
        conversationLimit: 2,
        conversationWindowMs: 60_000,
        globalLimit: 1000,
        userLimit: 1000,
        defaultToolLimit: 1000,
      });

      expect(limiter.check({ conversationId: 'c1', toolName: 'exec' }).allowed).toBe(true);
      expect(limiter.check({ conversationId: 'c1', toolName: 'exec' }).allowed).toBe(true);

      const third = limiter.check({ conversationId: 'c1', toolName: 'exec' });
      expect(third.allowed).toBe(false);
      expect(third.limitType).toBe('conversation');
    });

    it('tracks conversations independently', () => {
      limiter = new RateLimiter({
        enabled: true,
        conversationLimit: 1,
        conversationWindowMs: 60_000,
        globalLimit: 1000,
        userLimit: 1000,
        defaultToolLimit: 1000,
      });

      expect(limiter.check({ conversationId: 'c1', toolName: 'exec' }).allowed).toBe(true);
      expect(limiter.check({ conversationId: 'c2', toolName: 'exec' }).allowed).toBe(true);
      expect(limiter.check({ conversationId: 'c1', toolName: 'exec' }).allowed).toBe(false);
    });

    it('resets conversation limit after window expires', () => {
      limiter = new RateLimiter({
        enabled: true,
        conversationLimit: 1,
        conversationWindowMs: 8_000,
        globalLimit: 1000,
        userLimit: 1000,
        defaultToolLimit: 1000,
      });

      const ctx = { conversationId: 'c1', toolName: 'exec' };
      expect(limiter.check(ctx).allowed).toBe(true);
      expect(limiter.check(ctx).allowed).toBe(false);

      vi.advanceTimersByTime(8_001);

      expect(limiter.check(ctx).allowed).toBe(true);
    });
  });

  // ===========================================================================
  // Tool limit
  // ===========================================================================

  describe('tool limit', () => {
    it('enforces per-tool rate limit', () => {
      limiter = new RateLimiter({
        enabled: true,
        defaultToolLimit: 2,
        defaultToolWindowMs: 60_000,
        globalLimit: 1000,
        userLimit: 1000,
        conversationLimit: 1000,
      });

      expect(limiter.check({ conversationId: 'c1', toolName: 'exec' }).allowed).toBe(true);
      expect(limiter.check({ conversationId: 'c1', toolName: 'exec' }).allowed).toBe(true);

      const third = limiter.check({ conversationId: 'c1', toolName: 'exec' });
      expect(third.allowed).toBe(false);
      expect(third.limitType).toBe('tool');
    });

    it('tracks tools independently', () => {
      limiter = new RateLimiter({
        enabled: true,
        defaultToolLimit: 1,
        defaultToolWindowMs: 60_000,
        globalLimit: 1000,
        userLimit: 1000,
        conversationLimit: 1000,
      });

      expect(limiter.check({ conversationId: 'c1', toolName: 'exec' }).allowed).toBe(true);
      expect(limiter.check({ conversationId: 'c1', toolName: 'file-ops' }).allowed).toBe(true);
      expect(limiter.check({ conversationId: 'c1', toolName: 'exec' }).allowed).toBe(false);
    });

    it('resets tool limit after window expires', () => {
      limiter = new RateLimiter({
        enabled: true,
        defaultToolLimit: 1,
        defaultToolWindowMs: 6_000,
        globalLimit: 1000,
        userLimit: 1000,
        conversationLimit: 1000,
      });

      const ctx = { conversationId: 'c1', toolName: 'exec' };
      expect(limiter.check(ctx).allowed).toBe(true);
      expect(limiter.check(ctx).allowed).toBe(false);

      vi.advanceTimersByTime(6_001);

      expect(limiter.check(ctx).allowed).toBe(true);
    });
  });

  // ===========================================================================
  // Tool overrides
  // ===========================================================================

  describe('tool overrides', () => {
    it('uses custom limit for specific tools', () => {
      limiter = new RateLimiter({
        enabled: true,
        defaultToolLimit: 10,
        defaultToolWindowMs: 60_000,
        globalLimit: 1000,
        userLimit: 1000,
        conversationLimit: 1000,
      });

      limiter.setToolLimit('dangerous-tool', 1, 60_000);

      expect(limiter.check({ conversationId: 'c1', toolName: 'dangerous-tool' }).allowed).toBe(true);
      expect(limiter.check({ conversationId: 'c1', toolName: 'dangerous-tool' }).allowed).toBe(false);

      // Default tools still have higher limit
      expect(limiter.check({ conversationId: 'c1', toolName: 'exec' }).allowed).toBe(true);
    });

    it('removing a tool override restores the default limit', () => {
      limiter = new RateLimiter({
        enabled: true,
        defaultToolLimit: 5,
        defaultToolWindowMs: 60_000,
        globalLimit: 1000,
        userLimit: 1000,
        conversationLimit: 1000,
      });

      limiter.setToolLimit('risky-tool', 1, 60_000);
      expect(limiter.check({ conversationId: 'c1', toolName: 'risky-tool' }).allowed).toBe(true);
      expect(limiter.check({ conversationId: 'c1', toolName: 'risky-tool' }).allowed).toBe(false);

      // After removing the override the tool gets new window via reset
      limiter.reset();
      limiter.removeToolLimit('risky-tool');

      // Now 5 calls should be allowed (default limit)
      for (let i = 0; i < 5; i++) {
        expect(limiter.check({ conversationId: 'c1', toolName: 'risky-tool' }).allowed).toBe(true);
      }
      expect(limiter.check({ conversationId: 'c1', toolName: 'risky-tool' }).allowed).toBe(false);
    });

    it('setToolLimit without windowMs uses default window', () => {
      limiter = new RateLimiter({
        enabled: true,
        defaultToolLimit: 10,
        defaultToolWindowMs: 60_000,
        globalLimit: 1000,
        userLimit: 1000,
        conversationLimit: 1000,
      });

      // setToolLimit with only 2 args - windowMs should fall back to defaultToolWindowMs
      limiter.setToolLimit('custom-tool', 2);
      expect(limiter.check({ conversationId: 'c1', toolName: 'custom-tool' }).allowed).toBe(true);
      expect(limiter.check({ conversationId: 'c1', toolName: 'custom-tool' }).allowed).toBe(true);
      expect(limiter.check({ conversationId: 'c1', toolName: 'custom-tool' }).allowed).toBe(false);
    });
  });

  // ===========================================================================
  // Result fields
  // ===========================================================================

  describe('result fields', () => {
    it('returns resetAt in the future', () => {
      limiter = new RateLimiter({
        enabled: true,
        globalLimit: 1,
        globalWindowMs: 30_000,
        userLimit: 1000,
        conversationLimit: 1000,
        defaultToolLimit: 1000,
      });

      limiter.check({ conversationId: 'c1', toolName: 'exec' });
      const result = limiter.check({ conversationId: 'c1', toolName: 'exec' });

      expect(result.allowed).toBe(false);
      expect(result.resetAt).toBeGreaterThan(Date.now());
    });

    it('returns remaining count', () => {
      limiter = new RateLimiter({
        enabled: true,
        globalLimit: 3,
        globalWindowMs: 60_000,
        userLimit: 1000,
        conversationLimit: 1000,
        defaultToolLimit: 1000,
      });

      const first = limiter.check({ conversationId: 'c1', toolName: 'exec' });
      expect(first.remaining).toBe(2);

      const second = limiter.check({ conversationId: 'c1', toolName: 'exec' });
      expect(second.remaining).toBe(1);
    });

    it('returns retryAfter >= 1 when denied', () => {
      limiter = new RateLimiter({
        enabled: true,
        globalLimit: 1,
        globalWindowMs: 60_000,
        userLimit: 1000,
        conversationLimit: 1000,
        defaultToolLimit: 1000,
      });

      limiter.check({ conversationId: 'c1', toolName: 'exec' });
      const denied = limiter.check({ conversationId: 'c1', toolName: 'exec' });

      expect(denied.retryAfter).toBeGreaterThanOrEqual(1);
    });
  });

  // ===========================================================================
  // getStatus (non-consuming peek)
  // ===========================================================================

  describe('getStatus', () => {
    it('does not consume a token', () => {
      limiter = new RateLimiter({
        enabled: true,
        globalLimit: 2,
        globalWindowMs: 60_000,
        userLimit: 1000,
        conversationLimit: 1000,
        defaultToolLimit: 1000,
      });

      const ctx = { conversationId: 'c1', toolName: 'exec' };

      limiter.getStatus(ctx);
      limiter.getStatus(ctx);
      limiter.getStatus(ctx);

      // All tokens should still be available
      expect(limiter.check(ctx).allowed).toBe(true);
      expect(limiter.check(ctx).allowed).toBe(true);
      expect(limiter.check(ctx).allowed).toBe(false);
    });

    it('reflects current status after consuming tokens', () => {
      limiter = new RateLimiter({
        enabled: true,
        globalLimit: 3,
        globalWindowMs: 60_000,
        userLimit: 1000,
        conversationLimit: 1000,
        defaultToolLimit: 1000,
      });

      const ctx = { conversationId: 'c1', toolName: 'exec' };

      limiter.check(ctx);
      limiter.check(ctx);

      const status = limiter.getStatus(ctx);
      expect(status.allowed).toBe(true);
      expect(status.remaining).toBe(1);
    });

    it('shows not allowed when limit exhausted', () => {
      limiter = new RateLimiter({
        enabled: true,
        globalLimit: 1,
        globalWindowMs: 60_000,
        userLimit: 1000,
        conversationLimit: 1000,
        defaultToolLimit: 1000,
      });

      const ctx = { conversationId: 'c1', toolName: 'exec' };
      limiter.check(ctx);

      const status = limiter.getStatus(ctx);
      expect(status.allowed).toBe(false);
      expect(status.remaining).toBe(0);
    });
  });

  // ===========================================================================
  // updateConfig
  // ===========================================================================

  describe('updateConfig', () => {
    it('reflects new config immediately', () => {
      limiter = new RateLimiter({
        enabled: true,
        globalLimit: 1,
        globalWindowMs: 60_000,
        userLimit: 1000,
        conversationLimit: 1000,
        defaultToolLimit: 1000,
      });

      const ctx = { conversationId: 'c1', toolName: 'exec' };
      expect(limiter.check(ctx).allowed).toBe(true);
      expect(limiter.check(ctx).allowed).toBe(false);

      // Raise limit and reset
      limiter.updateConfig({ globalLimit: 100 });
      limiter.reset();

      // Now 100 are allowed
      for (let i = 0; i < 5; i++) {
        expect(limiter.check(ctx).allowed).toBe(true);
      }
    });

    it('getConfig returns a copy of current config', () => {
      limiter = new RateLimiter({ enabled: true, globalLimit: 42, userLimit: 10, conversationLimit: 10, defaultToolLimit: 10 });
      const cfg = limiter.getConfig();
      expect(cfg.globalLimit).toBe(42);
      // Mutating the returned object should not affect internal state
      cfg.globalLimit = 999;
      expect(limiter.getConfig().globalLimit).toBe(42);
    });
  });

  // ===========================================================================
  // reset
  // ===========================================================================

  describe('reset', () => {
    it('clears all windows and allows requests again', () => {
      limiter = new RateLimiter({
        enabled: true,
        globalLimit: 1,
        globalWindowMs: 60_000,
        userLimit: 1,
        userWindowMs: 60_000,
        conversationLimit: 1,
        conversationWindowMs: 60_000,
        defaultToolLimit: 1,
        defaultToolWindowMs: 60_000,
      });

      const ctx = { userId: 'u1', conversationId: 'c1', toolName: 'exec' };
      limiter.check(ctx);
      expect(limiter.check(ctx).allowed).toBe(false);

      limiter.reset();
      expect(limiter.check(ctx).allowed).toBe(true);
    });
  });

  // ===========================================================================
  // Sliding window cleanup
  // ===========================================================================

  describe('cleanup', () => {
    it('cleans up expired timestamps', () => {
      limiter = new RateLimiter({
        enabled: true,
        globalLimit: 1000,
        globalWindowMs: 10_000,
        userLimit: 1,
        userWindowMs: 10_000,
        conversationLimit: 1000,
        defaultToolLimit: 1000,
      });

      // Exhaust user limit
      expect(limiter.check({ userId: 'u1', conversationId: 'c1', toolName: 'exec' }).allowed).toBe(true);
      expect(limiter.check({ userId: 'u1', conversationId: 'c1', toolName: 'exec' }).allowed).toBe(false);

      // Advance past window + cleanup interval
      vi.advanceTimersByTime(70_000);

      // Should be allowed again after cleanup
      expect(limiter.check({ userId: 'u1', conversationId: 'c1', toolName: 'exec' }).allowed).toBe(true);
    });

    it('sliding window allows new requests as old ones expire', () => {
      limiter = new RateLimiter({
        enabled: true,
        globalLimit: 2,
        globalWindowMs: 10_000,
        userLimit: 1000,
        conversationLimit: 1000,
        defaultToolLimit: 1000,
      });

      const ctx = { conversationId: 'c1', toolName: 'exec' };

      // Consume both slots at t=0
      limiter.check(ctx); // t=0
      limiter.check(ctx); // t=0
      expect(limiter.check(ctx).allowed).toBe(false); // limit hit

      // Advance 5 seconds - first slot not yet expired (window is 10s)
      vi.advanceTimersByTime(5_000);
      expect(limiter.check(ctx).allowed).toBe(false);

      // Advance past the full window
      vi.advanceTimersByTime(5_001);
      expect(limiter.check(ctx).allowed).toBe(true);
    });

    it('concurrent rapid requests are correctly tracked', () => {
      limiter = new RateLimiter({
        enabled: true,
        globalLimit: 5,
        globalWindowMs: 60_000,
        userLimit: 1000,
        conversationLimit: 1000,
        defaultToolLimit: 1000,
      });

      const ctx = { conversationId: 'c1', toolName: 'exec' };
      const results = Array.from({ length: 7 }, () => limiter.check(ctx));

      const allowed = results.filter(r => r.allowed).length;
      const denied = results.filter(r => !r.allowed).length;

      expect(allowed).toBe(5);
      expect(denied).toBe(2);
    });
  });

  // ===========================================================================
  // Burst behavior - multiple limit types interacting
  // ===========================================================================

  describe('burst limit interaction', () => {
    it('most restrictive limit takes precedence', () => {
      limiter = new RateLimiter({
        enabled: true,
        globalLimit: 100,
        globalWindowMs: 60_000,
        userLimit: 100,
        userWindowMs: 60_000,
        conversationLimit: 3,      // most restrictive
        conversationWindowMs: 60_000,
        defaultToolLimit: 100,
        defaultToolWindowMs: 60_000,
      });

      const ctx = { userId: 'u1', conversationId: 'c1', toolName: 'exec' };
      for (let i = 0; i < 3; i++) {
        expect(limiter.check(ctx).allowed).toBe(true);
      }

      const blocked = limiter.check(ctx);
      expect(blocked.allowed).toBe(false);
      expect(blocked.limitType).toBe('conversation');
    });

    it('different users sharing same conversation are both affected by conversation limit', () => {
      limiter = new RateLimiter({
        enabled: true,
        globalLimit: 1000,
        globalWindowMs: 60_000,
        userLimit: 1000,
        userWindowMs: 60_000,
        conversationLimit: 2,
        conversationWindowMs: 60_000,
        defaultToolLimit: 1000,
        defaultToolWindowMs: 60_000,
      });

      expect(limiter.check({ userId: 'u1', conversationId: 'shared', toolName: 'exec' }).allowed).toBe(true);
      expect(limiter.check({ userId: 'u2', conversationId: 'shared', toolName: 'exec' }).allowed).toBe(true);
      // shared conversation limit exhausted regardless of user
      expect(limiter.check({ userId: 'u1', conversationId: 'shared', toolName: 'exec' }).allowed).toBe(false);
      expect(limiter.check({ userId: 'u2', conversationId: 'shared', toolName: 'exec' }).allowed).toBe(false);
    });
  });

  // ===========================================================================
  // Singleton helpers
  // ===========================================================================

  describe('getRateLimiter / initRateLimiter', () => {
    afterEach(() => {
      // Re-init to a fresh default to avoid polluting other tests
      initRateLimiter({ enabled: false });
    });

    it('getRateLimiter returns the same instance on repeated calls', () => {
      const a = getRateLimiter();
      const b = getRateLimiter();
      expect(a).toBe(b);
    });

    it('initRateLimiter replaces the singleton', () => {
      const original = getRateLimiter();
      const fresh = initRateLimiter({ enabled: false });
      expect(fresh).not.toBe(original);
      expect(getRateLimiter()).toBe(fresh);
    });

    it('initRateLimiter destroys old timer before replacing', () => {
      const first = initRateLimiter({ enabled: true });
      // Should not throw - timer on first instance must be cleaned up
      expect(() => initRateLimiter({ enabled: true })).not.toThrow();
      first.destroy(); // idempotent
    });
  });
});
