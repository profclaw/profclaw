import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbeddingService } from '../embedding-service.js';

// Mock config-loader
vi.mock('../../utils/config-loader.js', () => ({
  loadConfig: vi.fn().mockReturnValue({
    ai: {
      providers: {
        openai: { apiKey: 'fake-key', embeddingModel: 'test-model' }
      },
      defaultEmbeddingProvider: 'openai'
    }
  })
}));

// Mock OpenAI
const mockCreate = vi.fn();
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(function() {
      return {
        embeddings: {
          create: mockCreate
        }
      };
    })
  };
});

// Mock Ollama Service
const mockOllamaHealth = vi.fn();
const mockOllamaEmbed = vi.fn();
vi.mock('../../intelligence/ollama.js', () => ({
  getOllamaService: vi.fn().mockReturnValue({
    healthCheck: mockOllamaHealth,
    generateEmbedding: mockOllamaEmbed
  })
}));

describe('Embedding Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should generate embedding via OpenAI', async () => {
    const service = new EmbeddingService();
    mockCreate.mockResolvedValue({
      data: [{ embedding: [0.1, 0.2, 0.3] }]
    });

    const embedding = await service.generateEmbedding('hello world');
    expect(embedding).toEqual([0.1, 0.2, 0.3]);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: 'hello world'
    }));
  });

  it('should fall back to Ollama if OpenAI fails', async () => {
    const service = new EmbeddingService();
    mockCreate.mockRejectedValue(new Error('OpenAI Down'));
    mockOllamaHealth.mockResolvedValue(true);
    mockOllamaEmbed.mockResolvedValue([0.4, 0.5]);

    const embedding = await service.generateEmbedding('hello world');
    expect(embedding).toEqual([0.4, 0.5]);
    expect(mockOllamaEmbed).toHaveBeenCalled();
  });

  it('should return zero-vector if all providers fail', async () => {
    const service = new EmbeddingService();
    mockCreate.mockRejectedValue(new Error('OpenAI Down'));
    mockOllamaHealth.mockResolvedValue(false);

    const embedding = await service.generateEmbedding('hello world');
    expect(embedding).toHaveLength(1536);
    expect(embedding.every(v => v === 0)).toBe(true);
  });
});
