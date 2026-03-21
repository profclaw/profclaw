/**
 * SSE Stream Client
 *
 * Connects to the profClaw chat API and streams events.
 * Handles both simple streaming (content deltas) and agentic mode
 * (tool calls, thinking, step progress).
 *
 * @package profclaw-interactive (future standalone)
 */

import type { ServerConfig, SSEEvent } from './types.js';

export interface StreamOptions {
  conversationId: string;
  content: string;
  model?: string;
  provider?: string;
  agentic?: boolean;
  showThinking?: boolean;
  effort?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
}

export type StreamEventHandler = (event: SSEEvent) => void;

/**
 * Send a message and stream the response via SSE.
 * Yields parsed SSE events as they arrive.
 */
export async function* streamChat(
  config: ServerConfig,
  options: StreamOptions,
): AsyncGenerator<SSEEvent> {
  // Always use the agentic endpoint - it has tools, context, skills, history.
  // The /completions endpoint is a raw LLM call with nothing.
  // profClaw IS an agent - there's no reason to use the dumb endpoint.
  const endpoint = `/api/chat/conversations/${options.conversationId}/messages/agentic`;

  // Smart routing: simple messages use fast /completions, complex ones use agentic
  const needsTools = /search|find|build|create|deploy|fix|write|read|run|exec|check|test|git|install|fetch|look up|what is|tell me about/i.test(options.content);
  const isSimple = options.content.length < 30 && !needsTools;

  // For simple messages, use fast streaming completions (no tools = ~100 tokens vs 75K)
  if (isSimple) {
    const endpoint = `/api/chat/completions`;
    const body: Record<string, unknown> = {
      messages: [{ role: 'user', content: options.content }],
      model: options.model,
      stream: true,
      conversationId: options.conversationId,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    };
    if (config.apiToken) headers['Authorization'] = `Bearer ${config.apiToken}`;

    const response = await fetch(`${config.baseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok || !response.body) {
      // Fallback to agentic on error
      yield* streamAgenticChat(config, options);
      return;
    }

    // Parse simple SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          try {
            const parsed = JSON.parse(trimmed.slice(6)) as Record<string, unknown>;
            if (parsed.content) {
              yield { type: 'content_delta', data: { content: parsed.content }, timestamp: Date.now() };
            }
            if (parsed.done) {
              yield { type: 'complete', data: { usage: parsed.usage, finishReason: parsed.finishReason }, timestamp: Date.now() };
            }
            if (parsed.error) {
              yield { type: 'error', data: { message: parsed.error }, timestamp: Date.now() };
            }
          } catch { /* skip */ }
        }
      }
    } finally { reader.releaseLock(); }
    return;
  }

  // Complex messages: use the full agentic endpoint
  yield* streamAgenticChat(config, options);
}

async function* streamAgenticChat(
  config: ServerConfig,
  options: StreamOptions,
): AsyncGenerator<SSEEvent> {
  const endpoint = `/api/chat/conversations/${options.conversationId}/messages/agentic`;
  const effort = options.effort || 'medium';
  const body: Record<string, unknown> = {
    content: options.content,
    model: options.model,
    provider: options.provider,
    showThinking: options.showThinking ?? false,
    effort,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
  };

  if (config.apiToken) {
    headers['Authorization'] = `Bearer ${config.apiToken}`;
  }

  const response = await fetch(`${config.baseUrl}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let errorMsg = `HTTP ${response.status}`;
    if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
      errorMsg = `API route not found (got HTML). Is the server running at ${config.baseUrl}?`;
    } else {
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        errorMsg = (parsed.error as string) || (parsed.message as string) || errorMsg;
      } catch {
        if (text) errorMsg = text.slice(0, 200);
      }
    }
    yield {
      type: 'error',
      data: { message: errorMsg },
      timestamp: Date.now(),
    };
    return;
  }

  if (!response.body) {
    yield {
      type: 'error',
      data: { message: 'No response body (streaming not supported?)' },
      timestamp: Date.now(),
    };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete last line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue; // Skip comments/empty

        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6);
          try {
            const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

            // Handle simple streaming format (content deltas)
            if ('content' in parsed && !('type' in parsed)) {
              yield {
                type: 'content_delta',
                data: { content: parsed.content },
                timestamp: Date.now(),
              };
              continue;
            }

            // Handle done event
            if ('done' in parsed && parsed.done === true) {
              yield {
                type: 'complete',
                data: {
                  usage: parsed.usage,
                  finishReason: parsed.finishReason,
                },
                timestamp: Date.now(),
              };
              continue;
            }

            // Handle error event
            if ('error' in parsed && !('type' in parsed)) {
              yield {
                type: 'error',
                data: { message: parsed.error },
                timestamp: Date.now(),
              };
              continue;
            }

            // Handle typed events (agentic mode)
            if ('type' in parsed) {
              yield {
                type: parsed.type as SSEEvent['type'],
                data: (parsed.data as Record<string, unknown>) || parsed,
                timestamp: (parsed.timestamp as number) || Date.now(),
              };
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Create a new conversation on the server.
 */
export async function createConversation(
  config: ServerConfig,
  options: { mode: 'chat' | 'agentic'; presetId?: string },
): Promise<{ conversationId: string } | { error: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.apiToken) {
    headers['Authorization'] = `Bearer ${config.apiToken}`;
  }

  try {
    const response = await fetch(`${config.baseUrl}/api/chat/conversations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        presetId: options.presetId || (options.mode === 'agentic' ? 'agentic' : 'profclaw-assistant'),
      }),
    });

    const text = await response.text();

    // Check for HTML response (SPA fallback)
    if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
      return { error: `API route not available (got HTML). Check that profClaw server is running at ${config.baseUrl} with: profclaw serve` };
    }

    if (!response.ok) {
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        return { error: `Failed to create conversation: ${(parsed.error as string) || `HTTP ${response.status}`}` };
      } catch {
        return { error: `Failed to create conversation: HTTP ${response.status}` };
      }
    }

    try {
      const data = JSON.parse(text) as { conversation?: { id: string } };
      if (!data.conversation?.id) {
        return { error: 'Invalid response from server - no conversation ID returned' };
      }
      return { conversationId: data.conversation.id };
    } catch {
      return { error: `Invalid JSON response from server: ${text.slice(0, 100)}` };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Connection failed';
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
      return { error: `Cannot connect to profClaw server at ${config.baseUrl}. Is it running? Try: profclaw serve` };
    }
    return { error: msg };
  }
}

/**
 * Send a non-streaming message (fallback).
 */
export async function sendMessage(
  config: ServerConfig,
  conversationId: string,
  content: string,
  options?: { model?: string; tools?: boolean },
): Promise<{ content: string; model?: string; usage?: Record<string, unknown>; toolCalls?: unknown[] } | { error: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.apiToken) {
    headers['Authorization'] = `Bearer ${config.apiToken}`;
  }

  const endpoint = options?.tools
    ? `/api/chat/conversations/${conversationId}/messages/with-tools`
    : `/api/chat/conversations/${conversationId}/messages`;

  try {
    const response = await fetch(`${config.baseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        content,
        model: options?.model,
        enableTools: options?.tools,
      }),
    });

    if (!response.ok) {
      return { error: `HTTP ${response.status}` };
    }

    const data = await response.json() as Record<string, unknown>;
    const assistantMessage = data.assistantMessage as Record<string, unknown> | undefined;

    return {
      content: (assistantMessage?.content as string) || (data.content as string) || '',
      model: (assistantMessage?.model as string) || (data.model as string),
      usage: data.usage as Record<string, unknown> | undefined,
      toolCalls: data.toolCalls as unknown[] | undefined,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Request failed' };
  }
}
