/**
 * Tool Adapters
 *
 * Convert universal tool definitions to specific formats:
 * - MCP (Model Context Protocol) for external AI agents
 * - Chat Execution for internal chat API
 * - AI SDK for native function calling
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type {
  ToolDefinition as ChatToolDefinition,
  ToolResult as ChatToolResult,
  ToolExecutionContext,
} from '../chat/execution/types.js';
import type {
  ToolDefinition,
  ToolResult,
  MCPToolSchema,
  AIToolSchema,
  ToolCategory,
} from './types.js';

// MCP Adapter

const MCP_PREFIX = 'profclaw__';

/**
 * Convert tool definition to MCP schema
 */
export function toMCPSchema(tool: ToolDefinition, prefix = MCP_PREFIX): MCPToolSchema {
  const jsonSchema = zodToJsonSchema(tool.parameters, {
    $refStrategy: 'none',
    target: 'openAi',
  });

  return {
    name: `${prefix}${tool.name}`,
    description: tool.description,
    inputSchema: jsonSchema as Record<string, unknown>,
  };
}

/**
 * Convert tool result to MCP CallToolResult
 */
export function toMCPResult(result: ToolResult): CallToolResult {
  if (!result.success) {
    return {
      content: [{ type: 'text', text: result.output }],
      isError: true,
    };
  }

  // Handle image data specially
  const data = result.data as Record<string, unknown> | undefined;
  if (data && typeof data === 'object' && 'base64' in data && 'mimeType' in data) {
    return {
      content: [
        {
          type: 'image',
          data: data.base64 as string,
          mimeType: data.mimeType as string,
        },
      ],
    };
  }

  return {
    content: [{ type: 'text', text: result.output }],
  };
}

/**
 * Create MCP handler for a set of tools
 */
export function createMCPHandler(
  tools: ToolDefinition[],
  prefix = MCP_PREFIX
): (name: string, args: unknown) => Promise<CallToolResult | null> {
  return async (name: string, args: unknown): Promise<CallToolResult | null> => {
    if (!name.startsWith(prefix)) {
      return null;
    }

    const toolName = name.slice(prefix.length);
    const tool = tools.find((t) => t.name === toolName);

    if (!tool) {
      return null;
    }

    // Parse and validate args
    const parsed = tool.parameters.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{ type: 'text', text: `Invalid parameters: ${parsed.error.message}` }],
        isError: true,
      };
    }

    // Execute tool
    const result = await tool.execute(parsed.data);
    return toMCPResult(result);
  };
}

// Chat Execution Adapter

/**
 * Convert universal tool to chat execution format
 */
export function toChatTool(tool: ToolDefinition): ChatToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    category: tool.category as ChatToolDefinition['category'],
    securityLevel: tool.securityLevel,
    allowedHosts: ['sandbox', 'gateway', 'local'],
    isAvailable: tool.isAvailable,
    parameters: tool.parameters,
    examples: tool.examples?.map((e) => ({
      description: e.description,
      params: e.params,
    })),

    async execute(_context: ToolExecutionContext, params: unknown): Promise<ChatToolResult> {
      const result = await tool.execute(params);
      return {
        success: result.success,
        data: result.data,
        output: result.output,
        error: result.error,
      };
    },
  };
}

/**
 * Convert multiple tools to chat execution format
 */
export function toChatTools(tools: ToolDefinition[]): ChatToolDefinition[] {
  return tools.map(toChatTool);
}

// AI SDK Adapter (OpenAI/Anthropic native format)

/**
 * Convert tool definition to AI SDK schema
 */
export function toAISchema(tool: ToolDefinition): AIToolSchema {
  const jsonSchema = zodToJsonSchema(tool.parameters, {
    $refStrategy: 'none',
    target: 'openAi',
  });

  const schemaObj = jsonSchema as {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };

  return {
    type: 'function',
    function: {
      name: tool.name,
      description: buildAIDescription(tool),
      parameters: {
        type: 'object',
        properties: schemaObj.properties ?? {},
        required: schemaObj.required,
      },
    },
  };
}

function buildAIDescription(tool: ToolDefinition): string {
  let desc = tool.description;

  if (tool.securityLevel === 'dangerous') {
    desc += '\n\n⚠️ This tool requires approval before execution.';
  } else if (tool.securityLevel === 'moderate') {
    desc += '\n\nNote: This tool may require approval depending on the operation.';
  }

  if (tool.examples?.length) {
    desc += '\n\nExamples:';
    for (const example of tool.examples.slice(0, 2)) {
      desc += `\n- ${example.description}`;
    }
  }

  return desc;
}

/**
 * Convert multiple tools to AI SDK format
 */
export function toAISchemas(tools: ToolDefinition[]): AIToolSchema[] {
  return tools.map(toAISchema);
}

// Utility Functions

/**
 * Filter tools by security level
 */
export function filterSafeTools(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.filter((t) => t.securityLevel === 'safe');
}

/**
 * Filter tools by category
 */
export function filterByCategory(tools: ToolDefinition[], category: ToolCategory): ToolDefinition[] {
  return tools.filter((t) => t.category === category);
}

/**
 * Get tool names
 */
export function getToolNames(tools: ToolDefinition[]): string[] {
  return tools.map((t) => t.name);
}

/**
 * Find tool by name
 */
export function findTool(tools: ToolDefinition[], name: string): ToolDefinition | undefined {
  return tools.find((t) => t.name === name);
}
