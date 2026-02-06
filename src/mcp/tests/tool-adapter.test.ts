import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockRegistryList = vi.fn();
const mockRegistryGet = vi.fn();

vi.mock('../../chat/execution/registry.js', () => ({
  getToolRegistry: vi.fn(() => ({
    list: mockRegistryList,
    get: mockRegistryGet,
  })),
}));

vi.mock('../../chat/execution/index.js', () => ({
  getSessionManager: vi.fn(() => ({
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    list: vi.fn(() => []),
    kill: vi.fn(),
    cleanup: vi.fn(),
  })),
}));

import { adaptToolsToMCP, handleMCPToolCall } from '../tool-adapter.js';

const makeTool = (overrides: Record<string, unknown> = {}) => ({
  name: 'test_tool',
  description: 'A test tool',
  securityLevel: 'safe',
  parameters: z.object({ input: z.string() }),
  execute: vi.fn(async () => ({
    success: true,
    output: 'Tool output',
    data: { result: 'ok' },
  })),
  ...overrides,
});

describe('MCP Tool Adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // adaptToolsToMCP
  // ===========================================================================

  describe('adaptToolsToMCP', () => {
    it('adapts safe tools to MCP format', () => {
      mockRegistryList.mockReturnValue([makeTool()]);

      const adapted = adaptToolsToMCP();
      expect(adapted).toHaveLength(1);
      expect(adapted[0].schema.name).toBe('profclaw__test_tool');
      expect(adapted[0].internalName).toBe('test_tool');
      expect(adapted[0].schema.inputSchema.type).toBe('object');
    });

    it('adapts moderate tools', () => {
      mockRegistryList.mockReturnValue([makeTool({ securityLevel: 'moderate' })]);

      const adapted = adaptToolsToMCP();
      expect(adapted).toHaveLength(1);
      expect(adapted[0].securityLevel).toBe('moderate');
    });

    it('skips dangerous tools', () => {
      mockRegistryList.mockReturnValue([
        makeTool({ name: 'safe_tool', securityLevel: 'safe' }),
        makeTool({ name: 'danger_tool', securityLevel: 'dangerous' }),
      ]);

      const adapted = adaptToolsToMCP();
      expect(adapted).toHaveLength(1);
      expect(adapted[0].internalName).toBe('safe_tool');
    });

    it('skips unavailable tools', () => {
      mockRegistryList.mockReturnValue([
        makeTool({
          isAvailable: () => ({ available: false, reason: 'not installed' }),
        }),
      ]);

      const adapted = adaptToolsToMCP();
      expect(adapted).toHaveLength(0);
    });

    it('includes available tools', () => {
      mockRegistryList.mockReturnValue([
        makeTool({
          isAvailable: () => ({ available: true }),
        }),
      ]);

      const adapted = adaptToolsToMCP();
      expect(adapted).toHaveLength(1);
    });
  });

  // ===========================================================================
  // handleMCPToolCall
  // ===========================================================================

  describe('handleMCPToolCall', () => {
    it('executes a valid tool call', async () => {
      const tool = makeTool();
      mockRegistryGet.mockReturnValue(tool);

      const result = await handleMCPToolCall('profclaw__test_tool', { input: 'hello' });

      expect(result.content).toBeDefined();
      expect(result.content![0]).toMatchObject({ type: 'text' });
      expect(tool.execute).toHaveBeenCalled();
    });

    it('strips profclaw__ prefix', async () => {
      const tool = makeTool();
      mockRegistryGet.mockReturnValue(tool);

      await handleMCPToolCall('profclaw__test_tool', { input: 'hi' });

      expect(mockRegistryGet).toHaveBeenCalledWith('test_tool');
    });

    it('returns error for unknown tool', async () => {
      mockRegistryGet.mockReturnValue(undefined);

      const result = await handleMCPToolCall('profclaw__unknown', {});

      expect(result.isError).toBe(true);
    });

    it('blocks dangerous tools', async () => {
      mockRegistryGet.mockReturnValue(makeTool({ securityLevel: 'dangerous' }));

      const result = await handleMCPToolCall('profclaw__exec', {});

      expect(result.isError).toBe(true);
    });

    it('returns error for invalid args', async () => {
      mockRegistryGet.mockReturnValue(makeTool());

      const result = await handleMCPToolCall('profclaw__test_tool', { wrong: 123 });

      expect(result.isError).toBe(true);
    });

    it('handles execution errors', async () => {
      mockRegistryGet.mockReturnValue(
        makeTool({
          execute: vi.fn(async () => {
            throw new Error('Execution failed');
          }),
        }),
      );

      const result = await handleMCPToolCall('profclaw__test_tool', { input: 'hi' });

      expect(result.isError).toBe(true);
    });

    it('handles failed tool result', async () => {
      mockRegistryGet.mockReturnValue(
        makeTool({
          execute: vi.fn(async () => ({
            success: false,
            error: { code: 'ERR', message: 'Something went wrong' },
          })),
        }),
      );

      const result = await handleMCPToolCall('profclaw__test_tool', { input: 'hi' });

      expect(result.isError).toBe(true);
    });
  });
});
