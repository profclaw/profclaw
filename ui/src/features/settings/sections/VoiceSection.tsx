/**
 * Voice Section
 *
 * Configure speech-to-text and text-to-speech settings.
 * Shows STT status, TTS provider selection, voice dropdown, and a test button.
 * When STT/TTS is unavailable, shows actionable setup guidance.
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
  AudioLines,
  ExternalLink,
  KeyRound,
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
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { SettingsCard } from '../components';
import { API_BASE } from '../constants';
import type { TalkModeConfig } from '@/core/hooks/useTalkMode';

// =============================================================================
// TYPES
// =============================================================================

interface VoiceStatus {
  available: boolean;
  stt: {
    provider: string | null;
    model?: string;
    languages?: string[];
  };
  tts: {
    provider: string | null;
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
// PROVIDER SETUP DATA
// =============================================================================

interface ProviderOption {
  name: string;
  envVar: string;
  description: string;
  icon: string;
}

const STT_PROVIDERS: ProviderOption[] = [
  {
    name: 'OpenAI Whisper',
    envVar: 'OPENAI_API_KEY',
    description: 'Most popular, supports 99 languages',
    icon: 'W',
  },
  {
    name: 'Deepgram',
    envVar: 'DEEPGRAM_API_KEY',
    description: 'Real-time streaming, lower latency',
    icon: 'D',
  },
];

const TTS_PROVIDERS: ProviderOption[] = [
  {
    name: 'ElevenLabs',
    envVar: 'ELEVENLABS_API_KEY',
    description: 'Natural, expressive voices',
    icon: 'E',
  },
  {
    name: 'OpenAI TTS',
    envVar: 'OPENAI_API_KEY',
    description: '6 voices, uses same key as chat',
    icon: 'O',
  },
  {
    name: 'System TTS',
    envVar: 'none',
    description: 'No key needed (macOS say / Linux espeak)',
    icon: 'S',
  },
];

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

function ProviderSetupCard({ provider }: { provider: ProviderOption }) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border border-border/50 p-3',
        'bg-muted/30 transition-colors hover:bg-muted/50'
      )}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
        {provider.icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{provider.name}</p>
        <p className="text-xs text-muted-foreground">{provider.description}</p>
        {provider.envVar !== 'none' && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <KeyRound className="h-3 w-3 text-muted-foreground" />
            <code className="font-mono text-[11px] text-muted-foreground">
              {provider.envVar}
            </code>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const DEFAULT_TALK_MODE_CONFIG: TalkModeConfig = {
  enabled: true,
  autoSend: true,
  autoTts: true,
  continuous: true,
  speechThreshold: 0.01,
  silenceDuration: 1500,
};

function loadTalkModeConfig(): TalkModeConfig {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('profclaw-talk-mode-config');
    if (saved) {
      try {
        return JSON.parse(saved) as TalkModeConfig;
      } catch {
        /* ignore malformed data */
      }
    }
  }
  return DEFAULT_TALK_MODE_CONFIG;
}

export function VoiceSection() {
  const [selectedVoice, setSelectedVoice] = useState<string>('');
  const [isPlayingTest, setIsPlayingTest] = useState(false);
  const [talkModeConfig, setTalkModeConfig] = useState<TalkModeConfig>(loadTalkModeConfig);

  const updateTalkModeConfig = (updates: Partial<TalkModeConfig>) => {
    setTalkModeConfig((prev) => {
      const next = { ...prev, ...updates };
      localStorage.setItem('profclaw-talk-mode-config', JSON.stringify(next));
      return next;
    });
  };

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
    enabled: status?.tts?.provider != null,
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
  const sttAvailable = status?.stt?.provider != null;
  const ttsAvailable = status?.tts?.provider != null;

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
              {status && <StatusBadge available={sttAvailable} />}
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

          {/* Actionable setup guidance when STT unavailable */}
          {!sttAvailable && !statusLoading && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Set up a transcription provider to enable voice input.
                If you already set <code className="text-xs font-mono">OPENAI_API_KEY</code> for chat, STT is automatically available.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {STT_PROVIDERS.map((provider) => (
                  <ProviderSetupCard key={provider.name} provider={provider} />
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => {
                  const el = document.querySelector('[data-settings-section="ai-providers"]');
                  if (el) el.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Go to AI Providers
              </Button>
            </div>
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

          {/* Actionable setup guidance when TTS unavailable */}
          {!ttsAvailable && !statusLoading && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Set up a TTS provider to enable spoken responses.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {TTS_PROVIDERS.map((provider) => (
                  <ProviderSetupCard key={provider.name} provider={provider} />
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => {
                  const el = document.querySelector('[data-settings-section="ai-providers"]');
                  if (el) el.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Go to AI Providers
              </Button>
            </div>
          )}

          {/* Voice Selection */}
          {ttsAvailable && (
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
          )}

          {/* Test Button */}
          {ttsAvailable && (
            <div className="flex items-center gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestTts}
                disabled={isPlayingTest || testTts.isPending}
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
          )}
        </div>
      </SettingsCard>

      {/* Talk Mode Configuration */}
      <SettingsCard
        title="Talk Mode"
        description="Hands-free continuous conversation with voice activity detection"
        icon={<AudioLines className="h-5 w-5" />}
      >
        <div className="space-y-5">
          {/* Enable Talk Mode */}
          <div className="flex items-center justify-between">
            <div>
              <Label>Enable Talk Mode</Label>
              <p className="text-xs text-muted-foreground">Use Cmd+Shift+V to toggle in chat</p>
            </div>
            <Switch
              checked={talkModeConfig.enabled}
              onCheckedChange={(v) => updateTalkModeConfig({ enabled: v })}
            />
          </div>

          {/* Auto-send transcription */}
          <div className="flex items-center justify-between">
            <div>
              <Label>Auto-send</Label>
              <p className="text-xs text-muted-foreground">Automatically send transcribed speech</p>
            </div>
            <Switch
              checked={talkModeConfig.autoSend}
              onCheckedChange={(v) => updateTalkModeConfig({ autoSend: v })}
            />
          </div>

          {/* Auto-TTS responses */}
          <div className="flex items-center justify-between">
            <div>
              <Label>Auto-speak responses</Label>
              <p className="text-xs text-muted-foreground">Speak AI responses aloud</p>
            </div>
            <Switch
              checked={talkModeConfig.autoTts}
              onCheckedChange={(v) => updateTalkModeConfig({ autoTts: v })}
            />
          </div>

          {/* Continuous mode */}
          <div className="flex items-center justify-between">
            <div>
              <Label>Continuous mode</Label>
              <p className="text-xs text-muted-foreground">Resume listening after AI speaks</p>
            </div>
            <Switch
              checked={talkModeConfig.continuous}
              onCheckedChange={(v) => updateTalkModeConfig({ continuous: v })}
            />
          </div>

          {/* Sensitivity slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Sensitivity</Label>
              <span className="font-mono text-xs text-muted-foreground">
                {talkModeConfig.speechThreshold}
              </span>
            </div>
            <Slider
              value={[talkModeConfig.speechThreshold]}
              onValueChange={([v]) => updateTalkModeConfig({ speechThreshold: v })}
              min={0.005}
              max={0.05}
              step={0.005}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>More sensitive</span>
              <span>Less sensitive</span>
            </div>
          </div>

          {/* Silence duration slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Silence duration</Label>
              <span className="font-mono text-xs text-muted-foreground">
                {talkModeConfig.silenceDuration}ms
              </span>
            </div>
            <Slider
              value={[talkModeConfig.silenceDuration]}
              onValueChange={([v]) => updateTalkModeConfig({ silenceDuration: v })}
              min={500}
              max={3000}
              step={100}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Quick (500ms)</span>
              <span>Patient (3s)</span>
            </div>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}
