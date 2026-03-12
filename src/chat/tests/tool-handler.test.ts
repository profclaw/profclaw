import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const { mockHandlerDeps } = vi.hoisted(() => ({
  mockHandlerDeps: {
    initializeToolExecution: vi.fn(),
    getToolRegistry: vi.fn(),
    getToolExecutor: vi.fn(),
    safeBrowserToolNames: ['browser_snapshot'],
  },
}));

vi.mock('../execution/index.js', () => ({
  initializeToolExecution: mockHandlerDeps.initializeToolExecution,
  getToolRegistry: mockHandlerDeps.getToolRegistry,
  getToolExecutor: mockHandlerDeps.getToolExecutor,
}));

vi.mock('../../browser/index.js', () => ({
  SAFE_BROWSER_TOOL_NAMES: mockHandlerDeps.safeBrowserToolNames,
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  createChatToolHandler,
  getChatTools,
  getDefaultChatTools,
  getToolCategories,
} from '../tool-handler.js';

describe('chat tool handler', () => {
  const registry = {
    list: vi.fn(),
  };

  const executor = {
    execute: vi.fn(),
    getPendingApprovals: vi.fn(),
    executeAfterApproval: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockHandlerDeps.initializeToolExecution.mockResolvedValue(undefined);
    mockHandlerDeps.getToolRegistry.mockReturnValue(registry);
    mockHandlerDeps.getToolExecutor.mockReturnValue(executor);
    registry.list.mockReturnValue([
      {
        name: 'read_file',
        description: 'Read a file',
        category: 'file',
        parameters: z.object({ path: z.string() }),
      },
      {
        name: 'browser_snapshot',
        description: 'Take a browser snapshot',
        category: 'browser',
        parameters: z.object({}),
      },
      {
        name: 'dangerous_tool',
        description: 'Requires setup',
        category: 'execution',
        parameters: z.object({}),
        isAvailable: () => ({ available: false, reason: 'missing token' }),
      },
    ]);
    executor.execute.mockResolvedValue({
      result: {
        success: true,
        data: { files: ['a.ts'] },
        output: 'found a.ts',
      },
    });
    executor.getPendingApprovals.mockReturnValue([
      {
        id: 'approval-1',
        toolName: 'exec',
        command: 'rm -rf /tmp/x',
        params: { command: 'rm -rf /tmp/x' },
      },
    ]);
    executor.executeAfterApproval.mockResolvedValue({
      result: {
        success: true,
        data: { ok: true },
        output: 'approved output',
      },
    });
  });

  it('initializes tool execution once and exposes registry tools', async () => {
    const handler = await createChatToolHandler({
      conversationId: 'conv-1',
      userId: 'user-1',
    });

    const tools = handler.getTools();
    expect(mockHandlerDeps.initializeToolExecution).toHaveBeenCalledOnce();
    expect(tools.map((tool) => tool.name)).toEqual([
      'read_file',
      'browser_snapshot',
      'dangerous_tool',
    ]);
  });

  it('maps successful executor results to AI-visible result plus sidecar output', async () => {
    const handler = await createChatToolHandler({
      conversationId: 'conv-1',
      userId: 'user-1',
    });

    const result = await handler.executeTool('read_file', { path: 'a.ts' }, 'call-1');

    expect(result).toEqual({
      result: { files: ['a.ts'] },
      output: 'found a.ts',
    });
  });

  it('returns pending approval metadata when executor requires approval', async () => {
    executor.execute.mockResolvedValueOnce({
      result: {
        success: false,
        error: { message: 'approval required' },
      },
      approvalRequired: true,
      approvalId: 'approval-2',
    });

    const handler = await createChatToolHandler({
      conversationId: 'conv-1',
      userId: 'user-1',
    });

    const result = await handler.executeTool('exec', { command: 'rm -rf /tmp/x' }, 'call-2');

    expect(result).toEqual({
      result: {
        pending: true,
        message: 'Tool "exec" requires approval before execution.',
        approvalId: 'approval-2',
      },
      approvalRequired: true,
      approvalId: 'approval-2',
    });
  });

  it('filters unavailable tools from getChatTools()', () => {
    const tools = getChatTools();
    expect(tools.map((tool) => tool.name)).toEqual(['read_file', 'browser_snapshot']);
  });

  it('groups tool names by category', () => {
    expect(getToolCategories()).toEqual({
      file: ['read_file'],
      browser: ['browser_snapshot'],
      execution: ['dangerous_tool'],
    });
  });

  it('includes safe browser tools in getDefaultChatTools()', () => {
    const tools = getDefaultChatTools();
    expect(tools.some((tool) => tool.name === 'browser_snapshot')).toBe(true);
    expect(tools.some((tool) => tool.name === 'dangerous_tool')).toBe(false);
  });

  it('maps pending approvals for the current conversation', async () => {
    const handler = await createChatToolHandler({
      conversationId: 'conv-1',
      userId: 'user-1',
    });

    expect(handler.getPendingApprovals()).toEqual([
      {
        id: 'approval-1',
        toolName: 'exec',
        command: 'rm -rf /tmp/x',
        params: { command: 'rm -rf /tmp/x' },
      },
    ]);
    expect(executor.getPendingApprovals).toHaveBeenCalledWith('conv-1');
  });

  it('maps approved execution results back into AI-visible output', async () => {
    const handler = await createChatToolHandler({
      conversationId: 'conv-1',
      userId: 'user-1',
    });

    const result = await handler.handleApproval('approval-1', 'allow-once');

    expect(result).toEqual({
      result: { ok: true },
      output: 'approved output',
    });
  });
});
