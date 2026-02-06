/**
 * Brave Search Provider
 *
 * Privacy-focused search with independent index.
 * https://brave.com/search/api/
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

const BRAVE_API_URL = 'https://api.search.brave.com/res/v1/web/search';

class BraveProvider implements SearchProvider {
  readonly metadata = BRAVE_DEFINITION.metadata;
  private apiKey: string;
  private safeSearch: 'off' | 'moderate' | 'strict';

  constructor(config: PluginConfig) {
    this.apiKey = config.credentials?.apiKey || '';
    this.safeSearch = (config.settings?.safeSearch as 'off' | 'moderate' | 'strict') || 'moderate';
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResponse> {
    if (!this.apiKey) {
      throw new Error('Brave Search API key not configured');
    }

    const startTime = Date.now();

    const params = new URLSearchParams({
      q: query,
      count: String(options?.limit || 10),
      safesearch: this.safeSearch,
    });

    if (options?.language) params.set('search_lang', options.language);
    if (options?.region) params.set('country', options.region);
    if (options?.freshness) {
      const freshnessMap: Record<string, string> = {
        day: 'pd',
        week: 'pw',
        month: 'pm',
        year: 'py',
      };
      params.set('freshness', freshnessMap[options.freshness] || '');
    }

    const response = await fetch(`${BRAVE_API_URL}?${params}`, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': this.apiKey,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Brave Search API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as BraveResponse;
    const searchTime = Date.now() - startTime;

    const results: SearchResult[] = (data.web?.results || []).map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.description || '',
      date: item.age,
      source: 'brave',
      favicon: item.profile?.img,
      metadata: {
        language: item.language,
        familyFriendly: item.family_friendly,
        extraSnippets: item.extra_snippets,
      },
    }));

    return {
      results,
      query: data.query?.original || query,
      totalResults: data.web?.total_results,
      searchTime,
      provider: 'brave',
    };
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async healthCheck(): Promise<PluginHealth> {
    if (!this.apiKey) {
      return {
        healthy: false,
        lastCheck: new Date(),
        errorMessage: 'API key not configured',
      };
    }

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

interface BraveResponse {
  query?: {
    original: string;
  };
  web?: {
    total_results?: number;
    results?: Array<{
      title: string;
      url: string;
      description?: string;
      age?: string;
      language?: string;
      family_friendly?: boolean;
      extra_snippets?: string[];
      profile?: {
        name?: string;
        img?: string;
      };
    }>;
  };
}

export const BRAVE_DEFINITION: SearchPluginDefinition = {
  metadata: {
    id: 'brave',
    name: 'Brave Search',
    description: 'Privacy-first search with independent index - great for enterprise',
    category: 'search',
    icon: 'shield-check',
    version: '1.0.0',
    homepage: 'https://brave.com/search/api/',
    pricing: {
      type: 'freemium',
      costPer1k: 3.0,
      freeQuota: 2000, // 2000 free queries/month
    },
    rateLimit: {
      requestsPerSecond: 1, // Free tier
      requestsPerMinute: 15, // Free tier
    },
  },
  settingsSchema: {
    credentials: [
      {
        key: 'apiKey',
        type: 'password',
        label: 'API Key',
        description: 'Your Brave Search API key',
        placeholder: 'BSA...',
        required: true,
      },
    ],
    settings: [
      {
        key: 'safeSearch',
        type: 'select',
        label: 'Safe Search',
        description: 'Content filtering level',
        default: 'moderate',
        options: [
          { value: 'off', label: 'Off' },
          { value: 'moderate', label: 'Moderate' },
          { value: 'strict', label: 'Strict' },
        ],
      },
      {
        key: 'useGoggles',
        type: 'boolean',
        label: 'Use Goggles',
        description: 'Enable custom result re-ranking with Brave Goggles',
        default: false,
      },
    ],
  },
  factory: (config: PluginConfig) => new BraveProvider(config),
};
