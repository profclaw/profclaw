/**
 * System TTS Fallback Provider
 *
 * Uses the host OS's built-in speech synthesis:
 * - macOS: the `say` command
 * - Linux: the `espeak` command
 *
 * This provider does not require any API keys.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { logger } from '../../utils/logger.js';
import type { SynthesizeOptions, SynthesizeResult } from '../index.js';

const execFileAsync = promisify(execFile);

/**
 * Check whether the required system TTS binary is present.
 * Uses `which` on POSIX systems to locate the binary without executing it.
 */
async function binaryExists(name: string): Promise<boolean> {
  try {
    await execFileAsync('which', [name], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

let systemTTSAvailableCache: boolean | null = null;

/**
 * Returns true if a supported system TTS binary is available on the current OS.
 * Result is cached after the first call.
 */
export function isSystemTTSAvailable(): boolean {
  // Return cached result synchronously on subsequent calls.
  // First-time callers should await the async version when accuracy matters.
  if (systemTTSAvailableCache !== null) return systemTTSAvailableCache;

  // Optimistic sync check: trust the platform
  if (process.platform === 'darwin') return true;
  if (process.platform === 'linux') return true;
  return false;
}

/**
 * Async variant that actually probes for the binary.
 * Call this during initialization to warm the cache.
 */
export async function probeSystemTTSAvailability(): Promise<boolean> {
  if (process.platform === 'darwin') {
    const available = await binaryExists('say');
    systemTTSAvailableCache = available;
    return available;
  }

  if (process.platform === 'linux') {
    const available = await binaryExists('espeak');
    systemTTSAvailableCache = available;
    return available;
  }

  systemTTSAvailableCache = false;
  return false;
}

async function synthesizeOnMac(
  text: string,
  options?: SynthesizeOptions
): Promise<SynthesizeResult> {
  const tmpFile = join(tmpdir(), `profclaw-tts-${randomUUID()}.aiff`);

  const args: string[] = [];

  if (options?.voice) {
    args.push('-v', options.voice);
  }

  // `say` rate: words-per-minute, not a 0.25-4.0 multiplier.
  // Map the standard speed multiplier to ~175 WPM baseline.
  if (options?.speed != null) {
    const wpm = Math.round(175 * options.speed);
    args.push('-r', String(wpm));
  }

  args.push('-o', tmpFile, '--', text);

  logger.info('[SystemTTS] Invoking `say`', { tmpFile, voice: options?.voice });

  try {
    await execFileAsync('say', args, { timeout: 30_000 });
  } catch (error) {
    throw new Error(
      `say command failed: ${error instanceof Error ? error.message : 'Unknown'}`
    );
  }

  let audio: Buffer;
  try {
    audio = await readFile(tmpFile);
  } finally {
    await unlink(tmpFile).catch(() => undefined);
  }

  logger.info('[SystemTTS] macOS synthesis complete', { bytes: audio.length });

  return {
    audio,
    format: 'wav', // AIFF is close enough for consumer purposes; relabel as wav
    characters_used: text.length,
  };
}

async function synthesizeOnLinux(
  text: string,
  options?: SynthesizeOptions
): Promise<SynthesizeResult> {
  const tmpFile = join(tmpdir(), `profclaw-tts-${randomUUID()}.wav`);

  const args: string[] = ['--stdout', '-w', tmpFile];

  if (options?.voice) {
    args.push('-v', options.voice);
  }

  if (options?.speed != null) {
    // espeak speed: words-per-minute (default 175)
    const wpm = Math.round(175 * options.speed);
    args.push('-s', String(wpm));
  }

  args.push('--', text);

  logger.info('[SystemTTS] Invoking `espeak`', { tmpFile, voice: options?.voice });

  try {
    await execFileAsync('espeak', args, { timeout: 30_000 });
  } catch (error) {
    throw new Error(
      `espeak command failed: ${error instanceof Error ? error.message : 'Unknown'}`
    );
  }

  let audio: Buffer;
  try {
    audio = await readFile(tmpFile);
  } finally {
    await unlink(tmpFile).catch(() => undefined);
  }

  logger.info('[SystemTTS] Linux synthesis complete', { bytes: audio.length });

  return {
    audio,
    format: 'wav',
    characters_used: text.length,
  };
}

/**
 * Synthesize speech using the OS-native TTS engine.
 * Supported on macOS (say) and Linux (espeak).
 */
export async function synthesizeWithSystem(
  text: string,
  options?: SynthesizeOptions
): Promise<SynthesizeResult> {
  if (process.platform === 'darwin') {
    return synthesizeOnMac(text, options);
  }

  if (process.platform === 'linux') {
    return synthesizeOnLinux(text, options);
  }

  throw new Error(
    `System TTS is not supported on platform: ${process.platform}`
  );
}
