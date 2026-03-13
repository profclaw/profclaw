/**
 * Streaming Tool Results
 *
 * Emits tool output incrementally as it arrives rather than buffering until
 * completion. Integrates with ToolExecutionContext.onProgress and provides
 * an SSE adapter for the /api/chat/stream endpoint.
 */

import type { ToolProgressUpdate } from './types.js';
import { logger } from '../../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export interface StreamChunk {
  type: 'stdout' | 'stderr' | 'status' | 'progress' | 'complete' | 'error';
  content: string;
  timestamp: number;
  toolCallId: string;
}

export type StreamCallback = (chunk: StreamChunk) => void;

// =============================================================================
// ToolResultStreamer
// =============================================================================

/**
 * Wraps a tool executor to stream results chunk by chunk.
 * Uses the existing onProgress callback in ToolExecutionContext.
 *
 * Maintains a per-call buffer so late subscribers can catch up on already-
 * emitted output before receiving new chunks in real time.
 */
export class ToolResultStreamer {
  private listeners = new Map<string, StreamCallback[]>();
  private buffers = new Map<string, StreamChunk[]>();

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to stream chunks for a specific tool call.
   * Returns an unsubscribe function - call it when done to prevent leaks.
   */
  subscribe(toolCallId: string, callback: StreamCallback): () => void {
    const existing = this.listeners.get(toolCallId) ?? [];
    this.listeners.set(toolCallId, [...existing, callback]);

    // Replay buffered chunks to the new subscriber so they receive any output
    // that arrived before they subscribed.
    const buffered = this.buffers.get(toolCallId) ?? [];
    for (const chunk of buffered) {
      try {
        callback(chunk);
      } catch (err) {
        logger.warn('[StreamResults] Subscriber threw during replay', {
          component: 'StreamResults',
          toolCallId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return () => {
      const current = this.listeners.get(toolCallId);
      if (!current) return;
      const updated = current.filter(cb => cb !== callback);
      if (updated.length === 0) {
        this.listeners.delete(toolCallId);
      } else {
        this.listeners.set(toolCallId, updated);
      }
    };
  }

  /**
   * Emit a chunk to all subscribers for the chunk's toolCallId.
   * Also appends to the replay buffer.
   */
  emit(chunk: StreamChunk): void {
    // Buffer for late subscribers
    const buf = this.buffers.get(chunk.toolCallId) ?? [];
    buf.push(chunk);
    this.buffers.set(chunk.toolCallId, buf);

    // Deliver to active subscribers
    const callbacks = this.listeners.get(chunk.toolCallId) ?? [];
    for (const cb of callbacks) {
      try {
        cb(chunk);
      } catch (err) {
        logger.warn('[StreamResults] Subscriber threw during emit', {
          component: 'StreamResults',
          toolCallId: chunk.toolCallId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Create a progress handler compatible with ToolExecutionContext.onProgress.
   * Pass the returned function as `context.onProgress` when executing a tool.
   */
  createProgressHandler(toolCallId: string): (update: ToolProgressUpdate) => void {
    return (update: ToolProgressUpdate) => {
      let chunkType: StreamChunk['type'];
      switch (update.type) {
        case 'output':
          chunkType = 'stdout';
          break;
        case 'status':
          chunkType = 'status';
          break;
        case 'approval-needed':
          chunkType = 'status';
          break;
        default:
          chunkType = 'progress';
      }

      this.emit({
        type: chunkType,
        content: update.content,
        timestamp: update.timestamp,
        toolCallId,
      });
    };
  }

  /**
   * Get the buffered output for a tool call.
   * Useful for late subscribers that need the full history.
   */
  getBuffer(toolCallId: string): StreamChunk[] {
    return [...(this.buffers.get(toolCallId) ?? [])];
  }

  /**
   * Release all subscribers and buffered data for a tool call.
   * Should be called once the tool call is fully done and no further chunks
   * will be emitted.
   */
  cleanup(toolCallId: string): void {
    this.listeners.delete(toolCallId);
    this.buffers.delete(toolCallId);
    logger.debug('[StreamResults] Cleaned up tool call stream', {
      component: 'StreamResults',
      toolCallId,
    });
  }
}

// =============================================================================
// SSE Adapter
// =============================================================================

/**
 * Subscribe to tool result stream chunks and write them to a WritableStream
 * in Server-Sent Events format for the /api/chat/stream endpoint.
 *
 * Each SSE event has:
 *   event: tool-chunk
 *   data: <JSON-encoded StreamChunk>
 *
 * Returns an unsubscribe function. Call it when the client disconnects or
 * the stream ends to clean up the subscription.
 */
export function streamToSSE(
  streamer: ToolResultStreamer,
  toolCallId: string,
  writer: WritableStreamDefaultWriter<Uint8Array>,
): () => void {
  const encoder = new TextEncoder();

  const unsubscribe = streamer.subscribe(toolCallId, (chunk: StreamChunk) => {
    const payload = `event: tool-chunk\ndata: ${JSON.stringify(chunk)}\n\n`;
    writer.write(encoder.encode(payload)).catch((err: unknown) => {
      logger.warn('[StreamResults] SSE write failed', {
        component: 'StreamResults',
        toolCallId,
        error: err instanceof Error ? err.message : String(err),
      });
      unsubscribe();
    });
  });

  return unsubscribe;
}
