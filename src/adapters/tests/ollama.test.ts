import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaAdapter } from '../ollama.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Ollama Adapter', () => {
  const config = {
    id: 'ol-1',
    type: 'ollama',
    config: {
      baseUrl: 'http://localhost:11434',
      model: 'llama3'
    }
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Health Check', () => {
    it('should be healthy if server is up and model is available', async () => {
      const adapter = new OllamaAdapter(config);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [{ name: 'llama3:latest' }]
        })
      });

      const health = await adapter.healthCheck();
      expect(health.healthy).toBe(true);
      expect(health.message).toContain('llama3');
    });

    it('should be unhealthy if model is missing', async () => {
      const adapter = new OllamaAdapter(config);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [{ name: 'mistral:latest' }]
        })
      });

      const health = await adapter.healthCheck();
      expect(health.healthy).toBe(false);
      expect(health.message).toContain("Model 'llama3' not found");
    });

    it('should handle server connection errors', async () => {
      const adapter = new OllamaAdapter(config);
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const health = await adapter.healthCheck();
      expect(health.healthy).toBe(false);
      expect(health.message).toBe('Connection refused');
    });
  });

  describe('Task Execution', () => {
    it('should execute a task successfully', async () => {
      const adapter = new OllamaAdapter(config);
      const task = {
        id: 'task-1',
        title: 'Simple Task',
        prompt: 'Say hello',
        labels: [],
      } as any;

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          message: { content: 'Hello there!' },
          prompt_eval_count: 10,
          eval_count: 20
        })
      });

      const result = await adapter.executeTask(task);
      expect(result.success).toBe(true);
      expect(result.output).toBe('Hello there!');
      expect(result.tokensUsed).toEqual({ input: 10, output: 20, total: 30 });
    });

    it('should use different system prompts for different task types', async () => {
        const adapter = new OllamaAdapter(config);
        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({ message: { content: 'Fix applied' } })
        });

        // Bug fix task
        await adapter.executeTask({ title: 'Fix bug', labels: ['bug'], prompt: 'P' } as any);
        let lastCall = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(lastCall.messages[0].content).toContain('fixing a bug');

        // Documentation task
        await adapter.executeTask({ title: 'Write docs', labels: ['documentation'], prompt: 'P' } as any);
        lastCall = JSON.parse(mockFetch.mock.calls[1][1].body);
        expect(lastCall.messages[0].content).toContain('writing documentation');
    });

    it('should handle execution errors', async () => {
      const adapter = new OllamaAdapter(config);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Model not loaded'
      });

      const result = await adapter.executeTask({ id: 't-err', title: 'T' } as any);
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Ollama API error: 404');
    });
  });
});
