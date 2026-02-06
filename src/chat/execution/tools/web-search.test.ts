import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext, ToolSession } from '../types.js';

const { mockWebSearchDeps } = vi.hoisted(() => ({
  mockWebSearchDeps: {
    webSearch: vi.fn(),
    isWebSearchAvailable: vi.fn(),
    getDefaultWebSearchConfig: vi.fn(() => ({
      enabled: true,
      provider: 'brave',
      brave: { apiKey: 'key-123' },
    })),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

vi.mock('../../../integrations/web-search.js', () => ({
  webSearch: mockWebSearchDeps.webSearch,
  isWebSearchAvailable: mockWebSearchDeps.isWebSearchAvailable,
  getDefaultWebSearchConfig: mockWebSearchDeps.getDefaultWebSearchConfig,
}));

vi.mock('../../../utils/logger.js', () => ({
  logger: mockWebSearchDeps.logger,
}));

import { setWebSearchConfig, webSearchTool } from './web-search.js';

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

describe('web search tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setWebSearchConfig({
      enabled: true,
      provider: 'brave',
      brave: { apiKey: 'key-123' },
    });
  });

  it('returns NOT_CONFIGURED when no provider is available', async () => {
    mockWebSearchDeps.isWebSearchAvailable.mockReturnValue({
      available: false,
      reason: 'No API key configured',
    });

    const result = await webSearchTool.execute(createContext(), {
      query: 'latest model release',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: 'NOT_CONFIGURED',
      message: 'Web search is not available: No API key configured. Configure a search provider in Settings > Integrations.',
    });
  });

  it('formats successful search results for chat output', async () => {
    mockWebSearchDeps.isWebSearchAvailable.mockReturnValue({
      available: true,
      provider: 'brave',
    });
    mockWebSearchDeps.webSearch.mockResolvedValue({
      query: 'profclaw testing',
      provider: 'brave',
      results: [
        {
          title: 'profClaw Testing Guide',
          url: 'https://example.com/guide',
          snippet: 'How to harden profClaw before release.',
          position: 1,
        },
      ],
      totalResults: 1,
      searchTime: 42,
    });

    const result = await webSearchTool.execute(createContext(), {
      query: 'profclaw testing',
      count: 5,
    });

    expect(result.success).toBe(true);
    expect(mockWebSearchDeps.webSearch).toHaveBeenCalledWith(
      'profclaw testing',
      expect.objectContaining({
        provider: 'brave',
      }),
      { count: 5 },
    );
    expect(result.output).toContain('Found 1 results for "profclaw testing"');
    expect(result.output).toContain('profClaw Testing Guide');
  });

  it('returns SEARCH_FAILED with retryable=true when the provider errors', async () => {
    mockWebSearchDeps.isWebSearchAvailable.mockReturnValue({
      available: true,
      provider: 'brave',
    });
    mockWebSearchDeps.webSearch.mockRejectedValue(new Error('upstream timeout'));

    const result = await webSearchTool.execute(createContext(), {
      query: 'deployment docs',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: 'SEARCH_FAILED',
      message: 'Search failed: upstream timeout',
      retryable: true,
    });
  });
});
