/**
 * Tavily Search Provider
 *
 * AI-optimized search API with safety filtering.
 * https://tavily.com/
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

const TAVILY_API_URL = 'https://api.tavily.com/search';

class TavilyProvider implements SearchProvider {
  readonly metadata = TAVILY_DEFINITION.metadata;
  private apiKey: string;
  private includeRawContent: boolean;

  constructor(config: PluginConfig) {
    this.apiKey = config.credentials?.apiKey || '';
    this.includeRawContent = config.settings?.includeRawContent as boolean || false;
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResponse> {
    if (!this.apiKey) {
      throw new Error('Tavily API key not configured');
    }

    const startTime = Date.now();

    const body: Record<string, unknown> = {
      api_key: this.apiKey,
      query,
      max_results: options?.limit || 10,
      include_raw_content: this.includeRawContent,
      include_images: options?.includeImages || false,
    };

    if (options?.includeDomains?.length) {
      body.include_domains = options.includeDomains;
    }
    if (options?.excludeDomains?.length) {
      body.exclude_domains = options.excludeDomains;
    }

    const response = await fetch(TAVILY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Tavily API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as TavilyResponse;
    const searchTime = Date.now() - startTime;

    const results: SearchResult[] = (data.results || []).map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.content || '',
      source: 'tavily',
      score: item.score,
      metadata: {
        rawContent: item.raw_content,
      },
    }));

    return {
      results,
      query: data.query,
      searchTime,
      provider: 'tavily',
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

interface TavilyResponse {
  query: string;
  results?: Array<{
    title: string;
    url: string;
    content?: string;
    raw_content?: string;
    score?: number;
  }>;
}

export const TAVILY_DEFINITION: SearchPluginDefinition = {
  metadata: {
    id: 'tavily',
    name: 'Tavily',
    description: 'AI-optimized search with safety filtering - built for agents',
    category: 'search',
    icon: 'brain',
    version: '1.0.0',
    homepage: 'https://tavily.com',
    pricing: {
      type: 'credit-based',
      costPer1k: 8.0, // ~$0.008 per credit, 1 credit per search
      freeQuota: 1000,
    },
    rateLimit: {
      requestsPerMinute: 60,
    },
  },
  settingsSchema: {
    credentials: [
      {
        key: 'apiKey',
        type: 'password',
        label: 'API Key',
        description: 'Your Tavily API key',
        placeholder: 'tvly-...',
        required: true,
      },
    ],
    settings: [
      {
        key: 'includeRawContent',
        type: 'boolean',
        label: 'Include Raw Content',
        description: 'Include full page content in results (uses more credits)',
        default: false,
      },
      {
        key: 'searchDepth',
        type: 'select',
        label: 'Search Depth',
        description: 'Basic is faster, Advanced is more thorough',
        default: 'basic',
        options: [
          { value: 'basic', label: 'Basic (1 credit)' },
          { value: 'advanced', label: 'Advanced (2 credits)' },
        ],
      },
    ],
  },
  factory: (config: PluginConfig) => new TavilyProvider(config),
};
