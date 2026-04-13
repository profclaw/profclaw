/**
 * Content Filter Middleware
 *
 * Optional profanity/content moderation for chat endpoints.
 * Activate with CONTENT_FILTER=true in .env.
 * Skipped in pico mode to preserve memory footprint.
 */

import { type Context, type Next } from 'hono';
import { logger } from '../utils/logger.js';
import { getMode } from '../core/deployment.js';

// Lazy-loaded to avoid paying startup cost when filter is disabled
let filterInstance: import('glin-profanity').Filter | null = null;

async function getFilter(): Promise<import('glin-profanity').Filter> {
  if (!filterInstance) {
    const { Filter } = await import('glin-profanity');
    filterInstance = new Filter();
  }
  return filterInstance;
}

/**
 * Hono middleware that checks POST body for profanity on chat send endpoints.
 *
 * Conditions for enforcement:
 *  - CONTENT_FILTER=true env var is set
 *  - Deployment mode is mini or pro (skipped for pico)
 *  - Request method is POST
 *  - Body has a `message` or `content` string field
 *
 * On flagged content returns 400 { error, flagged: true }.
 * On clean content calls next().
 */
export function contentFilter() {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const enabled = process.env.CONTENT_FILTER?.toLowerCase() === 'true';
    if (!enabled) return next();

    const mode = getMode();
    if (mode === 'pico') return next();

    if (c.req.method !== 'POST') return next();

    let text: string | undefined;
    try {
      const body = await c.req.json() as Record<string, unknown>;
      if (typeof body.message === 'string') {
        text = body.message;
      } else if (typeof body.content === 'string') {
        text = body.content;
      }
    } catch {
      // Unparseable body — let the handler deal with it
      return next();
    }

    if (!text) return next();

    const filter = await getFilter();
    const result = filter.checkProfanity(text);

    if (result.containsProfanity) {
      logger.warn('Content filter flagged message', {
        profaneWords: result.profaneWords,
        path: c.req.path,
      });
      return c.json(
        { error: 'Message flagged by content filter', flagged: true },
        400,
      );
    }

    return next();
  };
}
