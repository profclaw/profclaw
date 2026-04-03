/**
 * stream-bridge tests
 *
 * Verifies that bridgeStreamToSSE:
 *   - Forwards events with the correct `agent:<type>` prefix
 *   - Injects sessionId and a numeric timestamp onto each event
 *   - Broadcasts a synthetic error event and re-throws when the stream errors
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bridgeStreamToSSE } from '../stream-bridge.js';
import type { AgentEvent } from '../../agents/events.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function* makeStream(events: AgentEvent[]): AsyncGenerator<AgentEvent> {
  for (const event of events) {
    yield event;
  }
}

async function* makeErrorStream(
  events: AgentEvent[],
  error: Error,
): AsyncGenerator<AgentEvent> {
  for (const event of events) {
    yield event;
  }
  throw error;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bridgeStreamToSSE', () => {
  let broadcaster: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    broadcaster = vi.fn();
  });

  it('forwards events with the agent: type prefix', async () => {
    const events: AgentEvent[] = [
      { type: 'session:start', sessionId: 'sess-1', config: {} },
      { type: 'content', text: 'hello', delta: 'hello' },
    ];

    await bridgeStreamToSSE(makeStream(events), broadcaster, 'sess-1');

    expect(broadcaster).toHaveBeenCalledTimes(2);
    expect(broadcaster.mock.calls[0]![0]).toBe('agent:session:start');
    expect(broadcaster.mock.calls[1]![0]).toBe('agent:content');
  });

  it('injects sessionId into each broadcast payload', async () => {
    const events: AgentEvent[] = [
      { type: 'step:start', stepIndex: 0 },
    ];

    await bridgeStreamToSSE(makeStream(events), broadcaster, 'my-session');

    const payload = broadcaster.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload['sessionId']).toBe('my-session');
  });

  it('adds a numeric timestamp to each broadcast payload', async () => {
    const before = Date.now();

    const events: AgentEvent[] = [
      { type: 'thinking', text: 'deliberating' },
    ];

    await bridgeStreamToSSE(makeStream(events), broadcaster, 'sess-ts');

    const after = Date.now();
    const payload = broadcaster.mock.calls[0]![1] as Record<string, unknown>;
    expect(typeof payload['timestamp']).toBe('number');
    expect(payload['timestamp'] as number).toBeGreaterThanOrEqual(before);
    expect(payload['timestamp'] as number).toBeLessThanOrEqual(after);
  });

  it('spreads all original event fields into the payload', async () => {
    const events: AgentEvent[] = [
      { type: 'cost:update', inputTokens: 10, outputTokens: 5, estimatedCost: 0.001 },
    ];

    await bridgeStreamToSSE(makeStream(events), broadcaster, 'sess-x');

    const payload = broadcaster.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload['type']).toBe('cost:update');
    expect(payload['inputTokens']).toBe(10);
    expect(payload['outputTokens']).toBe(5);
    expect(payload['estimatedCost']).toBe(0.001);
  });

  it('broadcasts a synthetic error event and re-throws on stream error', async () => {
    const partialEvents: AgentEvent[] = [
      { type: 'step:start', stepIndex: 0 },
    ];
    const boom = new Error('network failure');

    await expect(
      bridgeStreamToSSE(makeErrorStream(partialEvents, boom), broadcaster, 'sess-err'),
    ).rejects.toThrow('network failure');

    // The partial event was forwarded
    expect(broadcaster.mock.calls[0]![0]).toBe('agent:step:start');

    // An error notification was broadcast
    const lastCall = broadcaster.mock.calls[broadcaster.mock.calls.length - 1]!;
    expect(lastCall[0]).toBe('agent:session:error');
    const errPayload = lastCall[1] as Record<string, unknown>;
    expect(errPayload['error']).toBe('network failure');
    expect(errPayload['sessionId']).toBe('sess-err');
  });

  it('handles a non-Error thrown value in the stream', async () => {
    async function* stringErrorStream(): AsyncGenerator<AgentEvent> {
      yield { type: 'step:start', stepIndex: 0 };
      throw 'string error';
    }

    await expect(
      bridgeStreamToSSE(stringErrorStream(), broadcaster, 'sess-str'),
    ).rejects.toBe('string error');

    const lastCall = broadcaster.mock.calls[broadcaster.mock.calls.length - 1]!;
    expect(lastCall[0]).toBe('agent:session:error');
    const errPayload = lastCall[1] as Record<string, unknown>;
    expect(errPayload['error']).toBe('string error');
  });

  it('does nothing when the stream is empty', async () => {
    await bridgeStreamToSSE(makeStream([]), broadcaster, 'sess-empty');
    expect(broadcaster).not.toHaveBeenCalled();
  });

  it('forwards multiple events in order', async () => {
    const events: AgentEvent[] = [
      { type: 'session:start', sessionId: 'sess-ord', config: {} },
      { type: 'step:start', stepIndex: 0 },
      { type: 'tool:call', toolName: 'read_file', args: { path: '/tmp/x' }, toolCallId: 'tc-1' },
      { type: 'tool:result', toolCallId: 'tc-1', result: 'contents', duration: 42, success: true },
      { type: 'session:complete', result: {}, totalSteps: 1, totalTokens: 20 },
    ];

    await bridgeStreamToSSE(makeStream(events), broadcaster, 'sess-ord');

    expect(broadcaster).toHaveBeenCalledTimes(5);
    const types = broadcaster.mock.calls.map((c) => c[0] as string);
    expect(types).toEqual([
      'agent:session:start',
      'agent:step:start',
      'agent:tool:call',
      'agent:tool:result',
      'agent:session:complete',
    ]);
  });
});
