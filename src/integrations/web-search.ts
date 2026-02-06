/**
 * Web Search Integration
 *
 * Multi-provider web search supporting:
 * - Brave Search API
 * - Serper (Google Search API)
 * - SearXNG (Self-hosted)
 * - Tavily (AI-optimized search)
 *
 * Following OpenClaw patterns for plugin/integration architecture.
 */

import { z } from 'zod';
import { logger } from '../utils/logger.js';

// Configuration Schema

export const WebSearchConfigSchema = z.object({
  enabled: z.boolean().default(true),
  provider: z.enum(['brave', 'serper', 'searxng', 'tavily']).default('brave'),

  // Brave Search
  brave: z
    .object({
      apiKey: z.string().optional(),
    })
    .optional(),

  // Serper (Google Search)
  serper: z
    .object({
      apiKey: z.string().optional(),
    })
    .optional(),

  // SearXNG (self-hosted)
  searxng: z
    .object({
      baseUrl: z.string().url().optional(),
      apiKey: z.string().optional(), // Optional auth
    })
    .optional(),

  // Tavily (AI search)
  tavily: z
    .object({
      apiKey: z.string().optional(),
    })
    .optional(),
});

export type WebSearchConfig = z.infer<typeof WebSearchConfigSchema>;

// Search Result Types

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  position?: number;
}

export interface WebSearchResponse {
  query: string;
  provider: string;
  results: SearchResult[];
  totalResults?: number;
  searchTime?: number;
}

interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
}

interface BraveSearchResponse {
  web?: {
    results?: BraveSearchResult[];
    count?: number;
  };
}

interface SerperSearchResult {
  title: string;
  link: string;
  snippet: string;
  position?: number;
}

interface SerperSearchResponse {
  organic?: SerperSearchResult[];
  searchParameters?: { timeUsed?: number };
}

interface SearxngSearchResult {
  title: string;
  url: string;
  content: string;
}

interface SearxngSearchResponse {
  results?: SearxngSearchResult[];
  number_of_results?: number;
  search_time?: number;
}

interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
}

interface TavilySearchResponse {
  results?: TavilySearchResult[];
}

// Provider Implementations

/**
 * Brave Search API
 * https://api.search.brave.com/
 */
async function searchBrave(
  query: string,
  apiKey: string,
  options: { count?: number } = {}
): Promise<WebSearchResponse> {
  const count = options.count ?? 10;

  const response = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`,
    {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Brave Search API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as BraveSearchResponse;

  return {
    query,
    provider: 'brave',
    results: (data.web?.results ?? []).map((r, i: number) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
      position: i + 1,
    })),
    totalResults: data.web?.count,
  };
}

/**
 * Serper API (Google Search)
 * https://serper.dev/
 */
async function searchSerper(
  query: string,
  apiKey: string,
  options: { count?: number } = {}
): Promise<WebSearchResponse> {
  const num = options.count ?? 10;

  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: query,
      num,
    }),
  });

  if (!response.ok) {
    throw new Error(`Serper API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as SerperSearchResponse;

  return {
    query,
    provider: 'serper',
    results: (data.organic ?? []).map((r, i: number) => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet,
      position: r.position ?? i + 1,
    })),
    searchTime: data.searchParameters?.timeUsed,
  };
}

/**
 * SearXNG (self-hosted metasearch)
 * https://docs.searxng.org/
 */
async function searchSearxng(
  query: string,
  baseUrl: string,
  options: { count?: number; apiKey?: string } = {}
): Promise<WebSearchResponse> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (options.apiKey) {
    headers['Authorization'] = `Bearer ${options.apiKey}`;
  }

  const response = await fetch(
    `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json&pageno=1`,
    { headers }
  );

  if (!response.ok) {
    throw new Error(`SearXNG error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as SearxngSearchResponse;

  return {
    query,
    provider: 'searxng',
    results: (data.results ?? []).slice(0, options.count ?? 10).map((r, i: number) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
      position: i + 1,
    })),
    totalResults: data.number_of_results,
    searchTime: data.search_time,
  };
}

/**
 * Tavily API (AI-optimized search)
 * https://tavily.com/
 */
async function searchTavily(
  query: string,
  apiKey: string,
  options: { count?: number } = {}
): Promise<WebSearchResponse> {
  const maxResults = options.count ?? 10;

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      include_answer: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as TavilySearchResponse;

  return {
    query,
    provider: 'tavily',
    results: (data.results ?? []).map((r, i: number) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
      position: i + 1,
    })),
  };
}

// Main Search Function

/**
 * Perform a web search using the configured provider
 */
export async function webSearch(
  query: string,
  config: WebSearchConfig,
  options: { count?: number } = {}
): Promise<WebSearchResponse> {
  const provider = config.provider;

  logger.debug(`[WebSearch] Searching with provider: ${provider}`, { component: 'WebSearch' });

  switch (provider) {
    case 'brave': {
      const apiKey = resolveApiKey(config.brave?.apiKey, 'BRAVE_API_KEY');
      if (!apiKey) {
        throw new Error(
          'Brave Search API key not configured. Set BRAVE_API_KEY env var or configure in settings.'
        );
      }
      return searchBrave(query, apiKey, options);
    }

    case 'serper': {
      const apiKey = resolveApiKey(config.serper?.apiKey, 'SERPER_API_KEY');
      if (!apiKey) {
        throw new Error(
          'Serper API key not configured. Set SERPER_API_KEY env var or configure in settings.'
        );
      }
      return searchSerper(query, apiKey, options);
    }

    case 'searxng': {
      const baseUrl = config.searxng?.baseUrl || process.env.SEARXNG_URL;
      if (!baseUrl) {
        throw new Error(
          'SearXNG URL not configured. Set SEARXNG_URL env var or configure in settings.'
        );
      }
      return searchSearxng(query, baseUrl, {
        count: options.count,
        apiKey: config.searxng?.apiKey,
      });
    }

    case 'tavily': {
      const apiKey = resolveApiKey(config.tavily?.apiKey, 'TAVILY_API_KEY');
      if (!apiKey) {
        throw new Error(
          'Tavily API key not configured. Set TAVILY_API_KEY env var or configure in settings.'
        );
      }
      return searchTavily(query, apiKey, options);
    }

    default:
      throw new Error(`Unknown search provider: ${provider}`);
  }
}

// Helpers

/**
 * Resolve API key from config or environment variable
 * Following OpenClaw's multi-source credential resolution pattern
 */
function resolveApiKey(configValue?: string, envVar?: string): string | undefined {
  // 1. Check config value
  const fromConfig = configValue?.trim() ?? '';
  if (fromConfig) return fromConfig;

  // 2. Fall back to environment variable
  if (envVar) {
    const fromEnv = process.env[envVar]?.trim() ?? '';
    if (fromEnv) return fromEnv;
  }

  return undefined;
}

/**
 * Check if web search is available (has valid config)
 */
export function isWebSearchAvailable(config?: WebSearchConfig): {
  available: boolean;
  provider?: string;
  reason?: string;
} {
  if (!config?.enabled) {
    return { available: false, reason: 'Web search is disabled in config' };
  }

  const provider = config.provider;

  switch (provider) {
    case 'brave':
      if (resolveApiKey(config.brave?.apiKey, 'BRAVE_API_KEY')) {
        return { available: true, provider: 'brave' };
      }
      return { available: false, reason: 'Brave API key not configured' };

    case 'serper':
      if (resolveApiKey(config.serper?.apiKey, 'SERPER_API_KEY')) {
        return { available: true, provider: 'serper' };
      }
      return { available: false, reason: 'Serper API key not configured' };

    case 'searxng':
      if (config.searxng?.baseUrl || process.env.SEARXNG_URL) {
        return { available: true, provider: 'searxng' };
      }
      return { available: false, reason: 'SearXNG URL not configured' };

    case 'tavily':
      if (resolveApiKey(config.tavily?.apiKey, 'TAVILY_API_KEY')) {
        return { available: true, provider: 'tavily' };
      }
      return { available: false, reason: 'Tavily API key not configured' };

    default:
      return { available: false, reason: `Unknown provider: ${provider}` };
  }
}

/**
 * Get default config from environment variables
 */
export function getDefaultWebSearchConfig(): WebSearchConfig {
  // Auto-detect provider from available env vars
  let provider: WebSearchConfig['provider'] = 'brave';

  if (process.env.SERPER_API_KEY) provider = 'serper';
  else if (process.env.TAVILY_API_KEY) provider = 'tavily';
  else if (process.env.SEARXNG_URL) provider = 'searxng';

  return {
    enabled: true,
    provider,
    brave: { apiKey: process.env.BRAVE_API_KEY },
    serper: { apiKey: process.env.SERPER_API_KEY },
    searxng: {
      baseUrl: process.env.SEARXNG_URL,
      apiKey: process.env.SEARXNG_API_KEY,
    },
    tavily: { apiKey: process.env.TAVILY_API_KEY },
  };
}
