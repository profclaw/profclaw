/**
 * TalkModeOverlay
 *
 * Floating overlay shown when Talk Mode is active.
 * Displays current state, energy level, last transcription,
 * voice picker, and a stop button.
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Ear, Mic, Loader2, Send, Volume2, X } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { API_BASE } from '@/features/settings/constants';
import type { TalkModeState } from '@/core/hooks/useTalkMode';

// =============================================================================
// TYPES
// =============================================================================

interface VoiceEntry {
  id: string;
  name: string;
  provider: string;
  language?: string;
}

interface TalkModeOverlayProps {
  state: TalkModeState;
  energy: number;
  lastTranscription: string;
  isCalibrating: boolean;
  noiseFloor: number;
  selectedVoice: string;
  onVoiceChange: (voice: string) => void;
  onStop: () => void;
  ttsAvailable?: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const STATE_LABELS: Record<TalkModeState, string> = {
  idle: 'Idle',
  listening: 'Listening...',
  recording: 'Recording...',
  transcribing: 'Transcribing...',
  sending: 'Sending...',
  speaking: 'Speaking...',
};

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function StateIcon({ state, isCalibrating }: { state: TalkModeState; isCalibrating: boolean }) {
  if (isCalibrating) {
    return <Loader2 className="h-5 w-5 animate-spin text-amber-500" />;
  }

  switch (state) {
    case 'listening':
      return <Ear className="h-5 w-5 text-green-500" />;
    case 'recording':
      return <Mic className="h-5 w-5 text-red-500" />;
    case 'transcribing':
      return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
    case 'sending':
      return <Send className="h-5 w-5 text-primary" />;
    case 'speaking':
      return <Volume2 className="h-5 w-5 animate-pulse text-blue-500" />;
    default:
      return <Ear className="h-5 w-5 text-muted-foreground" />;
  }
}

function EnergyEqualizer({ energy, isRecording }: { energy: number; isRecording: boolean }) {
  const clampedEnergy = Math.min(1, Math.max(0, energy));
  const barColor = isRecording ? 'bg-red-500' : 'bg-green-500';
  const isActive = clampedEnergy > 0.005;

  return (
    <div className="flex items-end justify-center gap-1 h-5">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className={cn(
            'w-1 rounded-full transition-all duration-75 origin-bottom',
            barColor,
            isActive ? 'opacity-100' : 'opacity-30'
          )}
          style={{
            height: `${Math.max(4, clampedEnergy * 20)}px`,
            animation: isActive
              ? `eq-bounce-${i} ${0.4 + i * 0.1}s ease-in-out infinite`
              : 'none',
          }}
        />
      ))}
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function TalkModeOverlay({
  state,
  energy,
  lastTranscription,
  isCalibrating,
  noiseFloor,
  selectedVoice,
  onVoiceChange,
  onStop,
  ttsAvailable = true,
}: TalkModeOverlayProps) {
  const isRecording = state === 'recording';
  const [isExiting, setIsExiting] = useState(false);
  const [showTranscription, setShowTranscription] = useState(true);

  // Fetch available voices for the picker
  const { data: voicesData } = useQuery<{ voices: VoiceEntry[] }>({
    queryKey: ['talk-mode-voices'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/voice/voices`);
      if (!res.ok) return { voices: [] };
      return res.json() as Promise<{ voices: VoiceEntry[] }>;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const voices = voicesData?.voices ?? [];

  // Fade out transcription after 5 seconds
  useEffect(() => {
    if (!lastTranscription) return;
    setShowTranscription(true);
    const timer = setTimeout(() => setShowTranscription(false), 5000);
    return () => clearTimeout(timer);
  }, [lastTranscription]);

  // Handle exit animation
  const handleStop = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => onStop(), 200);
  }, [onStop]);

  // Determine shortcut label
  const modKey = /mac/i.test(navigator.platform) ? '\u2318' : 'Ctrl';

  return (
    <div
      className={cn(
        'fixed bottom-24 right-6 z-50',
        'w-72 rounded-2xl border border-border/60 bg-background/80 p-4 shadow-xl',
        'backdrop-blur-md',
        isExiting
          ? 'animate-[talk-mode-out_0.2s_ease-in_forwards]'
          : 'animate-[talk-mode-in_0.3s_ease-out]'
      )}
    >
      {/* Header row: icon + label + stop button */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'relative flex items-center justify-center',
              isRecording && 'animate-[recording-ring_1.5s_ease-in-out_infinite]'
            )}
            style={{ borderRadius: '50%' }}
          >
            <StateIcon state={state} isCalibrating={isCalibrating} />
          </div>
          <span className="text-sm font-medium">
            {isCalibrating ? 'Calibrating...' : STATE_LABELS[state]}
          </span>
        </div>
        <button
          type="button"
          onClick={handleStop}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-full',
            'bg-muted text-muted-foreground transition-colors',
            'hover:bg-destructive/10 hover:text-destructive',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          )}
          aria-label="Stop Talk Mode"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Energy equalizer */}
      <div className="mt-3 flex items-center gap-3">
        <EnergyEqualizer energy={energy} isRecording={isRecording} />
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-75',
              isRecording ? 'bg-red-500' : 'bg-green-500'
            )}
            style={{ width: `${Math.min(1, Math.max(0, energy)) * 100}%` }}
          />
        </div>
      </div>

      {/* TTS unavailable warning */}
      {!ttsAvailable && (
        <p className="mt-2 text-[11px] text-amber-400/80 bg-amber-500/10 rounded-lg px-2 py-1">
          TTS not configured - responses won't be spoken
        </p>
      )}

      {/* Calibration noise floor display */}
      {!isCalibrating && noiseFloor > 0 && (
        <p className="mt-1 text-[10px] text-muted-foreground/60">
          Noise floor: {noiseFloor.toFixed(4)}
        </p>
      )}

      {/* Last transcription with fade */}
      {lastTranscription.length > 0 && (
        <p
          className={cn(
            'mt-3 line-clamp-2 text-xs text-muted-foreground transition-opacity duration-500',
            showTranscription ? 'opacity-100' : 'opacity-0'
          )}
        >
          {lastTranscription}
        </p>
      )}

      {/* Voice picker */}
      {voices.length > 0 && (
        <div className="mt-3 border-t border-border/40 pt-3">
          <Select value={selectedVoice} onValueChange={onVoiceChange}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Default voice" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default voice</SelectItem>
              {voices.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Shortcut hint */}
      <p className="mt-2 text-[10px] text-muted-foreground/40 text-right">
        {modKey}+Shift+V
      </p>
    </div>
  );
}
