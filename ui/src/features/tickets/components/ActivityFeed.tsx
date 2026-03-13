/**
 * Activity Feed Component
 *
 * Displays a timeline of ticket changes including status updates,
 * field changes, comments, and AI responses.
 *
 * Inspired by Plane's issue activity implementation.
 */

import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import {
  ArrowRight,
  Bot,
  Tag,
  AlertCircle,
  CheckCircle2,
  Circle,
  Clock,
  Pencil,
  UserPlus,
  Calendar,
  Loader2,
  Plus,
  History,
} from 'lucide-react';
import { api } from '@/core/api/client';
import type { TicketHistoryEntry, TicketComment } from '@/core/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

interface ActivityFeedProps {
  ticketId: string;
  comments?: TicketComment[];
  className?: string;
  maxItems?: number;
  showHeader?: boolean;
}

// Field-specific icons
const FIELD_ICONS: Record<string, typeof CheckCircle2> = {
  status: Circle,
  priority: AlertCircle,
  assignee: UserPlus,
  assigneeAgent: Bot,
  labels: Tag,
  title: Pencil,
  description: Pencil,
  dueDate: Calendar,
  type: Tag,
  created: Plus,
};

// Status-specific colors
const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  backlog: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-400' },
  todo: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-400' },
  in_progress: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-400' },
  in_review: { bg: 'bg-indigo-100 dark:bg-indigo-900/30', text: 'text-indigo-600 dark:text-indigo-400' },
  done: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-600 dark:text-green-400' },
  cancelled: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-500' },
};

// Priority colors
const PRIORITY_COLORS: Record<string, string> = {
  critical: 'text-red-500',
  high: 'text-orange-500',
  medium: 'text-yellow-500',
  low: 'text-blue-500',
  none: 'text-gray-400',
};

interface ActivityItem {
  id: string;
  type: 'history' | 'comment';
  timestamp: string;
  data: TicketHistoryEntry | TicketComment;
}

function formatFieldName(field: string): string {
  const fieldNames: Record<string, string> = {
    status: 'status',
    priority: 'priority',
    assignee: 'assignee',
    assigneeAgent: 'AI agent',
    labels: 'labels',
    title: 'title',
    description: 'description',
    dueDate: 'due date',
    type: 'type',
    created: 'ticket',
  };
  return fieldNames[field] || field;
}

function formatValue(field: string, value: string | undefined): string {
  if (!value) return 'none';

  // Format status values
  if (field === 'status') {
    return value.replace(/_/g, ' ');
  }

  // Format priority values
  if (field === 'priority') {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  // Truncate long values
  if (value.length > 50) {
    return value.substring(0, 50) + '...';
  }

  return value;
}

function HistoryItem({ entry }: { entry: TicketHistoryEntry }) {
  const Icon = FIELD_ICONS[entry.field] || History;
  const isCreated = entry.field === 'created';
  const isStatusChange = entry.field === 'status';
  const isPriorityChange = entry.field === 'priority';

  return (
    <div className="flex gap-3 py-3">
      {/* Avatar / Icon */}
      <div className="flex-shrink-0">
        <div className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center',
          entry.changedBy.type === 'ai' ? 'bg-primary/10' : 'bg-muted'
        )}>
          {entry.changedBy.type === 'ai' ? (
            <Bot className="h-4 w-4 text-primary" />
          ) : (
            <Icon className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">
            {entry.changedBy.name}
          </span>

          {isCreated ? (
            <span className="text-sm text-muted-foreground">
              created this ticket
            </span>
          ) : (
            <>
              <span className="text-sm text-muted-foreground">
                changed {formatFieldName(entry.field)}
              </span>

              {/* Show value changes */}
              {entry.oldValue && (
                <>
                  <span className="text-sm text-muted-foreground">from</span>
                  {isStatusChange ? (
                    <Badge variant="outline" className={cn(
                      'text-xs',
                      STATUS_COLORS[entry.oldValue]?.text || ''
                    )}>
                      {formatValue(entry.field, entry.oldValue)}
                    </Badge>
                  ) : isPriorityChange ? (
                    <span className={cn('text-sm font-medium', PRIORITY_COLORS[entry.oldValue] || '')}>
                      {formatValue(entry.field, entry.oldValue)}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground line-through">
                      {formatValue(entry.field, entry.oldValue)}
                    </span>
                  )}
                </>
              )}

              <ArrowRight className="h-3 w-3 text-muted-foreground" />

              {isStatusChange ? (
                <Badge variant="outline" className={cn(
                  'text-xs',
                  STATUS_COLORS[entry.newValue]?.text || ''
                )}>
                  {formatValue(entry.field, entry.newValue)}
                </Badge>
              ) : isPriorityChange ? (
                <span className={cn('text-sm font-medium', PRIORITY_COLORS[entry.newValue] || '')}>
                  {formatValue(entry.field, entry.newValue)}
                </span>
              ) : (
                <span className="text-sm font-medium">
                  {formatValue(entry.field, entry.newValue)}
                </span>
              )}
            </>
          )}
        </div>

        <p className="text-xs text-muted-foreground mt-1">
          {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
        </p>
      </div>
    </div>
  );
}

function CommentItem({ comment }: { comment: TicketComment }) {
  const isAI = comment.author.type === 'ai';

  return (
    <div className="flex gap-3 py-3">
      {/* Avatar */}
      <div className="flex-shrink-0">
        <div className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium',
          isAI ? 'bg-primary/10 text-primary' : 'bg-muted'
        )}>
          {isAI ? (
            <Bot className="h-4 w-4" />
          ) : (
            comment.author.name.charAt(0).toUpperCase()
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">
            {comment.author.name}
          </span>
          {isAI && (
            <Badge variant="secondary" className="text-xs">
              AI
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            commented
          </span>
        </div>

        <div className="mt-2 text-sm text-foreground/90 bg-muted/30 rounded-lg p-3 border border-border/50">
          {/* Simple text preview - full content in modal */}
          {comment.content.length > 200
            ? comment.content.substring(0, 200) + '...'
            : comment.content
          }
        </div>

        <p className="text-xs text-muted-foreground mt-2">
          {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
        </p>
      </div>
    </div>
  );
}

export function ActivityFeed({
  ticketId,
  comments = [],
  className,
  maxItems = 20,
  showHeader = true,
}: ActivityFeedProps) {
  // Fetch history
  const { data: historyData, isLoading, error } = useQuery({
    queryKey: ['tickets', ticketId, 'history'],
    queryFn: () => api.tickets.getHistory(ticketId),
    enabled: !!ticketId,
  });

  // Combine and sort history + comments
  const activities: ActivityItem[] = [];

  // Add history entries
  if (historyData?.history) {
    historyData.history.forEach((entry) => {
      activities.push({
        id: `history-${entry.id}`,
        type: 'history',
        timestamp: entry.timestamp,
        data: entry,
      });
    });
  }

  // Add comments
  comments.forEach((comment) => {
    activities.push({
      id: `comment-${comment.id}`,
      type: 'comment',
      timestamp: comment.createdAt,
      data: comment,
    });
  });

  // Sort by timestamp descending (newest first)
  activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Limit items
  const displayedActivities = activities.slice(0, maxItems);

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-8', className)}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('flex items-center justify-center py-8 text-destructive', className)}>
        <AlertCircle className="h-5 w-5 mr-2" />
        <span className="text-sm">Failed to load activity</span>
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-8 text-muted-foreground', className)}>
        <History className="h-8 w-8 mb-2 opacity-50" />
        <span className="text-sm">No activity yet</span>
      </div>
    );
  }

  return (
    <div className={className}>
      {showHeader && (
        <div className="flex items-center gap-2 mb-4">
          <History className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-medium text-sm">Activity</h3>
          <Badge variant="secondary" className="text-xs">
            {activities.length}
          </Badge>
        </div>
      )}

      <div className="divide-y divide-border/50">
        {displayedActivities.map((activity) => (
          activity.type === 'history' ? (
            <HistoryItem key={activity.id} entry={activity.data as TicketHistoryEntry} />
          ) : (
            <CommentItem key={activity.id} comment={activity.data as TicketComment} />
          )
        ))}
      </div>

      {activities.length > maxItems && (
        <div className="pt-3 text-center">
          <button className="text-sm text-primary hover:underline">
            Show {activities.length - maxItems} more activities
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Compact activity summary for cards/lists
 */
export function ActivitySummary({
  ticketId,
  limit = 3,
}: {
  ticketId: string;
  limit?: number;
}) {
  const { data: historyData } = useQuery({
    queryKey: ['tickets', ticketId, 'history'],
    queryFn: () => api.tickets.getHistory(ticketId),
    enabled: !!ticketId,
  });

  if (!historyData?.history?.length) {
    return null;
  }

  const recentHistory = historyData.history.slice(0, limit);

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <Clock className="h-3 w-3" />
      <span>
        Last updated {formatDistanceToNow(new Date(recentHistory[0].timestamp), { addSuffix: true })}
      </span>
    </div>
  );
}
