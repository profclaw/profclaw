import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { webFetchTool } from './web-fetch.js';
import type { ToolExecutionContext, ToolSession } from '../types.js';

function createContext(): ToolExecutionContext {
  return {
    toolCallId: 'tool-call-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    workdir: '/tmp',
    env: {},
    securityPolicy: { mode: 'ask' },
    sessionManager: {
      create(session: Omit<ToolSession, 'id' | 'createdAt'>): ToolSession {
        return {
          ...session,
          id: 'session-1',
          createdAt: Date.now(),
        };
      },
      get() {
        return undefined;
      },
      update() {},
      list() {
        return [];
      },
      async kill() {},
      cleanup() {},
    },
  };
}

describe('web fetch tool', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('blocks IPv6 loopback hosts before issuing the request', async () => {
    const result = await webFetchTool.execute(createContext(), {
      url: 'http://[::1]/health',
      method: 'GET',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('BLOCKED_HOST');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks private IPv4 ranges before issuing the request', async () => {
    const result = await webFetchTool.execute(createContext(), {
      url: 'http://10.0.0.12/internal',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PRIVATE_IP');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('extracts readable text from HTML responses', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'https://example.com/docs',
      headers: new Headers({
        'content-type': 'text/html',
      }),
      text: vi
        .fn()
        .mockResolvedValue(
          '<html><body><h1>Docs</h1><p>Hello <strong>world</strong>.</p><script>ignored()</script></body></html>',
        ),
    });

    const result = await webFetchTool.execute(createContext(), {
      url: 'https://example.com/docs',
      extractText: true,
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      status: 200,
      contentType: 'text/html',
      url: 'https://example.com/docs',
    });
    expect(result.output).toContain('Docs');
    expect(result.output).toContain('Hello world.');
    expect(result.output).not.toContain('ignored()');
  });

  it('returns HTTP_ERROR details for non-ok responses', async () => {
    fetchMock.mockResolvedValue(
      new Response('missing', {
        status: 404,
        statusText: 'Not Found',
        headers: {
          'content-type': 'text/plain',
        },
      }),
    );

    const result = await webFetchTool.execute(createContext(), {
      url: 'https://example.com/missing',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: 'HTTP_ERROR',
      message: 'HTTP 404 Not Found',
    });
    expect(result.output).toContain('HTTP 404 Not Found');
  });

  it('maps aborted fetches to TIMEOUT errors', async () => {
    fetchMock.mockRejectedValue(new Error('This operation was aborted'));

    const result = await webFetchTool.execute(createContext(), {
      url: 'https://example.com/slow',
      timeout: 2,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: 'TIMEOUT',
      message: 'Request timed out after 2s',
    });
  });
});
