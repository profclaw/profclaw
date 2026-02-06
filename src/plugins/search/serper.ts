/**
 * Serper Search Provider
 *
 * Fast and cost-effective Google Search API.
 * https://serper.dev/
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

const SERPER_API_URL = 'https://google.serper.dev/search';

class SerperProvider implements SearchProvider {
  readonly metadata = SERPER_DEFINITION.metadata;
  private apiKey: string;
  private baseUrl: string;

  constructor(config: PluginConfig) {
    this.apiKey = config.credentials?.apiKey || '';
    this.baseUrl = config.credentials?.baseUrl || SERPER_API_URL;
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResponse> {
    if (!this.apiKey) {
      throw new Error('Serper API key not configured');
    }

    const startTime = Date.now();

    const body: Record<string, unknown> = {
      q: query,
      num: options?.limit || 10,
    };

    if (options?.language) body.hl = options.language;
    if (options?.region) body.gl = options.region;

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'X-API-KEY': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Serper API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as SerperResponse;
    const searchTime = Date.now() - startTime;

    const results: SearchResult[] = (data.organic || []).map((item) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet || '',
      date: item.date,
      source: 'serper',
      metadata: {
        position: item.position,
        sitelinks: item.sitelinks,
      },
    }));

    return {
      results,
      query,
      totalResults: data.searchParameters?.totalResults,
      searchTime,
      provider: 'serper',
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

// Types for Serper API response
interface SerperResponse {
  searchParameters?: {
    q: string;
    totalResults?: number;
  };
  organic?: Array<{
    title: string;
    link: string;
    snippet?: string;
    date?: string;
    position?: number;
    sitelinks?: Array<{ title: string; link: string }>;
  }>;
}

// Plugin Definition
export const SERPER_DEFINITION: SearchPluginDefinition = {
  metadata: {
    id: 'serper',
    name: 'Serper',
    description: 'Fast Google Search API - cost-effective at scale',
    category: 'search',
    icon: 'search',
    version: '1.0.0',
    homepage: 'https://serper.dev',
    pricing: {
      type: 'paid',
      costPer1k: 1.0, // $1 per 1000 queries at starter tier
      freeQuota: 100, // 100 free queries
    },
    rateLimit: {
      requestsPerSecond: 300,
    },
  },
  settingsSchema: {
    credentials: [
      {
        key: 'apiKey',
        type: 'password',
        label: 'API Key',
        description: 'Your Serper API key from serper.dev',
        placeholder: 'Enter your Serper API key',
        required: true,
      },
    ],
    settings: [
      {
        key: 'defaultLimit',
        type: 'number',
        label: 'Default Results',
        description: 'Default number of results to return',
        default: 10,
        validation: { min: 1, max: 100 },
      },
    ],
  },
  factory: (config: PluginConfig) => new SerperProvider(config),
};
