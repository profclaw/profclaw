/**
 * SyncStatus Component
 *
 * Displays the sync status for external platforms (GitHub, Linear, etc.)
 * Shows connection state, last sync time, and allows manual sync.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  RefreshCw,
  Check,
  X,
  AlertTriangle,
  Github,
  ExternalLink,
  Clock,
} from 'lucide-react';
import { api } from '@/core/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface SyncStatusProps {
  projectId?: string;
  compact?: boolean;
  className?: string;
}

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  github: <Github className="h-4 w-4" />,
  linear: <span className="font-bold text-xs">L</span>,
  jira: <span className="font-bold text-xs">J</span>,
};

const PLATFORM_COLORS: Record<string, string> = {
  github: '#24292e',
  linear: '#5E6AD2',
  jira: '#0052CC',
};

export function SyncStatus({ compact = false, className }: SyncStatusProps) {
  const queryClient = useQueryClient();
  const [syncingPlatform, setSyncingPlatform] = useState<string | null>(null);

  // Fetch sync status
  const { data: syncStatus, isLoading } = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => api.sync.status(),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Manual sync mutation
  const syncMutation = useMutation({
    mutationFn: (platform?: string) => api.sync.trigger(platform),
    onMutate: (platform) => {
      setSyncingPlatform(platform ?? 'all');
    },
    onSettled: () => {
      setSyncingPlatform(null);
      queryClient.invalidateQueries({ queryKey: ['sync-status'] });
    },
  });

  if (isLoading) {
    return (
      <div className={cn('flex items-center gap-2 text-muted-foreground', className)}>
        <RefreshCw className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading sync status...</span>
      </div>
    );
  }

  if (!syncStatus?.enabled) {
    return null;
  }

  const adapters = Object.entries(syncStatus.adapters ?? {});
  const health = syncStatus.health ?? {};
  const pendingConflicts = syncStatus.pendingConflicts ?? 0;

  if (compact) {
    // Compact view: just icons with status
    return (
      <div className={cn('flex items-center gap-1', className)}>
        {adapters.map(([platform, status]) => {
          const platformHealth = health[platform];
          const isHealthy = platformHealth?.healthy ?? status.connected;
          const isSyncing = syncingPlatform === platform || syncingPlatform === 'all';

          return (
            <Tooltip key={platform}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => syncMutation.mutate(platform)}
                  disabled={isSyncing}
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded',
                    'hover:bg-muted transition-colors',
                    isHealthy ? 'text-green-500' : 'text-red-500'
                  )}
                >
                  {isSyncing ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    PLATFORM_ICONS[platform] ?? (
                      <ExternalLink className="h-3.5 w-3.5" />
                    )
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <div className="text-xs">
                  <div className="font-medium capitalize">{platform}</div>
                  <div className="text-muted-foreground">
                    {isHealthy ? 'Connected' : 'Disconnected'}
                  </div>
                  {status.lastSync && (
                    <div className="text-muted-foreground">
                      Last sync: {formatRelativeTime(status.lastSync)}
                    </div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}

        {pendingConflicts > 0 && (
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="destructive" className="h-5 px-1.5 text-xs">
                <AlertTriangle className="mr-1 h-3 w-3" />
                {pendingConflicts}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              {pendingConflicts} sync conflict{pendingConflicts > 1 ? 's' : ''} need resolution
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    );
  }

  // Full view
  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">External Sync</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => syncMutation.mutate(undefined)}
          disabled={!!syncingPlatform}
        >
          {syncingPlatform ? (
            <>
              <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
              Syncing...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
              Sync All
            </>
          )}
        </Button>
      </div>

      <div className="space-y-2">
        {adapters.map(([platform, status]) => {
          const platformHealth = health[platform];
          const isHealthy = platformHealth?.healthy ?? status.connected;
          const latency = platformHealth?.latencyMs;
          const isSyncing = syncingPlatform === platform || syncingPlatform === 'all';

          return (
            <div
              key={platform}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="flex items-center gap-3">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-md text-white"
                  style={{ backgroundColor: PLATFORM_COLORS[platform] ?? '#6B7280' }}
                >
                  {PLATFORM_ICONS[platform] ?? <ExternalLink className="h-4 w-4" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium capitalize">{platform}</span>
                    {isHealthy ? (
                      <Badge variant="outline" className="h-5 gap-1 border-green-500 text-green-500">
                        <Check className="h-3 w-3" />
                        Connected
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="h-5 gap-1 border-red-500 text-red-500">
                        <X className="h-3 w-3" />
                        Disconnected
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {status.lastSync && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatRelativeTime(status.lastSync)}
                      </span>
                    )}
                    {latency !== undefined && (
                      <span>{latency}ms</span>
                    )}
                    {status.errorCount > 0 && (
                      <span className="text-orange-500">
                        {status.errorCount} error{status.errorCount > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => syncMutation.mutate(platform)}
                disabled={isSyncing}
              >
                {isSyncing ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </div>
          );
        })}
      </div>

      {pendingConflicts > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-orange-500/50 bg-orange-500/10 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-orange-500" />
          <span>
            {pendingConflicts} sync conflict{pendingConflicts > 1 ? 's' : ''} need manual resolution
          </span>
          <Button variant="link" size="sm" className="ml-auto h-auto p-0 text-orange-500">
            Resolve
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Inline sync indicator for ticket rows
 */
export function SyncIndicator({
  platform,
  lastSync,
  syncStatus,
}: {
  platform: string;
  lastSync?: string;
  syncStatus?: 'synced' | 'pending' | 'error';
}) {
  const statusColors = {
    synced: 'text-green-500',
    pending: 'text-yellow-500',
    error: 'text-red-500',
  };

  return (
    <Tooltip>
      <TooltipTrigger>
        <div className={cn('flex items-center gap-1', statusColors[syncStatus ?? 'synced'])}>
          {PLATFORM_ICONS[platform] ?? <ExternalLink className="h-3 w-3" />}
          {syncStatus === 'pending' && <RefreshCw className="h-3 w-3 animate-spin" />}
          {syncStatus === 'error' && <AlertTriangle className="h-3 w-3" />}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <div className="text-xs">
          <div className="capitalize">{platform}</div>
          {lastSync && <div>Last sync: {formatRelativeTime(lastSync)}</div>}
          {syncStatus === 'error' && <div className="text-red-500">Sync failed</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
