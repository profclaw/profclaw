/**
 * Voice Section
 *
 * Configure speech-to-text and text-to-speech settings.
 * Shows STT status, TTS provider selection, voice dropdown, and a test button.
 */

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Mic,
  Volume2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Play,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { SettingsCard } from '../components';
import { API_BASE } from '../constants';

// =============================================================================
// TYPES
// =============================================================================

interface VoiceStatus {
  available: boolean;
  stt: {
    provider: string;
    model?: string;
    languages?: string[];
  };
  tts: {
    provider: string;
    voices?: string[];
  };
}

interface VoiceEntry {
  id: string;
  name: string;
  provider: string;
  language?: string;
  gender?: string;
}

interface VoicesResponse {
  voices: VoiceEntry[];
  provider: string;
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function StatusBadge({ available }: { available: boolean }) {
  if (available) {
    return (
      <Badge
        className="gap-1 bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20"
      >
        <CheckCircle2 className="h-3 w-3" />
        Available
      </Badge>
    );
  }
  return (
    <Badge
      className="gap-1 bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
    >
      <XCircle className="h-3 w-3" />
      Unavailable
    </Badge>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function VoiceSection() {
  const [selectedVoice, setSelectedVoice] = useState<string>('');
  const [isPlayingTest, setIsPlayingTest] = useState(false);

  // Fetch voice service status
  const {
    data: status,
    isLoading: statusLoading,
    isError: statusError,
    refetch: refetchStatus,
  } = useQuery<VoiceStatus>({
    queryKey: ['voice-status'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/voice/status`);
      if (!res.ok) throw new Error('Failed to fetch voice status');
      return res.json() as Promise<VoiceStatus>;
    },
    retry: 1,
  });

  // Fetch available voices
  const {
    data: voicesData,
    isLoading: voicesLoading,
  } = useQuery<VoicesResponse>({
    queryKey: ['voice-voices'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/voice/voices`);
      if (!res.ok) throw new Error('Failed to fetch voices');
      return res.json() as Promise<VoicesResponse>;
    },
    enabled: status?.available === true,
    retry: 1,
  });

  // TTS test mutation
  const testTts = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/voice/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello! This is a test of the text-to-speech system.',
          voice: selectedVoice || undefined,
        }),
      });
      if (!res.ok) throw new Error('Synthesis request failed');
      return res.arrayBuffer();
    },
    onSuccess: async (buffer) => {
      try {
        const audioCtx = new AudioContext();
        const decoded = await audioCtx.decodeAudioData(buffer);
        const source = audioCtx.createBufferSource();
        source.buffer = decoded;
        source.connect(audioCtx.destination);
        source.onended = () => {
          setIsPlayingTest(false);
          void audioCtx.close();
        };
        source.start();
        setIsPlayingTest(true);
      } catch {
        toast.error('Could not play audio');
        setIsPlayingTest(false);
      }
    },
    onError: () => {
      toast.error('TTS test failed');
      setIsPlayingTest(false);
    },
  });

  const handleTestTts = () => {
    if (isPlayingTest) return;
    testTts.mutate();
  };

  const voices = voicesData?.voices ?? [];

  return (
    <div className="space-y-6">
      {/* STT Status */}
      <SettingsCard
        title="Speech Recognition"
        description="Status of the speech-to-text transcription service"
        icon={<Mic className="h-5 w-5" />}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {statusLoading && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
              {statusError && (
                <AlertCircle className="h-4 w-4 text-destructive" />
              )}
              {status && <StatusBadge available={status.available} />}
              {status?.stt?.provider && (
                <span className="text-sm text-muted-foreground">
                  Provider: <span className="font-medium text-foreground">{status.stt.provider}</span>
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void refetchStatus()}
              className="h-8 w-8"
              title="Refresh status"
            >
              <RefreshCw className={cn('h-4 w-4', statusLoading && 'animate-spin')} />
            </Button>
          </div>

          {status?.stt?.model && (
            <div className="text-sm text-muted-foreground">
              Model: <span className="font-medium text-foreground">{status.stt.model}</span>
            </div>
          )}

          {status?.stt?.languages && status.stt.languages.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {status.stt.languages.map((lang) => (
                <Badge key={lang} variant="secondary" className="text-xs">
                  {lang}
                </Badge>
              ))}
            </div>
          )}

          {!status?.available && !statusLoading && (
            <p className="text-sm text-muted-foreground">
              Speech-to-text is not configured. Set a transcription provider in your server
              environment to enable voice input.
            </p>
          )}
        </div>
      </SettingsCard>

      {/* TTS Configuration */}
      <SettingsCard
        title="Text-to-Speech"
        description="Configure voice synthesis for audio responses"
        icon={<Volume2 className="h-5 w-5" />}
      >
        <div className="space-y-4">
          {status?.tts?.provider && (
            <div className="text-sm text-muted-foreground">
              Provider: <span className="font-medium text-foreground">{status.tts.provider}</span>
            </div>
          )}

          {/* Voice Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Voice</label>
            {voicesLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading voices...
              </div>
            ) : voices.length > 0 ? (
              <Select
                value={selectedVoice}
                onValueChange={setSelectedVoice}
              >
                <SelectTrigger className="w-full max-w-xs">
                  <SelectValue placeholder="Default voice" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Default voice</SelectItem>
                  {voices.map((voice) => (
                    <SelectItem key={voice.id} value={voice.id}>
                      <span>{voice.name}</span>
                      {voice.language && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {voice.language}
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">
                No voices available. Ensure a TTS provider is configured.
              </p>
            )}
          </div>

          {/* Test Button */}
          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestTts}
              disabled={isPlayingTest || testTts.isPending || !status?.available}
              className="gap-2"
            >
              {isPlayingTest || testTts.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {isPlayingTest ? 'Playing...' : 'Test TTS'}
            </Button>
            <span className="text-xs text-muted-foreground">
              Plays a sample phrase using the selected voice
            </span>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}
