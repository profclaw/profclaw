import { useState, useRef, useEffect, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TalkModeConfig {
  enabled: boolean;
  autoSend: boolean;
  autoTts: boolean;
  continuous: boolean;
  speechThreshold: number;
  silenceDuration: number;
}

export type TalkModeState =
  | 'idle'
  | 'listening'
  | 'recording'
  | 'transcribing'
  | 'sending'
  | 'speaking';

export interface TalkModeHandle {
  state: TalkModeState;
  energy: number;
  lastTranscription: string;
  isCalibrating: boolean;
  noiseFloor: number;
  selectedVoice: string;
  config: TalkModeConfig;
  updateConfig: (partial: Partial<TalkModeConfig>) => void;
  setSelectedVoice: (voice: string) => void;
  start: () => Promise<void>;
  stop: () => void;
  toggle: () => void;
  speakResponse: (text: string) => Promise<void>;
}

interface UseTalkModeOptions {
  onTranscription?: (text: string) => void;
  onSend?: (text: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'profclaw-talk-mode-config';
const VOICE_STORAGE_KEY = 'profclaw-talk-mode-voice';
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const VAD_WORKLET_URL = '/audio-worklets/vad-processor.js';

const DEFAULT_CONFIG: TalkModeConfig = {
  enabled: false,
  autoSend: true,
  autoTts: true,
  continuous: true,
  speechThreshold: 0.01,
  silenceDuration: 1500,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadConfig(): TalkModeConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_CONFIG;
    // Merge with defaults so new keys always have a value
    return { ...DEFAULT_CONFIG, ...(parsed as Partial<TalkModeConfig>) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveConfig(config: TalkModeConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Storage quota exceeded or unavailable - continue silently
  }
}

function loadSelectedVoice(): string {
  try {
    return localStorage.getItem(VOICE_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function isMac(): boolean {
  return /mac/i.test(navigator.platform);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTalkMode(options: UseTalkModeOptions = {}): TalkModeHandle {
  const { onTranscription, onSend } = options;

  const [state, setState] = useState<TalkModeState>('idle');
  const [energy, setEnergy] = useState<number>(0);
  const [lastTranscription, setLastTranscription] = useState<string>('');
  const [isCalibrating, setIsCalibrating] = useState<boolean>(false);
  const [noiseFloor, setNoiseFloor] = useState<number>(0);
  const [selectedVoice, setSelectedVoiceState] = useState<string>(loadSelectedVoice);
  const [config, setConfig] = useState<TalkModeConfig>(loadConfig);

  // Refs for imperative resources
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);

  // Keep stable ref to config so callbacks always see current value
  const configRef = useRef<TalkModeConfig>(config);
  configRef.current = config;

  // Keep stable ref to state to avoid stale closures in worklet handlers
  const stateRef = useRef<TalkModeState>(state);
  stateRef.current = state;

  // Keep stable ref to selected voice
  const selectedVoiceRef = useRef<string>(selectedVoice);
  selectedVoiceRef.current = selectedVoice;

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------

  const updateConfig = useCallback((partial: Partial<TalkModeConfig>): void => {
    setConfig((prev) => {
      const next = { ...prev, ...partial };
      saveConfig(next);
      return next;
    });
  }, []);

  const setSelectedVoice = useCallback((voice: string): void => {
    setSelectedVoiceState(voice);
    try {
      localStorage.setItem(VOICE_STORAGE_KEY, voice);
    } catch {
      // ignore
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Inactivity timer
  // ---------------------------------------------------------------------------

  const resetInactivityTimer = useCallback((): void => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    inactivityTimerRef.current = setTimeout(() => {
      // Auto-stop after 5 minutes of no speech while listening
      if (stateRef.current === 'listening') {
        stop(); // eslint-disable-line @typescript-eslint/no-use-before-define
      }
    }, INACTIVITY_TIMEOUT_MS);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const clearInactivityTimer = useCallback((): void => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // TTS / speak response
  // ---------------------------------------------------------------------------

  const speakResponse = useCallback(
    async (text: string): Promise<void> => {
      if (!text.trim()) return;

      // Pause VAD during TTS to prevent echo feedback
      if (workletNodeRef.current) {
        workletNodeRef.current.disconnect();
      }

      setState('speaking');

      try {
        const voice = selectedVoiceRef.current;
        const body: Record<string, string> = { text };
        if (voice && voice !== 'default') {
          body.voice = voice;
        }

        const res = await fetch('/api/voice/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) throw new Error(`Synthesize failed: ${res.status}`);

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        ttsAudioRef.current = audio;

        await new Promise<void>((resolve) => {
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          audio.play().catch(() => resolve());
        });

        URL.revokeObjectURL(url);
        ttsAudioRef.current = null;
      } finally {
        // Reconnect VAD worklet
        if (
          sourceNodeRef.current &&
          workletNodeRef.current &&
          audioContextRef.current
        ) {
          sourceNodeRef.current.connect(workletNodeRef.current);
        }

        if (configRef.current.continuous && stateRef.current === 'speaking') {
          setState('listening');
          resetInactivityTimer();
        } else {
          setState('idle');
        }
      }
    },
    [resetInactivityTimer],
  );

  // ---------------------------------------------------------------------------
  // Transcription
  // ---------------------------------------------------------------------------

  const transcribeAudio = useCallback(
    async (audioBlob: Blob): Promise<void> => {
      setState('transcribing');

      try {
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');

        const res = await fetch('/api/voice/transcribe', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) throw new Error(`Transcribe failed: ${res.status}`);

        const data: unknown = await res.json();
        if (
          typeof data !== 'object' ||
          data === null ||
          !('text' in data) ||
          typeof (data as Record<string, unknown>).text !== 'string'
        ) {
          throw new Error('Invalid transcription response');
        }

        const text = (data as { text: string }).text.trim();
        if (!text) {
          setState('listening');
          resetInactivityTimer();
          return;
        }

        setLastTranscription(text);
        onTranscription?.(text);

        if (configRef.current.autoSend && onSend) {
          setState('sending');
          try {
            await onSend(text);
          } finally {
            setState('listening');
            resetInactivityTimer();
          }
        } else {
          setState('listening');
          resetInactivityTimer();
        }
      } catch {
        setState('listening');
        resetInactivityTimer();
      }
    },
    [onTranscription, onSend, resetInactivityTimer],
  );

  // ---------------------------------------------------------------------------
  // MediaRecorder start/stop
  // ---------------------------------------------------------------------------

  const startRecording = useCallback((): void => {
    if (!streamRef.current) return;

    chunksRef.current = [];
    const recorder = new MediaRecorder(streamRef.current, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm',
    });

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
      chunksRef.current = [];
      void transcribeAudio(blob);
    };

    recorder.start();
    mediaRecorderRef.current = recorder;
    setState('recording');
  }, [transcribeAudio]);

  const stopRecording = useCallback((): void => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    mediaRecorderRef.current = null;
  }, []);

  // ---------------------------------------------------------------------------
  // VAD message handler
  // ---------------------------------------------------------------------------

  const handleVadMessage = useCallback(
    (event: MessageEvent<unknown>): void => {
      const msg = event.data;
      if (typeof msg !== 'object' || msg === null) return;

      const { type } = msg as Record<string, unknown>;

      if (type === 'energy') {
        const value = (msg as Record<string, unknown>).value;
        if (typeof value === 'number') {
          setEnergy(value);
        }
      } else if (type === 'calibrated') {
        const nf = (msg as Record<string, unknown>).noiseFloor;
        if (typeof nf === 'number') {
          setNoiseFloor(nf);
        }
        setIsCalibrating(false);
      } else if (type === 'speech-start') {
        if (stateRef.current === 'listening') {
          clearInactivityTimer();
          startRecording();
        }
      } else if (type === 'speech-end') {
        if (stateRef.current === 'recording') {
          stopRecording();
          resetInactivityTimer();
        }
      }
    },
    [startRecording, stopRecording, clearInactivityTimer, resetInactivityTimer],
  );

  // ---------------------------------------------------------------------------
  // Start / Stop / Toggle
  // ---------------------------------------------------------------------------

  const stop = useCallback((): void => {
    clearInactivityTimer();

    // Stop TTS playback and clean up handlers
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current.onended = null;
      ttsAudioRef.current.onerror = null;
      ttsAudioRef.current = null;
    }

    // Stop MediaRecorder
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];

    // Disconnect and close AudioContext
    if (workletNodeRef.current) {
      workletNodeRef.current.port.onmessage = null;
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Stop all media tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    setEnergy(0);
    setIsCalibrating(false);
    setNoiseFloor(0);
    setState('idle');
  }, [clearInactivityTimer]);

  const start = useCallback(async (): Promise<void> => {
    if (stateRef.current !== 'idle') return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      const ctx = new AudioContext();
      audioContextRef.current = ctx;

      await ctx.audioWorklet.addModule(VAD_WORKLET_URL);

      // Clean up prior worklet handler if start() called rapidly
      if (workletNodeRef.current?.port) {
        workletNodeRef.current.port.onmessage = null;
      }

      setIsCalibrating(true);
      setNoiseFloor(0);

      const workletNode = new AudioWorkletNode(ctx, 'vad-processor', {
        processorOptions: {
          speechThreshold: configRef.current.speechThreshold,
          silenceDuration: configRef.current.silenceDuration,
        },
      });

      workletNode.port.onmessage = handleVadMessage;
      workletNodeRef.current = workletNode;

      const source = ctx.createMediaStreamSource(stream);
      sourceNodeRef.current = source;
      source.connect(workletNode);

      setState('listening');
      resetInactivityTimer();

      // Dispatch global event for CommandPalette integration
      window.dispatchEvent(new CustomEvent('profclaw:talk-mode', { detail: { state: 'listening' } }));
    } catch {
      // Failed to get mic or set up audio pipeline
      stop();
    }
  }, [handleVadMessage, resetInactivityTimer, stop]);

  const toggle = useCallback((): void => {
    if (stateRef.current === 'idle') {
      void start();
    } else {
      stop();
    }
  }, [start, stop]);

  // ---------------------------------------------------------------------------
  // Keyboard shortcut: Cmd+Shift+V (Mac) / Ctrl+Shift+V (other)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const modifier = isMac() ? e.metaKey : e.ctrlKey;
      if (modifier && e.shiftKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        toggle();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [toggle]);

  // ---------------------------------------------------------------------------
  // Listen for toggle events from CommandPalette
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handleToggleEvent = () => toggle();
    const handleStopEvent = () => stop();

    window.addEventListener('profclaw:talk-mode-toggle', handleToggleEvent);
    window.addEventListener('profclaw:talk-mode-stop', handleStopEvent);
    return () => {
      window.removeEventListener('profclaw:talk-mode-toggle', handleToggleEvent);
      window.removeEventListener('profclaw:talk-mode-stop', handleStopEvent);
    };
  }, [toggle, stop]);

  // ---------------------------------------------------------------------------
  // Dispatch state changes for external consumers
  // ---------------------------------------------------------------------------

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('profclaw:talk-mode', { detail: { state } }));
  }, [state]);

  // ---------------------------------------------------------------------------
  // Cleanup on unmount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------

  return {
    state,
    energy,
    lastTranscription,
    isCalibrating,
    noiseFloor,
    selectedVoice,
    config,
    updateConfig,
    setSelectedVoice,
    start,
    stop,
    toggle,
    speakResponse,
  };
}
