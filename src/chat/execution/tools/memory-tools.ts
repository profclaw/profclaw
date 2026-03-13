/**
 * Memory Tools
 *
 * Semantic memory search and retrieval tools.
 * Inspired by OpenClaw's memory_search and memory_get tools.
 *
 * - memory_search: Semantic search on indexed memory files (MEMORY.md, memory/*.md, chat history)
 * - memory_get: Read specific lines from memory files
 */

import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import {
  searchMemory,
  getMemoryContent,
  getMemoryStats,
  DEFAULT_MEMORY_CONFIG,
  type SearchResult,
  type MemoryStats,
} from '../../../memory/memory-service.js';

// =============================================================================
// Memory Search Tool
// =============================================================================

const MemorySearchParamsSchema = z.object({
  query: z.string().min(1).max(500)
    .describe('Search query - use natural language to find relevant memories'),
  maxResults: z.number().min(1).max(20).optional().default(6)
    .describe('Maximum number of results to return (default: 6)'),
  minScore: z.number().min(0).max(1).optional().default(0.35)
    .describe('Minimum relevance score threshold (0-1, default: 0.35)'),
  source: z.enum(['all', 'memory', 'chat', 'custom']).optional().default('all')
    .describe('Filter by source: all, memory (files), chat (conversations), custom'),
});

export type MemorySearchParams = z.infer<typeof MemorySearchParamsSchema>;

export interface MemorySearchResult {
  query: string;
  results: Array<{
    path: string;
    lines: string; // "42-56"
    text: string;
    score: number;
    source: string;
  }>;
  totalFound: number;
  method: 'hybrid' | 'vector' | 'fts';
  stats: {
    totalFiles: number;
    totalChunks: number;
  };
}

export const memorySearchTool: ToolDefinition<MemorySearchParams, MemorySearchResult> = {
  name: 'memory_search',
  description: `**Mandatory recall step**: semantically search MEMORY.md + memory/*.md + chat history before answering questions about prior work, decisions, dates, people, preferences, or todos.

Returns top snippets with path + line numbers. Use this tool to:
- Recall past conversations and decisions
- Find information about previous work
- Look up preferences or settings discussed before
- Search for dates, names, or specific topics

The search uses hybrid (vector + text) matching for best results.`,
  category: 'memory',
  securityLevel: 'safe',
  allowedHosts: ['gateway', 'local'],
  parameters: MemorySearchParamsSchema,
  examples: [
    { description: 'Search for API decisions', params: { query: 'API authentication decisions' } },
    { description: 'Find user preferences', params: { query: 'user preferences for notifications' } },
    { description: 'Recall past work', params: { query: 'changes made to login flow' } },
  ],

  async execute(context: ToolExecutionContext, params: MemorySearchParams): Promise<ToolResult<MemorySearchResult>> {
    try {
      // Configure search
      const config = {
        ...DEFAULT_MEMORY_CONFIG,
        query: {
          ...DEFAULT_MEMORY_CONFIG.query,
          maxResults: params.maxResults,
          minScore: params.minScore,
        },
      };

      // Perform search
      const searchResult: SearchResult = await searchMemory(params.query, config);

      // Filter by source if specified
      let filteredChunks = searchResult.chunks;
      if (params.source !== 'all') {
        filteredChunks = filteredChunks.filter(c => {
          if (params.source === 'chat') return c.source === 'chat' || c.path.startsWith('chat://');
          return c.source === params.source;
        });
      }

      // Context isolation: scope results to allowed memory paths
      if (context.isolationContext) {
        const allowedPaths = context.isolationContext.allowedMemoryPaths;
        if (allowedPaths.length > 0) {
          filteredChunks = filteredChunks.filter(c =>
            allowedPaths.some(p => c.path.startsWith(p)),
          );
        }
      }

      // Get stats
      const stats = await getMemoryStats();

      // Format results
      const results = filteredChunks.map(chunk => ({
        path: chunk.path,
        lines: `${chunk.startLine}-${chunk.endLine}`,
        text: chunk.text,
        score: Math.round((chunk.score || 0) * 100) / 100,
        source: chunk.source,
      }));

      // Build human-readable output
      const lines: string[] = ['## Memory Search Results\n'];
      lines.push(`**Query**: "${params.query}"`);
      lines.push(`**Found**: ${results.length} relevant snippets (searched ${stats.totalChunks} chunks)\n`);

      if (results.length === 0) {
        lines.push('No relevant memories found. Consider:\n');
        lines.push('- Trying different search terms');
        lines.push('- Checking if the memory file exists');
        lines.push('- The information may not have been saved to memory');
      } else {
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          const pathDisplay = r.path.startsWith('chat://')
            ? `Chat: ${r.path.slice(7, 15)}...`
            : r.path;
          lines.push(`### ${i + 1}. ${pathDisplay} (lines ${r.lines})`);
          lines.push(`**Score**: ${r.score} | **Source**: ${r.source}`);
          lines.push('```');
          // Truncate long text for display
          const displayText = r.text.length > 300
            ? r.text.slice(0, 300) + '...'
            : r.text;
          lines.push(displayText);
          lines.push('```\n');
        }

        lines.push(`---\n*Use \`memory_get\` to retrieve full content from a specific path and line range.*`);
      }

      return {
        success: true,
        data: {
          query: params.query,
          results,
          totalFound: results.length,
          method: searchResult.method,
          stats: {
            totalFiles: stats.totalFiles,
            totalChunks: stats.totalChunks,
          },
        },
        output: lines.join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'MEMORY_SEARCH_ERROR',
          message: `Memory search failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  },
};

// =============================================================================
// Memory Get Tool
// =============================================================================

const MemoryGetParamsSchema = z.object({
  path: z.string()
    .describe('Path to the memory file (e.g., "MEMORY.md", "memory/notes.md", or "chat://conversationId")'),
  from: z.number().min(1).optional()
    .describe('Start line number (1-indexed, optional)'),
  lines: z.number().min(1).max(100).optional()
    .describe('Number of lines to return (default: 20, max: 100)'),
});

export type MemoryGetParams = z.infer<typeof MemoryGetParamsSchema>;

export interface MemoryGetResult {
  path: string;
  content: string;
  fromLine: number;
  toLine: number;
  found: boolean;
}

export const memoryGetTool: ToolDefinition<MemoryGetParams, MemoryGetResult> = {
  name: 'memory_get',
  description: `Safe snippet read from MEMORY.md, memory/*.md, or chat history.

Use after memory_search to pull only the needed lines and keep context small.
Specify a path and optionally a line range to retrieve specific content.

This tool is read-only and only accesses indexed memory files.`,
  category: 'memory',
  securityLevel: 'safe',
  allowedHosts: ['gateway', 'local'],
  parameters: MemoryGetParamsSchema,
  examples: [
    { description: 'Read MEMORY.md', params: { path: 'MEMORY.md' } },
    { description: 'Get specific lines', params: { path: 'memory/api-decisions.md', from: 10, lines: 20 } },
    { description: 'Read chat memory', params: { path: 'chat://abc123', from: 1, lines: 50 } },
  ],

  async execute(context: ToolExecutionContext, params: MemoryGetParams): Promise<ToolResult<MemoryGetResult>> {
    // Context isolation: check if path is allowed
    if (context.isolationContext) {
      const allowedPaths = context.isolationContext.allowedMemoryPaths;
      if (allowedPaths.length > 0 && !allowedPaths.some(p => params.path.startsWith(p))) {
        return {
          success: false,
          error: {
            code: 'ISOLATION_BLOCKED',
            message: `Access to memory path "${params.path}" is restricted by context isolation`,
          },
        };
      }
    }

    try {
      const result = await getMemoryContent(params.path, {
        fromLine: params.from,
        lines: params.lines || 20,
      });

      if (!result) {
        return {
          success: true,
          data: {
            path: params.path,
            content: '',
            fromLine: params.from || 1,
            toLine: params.from || 1,
            found: false,
          },
          output: `❌ Memory file not found: \`${params.path}\`\n\nThis file may not exist or may not have been indexed yet. Try:\n- Using \`memory_search\` to find relevant files\n- Checking the exact path spelling`,
        };
      }

      // Build output
      const lines: string[] = [
        `## Memory: ${params.path}`,
        `**Lines**: ${result.fromLine}-${result.toLine}\n`,
        '```',
        result.content,
        '```',
      ];

      return {
        success: true,
        data: {
          path: result.path,
          content: result.content,
          fromLine: result.fromLine,
          toLine: result.toLine,
          found: true,
        },
        output: lines.join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'MEMORY_GET_ERROR',
          message: `Failed to get memory content: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  },
};

// =============================================================================
// Memory Stats Tool (bonus)
// =============================================================================

const MemoryStatsParamsSchema = z.object({});

export type MemoryStatsParams = z.infer<typeof MemoryStatsParamsSchema>;

export interface MemoryStatsResult extends MemoryStats {
  message: string;
}

export const memoryStatsTool: ToolDefinition<MemoryStatsParams, MemoryStatsResult> = {
  name: 'memory_stats',
  description: `Get statistics about the memory system.

Shows:
- Total files and chunks indexed
- Estimated token count
- Last sync time
- Embedding model in use
- Cached embeddings count`,
  category: 'memory',
  securityLevel: 'safe',
  allowedHosts: ['gateway', 'local'],
  parameters: MemoryStatsParamsSchema,
  examples: [
    { description: 'Get memory stats', params: {} },
  ],

  async execute(_context: ToolExecutionContext, _params: MemoryStatsParams): Promise<ToolResult<MemoryStatsResult>> {
    try {
      const stats = await getMemoryStats();

      const lines: string[] = [
        '## Memory System Stats\n',
        `| Metric | Value |`,
        `|--------|-------|`,
        `| **Files Indexed** | ${stats.totalFiles} |`,
        `| **Chunks** | ${stats.totalChunks} |`,
        `| **Est. Tokens** | ~${stats.totalTokensEstimate.toLocaleString()} |`,
        `| **Cached Embeddings** | ${stats.cachedEmbeddings} |`,
        `| **Embedding Model** | ${stats.embeddingModel} |`,
        `| **Last Sync** | ${stats.lastSyncAt ? new Date(stats.lastSyncAt).toLocaleString() : 'Never'} |`,
      ];

      return {
        success: true,
        data: {
          ...stats,
          message: lines.join('\n'),
        },
        output: lines.join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'MEMORY_STATS_ERROR',
          message: `Failed to get memory stats: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  },
};
