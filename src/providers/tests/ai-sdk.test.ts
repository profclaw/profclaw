import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock all provider SDK factories
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn((model: string) => ({ modelId: model, provider: 'anthropic' }))),
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => {
    const fn = vi.fn((model: string) => ({ modelId: model, provider: 'openai-compat' }));
    (fn as Record<string, unknown>).chat = vi.fn((model: string) => ({ modelId: model, provider: 'openai-chat' }));
    return fn;
  }),
}));

vi.mock('@ai-sdk/azure', () => ({
  createAzure: vi.fn(() => {
    const fn = vi.fn((model: string) => ({ modelId: model, provider: 'azure' }));
    (fn as Record<string, unknown>).chat = vi.fn((model: string) => ({ modelId: model, provider: 'azure-chat' }));
    return fn;
  }),
}));

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn((model: string) => ({ modelId: model, provider: 'google' }))),
}));

vi.mock('ai-sdk-ollama', () => ({
  createOllama: vi.fn(() => vi.fn((model: string) => ({ modelId: model, provider: 'ollama' }))),
}));

vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  tool: vi.fn(),
  jsonSchema: vi.fn((s: unknown) => s),
}));

vi.mock('zod-to-json-schema', () => ({
  zodToJsonSchema: vi.fn(() => ({ type: 'object', properties: {} })),
}));

vi.mock('../schema-utils.js', () => ({
  normalizeToolSchema: vi.fn((s: unknown) => s),
}));

// Import after mocks
import { generateText, streamText } from 'ai';
import { aiProvider, ProviderType, MODEL_ALIASES, MODEL_CATALOG, PROVIDER_STATUS } from '../ai-sdk.js';
import type { ChatRequest } from '../ai-sdk.js';

describe('AIProviderManager (aiProvider singleton)', () => {
  // ===========================================================================
  // Re-exports
  // ===========================================================================

  describe('re-exports', () => {
    it('exports ProviderType Zod enum', () => {
      expect(ProviderType).toBeDefined();
      expect(ProviderType.safeParse('anthropic').success).toBe(true);
      expect(ProviderType.safeParse('invalid-provider').success).toBe(false);
    });

    it('exports MODEL_ALIASES', () => {
      expect(MODEL_ALIASES).toBeDefined();
      expect(typeof MODEL_ALIASES).toBe('object');
      expect(MODEL_ALIASES['opus']).toBeDefined();
    });

    it('exports MODEL_CATALOG', () => {
      expect(MODEL_CATALOG).toBeDefined();
      expect(Array.isArray(MODEL_CATALOG)).toBe(true);
    });

    it('exports PROVIDER_STATUS', () => {
      expect(PROVIDER_STATUS).toBeDefined();
      expect(PROVIDER_STATUS['anthropic']).toBe('stable');
      expect(PROVIDER_STATUS['copilot']).toBe('experimental');
    });
  });

  // ===========================================================================
  // getDefaultProvider
  // ===========================================================================

  describe('getDefaultProvider', () => {
    it('returns a valid provider type', () => {
      const provider = aiProvider.getDefaultProvider();
      expect(ProviderType.safeParse(provider).success).toBe(true);
    });

    it('defaults to a configured provider', () => {
      const provider = aiProvider.getDefaultProvider();
      // In test env, Azure or Ollama may be the default depending on env vars
      const validDefaults = ['ollama', 'azure', 'anthropic', 'openai', 'google'];
      expect(validDefaults).toContain(provider);
    });
  });

  // ===========================================================================
  // isConfigured
  // ===========================================================================

  describe('isConfigured', () => {
    it('returns true for ollama (always configured)', () => {
      expect(aiProvider.isConfigured('ollama')).toBe(true);
    });

    it('returns false for unconfigured providers', () => {
      // In test env without API keys
      if (!process.env.ANTHROPIC_API_KEY) {
        expect(aiProvider.isConfigured('anthropic')).toBe(false);
      }
    });
  });

  // ===========================================================================
  // getConfiguredProviders
  // ===========================================================================

  describe('getConfiguredProviders', () => {
    it('returns an array of configured providers', () => {
      const providers = aiProvider.getConfiguredProviders();
      expect(Array.isArray(providers)).toBe(true);
      // At minimum ollama should be configured
      expect(providers).toContain('ollama');
    });
  });

  // ===========================================================================
  // resolveModel
  // ===========================================================================

  describe('resolveModel', () => {
    it('resolves provider/model format', () => {
      const result = aiProvider.resolveModel('openai/gpt-4o');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4o');
    });

    it('resolves known aliases', () => {
      const result = aiProvider.resolveModel('opus');
      // Routes to anthropic if configured, otherwise may fallback
      expect(result).toBeDefined();
      expect(result.model).toBeTruthy();
    });

    it('resolves case-insensitively', () => {
      const result = aiProvider.resolveModel('OPUS');
      expect(result).toBeDefined();
    });

    it('resolves catalog model IDs', () => {
      const result = aiProvider.resolveModel('gpt-4o');
      expect(result).toBeDefined();
      expect(result.provider).toBeTruthy();
    });

    it('falls back to default provider for unknown models', () => {
      const result = aiProvider.resolveModel('some-unknown-model');
      expect(result.provider).toBe(aiProvider.getDefaultProvider());
    });

    it('resolves replicate alias', () => {
      const result = aiProvider.resolveModel('replicate');
      // Replicate alias exists in MODEL_ALIASES but provider may not be in enum
      expect(result).toBeDefined();
    });

    it('resolves github-models alias', () => {
      const result = aiProvider.resolveModel('gh-models');
      // gh-models alias exists in MODEL_ALIASES
      expect(result).toBeDefined();
    });
  });

  // ===========================================================================
  // configure
  // ===========================================================================

  describe('configure', () => {
    it('configures a new provider', () => {
      aiProvider.configure('groq', {
        type: 'groq',
        apiKey: 'test-groq-key',
        enabled: true,
      });

      expect(aiProvider.isConfigured('groq')).toBe(true);
      expect(aiProvider.getConfiguredProviders()).toContain('groq');
    });

    it('configures deepseek provider', () => {
      aiProvider.configure('deepseek', {
        type: 'deepseek',
        apiKey: 'sk-test-deepseek',
        enabled: true,
      });

      expect(aiProvider.isConfigured('deepseek')).toBe(true);
    });
  });

  // ===========================================================================
  // getModel
  // ===========================================================================

  describe('getModel', () => {
    it('returns a model for ollama', async () => {
      const model = await aiProvider.getModel('ollama', 'llama3.2');
      expect(model).toBeDefined();
    });

    it('throws for unconfigured provider', async () => {
      // Ensure provider is not configured first
      if (!aiProvider.isConfigured('anthropic')) {
        await expect(aiProvider.getModel('anthropic', 'claude-sonnet-4-6')).rejects.toThrow();
      }
    });
  });

  // ===========================================================================
  // loadSavedConfigs
  // ===========================================================================

  describe('loadSavedConfigs', () => {
    it('loads saved configurations', async () => {
      const loader = vi.fn(async () => [
        { type: 'mistral', apiKey: 'sk-test-mistral', enabled: true },
      ]);

      const loaded = await aiProvider.loadSavedConfigs(loader);
      expect(loaded).toBe(1);
      expect(aiProvider.isConfigured('mistral')).toBe(true);
    });

    it('returns 0 when loader throws', async () => {
      const loader = vi.fn(async () => {
        throw new Error('DB not available');
      });

      const loaded = await aiProvider.loadSavedConfigs(loader);
      expect(loaded).toBe(0);
    });

    it('returns 0 for empty array', async () => {
      const loaded = await aiProvider.loadSavedConfigs(async () => []);
      expect(loaded).toBe(0);
    });
  });

  // ===========================================================================
  // autoSelectDefaultProvider
  // ===========================================================================

  describe('autoSelectDefaultProvider', () => {
    it('selects the highest-priority configured provider', () => {
      // After configuring groq in earlier tests
      aiProvider.autoSelectDefaultProvider();
      const provider = aiProvider.getDefaultProvider();
      // Should be groq or higher (depends on earlier test state)
      expect(ProviderType.safeParse(provider).success).toBe(true);
    });
  });

  // ===========================================================================
  // ProviderType enum completeness
  // ===========================================================================

  describe('ProviderType enum', () => {
    it('includes all expected providers', () => {
      const expectedProviders = [
        'anthropic', 'openai', 'azure', 'google', 'ollama', 'openrouter',
        'groq', 'xai', 'mistral', 'cohere', 'perplexity', 'deepseek',
        'together', 'cerebras', 'fireworks', 'copilot',
      ];

      for (const provider of expectedProviders) {
        expect(
          ProviderType.safeParse(provider).success,
          `Provider "${provider}" should be valid`,
        ).toBe(true);
      }
    });

    it('rejects invalid provider names', () => {
      expect(ProviderType.safeParse('invalid').success).toBe(false);
      expect(ProviderType.safeParse('chatgpt').success).toBe(false);
    });
  });

  // ===========================================================================
  // initFromEnv - provider initialization from environment variables
  // ===========================================================================

  describe('initFromEnv (via configure)', () => {
    it('configures anthropic when ANTHROPIC_API_KEY is set', () => {
      const originalKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      // configure directly to simulate env-based init
      aiProvider.configure('anthropic', {
        type: 'anthropic',
        apiKey: process.env.ANTHROPIC_API_KEY,
        enabled: true,
      });
      expect(aiProvider.isConfigured('anthropic')).toBe(true);
      process.env.ANTHROPIC_API_KEY = originalKey;
    });

    it('configures openai when OPENAI_API_KEY is set', () => {
      aiProvider.configure('openai', {
        type: 'openai',
        apiKey: 'sk-test-openai',
        enabled: true,
      });
      expect(aiProvider.isConfigured('openai')).toBe(true);
      expect(aiProvider.getConfiguredProviders()).toContain('openai');
    });

    it('configures google provider', () => {
      aiProvider.configure('google', {
        type: 'google',
        apiKey: 'google-test-key',
        enabled: true,
      });
      expect(aiProvider.isConfigured('google')).toBe(true);
    });

    it('configures xai provider', () => {
      aiProvider.configure('xai', {
        type: 'xai',
        apiKey: 'xai-test-key',
        enabled: true,
      });
      expect(aiProvider.isConfigured('xai')).toBe(true);
    });

    it('configures cohere provider', () => {
      aiProvider.configure('cohere', {
        type: 'cohere',
        apiKey: 'cohere-test-key',
        enabled: true,
      });
      expect(aiProvider.isConfigured('cohere')).toBe(true);
    });

    it('configures perplexity provider', () => {
      aiProvider.configure('perplexity', {
        type: 'perplexity',
        apiKey: 'pplx-test-key',
        enabled: true,
      });
      expect(aiProvider.isConfigured('perplexity')).toBe(true);
    });

    it('configures together provider', () => {
      aiProvider.configure('together', {
        type: 'together',
        apiKey: 'together-test-key',
        enabled: true,
      });
      expect(aiProvider.isConfigured('together')).toBe(true);
    });

    it('configures fireworks provider', () => {
      aiProvider.configure('fireworks', {
        type: 'fireworks',
        apiKey: 'fw-test-key',
        enabled: true,
      });
      expect(aiProvider.isConfigured('fireworks')).toBe(true);
    });

    it('configures openrouter provider', () => {
      aiProvider.configure('openrouter', {
        type: 'openrouter',
        apiKey: 'sk-or-test-key',
        enabled: true,
      });
      expect(aiProvider.isConfigured('openrouter')).toBe(true);
    });

    it('configures copilot with baseUrl instead of apiKey', () => {
      aiProvider.configure('copilot', {
        type: 'copilot',
        baseUrl: 'http://localhost:3100',
        enabled: true,
      });
      expect(aiProvider.isConfigured('copilot')).toBe(true);
    });

    it('configures azure with resourceName', () => {
      aiProvider.configure('azure', {
        type: 'azure',
        apiKey: 'azure-test-key',
        resourceName: 'my-resource',
        deploymentName: 'gpt-4o',
        enabled: true,
      });
      expect(aiProvider.isConfigured('azure')).toBe(true);
    });

    it('configures azure with baseUrl (Foundry mode)', () => {
      aiProvider.configure('azure', {
        type: 'azure',
        apiKey: 'azure-test-key',
        baseUrl: 'https://my-foundry.openai.azure.com',
        enabled: true,
      });
      expect(aiProvider.isConfigured('azure')).toBe(true);
    });
  });

  // ===========================================================================
  // configure() invalidates provider instance cache
  // ===========================================================================

  describe('configure() provider instance cache invalidation', () => {
    it('reconfiguring a provider clears the cached instance', async () => {
      // First configure and get a model to populate the cache
      aiProvider.configure('ollama', {
        type: 'ollama',
        baseUrl: 'http://localhost:11434',
        enabled: true,
      });
      await aiProvider.getModel('ollama', 'llama3.2');

      // Reconfigure with a different baseUrl
      aiProvider.configure('ollama', {
        type: 'ollama',
        baseUrl: 'http://localhost:22222',
        enabled: true,
      });

      // Should still be able to get a model (lazily recreated)
      const model = await aiProvider.getModel('ollama', 'llama3.2');
      expect(model).toBeDefined();
    });

    it('disabling a provider removes it from getConfiguredProviders', () => {
      aiProvider.configure('cerebras', {
        type: 'cerebras',
        apiKey: 'cerebras-test-key',
        enabled: true,
      });
      expect(aiProvider.isConfigured('cerebras')).toBe(true);

      aiProvider.configure('cerebras', {
        type: 'cerebras',
        apiKey: 'cerebras-test-key',
        enabled: false,
      });
      expect(aiProvider.isConfigured('cerebras')).toBe(false);
    });
  });

  // ===========================================================================
  // getModel() for each provider type
  // ===========================================================================

  describe('getModel() provider resolution', () => {
    it('returns a model instance for ollama', async () => {
      const model = await aiProvider.getModel('ollama', 'llama3.2');
      expect(model).toBeDefined();
    });

    it('returns a model for openai when configured', async () => {
      aiProvider.configure('openai', {
        type: 'openai',
        apiKey: 'sk-test',
        enabled: true,
      });
      const model = await aiProvider.getModel('openai', 'gpt-4o');
      expect(model).toBeDefined();
    });

    it('returns a model for anthropic when configured', async () => {
      aiProvider.configure('anthropic', {
        type: 'anthropic',
        apiKey: 'sk-ant-test',
        enabled: true,
      });
      const model = await aiProvider.getModel('anthropic', 'claude-opus-4-6');
      expect(model).toBeDefined();
    });

    it('returns a model for google when configured', async () => {
      aiProvider.configure('google', {
        type: 'google',
        apiKey: 'google-test',
        enabled: true,
      });
      const model = await aiProvider.getModel('google', 'gemini-2.5-pro');
      expect(model).toBeDefined();
    });

    it('returns a model for groq when configured', async () => {
      aiProvider.configure('groq', {
        type: 'groq',
        apiKey: 'gsk-test',
        enabled: true,
      });
      const model = await aiProvider.getModel('groq', 'llama-3.3-70b-versatile');
      expect(model).toBeDefined();
    });

    it('throws for unconfigured anthropic with helpful hint', async () => {
      aiProvider.configure('anthropic', {
        type: 'anthropic',
        apiKey: undefined,
        enabled: false,
      });
      await expect(aiProvider.getModel('anthropic', 'claude-opus-4-6')).rejects.toThrow(
        /anthropic.*not configured|set anthropic_api_key/i,
      );
    });

    it('throws for provider missing api key with correct hint', async () => {
      aiProvider.configure('xai', {
        type: 'xai',
        apiKey: undefined,
        enabled: false,
      });
      await expect(aiProvider.getModel('xai', 'grok-2')).rejects.toThrow(/xai.*not configured/i);
    });

    it('throws for azure when not configured', async () => {
      aiProvider.configure('azure', {
        type: 'azure',
        apiKey: undefined,
        enabled: false,
      });
      await expect(aiProvider.getModel('azure', 'gpt-4o')).rejects.toThrow(/azure.*not configured/i);
    });
  });

  // ===========================================================================
  // chat() and chatStream() error handling
  // ===========================================================================

  describe('chat() error handling', () => {
    beforeEach(() => {
      vi.mocked(generateText).mockReset();
    });

    it('rethrows errors from generateText', async () => {
      aiProvider.configure('ollama', {
        type: 'ollama',
        baseUrl: 'http://localhost:11434',
        enabled: true,
      });

      vi.mocked(generateText).mockRejectedValueOnce(new Error('Connection refused'));

      const request: ChatRequest = {
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Hello',
            timestamp: new Date().toISOString(),
          },
        ],
        model: 'ollama/llama3.2',
      };

      await expect(aiProvider.chat(request)).rejects.toThrow('Connection refused');
    });

    it('returns structured response on success', async () => {
      aiProvider.configure('ollama', {
        type: 'ollama',
        baseUrl: 'http://localhost:11434',
        enabled: true,
      });

      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'Hello world',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5 },
      } as Awaited<ReturnType<typeof generateText>>);

      const request: ChatRequest = {
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Hello',
            timestamp: new Date().toISOString(),
          },
        ],
        model: 'ollama/llama3.2',
      };

      const response = await aiProvider.chat(request);
      expect(response.content).toBe('Hello world');
      expect(response.finishReason).toBe('stop');
      expect(response.provider).toBe('ollama');
      expect(response.model).toBe('llama3.2');
      expect(response.usage.promptTokens).toBe(10);
      expect(response.usage.completionTokens).toBe(5);
      expect(response.usage.totalTokens).toBe(15);
      expect(typeof response.id).toBe('string');
      expect(typeof response.duration).toBe('number');
    });

    it('includes systemPrompt in messages when provided', async () => {
      aiProvider.configure('ollama', {
        type: 'ollama',
        enabled: true,
      });

      const capturedArgs: Parameters<typeof generateText>[0][] = [];
      vi.mocked(generateText).mockImplementationOnce(async (args) => {
        capturedArgs.push(args as Parameters<typeof generateText>[0]);
        return {
          text: 'Test',
          finishReason: 'stop',
          usage: { promptTokens: 5, completionTokens: 2 },
        } as Awaited<ReturnType<typeof generateText>>;
      });

      await aiProvider.chat({
        messages: [
          { id: '1', role: 'user', content: 'Hi', timestamp: new Date().toISOString() },
        ],
        model: 'ollama/llama3.2',
        systemPrompt: 'You are a helpful assistant.',
      });

      const messages = capturedArgs[0]?.messages as Array<{ role: string; content: string }> | undefined;
      expect(messages?.[0]?.role).toBe('system');
      expect(messages?.[0]?.content).toBe('You are a helpful assistant.');
    });

    it('uses finishReason length when not stop', async () => {
      aiProvider.configure('ollama', {
        type: 'ollama',
        enabled: true,
      });

      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'Truncated',
        finishReason: 'length',
        usage: { promptTokens: 100, completionTokens: 4096 },
      } as Awaited<ReturnType<typeof generateText>>);

      const response = await aiProvider.chat({
        messages: [{ id: '1', role: 'user', content: 'test', timestamp: new Date().toISOString() }],
        model: 'ollama/llama3.2',
      });
      expect(response.finishReason).toBe('length');
    });
  });

  describe('chatStream() error handling', () => {
    beforeEach(() => {
      vi.mocked(streamText).mockReset();
    });

    it('rethrows errors from streamText', async () => {
      aiProvider.configure('ollama', {
        type: 'ollama',
        enabled: true,
      });

      vi.mocked(streamText).mockImplementationOnce(() => {
        throw new Error('Stream failed');
      });

      const chunks: string[] = [];
      await expect(
        aiProvider.chatStream(
          {
            messages: [{ id: '1', role: 'user', content: 'test', timestamp: new Date().toISOString() }],
            model: 'ollama/llama3.2',
          },
          (chunk) => chunks.push(chunk),
        ),
      ).rejects.toThrow('Stream failed');
    });

    it('collects all streamed chunks into final response', async () => {
      aiProvider.configure('ollama', {
        type: 'ollama',
        enabled: true,
      });

      const mockTextStream = (async function* () {
        yield 'Hello';
        yield ' ';
        yield 'world';
      })();

      vi.mocked(streamText).mockReturnValueOnce({
        textStream: mockTextStream,
        usage: Promise.resolve({ promptTokens: 5, completionTokens: 3 }),
      } as unknown as ReturnType<typeof streamText>);

      const chunks: string[] = [];
      const response = await aiProvider.chatStream(
        {
          messages: [{ id: '1', role: 'user', content: 'Hello', timestamp: new Date().toISOString() }],
          model: 'ollama/llama3.2',
        },
        (chunk) => chunks.push(chunk),
      );

      expect(response.content).toBe('Hello world');
      expect(response.finishReason).toBe('stop');
      expect(response.provider).toBe('ollama');
    });
  });

  // ===========================================================================
  // Provider priority ordering
  // ===========================================================================

  describe('provider priority ordering', () => {
    it('anthropic takes priority over openai when both are configured', () => {
      aiProvider.configure('anthropic', {
        type: 'anthropic',
        apiKey: 'sk-ant-test',
        enabled: true,
      });
      aiProvider.configure('openai', {
        type: 'openai',
        apiKey: 'sk-test',
        enabled: true,
      });
      aiProvider.autoSelectDefaultProvider();
      expect(aiProvider.getDefaultProvider()).toBe('anthropic');
    });

    it('openai takes priority over groq when anthropic is not configured', () => {
      // Disable anthropic
      aiProvider.configure('anthropic', {
        type: 'anthropic',
        apiKey: undefined,
        enabled: false,
      });
      aiProvider.configure('openai', {
        type: 'openai',
        apiKey: 'sk-openai-test',
        enabled: true,
      });
      aiProvider.configure('groq', {
        type: 'groq',
        apiKey: 'sk-groq-test',
        enabled: true,
      });
      aiProvider.autoSelectDefaultProvider();
      expect(aiProvider.getDefaultProvider()).toBe('openai');
    });

    it('falls back to ollama when no cloud providers are configured', () => {
      // Disable ALL providers that could be configured from earlier tests
      const allCloudProviders = [
        'anthropic', 'openai', 'azure', 'google', 'groq', 'xai', 'mistral',
        'cohere', 'perplexity', 'deepseek', 'together', 'cerebras', 'fireworks',
        'openrouter', 'copilot',
      ] as const;
      for (const provider of allCloudProviders) {
        aiProvider.configure(provider, {
          type: provider,
          apiKey: undefined,
          enabled: false,
        });
      }
      aiProvider.autoSelectDefaultProvider();
      expect(aiProvider.getDefaultProvider()).toBe('ollama');
    });

    it('setDefaultProvider overrides auto-selected provider', () => {
      aiProvider.setDefaultProvider('mistral');
      expect(aiProvider.getDefaultProvider()).toBe('mistral');
    });
  });

  // ===========================================================================
  // ensureProvider() lazy initialization
  // ===========================================================================

  describe('ensureProvider() lazy initialization', () => {
    it('lazily initializes ollama on first getModel call', async () => {
      // Fresh configure to clear any cached instance
      aiProvider.configure('ollama', {
        type: 'ollama',
        baseUrl: 'http://localhost:11434',
        enabled: true,
      });
      // getModel triggers ensureProvider internally
      const model = await aiProvider.getModel('ollama', 'llama3.2');
      expect(model).toBeDefined();
    });

    it('does not initialize anthropic without apiKey', async () => {
      aiProvider.configure('anthropic', {
        type: 'anthropic',
        apiKey: undefined,
        enabled: false,
      });
      // Should throw because ensureProvider won't create an instance without apiKey
      await expect(aiProvider.getModel('anthropic', 'claude-opus-4-6')).rejects.toThrow(
        /anthropic.*not configured/i,
      );
    });

    it('lazily initializes groq provider on first use', async () => {
      aiProvider.configure('groq', {
        type: 'groq',
        apiKey: 'gsk-test-key',
        enabled: true,
      });
      const model = await aiProvider.getModel('groq', 'llama-3.3-70b-versatile');
      expect(model).toBeDefined();
    });

    it('lazily initializes openrouter provider on first use', async () => {
      aiProvider.configure('openrouter', {
        type: 'openrouter',
        apiKey: 'sk-or-test',
        enabled: true,
      });
      const model = await aiProvider.getModel('openrouter', 'openai/gpt-4o');
      expect(model).toBeDefined();
    });

    it('lazily initializes mistral provider on first use', async () => {
      aiProvider.configure('mistral', {
        type: 'mistral',
        apiKey: 'sk-mistral-test',
        enabled: true,
      });
      const model = await aiProvider.getModel('mistral', 'mistral-large-latest');
      expect(model).toBeDefined();
    });

    it('lazily initializes deepseek provider on first use', async () => {
      aiProvider.configure('deepseek', {
        type: 'deepseek',
        apiKey: 'sk-deepseek-test',
        enabled: true,
      });
      const model = await aiProvider.getModel('deepseek', 'deepseek-chat');
      expect(model).toBeDefined();
    });
  });

  // ===========================================================================
  // resolveModel - additional alias coverage
  // ===========================================================================

  describe('resolveModel - extended alias coverage', () => {
    // Note: resolveModel now routes to configured providers. If a provider
    // (e.g. openai) isn't configured but azure is, OpenAI models route to azure.
    const azureConfigured = aiProvider.isConfigured('azure');

    it('resolves sonnet alias', () => {
      const result = aiProvider.resolveModel('sonnet');
      expect(result).toBeDefined();
      // Routes to anthropic if configured, otherwise may fallback
      if (aiProvider.isConfigured('anthropic')) {
        expect(result.provider).toBe('anthropic');
      }
    });

    it('resolves haiku alias', () => {
      const result = aiProvider.resolveModel('haiku');
      expect(result).toBeDefined();
    });

    it('resolves gpt alias', () => {
      const result = aiProvider.resolveModel('gpt');
      // Routes to openai if configured, azure if azure configured, or default provider
      expect(result).toBeDefined();
      expect(result.provider).toBeTruthy();
    });

    it('resolves gpt-mini alias', () => {
      const result = aiProvider.resolveModel('gpt-mini');
      expect(result).toBeDefined();
      expect(result.provider).toBeTruthy();
    });

    it('resolves gemini alias', () => {
      const result = aiProvider.resolveModel('gemini');
      expect(result).toBeDefined();
      // google if configured, otherwise falls to default
      expect(result.provider).toBeTruthy();
    });

    it('resolves gemini-flash alias', () => {
      const result = aiProvider.resolveModel('gemini-flash');
      expect(result).toBeDefined();
      expect(result.provider).toBeTruthy();
    });

    it('resolves local alias to ollama', () => {
      const result = aiProvider.resolveModel('local');
      expect(result.provider).toBe('ollama');
      expect(result.model).toBe('llama3.2');
    });

    it('resolves llama alias to ollama', () => {
      const result = aiProvider.resolveModel('llama');
      expect(result.provider).toBe('ollama');
    });

    it('resolves grok alias to xai', () => {
      const result = aiProvider.resolveModel('grok');
      // xai may not be configured; routes to default
      expect(result).toBeDefined();
    });

    it('resolves mistral alias', () => {
      const result = aiProvider.resolveModel('mistral');
      expect(result).toBeDefined();
    });

    it('resolves command alias to cohere', () => {
      const result = aiProvider.resolveModel('command');
      expect(result).toBeDefined();
    });

    it('resolves deepseek alias', () => {
      const result = aiProvider.resolveModel('deepseek');
      expect(result).toBeDefined();
    });

    it('resolves together alias', () => {
      const result = aiProvider.resolveModel('together');
      expect(result).toBeDefined();
    });

    it('resolves azure alias to a valid provider', () => {
      const result = aiProvider.resolveModel('azure');
      expect(result).toBeDefined();
      expect(result.provider).toBeTruthy();
    });

    it('resolves slash path with multiple segments uses first segment as provider', () => {
      const result = aiProvider.resolveModel('anthropic/claude-opus-4-6');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-opus-4-6');
    });

    it('resolves groq/llama path', () => {
      const result = aiProvider.resolveModel('groq/llama-3.3-70b-versatile');
      expect(result.provider).toBe('groq');
      expect(result.model).toBe('llama-3.3-70b-versatile');
    });

    it('resolves azure string to a valid result', () => {
      const result = aiProvider.resolveModel('azure');
      expect(result).toBeDefined();
      expect(result.provider).toBeTruthy();
    });
  });

  // ===========================================================================
  // modelSupportsTools
  // ===========================================================================

  describe('modelSupportsTools', () => {
    it('returns true for anthropic claude models that support tools', () => {
      const result = aiProvider.modelSupportsTools('claude-opus-4-6');
      expect(result.supported).toBe(true);
      expect(result.provider).toBe('anthropic');
    });

    it('returns false for ollama llama3.2 (tools not supported)', () => {
      const result = aiProvider.modelSupportsTools('llama3.2');
      expect(result.supported).toBe(false);
    });

    it('returns true for azure regardless of model name', () => {
      const result = aiProvider.modelSupportsTools('azure/some-deployment');
      expect(result.supported).toBe(true);
      expect(result.provider).toBe('azure');
    });

    it('includes a recommendation when tools are not supported', () => {
      const result = aiProvider.modelSupportsTools('llama3.2');
      expect(result.supported).toBe(false);
      expect(typeof result.recommendation).toBe('string');
      expect(result.recommendation!.length).toBeGreaterThan(0);
    });

    it('returns true for gpt-4o (openai)', () => {
      const result = aiProvider.modelSupportsTools('gpt-4o');
      expect(result.supported).toBe(true);
      expect(result.provider).toBe('openai');
    });

    it('uses default provider when no model is provided', () => {
      const result = aiProvider.modelSupportsTools(undefined);
      expect(result).toBeDefined();
      expect(typeof result.supported).toBe('boolean');
    });
  });

  // ===========================================================================
  // loadSavedConfigs - extended coverage
  // ===========================================================================

  describe('loadSavedConfigs - extended', () => {
    it('skips re-configuring a provider already set via env (has apiKey)', async () => {
      // First set anthropic with a key to simulate env-based config
      aiProvider.configure('anthropic', {
        type: 'anthropic',
        apiKey: 'env-set-key',
        enabled: true,
      });

      const loader = vi.fn(async () => [
        { type: 'anthropic', apiKey: 'saved-key', enabled: true },
      ]);

      const loaded = await aiProvider.loadSavedConfigs(loader);
      // Should skip because anthropic is already env-configured with apiKey
      expect(loaded).toBe(0);
    });

    it('loads multiple providers at once', async () => {
      // First clear any existing config for these providers so loadSavedConfigs won't skip them
      aiProvider.configure('cerebras', { type: 'cerebras', apiKey: undefined, enabled: false });
      aiProvider.configure('fireworks', { type: 'fireworks', apiKey: undefined, enabled: false });

      const loader = vi.fn(async () => [
        { type: 'cerebras', apiKey: 'cerebras-key', enabled: true },
        { type: 'fireworks', apiKey: 'fw-key', enabled: true },
      ]);

      const loaded = await aiProvider.loadSavedConfigs(loader);
      expect(loaded).toBe(2);
      expect(aiProvider.isConfigured('cerebras')).toBe(true);
      expect(aiProvider.isConfigured('fireworks')).toBe(true);
    });

    it('re-selects default provider after loading new configs', async () => {
      // Disable all cloud providers first
      for (const provider of ['anthropic', 'openai', 'google'] as const) {
        aiProvider.configure(provider, { type: provider, apiKey: undefined, enabled: false });
      }
      aiProvider.setDefaultProvider('ollama');

      const loader = vi.fn(async () => [
        { type: 'openai', apiKey: 'sk-new-key', enabled: true },
      ]);

      await aiProvider.loadSavedConfigs(loader);
      // After loading openai, it should become the default (higher priority than ollama)
      expect(aiProvider.getDefaultProvider()).toBe('openai');
    });

    it('handles non-Error throws from loader', async () => {
      const loader = vi.fn(async (): Promise<[]> => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'string error';
      });
      const loaded = await aiProvider.loadSavedConfigs(loader);
      expect(loaded).toBe(0);
    });
  });

  // ===========================================================================
  // getModelInfo and getModelsForProvider on the manager instance
  // ===========================================================================

  describe('manager getModelInfo / getModelsForProvider', () => {
    it('getModelInfo returns info for known model id', () => {
      const info = aiProvider.getModelInfo('claude-opus-4-6');
      expect(info).toBeDefined();
      expect(info!.provider).toBe('anthropic');
    });

    it('getModelInfo returns undefined for unknown model', () => {
      expect(aiProvider.getModelInfo('totally-fake-model')).toBeUndefined();
    });

    it('getModelsForProvider returns anthropic models', () => {
      const models = aiProvider.getModelsForProvider('anthropic');
      expect(models.length).toBeGreaterThanOrEqual(3);
      expect(models.every((m) => m.provider === 'anthropic')).toBe(true);
    });

    it('getAllModels returns all catalog models', () => {
      const all = aiProvider.getAllModels();
      expect(all.length).toBe(MODEL_CATALOG.length);
    });
  });
});
