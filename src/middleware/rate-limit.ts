import { type Context, type Next } from 'hono';

interface RateLimitConfig {
  windowMs: number;
  max: number;
  message?: string;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: 'Too many requests, please try again later.',
};

/**
 * Simple in-memory rate limiter
 */
export function rateLimit(config: Partial<RateLimitConfig> = {}) {
  const { windowMs, max, message } = { ...DEFAULT_CONFIG, ...config };
  const clients = new Map<string, { count: number; resetAt: number }>();

  return async (c: Context, next: Next) => {
    // Basic IP detection (Hono helper available in some runtimes)
    // For local dev it's fine, in prod behind proxy use headers
    const ip = c.req.header('x-forwarded-for') || 'anonymous';
    const now = Date.now();
    
    let client = clients.get(ip);
    
    if (!client || now > client.resetAt) {
      client = { count: 1, resetAt: now + windowMs };
      clients.set(ip, client);
    } else {
      client.count++;
    }
    
    // Set headers
    const remaining = Math.max(0, max - client.count);
    c.header('X-RateLimit-Limit', max.toString());
    c.header('X-RateLimit-Remaining', remaining.toString());
    c.header('X-RateLimit-Reset', Math.ceil(client.resetAt / 1000).toString());
    
    if (client.count > max) {
      return c.json({ error: 'Rate limit exceeded', message }, 429);
    }
    
    await next();
  };
}
