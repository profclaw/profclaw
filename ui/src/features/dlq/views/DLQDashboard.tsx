import { useState } from 'react';
import { useDLQTasks, useRetryDLQTask, useRemoveDLQTask } from '../api/dlq';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertTriangle,
  RefreshCw,
  Trash2,
  Clock,
  CheckCircle,
  XCircle,
  Skull,
  RotateCcw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface DLQTask {
  id: string;
  title: string;
  error: string;
  failedAt: string;
  attempts: number;
}

function TaskCard({ task, onRetry, onRemove, isRetrying, isRemoving }: {
  task: DLQTask;
  onRetry: () => void;
  onRemove: () => void;
  isRetrying: boolean;
  isRemoving: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="glass rounded-[20px] overflow-hidden border-red-500/10 group hover-lift transition-liquid">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          {/* Left side - Task info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-8 w-8 rounded-xl bg-red-500/10 flex items-center justify-center flex-shrink-0">
                <XCircle className="h-4 w-4 text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold truncate">{task.title}</h3>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(task.failedAt).toLocaleString()}
                  </span>
                  <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                    {task.attempts} {task.attempts === 1 ? 'attempt' : 'attempts'}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Error message - collapsible */}
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full text-left"
            >
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                <span className={cn("transition-all", expanded ? "" : "truncate")}>
                  {task.error}
                </span>
              </div>
            </button>

            {expanded && (
              <div className="mt-3 p-3 rounded-xl bg-red-500/5 border border-red-500/10">
                <pre className="text-[10px] text-red-300 whitespace-pre-wrap font-mono overflow-x-auto">
                  {task.error}
                </pre>
              </div>
            )}
          </div>

          {/* Right side - Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-xl text-[11px] font-bold border-green-500/20 text-green-400 hover:bg-green-500/10"
              onClick={onRetry}
              disabled={isRetrying}
            >
              {isRetrying ? (
                <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              )}
              Retry
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-xl text-[11px] font-bold border-red-500/20 text-red-400 hover:bg-red-500/10"
              onClick={onRemove}
              disabled={isRemoving}
            >
              {isRemoving ? (
                <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              )}
              Remove
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function DLQDashboard() {
  const { data, isLoading, error } = useDLQTasks();
  const retryMutation = useRetryDLQTask();
  const removeMutation = useRemoveDLQTask();
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());

  const handleRetry = async (id: string) => {
    setRetryingIds(prev => new Set(prev).add(id));
    try {
      await retryMutation.mutateAsync(id);
      toast.success('Task queued for retry');
    } catch (err) {
      toast.error('Failed to retry task');
    } finally {
      setRetryingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleRemove = async (id: string) => {
    setRemovingIds(prev => new Set(prev).add(id));
    try {
      await removeMutation.mutateAsync(id);
      toast.success('Task removed from DLQ');
    } catch (err) {
      toast.error('Failed to remove task');
    } finally {
      setRemovingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleRetryAll = async () => {
    if (!data?.tasks) return;
    for (const task of data.tasks) {
      await handleRetry(task.id);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <header>
          <h2 className="text-2xl font-bold tracking-tight">Failed Tasks</h2>
          <p className="text-muted-foreground text-sm">Loading dead letter queue...</p>
        </header>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-[20px] skeleton-glass" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <header>
          <h2 className="text-2xl font-bold tracking-tight">Failed Tasks</h2>
          <p className="text-muted-foreground text-sm">Dead Letter Queue</p>
        </header>
        <Card className="glass rounded-[28px] border-red-500/10">
          <CardContent className="p-8 text-center">
            <p className="text-red-400">Failed to load dead letter queue</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const tasks = data?.tasks ?? [];
  const count = data?.count ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Failed Tasks</h2>
          <p className="text-muted-foreground text-sm">
            Tasks that failed processing and need attention.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {count > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl text-[11px] font-bold"
              onClick={handleRetryAll}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Retry All ({count})
            </Button>
          )}
          <div className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-full glass border-white/10",
            count > 0 ? "border-red-500/20" : "border-green-500/20"
          )}>
            {count > 0 ? (
              <>
                <Skull className="h-4 w-4 text-red-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-red-400">
                  {count} Failed
                </span>
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 text-green-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-green-400">
                  All Clear
                </span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Stats Card */}
      {count > 0 && (
        <Card className="glass rounded-[24px] border-yellow-500/10 overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-yellow-500 to-orange-600 flex items-center justify-center shadow-lg shadow-yellow-500/20">
                <AlertTriangle className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold">Attention Required</p>
                <p className="text-[11px] text-muted-foreground">
                  {count} {count === 1 ? 'task has' : 'tasks have'} failed and been moved to the dead letter queue.
                  Review the errors and retry or remove them.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Task List */}
      {count === 0 ? (
        <Card className="glass rounded-[28px] border-white/5">
          <CardContent className="p-12">
            <div className="flex flex-col items-center justify-center text-center">
              <div className="h-20 w-20 rounded-full glass-heavy flex items-center justify-center mb-6 border border-green-500/20">
                <CheckCircle className="h-10 w-10 text-green-400" />
              </div>
              <h3 className="text-xl font-bold mb-2">No Failed Tasks</h3>
              <p className="text-muted-foreground max-w-md">
                All tasks are processing normally. Failed tasks will appear here if any agent
                encounters an error during execution.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onRetry={() => handleRetry(task.id)}
              onRemove={() => handleRemove(task.id)}
              isRetrying={retryingIds.has(task.id)}
              isRemoving={removingIds.has(task.id)}
            />
          ))}
        </div>
      )}

      {/* Help Text */}
      <Card className="glass rounded-[24px] border-white/5">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="h-10 w-10 rounded-xl glass-heavy flex items-center justify-center flex-shrink-0">
              <Badge variant="secondary" className="text-[10px] px-2 py-0.5">?</Badge>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-bold">About the Dead Letter Queue</p>
              <ul className="text-[12px] text-muted-foreground space-y-1.5 list-disc list-inside">
                <li>Tasks are moved here after failing multiple retry attempts</li>
                <li><strong>Retry</strong> puts the task back in the main queue for another attempt</li>
                <li><strong>Remove</strong> permanently deletes the task from the queue</li>
                <li>Check the error message to understand why the task failed</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
