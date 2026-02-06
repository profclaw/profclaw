/**
 * Job Card Component
 *
 * Displays a scheduled job with status, next run, and quick actions.
 */

import { useState } from 'react';
import {
  Clock,
  Play,
  Pause,
  Trash2,
  History,
  MoreVertical,
  CheckCircle2,
  XCircle,
  Globe,
  Wrench,
  Terminal,
  MessageSquare,
  RefreshCw,
  Timer,
  Zap,
  Pencil,
  Archive,
  ArchiveRestore,
  Tag,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { JobCardProps } from '../types';

// Job type icons
const JOB_TYPE_ICONS = {
  http: Globe,
  tool: Wrench,
  script: Terminal,
  message: MessageSquare,
};

// Status colors and icons
const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: typeof Clock; label: string }> = {
  active: { color: 'text-green-500', bg: 'bg-green-500/10', icon: CheckCircle2, label: 'Active' },
  paused: { color: 'text-amber-500', bg: 'bg-amber-500/10', icon: Pause, label: 'Paused' },
  completed: { color: 'text-blue-500', bg: 'bg-blue-500/10', icon: CheckCircle2, label: 'Completed' },
  failed: { color: 'text-red-500', bg: 'bg-red-500/10', icon: XCircle, label: 'Failed' },
  archived: { color: 'text-muted-foreground', bg: 'bg-muted/50', icon: Archive, label: 'Archived' },
};

const DEFAULT_STATUS = { color: 'text-muted-foreground', bg: 'bg-muted/50', icon: Clock, label: 'Unknown' };

function formatNextRun(nextRunAt?: string): string {
  if (!nextRunAt) return 'Not scheduled';

  const next = new Date(nextRunAt);
  const now = new Date();
  const diff = next.getTime() - now.getTime();

  if (diff < 0) return 'Overdue';
  if (diff < 60000) return 'In less than a minute';
  if (diff < 3600000) return `In ${Math.round(diff / 60000)} min`;
  if (diff < 86400000) return `In ${Math.round(diff / 3600000)} hours`;
  return next.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatLastRun(lastRunAt?: string): string {
  if (!lastRunAt) return 'Never';

  const last = new Date(lastRunAt);
  const now = new Date();
  const diff = now.getTime() - last.getTime();

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.round(diff / 60000)} min ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)} hours ago`;
  return last.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function JobCard({ job, onTrigger, onPause, onResume, onDelete, onViewHistory, onEdit, onArchive, onRestore }: JobCardProps) {
  const [isTriggering, setIsTriggering] = useState(false);

  const TypeIcon = JOB_TYPE_ICONS[job.jobType] || Wrench;
  const statusConfig = STATUS_CONFIG[job.status] || DEFAULT_STATUS;
  const StatusIcon = statusConfig.icon;
  const isArchived = job.status === 'archived';

  const handleTrigger = async () => {
    setIsTriggering(true);
    try {
      await onTrigger(job.id);
    } finally {
      setIsTriggering(false);
    }
  };

  const successRate = job.runCount > 0
    ? Math.round((job.successCount / job.runCount) * 100)
    : 0;

  return (
    <div className="group relative rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm p-4 hover:border-border hover:shadow-lg transition-all duration-200">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className={cn('h-10 w-10 rounded-xl flex items-center justify-center shrink-0', statusConfig.bg)}>
            <TypeIcon className={cn('h-5 w-5', statusConfig.color)} />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm truncate">{job.name}</h3>
            {job.description && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">{job.description}</p>
            )}
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 opacity-0 group-hover:opacity-100">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {!isArchived && (
              <>
                <DropdownMenuItem onClick={handleTrigger} disabled={isTriggering}>
                  <Zap className="h-4 w-4 mr-2" />
                  Run Now
                </DropdownMenuItem>
                {onEdit && (
                  <DropdownMenuItem onClick={() => onEdit(job)}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit Job
                  </DropdownMenuItem>
                )}
              </>
            )}
            <DropdownMenuItem onClick={() => onViewHistory(job.id)}>
              <History className="h-4 w-4 mr-2" />
              View History
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {!isArchived && job.status === 'active' && (
              <DropdownMenuItem onClick={() => onPause(job.id)}>
                <Pause className="h-4 w-4 mr-2" />
                Pause Job
              </DropdownMenuItem>
            )}
            {!isArchived && job.status === 'paused' && (
              <DropdownMenuItem onClick={() => onResume(job.id)}>
                <Play className="h-4 w-4 mr-2" />
                Resume Job
              </DropdownMenuItem>
            )}
            {isArchived && onRestore && (
              <DropdownMenuItem onClick={() => onRestore(job.id)}>
                <ArchiveRestore className="h-4 w-4 mr-2" />
                Restore Job
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {!isArchived && onArchive && (
              <DropdownMenuItem onClick={() => onArchive(job.id)} className="text-amber-500 focus:text-amber-500">
                <Archive className="h-4 w-4 mr-2" />
                Archive Job
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => onDelete(job.id)} className="text-red-500 focus:text-red-500">
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Permanently
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Status & Schedule */}
      <div className="flex items-center gap-2 mb-2">
        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold', statusConfig.bg, statusConfig.color)}>
          <StatusIcon className="h-3 w-3" />
          {statusConfig.label}
        </span>
        <span className="text-[10px] text-muted-foreground font-mono">
          {job.cronExpression || `Every ${Math.round((job.intervalMs || 0) / 1000)}s`}
        </span>
      </div>

      {/* Labels */}
      {job.labels && job.labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {job.labels.slice(0, 3).map((label) => (
            <span
              key={label}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[9px]"
            >
              <Tag className="h-2.5 w-2.5" />
              {label}
            </span>
          ))}
          {job.labels.length > 3 && (
            <span className="text-[9px] text-muted-foreground">+{job.labels.length - 3}</span>
          )}
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="text-center p-2 rounded-lg bg-muted/50">
          <div className="text-lg font-bold">{job.runCount}</div>
          <div className="text-[10px] text-muted-foreground">Total Runs</div>
        </div>
        <div className="text-center p-2 rounded-lg bg-muted/50">
          <div className={cn('text-lg font-bold', successRate >= 80 ? 'text-green-500' : successRate >= 50 ? 'text-amber-500' : 'text-red-500')}>
            {successRate}%
          </div>
          <div className="text-[10px] text-muted-foreground">Success</div>
        </div>
        <div className="text-center p-2 rounded-lg bg-muted/50">
          <div className="text-lg font-bold text-red-500">{job.failureCount}</div>
          <div className="text-[10px] text-muted-foreground">Failures</div>
        </div>
      </div>

      {/* Timing Info */}
      <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border/50 pt-3">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          <span>Last: {formatLastRun(job.lastRunAt)}</span>
          {job.lastRunStatus && (
            <span className={cn(
              'h-1.5 w-1.5 rounded-full',
              job.lastRunStatus === 'success' ? 'bg-green-500' : 'bg-red-500'
            )} />
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Timer className="h-3.5 w-3.5" />
          <span>{formatNextRun(job.nextRunAt)}</span>
        </div>
      </div>

      {/* Quick Action */}
      <Button
        variant="outline"
        size="sm"
        className="w-full mt-3 h-8 text-xs"
        onClick={handleTrigger}
        disabled={isTriggering || job.status === 'completed'}
      >
        {isTriggering ? (
          <>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            Running...
          </>
        ) : (
          <>
            <Zap className="h-3.5 w-3.5 mr-1.5" />
            Run Now
          </>
        )}
      </Button>
    </div>
  );
}

export default JobCard;
