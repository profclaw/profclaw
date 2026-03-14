/**
 * Unified Tool Types
 *
 * Single source of truth for tool definitions.
 * All tools (browser, filesystem, git, etc.) use these types.
 */

import type { z } from 'zod';

// Core Tool Definition

/**
 * Tool category determines grouping and default permissions
 */
export type ToolCategory =
  | 'browser'     // Browser automation
  | 'filesystem'  // File read/write/search
  | 'git'         // Git operations
  | 'system'      // System info, env
  | 'web'         // Web fetch, search
  | 'execution'   // Shell commands
  | 'profclaw'       // PC-specific operations
  | 'memory'      // Conversation memory
  | 'data'        // Database, API calls
  | 'custom';     // User-defined

/**
 * Security level determines approval requirements
 */
export type SecurityLevel = 'safe' | 'moderate' | 'dangerous';

/**
 * Universal tool definition - define once, use everywhere
 */
export interface ToolDefinition<TParams = unknown, TResult = unknown> {
  /** Tool name (without any prefix) */
  name: string;

  /** Tool category for grouping */
  category: ToolCategory;

  /** Human-readable description */
  description: string;

  /** Security level: safe=read-only, moderate=writes, dangerous=system changes */
  securityLevel: SecurityLevel;

  /** Zod schema for parameters */
  parameters: z.ZodType<TParams, z.ZodTypeDef, unknown>;

  /**
   * Optional availability check. If defined, the tool is only included in the
   * tool list when `available` is true. Tools that require external dependencies
   * (API keys, services, binaries) should implement this.
   */
  isAvailable?: () => ToolAvailability;

  /** Execute the tool */
  execute: (params: TParams) => Promise<ToolResult<TResult>>;

  /** Example usages for documentation */
  examples?: ToolExample[];

  /** Optional rate limiting */
  rateLimit?: {
    maxCalls: number;
    windowMs: number;
  };
}

/**
 * Tool availability check result
 */
export interface ToolAvailability {
  available: boolean;
  reason?: string;
}

/**
 * Tool execution result
 */
export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  output: string;
  error?: {
    code: string;
    message: string;
    details?: unknown;
    retryable?: boolean;
  };
}

/**
 * Tool example for documentation
 */
export interface ToolExample {
  description: string;
  params: Record<string, unknown>;
  expectedOutput?: string;
}

// Tool Registry Types

/**
 * Tool collection with metadata
 */
export interface ToolCollection {
  /** Category this collection belongs to */
  category: ToolCategory;

  /** All tools in this collection */
  tools: ToolDefinition[];

  /** Safe tools (read-only, no approval needed) */
  safeTools: ToolDefinition[];

  /** Tool names for quick lookup */
  toolNames: string[];

  /** Safe tool names for default chat */
  safeToolNames: string[];
}

/**
 * Create a tool collection from an array of tools
 */
export function createToolCollection(
  category: ToolCategory,
  tools: ToolDefinition[]
): ToolCollection {
  const safeTools = tools.filter((t) => t.securityLevel === 'safe');

  return {
    category,
    tools,
    safeTools,
    toolNames: tools.map((t) => t.name),
    safeToolNames: safeTools.map((t) => t.name),
  };
}

// Adapter Types (for MCP, Chat, etc.)

/**
 * MCP tool schema format
 */
export interface MCPToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Native AI tool schema (OpenAI/Anthropic format)
 */
export interface AIToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}
