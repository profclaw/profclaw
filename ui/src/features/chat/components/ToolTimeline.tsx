/**
 * Tool Timeline
 *
 * Visual timeline of tool calls during agent execution.
 * Replaces text-only thinking display with a structured, collapsible view.
 */

import { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  ChevronDown,
  ChevronRight,
  Wrench,
  Globe,
  FileText,
  Terminal,
  Search,
  Database,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// =============================================================================
// Types
// =============================================================================

export type ToolCallStatus = 'pending' | 'running' | 'completed' | 'failed' | 'retried';

export interface ToolCallEvent {
  id: string;
  toolName: string;
  status: ToolCallStatus;
  startedAt: number;
  completedAt?: number;
  retryCount?: number;
  error?: string;
}

export interface ToolTimelineProps {
  toolCalls: ToolCallEvent[];
  isExecuting: boolean;
  className?: string;
}

// =============================================================================
// Tool category -> icon mapping
// =============================================================================

function getToolIcon(toolName: string): typeof Wrench {
  const name = toolName.toLowerCase();
  if (name.includes('search') || name.includes('find')) return Search;
  if (name.includes('web') || name.includes('http') || name.includes('fetch')) return Globe;
  if (name.includes('file') || name.includes('read') || name.includes('write')) return FileText;
  if (name.includes('run') || name.includes('exec') || name.includes('bash')) return Terminal;
  if (name.includes('db') || name.includes('query') || name.includes('sql')) return Database;
  return Wrench;
}

function formatDuration(startedAt: number, completedAt?: number): string {
  const endMs = completedAt ?? Date.now();
  const ms = endMs - startedAt;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// =============================================================================
// Sub-components
// =============================================================================

function StatusDot({ status }: { status: ToolCallStatus }) {
  if (status === 'running') {
    return (
      <span className="relative flex h-3 w-3 shrink-0 mt-0.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-60" />
        <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
      </span>
    );
  }
  if (status === 'completed') {
    return <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0 mt-0.5" />;
  }
  if (status === 'failed') {
    return <XCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />;
  }
  if (status === 'retried') {
    return <XCircle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />;
  }
  // pending
  return <span className="h-3 w-3 rounded-full border-2 border-muted-foreground/40 shrink-0 mt-0.5" />;
}

function ToolCallRow({ call, isLast }: { call: ToolCallEvent; isLast: boolean }) {
  const Icon = getToolIcon(call.toolName);
  const isRunning = call.status === 'running';
  const isFailed = call.status === 'failed';

  return (
    <li className="relative flex gap-3 pb-3 last:pb-0">
      {/* Vertical connector line */}
      {!isLast && (
        <span
          className="absolute left-[5px] top-4 bottom-0 w-px bg-border/40"
          aria-hidden="true"
        />
      )}

      {/* Status dot */}
      <StatusDot status={call.status} />

      {/* Content */}
      <div className="flex-1 min-w-0 -mt-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span
            className={cn(
              'text-xs font-mono truncate',
              isFailed && 'text-destructive',
              isRunning && 'text-foreground font-medium'
            )}
          >
            {call.toolName}
          </span>

          {/* Duration */}
          <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
            <Clock className="h-3 w-3" />
            {formatDuration(call.startedAt, call.completedAt)}
          </span>

          {/* Retry badge */}
          {call.retryCount !== undefined && call.retryCount > 0 && (
            <Badge
              variant="outline"
              className="h-4 px-1.5 text-[10px] border-amber-500/30 text-amber-500 bg-amber-500/10"
            >
              retry {call.retryCount}
            </Badge>
          )}
        </div>

        {/* Error message */}
        {isFailed && call.error && (
          <p className="mt-0.5 text-xs text-destructive/80 truncate">{call.error}</p>
        )}
      </div>
    </li>
  );
}

// =============================================================================
// Component
// =============================================================================

export function ToolTimeline({ toolCalls, isExecuting, className }: ToolTimelineProps) {
  const [expanded, setExpanded] = useState(false);

  if (toolCalls.length === 0 && !isExecuting) {
    return null;
  }

  const completedCount = toolCalls.filter((t) => t.status === 'completed').length;
  const failedCount = toolCalls.filter((t) => t.status === 'failed').length;
  const runningCall = toolCalls.find((t) => t.status === 'running');

  return (
    <div
      className={cn(
        'rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm overflow-hidden',
        isExecuting && 'ring-1 ring-blue-500/20',
        className
      )}
    >
      {/* Header / toggle */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/20 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}

        {isExecuting ? (
          <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin shrink-0" />
        ) : failedCount > 0 ? (
          <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />
        )}

        <span className="text-xs font-medium flex-1 truncate">
          {isExecuting && runningCall
            ? `Running ${runningCall.toolName}...`
            : isExecuting
              ? 'Executing tools...'
              : `${toolCalls.length} tool call${toolCalls.length !== 1 ? 's' : ''}`}
        </span>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
          {completedCount > 0 && (
            <span className="text-green-500">{completedCount} done</span>
          )}
          {failedCount > 0 && (
            <span className="text-destructive">{failedCount} failed</span>
          )}
        </div>
      </button>

      {/* Timeline */}
      {expanded && toolCalls.length > 0 && (
        <div className="border-t border-border/30 px-3 pt-3 pb-2">
          <ul className="space-y-0">
            {toolCalls.map((call, idx) => (
              <ToolCallRow key={call.id} call={call} isLast={idx === toolCalls.length - 1} />
            ))}
          </ul>
        </div>
      )}

      {/* Empty executing state */}
      {expanded && toolCalls.length === 0 && isExecuting && (
        <div className="border-t border-border/30 px-3 py-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Waiting for tool calls...</span>
          </div>
        </div>
      )}

      {/* Collapse button when expanded */}
      {expanded && (
        <div className="px-3 pb-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground"
            onClick={() => setExpanded(false)}
          >
            Collapse
          </Button>
        </div>
      )}
    </div>
  );
}
