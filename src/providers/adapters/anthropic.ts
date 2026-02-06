/**
 * Anthropic Provider Adapter
 *
 * Claude models via Anthropic API.
 * Supports streaming, vision, and tool use.
 *
 * @see https://docs.anthropic.com/
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
import { ANTHROPIC_MODELS } from '../types.js';
import { BaseProvider } from './base.js';
import { logger } from '../../utils/logger.js';

// Anthropic API types
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; source?: unknown }>;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text' | 'tool_use';
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
  stop_sequence?: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

interface AnthropicStreamEvent {
  type: string;
  index?: number;
  content_block?: {
    type: string;
    text?: string;
  };
  delta?: {
    type: string;
    text?: string;
    stop_reason?: string;
  };
  message?: AnthropicResponse;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class AnthropicProvider extends BaseProvider {
  readonly type: ProviderType = 'anthropic';
  readonly name = 'Anthropic';

  private static readonly API_VERSION = '2023-06-01';
  private static readonly BASE_URL = 'https://api.anthropic.com/v1';

  protected createDefaultConfig(partial: Partial<ProviderConfig>): ProviderConfig {
    return {
      id: 'anthropic',
      type: 'anthropic',
      name: 'Anthropic',
      enabled: true,
      baseUrl: partial.baseUrl || AnthropicProvider.BASE_URL,
      apiKey: partial.apiKey || process.env.ANTHROPIC_API_KEY,
      defaultModel: partial.defaultModel || 'claude-sonnet-4-5',
      maxConcurrent: partial.maxConcurrent || 5,
      timeout: partial.timeout || 300000,
      models: ANTHROPIC_MODELS,
      ...partial,
    };
  }

  protected getDefaultModels(): ModelDefinition[] {
    return ANTHROPIC_MODELS;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const startTime = Date.now();

    if (!this.config.apiKey) {
      return {
        provider: 'anthropic',
        healthy: false,
        latencyMs: Date.now() - startTime,
        message: 'API key not configured',
        lastChecked: new Date().toISOString(),
      };
    }

    try {
      // Anthropic doesn't have a dedicated health endpoint
      // We'll do a minimal messages call with 1 max token
      const response = await fetch(`${this.config.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': AnthropicProvider.API_VERSION,
        },
        body: JSON.stringify({
          model: this.config.defaultModel || 'claude-sonnet-4-5',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
        signal: AbortSignal.timeout(10000),
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as { error?: { message?: string } };
        return {
          provider: 'anthropic',
          healthy: false,
          latencyMs,
          message: error?.error?.message || `API returned ${response.status}`,
          lastChecked: new Date().toISOString(),
        };
      }

      return {
        provider: 'anthropic',
        healthy: true,
        latencyMs,
        message: 'Anthropic API is available',
        availableModels: ANTHROPIC_MODELS.map((m) => m.id),
        lastChecked: new Date().toISOString(),
      };
    } catch (error) {
      return {
        provider: 'anthropic',
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
    if (!this.config.apiKey) {
      throw new Error('Anthropic API key not configured');
    }

    const startTime = Date.now();
    const model = request.model || this.config.defaultModel || 'claude-sonnet-4-5';

    // Build Anthropic messages format
    const messages: AnthropicMessage[] = [];
    for (const msg of request.messages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    const requestBody: Record<string, unknown> = {
      model,
      max_tokens: request.maxTokens || 8192,
      messages,
    };

    if (request.systemPrompt) {
      requestBody.system = request.systemPrompt;
    }

    if (request.temperature !== undefined) {
      requestBody.temperature = request.temperature;
    }

    // Add tools if provided
    if (request.tools && request.tools.length > 0) {
      requestBody.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));
    }

    logger.debug(`[Anthropic] Calling ${model} with ${messages.length} messages`);

    const response = await fetch(`${this.config.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': AnthropicProvider.API_VERSION,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(
        `Anthropic API error: ${response.status} - ${error?.error?.message || 'Unknown error'}`
      );
    }

    const result = (await response.json()) as AnthropicResponse;
    const duration = Date.now() - startTime;

    // Extract text content
    const textContent = result.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('');

    // Extract tool calls
    const toolCalls = result.content
      .filter((c) => c.type === 'tool_use')
      .map((c) => ({
        id: c.id || randomUUID(),
        name: c.name || '',
        arguments: c.input || {},
      }));

    const finishReason =
      result.stop_reason === 'end_turn'
        ? 'stop'
        : result.stop_reason === 'max_tokens'
          ? 'length'
          : result.stop_reason === 'tool_use'
            ? 'tool_calls'
            : 'stop';

    return {
      id: result.id,
      provider: 'anthropic',
      model: result.model,
      message: this.createMessage('assistant', textContent),
      finishReason: finishReason as ChatCompletionResponse['finishReason'],
      usage: {
        promptTokens: result.usage.input_tokens,
        completionTokens: result.usage.output_tokens,
        totalTokens: result.usage.input_tokens + result.usage.output_tokens,
        cost: this.calculateCost(result.usage.input_tokens, result.usage.output_tokens, model),
      },
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      duration,
    };
  }

  protected async doCompleteStream(
    request: ChatCompletionRequest,
    onChunk: (chunk: string) => void
  ): Promise<ChatCompletionResponse> {
    if (!this.config.apiKey) {
      throw new Error('Anthropic API key not configured');
    }

    const startTime = Date.now();
    const model = request.model || this.config.defaultModel || 'claude-sonnet-4-5';

    const messages: AnthropicMessage[] = [];
    for (const msg of request.messages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    const requestBody: Record<string, unknown> = {
      model,
      max_tokens: request.maxTokens || 8192,
      messages,
      stream: true,
    };

    if (request.systemPrompt) {
      requestBody.system = request.systemPrompt;
    }

    if (request.temperature !== undefined) {
      requestBody.temperature = request.temperature;
    }

    const response = await fetch(`${this.config.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': AnthropicProvider.API_VERSION,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(
        `Anthropic API error: ${response.status} - ${error?.error?.message || 'Unknown error'}`
      );
    }

    // Process SSE stream
    let fullContent = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let messageId: string = randomUUID();
    let finishReason: ChatCompletionResponse['finishReason'] = 'stop';

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const event = JSON.parse(data) as AnthropicStreamEvent;

            switch (event.type) {
              case 'message_start':
                if (event.message) {
                  messageId = event.message.id;
                  promptTokens = event.message.usage?.input_tokens || 0;
                }
                break;

              case 'content_block_delta':
                if (event.delta?.text) {
                  fullContent += event.delta.text;
                  onChunk(event.delta.text);
                }
                break;

              case 'message_delta':
                if (event.delta?.stop_reason) {
                  finishReason =
                    event.delta.stop_reason === 'end_turn'
                      ? 'stop'
                      : event.delta.stop_reason === 'max_tokens'
                        ? 'length'
                        : 'stop';
                }
                if (event.usage) {
                  completionTokens = event.usage.output_tokens;
                }
                break;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }

    const duration = Date.now() - startTime;

    return {
      id: messageId,
      provider: 'anthropic',
      model,
      message: this.createMessage('assistant', fullContent),
      finishReason,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        cost: this.calculateCost(promptTokens, completionTokens, model),
      },
      duration,
    };
  }
}

/**
 * Create an Anthropic provider instance
 */
export function createAnthropicProvider(
  config?: Partial<ProviderConfig>
): AnthropicProvider {
  return new AnthropicProvider(config || {});
}
