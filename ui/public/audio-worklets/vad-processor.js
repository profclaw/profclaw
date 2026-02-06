/**
 * VAD (Voice Activity Detection) AudioWorklet Processor
 *
 * Calculates RMS energy per audio frame to detect speech vs silence.
 * Includes noise floor calibration during the first second after activation.
 * Registered as 'vad-processor' for use with AudioWorkletNode.
 */
class VadProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const opts = options.processorOptions ?? {};
    this._speechThreshold = opts.speechThreshold ?? 0.01;
    this._silenceDuration = opts.silenceDuration ?? 1500;
    this._noiseMultiplier = opts.noiseMultiplier ?? 3;

    this._speaking = false;
    this._silenceStart = null;

    // Noise floor calibration state
    this._calibrating = true;
    this._calibrationSamples = [];
    this._calibrationDurationSec = 1.0;
    this._calibrationFrames = Math.ceil((sampleRate * this._calibrationDurationSec) / 128);
    this._calibrationCount = 0;
    this._noiseFloor = 0;

    // Energy throttle: post at most once per ~100ms
    // sampleRate is available globally in AudioWorkletGlobalScope
    this._framesPerThrottle = Math.ceil((sampleRate * 0.1) / 128);
    this._frameCount = 0;
  }

  /**
   * Calculate RMS energy from a Float32Array channel buffer.
   * @param {Float32Array} buffer
   * @returns {number} RMS value in range [0, 1]
   */
  _rms(buffer) {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i] * buffer[i];
    }
    return Math.sqrt(sum / buffer.length);
  }

  /**
   * @param {Float32Array[][]} inputs
   * @returns {boolean}
   */
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channel = input[0];
    if (!channel || channel.length === 0) return true;

    const energy = this._rms(channel);
    const now = currentTime * 1000; // currentTime is in seconds

    // --- Noise floor calibration phase ---
    if (this._calibrating) {
      this._calibrationSamples.push(energy);
      this._calibrationCount++;

      // Throttled energy updates during calibration
      this._frameCount++;
      if (this._frameCount >= this._framesPerThrottle) {
        this._frameCount = 0;
        this.port.postMessage({ type: 'energy', value: energy });
      }

      if (this._calibrationCount >= this._calibrationFrames) {
        // Compute average noise floor
        const sum = this._calibrationSamples.reduce((a, b) => a + b, 0);
        this._noiseFloor = sum / this._calibrationSamples.length;

        // Dynamic threshold = noiseFloor * multiplier + base speechThreshold
        this._speechThreshold = Math.max(
          this._speechThreshold,
          this._noiseFloor * this._noiseMultiplier + this._speechThreshold
        );

        this._calibrating = false;
        this._calibrationSamples = [];

        this.port.postMessage({
          type: 'calibrated',
          noiseFloor: this._noiseFloor,
          threshold: this._speechThreshold,
        });
      }

      return true;
    }

    // --- Normal VAD processing ---

    // Speech / silence state transitions
    if (energy >= this._speechThreshold) {
      // Active audio detected
      this._silenceStart = null;

      if (!this._speaking) {
        this._speaking = true;
        this.port.postMessage({ type: 'speech-start' });
      }
    } else {
      // Below threshold
      if (this._speaking) {
        if (this._silenceStart === null) {
          this._silenceStart = now;
        } else if (now - this._silenceStart >= this._silenceDuration) {
          this._speaking = false;
          this._silenceStart = null;
          this.port.postMessage({ type: 'speech-end' });
        }
      }
    }

    // Throttled energy updates (~every 100ms)
    this._frameCount++;
    if (this._frameCount >= this._framesPerThrottle) {
      this._frameCount = 0;
      this.port.postMessage({ type: 'energy', value: energy });
    }

    return true;
  }
}

registerProcessor('vad-processor', VadProcessor);
