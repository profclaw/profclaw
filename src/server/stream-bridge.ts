/**
 * Stream Bridge
 *
 * Bridges an AgentExecutor async generator stream() to the SSE broadcast
 * mechanism so connected clients receive real-time typed agent events.
 */

import type { AgentEvent } from '../agents/events.js';

/**
 * Consume an AgentExecutor stream and forward each event to the SSE broadcaster.
 *
 * Each event is emitted as `agent:<event.type>` with the sessionId injected and
 * a timestamp attached. The function resolves when the stream is exhausted.
 *
 * Stream errors are caught and broadcast as a synthetic `agent:session:error`
 * event so that connected clients are notified, then the error is re-thrown so
 * the caller can handle it (e.g. update task state).
 */
export async function bridgeStreamToSSE(
  stream: AsyncGenerator<AgentEvent>,
  broadcaster: (type: string, data: unknown) => void,
  sessionId: string,
): Promise<void> {
  try {
    for await (const event of stream) {
      broadcaster(`agent:${event.type}`, {
        sessionId,
        ...event,
        timestamp: Date.now(),
      });
    }
  } catch (error) {
    // Notify SSE clients before re-throwing
    broadcaster('agent:session:error', {
      sessionId,
      type: 'session:error',
      error: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
    });
    throw error;
  }
}
