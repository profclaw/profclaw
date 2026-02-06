/**
 * MCP CLI Commands
 *
 * Manage MCP server connections from the command line.
 *
 * Usage:
 *   profclaw mcp status
 *   profclaw mcp list-tools
 *   profclaw mcp connect <name>
 *   profclaw mcp disconnect <name>
 *   profclaw mcp serve
 */

import { spawn } from 'child_process';
import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import { createTable, success, error, info, spinner, truncate } from '../utils/output.js';

interface McpServerStatus {
  name: string;
  transport: string;
  connected: boolean;
  toolCount: number;
}

interface McpStatusResponse {
  servers: McpServerStatus[];
}

interface McpTool {
  name: string;
  server: string;
  description: string;
}

interface McpToolsResponse {
  tools: McpTool[];
}

interface McpConnectResponse {
  name: string;
  connected: boolean;
}

export function mcpCommands(): Command {
  const cmd = new Command('mcp')
    .description('Manage MCP server connections');

  // profclaw mcp status
  cmd
    .command('status')
    .description('Show MCP server connection status')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const spin = spinner('Fetching MCP status...').start();
      const result = await api.get<McpStatusResponse>('/api/mcp/status');
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to fetch MCP status');
        process.exit(1);
      }

      const { servers } = result.data!;

      if (options.json) {
        console.log(JSON.stringify(result.data, null, 2));
        return;
      }

      if (servers.length === 0) {
        info('No MCP servers configured.');
        info('Add MCP servers to your profClaw config to connect.');
        return;
      }

      const table = createTable(['Name', 'Transport', 'Status', 'Tools']);

      for (const s of servers) {
        const statusDisplay = s.connected
          ? chalk.green('● connected')
          : chalk.red('● disconnected');
        const toolsDisplay = s.connected
          ? chalk.cyan(String(s.toolCount))
          : chalk.dim('-');

        table.push([chalk.bold(s.name), chalk.dim(s.transport), statusDisplay, toolsDisplay]);
      }

      console.log(table.toString());
      const connected = servers.filter((s) => s.connected).length;
      console.log(chalk.dim(`\n${connected}/${servers.length} server${servers.length !== 1 ? 's' : ''} connected`));
    });

  // profclaw mcp list-tools
  cmd
    .command('list-tools')
    .alias('tools')
    .description('List tools from all connected MCP servers')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const spin = spinner('Fetching MCP tools...').start();
      const result = await api.get<McpToolsResponse>('/api/mcp/tools');
      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to fetch MCP tools');
        process.exit(1);
      }

      const { tools } = result.data!;

      if (options.json) {
        console.log(JSON.stringify(result.data, null, 2));
        return;
      }

      if (tools.length === 0) {
        info('No tools available from connected MCP servers.');
        info('Connect an MCP server first: profclaw mcp connect <name>');
        return;
      }

      const table = createTable(['Tool', 'Server', 'Description']);

      for (const t of tools) {
        table.push([
          chalk.cyan(t.name),
          chalk.bold(t.server),
          chalk.dim(truncate(t.description, 60)),
        ]);
      }

      console.log(table.toString());
      console.log(chalk.dim(`\n${tools.length} tool${tools.length !== 1 ? 's' : ''} available`));
    });

  // profclaw mcp connect <name>
  cmd
    .command('connect <name>')
    .description('Connect to a configured MCP server by name')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: { json?: boolean }) => {
      const spin = spinner(`Connecting to ${chalk.cyan(name)}...`).start();
      const result = await api.post<McpConnectResponse>(`/api/mcp/servers/${encodeURIComponent(name)}/connect`);
      spin.stop();

      if (!result.ok) {
        error(result.error || `Failed to connect to ${name}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(result.data, null, 2));
        return;
      }

      success(`Connected to MCP server ${chalk.cyan(name)}`);
    });

  // profclaw mcp disconnect <name>
  cmd
    .command('disconnect <name>')
    .description('Disconnect from an MCP server')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: { json?: boolean }) => {
      const spin = spinner(`Disconnecting from ${chalk.cyan(name)}...`).start();
      const result = await api.post(`/api/mcp/servers/${encodeURIComponent(name)}/disconnect`);
      spin.stop();

      if (!result.ok) {
        error(result.error || `Failed to disconnect from ${name}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(result.data, null, 2));
        return;
      }

      success(`Disconnected from MCP server ${chalk.cyan(name)}`);
    });

  // profclaw mcp serve
  cmd
    .command('serve')
    .description('Start profClaw as a standalone MCP server (stdio mode)')
    .action(() => {
      info('Starting profClaw MCP server (stdio mode)...');
      info('Connect from Claude Desktop or other MCP clients');

      const child = spawn('node', ['dist/mcp/server.js'], {
        stdio: 'inherit',
        env: process.env,
      });

      child.on('error', (err) => {
        error(`Failed to start MCP server: ${err.message}`);
        error('Make sure to build first: pnpm build');
        process.exit(1);
      });

      child.on('exit', (code) => {
        if (code !== null && code !== 0) {
          process.exit(code);
        }
      });

      process.on('SIGINT', () => child.kill('SIGINT'));
      process.on('SIGTERM', () => child.kill('SIGTERM'));
    });

  return cmd;
}
