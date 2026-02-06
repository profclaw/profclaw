/**
 * Base Provider Adapter
 *
 * Abstract base class for AI provider implementations.
 * Handles common functionality like configuration and model management.
 */

import { randomUUID } from 'node:crypto';
import type {
  AIProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ModelDefinition,
  ProviderConfig,
  ProviderHealth,
  ProviderType,
} from '../types.js';

export abstract class BaseProvider implements AIProvider {
  abstract readonly type: ProviderType;
  abstract readonly name: string;

  protected config: ProviderConfig;
  protected models: ModelDefinition[] = [];

  constructor(config: Partial<ProviderConfig>) {
    this.config = this.createDefaultConfig(config);
  }

  /**
   * Create default configuration for this provider
   */
  protected abstract createDefaultConfig(partial: Partial<ProviderConfig>): ProviderConfig;

  /**
   * Get default models for this provider
   */
  protected abstract getDefaultModels(): ModelDefinition[];

  /**
   * Make the actual API call for completion
   */
  protected abstract doComplete(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse>;

  /**
   * Make the actual API call for streaming completion
   */
  protected abstract doCompleteStream(
    request: ChatCompletionRequest,
    onChunk: (chunk: string) => void
  ): Promise<ChatCompletionResponse>;

  // === AIProvider Interface ===

  configure(config: Partial<ProviderConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): ProviderConfig {
    return { ...this.config };
  }

  abstract healthCheck(): Promise<ProviderHealth>;

  async listModels(): Promise<ModelDefinition[]> {
    if (this.models.length === 0) {
      this.models = this.getDefaultModels();
    }
    return [...this.models];
  }

  getModel(modelId: string): ModelDefinition | undefined {
    return this.models.find((m) => m.id === modelId);
  }

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const model = request.model || this.config.defaultModel || this.models[0]?.id;

    if (!model) {
      throw new Error(`No model specified and no default model configured for ${this.name}`);
    }

    const finalRequest: ChatCompletionRequest = {
      ...request,
      provider: this.type,
      model,
    };

    return this.doComplete(finalRequest);
  }

  async completeStream(
    request: ChatCompletionRequest,
    onChunk: (chunk: string) => void
  ): Promise<ChatCompletionResponse> {
    const model = request.model || this.config.defaultModel || this.models[0]?.id;

    if (!model) {
      throw new Error(`No model specified and no default model configured for ${this.name}`);
    }

    const finalRequest: ChatCompletionRequest = {
      ...request,
      provider: this.type,
      model,
      stream: true,
    };

    return this.doCompleteStream(finalRequest, onChunk);
  }

  // === Helper Methods ===

  /**
   * Create a chat message
   */
  protected createMessage(
    role: ChatMessage['role'],
    content: string,
    options?: Partial<ChatMessage>
  ): ChatMessage {
    return {
      id: randomUUID(),
      role,
      content,
      timestamp: new Date().toISOString(),
      ...options,
    };
  }

  /**
   * Convert messages to provider-specific format
   */
  protected formatMessages(
    messages: ChatMessage[],
    systemPrompt?: string
  ): Array<{ role: string; content: string }> {
    const formatted: Array<{ role: string; content: string }> = [];

    // Add system prompt if provided
    if (systemPrompt) {
      formatted.push({ role: 'system', content: systemPrompt });
    }

    // Add conversation messages
    for (const msg of messages) {
      formatted.push({
        role: msg.role,
        content: msg.content,
      });
    }

    return formatted;
  }

  /**
   * Calculate cost from token usage
   */
  protected calculateCost(
    promptTokens: number,
    completionTokens: number,
    modelId?: string
  ): number {
    const model = modelId ? this.getModel(modelId) : this.models.find((m) => m.isDefault);
    if (!model?.cost) {
      return 0;
    }

    const inputCost = (promptTokens / 1_000_000) * model.cost.inputPerMillion;
    const outputCost = (completionTokens / 1_000_000) * model.cost.outputPerMillion;

    return inputCost + outputCost;
  }
}
