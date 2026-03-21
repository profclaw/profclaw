/**
 * MCP Routes
 *
 * API endpoints for managing MCP server connections and tool discovery.
 *
 * Endpoints:
 *   GET  /api/mcp/status           - MCP server/client status
 *   GET  /api/mcp/tools            - List tools from connected MCP servers
 *   POST /api/mcp/servers/:name/connect    - Connect to an MCP server
 *   POST /api/mcp/servers/:name/disconnect - Disconnect from an MCP server
 */

import { Hono } from 'hono';
import { logger } from '../utils/logger.js';

export const mcpRoutes = new Hono();

type MCPRuntime = {
  mcpClientManager: typeof import('../mcp/client.js')['mcpClientManager'];
  adaptToolsToMCP: typeof import('../mcp/tool-adapter.js')['adaptToolsToMCP'];
};

let runtimePromise: Promise<MCPRuntime> | null = null;

async function getMcpRuntime(): Promise<MCPRuntime> {
  if (!runtimePromise) {
    runtimePromise = Promise.all([
      import('../mcp/client.js'),
      import('../mcp/tool-adapter.js'),
    ]).then(([clientModule, adapterModule]) => ({
      mcpClientManager: clientModule.mcpClientManager,
      adaptToolsToMCP: adapterModule.adaptToolsToMCP,
    }));
  }

  return runtimePromise;
}

// GET / - MCP overview (alias for /status)
mcpRoutes.get('/', async (c) => {
  try {
    const { mcpClientManager, adaptToolsToMCP } = await getMcpRuntime();
    const connectedServers = mcpClientManager.getStatus();
    const adaptedTools = adaptToolsToMCP();

    return c.json({
      server: {
        enabled: true,
        toolsExposed: adaptedTools.length,
      },
      clients: connectedServers,
      connectedCount: connectedServers.filter((s) => s.connected).length,
      totalServers: connectedServers.length,
    });
  } catch (error) {
    logger.error('[MCP Routes] Status error:', error instanceof Error ? error : undefined);
    return c.json({ error: 'Failed to get MCP status' }, 500);
  }
});

// GET /status - MCP server/client status
mcpRoutes.get('/status', async (c) => {
  try {
    const { mcpClientManager, adaptToolsToMCP } = await getMcpRuntime();
    const connectedServers = mcpClientManager.getStatus();
    const adaptedTools = adaptToolsToMCP();

    return c.json({
      server: {
        enabled: true,
        toolsExposed: adaptedTools.length,
      },
      clients: connectedServers,
      connectedCount: connectedServers.filter((s) => s.connected).length,
      totalServers: connectedServers.length,
    });
  } catch (error) {
    logger.error('[MCP Routes] Status error:', error instanceof Error ? error : undefined);
    return c.json({ error: 'Failed to get MCP status' }, 500);
  }
});

// GET /tools - List tools from all connected MCP servers + adapted profClaw tools
mcpRoutes.get('/tools', async (c) => {
  try {
    const { mcpClientManager, adaptToolsToMCP } = await getMcpRuntime();
    // Get tools from connected external MCP servers
    const externalTools = mcpClientManager.listTools().map((t) => ({
      name: t.name,
      server: t.serverName,
      description: t.description,
      source: 'external' as const,
    }));

    // Get profClaw tools adapted to MCP format
    const internalTools = adaptToolsToMCP().map((t) => ({
      name: t.schema.name,
      server: 'profclaw',
      description: t.schema.description,
      source: 'internal' as const,
    }));

    return c.json({
      tools: [...internalTools, ...externalTools],
      totalInternal: internalTools.length,
      totalExternal: externalTools.length,
    });
  } catch (error) {
    logger.error('[MCP Routes] Tools listing error:', error instanceof Error ? error : undefined);
    return c.json({ error: 'Failed to list MCP tools' }, 500);
  }
});

// POST /servers/:name/connect - Connect to a configured MCP server
mcpRoutes.post('/servers/:name/connect', async (c) => {
  const { name } = c.req.param();

  try {
    const { mcpClientManager } = await getMcpRuntime();
    // Read MCP server configs from settings
    // For now, accept the config in the request body
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;

    const config = {
      name,
      command: body.command as string | undefined,
      args: body.args as string[] | undefined,
      env: body.env as Record<string, string> | undefined,
      url: body.url as string | undefined,
    };

    if (!config.command && !config.url) {
      return c.json({ error: 'Must provide either command (for stdio) or url (for SSE)' }, 400);
    }

    await mcpClientManager.connect(config);

    return c.json({
      connected: true,
      name,
      tools: mcpClientManager.listTools()
        .filter((t) => t.serverName === name)
        .length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection failed';
    logger.error(`[MCP Routes] Connect error for ${name}:`, error instanceof Error ? error : undefined);
    return c.json({ error: message }, 500);
  }
});

// POST /servers/:name/disconnect - Disconnect from an MCP server
mcpRoutes.post('/servers/:name/disconnect', async (c) => {
  const { name } = c.req.param();

  try {
    const { mcpClientManager } = await getMcpRuntime();
    await mcpClientManager.disconnect(name);
    return c.json({ disconnected: true, name });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Disconnect failed';
    logger.error(`[MCP Routes] Disconnect error for ${name}:`, error instanceof Error ? error : undefined);
    return c.json({ error: message }, 500);
  }
});
