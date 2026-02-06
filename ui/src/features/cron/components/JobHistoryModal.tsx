/**
 * Job History Modal
 *
 * Shows execution history for a scheduled job with logs and timing.
 */

import { useQuery } from '@tanstack/react-query';
import {
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Timer,
  AlertTriangle,
  RefreshCw,
  Terminal,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { api } from '@/core/api/client';
import type { JobHistoryModalProps } from '../types';

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: typeof Clock; label: string }> = {
  pending: { color: 'text-amber-500', bg: 'bg-amber-500/10', icon: Clock, label: 'Pending' },
  running: { color: 'text-blue-500', bg: 'bg-blue-500/10', icon: Loader2, label: 'Running' },
  success: { color: 'text-green-500', bg: 'bg-green-500/10', icon: CheckCircle2, label: 'Success' },
  failure: { color: 'text-red-500', bg: 'bg-red-500/10', icon: XCircle, label: 'Failed' },
  error: { color: 'text-red-500', bg: 'bg-red-500/10', icon: XCircle, label: 'Error' },
  timeout: { color: 'text-orange-500', bg: 'bg-orange-500/10', icon: AlertTriangle, label: 'Timeout' },
  cancelled: { color: 'text-muted-foreground', bg: 'bg-muted/50', icon: XCircle, label: 'Cancelled' },
};

// Default config for unknown statuses
const DEFAULT_STATUS_CONFIG = { color: 'text-muted-foreground', bg: 'bg-muted/50', icon: AlertTriangle, label: 'Unknown' };

function formatDuration(ms?: number): string {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function JobHistoryModal({ jobId, jobName, open, onOpenChange }: JobHistoryModalProps) {
  // Fetch job history
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['cron-history', jobId],
    queryFn: () => api.cron.history(jobId!, 50),
    enabled: !!jobId && open,
    refetchInterval: 5000, // Auto-refresh every 5s when open
  });

  const history = data?.history || [];
  const jobStats = data?.job;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-primary" />
            Job History: {jobName || jobId?.slice(0, 8)}
          </DialogTitle>
        </DialogHeader>

        {/* Job Stats */}
        {jobStats && (
          <div className="flex items-center gap-4 p-3 rounded-xl bg-muted/50 border border-border/50 mb-4">
            <div className="flex-1 text-center">
              <div className="text-2xl font-bold">{jobStats.runCount}</div>
              <div className="text-[10px] text-muted-foreground">Total Runs</div>
            </div>
            <div className="h-8 w-px bg-border" />
            <div className="flex-1 text-center">
              <div className="text-2xl font-bold text-green-500">{jobStats.successCount}</div>
              <div className="text-[10px] text-muted-foreground">Successes</div>
            </div>
            <div className="h-8 w-px bg-border" />
            <div className="flex-1 text-center">
              <div className="text-2xl font-bold text-red-500">{jobStats.failureCount}</div>
              <div className="text-[10px] text-muted-foreground">Failures</div>
            </div>
            <div className="h-8 w-px bg-border" />
            <div className="flex-1 text-center">
              <div className="text-2xl font-bold">
                {jobStats.runCount > 0
                  ? Math.round((jobStats.successCount / jobStats.runCount) * 100)
                  : 0}%
              </div>
              <div className="text-[10px] text-muted-foreground">Success Rate</div>
            </div>
          </div>
        )}

        {/* History List */}
        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
              <p className="text-sm text-muted-foreground">Loading history...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12">
              <AlertTriangle className="h-8 w-8 text-red-500 mb-3" />
              <p className="text-sm text-red-500">Failed to load history</p>
              <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-3">
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry
              </Button>
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Clock className="h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">No runs yet</p>
              <p className="text-xs text-muted-foreground/70 mt-1">History will appear here after the first execution</p>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((run, index) => {
                const config = STATUS_CONFIG[run.status] || DEFAULT_STATUS_CONFIG;
                const StatusIcon = config.icon;
                const isRunning = run.status === 'running';

                return (
                  <div
                    key={run.id}
                    className={cn(
                      'rounded-xl border p-3 transition-colors',
                      index === 0 ? 'border-primary/30 bg-primary/5' : 'border-border/50 bg-card/50'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2">
                        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold', config.bg, config.color)}>
                          <StatusIcon className={cn('h-3 w-3', isRunning && 'animate-spin')} />
                          {config.label}
                        </span>
                        {index === 0 && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-primary/10 text-primary">
                            Latest
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Timer className="h-3.5 w-3.5" />
                          {formatDuration(run.durationMs)}
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {formatTime(run.startedAt)}
                        </div>
                      </div>
                    </div>

                    {/* Output/Error */}
                    {(run.output || run.error) && (
                      <div className={cn(
                        'mt-2 p-2 rounded-lg text-xs font-mono overflow-x-auto',
                        run.error ? 'bg-red-500/10 text-red-400' : 'bg-muted/50 text-muted-foreground'
                      )}>
                        <pre className="whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
                          {run.error || run.output}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-border/50 mt-4">
          <p className="text-xs text-muted-foreground">
            Showing {history.length} runs
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Refresh
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default JobHistoryModal;
