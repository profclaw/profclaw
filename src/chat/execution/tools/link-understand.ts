/**
 * Link Understand Tool
 *
 * Fetch a URL and use AI to summarize its content.
 * Returns title, summary, key points, and word count.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import { logger } from '../../../utils/logger.js';

// Schema

const LinkUnderstandParamsSchema = z.object({
  url: z.string().url().describe('URL to fetch and summarize'),
  question: z
    .string()
    .optional()
    .describe('Specific question to answer about the content (optional - general summary if omitted)'),
  maxLength: z
    .number()
    .int()
    .min(100)
    .max(10000)
    .optional()
    .default(2000)
    .describe('Maximum content length to process in characters (default: 2000)'),
});

export type LinkUnderstandParams = z.infer<typeof LinkUnderstandParamsSchema>;

// Types

export interface LinkUnderstandResult {
  url: string;
  title: string;
  summary: string;
  key_points: string[];
  word_count: number;
  question?: string;
  answer?: string;
}

// Constants

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_FETCH_BYTES = 500_000;
const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  '169.254.169.254',
  'metadata.google.internal',
]);

// Helpers

function extractTitleFromHtml(html: string): string {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : '';
}

function extractTextFromHtml(html: string, maxChars: number): string {
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text.length > maxChars ? text.slice(0, maxChars) + '\n\n[...content truncated...]' : text;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

function isPrivateHost(hostname: string): boolean {
  if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith('.local')) return true;
  const ipv4 = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return true;
  }
  return false;
}

/**
 * Use the AI provider to summarize content
 */
async function summarizeWithAI(
  url: string,
  content: string,
  question: string | undefined,
): Promise<{ title: string; summary: string; key_points: string[]; answer?: string }> {
  const { aiProvider } = await import('../../../providers/index.js');

  const prompt = question
    ? `You are analyzing the content of a webpage. Answer the specific question and provide a brief summary.

URL: ${url}
Question: ${question}

Content:
${content}

Respond in this exact JSON format:
{
  "title": "page title or inferred topic",
  "summary": "2-3 sentence summary of the page",
  "key_points": ["point 1", "point 2", "point 3"],
  "answer": "direct answer to the question"
}`
    : `You are analyzing the content of a webpage. Provide a structured summary.

URL: ${url}

Content:
${content}

Respond in this exact JSON format:
{
  "title": "page title or inferred topic",
  "summary": "2-3 sentence summary of the page",
  "key_points": ["point 1", "point 2", "point 3"]
}`;

  const response = await aiProvider.chat({
    messages: [{ id: 'link-understand-1', role: 'user', content: prompt, timestamp: new Date().toISOString() }],
    temperature: 0.3,
    maxTokens: 1024,
  });

  // Parse JSON response
  const jsonMatch = response.content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // Fallback: return raw response as summary
    return {
      title: '',
      summary: response.content.slice(0, 500),
      key_points: [],
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      title?: string;
      summary?: string;
      key_points?: string[];
      answer?: string;
    };
    return {
      title: typeof parsed.title === 'string' ? parsed.title : '',
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      key_points: Array.isArray(parsed.key_points)
        ? parsed.key_points.filter((p): p is string => typeof p === 'string')
        : [],
      answer: typeof parsed.answer === 'string' ? parsed.answer : undefined,
    };
  } catch {
    return {
      title: '',
      summary: response.content.slice(0, 500),
      key_points: [],
    };
  }
}

// Tool Definition

export const linkUnderstandTool: ToolDefinition<LinkUnderstandParams, LinkUnderstandResult> = {
  name: 'link_understand',
  description: `Fetch a URL and automatically summarize its content using AI.

Returns a structured summary including:
- Page title
- 2-3 sentence summary
- Key points / takeaways
- Word count

Optionally answer a specific question about the page content.

Use this to quickly understand articles, documentation, blog posts, or any
web page without reading the full content yourself.`,
  category: 'web',
  securityLevel: 'safe',
  requiresApproval: false,
  parameters: LinkUnderstandParamsSchema,

  isAvailable() {
    return { available: true };
  },

  examples: [
    {
      description: 'Summarize a webpage',
      params: { url: 'https://www.anthropic.com/news/claude-3-5-sonnet' },
    },
    {
      description: 'Answer a specific question about a page',
      params: {
        url: 'https://docs.react.dev/reference/react/useEffect',
        question: 'When should I use the cleanup function in useEffect?',
      },
    },
    {
      description: 'Summarize with larger content window',
      params: {
        url: 'https://blog.example.com/long-article',
        maxLength: 5000,
      },
    },
  ],

  async execute(context: ToolExecutionContext, params: LinkUnderstandParams): Promise<ToolResult<LinkUnderstandResult>> {
    // Validate URL
    let parsed: URL;
    try {
      parsed = new URL(params.url);
    } catch {
      return {
        success: false,
        error: { code: 'INVALID_URL', message: `Invalid URL: ${params.url}` },
      };
    }

    if (isPrivateHost(parsed.hostname)) {
      return {
        success: false,
        error: {
          code: 'BLOCKED_HOST',
          message: `Access to ${parsed.hostname} is not allowed for security reasons`,
        },
      };
    }

    logger.info(`[LinkUnderstand] Fetching: ${params.url}`, { component: 'LinkUnderstand' });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      if (context.signal) {
        context.signal.addEventListener('abort', () => controller.abort());
      }

      const response = await fetch(params.url, {
        headers: {
          'User-Agent': 'profClaw/1.0',
          Accept: 'text/html,application/json,text/plain,*/*',
        },
        signal: controller.signal,
        redirect: 'follow',
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          success: false,
          error: {
            code: 'FETCH_ERROR',
            message: `HTTP ${response.status} ${response.statusText} for ${params.url}`,
          },
        };
      }

      const contentType = response.headers.get('content-type') ?? 'text/plain';
      let rawBody = await response.text();

      if (rawBody.length > MAX_FETCH_BYTES) {
        rawBody = rawBody.slice(0, MAX_FETCH_BYTES);
      }

      // Extract title and text
      const htmlTitle = contentType.includes('text/html') ? extractTitleFromHtml(rawBody) : '';
      const textContent = contentType.includes('text/html')
        ? extractTextFromHtml(rawBody, params.maxLength ?? 2000)
        : rawBody.slice(0, params.maxLength ?? 2000);

      const wordCount = countWords(textContent);

      logger.debug(`[LinkUnderstand] Extracted ${wordCount} words, sending to AI`, {
        component: 'LinkUnderstand',
      });

      // Use AI to summarize
      const aiResult = await summarizeWithAI(params.url, textContent, params.question);

      const title = aiResult.title || htmlTitle || parsed.hostname;

      const result: LinkUnderstandResult = {
        url: response.url || params.url,
        title,
        summary: aiResult.summary,
        key_points: aiResult.key_points,
        word_count: wordCount,
        question: params.question,
        answer: aiResult.answer,
      };

      // Build output
      const lines = [
        `## ${title}\n`,
        `**URL**: ${result.url}`,
        `**Words**: ~${wordCount}`,
        '',
        '### Summary',
        result.summary,
      ];

      if (result.key_points.length > 0) {
        lines.push('', '### Key Points');
        for (const point of result.key_points) {
          lines.push(`- ${point}`);
        }
      }

      if (result.question && result.answer) {
        lines.push('', `### Answer: ${result.question}`);
        lines.push(result.answer);
      }

      return {
        success: true,
        data: result,
        output: lines.join('\n'),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      if (message.includes('abort') || message.includes('timeout')) {
        return {
          success: false,
          error: {
            code: 'TIMEOUT',
            message: `Request timed out for ${params.url}`,
          },
        };
      }

      logger.error(`[LinkUnderstand] Failed: ${message}`, { component: 'LinkUnderstand' });

      return {
        success: false,
        error: {
          code: 'LINK_UNDERSTAND_FAILED',
          message: `Failed to understand link: ${message}`,
          retryable: true,
        },
      };
    }
  },
};
