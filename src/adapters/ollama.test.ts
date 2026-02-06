import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaAdapter, createOllamaAdapter } from './ollama.js';
import type { AgentConfig } from '../types/agent.js';
import type { Task } from '../types/task.js';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('OllamaAdapter', () => {
  const defaultConfig: AgentConfig = {
    id: 'ollama-1',
    type: 'ollama',
    enabled: true,
    maxConcurrent: 1,
    priority: 1,
    config: {
      baseUrl: 'http://localhost:11434',
      model: 'llama3.2',
    },
  };

  const mockTask: Task = {
    id: 'task-123',
    title: 'Fix authentication bug',
    description: 'Users cannot login with valid credentials',
    prompt: 'Debug the login function and fix the authentication issue',
    status: 'pending',
    priority: 2,
    source: 'github',
    labels: ['bug', 'auth'],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create adapter with default config', () => {
      const adapter = new OllamaAdapter(defaultConfig);
      expect(adapter.type).toBe('ollama');
      expect(adapter.name).toBe('Ollama');
      expect(adapter.capabilities).toContain('code_generation');
    });

    it('should use environment variables as fallback', () => {
      const envConfig: AgentConfig = {
        id: 'ollama-env',
        type: 'ollama',
        enabled: true,
        maxConcurrent: 1,
        priority: 1,
        config: {},
      };

      const adapter = new OllamaAdapter(envConfig);
      expect(adapter).toBeDefined();
    });
  });

  describe('healthCheck', () => {
    it('should return healthy when Ollama is running and model is available', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [
            { name: 'llama3.2:latest' },
            { name: 'codellama:7b' },
          ],
        }),
      });

      const adapter = new OllamaAdapter(defaultConfig);
      const health = await adapter.healthCheck();

      expect(health.healthy).toBe(true);
      expect(health.message).toContain('llama3.2');
      expect(health.latencyMs).toBeDefined();
    });

    it('should return unhealthy when model is not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: 'codellama:7b' }],
        }),
      });

      const adapter = new OllamaAdapter(defaultConfig);
      const health = await adapter.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.message).toContain('not found');
    });

    it('should return unhealthy when Ollama is not running', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const adapter = new OllamaAdapter(defaultConfig);
      const health = await adapter.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.message).toContain('Connection refused');
    });

    it('should return unhealthy when API returns error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const adapter = new OllamaAdapter(defaultConfig);
      const health = await adapter.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.message).toContain('500');
    });
  });

  describe('executeTask', () => {
    it('should execute task successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: 'llama3.2',
          done: true,
          message: {
            role: 'assistant',
            content: 'Here is the fix for the authentication bug...',
          },
          prompt_eval_count: 100,
          eval_count: 200,
        }),
      });

      const adapter = new OllamaAdapter(defaultConfig);
      const result = await adapter.executeTask(mockTask);

      expect(result.success).toBe(true);
      expect(result.output).toContain('authentication bug');
      expect(result.tokensUsed?.total).toBe(300);
      expect(result.cost?.amount).toBe(0); // Ollama is free
    });

    it('should handle API errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const adapter = new OllamaAdapter(defaultConfig);
      const result = await adapter.executeTask(mockTask);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('HTTP_500');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const adapter = new OllamaAdapter(defaultConfig);
      const result = await adapter.executeTask(mockTask);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EXECUTION_ERROR');
      expect(result.error?.message).toContain('Network error');
    });

    it('should include task context in prompt', async () => {
      const taskWithContext: Task = {
        ...mockTask,
        repository: 'org/repo',
        branch: 'feature/auth',
        labels: ['bug', 'priority:high'],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: 'llama3.2',
          done: true,
          message: {
            role: 'assistant',
            content: 'Fixed the issue',
          },
        }),
      });

      const adapter = new OllamaAdapter(defaultConfig);
      await adapter.executeTask(taskWithContext);

      // Verify the request body includes context
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.messages[1].content).toContain('org/repo');
      expect(requestBody.messages[1].content).toContain('feature/auth');
    });
  });

  describe('task type inference', () => {
    it('should use bug fix prompt for bug tasks', async () => {
      const bugTask: Task = {
        ...mockTask,
        labels: ['bug'],
        title: 'Fix login crash',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: 'llama3.2',
          done: true,
          message: { role: 'assistant', content: 'Fixed' },
        }),
      });

      const adapter = new OllamaAdapter(defaultConfig);
      await adapter.executeTask(bugTask);

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.messages[0].content).toContain('fixing a bug');
    });

    it('should use feature prompt for feature tasks', async () => {
      const featureTask: Task = {
        ...mockTask,
        labels: ['feature'],
        title: 'Implement user profiles',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: 'llama3.2',
          done: true,
          message: { role: 'assistant', content: 'Implemented' },
        }),
      });

      const adapter = new OllamaAdapter(defaultConfig);
      await adapter.executeTask(featureTask);

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.messages[0].content).toContain('implementing a new feature');
    });
  });

  describe('factory function', () => {
    it('should create adapter via factory', () => {
      const adapter = createOllamaAdapter(defaultConfig);
      expect(adapter).toBeInstanceOf(OllamaAdapter);
      expect(adapter.type).toBe('ollama');
    });
  });
});
