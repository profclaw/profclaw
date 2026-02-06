/**
 * Subagent Orchestrate Tool Tests
 *
 * Tests for src/chat/execution/tools/subagent-orchestrate.ts
 * All external deps (conversations, AI providers) are mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockConvDeps, mockAiProvider, mockBuildPrompt } = vi.hoisted(() => {
  const mockConvDeps = {
    createConversation: vi.fn(),
    addMessage: vi.fn(),
    getConversation: vi.fn(),
    getConversationMessages: vi.fn(),
  };

  const mockAiProvider = {
    getDefaultProvider: vi.fn(() => 'anthropic/claude-sonnet'),
    resolveModel: vi.fn(() => ({ provider: 'anthropic', model: 'claude-sonnet-4-5' })),
    chat: vi.fn(),
  };

  const mockBuildPrompt = vi.fn();

  return { mockConvDeps, mockAiProvider, mockBuildPrompt };
});

vi.mock('../../conversations.js', () => mockConvDeps);
vi.mock('../../../providers/index.js', () => ({ aiProvider: mockAiProvider }));
vi.mock('../../system-prompts.js', () => ({ buildSystemPrompt: mockBuildPrompt }));

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { subagentOrchestrateTool } from './subagent-orchestrate.js';
import type { ToolExecutionContext } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createContext(): ToolExecutionContext {
  return {
    toolCallId: 'tc-1',
    conversationId: 'conv-root',
    userId: 'user-1',
    workdir: '/tmp',
    env: {},
    securityPolicy: { mode: 'full' },
    sessionManager: {
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      list: vi.fn(() => []),
      kill: vi.fn(),
      cleanup: vi.fn(),
    },
  };
}

let convSeq = 0;

/**
 * Set up mocks so that the NEXT spawn + execute call will succeed.
 * addMessage uses a stable default (always succeeds) set in beforeEach,
 * so we don't queue it here to avoid parallel interleaving issues.
 */
function setupSuccess(output = 'Subtask done') {
  const id = `conv-${++convSeq}`;
  mockConvDeps.createConversation.mockResolvedValueOnce({ id, presetId: 'profclaw-assistant' });
  mockConvDeps.getConversation.mockResolvedValueOnce({ id, presetId: 'profclaw-assistant' });
  mockConvDeps.getConversationMessages.mockResolvedValueOnce([
    { id: 'msg-1', role: 'user', content: 'task', createdAt: new Date().toISOString() },
  ]);
  mockAiProvider.chat.mockResolvedValueOnce({ content: output, model: 'claude', provider: 'anthropic' });
}

/**
 * Set up mocks so that the NEXT spawn + execute call will fail during AI chat.
 */
function setupFailure(msg = 'AI error') {
  const id = `conv-${++convSeq}`;
  mockConvDeps.createConversation.mockResolvedValueOnce({ id, presetId: 'profclaw-assistant' });
  mockConvDeps.getConversation.mockResolvedValueOnce({ id, presetId: 'profclaw-assistant' });
  mockConvDeps.getConversationMessages.mockResolvedValueOnce([]);
  mockAiProvider.chat.mockRejectedValueOnce(new Error(msg));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('subagentOrchestrateTool', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    convSeq = 0;
    // Restore stable default implementations after reset
    mockAiProvider.getDefaultProvider.mockReturnValue('anthropic/claude-sonnet');
    mockAiProvider.resolveModel.mockReturnValue({ provider: 'anthropic', model: 'claude-sonnet-4-5' });
    // addMessage always succeeds (called at spawn + after AI - order doesn't matter)
    mockConvDeps.addMessage.mockResolvedValue(undefined);
    mockBuildPrompt.mockResolvedValue('system prompt');
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  describe('tool metadata', () => {
    it('has correct name', () => {
      expect(subagentOrchestrateTool.name).toBe('subagent_orchestrate');
    });

    it('requires approval', () => {
      expect(subagentOrchestrateTool.requiresApproval).toBe(true);
    });

    it('isAvailable always returns true', () => {
      const result = subagentOrchestrateTool.isAvailable?.();
      expect(result?.available).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // parallel strategy
  // -------------------------------------------------------------------------

  describe('parallel strategy', () => {
    it('runs a single subtask and reports completed', async () => {
      setupSuccess('research done');

      const result = await subagentOrchestrateTool.execute(createContext(), {
        task: 'Research X',
        subtasks: [{ description: 'Subtask A' }],
        strategy: 'parallel',
        max_concurrent: 3,
      });

      expect(result.success).toBe(true);
      expect(result.data?.total).toBe(1);
      expect(result.data?.completed).toBe(1);
      expect(result.data?.failed).toBe(0);
    });

    it('reports partial failures', async () => {
      setupSuccess('done');
      setupFailure('crash');

      const result = await subagentOrchestrateTool.execute(createContext(), {
        task: 'Two tasks one fails',
        subtasks: [
          { description: 'T1' },
          { description: 'T2' },
        ],
        strategy: 'parallel',
        max_concurrent: 3,
      });

      expect(result.data?.completed).toBe(1);
      expect(result.data?.failed).toBe(1);
      // still success because 1 completed
      expect(result.success).toBe(true);
    });

    it('returns success false when all fail', async () => {
      setupFailure('e1');
      setupFailure('e2');

      const result = await subagentOrchestrateTool.execute(createContext(), {
        task: 'All fail',
        subtasks: [
          { description: 'F1' },
          { description: 'F2' },
        ],
        strategy: 'parallel',
        max_concurrent: 3,
      });

      expect(result.data?.completed).toBe(0);
      expect(result.data?.failed).toBe(2);
      // 0 < total -> success: failed < total is false, so success = failed < total
      // Actually the code says: success: failed < params.subtasks.length
      // 2 < 2 = false
      expect(result.success).toBe(false);
    });

    it('chunks into batches - single task per chunk succeeds', async () => {
      setupSuccess('a');

      const result = await subagentOrchestrateTool.execute(createContext(), {
        task: 'Chunked single',
        subtasks: [{ description: 'X1' }],
        strategy: 'parallel',
        max_concurrent: 1,
      });

      expect(result.data?.total).toBe(1);
      expect(result.data?.completed).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // sequential strategy
  // -------------------------------------------------------------------------

  describe('sequential strategy', () => {
    it('runs subtasks in order and all complete', async () => {
      setupSuccess('s1');
      setupSuccess('s2');
      setupSuccess('s3');

      const result = await subagentOrchestrateTool.execute(createContext(), {
        task: 'Sequential task',
        subtasks: [
          { description: 'Step 1' },
          { description: 'Step 2' },
          { description: 'Step 3' },
        ],
        strategy: 'sequential',
        max_concurrent: 3,
      });

      expect(result.success).toBe(true);
      expect(result.data?.completed).toBe(3);
      const statuses = result.data?.results.map((r) => r.status);
      expect(statuses).toEqual(['completed', 'completed', 'completed']);
    });

    it('stops on failure and marks remaining as skipped', async () => {
      setupSuccess('s1');
      setupFailure('step2 fails');
      // Step 3 should never run

      const result = await subagentOrchestrateTool.execute(createContext(), {
        task: 'Sequential with failure',
        subtasks: [
          { description: 'Step 1' },
          { description: 'Step 2 (fails)' },
          { description: 'Step 3 (skipped)' },
        ],
        strategy: 'sequential',
        max_concurrent: 3,
      });

      const statuses = result.data?.results.map((r) => r.status);
      expect(statuses).toEqual(['completed', 'failed', 'skipped']);
    });
  });

  // -------------------------------------------------------------------------
  // pipeline strategy
  // -------------------------------------------------------------------------

  describe('pipeline strategy', () => {
    it('runs all steps and passes output forward', async () => {
      setupSuccess('research output');
      setupSuccess('design output');

      const result = await subagentOrchestrateTool.execute(createContext(), {
        task: 'Pipeline task',
        subtasks: [
          { description: 'Research' },
          { description: 'Design' },
        ],
        strategy: 'pipeline',
        max_concurrent: 3,
      });

      expect(result.success).toBe(true);
      expect(result.data?.completed).toBe(2);
    });

    it('stops pipeline on failure and marks remaining as skipped', async () => {
      setupSuccess('step1 output');
      setupFailure('step2 error');
      // step3 never runs

      const result = await subagentOrchestrateTool.execute(createContext(), {
        task: 'Pipeline with break',
        subtasks: [
          { description: 'Step 1' },
          { description: 'Step 2 (fails)' },
          { description: 'Step 3 (skipped)' },
        ],
        strategy: 'pipeline',
        max_concurrent: 3,
      });

      const skipped = result.data?.results.filter((r) => r.status === 'skipped') ?? [];
      expect(skipped).toHaveLength(1);
      expect(skipped[0]?.error).toContain('Pipeline broken');
    });
  });

  // -------------------------------------------------------------------------
  // Output formatting
  // -------------------------------------------------------------------------

  describe('output format', () => {
    it('includes orchestration header', async () => {
      setupSuccess('done');

      const result = await subagentOrchestrateTool.execute(createContext(), {
        task: 'My special task',
        subtasks: [{ description: 'Do X' }],
        strategy: 'parallel',
        max_concurrent: 3,
      });

      expect(result.output).toContain('Orchestration Complete');
      expect(result.output).toContain('My special task');
    });

    it('includes subtask description in output', async () => {
      setupSuccess('output here');

      const result = await subagentOrchestrateTool.execute(createContext(), {
        task: 'Output test',
        subtasks: [{ description: 'Analyze codebase metrics' }],
        strategy: 'parallel',
        max_concurrent: 3,
      });

      expect(result.output).toContain('Analyze codebase metrics');
    });

    it('truncates output preview to 200 chars', async () => {
      setupSuccess('z'.repeat(300));

      const result = await subagentOrchestrateTool.execute(createContext(), {
        task: 'Truncation test',
        subtasks: [{ description: 'Big output task' }],
        strategy: 'parallel',
        max_concurrent: 3,
      });

      expect(result.output).toContain('...');
    });

    it('includes totalDurationMs in result data', async () => {
      setupSuccess('fast');

      const result = await subagentOrchestrateTool.execute(createContext(), {
        task: 'Duration check',
        subtasks: [{ description: 'Quick' }],
        strategy: 'parallel',
        max_concurrent: 3,
      });

      expect(result.data?.totalDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling - spawn failure', () => {
    it('marks subtask as failed when createConversation rejects', async () => {
      mockConvDeps.createConversation.mockRejectedValueOnce(new Error('DB is down'));

      const result = await subagentOrchestrateTool.execute(createContext(), {
        task: 'Spawn fails',
        subtasks: [{ description: 'Cannot start' }],
        strategy: 'parallel',
        max_concurrent: 3,
      });

      expect(result.data?.results[0]?.status).toBe('failed');
      expect(result.data?.results[0]?.error).toContain('DB is down');
    });
  });

  describe('error handling - session not found', () => {
    it('marks subtask as failed when getConversation returns null', async () => {
      const id = `conv-${++convSeq}`;
      mockConvDeps.createConversation.mockResolvedValueOnce({ id, presetId: 'profclaw-assistant' });
      mockConvDeps.addMessage.mockResolvedValueOnce(undefined);
      mockConvDeps.getConversation.mockResolvedValueOnce(null); // session gone

      const result = await subagentOrchestrateTool.execute(createContext(), {
        task: 'Session missing',
        subtasks: [{ description: 'Missing session subtask' }],
        strategy: 'parallel',
        max_concurrent: 3,
      });

      expect(result.data?.results[0]?.status).toBe('failed');
      expect(result.data?.results[0]?.error).toContain('not found');
    });
  });

  describe('result structure', () => {
    it('each result has index, description, sessionId, durationMs fields', async () => {
      setupSuccess('structured');

      const result = await subagentOrchestrateTool.execute(createContext(), {
        task: 'Structure check',
        subtasks: [{ description: 'Check structure' }],
        strategy: 'parallel',
        max_concurrent: 3,
      });

      const r = result.data?.results[0];
      expect(r).toMatchObject({
        index: 0,
        description: 'Check structure',
        status: 'completed',
      });
      expect(typeof r?.durationMs).toBe('number');
      expect(typeof r?.sessionId).toBe('string');
    });
  });
});
