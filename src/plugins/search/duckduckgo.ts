/**
 * DuckDuckGo Search Provider
 *
 * Free, privacy-focused search - great for fallback.
 * Note: Uses the instant answer API, not official search API.
 */

import type {
  SearchProvider,
  SearchOptions,
  SearchResponse,
  SearchResult,
  PluginConfig,
  PluginHealth,
  SearchPluginDefinition,
} from '../types.js';

// DuckDuckGo HTML search endpoint (no official API)
const DDG_SEARCH_URL = 'https://html.duckduckgo.com/html/';

class DuckDuckGoProvider implements SearchProvider {
  readonly metadata = DUCKDUCKGO_DEFINITION.metadata;
  private safeSearch: boolean;

  constructor(config: PluginConfig) {
    this.safeSearch = config.settings?.safeSearch as boolean ?? true;
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResponse> {
    const startTime = Date.now();
    const limit = options?.limit || 10;

    // Use DuckDuckGo HTML endpoint with form data
    const formData = new URLSearchParams();
    formData.append('q', query);
    formData.append('kl', options?.region || 'wt-wt'); // Region
    if (this.safeSearch || options?.safeSearch) {
      formData.append('kp', '1'); // Safe search on
    }

    const response = await fetch(DDG_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'GLINR-TaskManager/1.0',
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo search failed: ${response.status}`);
    }

    const html = await response.text();
    const results = this.parseResults(html, limit);
    const searchTime = Date.now() - startTime;

    return {
      results,
      query,
      searchTime,
      provider: 'duckduckgo',
    };
  }

  private parseResults(html: string, limit: number): SearchResult[] {
    const results: SearchResult[] = [];

    // Simple regex parsing for DuckDuckGo HTML results
    // Match result blocks
    const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([^<]*)/g;

    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < limit) {
      const [, url, title, snippet] = match;
      if (url && title) {
        // DuckDuckGo wraps URLs, extract the actual URL
        const actualUrl = this.extractUrl(url);
        results.push({
          title: this.decodeHtml(title.trim()),
          url: actualUrl,
          snippet: this.decodeHtml(snippet?.trim() || ''),
          source: 'duckduckgo',
        });
      }
    }

    // Fallback: Try simpler pattern if main regex didn't match
    if (results.length === 0) {
      const linkRegex = /<a[^>]*class="[^"]*result__url[^"]*"[^>]*href="([^"]*)"[^>]*>.*?<\/a>[\s\S]*?<h2[^>]*class="[^"]*result__title[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]*)<\/a>/g;

      while ((match = linkRegex.exec(html)) !== null && results.length < limit) {
        const [, url, title] = match;
        if (url && title) {
          results.push({
            title: this.decodeHtml(title.trim()),
            url: this.extractUrl(url),
            snippet: '',
            source: 'duckduckgo',
          });
        }
      }
    }

    return results;
  }

  private extractUrl(wrappedUrl: string): string {
    // DuckDuckGo wraps URLs like: //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com
    if (wrappedUrl.includes('uddg=')) {
      const match = wrappedUrl.match(/uddg=([^&]*)/);
      if (match) {
        return decodeURIComponent(match[1]);
      }
    }
    // Return as-is if not wrapped
    return wrappedUrl.startsWith('//') ? `https:${wrappedUrl}` : wrappedUrl;
  }

  private decodeHtml(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]*>/g, ''); // Strip any remaining HTML tags
  }

  async isAvailable(): Promise<boolean> {
    // DuckDuckGo is always available (no API key needed)
    return true;
  }

  async healthCheck(): Promise<PluginHealth> {
    try {
      const startTime = Date.now();
      await this.search('test', { limit: 1 });
      const latency = Date.now() - startTime;

      return {
        healthy: true,
        lastCheck: new Date(),
        latency,
      };
    } catch (error) {
      return {
        healthy: false,
        lastCheck: new Date(),
        errorMessage: error instanceof Error ? error.message : 'Health check failed',
      };
    }
  }
}

export const DUCKDUCKGO_DEFINITION: SearchPluginDefinition = {
  metadata: {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    description: 'Privacy-focused search - free, no API key required',
    category: 'search',
    icon: 'shield',
    version: '1.0.0',
    homepage: 'https://duckduckgo.com',
    pricing: {
      type: 'free',
    },
    rateLimit: {
      requestsPerSecond: 1, // Be nice to DuckDuckGo
      requestsPerMinute: 30,
    },
  },
  settingsSchema: {
    credentials: [], // No credentials needed
    settings: [
      {
        key: 'safeSearch',
        type: 'boolean',
        label: 'Safe Search',
        description: 'Filter explicit content from results',
        default: true,
      },
      {
        key: 'region',
        type: 'select',
        label: 'Region',
        description: 'Search region preference',
        default: 'wt-wt',
        options: [
          { value: 'wt-wt', label: 'No region (worldwide)' },
          { value: 'us-en', label: 'United States' },
          { value: 'uk-en', label: 'United Kingdom' },
          { value: 'de-de', label: 'Germany' },
          { value: 'fr-fr', label: 'France' },
        ],
      },
    ],
  },
  factory: (config: PluginConfig) => new DuckDuckGoProvider(config),
};
