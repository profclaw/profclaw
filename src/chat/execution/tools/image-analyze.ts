/**
 * Image Analyze Tool
 *
 * Analyze images using the current AI provider's vision capabilities.
 */

import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import { logger } from '../../../utils/logger.js';

// Schema

const ImageAnalyzeParamsSchema = z.object({
  path: z.string().min(1).describe('Path to image file (png, jpg, gif, webp)'),
  prompt: z.string().optional().default('Describe this image in detail').describe('Analysis prompt'),
});

export type ImageAnalyzeParams = z.infer<typeof ImageAnalyzeParamsSchema>;

// Constants

const MAX_IMAGE_SIZE = 20_000_000; // 20MB
const SUPPORTED_FORMATS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

// Tool Definition

export const imageAnalyzeTool: ToolDefinition<ImageAnalyzeParams, ImageAnalyzeResult> = {
  name: 'image_analyze',
  description: `Analyze an image file using vision capabilities. Supports PNG, JPG, GIF, WebP.
Reads the image and returns a text description/analysis based on the prompt.
Useful for analyzing screenshots, diagrams, UI mockups, error screenshots, etc.`,
  category: 'filesystem',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: ImageAnalyzeParamsSchema,
  examples: [
    { description: 'Describe a screenshot', params: { path: 'screenshot.png' } },
    {
      description: 'Analyze UI layout',
      params: { path: 'mockup.png', prompt: 'Describe the UI layout and identify any accessibility issues' },
    },
    {
      description: 'Read text from image',
      params: { path: 'error.png', prompt: 'Extract and transcribe all text visible in this image' },
    },
  ],

  async execute(context: ToolExecutionContext, params: ImageAnalyzeParams): Promise<ToolResult<ImageAnalyzeResult>> {
    const filePath = path.isAbsolute(params.path)
      ? params.path
      : path.resolve(context.workdir, params.path);

    try {
      // Validate file exists and check extension
      const ext = path.extname(filePath).toLowerCase();
      if (!SUPPORTED_FORMATS.has(ext)) {
        return {
          success: false,
          error: {
            code: 'UNSUPPORTED_FORMAT',
            message: `Unsupported image format: ${ext}. Supported: ${[...SUPPORTED_FORMATS].join(', ')}`,
          },
        };
      }

      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        return {
          success: false,
          error: { code: 'NOT_A_FILE', message: `${params.path} is not a file` },
        };
      }

      if (stats.size > MAX_IMAGE_SIZE) {
        return {
          success: false,
          error: {
            code: 'FILE_TOO_LARGE',
            message: `Image is too large: ${(stats.size / 1_000_000).toFixed(1)}MB (max: ${MAX_IMAGE_SIZE / 1_000_000}MB)`,
          },
        };
      }

      // Read image as base64
      const buffer = await fs.readFile(filePath);
      const base64 = buffer.toString('base64');
      const mimeType = MIME_TYPES[ext] ?? 'image/png';

      logger.debug(`[ImageAnalyze] Read ${params.path} (${(stats.size / 1024).toFixed(1)}KB, ${mimeType})`, {
        component: 'ImageAnalyze',
      });

      // Return image data for the executor to send to the AI provider
      // The actual vision analysis happens at the conversation level -
      // we prepare the image content for inclusion in the next message
      return {
        success: true,
        data: {
          path: params.path,
          mimeType,
          base64,
          size: stats.size,
          prompt: params.prompt,
          analysis: `[Image loaded: ${params.path} (${(stats.size / 1024).toFixed(1)}KB, ${mimeType})]

To analyze this image, the content has been prepared for vision model processing.

Image: ${params.path}
Size: ${(stats.size / 1024).toFixed(1)}KB
Format: ${mimeType}
Prompt: ${params.prompt}

The image data (base64) is available in the tool result for vision-capable models.`,
        },
        output: `Image loaded: ${params.path} (${(stats.size / 1024).toFixed(1)}KB, ${mimeType})\nReady for analysis with prompt: "${params.prompt}"`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      if (message.includes('ENOENT')) {
        return {
          success: false,
          error: { code: 'FILE_NOT_FOUND', message: `Image not found: ${params.path}` },
        };
      }

      return {
        success: false,
        error: { code: 'IMAGE_ERROR', message: `Failed to read image: ${message}` },
      };
    }
  },
};

// Types

export interface ImageAnalyzeResult {
  path: string;
  mimeType: string;
  base64: string;
  size: number;
  prompt: string;
  analysis: string;
}
