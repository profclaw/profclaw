/**
 * Web Fetch Tool
 *
 * Fetch content from URLs with safety controls.
 * Supports various content types and HTML to markdown conversion.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import { getSsrfGuard } from '../../../security/ssrf-guard.js';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// Schema
// =============================================================================

const WebFetchParamsSchema = z.object({
  url: z.string().url().describe('URL to fetch'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional().default('GET'),
  headers: z.record(z.string()).optional().describe('Custom headers'),
  body: z.string().optional().describe('Request body for POST/PUT'),
  timeout: z.number().optional().describe('Timeout in seconds (default: 30)'),
  extractText: z.boolean().optional().describe('Extract text content from HTML'),
});

export type WebFetchParams = z.infer<typeof WebFetchParamsSchema>;

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_TIMEOUT_SEC = 30;
const MAX_CONTENT_LENGTH = 500_000; // 500KB
const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  '169.254.169.254', // AWS metadata
  'metadata.google.internal', // GCP metadata
]);

// =============================================================================
// Tool Definition
// =============================================================================

export const webFetchTool: ToolDefinition<WebFetchParams, WebFetchResult> = {
  name: 'web_fetch',
  description: `Fetch content from a URL. Returns the response body as text.
For HTML pages, can optionally extract readable text content.
Use for: reading documentation, fetching API responses, checking web content.`,
  category: 'web',
  securityLevel: 'moderate',
  allowedHosts: ['gateway', 'local'],
  parameters: WebFetchParamsSchema,
  examples: [
    { description: 'Fetch a webpage', params: { url: 'https://example.com', extractText: true } },
    { description: 'Fetch JSON API', params: { url: 'https://api.github.com/users/octocat' } },
  ],

  async execute(context: ToolExecutionContext, params: WebFetchParams): Promise<ToolResult<WebFetchResult>> {
    const { signal } = context;
    const timeoutMs = (params.timeout ?? DEFAULT_TIMEOUT_SEC) * 1000;

    // Validate URL
    let url: URL;
    try {
      url = new URL(params.url);
    } catch {
      return {
        success: false,
        error: {
          code: 'INVALID_URL',
          message: `Invalid URL: ${params.url}`,
        },
      };
    }

    // SSRF Guard (replaces legacy BLOCKED_HOSTS + isPrivateIP checks)
    const ssrfGuard = getSsrfGuard();
    if (ssrfGuard) {
      const ssrfResult = await ssrfGuard.validateUrl(params.url);
      if (!ssrfResult.allowed) {
        return {
          success: false,
          error: {
            code: 'SSRF_BLOCKED',
            message: ssrfResult.reason ?? 'URL blocked by SSRF guard',
          },
        };
      }
    } else {
      // Fallback: legacy checks when guard not initialized
      const hostname = normalizeHostname(url.hostname);
      if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith('.local')) {
        return {
          success: false,
          error: {
            code: 'BLOCKED_HOST',
            message: `Access to ${hostname} is not allowed`,
          },
        };
      }
      if (isPrivateIP(hostname)) {
        return {
          success: false,
          error: {
            code: 'PRIVATE_IP',
            message: 'Access to private IP addresses is not allowed',
          },
        };
      }
    }

    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      // Combine signals
      if (signal) {
        signal.addEventListener('abort', () => controller.abort());
      }

      logger.debug(`[WebFetch] Fetching: ${params.url}`, { component: 'WebFetch' });

      const response = await fetch(params.url, {
        method: params.method,
        headers: {
          'User-Agent': 'profClaw/1.0',
          Accept: 'text/html,application/json,text/plain,*/*',
          ...params.headers,
        },
        body: params.body,
        signal: controller.signal,
        redirect: 'follow',
      });

      clearTimeout(timeout);

      // Check content length
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > MAX_CONTENT_LENGTH) {
        return {
          success: false,
          error: {
            code: 'CONTENT_TOO_LARGE',
            message: `Response too large: ${contentLength} bytes (max: ${MAX_CONTENT_LENGTH})`,
          },
        };
      }

      // Get content type
      const contentType = response.headers.get('content-type') ?? 'text/plain';

      // Read body
      let body = await response.text();

      // Truncate if too large
      if (body.length > MAX_CONTENT_LENGTH) {
        body = body.slice(0, MAX_CONTENT_LENGTH) + '\n\n[...truncated...]';
      }

      // Extract text from HTML if requested
      if (params.extractText && contentType.includes('text/html')) {
        body = extractTextFromHtml(body);
      }

      const result: WebFetchResult = {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        contentType,
        body,
        url: response.url, // Final URL after redirects
      };

      return {
        success: response.ok,
        data: result,
        output: response.ok
          ? body
          : `HTTP ${response.status} ${response.statusText}\n\n${body}`,
        error: response.ok
          ? undefined
          : {
              code: 'HTTP_ERROR',
              message: `HTTP ${response.status} ${response.statusText}`,
            },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      if (message.includes('abort')) {
        return {
          success: false,
          error: {
            code: 'TIMEOUT',
            message: `Request timed out after ${params.timeout ?? DEFAULT_TIMEOUT_SEC}s`,
          },
        };
      }

      return {
        success: false,
        error: {
          code: 'FETCH_ERROR',
          message: `Failed to fetch: ${message}`,
        },
      };
    }
  },
};

// =============================================================================
// Helpers
// =============================================================================

function isPrivateIP(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);

  // Check for IPv4 private ranges
  const ipv4Match = normalized.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const [_, a, b] = ipv4Match.map(Number);
    // 10.x.x.x
    if (a === 10) return true;
    // 172.16.x.x - 172.31.x.x
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.x.x
    if (a === 192 && b === 168) return true;
  }

  // Check common IPv6 loopback, link-local, and unique local ranges
  const ipv6 = normalized.toLowerCase();
  if (ipv6 === '::1') return true;
  if (ipv6.startsWith('fc') || ipv6.startsWith('fd')) return true;
  if (ipv6.startsWith('fe8') || ipv6.startsWith('fe9') || ipv6.startsWith('fea') || ipv6.startsWith('feb')) {
    return true;
  }

  return false;
}

function normalizeHostname(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function extractTextFromHtml(html: string): string {
  // Simple HTML to text extraction
  const text = html
    // Remove scripts and styles
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Convert common elements
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    // Remove remaining HTML tags
    .replace(/<[^>]+>/g, '')
    // Decode common HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Clean up whitespace
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();

  return text;
}

// =============================================================================
// Types (exported for use in index.ts)
// =============================================================================

export interface WebFetchResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  contentType: string;
  body: string;
  url: string;
}
