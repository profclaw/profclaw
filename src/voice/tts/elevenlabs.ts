/**
 * ElevenLabs TTS Provider
 *
 * Synthesizes speech using ElevenLabs' multilingual TTS API.
 * Supports dynamic voice listing, stability/similarity controls.
 */

import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { SynthesizeOptions, SynthesizeResult, VoiceInfo } from '../index.js';

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';
const DEFAULT_MODEL = 'eleven_multilingual_v2';
const DEFAULT_STABILITY = 0.5;
const DEFAULT_SIMILARITY_BOOST = 0.75;
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel

// Zod schemas for ElevenLabs API responses
const ElevenLabsVoiceSchema = z.object({
  voice_id: z.string(),
  name: z.string(),
  preview_url: z.string().nullable().optional(),
  labels: z
    .object({
      language: z.string().optional(),
      gender: z.string().optional(),
    })
    .optional(),
  fine_tuning: z
    .object({
      language: z.string().nullable().optional(),
    })
    .optional(),
});

const ElevenLabsVoicesResponseSchema = z.object({
  voices: z.array(ElevenLabsVoiceSchema),
});

const VoiceSettingsSchema = z.object({
  stability: z.number().min(0).max(1),
  similarity_boost: z.number().min(0).max(1),
});

const TTSBodySchema = z.object({
  text: z.string().min(1),
  model_id: z.string(),
  voice_settings: VoiceSettingsSchema,
});

function resolveVoiceId(voice?: string): string {
  if (!voice) return DEFAULT_VOICE_ID;
  // Accept either a voice ID or a display name - caller responsibility
  return voice;
}

/**
 * Synthesize speech using ElevenLabs TTS.
 * Requires ELEVENLABS_API_KEY environment variable.
 */
export async function synthesizeWithElevenLabs(
  text: string,
  options?: SynthesizeOptions
): Promise<SynthesizeResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY is not set');
  }

  const voiceId = resolveVoiceId(options?.voice);
  const modelId = options?.model ?? DEFAULT_MODEL;

  const body = TTSBodySchema.safeParse({
    text,
    model_id: modelId,
    voice_settings: {
      stability: DEFAULT_STABILITY,
      similarity_boost: DEFAULT_SIMILARITY_BOOST,
    },
  });

  if (!body.success) {
    throw new Error(`Invalid ElevenLabs TTS request: ${body.error.message}`);
  }

  const url = `${ELEVENLABS_BASE_URL}/text-to-speech/${encodeURIComponent(voiceId)}`;

  logger.info('[ElevenLabs] Synthesizing speech', {
    voiceId,
    model: modelId,
    chars: text.length,
  });

  const startMs = Date.now();

  let rawResponse: Response;
  try {
    rawResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify(body.data),
    });
  } catch (error) {
    logger.error('[ElevenLabs] Network error', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
    throw new Error(
      `ElevenLabs network error: ${error instanceof Error ? error.message : 'Unknown'}`
    );
  }

  if (!rawResponse.ok) {
    const errorBody = await rawResponse.text();
    logger.error('[ElevenLabs] API error', {
      status: rawResponse.status,
      body: errorBody,
    });
    throw new Error(
      `ElevenLabs API error ${rawResponse.status}: ${errorBody}`
    );
  }

  let audioBuffer: Buffer;
  try {
    const arrayBuffer = await rawResponse.arrayBuffer();
    audioBuffer = Buffer.from(arrayBuffer);
  } catch (error) {
    throw new Error(
      `ElevenLabs response read error: ${error instanceof Error ? error.message : 'Unknown'}`
    );
  }

  const elapsed = Date.now() - startMs;

  logger.info('[ElevenLabs] Synthesis complete', {
    voiceId,
    bytes: audioBuffer.length,
    elapsed,
  });

  return {
    audio: audioBuffer,
    format: 'mp3',
    characters_used: text.length,
  };
}

/**
 * Fetch available voices from ElevenLabs.
 * Requires ELEVENLABS_API_KEY environment variable.
 */
export async function getElevenLabsVoices(): Promise<VoiceInfo[]> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY is not set');
  }

  logger.info('[ElevenLabs] Fetching available voices');

  let rawResponse: Response;
  try {
    rawResponse = await fetch(`${ELEVENLABS_BASE_URL}/voices`, {
      headers: {
        'xi-api-key': apiKey,
      },
    });
  } catch (error) {
    logger.error('[ElevenLabs] Failed to fetch voices', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
    throw new Error(
      `ElevenLabs voices fetch error: ${error instanceof Error ? error.message : 'Unknown'}`
    );
  }

  if (!rawResponse.ok) {
    const errorBody = await rawResponse.text();
    throw new Error(
      `ElevenLabs voices API error ${rawResponse.status}: ${errorBody}`
    );
  }

  let json: unknown;
  try {
    json = await rawResponse.json();
  } catch (error) {
    throw new Error(
      `ElevenLabs voices response parse error: ${error instanceof Error ? error.message : 'Unknown'}`
    );
  }

  const parsed = ElevenLabsVoicesResponseSchema.safeParse(json);
  if (!parsed.success) {
    logger.error('[ElevenLabs] Unexpected voices response shape', {
      issues: parsed.error.issues,
    });
    throw new Error(`Unexpected ElevenLabs voices response: ${parsed.error.message}`);
  }

  return parsed.data.voices.map((v) => {
    const language =
      v.labels?.language ?? v.fine_tuning?.language ?? undefined;

    return {
      id: v.voice_id,
      name: v.name,
      provider: 'elevenlabs',
      language: language ?? undefined,
      gender: v.labels?.gender ?? undefined,
      preview_url: v.preview_url ?? undefined,
    };
  });
}
