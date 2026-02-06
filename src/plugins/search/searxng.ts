/**
 * SearXNG Search Provider
 *
 * Self-hosted metasearch engine - complete privacy control.
 * https://docs.searxng.org/
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

class SearXNGProvider implements SearchProvider {
  readonly metadata = SEARXNG_DEFINITION.metadata;
  private baseUrl: string;
  private engines: string[];

  constructor(config: PluginConfig) {
    this.baseUrl = config.credentials?.baseUrl || 'http://localhost:8080';
    this.engines = (config.settings?.engines as string[]) || [];
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResponse> {
    if (!this.baseUrl) {
      throw new Error('SearXNG base URL not configured');
    }

    const startTime = Date.now();

    const params = new URLSearchParams({
      q: query,
      format: 'json',
    });

    if (options?.limit) params.set('pageno', '1'); // SearXNG uses pagination
    if (options?.language) params.set('language', options.language);
    if (options?.safeSearch) params.set('safesearch', '2'); // 0=off, 1=moderate, 2=strict
    if (this.engines.length > 0) {
      params.set('engines', this.engines.join(','));
    }

    const url = `${this.baseUrl.replace(/\/$/, '')}/search?${params}`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`SearXNG error: ${response.status} - ${error}`);
    }

    const data = await response.json() as SearXNGResponse;
    const searchTime = Date.now() - startTime;

    const limit = options?.limit || 10;
    const results: SearchResult[] = (data.results || []).slice(0, limit).map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.content || '',
      source: 'searxng',
      metadata: {
        engine: item.engine,
        engines: item.engines,
        category: item.category,
        score: item.score,
        publishedDate: item.publishedDate,
      },
    }));

    return {
      results,
      query: data.query || query,
      totalResults: data.number_of_results,
      searchTime,
      provider: 'searxng',
    };
  }

  async isAvailable(): Promise<boolean> {
    if (!this.baseUrl) return false;

    try {
      const response = await fetch(`${this.baseUrl}/config`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async healthCheck(): Promise<PluginHealth> {
    if (!this.baseUrl) {
      return {
        healthy: false,
        lastCheck: new Date(),
        errorMessage: 'Base URL not configured',
      };
    }

    try {
      const startTime = Date.now();
      const response = await fetch(`${this.baseUrl}/config`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return {
          healthy: false,
          lastCheck: new Date(),
          errorMessage: `SearXNG returned ${response.status}`,
        };
      }

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
        errorMessage: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }
}

interface SearXNGResponse {
  query?: string;
  number_of_results?: number;
  results?: Array<{
    title: string;
    url: string;
    content?: string;
    engine?: string;
    engines?: string[];
    category?: string;
    score?: number;
    publishedDate?: string;
  }>;
}

export const SEARXNG_DEFINITION: SearchPluginDefinition = {
  metadata: {
    id: 'searxng',
    name: 'SearXNG',
    description: 'Self-hosted metasearch - 246+ sources, complete privacy',
    category: 'search',
    icon: 'server',
    version: '1.0.0',
    homepage: 'https://docs.searxng.org/',
    pricing: {
      type: 'free',
    },
    rateLimit: {
      requestsPerSecond: 10, // Depends on your instance
    },
  },
  settingsSchema: {
    credentials: [
      {
        key: 'baseUrl',
        type: 'url',
        label: 'Instance URL',
        description: 'URL of your SearXNG instance (e.g., http://localhost:8080)',
        placeholder: 'http://localhost:8080',
        required: true,
      },
    ],
    settings: [
      {
        key: 'engines',
        type: 'text',
        label: 'Engines',
        description: 'Comma-separated list of engines to use (leave empty for all)',
        placeholder: 'google,duckduckgo,bing',
      },
      {
        key: 'safeSearch',
        type: 'boolean',
        label: 'Safe Search',
        description: 'Enable strict safe search filtering',
        default: true,
      },
      {
        key: 'timeout',
        type: 'number',
        label: 'Timeout (seconds)',
        description: 'Request timeout in seconds',
        default: 10,
        validation: { min: 1, max: 60 },
      },
    ],
  },
  factory: (config: PluginConfig) => new SearXNGProvider(config),
};
