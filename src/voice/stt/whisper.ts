/**
 * OpenAI Whisper STT Provider
 *
 * Transcribes audio using OpenAI's Whisper API.
 * Supports language detection, segmentation, and confidence scoring.
 */

import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { TranscribeOptions, TranscribeResult } from '../index.js';

const WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions';
const DEFAULT_MODEL = 'whisper-1';

// Zod schema for the verbose_json response from Whisper
const WhisperSegmentSchema = z.object({
  id: z.number(),
  start: z.number(),
  end: z.number(),
  text: z.string(),
  avg_logprob: z.number().optional(),
});

const WhisperResponseSchema = z.object({
  text: z.string(),
  language: z.string().optional(),
  duration: z.number().optional(),
  segments: z.array(WhisperSegmentSchema).optional(),
});

type WhisperResponse = z.infer<typeof WhisperResponseSchema>;

function computeConfidence(segments: WhisperResponse['segments']): number | undefined {
  if (!segments || segments.length === 0) return undefined;

  const validSegments = segments.filter(
    (s) => typeof s.avg_logprob === 'number'
  );
  if (validSegments.length === 0) return undefined;

  const avgLogProb =
    validSegments.reduce((sum, s) => sum + (s.avg_logprob ?? 0), 0) /
    validSegments.length;

  // Convert log probability to a 0-1 confidence score
  return Math.min(1, Math.max(0, Math.exp(avgLogProb)));
}

/**
 * Transcribe audio using OpenAI Whisper.
 * Requires OPENAI_API_KEY environment variable.
 */
export async function transcribeWithWhisper(
  audio: Buffer,
  options?: TranscribeOptions
): Promise<TranscribeResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const model = options?.model ?? DEFAULT_MODEL;
  const startMs = Date.now();

  logger.info('[Whisper] Transcribing audio', {
    model,
    language: options?.language,
    bufferSize: audio.length,
  });

  const form = new FormData();
  form.append('file', new Blob([audio]), 'audio.webm');
  form.append('model', model);
  form.append('response_format', 'verbose_json');

  if (options?.language) {
    form.append('language', options.language);
  }

  let rawResponse: Response;
  try {
    rawResponse = await fetch(WHISPER_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });
  } catch (error) {
    logger.error('[Whisper] Network error during transcription', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
    throw new Error(
      `Whisper network error: ${error instanceof Error ? error.message : 'Unknown'}`
    );
  }

  if (!rawResponse.ok) {
    const errorBody = await rawResponse.text();
    logger.error('[Whisper] API error', {
      status: rawResponse.status,
      body: errorBody,
    });
    throw new Error(
      `Whisper API error ${rawResponse.status}: ${errorBody}`
    );
  }

  let json: unknown;
  try {
    json = await rawResponse.json();
  } catch (error) {
    throw new Error(
      `Whisper response parse error: ${error instanceof Error ? error.message : 'Unknown'}`
    );
  }

  const parsed = WhisperResponseSchema.safeParse(json);
  if (!parsed.success) {
    logger.error('[Whisper] Unexpected response shape', {
      issues: parsed.error.issues,
    });
    throw new Error(`Unexpected Whisper response: ${parsed.error.message}`);
  }

  const data = parsed.data;
  const durationMs = Date.now() - startMs;

  logger.info('[Whisper] Transcription complete', {
    language: data.language,
    audioDuration: data.duration,
    elapsed: durationMs,
  });

  return {
    text: data.text.trim(),
    language: data.language,
    duration_ms: data.duration != null ? Math.round(data.duration * 1000) : undefined,
    confidence: computeConfidence(data.segments),
    segments: data.segments?.map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text,
    })),
  };
}
