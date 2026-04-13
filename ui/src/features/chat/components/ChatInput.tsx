/**
 * Chat Input Component
 *
 * Text input with image upload, voice recording, and mode toggle.
 */

import { useRef, useEffect } from 'react';
import {
  Send,
  Loader2,
  Mic,
  MicOff,
  ImagePlus,
  X,
  Bot,
  MessageCircle,
  AudioLines,
} from 'lucide-react';
import type { TalkModeState } from '@/core/hooks/useTalkMode';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  isPending: boolean;
  disabled: boolean;
  placeholder?: string;
  // Image handling
  pendingImages: string[];
  onImageSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onImageRemove: (index: number) => void;
  // Voice recording
  isRecording: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  // Mode toggle
  agentMode?: boolean;
  onToggleAgentMode?: () => void;
  // Talk Mode
  talkModeState?: TalkModeState;
  onToggleTalkMode?: () => void;
  // Voice availability
  voiceAvailable?: { stt: boolean; tts: boolean };
}

export function ChatInput({
  value,
  onChange,
  onSend,
  isPending,
  disabled,
  placeholder = 'Type a message...',
  pendingImages,
  onImageSelect,
  onImageRemove,
  isRecording,
  onStartRecording,
  onStopRecording,
  agentMode = false,
  onToggleAgentMode,
  talkModeState = 'idle',
  onToggleTalkMode,
  voiceAvailable,
}: ChatInputProps) {
  const sttReady = voiceAvailable?.stt ?? true;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="mt-2 w-full space-y-2">

      {/* Pending Images Preview */}
      {pendingImages.length > 0 && (
        <div className="flex gap-2 flex-wrap px-1">
          {pendingImages.map((img, i) => (
            <div key={i} className="relative group">
              <img
                src={img}
                alt={`Pending upload ${i + 1}`}
                className="h-16 w-16 object-cover rounded-xl shadow-md transition-all"
              />
              <button
                onClick={() => onImageRemove(i)}
                className="absolute -top-1.5 -right-1.5 h-6 w-6 rounded-full bg-background border border-border flex items-center justify-center text-muted-foreground hover:text-destructive transition-all shadow-md active:scale-90 z-10 opacity-0 group-hover:opacity-100"
                aria-label="Remove image"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input Area */}
      <div
        className={cn(
          'relative rounded-[1.5rem] px-3 py-2 flex items-end gap-3 transition-all duration-300',
          'field-recessed shadow-none',
          agentMode && 'bg-primary/5 border-primary/20'
        )}
      >

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={onImageSelect}
        />

        {/* Left side action buttons */}
        <div className="flex items-center gap-1 relative z-10 pb-0.5 pl-1">
          {/* Agent/Chat mode toggle */}
          {onToggleAgentMode && (
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-9 w-9 shrink-0 rounded-xl transition-all',
                agentMode
                  ? 'bg-primary/20 text-primary'
                  : 'text-muted-foreground hover:bg-muted'
              )}
              onClick={onToggleAgentMode}
              disabled={isPending || disabled}
              aria-label={agentMode ? 'Agent mode (tools enabled)' : 'Chat mode (click for tools)'}
              aria-pressed={agentMode}
            >
              {agentMode ? (
                <Bot className="h-5 w-5" aria-hidden="true" />
              ) : (
                <MessageCircle className="h-5 w-5" aria-hidden="true" />
              )}
            </Button>
          )}

          {/* Image upload button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-xl text-muted-foreground hover:bg-muted transition-all"
            onClick={() => fileInputRef.current?.click()}
            disabled={isPending || disabled}
            aria-label="Add image"
          >
            <ImagePlus className="h-5 w-5" aria-hidden="true" />
          </Button>

          {/* Voice recording button - hidden when Talk Mode is active, hidden on very small screens */}
          {talkModeState === 'idle' && (
            <div className="relative hidden min-[480px]:block">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-9 w-9 shrink-0 rounded-xl transition-all',
                  isRecording
                    ? 'bg-destructive/10 text-destructive animate-pulse'
                    : !sttReady
                      ? 'opacity-40 cursor-not-allowed text-muted-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                )}
                onClick={isRecording ? onStopRecording : onStartRecording}
                disabled={isPending || disabled}
                title={!sttReady ? 'Voice input unavailable - configure STT in Settings > Voice' : undefined}
                aria-label={isRecording ? 'Stop recording' : !sttReady ? 'Voice input unavailable' : 'Start recording'}
                aria-pressed={isRecording}
              >
                {isRecording ? (
                  <MicOff className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <Mic className="h-5 w-5" aria-hidden="true" />
                )}
              </Button>
              {/* Availability indicator dot */}
              <span
                className={cn(
                  'absolute top-0.5 right-0.5 h-2 w-2 rounded-full',
                  sttReady ? 'bg-green-500' : 'bg-red-500'
                )}
                aria-hidden="true"
              />
            </div>
          )}

          {/* Talk Mode toggle button - hidden on very small screens */}
          {onToggleTalkMode && (
            <div className="relative hidden min-[480px]:block">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-9 w-9 shrink-0 rounded-xl transition-all',
                  talkModeState !== 'idle'
                    ? 'bg-green-500/20 text-green-500'
                    : !sttReady
                      ? 'opacity-40 cursor-not-allowed text-muted-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                )}
                onClick={onToggleTalkMode}
                disabled={isPending || disabled}
                title={!sttReady && talkModeState === 'idle' ? 'Talk Mode unavailable - configure STT in Settings > Voice' : undefined}
                aria-label={talkModeState !== 'idle' ? 'Stop Talk Mode' : !sttReady ? 'Talk Mode unavailable' : 'Start Talk Mode'}
                aria-pressed={talkModeState !== 'idle'}
              >
                <AudioLines className="h-5 w-5" aria-hidden="true" />
              </Button>
              {/* Availability indicator dot */}
              <span
                className={cn(
                  'absolute top-0.5 right-0.5 h-2 w-2 rounded-full',
                  sttReady ? 'bg-green-500' : 'bg-red-500'
                )}
                aria-hidden="true"
              />
            </div>
          )}
        </div>

        {/* Text input */}
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={agentMode ? 'Give me a task to work on...' : placeholder}
          aria-label={agentMode ? 'Give me a task to work on' : placeholder}
          className={cn(
            'min-h-[3rem] max-h-48 resize-none border-0 bg-transparent text-[15px]',
            'focus-visible:ring-0 focus-visible:ring-offset-0 py-3 px-2 relative z-10 leading-relaxed font-medium',
            'placeholder:text-[var(--muted-foreground)]/50 transition-colors',
            agentMode && 'placeholder:text-primary/40'
          )}
          disabled={isPending || disabled}
        />

        {/* Send button */}
        <Button
          onClick={onSend}
          disabled={!value.trim() || isPending || disabled}
          size="icon"
          aria-label="Send message"
          variant="black"
          className={cn(
            'h-9 w-9 shrink-0 rounded-xl transition-all mb-0.5 mr-0.5',
            'hover:scale-105 active:scale-95'
          )}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>
    </div>
  );
}
