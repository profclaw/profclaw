/**
 * Text-to-Speech Tool
 *
 * Convert text to speech using OpenAI TTS API or system TTS as fallback.
 * macOS: `say`, Linux: `espeak`. Always available.
 */

import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import { logger } from '../../../utils/logger.js';

const execAsync = promisify(exec);

// Schema

const TtsSpeakParamsSchema = z.object({
  text: z.string().min(1).max(4096).describe('Text to convert to speech'),
  voice: z
    .enum(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'])
    .optional()
    .default('nova')
    .describe('Voice to use (OpenAI TTS only)'),
  speed: z
    .number()
    .min(0.25)
    .max(4.0)
    .optional()
    .default(1.0)
    .describe('Playback speed (0.25 - 4.0, default 1.0)'),
  format: z
    .enum(['mp3', 'wav', 'opus', 'aac', 'flac'])
    .optional()
    .default('mp3')
    .describe('Output audio format'),
  outputPath: z.string().optional().describe('File path to save audio (auto-generated if not set)'),
});

export type TtsSpeakParams = z.infer<typeof TtsSpeakParamsSchema>;

// Types

export interface TtsSpeakResult {
  audioPath: string;
  durationEstimate: number;
  engine: 'openai' | 'macos-say' | 'espeak';
  format: string;
  voice?: string;
  charCount: number;
}

// Helpers

function estimateDurationSec(text: string, speed: number): number {
  // Average speaking rate is about 130 words/min, ~5 chars/word
  const words = text.length / 5;
  const baseDurationSec = (words / 130) * 60;
  return Math.round(baseDurationSec / speed);
}

async function generateOutputPath(format: string): Promise<string> {
  const tmpDir = os.tmpdir();
  const timestamp = Date.now();
  return path.join(tmpDir, `tts-${timestamp}.${format}`);
}

async function speakWithOpenAI(
  text: string,
  params: TtsSpeakParams,
  apiKey: string,
  outputPath: string,
): Promise<void> {
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: text,
      voice: params.voice ?? 'nova',
      speed: params.speed ?? 1.0,
      response_format: params.format ?? 'mp3',
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI TTS API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const buffer = await response.arrayBuffer();
  await fs.writeFile(outputPath, Buffer.from(buffer));
}

async function speakWithSystemTts(text: string, outputPath: string): Promise<'macos-say' | 'espeak'> {
  const platform = os.platform();

  if (platform === 'darwin') {
    // macOS `say` command - output as AIFF then convert path
    const aiffPath = outputPath.replace(/\.[^.]+$/, '.aiff');
    await execAsync(`say -o "${aiffPath}" "${text.replace(/"/g, '\\"')}"`);
    // Rename to requested path (say always writes AIFF)
    await fs.rename(aiffPath, outputPath).catch(async () => {
      // If format differs, just keep as-is and update outputPath
      await fs.copyFile(aiffPath, outputPath).catch(() => {});
    });
    return 'macos-say';
  } else {
    // Linux fallback: espeak
    await execAsync(`espeak "${text.replace(/"/g, '\\"')}" --stdout > "${outputPath}"`);
    return 'espeak';
  }
}

// Tool Definition

export const ttsSpeakTool: ToolDefinition<TtsSpeakParams, TtsSpeakResult> = {
  name: 'tts_speak',
  description: `Convert text to speech audio.

Uses OpenAI TTS API (if configured) for high-quality voice synthesis with multiple
voice options and formats. Falls back to system TTS (macOS \`say\`, Linux \`espeak\`)
if OpenAI is not available - system TTS is always available.

Returns the path to the generated audio file and an estimated duration.

Voices (OpenAI only): alloy, echo, fable, onyx, nova, shimmer`,
  category: 'custom',
  securityLevel: 'safe',
  requiresApproval: false,
  parameters: TtsSpeakParamsSchema,

  isAvailable() {
    return { available: true };
  },

  examples: [
    {
      description: 'Speak a simple message',
      params: { text: 'Hello! Task completed successfully.' },
    },
    {
      description: 'High-quality voice with specific settings',
      params: {
        text: 'The deployment has finished. All services are healthy.',
        voice: 'onyx',
        speed: 1.2,
        format: 'mp3',
      },
    },
    {
      description: 'Save to specific file',
      params: {
        text: 'Weekly report is ready for review.',
        outputPath: '/tmp/weekly-report-notification.mp3',
        voice: 'nova',
      },
    },
  ],

  async execute(context: ToolExecutionContext, params: TtsSpeakParams): Promise<ToolResult<TtsSpeakResult>> {
    const apiKey = process.env.OPENAI_API_KEY ?? '';
    const outputPath = params.outputPath ?? await generateOutputPath(params.format ?? 'mp3');
    const speed = params.speed ?? 1.0;

    let engine: TtsSpeakResult['engine'];

    logger.info(`[TtsSpeak] Converting ${params.text.length} chars to speech`, {
      component: 'TtsSpeak',
    });

    try {
      if (apiKey) {
        try {
          await speakWithOpenAI(params.text, params, apiKey, outputPath);
          engine = 'openai';
          logger.info('[TtsSpeak] Generated with OpenAI TTS', { component: 'TtsSpeak' });
        } catch (openaiError) {
          const errMsg = openaiError instanceof Error ? openaiError.message : 'Unknown';
          logger.warn(`[TtsSpeak] OpenAI TTS failed, falling back to system TTS: ${errMsg}`, {
            component: 'TtsSpeak',
          });
          engine = await speakWithSystemTts(params.text, outputPath);
        }
      } else {
        engine = await speakWithSystemTts(params.text, outputPath);
        logger.info(`[TtsSpeak] Generated with system TTS (${engine})`, { component: 'TtsSpeak' });
      }

      const durationEstimate = estimateDurationSec(params.text, speed);

      const result: TtsSpeakResult = {
        audioPath: outputPath,
        durationEstimate,
        engine,
        format: params.format ?? (engine === 'macos-say' ? 'aiff' : 'mp3'),
        voice: engine === 'openai' ? (params.voice ?? 'nova') : undefined,
        charCount: params.text.length,
      };

      const lines = [
        '## Text-to-Speech Generated\n',
        `**Audio File**: \`${outputPath}\``,
        `**Engine**: ${engine}`,
        `**Estimated Duration**: ~${durationEstimate}s`,
        `**Format**: ${result.format}`,
      ];

      if (result.voice) {
        lines.push(`**Voice**: ${result.voice}`);
      }

      lines.push(`**Characters**: ${params.text.length}`);

      return {
        success: true,
        data: result,
        output: lines.join('\n'),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[TtsSpeak] Failed: ${message}`, { component: 'TtsSpeak' });

      return {
        success: false,
        error: {
          code: 'TTS_FAILED',
          message: `Text-to-speech failed: ${message}`,
          retryable: false,
        },
      };
    }
  },
};
