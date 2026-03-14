import { type Context, type Next } from 'hono';

interface RateLimitConfig {
  /** Window duration in milliseconds */
  windowMs: number;
  /** Max requests per window per IP */
  maxRequests: number;
  /** Alias for maxRequests (backward compat) */
  max?: number;
  /** Custom error message */
  message?: string;
  /** Max tracked IPs before eviction (prevents memory leak) */
  maxClients?: number;
  /** Cleanup interval in milliseconds */
  cleanupIntervalMs?: number;
}

const DEFAULT_CONFIG: Required<Omit<RateLimitConfig, 'max'>> = {
  windowMs: 60 * 1000,
  maxRequests: 100,
  message: 'Too many requests, please try again later.',
  maxClients: 10000,
  cleanupIntervalMs: 60000,
};

interface SlidingWindowEntry {
  timestamps: number[];
}

/**
 * Sliding-window rate limiter middleware for Hono.
 *
 * Uses a sliding window (not fixed window) for accurate rate limiting.
 * Returns proper 429 with Retry-After and X-RateLimit-* headers.
 * Includes periodic cleanup and max client eviction to prevent memory leaks.
 */
export function rateLimit(config: Partial<RateLimitConfig> = {}) {
  // Support `max` as alias for `maxRequests` (backward compat)
  if (config.max !== undefined && config.maxRequests === undefined) {
    config.maxRequests = config.max;
  }
  const opts = { ...DEFAULT_CONFIG, ...config };
  const clients = new Map<string, SlidingWindowEntry>();
  let destroyed = false;

  // Periodic cleanup of expired entries
  const cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - opts.windowMs;
    for (const [ip, entry] of clients) {
      entry.timestamps = entry.timestamps.filter(t => t > cutoff);
      if (entry.timestamps.length === 0) {
        clients.delete(ip);
      }
    }

    // Evict oldest clients if exceeding max to bound memory
    if (clients.size > opts.maxClients) {
      const sorted = [...clients.entries()]
        .sort((a, b) => {
          const latestA = a[1].timestamps.length > 0 ? Math.max(...a[1].timestamps) : 0;
          const latestB = b[1].timestamps.length > 0 ? Math.max(...b[1].timestamps) : 0;
          return latestA - latestB;
        });
      const toRemove = sorted.slice(0, sorted.length - opts.maxClients);
      for (const [key] of toRemove) {
        clients.delete(key);
      }
    }
  }, opts.cleanupIntervalMs);

  const middleware = async (c: Context, next: Next) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      || c.req.header('x-real-ip')
      || 'anonymous';
    const now = Date.now();
    const cutoff = now - opts.windowMs;

    let entry = clients.get(ip);
    if (!entry) {
      entry = { timestamps: [] };
      clients.set(ip, entry);
    }

    // Remove expired timestamps (sliding window)
    entry.timestamps = entry.timestamps.filter(t => t > cutoff);

    // Calculate rate limit headers
    const currentCount = entry.timestamps.length;
    const remaining = Math.max(0, opts.maxRequests - currentCount);
    const resetAt = entry.timestamps.length > 0
      ? entry.timestamps[0] + opts.windowMs
      : now + opts.windowMs;

    c.header('X-RateLimit-Limit', opts.maxRequests.toString());
    c.header('X-RateLimit-Remaining', remaining.toString());
    c.header('X-RateLimit-Reset', Math.ceil(resetAt / 1000).toString());

    if (currentCount >= opts.maxRequests) {
      const retryAfter = Math.ceil((resetAt - now) / 1000);
      c.header('Retry-After', Math.max(1, retryAfter).toString());
      return c.json({
        error: 'Rate limit exceeded',
        message: opts.message,
        retryAfter: Math.max(1, retryAfter),
      }, 429);
    }

    // Record this request
    entry.timestamps.push(now);

    await next();
  };

  // Attach destroy method for graceful shutdown
  (middleware as RateLimitMiddleware).destroy = () => {
    if (!destroyed) {
      clearInterval(cleanupTimer);
      clients.clear();
      destroyed = true;
    }
  };

  return middleware as RateLimitMiddleware;
}

export interface RateLimitMiddleware {
  (c: Context, next: Next): Promise<Response | void>;
  destroy: () => void;
}
