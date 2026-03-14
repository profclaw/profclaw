/**
 * Canvas Render Tool
 *
 * Lets the AI agent render visual artifacts (code blocks, charts, diagrams,
 * tables, HTML, markdown, mermaid diagrams, SVG) that appear in the dashboard
 * Live Canvas panel.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import { logger } from '../../../utils/logger.js';

// Artifact Types

export interface CanvasArtifact {
  id: string;
  type: 'code' | 'chart' | 'diagram' | 'table' | 'html' | 'markdown' | 'mermaid' | 'svg';
  content: string;
  title?: string;
  language?: string;
  metadata?: Record<string, unknown>;
  conversationId: string;
  createdAt: number;
}

export interface CanvasRenderResult {
  artifactId: string;
  type: string;
  title?: string;
  /** First 200 chars of content for confirmation */
  preview: string;
}

// In-memory artifact store

const artifactStore = new Map<string, CanvasArtifact>();

/**
 * Retrieve a stored artifact by ID.
 */
export function getArtifact(id: string): CanvasArtifact | undefined {
  return artifactStore.get(id);
}

/**
 * List stored artifacts, optionally filtered by conversation.
 */
export function listArtifacts(conversationId?: string): CanvasArtifact[] {
  const all = Array.from(artifactStore.values());
  if (conversationId === undefined) return all;
  return all.filter((a) => a.conversationId === conversationId);
}

/**
 * Clear stored artifacts. Returns the count of removed entries.
 */
export function clearArtifacts(conversationId?: string): number {
  if (conversationId === undefined) {
    const count = artifactStore.size;
    artifactStore.clear();
    return count;
  }

  let removed = 0;
  for (const [id, artifact] of artifactStore) {
    if (artifact.conversationId === conversationId) {
      artifactStore.delete(id);
      removed++;
    }
  }
  return removed;
}

// Schema

const CanvasRenderParamsSchema = z.object({
  type: z
    .enum(['code', 'chart', 'diagram', 'table', 'html', 'markdown', 'mermaid', 'svg'])
    .describe('Artifact type to render'),
  content: z.string().min(1).describe('Content to render'),
  title: z.string().optional().describe('Title for the artifact'),
  language: z
    .string()
    .optional()
    .describe('Language for code blocks (e.g., typescript, python)'),
  metadata: z
    .record(z.unknown())
    .optional()
    .describe('Additional metadata for rendering'),
});

export type CanvasRenderParams = z.infer<typeof CanvasRenderParamsSchema>;

// Tool Definition

export const canvasRenderTool: ToolDefinition<CanvasRenderParams, CanvasRenderResult> = {
  name: 'canvas_render',
  description: `Render a visual artifact to the Live Canvas panel in the dashboard.
Supports code blocks (with syntax highlighting), charts, diagrams, tables,
HTML snippets, markdown documents, Mermaid diagrams, and raw SVG.

The artifact is stored and a reference ID is returned so the UI can display it.
Use this whenever a visual representation would communicate results more clearly
than plain text.`,
  category: 'system',
  securityLevel: 'safe',
  requiresApproval: false,
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: CanvasRenderParamsSchema,
  examples: [
    {
      description: 'Render a TypeScript code block',
      params: {
        type: 'code',
        title: 'hello.ts',
        language: 'typescript',
        content: 'const greet = (name: string) => `Hello, ${name}!`;',
      },
    },
    {
      description: 'Render a Mermaid flowchart',
      params: {
        type: 'mermaid',
        title: 'Request flow',
        content: 'flowchart LR\n  A[Client] --> B[API] --> C[DB]',
      },
    },
    {
      description: 'Render an HTML snippet',
      params: {
        type: 'html',
        title: 'Status badge',
        content: '<span style="color:green">Online</span>',
      },
    },
  ],

  async execute(
    context: ToolExecutionContext,
    params: CanvasRenderParams,
  ): Promise<ToolResult<CanvasRenderResult>> {
    const start = Date.now();

    try {
      const id = crypto.randomUUID();

      const artifact: CanvasArtifact = {
        id,
        type: params.type,
        content: params.content,
        title: params.title,
        language: params.language,
        metadata: params.metadata,
        conversationId: context.conversationId,
        createdAt: Date.now(),
      };

      artifactStore.set(id, artifact);

      const preview = params.content.slice(0, 200);

      logger.debug(`[canvas] stored artifact id=${id} type=${params.type} conversation=${context.conversationId}`);

      const result: CanvasRenderResult = {
        artifactId: id,
        type: params.type,
        title: params.title,
        preview,
      };

      const label = params.title ? `"${params.title}"` : params.type;
      const output = `Canvas artifact rendered: ${label} (id: ${id})`;

      return {
        success: true,
        data: result,
        output,
        durationMs: Date.now() - start,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[canvas] failed to store artifact:`, error instanceof Error ? error : undefined);
      return {
        success: false,
        error: {
          code: 'CANVAS_RENDER_ERROR',
          message: `Failed to render canvas artifact: ${message}`,
          retryable: false,
        },
        durationMs: Date.now() - start,
      };
    }
  },
};
