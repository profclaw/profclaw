import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { logger } from '../utils/logger.js';

export interface MCPServerConfig {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  enabled?: boolean;
}

export interface MCPTool {
  serverName: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPClientStatus {
  name: string;
  connected: boolean;
  transport: 'stdio' | 'sse';
  toolCount: number;
  error?: string;
}

interface ConnectedServer {
  client: Client;
  config: MCPServerConfig;
  tools: MCPTool[];
  transport: 'stdio' | 'sse';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractToolSchema(raw: unknown): Record<string, unknown> {
  if (isRecord(raw)) return raw;
  return {};
}

export class MCPClientManager {
  private servers: Map<string, ConnectedServer> = new Map();

  /**
   * Connect to an MCP server using stdio or SSE transport.
   */
  async connect(config: MCPServerConfig): Promise<void> {
    const { name, enabled = true } = config;

    if (!enabled) {
      logger.info(`[MCP] Skipping disabled server: ${name}`);
      return;
    }

    if (this.servers.has(name)) {
      logger.warn(`[MCP] Server already connected: ${name}. Disconnecting first.`);
      await this.disconnect(name);
    }

    if (!config.command && !config.url) {
      throw new Error(`[MCP] Server config for "${name}" must have either 'command' or 'url'.`);
    }

    const transportType: 'stdio' | 'sse' = config.url ? 'sse' : 'stdio';

    logger.info(`[MCP] Connecting to server: ${name} (${transportType})`);

    try {
      let transport: StdioClientTransport | SSEClientTransport;

      if (transportType === 'stdio') {
        transport = new StdioClientTransport({
          command: config.command!,
          args: config.args ?? [],
          env: config.env,
        });
      } else {
        transport = new SSEClientTransport(new URL(config.url!));
      }

      const client = new Client(
        { name: 'profclaw-mcp-client', version: '1.0.0' },
        { capabilities: {} },
      );

      await client.connect(transport);

      const toolsResponse = await client.listTools();

      const tools: MCPTool[] = (toolsResponse.tools ?? []).map((t) => ({
        serverName: name,
        name: t.name,
        description: t.description,
        inputSchema: extractToolSchema(t.inputSchema),
      }));

      this.servers.set(name, { client, config, tools, transport: transportType });

      logger.info(`[MCP] Connected to "${name}" - ${tools.length} tool(s) available`, {
        server: name,
        toolCount: tools.length,
        tools: tools.map((t) => t.name),
      });
    } catch (error) {
      logger.error(
        `[MCP] Failed to connect to server: ${name}`,
        error instanceof Error ? error : undefined,
        { server: name },
      );
      throw error;
    }
  }

  /**
   * Disconnect from a named MCP server and clean up its resources.
   */
  async disconnect(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) {
      logger.warn(`[MCP] disconnect called for unknown server: ${name}`);
      return;
    }

    try {
      await server.client.close();
      logger.info(`[MCP] Disconnected from server: ${name}`);
    } catch (error) {
      logger.error(
        `[MCP] Error while disconnecting from server: ${name}`,
        error instanceof Error ? error : undefined,
        { server: name },
      );
    } finally {
      this.servers.delete(name);
    }
  }

  /**
   * Disconnect from all connected MCP servers.
   */
  async disconnectAll(): Promise<void> {
    const names = Array.from(this.servers.keys());
    logger.info(`[MCP] Disconnecting from all servers (${names.length})`);

    await Promise.allSettled(names.map((name) => this.disconnect(name)));
  }

  /**
   * Return a flat list of all tools from all connected servers.
   */
  listTools(): MCPTool[] {
    const all: MCPTool[] = [];
    for (const server of this.servers.values()) {
      all.push(...server.tools);
    }
    return all;
  }

  /**
   * Execute a tool on a specific MCP server.
   */
  async callTool(serverName: string, toolName: string, args: unknown): Promise<unknown> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`[MCP] No connected server named "${serverName}".`);
    }

    const toolExists = server.tools.some((t) => t.name === toolName);
    if (!toolExists) {
      throw new Error(`[MCP] Tool "${toolName}" not found on server "${serverName}".`);
    }

    logger.debug(`[MCP] Calling tool "${toolName}" on server "${serverName}"`, {
      server: serverName,
      tool: toolName,
    });

    try {
      const safeArgs = isRecord(args) ? args : {};
      const result = await server.client.callTool({ name: toolName, arguments: safeArgs });

      logger.debug(`[MCP] Tool "${toolName}" on "${serverName}" completed`, {
        server: serverName,
        tool: toolName,
      });

      return result;
    } catch (error) {
      logger.error(
        `[MCP] Tool call failed: "${toolName}" on "${serverName}"`,
        error instanceof Error ? error : undefined,
        { server: serverName, tool: toolName },
      );
      throw error;
    }
  }

  /**
   * Return the connection status of every known server.
   */
  getStatus(): MCPClientStatus[] {
    return Array.from(this.servers.entries()).map(([name, server]) => ({
      name,
      connected: true,
      transport: server.transport,
      toolCount: server.tools.length,
    }));
  }

  /**
   * Return a list of currently connected server names.
   */
  getConnectedServers(): string[] {
    return Array.from(this.servers.keys());
  }
}

export const mcpClientManager = new MCPClientManager();
