/**
 * Rate Limiter
 *
 * Enforces rate limits on tool executions per user, conversation, and tool.
 * Uses sliding window algorithm for accurate rate limiting.
 */

import { logger } from '../../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export interface RateLimitConfig {
  // Per-user limits
  userLimit: number;       // Max requests per user per window
  userWindowMs: number;    // Window duration for user limits

  // Per-conversation limits
  conversationLimit: number;
  conversationWindowMs: number;

  // Per-tool limits (overrides can be set per tool)
  defaultToolLimit: number;
  defaultToolWindowMs: number;

  // Global limits
  globalLimit: number;
  globalWindowMs: number;

  // Behavior
  enabled: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;        // Unix timestamp when limit resets
  retryAfter?: number;    // Seconds until retry is allowed
  limitType?: 'user' | 'conversation' | 'tool' | 'global';
}

interface WindowEntry {
  timestamps: number[];
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CONFIG: RateLimitConfig = {
  userLimit: 100,
  userWindowMs: 60_000,        // 100 per minute per user

  conversationLimit: 50,
  conversationWindowMs: 60_000, // 50 per minute per conversation

  defaultToolLimit: 30,
  defaultToolWindowMs: 60_000,  // 30 per minute per tool

  globalLimit: 500,
  globalWindowMs: 60_000,       // 500 per minute globally

  enabled: true,
};

const CLEANUP_INTERVAL_MS = 60_000;

// =============================================================================
// Rate Limiter
// =============================================================================

export class RateLimiter {
  private config: RateLimitConfig;
  private userWindows: Map<string, WindowEntry> = new Map();
  private conversationWindows: Map<string, WindowEntry> = new Map();
  private toolWindows: Map<string, WindowEntry> = new Map();
  private globalWindow: WindowEntry = { timestamps: [] };
  private toolOverrides: Map<string, { limit: number; windowMs: number }> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config?: Partial<RateLimitConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Start cleanup timer
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
  }

  /**
   * Check if a request is allowed and consume a token if so
   */
  check(context: {
    userId?: string;
    conversationId: string;
    toolName: string;
  }): RateLimitResult {
    if (!this.config.enabled) {
      return {
        allowed: true,
        limit: Infinity,
        remaining: Infinity,
        resetAt: Date.now(),
      };
    }

    const now = Date.now();

    // Check global limit first
    const globalResult = this.checkWindow(
      this.globalWindow,
      this.config.globalLimit,
      this.config.globalWindowMs,
      now,
    );
    if (!globalResult.allowed) {
      return { ...globalResult, limitType: 'global' };
    }

    // Check user limit
    if (context.userId) {
      const userKey = `user:${context.userId}`;
      let userWindow = this.userWindows.get(userKey);
      if (!userWindow) {
        userWindow = { timestamps: [] };
        this.userWindows.set(userKey, userWindow);
      }

      const userResult = this.checkWindow(
        userWindow,
        this.config.userLimit,
        this.config.userWindowMs,
        now,
      );
      if (!userResult.allowed) {
        return { ...userResult, limitType: 'user' };
      }
    }

    // Check conversation limit
    const convKey = `conv:${context.conversationId}`;
    let convWindow = this.conversationWindows.get(convKey);
    if (!convWindow) {
      convWindow = { timestamps: [] };
      this.conversationWindows.set(convKey, convWindow);
    }

    const convResult = this.checkWindow(
      convWindow,
      this.config.conversationLimit,
      this.config.conversationWindowMs,
      now,
    );
    if (!convResult.allowed) {
      return { ...convResult, limitType: 'conversation' };
    }

    // Check tool limit
    const toolKey = `tool:${context.toolName}`;
    let toolWindow = this.toolWindows.get(toolKey);
    if (!toolWindow) {
      toolWindow = { timestamps: [] };
      this.toolWindows.set(toolKey, toolWindow);
    }

    const toolOverride = this.toolOverrides.get(context.toolName);
    const toolLimit = toolOverride?.limit ?? this.config.defaultToolLimit;
    const toolWindowMs = toolOverride?.windowMs ?? this.config.defaultToolWindowMs;

    const toolResult = this.checkWindow(toolWindow, toolLimit, toolWindowMs, now);
    if (!toolResult.allowed) {
      return { ...toolResult, limitType: 'tool' };
    }

    // All checks passed - consume tokens
    this.globalWindow.timestamps.push(now);
    if (context.userId) {
      this.userWindows.get(`user:${context.userId}`)!.timestamps.push(now);
    }
    convWindow.timestamps.push(now);
    toolWindow.timestamps.push(now);

    // Return the most restrictive remaining count
    const remaining = Math.min(
      globalResult.remaining - 1,
      context.userId ? this.getRemainingForWindow(
        this.userWindows.get(`user:${context.userId}`)!,
        this.config.userLimit,
        this.config.userWindowMs,
        now,
      ) : Infinity,
      convResult.remaining - 1,
      toolResult.remaining - 1,
    );

    return {
      allowed: true,
      limit: Math.min(
        this.config.globalLimit,
        context.userId ? this.config.userLimit : Infinity,
        this.config.conversationLimit,
        toolLimit,
      ),
      remaining: Math.max(0, remaining),
      resetAt: Math.min(
        globalResult.resetAt,
        context.userId ? this.getResetTime(this.userWindows.get(`user:${context.userId}`)!, this.config.userWindowMs, now) : Infinity,
        convResult.resetAt,
        toolResult.resetAt,
      ),
    };
  }

  /**
   * Get current rate limit status without consuming a token
   */
  getStatus(context: {
    userId?: string;
    conversationId: string;
    toolName: string;
  }): RateLimitResult {
    if (!this.config.enabled) {
      return {
        allowed: true,
        limit: Infinity,
        remaining: Infinity,
        resetAt: Date.now(),
      };
    }

    const now = Date.now();

    const globalRemaining = this.getRemainingForWindow(
      this.globalWindow,
      this.config.globalLimit,
      this.config.globalWindowMs,
      now,
    );

    let userRemaining = Infinity;
    if (context.userId) {
      const userWindow = this.userWindows.get(`user:${context.userId}`);
      if (userWindow) {
        userRemaining = this.getRemainingForWindow(
          userWindow,
          this.config.userLimit,
          this.config.userWindowMs,
          now,
        );
      } else {
        userRemaining = this.config.userLimit;
      }
    }

    const convWindow = this.conversationWindows.get(`conv:${context.conversationId}`);
    const convRemaining = convWindow
      ? this.getRemainingForWindow(convWindow, this.config.conversationLimit, this.config.conversationWindowMs, now)
      : this.config.conversationLimit;

    const toolOverride = this.toolOverrides.get(context.toolName);
    const toolLimit = toolOverride?.limit ?? this.config.defaultToolLimit;
    const toolWindowMs = toolOverride?.windowMs ?? this.config.defaultToolWindowMs;
    const toolWindow = this.toolWindows.get(`tool:${context.toolName}`);
    const toolRemaining = toolWindow
      ? this.getRemainingForWindow(toolWindow, toolLimit, toolWindowMs, now)
      : toolLimit;

    const remaining = Math.min(globalRemaining, userRemaining, convRemaining, toolRemaining);

    return {
      allowed: remaining > 0,
      limit: Math.min(
        this.config.globalLimit,
        context.userId ? this.config.userLimit : Infinity,
        this.config.conversationLimit,
        toolLimit,
      ),
      remaining,
      resetAt: now + Math.min(
        this.config.globalWindowMs,
        context.userId ? this.config.userWindowMs : Infinity,
        this.config.conversationWindowMs,
        toolWindowMs,
      ),
    };
  }

  /**
   * Set tool-specific rate limit
   */
  setToolLimit(toolName: string, limit: number, windowMs?: number): void {
    this.toolOverrides.set(toolName, {
      limit,
      windowMs: windowMs ?? this.config.defaultToolWindowMs,
    });
    logger.info(`[RateLimit] Set tool limit: ${toolName} = ${limit}`, { component: 'RateLimiter' });
  }

  /**
   * Remove tool-specific rate limit
   */
  removeToolLimit(toolName: string): void {
    this.toolOverrides.delete(toolName);
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<RateLimitConfig>): void {
    this.config = { ...this.config, ...updates };
    logger.info('[RateLimit] Config updated', { component: 'RateLimiter', config: this.config });
  }

  /**
   * Get current configuration
   */
  getConfig(): RateLimitConfig {
    return { ...this.config };
  }

  /**
   * Reset all rate limit windows
   */
  reset(): void {
    this.userWindows.clear();
    this.conversationWindows.clear();
    this.toolWindows.clear();
    this.globalWindow.timestamps = [];
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private checkWindow(
    window: WindowEntry,
    limit: number,
    windowMs: number,
    now: number,
  ): RateLimitResult {
    // Remove expired timestamps
    const cutoff = now - windowMs;
    window.timestamps = window.timestamps.filter(t => t > cutoff);

    const remaining = limit - window.timestamps.length;
    const resetAt = window.timestamps.length > 0
      ? window.timestamps[0] + windowMs
      : now + windowMs;

    if (remaining <= 0) {
      const retryAfter = Math.ceil((resetAt - now) / 1000);
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAt,
        retryAfter: Math.max(1, retryAfter),
      };
    }

    return {
      allowed: true,
      limit,
      remaining,
      resetAt,
    };
  }

  private getRemainingForWindow(
    window: WindowEntry,
    limit: number,
    windowMs: number,
    now: number,
  ): number {
    const cutoff = now - windowMs;
    const validTimestamps = window.timestamps.filter(t => t > cutoff);
    return limit - validTimestamps.length;
  }

  private getResetTime(window: WindowEntry, windowMs: number, now: number): number {
    const cutoff = now - windowMs;
    const validTimestamps = window.timestamps.filter(t => t > cutoff);
    return validTimestamps.length > 0
      ? validTimestamps[0] + windowMs
      : now + windowMs;
  }

  private cleanup(): void {
    const now = Date.now();
    const maxWindowMs = Math.max(
      this.config.userWindowMs,
      this.config.conversationWindowMs,
      this.config.defaultToolWindowMs,
      this.config.globalWindowMs,
    );
    const cutoff = now - maxWindowMs;

    // Clean up user windows
    for (const [key, window] of this.userWindows) {
      window.timestamps = window.timestamps.filter(t => t > cutoff);
      if (window.timestamps.length === 0) {
        this.userWindows.delete(key);
      }
    }

    // Clean up conversation windows
    for (const [key, window] of this.conversationWindows) {
      window.timestamps = window.timestamps.filter(t => t > cutoff);
      if (window.timestamps.length === 0) {
        this.conversationWindows.delete(key);
      }
    }

    // Clean up tool windows
    for (const [key, window] of this.toolWindows) {
      window.timestamps = window.timestamps.filter(t => t > cutoff);
      if (window.timestamps.length === 0) {
        this.toolWindows.delete(key);
      }
    }

    // Clean up global window
    this.globalWindow.timestamps = this.globalWindow.timestamps.filter(t => t > cutoff);
  }
}

// =============================================================================
// Singleton
// =============================================================================

let rateLimiter: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (!rateLimiter) {
    rateLimiter = new RateLimiter();
  }
  return rateLimiter;
}

export function initRateLimiter(config?: Partial<RateLimitConfig>): RateLimiter {
  if (rateLimiter) {
    rateLimiter.destroy();
  }
  rateLimiter = new RateLimiter(config);
  return rateLimiter;
}
