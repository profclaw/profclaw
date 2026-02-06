/**
 * Voice Routes
 *
 * API endpoints for speech-to-text and text-to-speech.
 */

import { Hono } from 'hono';
import { getVoiceService } from '../voice/index.js';

export const voiceRoutes = new Hono();

/**
 * GET /api/voice/status - Get voice service status
 */
voiceRoutes.get('/status', async (c) => {
  const voice = await getVoiceService();
  const sttProvider = voice.getSTTProvider();
  const ttsProvider = voice.getTTSProvider();

  return c.json({
    available: voice.isSTTAvailable() || voice.isTTSAvailable(),
    stt: {
      provider: sttProvider,
      model: sttProvider === 'whisper' ? 'whisper-1' : undefined,
      languages: sttProvider ? ['en', 'es', 'fr', 'de', 'ja', 'zh', 'ko', 'pt', 'ru', 'it'] : [],
    },
    tts: {
      provider: ttsProvider,
    },
  });
});

/**
 * POST /api/voice/transcribe - Transcribe audio to text
 * Accepts: multipart/form-data with 'audio' file field
 * or application/json with { audio: base64string, format: 'wav'|'mp3'|'webm' }
 */
voiceRoutes.post('/transcribe', async (c) => {
  const voice = await getVoiceService();

  if (!voice.isSTTAvailable()) {
    return c.json({ error: 'STT not configured. Set OPENAI_API_KEY for Whisper.' }, 503);
  }

  const contentType = c.req.header('content-type') || '';

  let audioBuffer: Buffer;
  let format = 'webm';

  if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.formData();
    const file = formData.get('audio');
    if (!file || !(file instanceof File)) {
      return c.json({ error: 'No audio file provided' }, 400);
    }
    audioBuffer = Buffer.from(await file.arrayBuffer());
    format = file.name?.split('.').pop() || 'webm';
  } else {
    const body = await c.req.json<{ audio: string; format?: string }>();
    if (!body.audio) {
      return c.json({ error: 'No audio data provided' }, 400);
    }
    audioBuffer = Buffer.from(body.audio, 'base64');
    format = body.format || 'webm';
  }

  try {
    const result = await voice.transcribe(audioBuffer, { format });
    return c.json({
      text: result.text,
      language: result.language,
      duration: result.duration_ms,
    });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Transcription failed' },
      500
    );
  }
});

/**
 * POST /api/voice/synthesize - Convert text to speech
 * Returns audio as binary stream or base64
 */
voiceRoutes.post('/synthesize', async (c) => {
  const voice = await getVoiceService();

  if (!voice.isTTSAvailable()) {
    return c.json({ error: 'TTS not configured. Set OPENAI_API_KEY or ELEVENLABS_API_KEY.' }, 503);
  }

  const body = await c.req.json<{
    text: string;
    voice?: string;
    format?: 'mp3' | 'wav' | 'opus';
    returnBase64?: boolean;
  }>();

  if (!body.text) {
    return c.json({ error: 'text is required' }, 400);
  }

  try {
    const result = await voice.synthesize(body.text, {
      voice: body.voice,
      format: body.format || 'mp3',
    });

    const audioBuffer = result.audio;

    if (body.returnBase64) {
      return c.json({
        audio: audioBuffer.toString('base64'),
        format: result.format,
        size: audioBuffer.length,
      });
    }

    // Return as binary audio
    const mimeMap: Record<string, string> = {
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      opus: 'audio/opus',
      aac: 'audio/aac',
    };
    c.header('Content-Type', mimeMap[result.format] || 'audio/mpeg');
    c.header('Content-Length', String(audioBuffer.length));
    return c.body(new Uint8Array(audioBuffer));
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Synthesis failed' },
      500
    );
  }
});

/**
 * GET /api/voice/voices - List available TTS voices
 */
voiceRoutes.get('/voices', async (c) => {
  const voice = await getVoiceService();

  if (!voice.isTTSAvailable()) {
    return c.json({ error: 'TTS not configured' }, 503);
  }

  try {
    const voices = await voice.listVoices();
    return c.json({ voices });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to list voices' },
      500
    );
  }
});
