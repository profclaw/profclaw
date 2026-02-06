import { describe, expect, it } from 'vitest';
import {
  AgentCompletionSchema,
  OpenClawCompletionSchema,
  getAgentReport,
  getTaskReports,
  getRecentReports,
  getReportsByAgent,
} from '../agent-webhook.js';

describe('Agent Webhook', () => {
  // ===========================================================================
  // AgentCompletionSchema
  // ===========================================================================

  describe('AgentCompletionSchema', () => {
    it('validates a minimal payload', () => {
      const payload = {
        agent: 'custom-agent',
        status: 'completed',
        summary: 'Task done',
      };

      const result = AgentCompletionSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('validates a full payload', () => {
      const payload = {
        taskId: 'task-1',
        sessionId: 'sess-1',
        agent: 'openclaw',
        status: 'completed',
        summary: 'Implemented feature X',
        output: 'Some output text',
        artifacts: [
          { type: 'commit', sha: 'abc123' },
          { type: 'pull_request', url: 'https://github.com/repo/pull/1' },
        ],
        tokensUsed: { input: 1000, output: 500, model: 'claude-sonnet-4-6' },
        duration: 120000,
        metadata: { custom: 'data' },
      };

      const result = AgentCompletionSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('rejects missing required fields', () => {
      const payload = {
        agent: 'test',
        // missing status and summary
      };

      const result = AgentCompletionSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('rejects invalid status', () => {
      const payload = {
        agent: 'test',
        status: 'unknown-status',
        summary: 'test',
      };

      const result = AgentCompletionSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('validates all status values', () => {
      for (const status of ['completed', 'failed', 'partial', 'cancelled']) {
        const result = AgentCompletionSchema.safeParse({
          agent: 'test',
          status,
          summary: 'test',
        });
        expect(result.success, `Status "${status}" should be valid`).toBe(true);
      }
    });

    it('validates artifact types', () => {
      const validTypes = ['commit', 'pull_request', 'file', 'comment', 'branch', 'other'];
      for (const type of validTypes) {
        const result = AgentCompletionSchema.safeParse({
          agent: 'test',
          status: 'completed',
          summary: 'test',
          artifacts: [{ type }],
        });
        expect(result.success, `Artifact type "${type}" should be valid`).toBe(true);
      }
    });
  });

  // ===========================================================================
  // OpenClawCompletionSchema
  // ===========================================================================

  describe('OpenClawCompletionSchema', () => {
    it('validates openclaw payload', () => {
      const payload = {
        agent: 'openclaw',
        status: 'completed',
        summary: 'Done',
        workingDir: '/tmp/repo',
        repository: 'user/repo',
        branch: 'feature/x',
      };

      const result = OpenClawCompletionSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('rejects non-openclaw agent', () => {
      const payload = {
        agent: 'devin',
        status: 'completed',
        summary: 'Done',
      };

      const result = OpenClawCompletionSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  // ===========================================================================
  // Report queries
  // ===========================================================================

  describe('report queries', () => {
    it('getAgentReport returns undefined for unknown id', () => {
      expect(getAgentReport('nonexistent')).toBeUndefined();
    });

    it('getTaskReports returns empty array for unknown task', () => {
      expect(getTaskReports('nonexistent')).toEqual([]);
    });

    it('getRecentReports returns an array', () => {
      const reports = getRecentReports(10);
      expect(Array.isArray(reports)).toBe(true);
    });

    it('getReportsByAgent returns an array', () => {
      const reports = getReportsByAgent('openclaw', 10);
      expect(Array.isArray(reports)).toBe(true);
    });
  });
});
