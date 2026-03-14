/**
 * OpenAI TTS Provider
 *
 * Synthesizes speech using OpenAI's text-to-speech API.
 * Supports multiple voices, models, speeds, and output formats.
 */

import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { SynthesizeOptions, SynthesizeResult, VoiceInfo } from '../index.js';

const OPENAI_TTS_URL = 'https://api.openai.com/v1/audio/speech';
const DEFAULT_MODEL = 'tts-1';
const DEFAULT_VOICE = 'alloy';
const DEFAULT_FORMAT = 'mp3';
const DEFAULT_SPEED = 1.0;

export const OPENAI_VOICES = [
  'alloy',
  'echo',
  'fable',
  'onyx',
  'nova',
  'shimmer',
] as const;

export type OpenAIVoice = (typeof OPENAI_VOICES)[number];

const VALID_FORMATS = ['mp3', 'opus', 'aac', 'wav'] as const;

// Request body schema used for internal validation before sending
const TTSRequestSchema = z.object({
  model: z.string(),
  voice: z.string(),
  input: z.string().min(1).max(4096),
  speed: z.number().min(0.25).max(4.0),
  response_format: z.enum(VALID_FORMATS),
});

/**
 * Synthesize speech using OpenAI TTS.
 * Requires OPENAI_API_KEY environment variable.
 */
export async function synthesizeWithOpenAI(
  text: string,
  options?: SynthesizeOptions
): Promise<SynthesizeResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const model = options?.model ?? DEFAULT_MODEL;
  const voice = options?.voice ?? DEFAULT_VOICE;
  const format = (options?.format ?? DEFAULT_FORMAT) as (typeof VALID_FORMATS)[number];
  const speed = options?.speed ?? DEFAULT_SPEED;

  const requestBody = TTSRequestSchema.safeParse({
    model,
    voice,
    input: text,
    speed,
    response_format: format,
  });

  if (!requestBody.success) {
    throw new Error(`Invalid TTS request: ${requestBody.error.message}`);
  }

  logger.info('[OpenAI TTS] Synthesizing speech', {
    model,
    voice,
    format,
    speed,
    chars: text.length,
  });

  const startMs = Date.now();

  let rawResponse: Response;
  try {
    rawResponse = await fetch(OPENAI_TTS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody.data),
    });
  } catch (error) {
    logger.error('[OpenAI TTS] Network error', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
    throw new Error(
      `OpenAI TTS network error: ${error instanceof Error ? error.message : 'Unknown'}`
    );
  }

  if (!rawResponse.ok) {
    const errorBody = await rawResponse.text();
    logger.error('[OpenAI TTS] API error', {
      status: rawResponse.status,
      body: errorBody,
    });
    throw new Error(
      `OpenAI TTS API error ${rawResponse.status}: ${errorBody}`
    );
  }

  let audioBuffer: Buffer;
  try {
    const arrayBuffer = await rawResponse.arrayBuffer();
    audioBuffer = Buffer.from(arrayBuffer);
  } catch (error) {
    throw new Error(
      `OpenAI TTS response read error: ${error instanceof Error ? error.message : 'Unknown'}`
    );
  }

  const elapsed = Date.now() - startMs;

  logger.info('[OpenAI TTS] Synthesis complete', {
    format,
    bytes: audioBuffer.length,
    elapsed,
  });

  return {
    audio: audioBuffer,
    format,
    characters_used: text.length,
  };
}

/**
 * Return static voice list for OpenAI TTS.
 */
export function getOpenAIVoices(): VoiceInfo[] {
  const voiceDescriptions: Record<OpenAIVoice, { gender: string; language: string }> = {
    alloy: { gender: 'neutral', language: 'en' },
    echo: { gender: 'male', language: 'en' },
    fable: { gender: 'male', language: 'en' },
    onyx: { gender: 'male', language: 'en' },
    nova: { gender: 'female', language: 'en' },
    shimmer: { gender: 'female', language: 'en' },
  };

  return OPENAI_VOICES.map((id) => ({
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    provider: 'openai',
    language: voiceDescriptions[id].language,
    gender: voiceDescriptions[id].gender,
  }));
}
