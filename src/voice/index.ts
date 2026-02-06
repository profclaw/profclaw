/**
 * Voice I/O Service Coordinator
 *
 * Provides a unified interface for:
 * - STT (speech-to-text) via OpenAI Whisper or Deepgram
 * - TTS (text-to-speech) via OpenAI TTS, ElevenLabs, or system fallback
 *
 * Provider selection is based on available environment variables.
 */

import { logger } from '../utils/logger.js';
import { transcribeWithWhisper } from './stt/whisper.js';
import {
  synthesizeWithOpenAI,
  getOpenAIVoices,
} from './tts/openai-tts.js';
import {
  synthesizeWithElevenLabs,
  getElevenLabsVoices,
} from './tts/elevenlabs.js';
import {
  synthesizeWithSystem,
  isSystemTTSAvailable,
  probeSystemTTSAvailability,
} from './tts/system.js';

// Public types

export interface TranscribeOptions {
  /** ISO 639-1 language code (e.g. 'en', 'fr'). Auto-detected if omitted. */
  language?: string;
  /** Model identifier: 'whisper-1', 'deepgram-nova-2', etc. */
  model?: string;
  /** Explicit provider override. */
  provider?: 'whisper' | 'deepgram';
  /** Audio format hint: 'wav', 'mp3', 'webm', 'ogg', etc. */
  format?: string;
}

export interface TranscribeResult {
  text: string;
  language?: string;
  duration_ms?: number;
  confidence?: number;
  segments?: { start: number; end: number; text: string }[];
}

export interface SynthesizeOptions {
  /** Voice name or ID. */
  voice?: string;
  /** Model identifier: 'tts-1', 'tts-1-hd', 'eleven_multilingual_v2'. */
  model?: string;
  /** Explicit provider override. */
  provider?: 'openai' | 'elevenlabs' | 'system';
  /** Playback speed multiplier (0.25 to 4.0). */
  speed?: number;
  /** Output audio format. */
  format?: 'mp3' | 'opus' | 'aac' | 'wav';
}

export interface SynthesizeResult {
  audio: Buffer;
  format: string;
  duration_ms?: number;
  characters_used?: number;
}

export interface VoiceInfo {
  id: string;
  name: string;
  provider: string;
  language?: string;
  gender?: string;
  preview_url?: string;
}

export interface VoiceService {
  transcribe(audio: Buffer, options?: TranscribeOptions): Promise<TranscribeResult>;
  synthesize(text: string, options?: SynthesizeOptions): Promise<SynthesizeResult>;
  getAvailableVoices(): Promise<VoiceInfo[]>;
  /** Alias for getAvailableVoices - lists all voices across configured providers. */
  listVoices(): Promise<VoiceInfo[]>;
  isSTTAvailable(): boolean;
  isTTSAvailable(): boolean;
  /** Returns the active TTS provider name, or null if none configured. */
  getTTSProvider(): string | null;
  /** Returns the active STT provider name, or null if none configured. */
  getSTTProvider(): string | null;
}

// Provider detection helpers

function detectSTTProvider(): 'whisper' | 'deepgram' | null {
  if (process.env.OPENAI_API_KEY) return 'whisper';
  if (process.env.DEEPGRAM_API_KEY) return 'deepgram';
  return null;
}

function detectTTSProvider(): 'elevenlabs' | 'openai' | 'system' | null {
  if (process.env.ELEVENLABS_API_KEY) return 'elevenlabs';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (isSystemTTSAvailable()) return 'system';
  return null;
}

// VoiceServiceImpl

class VoiceServiceImpl implements VoiceService {
  private readonly sttProvider: 'whisper' | 'deepgram' | null;
  private readonly ttsProvider: 'elevenlabs' | 'openai' | 'system' | null;

  constructor() {
    this.sttProvider = detectSTTProvider();
    this.ttsProvider = detectTTSProvider();

    logger.info('[Voice] Service initialized', {
      stt: this.sttProvider ?? 'unavailable',
      tts: this.ttsProvider ?? 'unavailable',
    });
  }

  isSTTAvailable(): boolean {
    return this.sttProvider !== null;
  }

  isTTSAvailable(): boolean {
    return this.ttsProvider !== null;
  }

  getTTSProvider(): string | null {
    return this.ttsProvider;
  }

  getSTTProvider(): string | null {
    return this.sttProvider;
  }

  async listVoices(): Promise<VoiceInfo[]> {
    return this.getAvailableVoices();
  }

  async transcribe(
    audio: Buffer,
    options?: TranscribeOptions
  ): Promise<TranscribeResult> {
    // Allow explicit override via options.provider
    const provider = options?.provider ?? this.sttProvider;

    if (!provider) {
      throw new Error(
        'No STT provider available. Set OPENAI_API_KEY or DEEPGRAM_API_KEY.'
      );
    }

    logger.info('[Voice] Transcribing', { provider, bufferSize: audio.length });

    switch (provider) {
      case 'whisper':
        return transcribeWithWhisper(audio, options);

      case 'deepgram':
        // Deepgram adapter is not yet implemented - delegate gracefully.
        throw new Error(
          'Deepgram STT provider is not yet implemented. Use provider: "whisper" instead.'
        );

      default: {
        // TypeScript exhaustive check via never
        const unreachable: never = provider;
        throw new Error(`Unknown STT provider: ${String(unreachable)}`);
      }
    }
  }

  async synthesize(
    text: string,
    options?: SynthesizeOptions
  ): Promise<SynthesizeResult> {
    if (!text.trim()) {
      throw new Error('Text must not be empty');
    }

    // Allow explicit override via options.provider
    const provider = options?.provider ?? this.ttsProvider;

    if (!provider) {
      throw new Error(
        'No TTS provider available. Set ELEVENLABS_API_KEY, OPENAI_API_KEY, or ensure say/espeak is installed.'
      );
    }

    logger.info('[Voice] Synthesizing', { provider, chars: text.length });

    switch (provider) {
      case 'elevenlabs':
        return synthesizeWithElevenLabs(text, options);

      case 'openai':
        return synthesizeWithOpenAI(text, options);

      case 'system':
        return synthesizeWithSystem(text, options);

      default: {
        const unreachable: never = provider;
        throw new Error(`Unknown TTS provider: ${String(unreachable)}`);
      }
    }
  }

  async getAvailableVoices(): Promise<VoiceInfo[]> {
    const results: VoiceInfo[] = [];

    // Collect from all configured providers in parallel where possible
    const tasks: Promise<VoiceInfo[]>[] = [];

    if (process.env.OPENAI_API_KEY) {
      tasks.push(Promise.resolve(getOpenAIVoices()));
    }

    if (process.env.ELEVENLABS_API_KEY) {
      tasks.push(
        getElevenLabsVoices().catch((error) => {
          logger.warn('[Voice] Failed to fetch ElevenLabs voices', {
            error: error instanceof Error ? error.message : 'Unknown',
          });
          return [];
        })
      );
    }

    const settled = await Promise.all(tasks);
    for (const list of settled) {
      results.push(...list);
    }

    return results;
  }
}

// Singleton accessor

let instance: VoiceServiceImpl | null = null;

/**
 * Returns the shared VoiceService singleton.
 * Initializes it on first call and probes system TTS availability.
 */
export async function getVoiceService(): Promise<VoiceService> {
  if (instance) return instance;

  // Warm the system TTS availability cache before constructing
  await probeSystemTTSAvailability().catch(() => undefined);

  instance = new VoiceServiceImpl();
  return instance;
}

/**
 * Reset the singleton (useful in tests).
 */
export function resetVoiceService(): void {
  instance = null;
}
