/**
 * ToolResultStreamer & streamToSSE Tests
 *
 * Tests for src/chat/execution/stream-results.ts
 * Covers: subscribe/emit/unsubscribe, buffer replay, createProgressHandler,
 * cleanup, and SSE adapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { ToolResultStreamer, streamToSSE } from '../stream-results.js';
import type { StreamChunk } from '../stream-results.js';
import type { ToolProgressUpdate } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChunk(toolCallId: string, type: StreamChunk['type'] = 'stdout'): StreamChunk {
  return {
    type,
    content: `content for ${toolCallId}`,
    timestamp: Date.now(),
    toolCallId,
  };
}

// ---------------------------------------------------------------------------
// ToolResultStreamer - subscribe / emit / unsubscribe
// ---------------------------------------------------------------------------

describe('ToolResultStreamer.subscribe()', () => {
  it('callback receives an emitted chunk for its toolCallId', () => {
    const streamer = new ToolResultStreamer();
    const received: StreamChunk[] = [];
    streamer.subscribe('call-1', (chunk) => received.push(chunk));

    const chunk = makeChunk('call-1');
    streamer.emit(chunk);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(chunk);
  });

  it('callback does not receive chunks for a different toolCallId', () => {
    const streamer = new ToolResultStreamer();
    const received: StreamChunk[] = [];
    streamer.subscribe('call-A', (chunk) => received.push(chunk));

    streamer.emit(makeChunk('call-B'));

    expect(received).toHaveLength(0);
  });

  it('returns an unsubscribe function that stops further deliveries', () => {
    const streamer = new ToolResultStreamer();
    const received: StreamChunk[] = [];
    const unsubscribe = streamer.subscribe('call-1', (chunk) => received.push(chunk));

    streamer.emit(makeChunk('call-1'));
    unsubscribe();
    streamer.emit(makeChunk('call-1'));

    expect(received).toHaveLength(1);
  });

  it('multiple subscribers on the same toolCallId all receive the chunk', () => {
    const streamer = new ToolResultStreamer();
    const recv1: StreamChunk[] = [];
    const recv2: StreamChunk[] = [];
    streamer.subscribe('call-1', (c) => recv1.push(c));
    streamer.subscribe('call-1', (c) => recv2.push(c));

    streamer.emit(makeChunk('call-1'));

    expect(recv1).toHaveLength(1);
    expect(recv2).toHaveLength(1);
  });

  it('unsubscribing one callback does not remove the other subscriber', () => {
    const streamer = new ToolResultStreamer();
    const recv1: StreamChunk[] = [];
    const recv2: StreamChunk[] = [];
    const unsub1 = streamer.subscribe('call-1', (c) => recv1.push(c));
    streamer.subscribe('call-1', (c) => recv2.push(c));

    unsub1();
    streamer.emit(makeChunk('call-1'));

    expect(recv1).toHaveLength(0);
    expect(recv2).toHaveLength(1);
  });

  it('late subscriber receives buffered history on subscribe', () => {
    const streamer = new ToolResultStreamer();

    // Emit before subscribe
    const c1 = makeChunk('call-1');
    const c2 = makeChunk('call-1', 'status');
    streamer.emit(c1);
    streamer.emit(c2);

    const received: StreamChunk[] = [];
    streamer.subscribe('call-1', (c) => received.push(c));

    expect(received).toHaveLength(2);
    expect(received[0]).toEqual(c1);
    expect(received[1]).toEqual(c2);
  });

  it('late subscriber receives buffered history AND subsequent live chunks', () => {
    const streamer = new ToolResultStreamer();

    const historical = makeChunk('call-1');
    streamer.emit(historical);

    const received: StreamChunk[] = [];
    streamer.subscribe('call-1', (c) => received.push(c));

    // New chunk emitted after subscribe
    const live = makeChunk('call-1', 'progress');
    streamer.emit(live);

    expect(received).toHaveLength(2);
    expect(received[0]).toEqual(historical);
    expect(received[1]).toEqual(live);
  });

  it('does not replay buffer from a different toolCallId', () => {
    const streamer = new ToolResultStreamer();

    streamer.emit(makeChunk('call-X'));

    const received: StreamChunk[] = [];
    streamer.subscribe('call-Y', (c) => received.push(c));

    expect(received).toHaveLength(0);
  });

  it('subscriber that throws during replay is swallowed and others still run', () => {
    const streamer = new ToolResultStreamer();
    streamer.emit(makeChunk('call-1'));

    const good: StreamChunk[] = [];
    // First subscriber throws; second should still receive
    expect(() => {
      streamer.subscribe('call-1', () => { throw new Error('bad subscriber'); });
      streamer.subscribe('call-1', (c) => good.push(c));
    }).not.toThrow();

    // Good subscriber subscribed second - should have received buffer from its own subscribe
    expect(good).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ToolResultStreamer - emit
// ---------------------------------------------------------------------------

describe('ToolResultStreamer.emit()', () => {
  it('appends chunk to the buffer', () => {
    const streamer = new ToolResultStreamer();
    const chunk = makeChunk('call-1');
    streamer.emit(chunk);
    const buf = streamer.getBuffer('call-1');
    expect(buf).toHaveLength(1);
    expect(buf[0]).toEqual(chunk);
  });

  it('accumulates multiple emitted chunks in order', () => {
    const streamer = new ToolResultStreamer();
    const c1 = makeChunk('call-1', 'stdout');
    const c2 = makeChunk('call-1', 'stderr');
    const c3 = makeChunk('call-1', 'complete');
    streamer.emit(c1);
    streamer.emit(c2);
    streamer.emit(c3);

    const buf = streamer.getBuffer('call-1');
    expect(buf).toHaveLength(3);
    expect(buf[0]).toEqual(c1);
    expect(buf[1]).toEqual(c2);
    expect(buf[2]).toEqual(c3);
  });

  it('does not swallow a subscriber throw - logs warn but continues', () => {
    const streamer = new ToolResultStreamer();
    let called = false;
    streamer.subscribe('call-1', () => { throw new Error('oops'); });
    streamer.subscribe('call-1', () => { called = true; });

    expect(() => streamer.emit(makeChunk('call-1'))).not.toThrow();
    expect(called).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ToolResultStreamer - getBuffer
// ---------------------------------------------------------------------------

describe('ToolResultStreamer.getBuffer()', () => {
  it('returns empty array when no chunks have been emitted', () => {
    const streamer = new ToolResultStreamer();
    expect(streamer.getBuffer('nonexistent')).toEqual([]);
  });

  it('returns a copy of the buffer - mutations do not affect internal state', () => {
    const streamer = new ToolResultStreamer();
    streamer.emit(makeChunk('call-1'));

    const buf = streamer.getBuffer('call-1');
    buf.push(makeChunk('call-1', 'error'));

    expect(streamer.getBuffer('call-1')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ToolResultStreamer - createProgressHandler
// ---------------------------------------------------------------------------

describe('ToolResultStreamer.createProgressHandler()', () => {
  it('maps output update type to stdout chunk type', () => {
    const streamer = new ToolResultStreamer();
    const received: StreamChunk[] = [];
    streamer.subscribe('call-1', (c) => received.push(c));

    const handler = streamer.createProgressHandler('call-1');
    const update: ToolProgressUpdate = {
      type: 'output',
      content: 'hello world',
      timestamp: Date.now(),
    };
    handler(update);

    expect(received).toHaveLength(1);
    expect(received[0]!.type).toBe('stdout');
    expect(received[0]!.content).toBe('hello world');
    expect(received[0]!.toolCallId).toBe('call-1');
  });

  it('maps status update type to status chunk type', () => {
    const streamer = new ToolResultStreamer();
    const received: StreamChunk[] = [];
    streamer.subscribe('call-2', (c) => received.push(c));

    const handler = streamer.createProgressHandler('call-2');
    const update: ToolProgressUpdate = {
      type: 'status',
      content: 'running',
      timestamp: Date.now(),
    };
    handler(update);

    expect(received[0]!.type).toBe('status');
  });

  it('maps approval-needed update type to status chunk type', () => {
    const streamer = new ToolResultStreamer();
    const received: StreamChunk[] = [];
    streamer.subscribe('call-3', (c) => received.push(c));

    const handler = streamer.createProgressHandler('call-3');
    const update: ToolProgressUpdate = {
      type: 'approval-needed',
      content: 'waiting for approval',
      timestamp: Date.now(),
    };
    handler(update);

    expect(received[0]!.type).toBe('status');
  });

  it('maps unknown update type to progress chunk type', () => {
    const streamer = new ToolResultStreamer();
    const received: StreamChunk[] = [];
    streamer.subscribe('call-4', (c) => received.push(c));

    const handler = streamer.createProgressHandler('call-4');
    const update = {
      type: 'custom' as ToolProgressUpdate['type'],
      content: 'doing stuff',
      timestamp: Date.now(),
    };
    handler(update);

    expect(received[0]!.type).toBe('progress');
  });

  it('preserves the timestamp from the progress update', () => {
    const streamer = new ToolResultStreamer();
    const received: StreamChunk[] = [];
    streamer.subscribe('call-5', (c) => received.push(c));

    const ts = 1_700_000_000_000;
    const handler = streamer.createProgressHandler('call-5');
    handler({ type: 'output', content: 'x', timestamp: ts });

    expect(received[0]!.timestamp).toBe(ts);
  });
});

// ---------------------------------------------------------------------------
// ToolResultStreamer - cleanup
// ---------------------------------------------------------------------------

describe('ToolResultStreamer.cleanup()', () => {
  it('removes listeners so subsequent emits are not delivered', () => {
    const streamer = new ToolResultStreamer();
    const received: StreamChunk[] = [];
    streamer.subscribe('call-1', (c) => received.push(c));

    streamer.cleanup('call-1');
    streamer.emit(makeChunk('call-1'));

    expect(received).toHaveLength(0);
  });

  it('clears the buffer after cleanup', () => {
    const streamer = new ToolResultStreamer();
    streamer.emit(makeChunk('call-1'));
    streamer.cleanup('call-1');

    expect(streamer.getBuffer('call-1')).toEqual([]);
  });

  it('cleanup of a non-existent id is a no-op', () => {
    const streamer = new ToolResultStreamer();
    expect(() => streamer.cleanup('nonexistent')).not.toThrow();
  });

  it('cleanup does not affect a different toolCallId', () => {
    const streamer = new ToolResultStreamer();
    streamer.emit(makeChunk('call-1'));
    streamer.emit(makeChunk('call-2'));

    streamer.cleanup('call-1');

    expect(streamer.getBuffer('call-2')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// streamToSSE
// ---------------------------------------------------------------------------

describe('streamToSSE()', () => {
  it('writes SSE formatted event to the writer when a chunk is emitted', async () => {
    const streamer = new ToolResultStreamer();
    const written: Uint8Array[] = [];
    const writer = {
      write: vi.fn((data: Uint8Array) => {
        written.push(data);
        return Promise.resolve();
      }),
    } as unknown as WritableStreamDefaultWriter<Uint8Array>;

    streamToSSE(streamer, 'call-1', writer);

    const chunk = makeChunk('call-1');
    streamer.emit(chunk);

    // Allow microtasks to flush
    await Promise.resolve();

    expect(writer.write).toHaveBeenCalledOnce();
    const decoder = new TextDecoder();
    const text = decoder.decode(written[0]);
    expect(text).toContain('event: tool-chunk');
    expect(text).toContain('data:');
    expect(text).toContain('"call-1"');
  });

  it('returns an unsubscribe function that stops SSE writes', async () => {
    const streamer = new ToolResultStreamer();
    const writer = {
      write: vi.fn().mockResolvedValue(undefined),
    } as unknown as WritableStreamDefaultWriter<Uint8Array>;

    const unsubscribe = streamToSSE(streamer, 'call-1', writer);

    // Emit one chunk while subscribed
    streamer.emit(makeChunk('call-1'));
    await Promise.resolve();

    const writesBeforeUnsub = (writer.write as ReturnType<typeof vi.fn>).mock.calls.length;

    unsubscribe();

    // Emit after unsubscribe - should not trigger any more writes
    streamer.emit(makeChunk('call-1', 'complete'));
    await Promise.resolve();

    const writesAfterUnsub = (writer.write as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(writesAfterUnsub).toBe(writesBeforeUnsub);
  });

  it('encodes the chunk payload as JSON in the data field', async () => {
    const streamer = new ToolResultStreamer();
    const written: Uint8Array[] = [];
    const writer = {
      write: vi.fn((data: Uint8Array) => {
        written.push(data);
        return Promise.resolve();
      }),
    } as unknown as WritableStreamDefaultWriter<Uint8Array>;

    streamToSSE(streamer, 'call-json', writer);

    const chunk: StreamChunk = {
      type: 'stderr',
      content: 'error output',
      timestamp: 12345,
      toolCallId: 'call-json',
    };
    streamer.emit(chunk);

    await Promise.resolve();

    const decoder = new TextDecoder();
    const text = decoder.decode(written[0]);
    const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
    expect(dataLine).toBeDefined();
    const payload = JSON.parse(dataLine!.slice('data: '.length)) as StreamChunk;
    expect(payload.type).toBe('stderr');
    expect(payload.content).toBe('error output');
    expect(payload.timestamp).toBe(12345);
  });

  it('uses event: tool-chunk header for each SSE event', async () => {
    const streamer = new ToolResultStreamer();
    const written: Uint8Array[] = [];
    const writer = {
      write: vi.fn((data: Uint8Array) => {
        written.push(data);
        return Promise.resolve();
      }),
    } as unknown as WritableStreamDefaultWriter<Uint8Array>;

    streamToSSE(streamer, 'call-sse', writer);
    streamer.emit(makeChunk('call-sse', 'complete'));
    await Promise.resolve();

    const decoder = new TextDecoder();
    const text = decoder.decode(written[0]);
    expect(text.startsWith('event: tool-chunk\n')).toBe(true);
  });
});
