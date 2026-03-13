/**
 * OpenAI Image Generation Tool
 *
 * Generate images using OpenAI DALL-E models.
 * Supports DALL-E 2 and DALL-E 3 with configurable size, quality, and style.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import { logger } from '../../../utils/logger.js';

// Schema

const ImageGenParamsSchema = z.object({
  prompt: z.string().min(1).max(4000).describe('Text description of the image to generate'),
  size: z.enum(['1024x1024', '1792x1024', '1024x1792'])
    .optional()
    .default('1024x1024')
    .describe('Image dimensions (1792x1024 and 1024x1792 are DALL-E 3 only)'),
  quality: z.enum(['standard', 'hd'])
    .optional()
    .default('standard')
    .describe('Image quality (hd is DALL-E 3 only, costs more)'),
  style: z.enum(['vivid', 'natural'])
    .optional()
    .default('vivid')
    .describe('Image style: vivid for dramatic, natural for realistic (DALL-E 3 only)'),
  model: z.enum(['dall-e-3', 'dall-e-2'])
    .optional()
    .default('dall-e-3')
    .describe('Model to use for generation'),
});

export type ImageGenParams = z.infer<typeof ImageGenParamsSchema>;

// Tool Configuration

interface ImageGenConfig {
  apiKey: string;
  baseUrl?: string;
}

let currentConfig: ImageGenConfig = {
  apiKey: process.env.OPENAI_API_KEY ?? '',
};

/**
 * Update the image generation configuration
 */
export function setImageGenConfig(config: Partial<ImageGenConfig>): void {
  currentConfig = { ...currentConfig, ...config };
  logger.info('[ImageGen] Config updated');
}

/**
 * Get the current image generation configuration
 */
export function getImageGenConfig(): ImageGenConfig {
  return { ...currentConfig };
}

// Types

export interface ImageGenResult {
  url: string;
  revised_prompt?: string;
  model: string;
  size: string;
  quality: string;
  style: string;
}

// OpenAI API types

interface OpenAIImageData {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
}

interface OpenAIImageResponse {
  created: number;
  data: OpenAIImageData[];
}

// Tool Definition

export const openaiImageGenTool: ToolDefinition<ImageGenParams, ImageGenResult> = {
  name: 'openai_image_gen',
  description: `Generate images using OpenAI DALL-E models.

Creates high-quality AI-generated images from text descriptions.
Supports DALL-E 3 (recommended) and DALL-E 2.

DALL-E 3 features:
- High-definition quality mode
- Vivid or natural style
- Wider sizes (landscape/portrait)
- Automatically revised prompts for better results

Returns a URL to the generated image (valid for ~1 hour).`,
  category: 'custom',
  securityLevel: 'moderate',
  requiresApproval: false,
  parameters: ImageGenParamsSchema,

  isAvailable() {
    const key = process.env.OPENAI_API_KEY ?? currentConfig.apiKey;
    if (!key) {
      return {
        available: false,
        reason: 'OPENAI_API_KEY is not set. Configure it in Settings > AI Providers.',
      };
    }
    return { available: true };
  },

  examples: [
    {
      description: 'Generate a simple image',
      params: { prompt: 'A serene mountain lake at sunset with reflections' },
    },
    {
      description: 'High-definition landscape',
      params: {
        prompt: 'A futuristic city skyline with flying vehicles and neon lights',
        size: '1792x1024',
        quality: 'hd',
        style: 'vivid',
        model: 'dall-e-3',
      },
    },
    {
      description: 'Natural-style portrait',
      params: {
        prompt: 'A professional headshot of a friendly software engineer in their home office',
        style: 'natural',
        quality: 'hd',
      },
    },
  ],

  async execute(context: ToolExecutionContext, params: ImageGenParams): Promise<ToolResult<ImageGenResult>> {
    const apiKey = process.env.OPENAI_API_KEY ?? currentConfig.apiKey;

    if (!apiKey) {
      return {
        success: false,
        error: {
          code: 'NOT_CONFIGURED',
          message: 'OPENAI_API_KEY is not set. Configure it in Settings > AI Providers.',
        },
      };
    }

    // DALL-E 2 does not support hd quality, natural/vivid style, or non-square sizes
    const isDalle2 = params.model === 'dall-e-2';
    const size = isDalle2 ? '1024x1024' : (params.size ?? '1024x1024');
    const quality = isDalle2 ? 'standard' : (params.quality ?? 'standard');
    const style = isDalle2 ? undefined : (params.style ?? 'vivid');

    const requestBody: Record<string, unknown> = {
      model: params.model ?? 'dall-e-3',
      prompt: params.prompt,
      n: 1,
      size,
      quality,
      response_format: 'url',
    };

    if (style !== undefined) {
      requestBody.style = style;
    }

    logger.info(`[ImageGen] Generating image with ${params.model ?? 'dall-e-3'}`, {
      component: 'ImageGen',
    });

    try {
      const baseUrl = currentConfig.baseUrl ?? 'https://api.openai.com';
      const response = await fetch(`${baseUrl}/v1/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: context.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        let errMessage = `OpenAI API error ${response.status}`;
        try {
          const errJson = JSON.parse(errText) as { error?: { message?: string } };
          if (errJson.error?.message) {
            errMessage = errJson.error.message;
          }
        } catch {
          // use raw text
          errMessage = `${errMessage}: ${errText.slice(0, 200)}`;
        }

        logger.error(`[ImageGen] API error: ${errMessage}`, { component: 'ImageGen' });

        return {
          success: false,
          error: {
            code: 'API_ERROR',
            message: errMessage,
            retryable: response.status >= 500,
          },
        };
      }

      const data = (await response.json()) as OpenAIImageResponse;
      const imageData = data.data[0];

      if (!imageData?.url) {
        return {
          success: false,
          error: {
            code: 'NO_IMAGE_URL',
            message: 'OpenAI returned no image URL',
          },
        };
      }

      const result: ImageGenResult = {
        url: imageData.url,
        revised_prompt: imageData.revised_prompt,
        model: params.model ?? 'dall-e-3',
        size,
        quality,
        style: style ?? 'vivid',
      };

      const lines = [
        '## Image Generated\n',
        `**URL**: ${imageData.url}`,
        `**Model**: ${result.model}`,
        `**Size**: ${size} | **Quality**: ${quality}${style ? ` | **Style**: ${style}` : ''}`,
      ];

      if (imageData.revised_prompt) {
        lines.push('', `**Revised Prompt**: ${imageData.revised_prompt}`);
      }

      lines.push('', '*Note: The image URL is valid for approximately 1 hour.*');

      logger.info('[ImageGen] Image generated successfully', { component: 'ImageGen' });

      return {
        success: true,
        data: result,
        output: lines.join('\n'),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[ImageGen] Generation failed: ${message}`, { component: 'ImageGen' });

      return {
        success: false,
        error: {
          code: 'GENERATION_FAILED',
          message: `Image generation failed: ${message}`,
          retryable: true,
        },
      };
    }
  },
};
