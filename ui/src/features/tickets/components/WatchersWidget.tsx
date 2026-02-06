import { useState } from 'react';
import { Eye, EyeOff, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface WatchersWidgetProps {
  ticketId: string;
  watchers?: string[];
  currentUser?: string;
}

export function WatchersWidget({ watchers = [], currentUser }: WatchersWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [localWatchers, setLocalWatchers] = useState<string[]>(watchers);
  const [isWatching, setIsWatching] = useState(
    currentUser ? localWatchers.includes(currentUser) : false
  );
  const [isLoading, setIsLoading] = useState(false);

  const handleToggleWatch = async () => {
    if (!currentUser) return;

    setIsLoading(true);

    try {
      // Simulate async operation
      await new Promise(resolve => setTimeout(resolve, 300));

      if (isWatching) {
        setLocalWatchers(prev => prev.filter(w => w !== currentUser));
        setIsWatching(false);
        toast.success('Unwatched ticket');
      } else {
        setLocalWatchers(prev => [...prev, currentUser]);
        setIsWatching(true);
        toast.success('Now watching ticket');
      }
    } catch (error) {
      toast.error('Failed to update watch status');
    } finally {
      setIsLoading(false);
    }
  };

  const watcherCount = localWatchers.length;

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="rounded-lg border border-zinc-800 bg-zinc-900/50"
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors">
        <div className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-zinc-500" />
          ) : (
            <ChevronRight className="h-4 w-4 text-zinc-500" />
          )}
          <span className="text-sm font-medium text-zinc-300">Watchers</span>
          {watcherCount > 0 && (
            <Badge variant="secondary" className="bg-zinc-800 text-zinc-400 text-xs">
              {watcherCount}
            </Badge>
          )}
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="border-t border-zinc-800 px-4 py-3 space-y-3">
          {/* Watch/Unwatch Button */}
          {currentUser && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleToggleWatch}
              disabled={isLoading}
              className={cn(
                "w-full justify-start gap-2",
                isWatching
                  ? "border-blue-500/50 text-blue-400 hover:bg-blue-500/10"
                  : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
              )}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isWatching ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
              {isWatching ? 'Unwatch' : 'Watch'} this ticket
            </Button>
          )}

          {/* Watchers List */}
          {watcherCount > 0 ? (
            <div className="space-y-2">
              <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Watching ({watcherCount})
              </div>
              <div className="space-y-1">
                {localWatchers.map((watcher, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 px-2 py-1.5 rounded bg-zinc-800/50 text-sm text-zinc-300"
                  >
                    <Eye className="h-3.5 w-3.5 text-blue-400" />
                    <span>{watcher}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-4 text-sm text-zinc-500">
              No one is watching this ticket yet
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
