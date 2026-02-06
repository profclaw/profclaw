/**
 * MCP Tool Adapter
 *
 * Adapts profClaw's built-in tool registry to MCP tool format.
 * Allows external MCP clients to invoke profClaw tools with minimal setup.
 *
 * Security: only 'safe' and 'moderate' tools are exposed - 'dangerous' tools
 * are never surfaced over MCP.
 */

import { randomUUID } from 'crypto';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getToolRegistry } from '../chat/execution/registry.js';
import { getSessionManager } from '../chat/execution/index.js';
import type {
  ToolDefinition,
  ToolExecutionContext,
  SecurityPolicy,
} from '../chat/execution/types.js';
import { logger } from '../utils/logger.js';

// Constants

const PROFCLAW_PREFIX = 'profclaw__';
const ALLOWED_SECURITY_LEVELS = new Set<ToolDefinition['securityLevel']>(['safe', 'moderate']);

const MCP_SECURITY_POLICY: SecurityPolicy = {
  mode: 'allowlist',
};

// Public Types

/**
 * A single tool in MCP wire format.
 */
export interface MCPToolSchema {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Metadata kept alongside the schema for internal routing.
 */
export interface AdaptedTool {
  schema: MCPToolSchema;
  /** Original tool name (without prefix) */
  internalName: string;
  securityLevel: ToolDefinition['securityLevel'];
}

// adaptToolsToMCP

/**
 * Converts all registered profClaw tools that have securityLevel 'safe' or
 * 'moderate' to MCP tool schemas.
 *
 * Tools are prefixed with `profclaw__` to avoid name collisions when mixed
 * with other MCP servers.
 */
export function adaptToolsToMCP(): AdaptedTool[] {
  const registry = getToolRegistry();
  const allTools = registry.list();

  const adapted: AdaptedTool[] = [];

  for (const tool of allTools) {
    if (!ALLOWED_SECURITY_LEVELS.has(tool.securityLevel)) {
      logger.debug(
        `[MCPToolAdapter] Skipping tool "${tool.name}" (securityLevel="${tool.securityLevel}")`,
        { component: 'MCPToolAdapter' },
      );
      continue;
    }

    // Honour the optional availability check
    if (tool.isAvailable) {
      const availability = tool.isAvailable();
      if (!availability.available) {
        logger.debug(
          `[MCPToolAdapter] Skipping unavailable tool "${tool.name}": ${availability.reason ?? 'no reason'}`,
          { component: 'MCPToolAdapter' },
        );
        continue;
      }
    }

    const schema = buildMCPSchema(tool);
    adapted.push({
      schema,
      internalName: tool.name,
      securityLevel: tool.securityLevel,
    });
  }

  logger.info(
    `[MCPToolAdapter] Adapted ${adapted.length} tool(s) to MCP format (${allTools.length - adapted.length} skipped)`,
    { component: 'MCPToolAdapter' },
  );

  return adapted;
}

// handleMCPToolCall

/**
 * Executes a profClaw tool invoked via an MCP call.
 *
 * @param toolName - MCP tool name (may include `profclaw__` prefix)
 * @param args     - Raw arguments from the MCP client (validated before execution)
 * @returns        - MCP CallToolResult
 */
export async function handleMCPToolCall(
  toolName: string,
  args: unknown,
): Promise<CallToolResult> {
  // Strip prefix to resolve the internal tool name
  const internalName = toolName.startsWith(PROFCLAW_PREFIX)
    ? toolName.slice(PROFCLAW_PREFIX.length)
    : toolName;

  const registry = getToolRegistry();
  const tool = registry.get(internalName);

  if (!tool) {
    logger.warn(`[MCPToolAdapter] Tool not found: "${internalName}"`, { component: 'MCPToolAdapter' });
    return mcpError(`Tool not found: ${toolName}`);
  }

  // Refuse to execute dangerous tools regardless of how the request arrived
  if (!ALLOWED_SECURITY_LEVELS.has(tool.securityLevel)) {
    logger.warn(
      `[MCPToolAdapter] Blocked execution of dangerous tool: "${internalName}"`,
      { component: 'MCPToolAdapter' },
    );
    return mcpError(`Tool "${toolName}" is not permitted over MCP (securityLevel="${tool.securityLevel}")`);
  }

  // Validate args with the tool's Zod schema
  const parseResult = tool.parameters.safeParse(args);
  if (!parseResult.success) {
    const issues = parseResult.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    logger.warn(`[MCPToolAdapter] Validation failed for "${internalName}": ${issues}`, {
      component: 'MCPToolAdapter',
    });
    return mcpError(`Invalid arguments for tool "${toolName}": ${issues}`);
  }

  const context = buildExecutionContext();

  const start = Date.now();
  try {
    const result = await tool.execute(context, parseResult.data);
    const durationMs = Date.now() - start;

    logger.info(
      `[MCPToolAdapter] Tool "${internalName}" completed in ${durationMs}ms (success=${result.success})`,
      { component: 'MCPToolAdapter' },
    );

    if (!result.success) {
      const message = result.error?.message ?? result.output ?? 'Tool execution failed';
      return mcpError(message);
    }

    // Serialise the result to a human-readable text block. Prefer explicit
    // output string, then JSON-serialise the data payload.
    const text = formatToolResult(result);
    return {
      content: [{ type: 'text', text }],
    };
  } catch (error) {
    const durationMs = Date.now() - start;
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[MCPToolAdapter] Tool "${internalName}" threw after ${durationMs}ms: ${message}`, {
      component: 'MCPToolAdapter',
    });
    return mcpError(`Tool execution error: ${message}`);
  }
}

// Helpers

/**
 * Converts a ToolDefinition to an MCPToolSchema.
 */
function buildMCPSchema(tool: ToolDefinition): MCPToolSchema {
  const jsonSchema = zodToJsonSchema(tool.parameters, {
    $refStrategy: 'none',
    target: 'openAi',
  }) as {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };

  return {
    name: `${PROFCLAW_PREFIX}${tool.name}`,
    description: buildDescription(tool),
    inputSchema: {
      type: 'object',
      properties: jsonSchema.properties ?? {},
      ...(jsonSchema.required !== undefined ? { required: jsonSchema.required } : {}),
    },
  };
}

/**
 * Augments the tool description with security and example information.
 */
function buildDescription(tool: ToolDefinition): string {
  let desc = tool.description;

  if (tool.securityLevel === 'moderate') {
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
 * Builds a minimal ToolExecutionContext for MCP-originated calls.
 */
function buildExecutionContext(): ToolExecutionContext {
  return {
    toolCallId: randomUUID(),
    conversationId: `mcp-${randomUUID()}`,
    workdir: process.cwd(),
    env: { ...process.env } as Record<string, string>,
    securityPolicy: MCP_SECURITY_POLICY,
    sessionManager: getSessionManager(),
  };
}

/**
 * Serialises a ToolResult payload into a plain-text string for MCP.
 */
function formatToolResult(result: { output?: string; data?: unknown }): string {
  if (result.output) {
    return result.output;
  }
  if (result.data !== undefined) {
    try {
      return typeof result.data === 'string'
        ? result.data
        : JSON.stringify(result.data, null, 2);
    } catch {
      return String(result.data);
    }
  }
  return 'Tool executed successfully.';
}

/**
 * Wraps an error message into a MCP CallToolResult with isError=true.
 */
function mcpError(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}
