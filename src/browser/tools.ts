/**
 * Browser Tools - Single Source of Truth
 *
 * Define browser tools once, use everywhere:
 * - MCP Server (glinr__browser_* prefix)
 * - Chat Execution (browser_* prefix)
 *
 * Uses unified tool types from src/tools/types.ts
 */

import { z } from 'zod';
import {
  getBrowserService,
  formatSnapshotResponse,
  formatSearchResponse,
} from './index.js';
import type { ToolDefinition, ToolResult, ToolAvailability } from '../tools/types.js';

// =============================================================================
// Availability Check
// =============================================================================

/** Cache browser availability to avoid repeated checks */
let browserAvailabilityCache: ToolAvailability | null = null;

/**
 * Check if Playwright browser is available
 * Caches result to avoid repeated expensive checks
 */
function checkBrowserAvailability(): ToolAvailability {
  if (browserAvailabilityCache) {
    return browserAvailabilityCache;
  }

  try {
    // Try to dynamically import playwright-core to check if it's installed
    // The actual browser launch happens lazily in the service
    require.resolve('playwright-core');
    browserAvailabilityCache = { available: true };
  } catch {
    browserAvailabilityCache = {
      available: false,
      reason: 'Playwright is not installed. Run: pnpm add playwright-core',
    };
  }

  return browserAvailabilityCache;
}

// Re-export for backwards compatibility
export type BrowserToolDefinition<TParams = unknown, TResult = unknown> = ToolDefinition<TParams, TResult>;
export type BrowserToolResult<T = unknown> = ToolResult<T>;

// =============================================================================
// Parameter Schemas
// =============================================================================

export const NavigateParamsSchema = z.object({
  url: z.string().url().describe('URL to navigate to'),
  pageId: z.string().optional().describe('Page ID (creates new if not provided)'),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional()
    .describe('When to consider navigation complete (default: domcontentloaded)'),
});

export const SnapshotParamsSchema = z.object({
  pageId: z.string().optional().describe('Page ID to snapshot'),
  compress: z.boolean().optional().default(true).describe('Apply intelligent DOM compression'),
  interactive: z.boolean().optional().default(false).describe('Only include interactive elements'),
  selector: z.string().optional().describe('CSS selector to scope snapshot'),
});

export const ClickParamsSchema = z.object({
  ref: z.string().describe('Element ref from snapshot (e.g., e5)'),
  pageId: z.string().optional().describe('Page ID'),
  element: z.string().optional().describe('Element description for logging'),
  button: z.enum(['left', 'right', 'middle']).optional().describe('Mouse button (default: left)'),
  doubleClick: z.boolean().optional().describe('Perform double click'),
  modifiers: z.array(z.enum(['Alt', 'Control', 'Meta', 'Shift'])).optional()
    .describe('Modifier keys to hold during click'),
});

export const TypeParamsSchema = z.object({
  ref: z.string().describe('Element ref from snapshot'),
  text: z.string().describe('Text to type'),
  pageId: z.string().optional().describe('Page ID'),
  clear: z.boolean().optional().describe('Clear existing text first'),
  submit: z.boolean().optional().describe('Press Enter after typing'),
});

export const SearchParamsSchema = z.object({
  pattern: z.string().describe('Search pattern (regex supported)'),
  pageId: z.string().optional().describe('Page ID'),
  ignoreCase: z.boolean().optional().default(true).describe('Case insensitive search'),
  limit: z.number().optional().default(20).describe('Max results'),
});

export const ScreenshotParamsSchema = z.object({
  pageId: z.string().optional().describe('Page ID'),
  fullPage: z.boolean().optional().describe('Capture full page'),
  ref: z.string().optional().describe('Element ref to screenshot'),
  type: z.enum(['png', 'jpeg']).optional().describe('Image format (default: png)'),
});

export const PagesParamsSchema = z.object({});

export const CloseParamsSchema = z.object({
  pageId: z.string().optional().describe('Page to close (closes all if not specified)'),
});

// =============================================================================
// Type Exports
// =============================================================================

export type NavigateParams = z.infer<typeof NavigateParamsSchema>;
export type SnapshotParams = z.infer<typeof SnapshotParamsSchema>;
export type ClickParams = z.infer<typeof ClickParamsSchema>;
export type TypeParams = z.infer<typeof TypeParamsSchema>;
export type SearchParams = z.infer<typeof SearchParamsSchema>;
export type ScreenshotParams = z.infer<typeof ScreenshotParamsSchema>;
export type PagesParams = z.infer<typeof PagesParamsSchema>;
export type CloseParams = z.infer<typeof CloseParamsSchema>;

// =============================================================================
// Result Types
// =============================================================================

export interface NavigateResult {
  pageId: string;
  url: string;
  title: string;
  snapshot: string;
}

export interface SnapshotResult {
  pageId: string;
  elementCount: number;
  snapshot: string;
}

export interface ClickResult {
  ref: string;
  executed: string;
  snapshot: string;
}

export interface TypeResult {
  ref: string;
  text: string;
  executed: string;
  snapshot: string;
}

export interface SearchResult {
  pattern: string;
  matches: Array<{ ref: string; text: string; role: string }>;
  count: number;
}

export interface ScreenshotResult {
  base64: string;
  mimeType: string;
  bytes: number;
}

export interface PagesResult {
  pages: Array<{ id: string; url: string; title: string }>;
  count: number;
}

export interface CloseResult {
  closed: string;
}

// =============================================================================
// Tool Definitions (Single Source of Truth)
// =============================================================================

export const browserNavigateTool: BrowserToolDefinition<NavigateParams, NavigateResult> = {
  name: 'browser_navigate',
  category: 'browser',
  description: `Navigate browser to a URL. Creates new page if needed. Returns page state with accessibility snapshot.
Use for: Loading web pages, following links, web scraping setup.
Element refs (e1, e2...) in the snapshot can be used with browser_click and browser_type.`,
  securityLevel: 'moderate',
  parameters: NavigateParamsSchema,
  isAvailable: checkBrowserAvailability,
  examples: [
    { description: 'Navigate to GitHub', params: { url: 'https://github.com' } },
    { description: 'Load with network idle', params: { url: 'https://example.com', waitUntil: 'networkidle' } },
  ],
  async execute(params) {
    try {
      const browser = getBrowserService();
      const result = await browser.navigate(params.url, {
        pageId: params.pageId,
        waitUntil: params.waitUntil,
      });
      const snapshot = await browser.snapshot({ pageId: result.pageId });

      return {
        success: true,
        data: {
          pageId: result.pageId,
          url: result.url,
          title: result.title,
          snapshot: formatSnapshotResponse(snapshot),
        },
        output: `### Navigated to ${result.url}\n\n${formatSnapshotResponse(snapshot)}`,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'NAVIGATE_ERROR',
          message: error instanceof Error ? error.message : 'Navigation failed',
        },
        output: `Navigation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};

export const browserSnapshotTool: BrowserToolDefinition<SnapshotParams, SnapshotResult> = {
  name: 'browser_snapshot',
  category: 'browser',
  description: `Get accessibility tree snapshot of page. Elements have refs like e1, e2 for interaction.
Use compress=true (default) to reduce token usage. Use interactive=true to only show clickable elements.`,
  securityLevel: 'safe',
  parameters: SnapshotParamsSchema,
  isAvailable: checkBrowserAvailability,
  examples: [
    { description: 'Get full snapshot', params: {} },
    { description: 'Interactive elements only', params: { interactive: true } },
    { description: 'Scope to form', params: { selector: 'form' } },
  ],
  async execute(params) {
    try {
      const browser = getBrowserService();
      const snapshot = await browser.snapshot({
        pageId: params.pageId,
        compress: params.compress ?? true,
        interactive: params.interactive ?? false,
        selector: params.selector,
      });

      return {
        success: true,
        data: {
          pageId: snapshot.pageId,
          elementCount: snapshot.totalElements,
          snapshot: formatSnapshotResponse(snapshot),
        },
        output: formatSnapshotResponse(snapshot),
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'SNAPSHOT_ERROR',
          message: error instanceof Error ? error.message : 'Snapshot failed',
        },
        output: `Snapshot failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};

export const browserClickTool: BrowserToolDefinition<ClickParams, ClickResult> = {
  name: 'browser_click',
  category: 'browser',
  description: `Click an element identified by ref from snapshot. Get refs by calling browser_snapshot first.
Supports left/right/middle click, double-click, and modifier keys.`,
  securityLevel: 'moderate',
  parameters: ClickParamsSchema,
  isAvailable: checkBrowserAvailability,
  examples: [
    { description: 'Click element', params: { ref: 'e3' } },
    { description: 'Double click', params: { ref: 'e5', doubleClick: true } },
    { description: 'Right click', params: { ref: 'e7', button: 'right' } },
  ],
  async execute(params) {
    try {
      const browser = getBrowserService();
      const result = await browser.click({
        pageId: params.pageId,
        ref: params.ref,
        element: params.element,
        button: params.button,
        doubleClick: params.doubleClick,
        modifiers: params.modifiers,
      });
      const snapshot = await browser.snapshot({ pageId: params.pageId });

      return {
        success: true,
        data: {
          ref: params.ref,
          executed: result.executed,
          snapshot: formatSnapshotResponse(snapshot),
        },
        output: `### Clicked ${params.element || params.ref}\n\n\`\`\`js\n${result.executed}\n\`\`\`\n\n${formatSnapshotResponse(snapshot)}`,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'CLICK_ERROR',
          message: error instanceof Error ? error.message : 'Click failed',
        },
        output: `Click failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};

export const browserTypeTool: BrowserToolDefinition<TypeParams, TypeResult> = {
  name: 'browser_type',
  category: 'browser',
  description: `Type text into an input element. Use ref from snapshot to target the element.
Can clear existing text first and press Enter after typing to submit forms.`,
  securityLevel: 'moderate',
  parameters: TypeParamsSchema,
  isAvailable: checkBrowserAvailability,
  examples: [
    { description: 'Type in search', params: { ref: 'e4', text: 'hello world' } },
    { description: 'Clear and type', params: { ref: 'e6', text: 'new value', clear: true } },
    { description: 'Type and submit', params: { ref: 'e8', text: 'search query', submit: true } },
  ],
  async execute(params) {
    try {
      const browser = getBrowserService();
      const result = await browser.type({
        pageId: params.pageId,
        ref: params.ref,
        text: params.text,
        clear: params.clear,
        submit: params.submit,
      });
      const snapshot = await browser.snapshot({ pageId: params.pageId });

      return {
        success: true,
        data: {
          ref: params.ref,
          text: params.text,
          executed: result.executed,
          snapshot: formatSnapshotResponse(snapshot),
        },
        output: `### Typed "${params.text}" into ${params.ref}\n\n\`\`\`js\n${result.executed}\n\`\`\`\n\n${formatSnapshotResponse(snapshot)}`,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'TYPE_ERROR',
          message: error instanceof Error ? error.message : 'Type failed',
        },
        output: `Type failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};

export const browserSearchTool: BrowserToolDefinition<SearchParams, SearchResult> = {
  name: 'browser_search',
  category: 'browser',
  description: `Search page snapshot for text/pattern. Returns matching elements with refs. Supports regex.
Use to find specific buttons, links, or text content on the page.`,
  securityLevel: 'safe',
  parameters: SearchParamsSchema,
  isAvailable: checkBrowserAvailability,
  examples: [
    { description: 'Find sign in', params: { pattern: 'Sign in' } },
    { description: 'Find all buttons', params: { pattern: 'button', ignoreCase: true } },
    { description: 'Regex search', params: { pattern: 'Submit|Save|OK' } },
  ],
  async execute(params) {
    try {
      const browser = getBrowserService();
      const results = await browser.search({
        pageId: params.pageId,
        pattern: params.pattern,
        ignoreCase: params.ignoreCase ?? true,
        limit: params.limit ?? 20,
      });

      return {
        success: true,
        data: {
          pattern: params.pattern,
          matches: results.results.map((m) => ({
            ref: m.ref,
            text: m.text,
            role: m.role,
          })),
          count: results.results.length,
        },
        output: formatSearchResponse(results),
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'SEARCH_ERROR',
          message: error instanceof Error ? error.message : 'Search failed',
        },
        output: `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};

export const browserScreenshotTool: BrowserToolDefinition<ScreenshotParams, ScreenshotResult> = {
  name: 'browser_screenshot',
  category: 'browser',
  description: `Take screenshot of page. Returns base64 image. Can screenshot specific element by ref.
Use for visual verification or capturing page state.`,
  securityLevel: 'safe',
  parameters: ScreenshotParamsSchema,
  isAvailable: checkBrowserAvailability,
  examples: [
    { description: 'Current viewport', params: {} },
    { description: 'Full page', params: { fullPage: true } },
    { description: 'Specific element', params: { ref: 'e10' } },
  ],
  async execute(params) {
    try {
      const browser = getBrowserService();
      const result = await browser.screenshot({
        pageId: params.pageId,
        fullPage: params.fullPage,
        ref: params.ref,
        type: params.type,
      });

      return {
        success: true,
        data: {
          base64: result.base64,
          mimeType: result.mimeType,
          bytes: result.base64.length,
        },
        output: `Screenshot captured (${result.base64.length} bytes, ${result.mimeType})`,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'SCREENSHOT_ERROR',
          message: error instanceof Error ? error.message : 'Screenshot failed',
        },
        output: `Screenshot failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};

export const browserPagesTool: BrowserToolDefinition<PagesParams, PagesResult> = {
  name: 'browser_pages',
  category: 'browser',
  description: `List all open browser pages with their URLs and titles.
Use to see what pages are currently open and get their pageIds.`,
  securityLevel: 'safe',
  parameters: PagesParamsSchema,
  isAvailable: checkBrowserAvailability,
  examples: [{ description: 'List pages', params: {} }],
  async execute(_params) {
    try {
      const browser = getBrowserService();
      const pages = await browser.listPages();

      if (pages.length === 0) {
        return {
          success: true,
          data: { pages: [], count: 0 },
          output: 'No open pages. Use browser_navigate to open a page.',
        };
      }

      const text = pages
        .map((p, i) => `${i + 1}. [${p.id}] ${p.title}\n   URL: ${p.url}`)
        .join('\n\n');

      return {
        success: true,
        data: {
          pages: pages.map((p) => ({ id: p.id, url: p.url, title: p.title })),
          count: pages.length,
        },
        output: `### Open pages (${pages.length})\n\n${text}`,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'PAGES_ERROR',
          message: error instanceof Error ? error.message : 'Failed to list pages',
        },
        output: `Failed to list pages: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};

export const browserCloseTool: BrowserToolDefinition<CloseParams, CloseResult> = {
  name: 'browser_close',
  category: 'browser',
  description: `Close a specific page or all pages if no pageId provided.
Use to clean up browser resources after completing tasks.`,
  securityLevel: 'safe',
  parameters: CloseParamsSchema,
  isAvailable: checkBrowserAvailability,
  examples: [
    { description: 'Close all', params: {} },
    { description: 'Close specific page', params: { pageId: 'page-1' } },
  ],
  async execute(params) {
    try {
      const browser = getBrowserService();

      if (params.pageId) {
        await browser.closePage(params.pageId);
        return {
          success: true,
          data: { closed: params.pageId },
          output: `Closed page: ${params.pageId}`,
        };
      } else {
        await browser.close();
        return {
          success: true,
          data: { closed: 'all' },
          output: 'Closed all pages and browser.',
        };
      }
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'CLOSE_ERROR',
          message: error instanceof Error ? error.message : 'Close failed',
        },
        output: `Close failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};

// =============================================================================
// All Browser Tools (Single Array)
// =============================================================================

export const BROWSER_TOOLS = [
  browserNavigateTool,
  browserSnapshotTool,
  browserClickTool,
  browserTypeTool,
  browserSearchTool,
  browserScreenshotTool,
  browserPagesTool,
  browserCloseTool,
] as const;

// Tool names for filtering
export const BROWSER_TOOL_NAMES = BROWSER_TOOLS.map((t) => t.name);

// Safe tools (read-only operations)
export const SAFE_BROWSER_TOOLS = BROWSER_TOOLS.filter((t) => t.securityLevel === 'safe');
export const SAFE_BROWSER_TOOL_NAMES = SAFE_BROWSER_TOOLS.map((t) => t.name);
