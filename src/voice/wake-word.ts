/**
 * Wake Word Detection Stub
 *
 * profClaw uses shortcut/button activation instead of always-on wake word
 * detection so it does not burn API credits while idle. This module provides
 * the interface and a simple energy-based detection fallback for callers that
 * want basic "someone started talking" triggering without a real ML engine.
 *
 * Supported engines:
 *   - 'none'      - disabled (no-op)
 *   - 'energy'    - amplitude threshold (not real keyword spotting)
 *   - 'porcupine' - stub, reserved for future add-on
 */

import { logger } from '../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export interface WakeWordConfig {
  /** The wake phrase (informational; only used by ML engines). */
  phrase: string;
  /** Detection engine. 'none' disables detection entirely. */
  engine: 'none' | 'energy' | 'porcupine';
  /** Detection sensitivity in [0, 1]. Higher values mean more triggers. */
  sensitivity: number;
  /** Called when a wake word (or energy spike) is detected. */
  onDetected?: (confidence: number) => void;
}

export interface WakeWordDetector {
  /** Start listening for the wake word. */
  start(): Promise<void>;
  /** Stop listening. */
  stop(): void;
  /** Returns true while the detector is actively listening. */
  isListening(): boolean;
  /** Cumulative detection statistics since start() was last called. */
  getStats(): { detections: number; falsePositives: number; uptime: number };
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a wake word detector for the given configuration.
 * Currently only 'energy' and 'none' are implemented.
 * Requesting 'porcupine' falls back to 'energy' with a warning.
 */
export function createWakeWordDetector(config: WakeWordConfig): WakeWordDetector {
  const resolvedEngine = resolveEngine(config.engine);

  switch (resolvedEngine) {
    case 'energy':
      return new EnergyDetector(config);
    case 'none':
    default:
      return new NoopDetector();
  }
}

function resolveEngine(engine: WakeWordConfig['engine']): 'none' | 'energy' {
  if (engine === 'porcupine') {
    logger.warn(
      '[WakeWord] Porcupine engine is not yet implemented - falling back to energy-based detection',
      { component: 'WakeWord' },
    );
    return 'energy';
  }
  return engine;
}

// =============================================================================
// NoopDetector - engine: 'none'
// =============================================================================

class NoopDetector implements WakeWordDetector {
  private listening = false;
  private startedAt: number | null = null;

  async start(): Promise<void> {
    this.listening = true;
    this.startedAt = Date.now();
    logger.debug('[WakeWord] Noop detector started (detection disabled)', { component: 'WakeWord' });
  }

  stop(): void {
    this.listening = false;
    this.startedAt = null;
    logger.debug('[WakeWord] Noop detector stopped', { component: 'WakeWord' });
  }

  isListening(): boolean {
    return this.listening;
  }

  getStats(): { detections: number; falsePositives: number; uptime: number } {
    return {
      detections: 0,
      falsePositives: 0,
      uptime: this.startedAt != null ? Date.now() - this.startedAt : 0,
    };
  }
}

// =============================================================================
// EnergyDetector - engine: 'energy'
// =============================================================================

/**
 * Simple amplitude-threshold detection.
 *
 * NOT real wake-word spotting - it only detects when audio energy exceeds a
 * threshold, which acts as "someone started talking". Returns a fixed
 * confidence of 0.3 to signal to callers that this is a low-quality signal.
 *
 * Audio samples are fed via `processSample()`. In a real deployment the
 * microphone capture loop would call this with 16-bit PCM values.
 */
class EnergyDetector implements WakeWordDetector {
  private config: WakeWordConfig;
  private listening = false;
  private startedAt: number | null = null;
  private detections = 0;
  private falsePositives = 0;

  // Energy threshold derived from sensitivity: higher sensitivity -> lower threshold
  private get energyThreshold(): number {
    // Map sensitivity [0,1] to threshold [0.8, 0.1] (inverse relationship)
    return Math.max(0.05, 0.9 - this.config.sensitivity * 0.8);
  }

  constructor(config: WakeWordConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    this.listening = true;
    this.startedAt = Date.now();
    this.detections = 0;
    this.falsePositives = 0;
    logger.info('[WakeWord] Energy detector started', {
      component: 'WakeWord',
      phrase: this.config.phrase,
      sensitivity: this.config.sensitivity,
      energyThreshold: this.energyThreshold,
    });
  }

  stop(): void {
    this.listening = false;
    const uptime = this.startedAt != null ? Date.now() - this.startedAt : 0;
    this.startedAt = null;
    logger.info('[WakeWord] Energy detector stopped', {
      component: 'WakeWord',
      detections: this.detections,
      uptime,
    });
  }

  isListening(): boolean {
    return this.listening;
  }

  getStats(): { detections: number; falsePositives: number; uptime: number } {
    return {
      detections: this.detections,
      falsePositives: this.falsePositives,
      uptime: this.startedAt != null ? Date.now() - this.startedAt : 0,
    };
  }

  /**
   * Feed a normalized audio sample (value in [-1.0, 1.0]) to the detector.
   * When the absolute amplitude exceeds the threshold the wake callback fires.
   *
   * Callers in the microphone capture loop should call this for each PCM frame.
   * The confidence returned is always 0.3 (low) because energy detection is not
   * real keyword spotting.
   */
  processSample(sample: number): void {
    if (!this.listening) return;

    const energy = Math.abs(sample);
    if (energy >= this.energyThreshold) {
      this.detections++;
      const confidence = 0.3; // fixed low confidence - not real keyword spotting
      logger.debug('[WakeWord] Energy threshold exceeded', {
        component: 'WakeWord',
        energy,
        threshold: this.energyThreshold,
        confidence,
      });
      this.config.onDetected?.(confidence);
    }
  }
}
