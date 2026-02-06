import OpenAI from 'openai';
import { loadConfig } from '../utils/config-loader.js';
import { logger } from '../utils/logger.js';

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
    };
    defaultEmbeddingProvider?: 'openai' | 'ollama';
  };
}

const config = loadConfig<AIConfig>('settings.yml');

export class EmbeddingService {
  private openai?: OpenAI;

  constructor() {
    const openaiKey = config.ai?.providers?.openai?.apiKey;
    if (openaiKey && openaiKey !== '${OPENAI_API_KEY}') {
      this.openai = new OpenAI({ apiKey: openaiKey });
    }
  }

  /**
   * Generate an embedding for a string of text
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const provider = config.ai?.defaultEmbeddingProvider || 'openai';

    // Try primary provider first
    if (provider === 'openai' && this.openai) {
      try {
        return await this.generateOpenAIEmbedding(text);
      } catch (error) {
        logger.warn('[AI] OpenAI embedding failed, trying Ollama fallback');
      }
    }

    // Try Ollama (either as primary or fallback)
    try {
      const { getOllamaService } = await import('../intelligence/ollama.js');
      const ollama = getOllamaService();
      const isAvailable = await ollama.healthCheck();
      
      if (isAvailable) {
        return await ollama.generateEmbedding(text);
      }
    } catch (error) {
      logger.warn('[AI] Ollama embedding failed');
    }

    // Fallback to a zero-vector if no provider is available
    logger.warn(`[AI] No embedding provider available. Returning zero-vector.`);
    return new Array(1536).fill(0);
  }

  private async generateOpenAIEmbedding(text: string): Promise<number[]> {
    if (!this.openai) throw new Error('OpenAI not initialized');
    
    const model = config.ai?.providers?.openai?.embeddingModel || 'text-embedding-3-small';
    
    try {
      const response = await this.openai.embeddings.create({
        model,
        input: text.substring(0, 8000), // OpenAI limit
      });
      return response.data[0].embedding;
    } catch (error) {
      logger.error('[AI] OpenAI embedding error:', error as Error);
      throw error;
    }
  }

}

// Singleton instances
let instance: EmbeddingService | null = null;

export function getEmbeddingService(): EmbeddingService {
  if (!instance) {
    instance = new EmbeddingService();
  }
  return instance;
}
