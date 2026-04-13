/**
 * Chat Messages Component
 *
 * Displays the message list with markdown rendering, tool call cards,
 * and collapsible thinking blocks (like Claude's reasoning disclosure).
 */

import { useRef, useEffect, useMemo } from 'react';
import {
  Bot,
  User,
  Copy,
  Check,
  RefreshCw,
  Terminal,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { ToolCallGroup } from '@/components/ui/tool-call-card';
import { Logo } from '@/components/shared/Logo';
import { cn } from '@/lib/utils';
import type { Message, ChatPreset, QuickAction } from '../types';
import { ThinkingBlock, FilteredJsonBlock } from './ThinkingBlock';
import { parseThinking } from '../utils/parse-thinking';
import { CanvasArtifact } from './CanvasArtifact';
import type { CanvasArtifactData } from './CanvasArtifact';

// Preset icon helper (simplified version)
function PresetIcon({ className }: { icon?: string; className?: string }) {
  return <Bot className={className} />;
}

interface ChatMessagesProps {
  messages: Message[];
  currentPreset?: ChatPreset;
  quickActions: QuickAction[];
  healthyProviders: number;
  copiedId: string | null;
  onCopy: (content: string, id: string) => void;
  onRetry: (messageId: string) => void;
  onDelete: (messageId: string) => void;
  onQuickAction: (prompt: string) => void;
  onOpenProviderSetup: () => void;
}

/**
 * Parse message content to extract thinking and clean response
 */
function useProcessedMessage(content: string, isLoading: boolean) {
  return useMemo(() => {
    if (isLoading || !content) {
      return { content, thinking: null, filteredJson: [], wasProcessed: false };
    }
    return parseThinking(content);
  }, [content, isLoading]);
}

export function ChatMessages({
  messages,
  currentPreset,
  quickActions,
  healthyProviders,
  copiedId,
  onCopy,
  onRetry,
  onDelete,
  onQuickAction,
  onOpenProviderSetup,
}: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 premium-card rounded-[2rem] p-8 overflow-y-auto">
        <div className="flex flex-col items-center justify-center h-full text-center max-w-lg mx-auto">
          <div className="h-24 w-24 rounded-3xl glass-heavy flex items-center justify-center mb-8 shadow-xl shadow-primary/10 border-primary/5">
            {(!currentPreset?.icon || currentPreset.icon === 'bot') ? (
              <Logo className="h-14 w-14" />
            ) : (
              <PresetIcon icon={currentPreset.icon} className="h-12 w-12 text-primary/60" />
            )}
          </div>
          <h2 className="text-3xl font-bold mb-4 tracking-tighter text-foreground font-heading graduate-text-gradient">
            {currentPreset?.name || 'Start a conversation'}
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground mb-10 opacity-80">
            {currentPreset?.description || 'Ask me anything about profClaw, your tasks, or get help with coding.'}
          </p>

          {healthyProviders > 0 && quickActions.length > 0 && (
            <div className="grid grid-cols-2 gap-4 w-full">
              {quickActions.slice(0, 4).map((action) => (
                <button
                  key={action.id}
                  onClick={() => onQuickAction(action.prompt)}
                  className="px-5 py-4 rounded-xl glass hover:bg-primary/5 border-primary/5 hover:border-primary/20 text-sm font-semibold transition-all duration-300 hover:-translate-y-1 active:scale-[0.98] text-left group shadow-lg"
                  aria-label={`Quick action: ${action.label}`}
                >
                  <p className="truncate group-hover:text-primary transition-colors">{action.label}</p>
                  <div className="h-0.5 w-6 bg-primary/20 mt-2 rounded-full group-hover:bg-primary group-hover:w-12 transition-all duration-500" />
                </button>
              ))}
            </div>
          )}

          {healthyProviders === 0 && (
            <button
              onClick={onOpenProviderSetup}
              className="group flex items-center gap-2 px-8 py-3.5 rounded-full bg-primary text-primary-foreground hover:brightness-110 active:scale-95 transition-all font-bold shadow-xl shadow-primary/25"
              aria-label="Configure a provider to start chatting"
            >
              <RefreshCw className="h-4 w-4 group-hover:rotate-180 transition-transform duration-700 ease-in-out" />
              Configure Provider
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 glass rounded-2xl p-4 overflow-y-auto overflow-x-hidden space-y-4"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
    >
      {messages.map((message) => (
        <MessageItem
          key={message.id}
          message={message}
          copiedId={copiedId}
          onCopy={onCopy}
          onRetry={onRetry}
          onDelete={onDelete}
          onQuickAction={onQuickAction}
        />
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
}

/**
 * Individual message item - separated for hook usage
 */
function MessageItem({
  message,
  copiedId,
  onCopy,
  onRetry,
  onDelete,
  onQuickAction,
}: {
  message: Message;
  copiedId: string | null;
  onCopy: (content: string, id: string) => void;
  onRetry: (messageId: string) => void;
  onDelete: (messageId: string) => void;
  onQuickAction: (prompt: string) => void;
}) {
  // Parse thinking and filter raw JSON for assistant messages
  const processed = useProcessedMessage(
    message.content,
    message.isLoading ?? false
  );

  return (
    <div
      className={cn('flex gap-3', message.role === 'user' ? 'flex-row-reverse' : '')}
    >
      {/* Avatar */}
      <div
        className={cn(
          'h-9 w-9 rounded-xl flex items-center justify-center shrink-0 border transition-all duration-300 shadow-sm',
          message.role === 'user' 
            ? 'bg-primary/10 border-primary/20 text-primary hidden sm:flex' 
            : 'bg-muted/50 border-border/50 text-muted-foreground'
        )}
      >
        {message.role === 'user' ? (
          <User className="h-5 w-5" />
        ) : (
          <Bot className="h-5 w-5" />
        )}
      </div>

      {/* Content */}
      <div
        className={cn(
          'max-w-[92%] sm:max-w-[75%] rounded-2xl px-3 py-2 sm:px-5 sm:py-3 group relative transition-all duration-300',
          message.role === 'user'
            ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/10 ml-auto rounded-tr-sm'
            : 'premium-card text-foreground shadow-sm rounded-tl-sm',
          message.error && 'border border-destructive/50 bg-destructive/5'
        )}
      >
        {message.role === 'user' && (
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent rounded-[2rem] pointer-events-none" />
        )}

        {message.isLoading ? (
          <div className="flex flex-col gap-3 py-2 px-1 min-w-[200px]">
            {/* Shimmer lines like Claude/ChatGPT */}
            <div className="flex items-center gap-3">
              <div className="h-2 w-2 rounded-full bg-primary/60 animate-pulse" />
              <div className="h-3 rounded-full bg-muted-foreground/10 animate-pulse w-3/4" style={{ animationDuration: '1.5s' }} />
            </div>
            <div className="h-3 rounded-full bg-muted-foreground/8 animate-pulse w-full ml-5" style={{ animationDuration: '1.5s', animationDelay: '200ms' }} />
            <div className="h-3 rounded-full bg-muted-foreground/6 animate-pulse w-2/3 ml-5" style={{ animationDuration: '1.5s', animationDelay: '400ms' }} />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40 ml-5 mt-1">
              Generating response...
            </span>
          </div>
        ) : (
          <>
            {/* Images */}
            {message.images && message.images.length > 0 && (
              <div className="flex gap-2 mb-2 flex-wrap">
                {message.images.map((img, i) => (
                  <img
                    key={i}
                    src={img}
                    alt={`Attached image ${i + 1}`}
                    className="h-20 w-20 object-cover rounded-lg"
                  />
                ))}
              </div>
            )}

            {/* Thinking Block - Collapsible like Claude */}
            {message.role === 'assistant' && processed.thinking && (
              <ThinkingBlock
                thinking={processed.thinking}
                isStreaming={false}
              />
            )}

            {/* Filtered JSON Block - Debug info */}
            {message.role === 'assistant' && processed.filteredJson.length > 0 && (
              <FilteredJsonBlock jsonBlocks={processed.filteredJson} />
            )}

            {/* Tool Calls */}
            {message.toolCalls && message.toolCalls.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                  <Terminal className="h-3 w-3" />
                  <span>Used {message.toolCalls.length} tool{message.toolCalls.length > 1 ? 's' : ''}</span>
                </div>
                <ToolCallGroup tools={message.toolCalls} />
              </div>
            )}

            {/* Canvas Artifacts */}
            {message.toolCalls?.filter((tc) => tc.name === 'canvas_render').map((tc, i) => {
              let artifact: CanvasArtifactData | null = null;
              try {
                const result = typeof tc.result === 'string'
                  ? (JSON.parse(tc.result) as Record<string, unknown>)
                  : (tc.result as Record<string, unknown> | null);
                if (result?.artifact && typeof result.artifact === 'object') {
                  artifact = result.artifact as CanvasArtifactData;
                } else if (result?.data && typeof result.data === 'object') {
                  // Fallback: reconstruct minimal artifact from the render result
                  const data = result.data as Record<string, unknown>;
                  if (data.artifactId && data.type) {
                    artifact = {
                      id: String(data.artifactId),
                      type: data.type as CanvasArtifactData['type'],
                      title: data.title as string | undefined,
                      content: String(data.preview ?? ''),
                    };
                  }
                }
              } catch {
                // Malformed result - skip rendering
              }
              if (!artifact) return null;
              return <CanvasArtifact key={`canvas-${i}`} artifact={artifact} />;
            })}

            {/* Message Content with Markdown - Use cleaned content for assistant */}
            <div className={cn(
              "text-[15px] leading-relaxed overflow-x-auto",
              message.role === 'user' ? "font-medium selection:bg-white/30" : "selection:bg-primary/20",
              message.role === 'user' && "text-shadow-sm"
            )}>
              {message.role === 'assistant' ? (
                <MarkdownRenderer content={processed.content} />
              ) : (
                <p className="whitespace-pre-wrap">{message.content}</p>
              )}
            </div>

            {/* Error state */}
            {message.error && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-destructive">{message.error}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRetry(message.id)}
                  className="h-6 px-2"
                  aria-label="Retry message"
                >
                  <RefreshCw className="h-3 w-3 mr-1" aria-hidden="true" />
                  Retry
                </Button>
              </div>
            )}

            {/* Token usage */}
            {message.usage && (
              <div className="mt-2 pt-2 border-t border-border/10 text-[10px] text-muted-foreground/60 flex items-center gap-3">
                <div className="flex items-center gap-2 bg-muted/30 rounded-md px-2 py-0.5 border border-border/20">
                  <span>{message.usage.totalTokens.toLocaleString()} tokens</span>
                  {message.usage.cost && message.usage.cost > 0 && (
                    <>
                      <span className="opacity-30">|</span>
                      <span>${message.usage.cost.toFixed(4)}</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Smart routing badge - only shown for assistant messages with routing info */}
            {message.role === 'assistant' && message.routing && !message.isLoading && (
              <div className="mt-1.5 flex items-center gap-1 text-[10px] text-emerald-600/70 dark:text-emerald-400/60">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 dark:bg-emerald-500" />
                <span>
                  Routed to {message.routing.modelLabel}
                  {message.routing.savingsPercent !== undefined && message.routing.savingsPercent > 0
                    ? ` (saved ${message.routing.savingsPercent.toFixed(0)}%)`
                    : ''}
                </span>
              </div>
            )}

            {/* Proactive suggestions */}
            {message.role === 'assistant' && message.suggestions && message.suggestions.length > 0 && !message.isLoading && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {message.suggestions.slice(0, 3).map((suggestion) => (
                  <button
                    key={suggestion.id}
                    onClick={() => {
                      if (suggestion.action?.command) {
                        onQuickAction(suggestion.action.command);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 transition-colors"
                    title={suggestion.message}
                  >
                    <span className="h-1 w-1 rounded-full bg-primary/60" />
                    {suggestion.action?.label ?? suggestion.message.slice(0, 40)}
                  </button>
                ))}
              </div>
            )}

            {/* Message action buttons - visible on hover */}
            {!message.isLoading && (
              <div className="opacity-0 group-hover:opacity-100 absolute top-2 right-2 flex items-center gap-1 transition-all duration-300">
                {message.role === 'assistant' && (
                  <button
                    onClick={() => onCopy(processed.content, message.id)}
                    className="p-2 rounded-xl glass-heavy hover:bg-primary/10 border-primary/10 transition-all duration-300 hover:scale-110 active:scale-95"
                    aria-label="Copy message content"
                  >
                    {copiedId === message.id ? (
                      <Check className="h-3.5 w-3.5 text-success shadow-[0_0_8px_var(--success)]" aria-hidden="true" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden="true" />
                    )}
                  </button>
                )}
                <button
                  onClick={() => onDelete(message.id)}
                  className="p-2 rounded-xl glass-heavy hover:bg-destructive/10 border-destructive/10 transition-all duration-300 hover:scale-110 active:scale-95"
                  aria-label="Delete message"
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground/60 hover:text-destructive transition-colors" aria-hidden="true" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
