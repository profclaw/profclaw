import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext, ToolSession } from '../types.js';

const { mockMemoryDeps } = vi.hoisted(() => ({
  mockMemoryDeps: {
    searchMemory: vi.fn(),
    getMemoryContent: vi.fn(),
    getMemoryStats: vi.fn(),
    DEFAULT_MEMORY_CONFIG: {
      query: {
        maxResults: 6,
        minScore: 0.35,
      },
    },
  },
}));

vi.mock('../../../memory/memory-service.js', () => ({
  searchMemory: mockMemoryDeps.searchMemory,
  getMemoryContent: mockMemoryDeps.getMemoryContent,
  getMemoryStats: mockMemoryDeps.getMemoryStats,
  DEFAULT_MEMORY_CONFIG: mockMemoryDeps.DEFAULT_MEMORY_CONFIG,
}));

import {
  memoryGetTool,
  memorySearchTool,
  memoryStatsTool,
} from './memory-tools.js';

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

describe('memory tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMemoryDeps.getMemoryStats.mockResolvedValue({
      totalFiles: 3,
      totalChunks: 12,
      totalTokensEstimate: 4800,
      lastSyncAt: 1_741_734_000_000,
      embeddingModel: 'text-embedding-3-small',
      cachedEmbeddings: 8,
    });
  });

  it('filters memory search results to chat snippets when requested', async () => {
    mockMemoryDeps.searchMemory.mockResolvedValue({
      chunks: [
        {
          path: 'chat://conversation-12345678',
          startLine: 10,
          endLine: 18,
          text: 'Chat summary',
          score: 0.82,
          source: 'custom',
        },
        {
          path: 'memory/notes.md',
          startLine: 2,
          endLine: 6,
          text: 'File note',
          score: 0.74,
          source: 'memory',
        },
      ],
      query: 'summary',
      method: 'hybrid',
      totalCandidates: 2,
    });

    const result = await memorySearchTool.execute(createContext(), {
      query: 'summary',
      source: 'chat',
      maxResults: 5,
      minScore: 0.2,
    });

    expect(result.success).toBe(true);
    expect(mockMemoryDeps.searchMemory).toHaveBeenCalledWith(
      'summary',
      expect.objectContaining({
        query: expect.objectContaining({
          maxResults: 5,
          minScore: 0.2,
        }),
      }),
    );
    expect(result.data).toMatchObject({
      totalFound: 1,
      results: [
        expect.objectContaining({
          path: 'chat://conversation-12345678',
          lines: '10-18',
          source: 'custom',
        }),
      ],
    });
    expect(result.output).toContain('Chat: conversa...');
  });

  it('returns a not-found response when memory_get cannot locate a file', async () => {
    mockMemoryDeps.getMemoryContent.mockResolvedValue(null);

    const result = await memoryGetTool.execute(createContext(), {
      path: 'memory/missing.md',
      from: 4,
      lines: 10,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      path: 'memory/missing.md',
      content: '',
      fromLine: 4,
      toLine: 4,
      found: false,
    });
    expect(result.output).toContain('Memory file not found');
  });

  it('surfaces memory search service failures as structured errors', async () => {
    mockMemoryDeps.searchMemory.mockRejectedValue(new Error('embedding backend unavailable'));

    const result = await memorySearchTool.execute(createContext(), {
      query: 'backend outage',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: 'MEMORY_SEARCH_ERROR',
      message: 'Memory search failed: embedding backend unavailable',
    });
  });

  it('formats memory stats for chat output', async () => {
    const result = await memoryStatsTool.execute(createContext(), {});

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      totalFiles: 3,
      totalChunks: 12,
      embeddingModel: 'text-embedding-3-small',
      cachedEmbeddings: 8,
    });
    expect(result.output).toContain('## Memory System Stats');
    expect(result.output).toContain('| **Files Indexed** | 3 |');
  });
});
