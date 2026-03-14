/**
 * Memory Indicator
 *
 * Small indicator showing when cross-conversation memory is active.
 * Only rendered when experienceCount > 0.
 */

import { Brain } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// =============================================================================
// Types
// =============================================================================

export interface MemoryIndicatorProps {
  experienceCount: number;
  experienceTopics?: string[];
  isLoading?: boolean;
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export function MemoryIndicator({
  experienceCount,
  experienceTopics = [],
  isLoading = false,
  className,
}: MemoryIndicatorProps) {
  if (!isLoading && experienceCount === 0) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs',
            'bg-violet-500/10 text-violet-500 border border-violet-500/20',
            'cursor-default select-none transition-opacity duration-300',
            isLoading ? 'opacity-60 animate-pulse' : 'opacity-100 animate-in fade-in-0 zoom-in-95',
            className
          )}
        >
          <Brain className="h-3 w-3 shrink-0" />
          {isLoading ? (
            <span>Loading memory...</span>
          ) : (
            <span>Using {experienceCount} past experience{experienceCount !== 1 ? 's' : ''}</span>
          )}
        </div>
      </TooltipTrigger>
      {!isLoading && experienceTopics.length > 0 && (
        <TooltipContent side="top">
          <div className="space-y-1.5 max-w-52">
            <p className="text-xs font-semibold">Recalled experiences</p>
            <ul className="space-y-0.5">
              {experienceTopics.map((topic) => (
                <li key={topic} className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <span className="mt-1.5 h-1 w-1 rounded-full bg-violet-400 shrink-0" />
                  <span>{topic}</span>
                </li>
              ))}
            </ul>
          </div>
        </TooltipContent>
      )}
    </Tooltip>
  );
}
