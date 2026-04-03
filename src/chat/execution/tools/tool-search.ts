/**
 * Tool Search Tool
 *
 * Allows the AI agent to discover available tool categories and
 * dynamically load them into the current session.
 *
 * This solves the cold-start problem: instead of including all tool
 * schemas up front (high token cost), only core tools are loaded by
 * default, and the agent can search/load others as needed.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import { ToolLoader } from '../../../agents/tool-loader.js';
import type { ToolCategory } from '../../../agents/tool-loader.js';
import { getToolRegistry } from '../registry.js';
import { logger } from '../../../utils/logger.js';

// Schema

const ToolSearchParamsSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      'Search query describing what kind of tools you need (e.g. "browser automation", "git diff", "image generation")',
    ),
  autoLoad: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'When true, automatically load the top-matching category into the session so its tools become available immediately',
    ),
});

export type ToolSearchParams = z.infer<typeof ToolSearchParamsSchema>;

// Result Types

interface ToolSearchMatch {
  categoryName: string;
  description: string;
  keywords: string[];
  tools: string[];
  alwaysLoaded: boolean;
  loaded: boolean;
}

interface ToolSearchResult {
  query: string;
  matches: ToolSearchMatch[];
  autoLoaded: string | null;
  hint: string;
}

// Session-scoped loaders
// One ToolLoader per session; keyed by conversationId so each session
// has its own independent set of loaded tools.
const sessionLoaders = new Map<string, ToolLoader>();

function getOrCreateLoader(conversationId: string): ToolLoader {
  let loader = sessionLoaders.get(conversationId);
  if (!loader) {
    const registry = getToolRegistry();
    const toolMap = new Map<string, ToolDefinition>();
    for (const tool of registry.list()) {
      toolMap.set(tool.name, tool);
    }
    loader = new ToolLoader(toolMap);
    sessionLoaders.set(conversationId, loader);
  }
  return loader;
}

/**
 * Remove the loader for a conversation when it ends (called externally).
 */
export function clearSessionLoader(conversationId: string): void {
  sessionLoaders.delete(conversationId);
}

/**
 * Expose the loader for a conversation so callers (e.g. the orchestrator)
 * can query which tools are currently loaded.
 */
export function getSessionLoader(conversationId: string): ToolLoader | undefined {
  return sessionLoaders.get(conversationId);
}

// Tool Definition

export const searchAvailableToolsTool: ToolDefinition<ToolSearchParams, ToolSearchResult> = {
  name: 'search_available_tools',
  description: `Search available tool categories and optionally load them for use in this session.

Use this tool when you need capabilities that are not yet available (e.g. browser automation,
advanced git operations, image generation, voice synthesis, or memory access).

Steps:
1. Call with a natural-language query describing what you need.
2. Review the matching categories and their tool lists.
3. Call again with autoLoad: true (or call loadCategory manually) to activate the tools.

The core tools (read_file, write_file, exec, git_status, git_commit, complete_task) are always
available and do not need to be loaded.`,
  category: 'profclaw',
  securityLevel: 'safe',
  allowedHosts: ['gateway', 'local'],
  parameters: ToolSearchParamsSchema,

  async execute(
    context: ToolExecutionContext,
    params: ToolSearchParams,
  ): Promise<ToolResult<ToolSearchResult>> {
    const { query, autoLoad } = params;

    logger.info(`[ToolSearch] Searching for: "${query}"`, {
      component: 'ToolSearch',
      conversationId: context.conversationId,
      autoLoad,
    });

    try {
      const loader = getOrCreateLoader(context.conversationId);
      const matchedCategories = loader.search(query);

      if (matchedCategories.length === 0) {
        const allCategories = loader.getCategories();
        const hint =
          `No categories matched "${query}". ` +
          `Available categories: ${allCategories.map((c) => c.name).join(', ')}.`;

        return {
          success: true,
          data: {
            query,
            matches: [],
            autoLoaded: null,
            hint,
          },
          output: hint,
        };
      }

      // Optionally auto-load the best match
      let autoLoaded: string | null = null;
      if (autoLoad && matchedCategories.length > 0) {
        const best = matchedCategories[0];
        loader.loadCategory(best.name);
        autoLoaded = best.name;
        logger.info(`[ToolSearch] Auto-loaded category: ${best.name}`, {
          component: 'ToolSearch',
          conversationId: context.conversationId,
        });
      }

      const matches: ToolSearchMatch[] = matchedCategories.map(
        (cat: ToolCategory): ToolSearchMatch => ({
          categoryName: cat.name,
          description: cat.description,
          keywords: cat.keywords,
          tools: cat.tools,
          alwaysLoaded: cat.alwaysLoaded,
          loaded: cat.tools.some((t) => loader.isLoaded(t)),
        }),
      );

      const loadedNames = matches
        .filter((m) => m.loaded)
        .map((m) => m.categoryName);

      const hint = autoLoaded
        ? `Category "${autoLoaded}" has been loaded. Its tools are now available.`
        : loadedNames.length > 0
        ? `Categories already loaded: ${loadedNames.join(', ')}. Call again with autoLoad: true to load others.`
        : `Found ${matches.length} matching categor${matches.length === 1 ? 'y' : 'ies'}. Call again with autoLoad: true to activate the best match.`;

      const summary =
        `Found ${matches.length} matching categor${matches.length === 1 ? 'y' : 'ies'} for "${query}"` +
        (autoLoaded ? ` — loaded "${autoLoaded}"` : '') +
        `.`;

      return {
        success: true,
        data: {
          query,
          matches,
          autoLoaded,
          hint,
        },
        output: summary,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[ToolSearch] Search failed: ${message}`, error instanceof Error ? error : undefined);

      return {
        success: false,
        error: {
          code: 'TOOL_SEARCH_ERROR',
          message,
        },
      };
    }
  },
};
