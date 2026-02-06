/**
 * Web Search Tool
 *
 * AI-accessible web search using configurable providers.
 * Supports: Brave, Serper, SearXNG, Tavily
 *
 * Following OpenClaw patterns for config-gated tools.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import {
  webSearch,
  isWebSearchAvailable,
  getDefaultWebSearchConfig,
  type WebSearchConfig,
  type WebSearchResponse,
} from '../../../integrations/web-search.js';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// Schema
// =============================================================================

const WebSearchParamsSchema = z.object({
  query: z.string().min(1).describe('Search query'),
  count: z.number().min(1).max(20).optional().describe('Number of results (1-20, default: 10)'),
});

export type WebSearchParams = z.infer<typeof WebSearchParamsSchema>;

// =============================================================================
// Tool Configuration
// =============================================================================

/**
 * Current web search configuration
 * Can be updated at runtime via integrations API
 */
let currentConfig: WebSearchConfig = getDefaultWebSearchConfig();

/**
 * Update the web search configuration
 */
export function setWebSearchConfig(config: WebSearchConfig): void {
  currentConfig = config;
  logger.info(`[WebSearch] Config updated, provider: ${config.provider}`);
}

/**
 * Get current web search configuration
 */
export function getWebSearchConfig(): WebSearchConfig {
  return currentConfig;
}

/**
 * Check if web search is currently available
 */
export function checkWebSearchAvailable(): { available: boolean; provider?: string; reason?: string } {
  return isWebSearchAvailable(currentConfig);
}

// =============================================================================
// Tool Definition
// =============================================================================

export const webSearchTool: ToolDefinition<WebSearchParams, WebSearchResult> = {
  name: 'web_search',
  description: `Search the web for information using the configured search provider.
Returns a list of relevant search results with titles, URLs, and snippets.
Use when you need current information, recent news, or to research topics.

Note: This tool requires a search API key to be configured in settings.`,
  category: 'web',
  securityLevel: 'safe',
  allowedHosts: ['gateway', 'local'],
  parameters: WebSearchParamsSchema,

  isAvailable() {
    const availability = isWebSearchAvailable(currentConfig);
    return {
      available: availability.available,
      reason: availability.reason,
    };
  },

  examples: [
    { description: 'Search for recent news', params: { query: 'latest AI developments 2024' } },
    { description: 'Research a topic', params: { query: 'how to implement OAuth2 in Node.js', count: 5 } },
    { description: 'Find documentation', params: { query: 'React useEffect cleanup function' } },
  ],

  async execute(context: ToolExecutionContext, params: WebSearchParams): Promise<ToolResult<WebSearchResult>> {
    const { signal } = context;

    // Check if web search is available
    const availability = isWebSearchAvailable(currentConfig);
    if (!availability.available) {
      return {
        success: false,
        error: {
          code: 'NOT_CONFIGURED',
          message: `Web search is not available: ${availability.reason}. Configure a search provider in Settings > Integrations.`,
        },
      };
    }

    try {
      logger.debug(`[WebSearch] Searching: "${params.query}" with ${availability.provider}`, {
        component: 'WebSearch',
      });

      // Perform search
      const response = await webSearch(params.query, currentConfig, {
        count: params.count ?? 10,
      });

      // Format results for output
      const output = formatSearchResults(response);

      const result: WebSearchResult = {
        query: response.query,
        provider: response.provider,
        results: response.results,
        totalResults: response.totalResults,
        searchTime: response.searchTime,
      };

      return {
        success: true,
        data: result,
        output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[WebSearch] Search failed: ${message}`, { component: 'WebSearch' });

      return {
        success: false,
        error: {
          code: 'SEARCH_FAILED',
          message: `Search failed: ${message}`,
          retryable: true,
        },
      };
    }
  },
};

// =============================================================================
// Helpers
// =============================================================================

/**
 * Format search results for human-readable output
 */
function formatSearchResults(response: WebSearchResponse): string {
  if (response.results.length === 0) {
    return `No results found for "${response.query}"`;
  }

  const header = `Found ${response.results.length} results for "${response.query}" (via ${response.provider}):\n\n`;

  const resultLines = response.results.map((r, i) => {
    const position = r.position ?? i + 1;
    return `${position}. **${r.title}**\n   ${r.url}\n   ${r.snippet}\n`;
  });

  return header + resultLines.join('\n');
}

// =============================================================================
// Types
// =============================================================================

export interface WebSearchResult {
  query: string;
  provider: string;
  results: Array<{
    title: string;
    url: string;
    snippet: string;
    position?: number;
  }>;
  totalResults?: number;
  searchTime?: number;
}
