/**
 * Canvas Artifact Tool Tests
 *
 * Tests for canvasRenderTool, getArtifact, listArtifacts, and clearArtifacts
 * in src/chat/execution/tools/canvas.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock logger before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  canvasRenderTool,
  getArtifact,
  listArtifacts,
  clearArtifacts,
} from '../tools/canvas.js';
import type { ToolExecutionContext } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(conversationId = 'conv-1'): ToolExecutionContext {
  return {
    conversationId,
    sessionId: 'sess-1',
    userId: 'user-1',
    requestId: 'req-1',
    securityPolicy: { mode: 'full' },
  } as ToolExecutionContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('canvas artifact store', () => {
  beforeEach(() => {
    // Clear all artifacts between tests so state is isolated
    clearArtifacts();
  });

  describe('canvasRenderTool.execute - artifact types', () => {
    const artifactTypes = [
      'code',
      'html',
      'markdown',
      'svg',
      'table',
      'mermaid',
      'chart',
      'diagram',
    ] as const;

    for (const type of artifactTypes) {
      it(`creates a ${type} artifact and stores it`, async () => {
        const ctx = makeContext();
        const result = await canvasRenderTool.execute(ctx, {
          type,
          content: `<${type}>content</${type}>`,
          title: `My ${type}`,
        });

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();

        const { artifactId, type: resultType, title } = result.data!;
        expect(resultType).toBe(type);
        expect(title).toBe(`My ${type}`);
        expect(typeof artifactId).toBe('string');
        expect(artifactId.length).toBeGreaterThan(0);

        // Verify the artifact was persisted
        const stored = getArtifact(artifactId);
        expect(stored).toBeDefined();
        expect(stored!.type).toBe(type);
        expect(stored!.conversationId).toBe('conv-1');
      });
    }
  });

  describe('canvasRenderTool.execute - metadata and language', () => {
    it('stores language for code artifacts', async () => {
      const ctx = makeContext();
      const result = await canvasRenderTool.execute(ctx, {
        type: 'code',
        content: 'const x = 1;',
        language: 'typescript',
      });

      expect(result.success).toBe(true);
      const stored = getArtifact(result.data!.artifactId);
      expect(stored!.language).toBe('typescript');
    });

    it('stores custom metadata', async () => {
      const ctx = makeContext();
      const result = await canvasRenderTool.execute(ctx, {
        type: 'chart',
        content: '{}',
        metadata: { chartType: 'bar', theme: 'dark' },
      });

      expect(result.success).toBe(true);
      const stored = getArtifact(result.data!.artifactId);
      expect(stored!.metadata).toEqual({ chartType: 'bar', theme: 'dark' });
    });

    it('preview is capped at 200 characters', async () => {
      const ctx = makeContext();
      const longContent = 'x'.repeat(500);
      const result = await canvasRenderTool.execute(ctx, {
        type: 'markdown',
        content: longContent,
      });

      expect(result.success).toBe(true);
      expect(result.data!.preview.length).toBe(200);
    });
  });

  describe('canvasRenderTool.execute - missing title graceful handling', () => {
    it('succeeds without a title and title is undefined', async () => {
      const ctx = makeContext();
      const result = await canvasRenderTool.execute(ctx, {
        type: 'markdown',
        content: '# Hello',
      });

      expect(result.success).toBe(true);
      expect(result.data!.title).toBeUndefined();

      const stored = getArtifact(result.data!.artifactId);
      expect(stored!.title).toBeUndefined();
    });

    it('output string falls back to type when no title', async () => {
      const ctx = makeContext();
      const result = await canvasRenderTool.execute(ctx, {
        type: 'svg',
        content: '<svg></svg>',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('svg');
    });
  });

  describe('getArtifact', () => {
    it('returns undefined for unknown id', () => {
      expect(getArtifact('does-not-exist')).toBeUndefined();
    });

    it('returns the artifact by its ID', async () => {
      const ctx = makeContext();
      const result = await canvasRenderTool.execute(ctx, {
        type: 'html',
        content: '<p>hi</p>',
        title: 'Greeting',
      });

      const artifact = getArtifact(result.data!.artifactId);
      expect(artifact).toBeDefined();
      expect(artifact!.content).toBe('<p>hi</p>');
    });
  });

  describe('listArtifacts', () => {
    it('returns all artifacts when no filter given', async () => {
      const ctx1 = makeContext('conv-A');
      const ctx2 = makeContext('conv-B');

      await canvasRenderTool.execute(ctx1, { type: 'markdown', content: 'a' });
      await canvasRenderTool.execute(ctx2, { type: 'markdown', content: 'b' });

      const all = listArtifacts();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it('filters by conversationId', async () => {
      const ctxA = makeContext('conv-A');
      const ctxB = makeContext('conv-B');

      await canvasRenderTool.execute(ctxA, { type: 'code', content: 'a' });
      await canvasRenderTool.execute(ctxA, { type: 'code', content: 'b' });
      await canvasRenderTool.execute(ctxB, { type: 'code', content: 'c' });

      const forA = listArtifacts('conv-A');
      expect(forA).toHaveLength(2);
      expect(forA.every((a) => a.conversationId === 'conv-A')).toBe(true);
    });
  });

  describe('clearArtifacts', () => {
    it('clears all artifacts and returns the count', async () => {
      const ctx = makeContext();
      await canvasRenderTool.execute(ctx, { type: 'markdown', content: '1' });
      await canvasRenderTool.execute(ctx, { type: 'markdown', content: '2' });

      const removed = clearArtifacts();
      expect(removed).toBeGreaterThanOrEqual(2);
      expect(listArtifacts()).toHaveLength(0);
    });

    it('clears only artifacts for a given conversationId', async () => {
      const ctxA = makeContext('conv-clear-A');
      const ctxB = makeContext('conv-clear-B');

      await canvasRenderTool.execute(ctxA, { type: 'markdown', content: '1' });
      await canvasRenderTool.execute(ctxA, { type: 'markdown', content: '2' });
      await canvasRenderTool.execute(ctxB, { type: 'markdown', content: '3' });

      const removed = clearArtifacts('conv-clear-A');
      expect(removed).toBe(2);

      const remaining = listArtifacts();
      expect(remaining.every((a) => a.conversationId !== 'conv-clear-A')).toBe(true);
    });

    it('returns 0 when no artifacts match the conversationId', () => {
      const removed = clearArtifacts('no-such-conversation');
      expect(removed).toBe(0);
    });
  });

  describe('canvasRenderTool metadata', () => {
    it('has name canvas_render', () => {
      expect(canvasRenderTool.name).toBe('canvas_render');
    });

    it('has safe security level', () => {
      expect(canvasRenderTool.securityLevel).toBe('safe');
    });

    it('does not require approval', () => {
      expect(canvasRenderTool.requiresApproval).toBe(false);
    });
  });
});
