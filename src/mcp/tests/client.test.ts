import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockConnect = vi.fn();
const mockClose = vi.fn();
const mockListTools = vi.fn();
const mockCallTool = vi.fn();

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  return {
    Client: class MockClient {
      connect = mockConnect;
      close = mockClose;
      listTools = mockListTools;
      callTool = mockCallTool;
    },
  };
});

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: vi.fn(),
}));

import { MCPClientManager } from '../client.js';

describe('MCPClientManager', () => {
  let manager: MCPClientManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new MCPClientManager();
    mockListTools.mockResolvedValue({
      tools: [
        { name: 'test_tool', description: 'A test tool', inputSchema: { type: 'object' } },
        { name: 'another_tool', description: 'Another', inputSchema: {} },
      ],
    });
  });

  // ===========================================================================
  // connect
  // ===========================================================================

  describe('connect', () => {
    it('connects to a stdio server', async () => {
      await manager.connect({
        name: 'test-server',
        command: 'node',
        args: ['server.js'],
      });

      expect(mockConnect).toHaveBeenCalled();
      expect(mockListTools).toHaveBeenCalled();
    });

    it('connects to an SSE server', async () => {
      await manager.connect({
        name: 'sse-server',
        url: 'http://localhost:3000/sse',
      });

      expect(mockConnect).toHaveBeenCalled();
    });

    it('skips disabled servers', async () => {
      await manager.connect({
        name: 'disabled-server',
        command: 'node',
        enabled: false,
      });

      expect(mockConnect).not.toHaveBeenCalled();
    });

    it('throws for config without command or url', async () => {
      await expect(
        manager.connect({ name: 'bad-config' }),
      ).rejects.toThrow(/must have either/);
    });

    it('discovers tools after connecting', async () => {
      await manager.connect({
        name: 'tool-server',
        command: 'node',
        args: ['tools.js'],
      });

      const tools = manager.listTools();
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('test_tool');
      expect(tools[0].serverName).toBe('tool-server');
    });

    it('disconnects existing server before reconnecting', async () => {
      await manager.connect({ name: 'srv', command: 'node' });
      await manager.connect({ name: 'srv', command: 'node' });

      expect(mockClose).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // disconnect
  // ===========================================================================

  describe('disconnect', () => {
    it('disconnects from a named server', async () => {
      await manager.connect({ name: 'srv', command: 'node' });
      await manager.disconnect('srv');

      expect(mockClose).toHaveBeenCalled();
      expect(manager.listTools().filter(t => t.serverName === 'srv')).toHaveLength(0);
    });

    it('no-ops for unknown server', async () => {
      await manager.disconnect('nonexistent');
      expect(mockClose).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // listTools
  // ===========================================================================

  describe('listTools', () => {
    it('returns all tools from all servers', async () => {
      await manager.connect({ name: 'srv1', command: 'node' });
      await manager.connect({ name: 'srv2', command: 'node' });

      const tools = manager.listTools();
      expect(tools).toHaveLength(4); // 2 tools per server
    });

    it('returns tools with correct serverName', async () => {
      await manager.connect({ name: 'srv1', command: 'node' });
      await manager.connect({ name: 'srv2', command: 'node' });

      const tools = manager.listTools();
      const srv1Tools = tools.filter(t => t.serverName === 'srv1');
      expect(srv1Tools).toHaveLength(2);
    });
  });

  // ===========================================================================
  // getStatus
  // ===========================================================================

  describe('getStatus', () => {
    it('returns status for all servers', async () => {
      await manager.connect({ name: 'srv1', command: 'node' });

      const status = manager.getStatus();
      expect(status).toHaveLength(1);
      expect(status[0].name).toBe('srv1');
      expect(status[0].connected).toBe(true);
      expect(status[0].toolCount).toBe(2);
    });
  });

  // ===========================================================================
  // callTool
  // ===========================================================================

  describe('callTool', () => {
    it('calls a tool on the correct server', async () => {
      await manager.connect({ name: 'srv1', command: 'node' });

      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: 'result' }],
      });

      const result = await manager.callTool('srv1', 'test_tool', { arg: 'value' });

      expect(mockCallTool).toHaveBeenCalledWith({
        name: 'test_tool',
        arguments: { arg: 'value' },
      });
      expect(result).toBeDefined();
    });

    it('throws for unknown server', async () => {
      await expect(
        manager.callTool('nonexistent', 'tool', {}),
      ).rejects.toThrow();
    });
  });

  // ===========================================================================
  // disconnectAll
  // ===========================================================================

  describe('disconnectAll', () => {
    it('disconnects all servers', async () => {
      await manager.connect({ name: 'srv1', command: 'node' });
      await manager.connect({ name: 'srv2', command: 'node' });

      await manager.disconnectAll();

      expect(mockClose).toHaveBeenCalledTimes(2);
      expect(manager.getStatus()).toHaveLength(0);
    });
  });
});
