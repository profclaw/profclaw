import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock MCP SDK to prevent server startup logic from running fully correctly
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: class {
    setRequestHandler = vi.fn();
    connect = vi.fn().mockResolvedValue(undefined);
  }
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {}
}));

// Mock fetch globally
global.fetch = vi.fn();

import { calculateCost, handleLogTask, handleCompleteTask } from '../server.js';

describe('MCP Server Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateCost', () => {
    it('should calculate cost correctly for sonnet', () => {
      const cost = calculateCost(1000, 1000, 'claude-sonnet-4-5-20250929');
      // (1000 * 3 + 1000 * 15) / 1,000,000 = 18000 / 1,000,000 = 0.018
      expect(cost).toBeCloseTo(0.018);
    });

    it('should use default pricing for unknown model', () => {
      const cost = calculateCost(1000, 1000, 'unknown');
      expect(cost).toBeCloseTo(0.018); 
    });
  });

  describe('handleLogTask', () => {
    it('should log task and report to API', async () => {
      (global.fetch as any).mockResolvedValue({ ok: true });

      const args = {
        title: 'Work on feature',
        summary: 'Started working',
        filesChanged: ['src/index.ts']
      };

      const result = await handleLogTask(args);
      
      expect(result.content[0].text).toContain('Task logged');
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/hook/tool-use'), expect.any(Object));
    });
  });

  describe('handleCompleteTask', () => {
    it('should complete task and report to API', async () => {
      (global.fetch as any).mockResolvedValue({ ok: true });

      const args = {
        summary: 'Done with feature',
        prUrl: 'https://github.com/pull/1'
      };

      const result = await handleCompleteTask(args);
      
      expect(result.content[0].text).toContain('Task completed');
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/hook/session-end'), expect.any(Object));
    });
  });
});
