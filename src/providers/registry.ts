/**
 * GLINR AI Provider Registry
 *
 * Central registry for managing AI providers.
 * Handles provider discovery, configuration, and routing.
 */

import { randomUUID } from 'node:crypto';
import type {
  AIProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelAlias,
  ModelDefinition,
  ProviderConfig,
  ProviderHealth,
  ProviderType,
} from './types.js';
import { DEFAULT_MODEL_ALIASES, DEFAULT_MODEL_CATALOG } from './types.js';
import { logger } from '../utils/logger.js';

// === Provider Registry ===

class ProviderRegistry {
  private providers: Map<ProviderType, AIProvider> = new Map();
  private configs: Map<ProviderType, ProviderConfig> = new Map();
  private modelAliases: ModelAlias[] = [...DEFAULT_MODEL_ALIASES];
  private defaultProvider: ProviderType = 'ollama';

  /**
   * Register a provider
   */
  register(provider: AIProvider): void {
    this.providers.set(provider.type, provider);
    logger.info(`[ProviderRegistry] Registered provider: ${provider.name}`);
  }

  /**
   * Get a provider by type
   */
  get(type: ProviderType): AIProvider | undefined {
    return this.providers.get(type);
  }

  /**
   * Get all registered providers
   */
  getAll(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get all registered provider types
   */
  getTypes(): ProviderType[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Set the default provider
   */
  setDefault(type: ProviderType): void {
    if (!this.providers.has(type)) {
      throw new Error(`Provider '${type}' is not registered`);
    }
    this.defaultProvider = type;
  }

  /**
   * Get the default provider
   */
  getDefault(): AIProvider | undefined {
    return this.providers.get(this.defaultProvider);
  }

  /**
   * Configure a provider
   */
  configure(type: ProviderType, config: Partial<ProviderConfig>): void {
    const provider = this.providers.get(type);
    if (!provider) {
      throw new Error(`Provider '${type}' is not registered`);
    }

    const existing = this.configs.get(type) || provider.getConfig();
    const merged: ProviderConfig = {
      ...existing,
      ...config,
      id: existing.id,
      type: existing.type,
    };

    this.configs.set(type, merged);
    provider.configure(merged);
  }

  /**
   * Get provider configuration
   */
  getConfig(type: ProviderType): ProviderConfig | undefined {
    return this.configs.get(type) || this.providers.get(type)?.getConfig();
  }

  /**
   * Add a model alias
   */
  addAlias(alias: ModelAlias): void {
    // Remove existing alias with same name
    this.modelAliases = this.modelAliases.filter((a) => a.alias !== alias.alias);
    this.modelAliases.push(alias);
  }

  /**
   * Resolve model alias to provider/model
   */
  resolveAlias(
    aliasOrModel: string
  ): { provider: ProviderType; model: string } | undefined {
    // Check if it's a direct provider/model reference
    if (aliasOrModel.includes('/')) {
      const [provider, model] = aliasOrModel.split('/');
      return { provider: provider as ProviderType, model };
    }

    // Check aliases
    const alias = this.modelAliases.find(
      (a) => a.alias.toLowerCase() === aliasOrModel.toLowerCase()
    );
    if (alias) {
      return { provider: alias.provider, model: alias.model };
    }

    // Try to find model in any registered provider
    for (const provider of this.providers.values()) {
      const model = provider.getModel(aliasOrModel);
      if (model) {
        return { provider: provider.type, model: model.id };
      }
    }

    return undefined;
  }

  /**
   * Get all available models across all providers
   */
  async listAllModels(): Promise<ModelDefinition[]> {
    const models: ModelDefinition[] = [];

    for (const provider of this.providers.values()) {
      try {
        const providerModels = await provider.listModels();
        models.push(...providerModels);
      } catch (error) {
        logger.warn(`[ProviderRegistry] Failed to list models for ${provider.type}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return models;
  }

  /**
   * Health check all providers
   */
  async healthCheckAll(): Promise<ProviderHealth[]> {
    const results: ProviderHealth[] = [];

    for (const provider of this.providers.values()) {
      try {
        const health = await provider.healthCheck();
        results.push(health);
      } catch (error) {
        results.push({
          provider: provider.type,
          healthy: false,
          message: error instanceof Error ? error.message : 'Health check failed',
          lastChecked: new Date().toISOString(),
        });
      }
    }

    return results;
  }

  /**
   * Complete a chat request
   * Automatically routes to the appropriate provider
   */
  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    let provider: AIProvider | undefined;
    let model: string | undefined;

    // Resolve provider and model
    if (request.provider) {
      provider = this.providers.get(request.provider);
    } else if (request.model) {
      const resolved = this.resolveAlias(request.model);
      if (resolved) {
        provider = this.providers.get(resolved.provider);
        model = resolved.model;
      }
    }

    // Fall back to default provider
    if (!provider) {
      provider = this.getDefault();
    }

    if (!provider) {
      throw new Error('No provider available for chat completion');
    }

    // Use resolved model or provider's default
    const finalRequest: ChatCompletionRequest = {
      ...request,
      provider: provider.type,
      model: model || request.model,
    };

    if (request.stream) {
      // For streaming, we need to collect chunks
      let fullContent = '';
      const response = await provider.completeStream(finalRequest, (chunk) => {
        fullContent += chunk;
      });
      return response;
    }

    return provider.complete(finalRequest);
  }
}

// === Singleton Instance ===

export const providerRegistry = new ProviderRegistry();

// === Helper Functions ===

/**
 * Get the provider registry instance
 */
export function getProviderRegistry(): ProviderRegistry {
  return providerRegistry;
}

/**
 * Register a provider with the registry
 */
export function registerProvider(provider: AIProvider): void {
  providerRegistry.register(provider);
}

/**
 * Complete a chat request using the registry
 */
export async function chat(
  request: ChatCompletionRequest
): Promise<ChatCompletionResponse> {
  return providerRegistry.complete(request);
}

/**
 * Quick helper for simple completions
 */
export async function quickChat(
  prompt: string,
  options: {
    model?: string;
    provider?: ProviderType;
    systemPrompt?: string;
    temperature?: number;
  } = {}
): Promise<string> {
  const response = await providerRegistry.complete({
    messages: [
      {
        id: randomUUID(),
        role: 'user',
        content: prompt,
        timestamp: new Date().toISOString(),
      },
    ],
    model: options.model,
    provider: options.provider,
    systemPrompt: options.systemPrompt,
    temperature: options.temperature ?? 0.7,
    stream: false,
  });

  return response.message.content;
}
