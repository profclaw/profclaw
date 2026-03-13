/**
 * profClaw AI Provider System
 *
 * Built on Vercel AI SDK for production-ready multi-provider support.
 * Supports: Anthropic, OpenAI, Google, Ollama, and more.
 *
 * @see https://sdk.vercel.ai/docs
 */

import { generateText, streamText, tool as createTool, type LanguageModel, jsonSchema } from 'ai';
// Provider SDKs are lazily imported inside ensureProvider() to reduce startup memory
// (each SDK is ~15MB; loading all 6 at startup costs ~100MB even if unused)
import { zodToJsonSchema } from 'zod-to-json-schema';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { normalizeToolSchema } from './schema-utils.js';

// AI provider resilience settings (configurable via env)
const AI_TIMEOUT_MS = parseInt(process.env['AI_PROVIDER_TIMEOUT_MS'] ?? '120000', 10);
const AI_MAX_RETRIES = parseInt(process.env['AI_MAX_RETRIES'] ?? '2', 10);

/**
 * Retry wrapper for transient AI provider failures (429, 503, network errors).
 * Uses exponential backoff with a 10s cap.
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = AI_MAX_RETRIES): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRetryable =
        error instanceof Error &&
        (/429|503|rate.limit|too.many|service.unavailable|ECONNRESET|ETIMEDOUT|fetch.failed/i.test(error.message));
      if (!isRetryable || attempt === maxRetries) throw error;
      const delay = Math.min(1000 * 2 ** attempt, 10000);
      logger.warn(`[AIProvider] Transient error (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms`, {
        component: 'AIProvider',
        error: error.message,
      });
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Unreachable');
}

// Core types & data — single source of truth in core/
import {
  ProviderType,
  PROVIDER_STATUS,
  type ProviderConfig,
  type ProviderStatus,
  type ModelInfo,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  type AIMessage,
} from './core/types.js';
import { MODEL_ALIASES, MODEL_CATALOG } from './core/models.js';

// Re-export for consumers that import from providers/ai-sdk or providers/index
export {
  ProviderType,
  PROVIDER_STATUS,
  MODEL_ALIASES,
  MODEL_CATALOG,
};
export type {
  ProviderConfig,
  ProviderStatus,
  ModelInfo,
  ChatMessage,
  ChatRequest,
  ChatResponse,
};

// Pre-compiled regex patterns for performance (avoid recompilation on each call)
const TOOL_CALL_REGEX = /```tool\s*\n?([\s\S]*?)\n?```/g;

// === Provider Factory ===

// Provider instances are callable (model => LanguageModel) with optional .chat()
type ProviderInstance = ((...args: unknown[]) => unknown) & { chat?: (...args: unknown[]) => unknown };
type ProviderInstances = Record<string, ProviderInstance | undefined>;

// Provider priority for auto-selection (prefer cloud providers over local)
const PROVIDER_PRIORITY: ProviderType[] = [
  'anthropic',  // Claude - best for tools/reasoning
  'openai',     // GPT-4 - excellent all-around
  'azure',      // Azure OpenAI - enterprise
  'google',     // Gemini - good multimodal
  'groq',       // Fast inference
  'xai',        // Grok
  'mistral',    // Mistral
  'deepseek',   // DeepSeek R1
  'together',   // Together AI
  'fireworks',  // Fireworks
  'cerebras',   // Cerebras
  'openrouter', // OpenRouter (many models)
  'cohere',     // Cohere
  'perplexity', // Perplexity (search-focused)
  'copilot',    // GitHub Copilot proxy
  'bedrock',    // AWS Bedrock
  'zhipu',      // Zhipu AI (GLM series)
  'moonshot',   // Moonshot AI (Kimi)
  'qwen',       // Qwen (Alibaba Cloud)
  'replicate',  // Replicate
  'github-models', // GitHub Models
  'volcengine', // Bytedance Doubao
  'byteplus',   // BytePlus
  'qianfan',    // Baidu Qianfan
  'modelstudio', // ModelStudio
  'minimax',    // Minimax
  'xiaomi',     // Xiaomi MiLM
  'huggingface', // HuggingFace Inference
  'nvidia-nim', // NVIDIA NIM
  'watsonx',    // IBM Watsonx
  'vercel-ai',  // Vercel AI Gateway
  'cloudflare-ai', // Cloudflare AI Gateway
  'venice',     // Venice AI
  'kilocode',   // Kilocode
  'ollama',     // Local - lowest priority (often doesn't support tools)
];

class AIProviderManager {
  private providers: ProviderInstances = {};
  private configs: Map<ProviderType, ProviderConfig> = new Map();
  private defaultProvider: ProviderType = 'ollama';

  constructor() {
    // Initialize with environment variables
    this.initFromEnv();
    // Auto-select best provider as default
    this.autoSelectDefaultProvider();
  }

  private initFromEnv(): void {
    // Anthropic
    if (process.env.ANTHROPIC_API_KEY) {
      this.configure('anthropic', {
        type: 'anthropic',
        apiKey: process.env.ANTHROPIC_API_KEY,
        enabled: true,
      });
    }

    // OpenAI
    if (process.env.OPENAI_API_KEY) {
      this.configure('openai', {
        type: 'openai',
        apiKey: process.env.OPENAI_API_KEY,
        enabled: true,
      });
    }

    // Google (supports multiple env var names)
    const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (googleKey) {
      this.configure('google', {
        type: 'google',
        apiKey: googleKey,
        enabled: true,
      });
    }

    // Azure OpenAI (supports both standard and Foundry modes)
    if (process.env.AZURE_OPENAI_API_KEY) {
      // Check if using Foundry (custom base URL) or standard (resource name)
      const baseUrl = process.env.AZURE_OPENAI_BASE_URL || process.env.AZURE_OPENAI_ENDPOINT;
      const resourceName = process.env.AZURE_OPENAI_RESOURCE_NAME;

      if (baseUrl || resourceName) {
        this.configure('azure', {
          type: 'azure',
          apiKey: process.env.AZURE_OPENAI_API_KEY,
          baseUrl: baseUrl,
          resourceName: resourceName,
          deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT_NAME,
          apiVersion: process.env.AZURE_OPENAI_API_VERSION,
          enabled: true,
        });
      }
    }

    // Groq (fast inference)
    if (process.env.GROQ_API_KEY) {
      this.configure('groq', {
        type: 'groq',
        apiKey: process.env.GROQ_API_KEY,
        enabled: true,
      });
    }

    // xAI (Grok)
    if (process.env.XAI_API_KEY) {
      this.configure('xai', {
        type: 'xai',
        apiKey: process.env.XAI_API_KEY,
        enabled: true,
      });
    }

    // Mistral
    if (process.env.MISTRAL_API_KEY) {
      this.configure('mistral', {
        type: 'mistral',
        apiKey: process.env.MISTRAL_API_KEY,
        enabled: true,
      });
    }

    // Cohere
    if (process.env.COHERE_API_KEY) {
      this.configure('cohere', {
        type: 'cohere',
        apiKey: process.env.COHERE_API_KEY,
        enabled: true,
      });
    }

    // Perplexity
    if (process.env.PERPLEXITY_API_KEY) {
      this.configure('perplexity', {
        type: 'perplexity',
        apiKey: process.env.PERPLEXITY_API_KEY,
        enabled: true,
      });
    }

    // DeepSeek
    if (process.env.DEEPSEEK_API_KEY) {
      this.configure('deepseek', {
        type: 'deepseek',
        apiKey: process.env.DEEPSEEK_API_KEY,
        enabled: true,
      });
    }

    // Together AI
    if (process.env.TOGETHER_API_KEY) {
      this.configure('together', {
        type: 'together',
        apiKey: process.env.TOGETHER_API_KEY,
        enabled: true,
      });
    }

    // Cerebras
    if (process.env.CEREBRAS_API_KEY) {
      this.configure('cerebras', {
        type: 'cerebras',
        apiKey: process.env.CEREBRAS_API_KEY,
        enabled: true,
      });
    }

    // Zhipu AI (BigModel / GLM series)
    const zhipuKey = process.env.BIGMODEL_API_KEY || process.env.ZHIPU_API_KEY;
    if (zhipuKey) {
      this.configure('zhipu', {
        type: 'zhipu',
        apiKey: zhipuKey,
        enabled: true,
      });
    }

    // Fireworks
    if (process.env.FIREWORKS_API_KEY) {
      this.configure('fireworks', {
        type: 'fireworks',
        apiKey: process.env.FIREWORKS_API_KEY,
        enabled: true,
      });
    }

    // OpenRouter (100+ models via one API)
    if (process.env.OPENROUTER_API_KEY) {
      this.configure('openrouter', {
        type: 'openrouter',
        apiKey: process.env.OPENROUTER_API_KEY,
        enabled: true,
      });
    }

    // Ollama (always enabled for local usage)
    this.configure('ollama', {
      type: 'ollama',
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      enabled: true,
    });

    // GitHub Copilot proxy (experimental - requires local copilot-api server)
    // See: https://github.com/ericc-ch/copilot-api
    if (process.env.COPILOT_API_URL) {
      this.configure('copilot', {
        type: 'copilot',
        baseUrl: process.env.COPILOT_API_URL,
        enabled: true,
      });
    }

    // Volcengine (Bytedance Doubao)
    if (process.env.VOLCENGINE_API_KEY) {
      this.configure('volcengine', {
        type: 'volcengine',
        apiKey: process.env.VOLCENGINE_API_KEY,
        enabled: true,
      });
    }

    // BytePlus (international Bytedance)
    if (process.env.BYTEPLUS_API_KEY) {
      this.configure('byteplus', {
        type: 'byteplus',
        apiKey: process.env.BYTEPLUS_API_KEY,
        enabled: true,
      });
    }

    // Baidu Qianfan
    if (process.env.QIANFAN_API_KEY) {
      this.configure('qianfan', {
        type: 'qianfan',
        apiKey: process.env.QIANFAN_API_KEY,
        enabled: true,
      });
    }

    // ModelStudio (Alibaba DashScope compatible mode)
    if (process.env.MODELSTUDIO_API_KEY) {
      this.configure('modelstudio', {
        type: 'modelstudio',
        apiKey: process.env.MODELSTUDIO_API_KEY,
        enabled: true,
      });
    }

    // Minimax
    if (process.env.MINIMAX_API_KEY) {
      this.configure('minimax', {
        type: 'minimax',
        apiKey: process.env.MINIMAX_API_KEY,
        enabled: true,
      });
    }

    // Xiaomi MiLM
    if (process.env.XIAOMI_API_KEY) {
      this.configure('xiaomi', {
        type: 'xiaomi',
        apiKey: process.env.XIAOMI_API_KEY,
        enabled: true,
      });
    }

    // HuggingFace Inference
    if (process.env.HUGGINGFACE_API_TOKEN) {
      this.configure('huggingface', {
        type: 'huggingface',
        apiKey: process.env.HUGGINGFACE_API_TOKEN,
        enabled: true,
      });
    }

    // NVIDIA NIM
    if (process.env.NVIDIA_NIM_API_KEY) {
      this.configure('nvidia-nim', {
        type: 'nvidia-nim',
        apiKey: process.env.NVIDIA_NIM_API_KEY,
        enabled: true,
      });
    }

    // Venice AI
    if (process.env.VENICE_API_KEY) {
      this.configure('venice', {
        type: 'venice',
        apiKey: process.env.VENICE_API_KEY,
        enabled: true,
      });
    }

    // Kilocode
    if (process.env.KILOCODE_API_KEY) {
      this.configure('kilocode', {
        type: 'kilocode',
        apiKey: process.env.KILOCODE_API_KEY,
        enabled: true,
      });
    }

    // Vercel AI Gateway
    if (process.env.VERCEL_AI_API_KEY) {
      this.configure('vercel-ai', {
        type: 'vercel-ai',
        apiKey: process.env.VERCEL_AI_API_KEY,
        enabled: true,
      });
    }

    // Cloudflare AI Gateway
    if (process.env.CLOUDFLARE_AI_API_KEY || process.env.CLOUDFLARE_AI_TOKEN) {
      const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
      this.configure('cloudflare-ai', {
        type: 'cloudflare-ai',
        apiKey: process.env.CLOUDFLARE_AI_API_KEY || process.env.CLOUDFLARE_AI_TOKEN,
        baseUrl: accountId
          ? `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`
          : undefined,
        enabled: true,
      });
    }

    // IBM Watsonx
    if (process.env.WATSONX_API_KEY) {
      this.configure('watsonx', {
        type: 'watsonx',
        apiKey: process.env.WATSONX_API_KEY,
        baseUrl: process.env.WATSONX_URL || 'https://us-south.ml.cloud.ibm.com/ml/v1',
        defaultModel: process.env.WATSONX_PROJECT_ID,
        enabled: true,
      });
    }
  }

  configure(type: ProviderType, config: ProviderConfig): void {
    this.configs.set(type, config);
    // Invalidate cached provider instance so ensureProvider() recreates it on next use
    const key = this.providerKey(type);
    delete this.providers[key];
    logger.info(`[AIProvider] Configured ${type}`);
  }

  /** Map hyphenated provider types to camelCase keys for the providers record */
  private providerKey(type: ProviderType): string {
    const keyMap: Partial<Record<ProviderType, string>> = {
      'github-models': 'githubModels',
      'nvidia-nim': 'nvidiaNim',
      'vercel-ai': 'vercelAi',
      'cloudflare-ai': 'cloudflareAi',
    };
    return keyMap[type] ?? type;
  }

  /**
   * Lazily import and instantiate the SDK for a provider on first use.
   * Each SDK is ~15MB; this avoids loading all of them at startup.
   */
  private async ensureProvider(type: ProviderType): Promise<void> {
    const key = this.providerKey(type);
    if (this.providers[key]) return;

    const config = this.configs.get(type);
    if (!config?.enabled && type !== 'ollama') return;

    switch (type) {
      case 'anthropic': {
        if (!config?.apiKey) return;
        const { createAnthropic } = await import('@ai-sdk/anthropic');
        this.providers.anthropic = createAnthropic({
          apiKey: config.apiKey,
          baseURL: config.baseUrl,
        }) as unknown as ProviderInstance;
        break;
      }

      case 'openai': {
        if (!config?.apiKey) return;
        const { createOpenAI } = await import('@ai-sdk/openai');
        this.providers.openai = createOpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseUrl,
        }) as unknown as ProviderInstance;
        break;
      }

      case 'google': {
        if (!config?.apiKey) return;
        const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
        this.providers.google = createGoogleGenerativeAI({
          apiKey: config.apiKey,
          baseURL: config.baseUrl,
        }) as unknown as ProviderInstance;
        break;
      }

      case 'azure': {
        if (!config?.apiKey) return;
        const { createAzure } = await import('@ai-sdk/azure');
        const apiVersion = config.apiVersion || '2024-10-21';
        logger.info(`[AIProvider] Azure using API version: ${apiVersion}`);

        if (config.resourceName) {
          this.providers.azure = createAzure({
            apiKey: config.apiKey,
            resourceName: config.resourceName,
            apiVersion,
          }) as unknown as ProviderInstance;
          logger.info(`[AIProvider] Azure configured with resource: ${config.resourceName}`);
        } else if (config.baseUrl) {
          const endpoint = config.baseUrl.replace(/\/$/, '');
          this.providers.azure = createAzure({
            apiKey: config.apiKey,
            baseURL: endpoint,
            apiVersion,
            useDeploymentBasedUrls: true,
          }) as unknown as ProviderInstance;
          logger.info(`[AIProvider] Azure configured with endpoint: ${endpoint}`);
        } else {
          logger.warn('[AIProvider] Azure API key provided but no endpoint or resource name');
        }

        if (config.defaultModel) {
          logger.info(`[AIProvider] Azure default deployment: ${config.defaultModel}`);
        }
        break;
      }

      case 'ollama': {
        const { createOllama } = await import('ai-sdk-ollama');
        this.providers.ollama = createOllama({
          baseURL: config?.baseUrl || 'http://localhost:11434',
        }) as unknown as ProviderInstance;
        break;
      }

      // All OpenAI-compatible providers share the same SDK
      case 'groq':
      case 'xai':
      case 'mistral':
      case 'cohere':
      case 'perplexity':
      case 'deepseek':
      case 'together':
      case 'cerebras':
      case 'fireworks':
      case 'openrouter':
      case 'zhipu':
      case 'moonshot': {
        if (!config?.apiKey) return;
        const { createOpenAI } = await import('@ai-sdk/openai');
        const baseURLs: Record<string, string> = {
          groq: 'https://api.groq.com/openai/v1',
          xai: 'https://api.x.ai/v1',
          mistral: 'https://api.mistral.ai/v1',
          cohere: 'https://api.cohere.ai/v1',
          perplexity: 'https://api.perplexity.ai',
          deepseek: 'https://api.deepseek.com/v1',
          together: 'https://api.together.xyz/v1',
          cerebras: 'https://api.cerebras.ai/v1',
          fireworks: 'https://api.fireworks.ai/inference/v1',
          openrouter: 'https://openrouter.ai/api/v1',
          zhipu: 'https://open.bigmodel.cn/api/paas/v4',
          moonshot: 'https://api.moonshot.cn/v1',
        };
        this.providers[key] = createOpenAI({
          apiKey: config.apiKey,
          baseURL: baseURLs[type],
        }) as unknown as ProviderInstance;
        break;
      }

      case 'copilot': {
        if (!config?.baseUrl) return;
        const { createOpenAI } = await import('@ai-sdk/openai');
        this.providers.copilot = createOpenAI({
          apiKey: 'copilot',
          baseURL: config.baseUrl,
        }) as unknown as ProviderInstance;
        break;
      }

      case 'github-models': {
        if (!config?.apiKey) return;
        const { createOpenAI } = await import('@ai-sdk/openai');
        this.providers.githubModels = createOpenAI({
          apiKey: config.apiKey,
          baseURL: 'https://models.inference.ai.azure.com',
        }) as unknown as ProviderInstance;
        break;
      }

      case 'replicate': {
        if (!config?.apiKey) return;
        const { createOpenAI } = await import('@ai-sdk/openai');
        this.providers.replicate = createOpenAI({
          apiKey: config.apiKey,
          baseURL: 'https://openai-proxy.replicate.com/v1',
        }) as unknown as ProviderInstance;
        break;
      }

      // New OpenAI-compatible providers
      case 'volcengine':
      case 'byteplus':
      case 'qianfan':
      case 'modelstudio':
      case 'minimax':
      case 'xiaomi':
      case 'huggingface':
      case 'nvidia-nim':
      case 'venice':
      case 'kilocode':
      case 'vercel-ai':
      case 'cloudflare-ai':
      case 'watsonx': {
        if (!config?.apiKey) return;
        const { createOpenAI } = await import('@ai-sdk/openai');
        const newProviderBaseURLs: Record<string, string> = {
          volcengine: 'https://ark.cn-beijing.volces.com/api/v3',
          byteplus: 'https://ark.byteplush.com/api/v3',
          qianfan: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxin',
          modelstudio: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          minimax: 'https://api.minimax.chat/v1',
          xiaomi: 'https://api.xiaomi.com/ai/v1',
          huggingface: 'https://api-inference.huggingface.co/v1',
          'nvidia-nim': 'https://integrate.api.nvidia.com/v1',
          venice: 'https://api.venice.ai/api/v1',
          kilocode: 'https://api.kilocode.ai/v1',
          'vercel-ai': 'https://gateway.ai.vercel.com/v1',
          watsonx: 'https://us-south.ml.cloud.ibm.com/ml/v1',
        };
        // Cloudflare uses a dynamic URL based on account ID (set during configure)
        const baseURL = type === 'cloudflare-ai'
          ? (config.baseUrl || 'https://api.cloudflare.com/client/v4/accounts/unknown/ai/v1')
          : (config.baseUrl || newProviderBaseURLs[type]);
        this.providers[key] = createOpenAI({
          apiKey: config.apiKey,
          baseURL,
        }) as unknown as ProviderInstance;
        break;
      }
    }
  }

  setDefaultProvider(type: ProviderType): void {
    this.defaultProvider = type;
  }

  getDefaultProvider(): ProviderType {
    return this.defaultProvider;
  }

  /**
   * Auto-select the best configured provider as default.
   * Prioritizes cloud providers (that support tools) over Ollama.
   */
  autoSelectDefaultProvider(): void {
    for (const provider of PROVIDER_PRIORITY) {
      const config = this.configs.get(provider);
      if (config?.enabled) {
        // For providers that need API keys, verify they have one
        if (provider !== 'ollama' && provider !== 'copilot') {
          if (!config.apiKey && !config.baseUrl) continue;
        }
        this.defaultProvider = provider;
        logger.info(`[AIProvider] Auto-selected default provider: ${provider}`);
        return;
      }
    }
    // Fallback to ollama if nothing else is configured
    this.defaultProvider = 'ollama';
    logger.info('[AIProvider] Using ollama as default (no cloud providers configured)');
  }

  isConfigured(type: ProviderType): boolean {
    const config = this.configs.get(type);
    return config?.enabled ?? false;
  }

  getConfiguredProviders(): ProviderType[] {
    return Array.from(this.configs.entries())
      .filter(([, config]) => config.enabled)
      .map(([type]) => type);
  }

  /**
   * Load saved provider configurations from storage
   * Call this after storage is initialized
   */
  async loadSavedConfigs(
    loader: () => Promise<Array<{
      type: string;
      apiKey?: string;
      baseUrl?: string;
      resourceName?: string;
      deploymentName?: string;
      apiVersion?: string;
      defaultModel?: string;
      enabled?: boolean;
    }>>
  ): Promise<number> {
    try {
      const savedConfigs = await loader();
      let loaded = 0;

      for (const saved of savedConfigs) {
        // Skip if already configured from env with higher priority
        const existing = this.configs.get(saved.type as ProviderType);
        if (existing?.apiKey && saved.type !== 'ollama') {
          logger.info(`[AI] Skipping saved config for ${saved.type} (already configured from env)`);
          continue;
        }

        // Configure the provider
        this.configure(saved.type as ProviderType, {
          type: saved.type as ProviderType,
          apiKey: saved.apiKey,
          baseUrl: saved.baseUrl,
          resourceName: saved.resourceName,
          deploymentName: saved.deploymentName,
          apiVersion: saved.apiVersion,
          defaultModel: saved.defaultModel,
          enabled: saved.enabled ?? true,
        });

        logger.info(`[AI] Loaded saved config for ${saved.type}`);
        loaded++;
      }

      // Re-evaluate default provider after loading saved configs
      if (loaded > 0) {
        this.autoSelectDefaultProvider();
      }

      return loaded;
    } catch (error) {
      logger.error('[AI] Failed to load saved configs:', error instanceof Error ? error : undefined);
      return 0;
    }
  }

  resolveModel(modelOrAlias: string): { provider: ProviderType; model: string } {
    // Check if it's a full provider/model path
    if (modelOrAlias.includes('/')) {
      const [provider, model] = modelOrAlias.split('/');
      return { provider: provider as ProviderType, model };
    }

    // Check aliases
    const alias = MODEL_ALIASES[modelOrAlias.toLowerCase()];
    if (alias) {
      // For Azure, use the configured deployment name instead of the default alias model
      if (alias.provider === 'azure') {
        const azureConfig = this.configs.get('azure');
        if (azureConfig?.defaultModel) {
          return { provider: 'azure', model: azureConfig.defaultModel };
        }
      }
      return alias;
    }

    // Try to find in catalog
    const catalogModel = MODEL_CATALOG.find((m) => m.id === modelOrAlias);
    if (catalogModel) {
      return { provider: catalogModel.provider, model: catalogModel.id };
    }

    // Default to the auto-selected default provider
    // Use the provider's default model if configured, otherwise use the given model name
    const defaultConfig = this.configs.get(this.defaultProvider);
    const defaultModel = defaultConfig?.defaultModel || modelOrAlias;
    return { provider: this.defaultProvider, model: defaultModel };
  }

  async getModel(provider: ProviderType, modelId: string): Promise<LanguageModel> {
    await this.ensureProvider(provider);

    const key = this.providerKey(provider);
    const instance = this.providers[key];
    if (!instance) {
      const envHints: Record<string, string> = {
        anthropic: 'Set ANTHROPIC_API_KEY.',
        openai: 'Set OPENAI_API_KEY.',
        google: 'Set GOOGLE_API_KEY.',
        azure: 'Set AZURE_OPENAI_API_KEY and AZURE_OPENAI_RESOURCE_NAME.',
        groq: 'Set GROQ_API_KEY.',
        ollama: 'Check Ollama is running.',
        xai: 'Set XAI_API_KEY.',
        mistral: 'Set MISTRAL_API_KEY.',
        cohere: 'Set COHERE_API_KEY.',
        perplexity: 'Set PERPLEXITY_API_KEY.',
        deepseek: 'Set DEEPSEEK_API_KEY.',
        together: 'Set TOGETHER_API_KEY.',
        cerebras: 'Set CEREBRAS_API_KEY.',
        fireworks: 'Set FIREWORKS_API_KEY.',
        openrouter: 'Set OPENROUTER_API_KEY.',
        copilot: 'Set COPILOT_API_URL.',
        volcengine: 'Set VOLCENGINE_API_KEY.',
        byteplus: 'Set BYTEPLUS_API_KEY.',
        qianfan: 'Set QIANFAN_API_KEY.',
        modelstudio: 'Set MODELSTUDIO_API_KEY.',
        minimax: 'Set MINIMAX_API_KEY.',
        xiaomi: 'Set XIAOMI_API_KEY.',
        huggingface: 'Set HUGGINGFACE_API_TOKEN.',
        'nvidia-nim': 'Set NVIDIA_NIM_API_KEY.',
        venice: 'Set VENICE_API_KEY.',
        kilocode: 'Set KILOCODE_API_KEY.',
        'vercel-ai': 'Set VERCEL_AI_API_KEY.',
        'cloudflare-ai': 'Set CLOUDFLARE_AI_API_KEY and CLOUDFLARE_ACCOUNT_ID.',
        watsonx: 'Set WATSONX_API_KEY.',
      };
      throw new Error(`${provider} not configured. ${envHints[provider] || ''}`);
    }

    // Azure uses .chat() method for deployment-based access
    if (provider === 'azure') {
      let deployment = modelId;
      if (modelId === 'default') {
        const azureConfig = this.configs.get('azure');
        deployment = azureConfig?.defaultModel || modelId;
        if (deployment === 'default') {
          throw new Error('Azure deployment not configured. Set defaultModel in Azure config or AZURE_OPENAI_DEPLOYMENT_NAME.');
        }
      }
      return instance.chat!(deployment) as unknown as LanguageModel;
    }

    // OpenAI-compatible providers must use .chat() - the default instance() call
    // uses the Responses API which third-party providers don't support
    const OPENAI_COMPAT_PROVIDERS = new Set([
      'openai', 'groq', 'xai', 'mistral', 'cohere', 'perplexity',
      'deepseek', 'together', 'cerebras', 'fireworks', 'openrouter', 'copilot',
      'zhipu', 'moonshot',
    ]);
    if (OPENAI_COMPAT_PROVIDERS.has(provider) && typeof instance.chat === 'function') {
      return instance.chat(modelId) as unknown as LanguageModel;
    }

    return instance(modelId) as unknown as LanguageModel;
  }

  getModelInfo(modelId: string): ModelInfo | undefined {
    return MODEL_CATALOG.find((m) => m.id === modelId);
  }

  getModelsForProvider(provider: ProviderType): ModelInfo[] {
    return MODEL_CATALOG.filter((m) => m.provider === provider);
  }

  getAllModels(): ModelInfo[] {
    return [...MODEL_CATALOG];
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const startTime = Date.now();

    // Resolve model
    const modelRef = request.model
      ? this.resolveModel(request.model)
      : { provider: this.defaultProvider, model: 'llama3.2' };

    const model: LanguageModel = await this.getModel(modelRef.provider, modelRef.model);

    // Convert messages to AI SDK format
    const messages: AIMessage[] = request.messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    // Add system prompt if provided
    if (request.systemPrompt) {
      messages.unshift({ role: 'system', content: request.systemPrompt });
    }

    try {
      const result = await withRetry(() => generateText({
        model,
        messages,
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: request.maxTokens ?? 4096,
        abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
      }));

      const duration = Date.now() - startTime;
      const modelInfo = this.getModelInfo(modelRef.model);

      // Calculate cost - AI SDK v6 uses usage.totalTokens and similar
      const promptTokens = (result.usage as { promptTokens?: number })?.promptTokens ??
                           (result.usage as { inputTokens?: number })?.inputTokens ?? 0;
      const completionTokens = (result.usage as { completionTokens?: number })?.completionTokens ??
                               (result.usage as { outputTokens?: number })?.outputTokens ?? 0;
      const cost = modelInfo
        ? (promptTokens / 1_000_000) * modelInfo.costPer1MInput +
          (completionTokens / 1_000_000) * modelInfo.costPer1MOutput
        : 0;

      return {
        id: randomUUID(),
        provider: modelRef.provider,
        model: modelRef.model,
        content: result.text,
        finishReason: result.finishReason === 'stop' ? 'stop' : 'length',
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          cost,
        },
        duration,
      };
    } catch (error) {
      logger.error(`[AIProvider] Chat error:`, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  // Streaming configuration for performance (configurable via env vars)
  private static readonly CHUNK_BATCH_SIZE = parseInt(process.env.STREAM_CHUNK_BATCH_SIZE || '64', 10);
  private static readonly CHUNK_BATCH_TIME_MS = parseInt(process.env.STREAM_CHUNK_BATCH_TIME_MS || '30', 10);

  async chatStream(
    request: ChatRequest,
    onChunk: (chunk: string) => void
  ): Promise<ChatResponse> {
    const startTime = Date.now();

    // Resolve model
    const modelRef = request.model
      ? this.resolveModel(request.model)
      : { provider: this.defaultProvider, model: 'llama3.2' };

    const model: LanguageModel = await this.getModel(modelRef.provider, modelRef.model);

    // Convert messages
    const messages: AIMessage[] = request.messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    if (request.systemPrompt) {
      messages.unshift({ role: 'system', content: request.systemPrompt });
    }

    try {
      const result = streamText({
        model,
        messages,
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: request.maxTokens ?? 4096,
        abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });

      // Collect text with batched chunk emission for better performance
      const textParts: string[] = [];
      let chunkBuffer = '';
      let lastFlushTime = Date.now();

      for await (const chunk of result.textStream) {
        textParts.push(chunk);
        chunkBuffer += chunk;

        const now = Date.now();
        const shouldFlush =
          chunkBuffer.length >= AIProviderManager.CHUNK_BATCH_SIZE ||
          now - lastFlushTime >= AIProviderManager.CHUNK_BATCH_TIME_MS;

        if (shouldFlush && chunkBuffer) {
          onChunk(chunkBuffer); // Non-blocking callback
          chunkBuffer = '';
          lastFlushTime = now;
        }
      }

      // Flush any remaining buffer
      if (chunkBuffer) {
        onChunk(chunkBuffer);
      }

      const fullText = textParts.join(''); // O(n) join instead of O(n²) concatenation

      // Get usage (already available from stream result)
      const usage = await result.usage;
      const duration = Date.now() - startTime;
      const modelInfo = this.getModelInfo(modelRef.model);

      const promptTokens = (usage as { promptTokens?: number })?.promptTokens ??
                           (usage as { inputTokens?: number })?.inputTokens ?? 0;
      const completionTokens = (usage as { completionTokens?: number })?.completionTokens ??
                               (usage as { outputTokens?: number })?.outputTokens ?? 0;
      const cost = modelInfo
        ? (promptTokens / 1_000_000) * modelInfo.costPer1MInput +
          (completionTokens / 1_000_000) * modelInfo.costPer1MOutput
        : 0;

      return {
        id: randomUUID(),
        provider: modelRef.provider,
        model: modelRef.model,
        content: fullText,
        finishReason: 'stop',
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          cost,
        },
        duration,
      };
    } catch (error) {
      logger.error(`[AIProvider] Stream error:`, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Chat with tool calling support
   * Handles tool detection and execution manually for better control
   */
  async chatWithTools(request: ChatWithToolsRequest): Promise<ChatWithToolsResponse> {
    const startTime = Date.now();

    // Resolve model
    const modelRef = request.model
      ? this.resolveModel(request.model)
      : { provider: this.defaultProvider, model: 'llama3.2' };

    const model: LanguageModel = await this.getModel(modelRef.provider, modelRef.model);

    // Check if model supports native tools
    const toolSupport = this.modelSupportsTools(modelRef.model || modelRef.provider + '/' + modelRef.model);
    const useNativeTools = toolSupport.supported && request.tools && request.tools.length > 0;

    // Build system prompt (skip manual tool instructions if using native tools)
    let systemPrompt = request.systemPrompt || '';
    const toolResults: ChatWithToolsResponse['toolResults'] = [];
    const detectedToolCalls: ToolCall[] = [];

    // Convert tools for native AI SDK usage
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aiSdkTools: Record<string, any> = {};
    
    if (useNativeTools && request.tools) {
      // Add a reinforcement prompt for local models to ensure they provide arguments
      const toolReminders = request.tools.map(t => `- ${t.name}`).join(', ');
      systemPrompt += `\n\nYou have access to these tools: ${toolReminders}. When using them, YOU MUST PROVIDE ALL REQUIRED ARGUMENTS (like 'url' for web_fetch, 'query' for web_search). Do not call tools with empty arguments.`;

      request.tools.forEach((t) => {
        // Convert Zod schema to JSON Schema for AI SDK v5+
        const rawJsonSchema = zodToJsonSchema(t.parameters as z.ZodType, {
          $refStrategy: 'none',
        });
        // Type cast needed due to minor differences between zod-to-json-schema and AI SDK JSONSchema types
        aiSdkTools[t.name] = createTool({
          description: t.description,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          inputSchema: jsonSchema(rawJsonSchema as any),
        });
      });
    } else if (request.tools && request.tools.length > 0) {
      // Fallback: Manual tool prompting
      const toolDescriptions = request.tools.map((t) => {
        const params = t.parameters;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const shape = (params as any)?._def?.shape || (params as any)?.shape || {};
        const paramList = Object.entries(shape)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map(([key, val]: [string, any]) => `  - ${key}: ${val?._def?.description || 'string'}`)
          .join('\n');
        return `**${t.name}**: ${t.description}\nParameters:\n${paramList}`;
      }).join('\n\n');

      systemPrompt += `\n\n## Available Tools\n\nYou can call the following tools by responding with a JSON block in this exact format:\n\`\`\`tool\n{"tool": "toolName", "args": {"param1": "value1"}}\n\`\`\`\n\nExample:\n\`\`\`tool\n{"tool": "web_search", "args": {"query": "latest typescript features"}}\n\`\`\`\n\n${toolDescriptions}\n\nWhen you need to use a tool, include the tool call in your response. After the tool executes, continue with your response.`;
    }

    // Convert messages to AI SDK format
    const messages: AIMessage[] = request.messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    if (systemPrompt) {
      messages.unshift({ role: 'system', content: systemPrompt });
    }

    try {
      const result = await withRetry(() => generateText({
        model,
        messages,
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: request.maxTokens ?? 4096,
        tools: useNativeTools ? aiSdkTools : undefined,
        abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
      }));

      let finalContent = result.text;

      // Handle native tool calls
      if (useNativeTools && result.toolCalls && result.toolCalls.length > 0) {
        for (const toolCall of result.toolCalls) {
          if (request.executeTools) {
            detectedToolCalls.push({
              id: toolCall.toolCallId,
              name: toolCall.toolName,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              arguments: (toolCall as any).args, 
            });

            // Execute the tool
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const toolResult = await request.executeTools(toolCall.toolName, (toolCall as any).args);
            toolResults.push({
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              result: toolResult,
            });
            
            // For native tools, we don't need to replace content text as the tool calls are structured
          }
        }
      } 
      // Handle manual tool calls (fallback path)
      else if (!useNativeTools) {
        // Parse tool calls from the response (using pre-compiled regex)
        TOOL_CALL_REGEX.lastIndex = 0; // Reset regex state
        let match;

        while ((match = TOOL_CALL_REGEX.exec(result.text)) !== null) {
          try {
            const toolCall = JSON.parse(match[1]);
            if (toolCall.tool && request.executeTools) {
              const toolCallId = randomUUID();
              detectedToolCalls.push({
                id: toolCallId,
                name: toolCall.tool,
                arguments: toolCall.args || {},
              });

              // Execute the tool
              const toolResult = await request.executeTools(toolCall.tool, toolCall.args || {});
              toolResults.push({
                toolCallId,
                toolName: toolCall.tool,
                result: toolResult,
              });

              // Replace the tool call block with the result
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const resultMessage = (toolResult as any)?.message || JSON.stringify(toolResult);
              finalContent = finalContent.replace(match[0], `\n✅ **${toolCall.tool}**: ${resultMessage}\n`);
            }
          } catch {
            // Invalid JSON, skip
          }
        }
      }

      const duration = Date.now() - startTime;
      const modelInfo = this.getModelInfo(modelRef.model);

      const promptTokens = (result.usage as { promptTokens?: number })?.promptTokens ??
                           (result.usage as { inputTokens?: number })?.inputTokens ?? 0;
      const completionTokens = (result.usage as { completionTokens?: number })?.completionTokens ??
                               (result.usage as { outputTokens?: number })?.outputTokens ?? 0;
      const cost = modelInfo
        ? (promptTokens / 1_000_000) * modelInfo.costPer1MInput +
          (completionTokens / 1_000_000) * modelInfo.costPer1MOutput
        : 0;

      return {
        id: randomUUID(),
        provider: modelRef.provider,
        model: modelRef.model,
        content: finalContent,
        finishReason: detectedToolCalls.length > 0 ? 'tool-calls' : (result.finishReason === 'stop' ? 'stop' : 'length'),
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          cost,
        },
        duration,
        toolCalls: detectedToolCalls.length > 0 ? detectedToolCalls : undefined,
        toolResults: toolResults.length > 0 ? toolResults : undefined,
      };
    } catch (error) {
      logger.error(`[AIProvider] Chat with tools error:`, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Check if a model supports native tool calling
   */
  modelSupportsTools(modelOrAlias?: string): { supported: boolean; model: string; provider: ProviderType; recommendation?: string } {
    const modelRef = modelOrAlias
      ? this.resolveModel(modelOrAlias)
      : { provider: this.defaultProvider, model: 'llama3.2' };

    // Azure OpenAI: All GPT-4, GPT-4o, and GPT-3.5-turbo models support function calling
    // We check provider first since Azure deployment names won't be in MODEL_CATALOG
    if (modelRef.provider === 'azure') {
      logger.debug(`[AIProvider] Azure model detected, assuming tool support`, {
        component: 'AIProvider',
        model: modelRef.model,
        provider: modelRef.provider,
      });
      return {
        supported: true,
        model: modelRef.model,
        provider: modelRef.provider,
      };
    }

    const modelInfo = this.getModelInfo(modelRef.model);
    const supportsTools = modelInfo?.supportsTools ?? false;

    // Build recommendation for unsupported models
    let recommendation: string | undefined;
    if (!supportsTools) {
      // Find similar models that support tools
      const alternatives = MODEL_CATALOG.filter(m => m.supportsTools && m.provider !== 'ollama').slice(0, 3);
      if (alternatives.length > 0) {
        recommendation = `This model doesn't support tools. Try: ${alternatives.map(a => a.name).join(', ')}`;
      }
    }

    return {
      supported: supportsTools,
      model: modelRef.model,
      provider: modelRef.provider,
      recommendation,
    };
  }

  /**
   * Chat with native tool calling using Vercel AI SDK
   * This uses the native tool() function for proper multi-step execution
   *
   * NOTE: If the model doesn't support native tool calling, tools will be
   * skipped and a warning will be included in the response.
   */
  async chatWithNativeTools(request: any): Promise<any> {
    const startTime = Date.now();

    // Resolve model
    const modelRef = request.model
      ? this.resolveModel(request.model)
      : { provider: this.defaultProvider, model: 'llama3.2' };

    const model = await this.getModel(modelRef.provider, modelRef.model);

    // Check if model supports native tool calling
    const toolSupport = this.modelSupportsTools(request.model);
    const shouldUseTools = toolSupport.supported && (request.tools?.length ?? 0) > 0;

    // Log warning if tools are requested but not supported
    if ((request.tools?.length ?? 0) > 0 && !toolSupport.supported) {
      logger.warn(`[AIProvider] Model ${modelRef.model} doesn't support native tool calling. Tools disabled.`, {
        component: 'AIProvider',
        model: modelRef.model,
        provider: modelRef.provider,
      });
    }

    // Convert messages to AI SDK format
    const messages: AIMessage[] = request.messages.map((msg: any) => ({
      role: msg.role,
      content: msg.content,
    }));

    // Add system prompt if provided
    if (request.systemPrompt) {
      messages.unshift({ role: 'system', content: request.systemPrompt });
    }

    // Track tool calls and results
    const toolCallHistory: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    const toolResultHistory: Array<{ toolCallId: string; toolName: string; result: unknown; approvalRequired?: boolean; approvalId?: string }> = [];

    // Convert tool definitions to AI SDK format with execute handlers
    // Only build tools if the model supports them
    const tools: Record<string, ReturnType<typeof createTool>> = {};

    // Check if provider is Azure - needs normalized JSON Schema
    const isAzureProvider = modelRef.provider === 'azure';

    if (shouldUseTools) {
      for (const toolDef of request.tools || []) {
        // For Azure, convert Zod schemas to normalized JSON Schema
        // Azure has stricter schema validation requirements
        let inputSchema: unknown = toolDef.parameters;

        if (isAzureProvider && toolDef.parameters) {
          try {
            // Convert Zod schema to JSON Schema
            const rawJsonSchema = zodToJsonSchema(toolDef.parameters as z.ZodType, {
              $refStrategy: 'none',
              target: 'openAi',
            });
            // Normalize for Azure compatibility (removes unsupported keywords, ensures type: object)
            const normalizedSchema = normalizeToolSchema(rawJsonSchema);
            // Wrap in AI SDK's jsonSchema helper for proper typing
            inputSchema = jsonSchema(normalizedSchema);
            logger.debug(`[AIProvider] Normalized schema for Azure tool: ${toolDef.name}`, {
              component: 'AIProvider',
            });
          } catch (schemaError) {
            logger.warn(`[AIProvider] Failed to normalize schema for ${toolDef.name}, using original`, {
              component: 'AIProvider',
              error: schemaError instanceof Error ? schemaError.message : String(schemaError),
            });
          }
        }

        // AI SDK v5+ uses inputSchema instead of parameters
        (tools as any)[toolDef.name] = createTool({
        description: toolDef.description,
        inputSchema: inputSchema as any,
        execute: async (args: any) => {
          const toolCallId = randomUUID();

          // Record the tool call
          toolCallHistory.push({
            id: toolCallId,
            name: toolDef.name,
            arguments: args as Record<string, unknown>,
          });

          // Execute through the provided handler (which goes through security)
          if (request.onToolCall) {
            try {
              const result = await request.onToolCall(toolDef.name, args, toolCallId);

              // Handle approval required case
              if (result.approvalRequired) {
                toolResultHistory.push({
                  toolCallId,
                  toolName: toolDef.name,
                  result: {
                    pending: true,
                    approvalId: result.approvalId,
                    message: `Awaiting approval for ${toolDef.name}`
                  },
                  approvalRequired: true,
                  approvalId: result.approvalId,
                });
                return {
                  pending: true,
                  message: `Tool ${toolDef.name} requires approval. Approval ID: ${result.approvalId}`
                };
              }

              // Record successful result
              toolResultHistory.push({
                toolCallId,
                toolName: toolDef.name,
                result: result.result,
              });

              return result.result;
            } catch (error) {
              const errorResult = {
                success: false,
                error: error instanceof Error ? error.message : 'Tool execution failed',
              };
              toolResultHistory.push({
                toolCallId,
                toolName: toolDef.name,
                result: errorResult,
              });
              return errorResult;
            }
          }

          // No handler provided, return placeholder
          return { error: 'No tool execution handler provided' };
        },
      });
      }
    } // end if (shouldUseTools)

    try {
      const result = await withRetry(() => generateText({
        model,
        messages,
        tools: Object.keys(tools).length > 0 ? tools : undefined,
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: request.maxTokens ?? 4096,
        maxSteps: request.maxToolRoundtrips ?? 5,
        abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
      } as Parameters<typeof generateText>[0]));

      const duration = Date.now() - startTime;
      const modelInfo = this.getModelInfo(modelRef.model);

      // Calculate usage
      const promptTokens = (result.usage as { promptTokens?: number })?.promptTokens ??
                           (result.usage as { inputTokens?: number })?.inputTokens ?? 0;
      const completionTokens = (result.usage as { completionTokens?: number })?.completionTokens ??
                               (result.usage as { outputTokens?: number })?.outputTokens ?? 0;
      const cost = modelInfo
        ? (promptTokens / 1_000_000) * modelInfo.costPer1MInput +
          (completionTokens / 1_000_000) * modelInfo.costPer1MOutput
        : 0;

      // Check if any tool calls require approval
      const pendingApprovals = toolResultHistory.filter(r => r.approvalRequired);

      return {
        id: randomUUID(),
        provider: modelRef.provider,
        model: modelRef.model,
        content: result.text,
        finishReason: pendingApprovals.length > 0
          ? 'approval-required'
          : toolCallHistory.length > 0
            ? 'tool-calls'
            : (result.finishReason === 'stop' ? 'stop' : 'length'),
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          cost,
        },
        duration,
        toolCalls: toolCallHistory.length > 0 ? toolCallHistory : undefined,
        toolResults: toolResultHistory.length > 0 ? toolResultHistory : undefined,
        pendingApprovals: pendingApprovals.length > 0 ? pendingApprovals : undefined,
        steps: result.steps?.length ?? 1,
        // Tool support info for UI warnings
        toolSupport: {
          requested: (request.tools?.length ?? 0) > 0,
          supported: toolSupport.supported,
          used: shouldUseTools,
          recommendation: toolSupport.recommendation,
        },
      };
    } catch (error) {
      logger.error(`[AIProvider] Native tool calling error:`, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Stream chat with native tool calling
   */
  async streamWithNativeTools(
    request: any,
    onChunk: (chunk: string) => void,
    onToolCall?: (toolName: string, args: unknown) => void,
    onToolResult?: (toolName: string, result: unknown) => void,
  ): Promise<any> {
    const startTime = Date.now();

    // Resolve model
    const modelRef = request.model
      ? this.resolveModel(request.model)
      : { provider: this.defaultProvider, model: 'llama3.2' };

    const model = await this.getModel(modelRef.provider, modelRef.model);

    // Convert messages
    const messages: AIMessage[] = request.messages.map((msg: any) => ({
      role: msg.role,
      content: msg.content,
    }));

    if (request.systemPrompt) {
      messages.unshift({ role: 'system', content: request.systemPrompt });
    }

    // Track tool calls
    const toolCallHistory: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    const toolResultHistory: Array<{ toolCallId: string; toolName: string; result: unknown; approvalRequired?: boolean; approvalId?: string }> = [];

    // Build tools with execute handlers
    const tools: Record<string, ReturnType<typeof createTool>> = {};

    // Check if provider is Azure - needs normalized JSON Schema
    const isAzureProvider = modelRef.provider === 'azure';

    for (const toolDef of request.tools || []) {
      // For Azure, convert Zod schemas to normalized JSON Schema
      let inputSchema: unknown = toolDef.parameters;

      if (isAzureProvider && toolDef.parameters) {
        try {
          const rawJsonSchema = zodToJsonSchema(toolDef.parameters as z.ZodType, {
            $refStrategy: 'none',
            target: 'openAi',
          });
          const normalizedSchema = normalizeToolSchema(rawJsonSchema);
          inputSchema = jsonSchema(normalizedSchema);
        } catch {
          // Fall back to original schema
        }
      }

      // AI SDK v5+ uses inputSchema instead of parameters
      (tools as any)[toolDef.name] = createTool({
        description: toolDef.description,
        inputSchema: inputSchema as any,
        execute: async (args: any) => {
          const toolCallId = randomUUID();

          toolCallHistory.push({
            id: toolCallId,
            name: toolDef.name,
            arguments: args as Record<string, unknown>,
          });

          // Notify about tool call
          onToolCall?.(toolDef.name, args);

          if (request.onToolCall) {
            try {
              const result = await request.onToolCall(toolDef.name, args, toolCallId);

              if (result.approvalRequired) {
                toolResultHistory.push({
                  toolCallId,
                  toolName: toolDef.name,
                  result: { pending: true, approvalId: result.approvalId },
                  approvalRequired: true,
                  approvalId: result.approvalId,
                });
                onToolResult?.(toolDef.name, { pending: true, approvalRequired: true });
                return { pending: true, message: `Awaiting approval` };
              }

              toolResultHistory.push({
                toolCallId,
                toolName: toolDef.name,
                result: result.result,
              });

              onToolResult?.(toolDef.name, result.result);
              return result.result;
            } catch (error) {
              const errorResult = {
                success: false,
                error: error instanceof Error ? error.message : 'Failed'
              };
              toolResultHistory.push({
                toolCallId,
                toolName: toolDef.name,
                result: errorResult,
              });
              onToolResult?.(toolDef.name, errorResult);
              return errorResult;
            }
          }

          return { error: 'No handler' };
        },
      });
    }

    try {
      const result = streamText({
        model,
        messages,
        tools: Object.keys(tools).length > 0 ? tools : undefined,
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: request.maxTokens ?? 4096,
        maxSteps: request.maxToolRoundtrips ?? 5,
        abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
      } as Parameters<typeof streamText>[0]);

      let fullText = '';

      for await (const chunk of result.textStream) {
        fullText += chunk;
        onChunk(chunk);
      }

      const usage = await result.usage;
      const duration = Date.now() - startTime;
      const modelInfo = this.getModelInfo(modelRef.model);

      const promptTokens = (usage as { promptTokens?: number })?.promptTokens ??
                           (usage as { inputTokens?: number })?.inputTokens ?? 0;
      const completionTokens = (usage as { completionTokens?: number })?.completionTokens ??
                               (usage as { outputTokens?: number })?.outputTokens ?? 0;
      const cost = modelInfo
        ? (promptTokens / 1_000_000) * modelInfo.costPer1MInput +
          (completionTokens / 1_000_000) * modelInfo.costPer1MOutput
        : 0;

      const pendingApprovals = toolResultHistory.filter(r => r.approvalRequired);

      return {
        id: randomUUID(),
        provider: modelRef.provider,
        model: modelRef.model,
        content: fullText,
        finishReason: pendingApprovals.length > 0
          ? 'approval-required'
          : toolCallHistory.length > 0
            ? 'tool-calls'
            : 'stop',
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          cost,
        },
        duration,
        toolCalls: toolCallHistory.length > 0 ? toolCallHistory : undefined,
        toolResults: toolResultHistory.length > 0 ? toolResultHistory : undefined,
        pendingApprovals: pendingApprovals.length > 0 ? pendingApprovals : undefined,
        steps: 1,
      };
    } catch (error) {
      logger.error(`[AIProvider] Stream with tools error:`, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async healthCheck(provider?: ProviderType): Promise<{
    provider: ProviderType;
    healthy: boolean;
    message: string;
    latencyMs?: number;
  }[]> {
    const results: {
      provider: ProviderType;
      healthy: boolean;
      message: string;
      latencyMs?: number;
    }[] = [];

    const providers = provider
      ? [provider]
      : this.getConfiguredProviders();

    for (const p of providers) {
      const start = Date.now();

      try {
        if (p === 'ollama') {
          // Check Ollama server
          const config = this.configs.get('ollama');
          const baseUrl = config?.baseUrl || 'http://localhost:11434';
          const response = await fetch(`${baseUrl}/api/tags`, {
            signal: AbortSignal.timeout(5000),
          });

          if (response.ok) {
            results.push({
              provider: p,
              healthy: true,
              message: 'Ollama server is running',
              latencyMs: Date.now() - start,
            });
          } else {
            results.push({
              provider: p,
              healthy: false,
              message: `Ollama returned ${response.status}`,
              latencyMs: Date.now() - start,
            });
          }
        } else if (p === 'groq') {
          // Check Groq API
          const config = this.configs.get('groq');
          if (config?.apiKey) {
            try {
              const response = await fetch('https://api.groq.com/openai/v1/models', {
                headers: { Authorization: `Bearer ${config.apiKey}` },
                signal: AbortSignal.timeout(5000),
              });
              results.push({
                provider: p,
                healthy: response.ok,
                message: response.ok ? 'Groq API is accessible' : `Groq returned ${response.status}`,
                latencyMs: Date.now() - start,
              });
            } catch {
              results.push({
                provider: p,
                healthy: false,
                message: 'Groq API unreachable',
                latencyMs: Date.now() - start,
              });
            }
          } else {
            results.push({
              provider: p,
              healthy: false,
              message: 'Groq not configured',
            });
          }
        } else if (p === 'azure') {
          // Azure OpenAI - check if configured (supports both baseUrl and resourceName modes)
          const config = this.configs.get('azure');
          const hasValidConfig = !!(config?.apiKey && (config?.baseUrl || config?.resourceName));
          results.push({
            provider: p,
            healthy: hasValidConfig,
            message: hasValidConfig
              ? `Azure OpenAI configured${config?.baseUrl ? ` (${config.baseUrl})` : config?.resourceName ? ` (${config.resourceName})` : ''}`
              : 'Azure OpenAI not configured',
            latencyMs: Date.now() - start,
          });
        } else {
          // For cloud providers, we assume they're healthy if configured
          results.push({
            provider: p,
            healthy: this.isConfigured(p),
            message: this.isConfigured(p)
              ? `${p} is configured`
              : `${p} not configured`,
          });
        }
      } catch (error) {
        results.push({
          provider: p,
          healthy: false,
          message: error instanceof Error ? error.message : 'Health check failed',
          latencyMs: Date.now() - start,
        });
      }
    }

    return results;
  }
}

// === Singleton Export ===

export const aiProvider = new AIProviderManager();

// === Helper Functions ===

/**
 * Quick chat function
 */
// === Tool Calling Types ===

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodType<unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatWithToolsResponse extends ChatResponse {
  toolCalls?: ToolCall[];
  toolResults?: Array<{
    toolCallId: string;
    toolName: string;
    result: unknown;
  }>;
}

export interface ChatWithToolsRequest extends ChatRequest {
  tools?: ToolDefinition[];
  executeTools?: (toolName: string, args: unknown) => Promise<unknown>;
  maxToolRoundtrips?: number;
}

// === Native Tool Calling Types ===

export interface NativeToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodType<unknown>;
}

export interface NativeToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface NativeToolResult {
  toolCallId: string;
  toolName: string;
  result: unknown;
  approvalRequired?: boolean;
  approvalId?: string;
}

export interface ToolExecutionResult {
  result: unknown;
  /** Human-readable markdown output for UI display (not sent to AI model) */
  output?: string;
  approvalRequired?: boolean;
  approvalId?: string;
}

export interface ChatWithNativeToolsRequest extends ChatRequest {
  tools?: NativeToolDefinition[];
  onToolCall?: (toolName: string, args: unknown, toolCallId: string) => Promise<ToolExecutionResult>;
  maxToolRoundtrips?: number;
}

export interface ChatWithNativeToolsResponse extends ChatResponse {
  toolCalls?: NativeToolCall[];
  toolResults?: NativeToolResult[];
  pendingApprovals?: NativeToolResult[];
  steps?: number;
}

export async function chat(
  prompt: string,
  options?: {
    model?: string;
    systemPrompt?: string;
    temperature?: number;
  }
): Promise<string> {
  const response = await aiProvider.chat({
    messages: [
      {
        id: randomUUID(),
        role: 'user',
        content: prompt,
        timestamp: new Date().toISOString(),
      },
    ],
    model: options?.model,
    systemPrompt: options?.systemPrompt,
    temperature: options?.temperature,
  });

  return response.content;
}

/**
 * Stream chat function
 */
export async function chatStream(
  prompt: string,
  onChunk: (chunk: string) => void,
  options?: {
    model?: string;
    systemPrompt?: string;
    temperature?: number;
  }
): Promise<string> {
  const response = await aiProvider.chatStream(
    {
      messages: [
        {
          id: randomUUID(),
          role: 'user',
          content: prompt,
          timestamp: new Date().toISOString(),
        },
      ],
      model: options?.model,
      systemPrompt: options?.systemPrompt,
      temperature: options?.temperature,
    },
    onChunk
  );

  return response.content;
}
