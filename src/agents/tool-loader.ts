/**
 * Tool Loader
 *
 * Manages tool categorization and lazy loading for the agentic system.
 * Provides search over tool categories so the AI can discover and enable
 * tools on demand without paying the full context cost of all schemas.
 */

import type { ToolDefinition } from '../chat/execution/types.js';

// Category Definition

export interface ToolCategory {
  /** Unique slug for this category (e.g. "file_ops") */
  name: string;
  /** Human-readable description shown to users and the AI */
  description: string;
  /** Keywords used for fuzzy search / auto-load decisions */
  keywords: string[];
  /** Canonical tool names that belong to this category */
  tools: string[];
  /** When true, these tools are always included in every session */
  alwaysLoaded: boolean;
}

// Built-in Category Definitions

const BUILT_IN_CATEGORIES: ToolCategory[] = [
  {
    name: 'always_loaded',
    description: 'Core tools that are always available in every session',
    keywords: ['core', 'always', 'base', 'default', 'essential'],
    tools: [
      'read_file',
      'write_file',
      'search_files',
      'exec',
      'git_status',
      'git_commit',
      'complete_task',
      'search_available_tools',
    ],
    alwaysLoaded: true,
  },
  {
    name: 'file_ops',
    description: 'Extended file system operations: edit, grep, patch, directory tree',
    keywords: ['file', 'filesystem', 'read', 'write', 'edit', 'grep', 'search', 'patch', 'directory'],
    tools: [
      'read_file',
      'write_file',
      'search_files',
      'grep',
      'edit_file',
      'directory_tree',
      'patch_apply',
      'multi_patch',
    ],
    alwaysLoaded: false,
  },
  {
    name: 'browser',
    description: 'Browser automation tools for web scraping and UI testing',
    keywords: ['browser', 'playwright', 'navigate', 'click', 'screenshot', 'web', 'automation', 'scrape'],
    tools: [
      'browser_navigate',
      'browser_click',
      'browser_fill',
      'browser_screenshot',
      'browser_evaluate',
    ],
    alwaysLoaded: false,
  },
  {
    name: 'integration',
    description: 'Third-party integration tools: Slack, Discord, Telegram, screen capture, clipboard',
    keywords: ['slack', 'discord', 'telegram', 'notification', 'clipboard', 'screen', 'capture', 'integration'],
    tools: [
      'slack_actions',
      'discord_actions',
      'telegram_actions',
      'screen_capture',
      'clipboard_read',
      'clipboard_write',
      'notify',
    ],
    alwaysLoaded: false,
  },
  {
    name: 'git_advanced',
    description: 'Advanced Git operations beyond status and commit',
    keywords: ['git', 'diff', 'log', 'branch', 'stash', 'remote', 'merge', 'rebase', 'version control'],
    tools: [
      'git_status',
      'git_diff',
      'git_log',
      'git_commit',
      'git_branch',
      'git_stash',
      'git_remote',
    ],
    alwaysLoaded: false,
  },
  {
    name: 'canvas',
    description: 'Canvas rendering and image generation tools',
    keywords: ['canvas', 'image', 'render', 'draw', 'generate', 'visual', 'graphic'],
    tools: [
      'canvas_render',
      'openai_image_gen',
      'image_analyze',
    ],
    alwaysLoaded: false,
  },
  {
    name: 'voice',
    description: 'Text-to-speech and voice synthesis tools',
    keywords: ['voice', 'tts', 'speech', 'audio', 'speak', 'synthesize'],
    tools: [
      'tts_speak',
    ],
    alwaysLoaded: false,
  },
  {
    name: 'memory',
    description: 'Conversation memory management: search, retrieval, and statistics',
    keywords: ['memory', 'remember', 'recall', 'search', 'context', 'history', 'retrieve'],
    tools: [
      'memory_search',
      'memory_get',
      'memory_stats',
    ],
    alwaysLoaded: false,
  },
  {
    name: 'system',
    description: 'System information, environment variables, and process management',
    keywords: ['system', 'env', 'environment', 'process', 'info', 'hardware', 'os', 'which', 'path'],
    tools: [
      'env',
      'system_info',
      'process_list',
      'path_info',
      'which',
    ],
    alwaysLoaded: false,
  },
];

// Tool Loader

export class ToolLoader {
  private allTools: Map<string, ToolDefinition>;
  private categories: Map<string, ToolCategory>;
  private loadedToolNames: Set<string>;

  constructor(allTools: Map<string, ToolDefinition>) {
    this.allTools = allTools;
    this.categories = new Map();
    this.loadedToolNames = new Set();

    // Register built-in categories
    for (const category of BUILT_IN_CATEGORIES) {
      this.categories.set(category.name, category);
    }

    // Pre-load always_loaded tools
    const alwaysLoaded = this.categories.get('always_loaded');
    if (alwaysLoaded) {
      for (const toolName of alwaysLoaded.tools) {
        if (this.allTools.has(toolName)) {
          this.loadedToolNames.add(toolName);
        }
      }
    }
  }

  /**
   * Return the subset of tools that are always loaded (core session tools).
   */
  getCoreTools(): ToolDefinition[] {
    const core = this.categories.get('always_loaded');
    if (!core) return [];

    return core.tools
      .map((name) => this.allTools.get(name))
      .filter((tool): tool is ToolDefinition => tool !== undefined);
  }

  /**
   * Return all tools that have been loaded for the current session,
   * including always_loaded plus any dynamically loaded categories/tools.
   */
  getSessionTools(): ToolDefinition[] {
    return Array.from(this.loadedToolNames)
      .map((name) => this.allTools.get(name))
      .filter((tool): tool is ToolDefinition => tool !== undefined);
  }

  /**
   * Search categories by query string.
   * Matches against category name, description, and keywords using
   * case-insensitive substring matching; results are ranked by score.
   */
  search(query: string): ToolCategory[] {
    if (!query.trim()) {
      return Array.from(this.categories.values());
    }

    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);

    const scored: Array<{ category: ToolCategory; score: number }> = [];

    for (const category of this.categories.values()) {
      let score = 0;

      for (const term of terms) {
        // Exact name match gets highest weight
        if (category.name === term) {
          score += 10;
        } else if (category.name.includes(term)) {
          score += 5;
        }

        // Description match
        if (category.description.toLowerCase().includes(term)) {
          score += 3;
        }

        // Keyword match
        for (const keyword of category.keywords) {
          if (keyword === term) {
            score += 4;
          } else if (keyword.includes(term)) {
            score += 2;
          }
        }

        // Tool name match
        for (const toolName of category.tools) {
          if (toolName.includes(term)) {
            score += 1;
          }
        }
      }

      if (score > 0) {
        scored.push({ category, score });
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .map((s) => s.category);
  }

  /**
   * Load all tools belonging to a named category into the active session.
   * Silently ignores tool names that are not registered.
   */
  loadCategory(categoryName: string): void {
    const category = this.categories.get(categoryName);
    if (!category) {
      return;
    }

    for (const toolName of category.tools) {
      if (this.allTools.has(toolName)) {
        this.loadedToolNames.add(toolName);
      }
    }
  }

  /**
   * Load a single tool by name into the active session.
   * Silently ignores names that are not registered.
   */
  loadTool(toolName: string): void {
    if (this.allTools.has(toolName)) {
      this.loadedToolNames.add(toolName);
    }
  }

  /**
   * Return all registered categories.
   */
  getCategories(): ToolCategory[] {
    return Array.from(this.categories.values());
  }

  /**
   * Register a custom category.
   * Will overwrite any existing category with the same name.
   */
  registerCategory(category: ToolCategory): void {
    this.categories.set(category.name, category);

    // If the new category is marked always_loaded, immediately load its tools
    if (category.alwaysLoaded) {
      this.loadCategory(category.name);
    }
  }

  /**
   * Check whether a specific tool is currently loaded into the session.
   */
  isLoaded(toolName: string): boolean {
    return this.loadedToolNames.has(toolName);
  }
}
