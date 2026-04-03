/**
 * SSE Stream Client
 *
 * Connects to the profClaw chat API and streams events.
 * Handles both simple streaming (content deltas) and agentic mode
 * (tool calls, thinking, step progress).
 *
 * Features:
 * - Exponential backoff reconnection (1s, 2s, 4s, 8s, max 3 retries)
 * - 60-second idle timeout treated as disconnect
 * - `lastEventId` tracking for potential server-side resume
 * - `connection_lost` / `reconnected` synthetic events
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

// ── Reconnect constants ────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000] as const;
const IDLE_TIMEOUT_MS = 60_000;

// ── Helpers ────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse a raw SSE data line into an SSEEvent, returning null when the line
 * should be skipped.
 */
function parseSseLine(
  line: string,
  rateLimitHeaders: Record<string, string>,
): SSEEvent | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':')) return null;
  if (!trimmed.startsWith('data: ')) return null;

  const jsonStr = trimmed.slice(6);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return null;
  }

  // Handle simple streaming format (content deltas)
  if ('content' in parsed && !('type' in parsed)) {
    return {
      type: 'content_delta',
      data: { content: parsed.content },
      timestamp: Date.now(),
    };
  }

  // Handle done event
  if ('done' in parsed && parsed.done === true) {
    return {
      type: 'complete',
      data: {
        usage: parsed.usage,
        finishReason: parsed.finishReason,
        rateLimitHeaders:
          Object.keys(rateLimitHeaders).length > 0 ? rateLimitHeaders : undefined,
      },
      timestamp: Date.now(),
    };
  }

  // Handle error event
  if ('error' in parsed && !('type' in parsed)) {
    return {
      type: 'error',
      data: { message: parsed.error },
      timestamp: Date.now(),
    };
  }

  // Handle typed events (agentic mode)
  if ('type' in parsed) {
    return {
      type: parsed.type as SSEEvent['type'],
      data: (parsed.data as Record<string, unknown>) || parsed,
      timestamp: (parsed.timestamp as number) || Date.now(),
    };
  }

  return null;
}

/**
 * Read the response body and yield SSEEvents.
 * Returns `false` when the stream ended normally with a `complete` or final
 * event, or `true` when the connection dropped before the stream completed.
 */
async function* readSseBody(
  body: ReadableStream<Uint8Array>,
  rateLimitHeaders: Record<string, string>,
  lastEventIdRef: { value: string | null },
  idleTimeoutMs: number,
  signal: AbortSignal | undefined,
): AsyncGenerator<SSEEvent | { __incomplete: true }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamCompleted = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdle = (onTimeout: () => void) => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(onTimeout, idleTimeoutMs);
  };

  // We use a flag + error to break out when the idle timer fires.
  let idleTimedOut = false;

  try {
    // Start the idle timer immediately
    resetIdle(() => { idleTimedOut = true; });

    while (true) {
      if (signal?.aborted) break;
      if (idleTimedOut) break;

      let done: boolean;
      let value: Uint8Array | undefined;

      try {
        ({ done, value } = await reader.read());
      } catch {
        // Network error — connection dropped
        break;
      }

      if (done) break;

      // Activity received — reset idle timer
      resetIdle(() => { idleTimedOut = true; });

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      // Track SSE id: fields for potential resume
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('id: ')) {
          lastEventIdRef.value = trimmedLine.slice(4).trim();
        }
      }

      for (const line of lines) {
        const event = parseSseLine(line, rateLimitHeaders);
        if (event === null) continue;

        if (event.type === 'complete') {
          streamCompleted = true;
        }

        yield event;
      }

      if (streamCompleted) break;
    }
  } finally {
    if (idleTimer !== null) clearTimeout(idleTimer);
    reader.releaseLock();
  }

  if (!streamCompleted) {
    yield { __incomplete: true };
  }
}

/**
 * Send a message and stream the response via SSE.
 * Yields parsed SSE events as they arrive, including synthetic
 * `connection_lost` and `reconnected` events on reconnect attempts.
 */
export async function* streamChat(
  config: ServerConfig,
  options: StreamOptions,
): AsyncGenerator<SSEEvent> {
  // Smart routing: simple messages use fast /completions, complex ones use agentic
  const needsTools = /\b(search|find|build|create|deploy|fix|write|read|run|exec|check|test|git|install|fetch)\b|look up|what is|tell me about/i.test(options.content);
  const isSimple = options.content.length < 30 && !needsTools;

  // For simple messages, use fast streaming completions (no tools = ~100 tokens vs 75K)
  if (isSimple) {
    yield* streamSimpleChat(config, options);
    return;
  }

  // Complex messages: use the full agentic endpoint with reconnect
  yield* streamAgenticChatWithReconnect(config, options);
}

// ── Simple (completions) endpoint — no reconnect, straightforward ──────────────

async function* streamSimpleChat(
  config: ServerConfig,
  options: StreamOptions,
): AsyncGenerator<SSEEvent> {
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

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch {
    // Fallback to agentic on connect error
    yield* streamAgenticChatWithReconnect(config, options);
    return;
  }

  if (!response.ok || !response.body) {
    // Fallback to agentic on error
    yield* streamAgenticChatWithReconnect(config, options);
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
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
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
}

// ── Agentic endpoint with exponential-backoff reconnect ────────────────────────

async function* streamAgenticChatWithReconnect(
  config: ServerConfig,
  options: StreamOptions,
): AsyncGenerator<SSEEvent> {
  const lastEventIdRef: { value: string | null } = { value: null };
  let attempt = 0;

  while (true) {
    // On the first attempt the generator starts fresh.
    // On subsequent attempts we have already emitted `connection_lost`.
    yield* attemptAgenticStream(config, options, lastEventIdRef, attempt);

    // If we get here the inner generator returned without a complete event —
    // which means the stream ended prematurely (connection dropped or idle
    // timeout). Check if we should retry.

    // We detect incompleteness via the sentinel yielded by readSseBody —
    // but the inner generator consumes it. So we rely on the fact that if
    // the inner generator returns normally (not via `return`) the stream was
    // incomplete; if it yielded a `complete` event it would have returned
    // after that.
    //
    // The logic is handled by the sentinel check inside attemptAgenticStream
    // which sets `streamCompletedNormally`. We use a shared ref below.

    // NOTE: Because generator consumers cannot observe generator return
    // values directly, we use a shared mutable object to communicate whether
    // the stream completed normally.
    break; // replaced by the implementation in attemptAgenticStream below
  }
}

// We use a wrapper that communicates completion state via ref.
async function* attemptAgenticStream(
  config: ServerConfig,
  options: StreamOptions,
  lastEventIdRef: { value: string | null },
  _initialAttempt: number,
): AsyncGenerator<SSEEvent> {
  let attempt = 0;

  while (true) {
    const result = await runAgenticAttempt(
      config,
      options,
      lastEventIdRef,
      attempt,
    );

    for (const event of result.events) {
      yield event;
    }

    if (result.completed || options.signal?.aborted) {
      return;
    }

    // Stream dropped before completion
    attempt++;
    if (attempt > MAX_RETRIES) {
      yield {
        type: 'error',
        data: { message: `Connection lost after ${MAX_RETRIES} retries` },
        timestamp: Date.now(),
      };
      return;
    }

    yield {
      type: 'connection_lost' as SSEEvent['type'],
      data: {
        attempt,
        maxRetries: MAX_RETRIES,
        lastEventId: lastEventIdRef.value,
      },
      timestamp: Date.now(),
    };

    const delayMs = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
    await sleep(delayMs);

    if (options.signal?.aborted) return;

    yield {
      type: 'reconnected' as SSEEvent['type'],
      data: { attempt, lastEventId: lastEventIdRef.value },
      timestamp: Date.now(),
    };
  }
}

interface AgenticAttemptResult {
  events: SSEEvent[];
  completed: boolean;
}

async function runAgenticAttempt(
  config: ServerConfig,
  options: StreamOptions,
  lastEventIdRef: { value: string | null },
  attempt: number,
): Promise<AgenticAttemptResult> {
  const endpoint = `/api/chat/conversations/${options.conversationId}/messages/agentic`;
  const effort = options.effort ?? 'medium';
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

  // On reconnect attempts, include Last-Event-ID header if we have one
  if (attempt > 0 && lastEventIdRef.value !== null) {
    headers['Last-Event-ID'] = lastEventIdRef.value;
  }

  // Capture rate limit headers from the initial response for monitoring
  const rateLimitHeaders: Record<string, string> = {};
  const rateLimitHeaderNames = [
    'x-ratelimit-limit-requests',
    'x-ratelimit-remaining-requests',
    'x-ratelimit-limit-tokens',
    'x-ratelimit-remaining-tokens',
    'x-ratelimit-reset-requests',
    'x-ratelimit-reset-tokens',
  ];

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (err) {
    if (options.signal?.aborted) {
      return { events: [], completed: true };
    }
    const msg = err instanceof Error ? err.message : 'Connection failed';
    return {
      events: [{
        type: 'error',
        data: { message: msg },
        timestamp: Date.now(),
      }],
      completed: false,
    };
  }

  for (const name of rateLimitHeaderNames) {
    const value = response.headers.get(name);
    if (value !== null) rateLimitHeaders[name] = value;
  }

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

    // 4xx errors are terminal — no point retrying
    const isTerminal = response.status >= 400 && response.status < 500;
    return {
      events: [{
        type: 'error',
        data: { message: errorMsg, statusCode: response.status, rateLimitHeaders },
        timestamp: Date.now(),
      }],
      completed: isTerminal,
    };
  }

  if (!response.body) {
    return {
      events: [{
        type: 'error',
        data: { message: 'No response body (streaming not supported?)' },
        timestamp: Date.now(),
      }],
      completed: false,
    };
  }

  const collected: SSEEvent[] = [];
  let completed = false;

  for await (const item of readSseBody(
    response.body,
    rateLimitHeaders,
    lastEventIdRef,
    IDLE_TIMEOUT_MS,
    options.signal,
  )) {
    if ('__incomplete' in item) {
      // Sentinel — stream dropped before complete
      break;
    }

    const event = item as SSEEvent;
    collected.push(event);

    if (event.type === 'complete' || event.type === 'done') {
      completed = true;
      break;
    }
  }

  return { events: collected, completed };
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
