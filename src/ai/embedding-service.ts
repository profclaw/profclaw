import OpenAI from 'openai';
import { loadConfig } from '../utils/config-loader.js';
import { logger } from '../utils/logger.js';

// Configuration Types

export type EmbeddingProvider = 'openai' | 'ollama' | 'voyage' | 'gemini';

interface AIConfig {
  ai?: {
    providers?: {
      openai?: {
        apiKey?: string;
        embeddingModel?: string;
      };
      ollama?: {
        baseUrl?: string;
        embeddingModel?: string;
      };
      voyage?: {
        apiKey?: string;
        model?: string;
      };
      gemini?: {
        apiKey?: string;
        embeddingModel?: string;
      };
    };
    defaultEmbeddingProvider?: EmbeddingProvider;
  };
}

// Model Limit Tracking

export interface EmbeddingModelLimits {
  maxInputTokens: number;
  maxBatchSize: number;
  dimensions: number;
  rateLimit: { requests: number; windowMs: number };
}

const MODEL_LIMITS: Record<string, EmbeddingModelLimits> = {
  'text-embedding-3-small': { maxInputTokens: 8191, maxBatchSize: 2048, dimensions: 1536, rateLimit: { requests: 3000, windowMs: 60_000 } },
  'text-embedding-3-large': { maxInputTokens: 8191, maxBatchSize: 2048, dimensions: 3072, rateLimit: { requests: 3000, windowMs: 60_000 } },
  'text-embedding-ada-002': { maxInputTokens: 8191, maxBatchSize: 2048, dimensions: 1536, rateLimit: { requests: 3000, windowMs: 60_000 } },
  'voyage-3': { maxInputTokens: 32000, maxBatchSize: 128, dimensions: 1024, rateLimit: { requests: 300, windowMs: 60_000 } },
  'voyage-3-lite': { maxInputTokens: 32000, maxBatchSize: 128, dimensions: 512, rateLimit: { requests: 300, windowMs: 60_000 } },
  'voyage-code-3': { maxInputTokens: 32000, maxBatchSize: 128, dimensions: 1024, rateLimit: { requests: 300, windowMs: 60_000 } },
  'text-embedding-004': { maxInputTokens: 2048, maxBatchSize: 100, dimensions: 768, rateLimit: { requests: 1500, windowMs: 60_000 } },
};

// Usage Tracking

export interface EmbeddingUsageStats {
  provider: EmbeddingProvider;
  model: string;
  totalRequests: number;
  totalTokens: number;
  totalBatches: number;
  errors: number;
  lastUsed: number;
}

export interface StreamingEmbeddingProgress {
  completed: number;
  total: number;
  chunkIndex: number;
  totalChunks: number;
  percentage: number;
  error: string | null;
}

const config = loadConfig<AIConfig>('settings.yml');

// Embedding Service

export class EmbeddingService {
  private openai?: OpenAI;
  private usageStats: Map<string, EmbeddingUsageStats> = new Map();

  constructor() {
    const openaiKey = config.ai?.providers?.openai?.apiKey ?? process.env.OPENAI_API_KEY;
    if (openaiKey && openaiKey !== '${OPENAI_API_KEY}') {
      this.openai = new OpenAI({ apiKey: openaiKey });
    }
  }

  /**
   * Generate an embedding for a string of text
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const provider = config.ai?.defaultEmbeddingProvider ?? 'openai';

    // Try primary provider first
    if (provider === 'openai' && this.openai) {
      try {
        return await this.generateOpenAIEmbedding(text);
      } catch {
        logger.warn('[AI] OpenAI embedding failed, trying fallback');
      }
    }

    // Try Voyage
    if (provider === 'voyage' || this.isVoyageConfigured()) {
      try {
        return await this.generateVoyageEmbedding(text);
      } catch {
        logger.warn('[AI] Voyage embedding failed, trying next fallback');
      }
    }

    // Try Gemini
    if (provider === 'gemini' || this.isGeminiConfigured()) {
      try {
        return await this.generateGeminiEmbedding(text);
      } catch {
        logger.warn('[AI] Gemini embedding failed, trying Ollama fallback');
      }
    }

    // Try Ollama (always available as local fallback)
    try {
      const { getOllamaService } = await import('../intelligence/ollama.js');
      const ollama = getOllamaService();
      const isAvailable = await ollama.healthCheck();

      if (isAvailable) {
        return await ollama.generateEmbedding(text);
      }
    } catch {
      logger.warn('[AI] Ollama embedding failed');
    }

    logger.warn('[AI] No embedding provider available. Returning zero-vector.');
    return new Array(1536).fill(0);
  }

  /**
   * Batch embedding - process multiple texts at once
   */
  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (texts.length === 1) return [await this.generateEmbedding(texts[0])];

    const provider = config.ai?.defaultEmbeddingProvider ?? 'openai';

    // OpenAI batch API
    if (provider === 'openai' && this.openai) {
      try {
        return await this.batchOpenAIEmbeddings(texts);
      } catch {
        logger.warn('[AI] OpenAI batch embedding failed, falling back to sequential');
      }
    }

    // Voyage batch API
    if (provider === 'voyage' && this.isVoyageConfigured()) {
      try {
        return await this.batchVoyageEmbeddings(texts);
      } catch {
        logger.warn('[AI] Voyage batch embedding failed, falling back to sequential');
      }
    }

    // Gemini batch API
    if (provider === 'gemini' && this.isGeminiConfigured()) {
      try {
        return await this.batchGeminiEmbeddings(texts);
      } catch {
        logger.warn('[AI] Gemini batch embedding failed, falling back to sequential');
      }
    }

    // Sequential fallback
    return Promise.all(texts.map((t) => this.generateEmbedding(t)));
  }

  /**
   * Get model limits for a specific model
   */
  getModelLimits(model?: string): EmbeddingModelLimits | null {
    const effectiveModel = model ?? this.getActiveModel();
    return MODEL_LIMITS[effectiveModel] ?? null;
  }

  /**
   * Get current active embedding model name
   */
  getActiveModel(): string {
    const provider = config.ai?.defaultEmbeddingProvider ?? 'openai';
    switch (provider) {
      case 'openai': return config.ai?.providers?.openai?.embeddingModel ?? 'text-embedding-3-small';
      case 'voyage': return config.ai?.providers?.voyage?.model ?? 'voyage-3';
      case 'gemini': return config.ai?.providers?.gemini?.embeddingModel ?? 'text-embedding-004';
      case 'ollama': return config.ai?.providers?.ollama?.embeddingModel ?? 'nomic-embed-text';
      default: return 'text-embedding-3-small';
    }
  }

  /**
   * Get usage statistics
   */
  getUsageStats(): EmbeddingUsageStats[] {
    return Array.from(this.usageStats.values());
  }

  /**
   * Get available embedding providers
   */
  getAvailableProviders(): EmbeddingProvider[] {
    const providers: EmbeddingProvider[] = [];
    if (this.openai) providers.push('openai');
    if (this.isVoyageConfigured()) providers.push('voyage');
    if (this.isGeminiConfigured()) providers.push('gemini');
    providers.push('ollama'); // always available
    return providers;
  }

  // OpenAI Embeddings

  private async generateOpenAIEmbedding(text: string): Promise<number[]> {
    if (!this.openai) throw new Error('OpenAI not initialized');
    const model = config.ai?.providers?.openai?.embeddingModel ?? 'text-embedding-3-small';

    const response = await this.openai.embeddings.create({
      model,
      input: text.substring(0, 8000),
    });
    this.trackUsage('openai', model, 1, text.length);
    return response.data[0].embedding;
  }

  private async batchOpenAIEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.openai) throw new Error('OpenAI not initialized');
    const model = config.ai?.providers?.openai?.embeddingModel ?? 'text-embedding-3-small';
    const limits = MODEL_LIMITS[model];
    const batchSize = limits?.maxBatchSize ?? 2048;

    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize).map((t) => t.substring(0, 8000));
      const response = await this.openai.embeddings.create({ model, input: batch });
      results.push(...response.data.map((d) => d.embedding));
      this.trackUsage('openai', model, batch.length, batch.reduce((s, t) => s + t.length, 0));
    }
    return results;
  }

  // Voyage Embeddings

  private isVoyageConfigured(): boolean {
    const key = config.ai?.providers?.voyage?.apiKey ?? process.env.VOYAGE_API_KEY;
    return !!key && key !== '${VOYAGE_API_KEY}';
  }

  private async generateVoyageEmbedding(text: string): Promise<number[]> {
    const apiKey = config.ai?.providers?.voyage?.apiKey ?? process.env.VOYAGE_API_KEY;
    if (!apiKey) throw new Error('Voyage API key not configured');
    const model = config.ai?.providers?.voyage?.model ?? 'voyage-3';

    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input: [text.substring(0, 32000)] }),
    });

    if (!response.ok) throw new Error(`Voyage API error: ${response.status}`);
    const data = await response.json() as { data: Array<{ embedding: number[] }> };
    this.trackUsage('voyage', model, 1, text.length);
    return data.data[0].embedding;
  }

  private async batchVoyageEmbeddings(texts: string[]): Promise<number[][]> {
    const apiKey = config.ai?.providers?.voyage?.apiKey ?? process.env.VOYAGE_API_KEY;
    if (!apiKey) throw new Error('Voyage API key not configured');
    const model = config.ai?.providers?.voyage?.model ?? 'voyage-3';
    const batchSize = 128;

    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize).map((t) => t.substring(0, 32000));
      const response = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: batch }),
      });
      if (!response.ok) throw new Error(`Voyage batch error: ${response.status}`);
      const data = await response.json() as { data: Array<{ embedding: number[] }> };
      results.push(...data.data.map((d) => d.embedding));
      this.trackUsage('voyage', model, batch.length, batch.reduce((s, t) => s + t.length, 0));
    }
    return results;
  }

  // Gemini Embeddings

  private isGeminiConfigured(): boolean {
    const key = config.ai?.providers?.gemini?.apiKey ?? process.env.GOOGLE_API_KEY;
    return !!key && key !== '${GOOGLE_API_KEY}';
  }

  private async generateGeminiEmbedding(text: string): Promise<number[]> {
    const apiKey = config.ai?.providers?.gemini?.apiKey ?? process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error('Gemini API key not configured');
    const model = config.ai?.providers?.gemini?.embeddingModel ?? 'text-embedding-004';

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${model}:embedContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: { parts: [{ text: text.substring(0, 2048) }] } }),
      },
    );

    if (!response.ok) throw new Error(`Gemini embedding error: ${response.status}`);
    const data = await response.json() as { embedding: { values: number[] } };
    this.trackUsage('gemini', model, 1, text.length);
    return data.embedding.values;
  }

  private async batchGeminiEmbeddings(texts: string[]): Promise<number[][]> {
    const apiKey = config.ai?.providers?.gemini?.apiKey ?? process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error('Gemini API key not configured');
    const model = config.ai?.providers?.gemini?.embeddingModel ?? 'text-embedding-004';

    const requests = texts.map((text) => ({
      model: `models/${model}`,
      content: { parts: [{ text: text.substring(0, 2048) }] },
    }));

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${model}:batchEmbedContents?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
      },
    );

    if (!response.ok) throw new Error(`Gemini batch embedding error: ${response.status}`);
    const data = await response.json() as { embeddings: Array<{ values: number[] }> };
    this.trackUsage('gemini', model, texts.length, texts.reduce((s, t) => s + t.length, 0));
    return data.embeddings.map((e) => e.values);
  }

  // Streaming Embeddings

  /**
   * Generate embeddings with streaming progress callback.
   * Processes texts in chunks and calls onProgress after each chunk completes.
   */
  async generateStreamingEmbeddings(
    texts: string[],
    onProgress: (result: StreamingEmbeddingProgress) => void,
    options?: { chunkSize?: number },
  ): Promise<number[][]> {
    const chunkSize = options?.chunkSize ?? 50;
    const results: number[][] = [];
    const totalChunks = Math.ceil(texts.length / chunkSize);

    for (let i = 0; i < texts.length; i += chunkSize) {
      const chunk = texts.slice(i, i + chunkSize);
      const chunkIndex = Math.floor(i / chunkSize);

      try {
        const embeddings = await this.generateBatchEmbeddings(chunk);
        results.push(...embeddings);

        onProgress({
          completed: Math.min(i + chunkSize, texts.length),
          total: texts.length,
          chunkIndex,
          totalChunks,
          percentage: Math.round((Math.min(i + chunkSize, texts.length) / texts.length) * 100),
          error: null,
        });
      } catch (error) {
        // On error, fill with zero vectors and report
        const zeroVectors = chunk.map(() => new Array(1536).fill(0) as number[]);
        results.push(...zeroVectors);

        onProgress({
          completed: Math.min(i + chunkSize, texts.length),
          total: texts.length,
          chunkIndex,
          totalChunks,
          percentage: Math.round((Math.min(i + chunkSize, texts.length) / texts.length) * 100),
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        logger.warn(`[AI] Streaming embedding chunk ${chunkIndex} failed: ${error instanceof Error ? error.message : 'unknown'}`);
      }
    }

    return results;
  }

  // Usage Tracking

  private trackUsage(provider: EmbeddingProvider, model: string, count: number, charCount: number): void {
    const key = `${provider}/${model}`;
    const existing = this.usageStats.get(key);
    if (existing) {
      existing.totalRequests += count;
      existing.totalTokens += Math.ceil(charCount / 4); // rough estimate
      existing.totalBatches++;
      existing.lastUsed = Date.now();
    } else {
      this.usageStats.set(key, {
        provider,
        model,
        totalRequests: count,
        totalTokens: Math.ceil(charCount / 4),
        totalBatches: 1,
        errors: 0,
        lastUsed: Date.now(),
      });
    }
  }
}

// Memory Backend Interface (multi-backend plugin slot)

export interface MemoryBackend {
  name: string;
  store(key: string, embedding: number[], metadata: Record<string, unknown>): Promise<void>;
  search(query: number[], limit: number, filter?: Record<string, unknown>): Promise<MemorySearchResult[]>;
  delete(key: string): Promise<boolean>;
  stats(): Promise<{ totalEntries: number; sizeBytes: number }>;
}

export interface MemorySearchResult {
  key: string;
  score: number;
  metadata: Record<string, unknown>;
}

// Citation Tracking

export interface MemoryCitation {
  memoryId: string;
  sourceType: 'conversation' | 'document' | 'url' | 'file' | 'manual';
  sourceId: string;
  timestamp: string;
  excerpt?: string;
}

// Singleton

let instance: EmbeddingService | null = null;

export function getEmbeddingService(): EmbeddingService {
  if (!instance) {
    instance = new EmbeddingService();
  }
  return instance;
}
