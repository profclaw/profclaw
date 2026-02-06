/**
 * Thinking Block Component
 *
 * Collapsible disclosure for AI thinking/reasoning.
 * Based on AI SDK's Reasoning component pattern:
 * - Auto-opens during streaming
 * - Closes when complete
 * - Visual differentiation from regular content
 *
 * @see https://ai-sdk.dev/elements/components/reasoning
 */

import { useState, useEffect } from 'react';
import { Brain, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ThinkingBlockProps {
  /** The thinking/reasoning content */
  thinking: string;
  /** Whether the AI is currently streaming this thinking block */
  isStreaming?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Override the default open state */
  defaultOpen?: boolean;
}

export function ThinkingBlock({
  thinking,
  isStreaming = false,
  className,
  defaultOpen,
}: ThinkingBlockProps) {
  // Auto-open during streaming, auto-close when done
  const [isOpen, setIsOpen] = useState(defaultOpen ?? isStreaming);

  // Auto-open when streaming starts, close when it ends
  useEffect(() => {
    if (isStreaming) {
      setIsOpen(true);
    }
  }, [isStreaming]);

  if (!thinking) return null;

  // Calculate stats for display
  const wordCount = thinking.split(/\s+/).length;

  return (
    <div className={cn('mb-3', className)}>
      {/* Trigger Button - Clean, neutral design */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-3 w-full px-4 py-3 rounded-2xl transition-all duration-300 group text-left',
          'premium-card',
          isStreaming && 'bg-primary/5'
        )}
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Collapse thinking' : 'Expand thinking'}
      >
        {/* Brain Icon with streaming indicator */}
        <div className={cn(
          "relative flex items-center justify-center h-8 w-8 rounded-xl shadow-inner transition-all duration-300",
          isStreaming 
            ? "bg-primary/20 shadow-[0_0_15px_-3px_var(--primary-glow)]" 
            : "bg-muted shadow-sm"
        )}>
          <Brain
            className={cn(
              'h-4 w-4 transition-all duration-500',
              isStreaming 
                ? "text-primary animate-pulse" 
                : "text-muted-foreground",
              isOpen && !isStreaming ? 'text-foreground' : '',
              isOpen ? 'scale-110 rotate-[15deg]' : 'scale-100'
            )}
          />
          {isStreaming && (
            <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-primary animate-ping shadow-[0_0_8px_var(--primary-glow)]" />
          )}
        </div>

        {/* Label */}
        <div className="flex-1 flex flex-col">
          <span className={cn(
            "text-[13px] font-bold tracking-tight transition-colors",
            isStreaming ? "text-primary" : "text-foreground/80"
          )}>
            {isStreaming ? (
              <span className="flex items-center gap-1.5 uppercase text-[10px] tracking-widest font-black">
                Thinking
                <span className="inline-flex gap-0.5">
                  <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
                  <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
                  <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
                </span>
              </span>
            ) : isOpen ? (
              'Analytic Reasoning'
            ) : (
              'View Process Trace'
            )}
          </span>
          {!isStreaming && (
            <span className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground/60">
              {wordCount} tokens distilled
            </span>
          )}
        </div>

        {/* Chevron */}
        <div
          className={cn(
            'h-6 w-6 flex items-center justify-center rounded-lg transition-all duration-300',
            isOpen ? 'rotate-90 bg-zinc-100 dark:bg-zinc-800' : 'bg-transparent'
          )}
        >
          <ChevronRight className={cn("h-3.5 w-3.5", isOpen ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400")} />
        </div>
      </button>

      {/* Collapsible Content */}
      <div
        className={cn(
          'grid transition-all duration-500 cubic-bezier(0.4, 0, 0.2, 1)',
          isOpen ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0'
        )}
      >
        <div className="overflow-hidden">
          <div
            className={cn(
              'px-5 py-4 rounded-2xl glass',
              'max-h-[32rem] overflow-y-auto scrollbar-glass'
            )}
          >
            <pre className="whitespace-pre-wrap font-mono text-[12px] text-muted-foreground leading-relaxed">
              {thinking}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Filtered JSON Block
 *
 * Shows filtered raw JSON in a warning block (for debugging).
 * Hidden by default, expandable for power users.
 */
interface FilteredJsonBlockProps {
  jsonBlocks: string[];
  className?: string;
}

export function FilteredJsonBlock({ jsonBlocks, className }: FilteredJsonBlockProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!jsonBlocks || jsonBlocks.length === 0) return null;

  return (
    <div className={cn('mb-3', className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Collapse raw output' : 'Expand raw output'}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg',
          'bg-amber-100 dark:bg-amber-500/15',
          'hover:bg-amber-200 dark:hover:bg-amber-500/25',
          'border border-amber-300 dark:border-amber-500/30',
          'transition-colors text-left text-xs'
        )}
      >
        <span className="text-amber-700 dark:text-amber-400">
          {jsonBlocks.length} raw output{jsonBlocks.length > 1 ? 's' : ''} filtered
        </span>
        <ChevronRight
          className={cn(
            'h-3 w-3 text-amber-600 dark:text-amber-400/70 transition-transform',
            isOpen && 'rotate-90'
          )}
        />
      </button>

      <div
        className={cn(
          'grid transition-all duration-200',
          isOpen ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0'
        )}
      >
        <div className="overflow-hidden">
          <div className="px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
            {jsonBlocks.map((json, i) => (
              <pre key={i} className="text-xs text-amber-800 dark:text-amber-300/80 font-mono whitespace-pre-wrap">
                {json}
              </pre>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
