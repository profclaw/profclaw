/**
 * Ollama Provider Adapter
 *
 * Local LLM inference via Ollama.
 * Supports model auto-discovery and streaming.
 *
 * @see https://ollama.ai/
 */

import { randomUUID } from 'node:crypto';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelDefinition,
  ProviderConfig,
  ProviderHealth,
  ProviderType,
} from '../types.js';
import { BaseProvider } from './base.js';
import { logger } from '../../utils/logger.js';

// Ollama API types
interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
}

interface OllamaTagsResponse {
  models: OllamaModel[];
}

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export class OllamaProvider extends BaseProvider {
  readonly type: ProviderType = 'ollama';
  readonly name = 'Ollama';

  private discoveredModels: ModelDefinition[] = [];

  protected createDefaultConfig(partial: Partial<ProviderConfig>): ProviderConfig {
    return {
      id: 'ollama',
      type: 'ollama',
      name: 'Ollama',
      enabled: true,
      baseUrl: partial.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      defaultModel: partial.defaultModel || process.env.OLLAMA_MODEL || 'llama3.2',
      maxConcurrent: partial.maxConcurrent || 3,
      timeout: partial.timeout || 300000,
      models: [],
      ...partial,
    };
  }

  protected getDefaultModels(): ModelDefinition[] {
    // Default models that are commonly available
    return [
      {
        id: 'llama3.2',
        name: 'Llama 3.2',
        provider: 'ollama',
        capabilities: ['text', 'code'],
        contextWindow: 128000,
        maxOutputTokens: 8192,
        supportsStreaming: true,
        supportsVision: false,
        cost: { inputPerMillion: 0, outputPerMillion: 0 },
        isDefault: true,
      },
      {
        id: 'deepseek-r1:7b',
        name: 'DeepSeek R1 7B',
        provider: 'ollama',
        capabilities: ['text', 'code', 'reasoning'],
        contextWindow: 128000,
        maxOutputTokens: 8192,
        supportsStreaming: true,
        supportsVision: false,
        cost: { inputPerMillion: 0, outputPerMillion: 0 },
        isDefault: false,
      },
      {
        id: 'qwen2.5:14b',
        name: 'Qwen 2.5 14B',
        provider: 'ollama',
        capabilities: ['text', 'code'],
        contextWindow: 128000,
        maxOutputTokens: 8192,
        supportsStreaming: true,
        supportsVision: false,
        cost: { inputPerMillion: 0, outputPerMillion: 0 },
        isDefault: false,
      },
    ];
  }

  /**
   * Discover models from local Ollama instance
   */
  async discoverModels(): Promise<ModelDefinition[]> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        logger.warn(`[Ollama] Failed to discover models: ${response.status}`);
        return [];
      }

      const data = (await response.json()) as OllamaTagsResponse;
      if (!data.models || data.models.length === 0) {
        return [];
      }

      this.discoveredModels = data.models.map((model): ModelDefinition => {
        const modelId = model.name;
        const isReasoning =
          modelId.toLowerCase().includes('r1') ||
          modelId.toLowerCase().includes('reasoning') ||
          modelId.toLowerCase().includes('deepseek');
        const isVision =
          modelId.toLowerCase().includes('vision') ||
          modelId.toLowerCase().includes('llava');

        return {
          id: modelId,
          name: model.details?.family
            ? `${model.details.family} ${model.details.parameter_size || ''}`
            : modelId,
          provider: 'ollama',
          capabilities: isReasoning
            ? ['text', 'code', 'reasoning']
            : isVision
              ? ['text', 'vision']
              : ['text', 'code'],
          contextWindow: 128000,
          maxOutputTokens: 8192,
          supportsStreaming: true,
          supportsVision: isVision,
          cost: { inputPerMillion: 0, outputPerMillion: 0 }, // Free!
          isDefault: false,
        };
      });

      logger.info(`[Ollama] Discovered ${this.discoveredModels.length} models`);
      return this.discoveredModels;
    } catch (error) {
      logger.warn(`[Ollama] Model discovery failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return [];
    }
  }

  async listModels(): Promise<ModelDefinition[]> {
    // Try to discover models first
    const discovered = await this.discoverModels();
    if (discovered.length > 0) {
      this.models = discovered;
      return this.models;
    }

    // Fall back to defaults
    this.models = this.getDefaultModels();
    return this.models;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const startTime = Date.now();

    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        return {
          provider: 'ollama',
          healthy: false,
          latencyMs,
          message: `Ollama API returned ${response.status}`,
          lastChecked: new Date().toISOString(),
        };
      }

      const data = (await response.json()) as OllamaTagsResponse;
      const modelNames = data.models?.map((m) => m.name) || [];

      // Check if default model is available
      const defaultModel = this.config.defaultModel || 'llama3.2';
      const modelAvailable = modelNames.some(
        (name) => name === defaultModel || name.startsWith(`${defaultModel}:`)
      );

      return {
        provider: 'ollama',
        healthy: true,
        latencyMs,
        message: modelAvailable
          ? `Ollama running with ${modelNames.length} models`
          : `Model '${defaultModel}' not found`,
        availableModels: modelNames,
        lastChecked: new Date().toISOString(),
      };
    } catch (error) {
      return {
        provider: 'ollama',
        healthy: false,
        latencyMs: Date.now() - startTime,
        message: error instanceof Error ? error.message : 'Connection failed',
        lastChecked: new Date().toISOString(),
      };
    }
  }

  protected async doComplete(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    const startTime = Date.now();
    const model = request.model || this.config.defaultModel || 'llama3.2';

    const messages = this.formatMessages(request.messages, request.systemPrompt);

    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: {
          temperature: request.temperature || 0.7,
          num_predict: request.maxTokens || 4096,
        },
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
    }

    const result = (await response.json()) as OllamaChatResponse;
    const duration = Date.now() - startTime;

    const promptTokens = result.prompt_eval_count || 0;
    const completionTokens = result.eval_count || 0;

    return {
      id: randomUUID(),
      provider: 'ollama',
      model,
      message: this.createMessage('assistant', result.message?.content || ''),
      finishReason: 'stop',
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        cost: 0, // Free!
      },
      duration,
    };
  }

  protected async doCompleteStream(
    request: ChatCompletionRequest,
    onChunk: (chunk: string) => void
  ): Promise<ChatCompletionResponse> {
    const startTime = Date.now();
    const model = request.model || this.config.defaultModel || 'llama3.2';

    const messages = this.formatMessages(request.messages, request.systemPrompt);

    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        options: {
          temperature: request.temperature || 0.7,
          num_predict: request.maxTokens || 4096,
        },
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
    }

    // Process streaming response
    let fullContent = '';
    let promptTokens = 0;
    let completionTokens = 0;

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter((line) => line.trim());

      for (const line of lines) {
        try {
          const data = JSON.parse(line) as OllamaChatResponse;

          if (data.message?.content) {
            fullContent += data.message.content;
            onChunk(data.message.content);
          }

          if (data.done) {
            promptTokens = data.prompt_eval_count || 0;
            completionTokens = data.eval_count || 0;
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }

    const duration = Date.now() - startTime;

    return {
      id: randomUUID(),
      provider: 'ollama',
      model,
      message: this.createMessage('assistant', fullContent),
      finishReason: 'stop',
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        cost: 0,
      },
      duration,
    };
  }
}

/**
 * Create an Ollama provider instance
 */
export function createOllamaProvider(
  config?: Partial<ProviderConfig>
): OllamaProvider {
  return new OllamaProvider(config || {});
}
