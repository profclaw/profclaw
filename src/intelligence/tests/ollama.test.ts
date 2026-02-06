import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaService } from '../ollama.js';

// Mock config-loader
vi.mock('../../utils/config-loader.js', () => ({
  loadConfig: vi.fn().mockReturnValue({
    ai: {
      providers: {
        ollama: {
          baseUrl: 'http://ollama:11434',
          summaryModel: 'llama3',
          embeddingModel: 'mxbai'
        }
      }
    }
  })
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Ollama Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should check health successfully', async () => {
    const service = new OllamaService();
    mockFetch.mockResolvedValue({ ok: true });

    const healthy = await service.healthCheck();
    expect(healthy).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('http://ollama:11434/api/tags', expect.any(Object));
  });

  it('should handle health check failure', async () => {
    const service = new OllamaService();
    mockFetch.mockRejectedValue(new Error('Connect failed'));

    const healthy = await service.healthCheck();
    expect(healthy).toBe(false);
  });

  it('should generate an embedding', async () => {
    const service = new OllamaService();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2] })
    });

    const embedding = await service.generateEmbedding('test text');
    expect(embedding).toEqual([0.1, 0.2]);
    expect(mockFetch).toHaveBeenCalledWith(
        'http://ollama:11434/api/embeddings',
        expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"prompt":"test text"')
        })
    );
  });

  it('should generate a structured summary', async () => {
    const service = new OllamaService();
    // 1st fetch: healthCheck
    mockFetch.mockResolvedValueOnce({ ok: true });
    // 2nd fetch: generate
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: `
TITLE: Fixed the bug
WHAT_CHANGED: Corrected the logic in index.ts
WHY_CHANGED: Performance issues
HOW_CHANGED: Used a better algorithm
FILES_CHANGED: modified|index.ts
DECISIONS: - Decision 1
        `
      })
    });

    const result = { success: true, output: 'Done' } as any;
    const summary = await service.generateSummary(result, { taskId: 't1' });

    expect(summary).not.toBeNull();
    expect(summary?.title).toBe('Fixed the bug');
    expect(summary?.filesChanged).toEqual([{ action: 'modified', path: 'index.ts' }]);
    expect(summary?.decisions).toEqual([{ description: 'Decision 1' }]);
  });

  it('should return null if Ollama is unavailable for summary', async () => {
    const service = new OllamaService();
    mockFetch.mockResolvedValue({ ok: false }); // Health check fails

    const summary = await service.generateSummary({ success: true } as any, {});
    expect(summary).toBeNull();
  });
});
