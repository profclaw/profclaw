/**
 * Ticket Mini Card
 *
 * Compact ticket card for embedding in ToolCallCard results.
 * Shows priority color bar, type icon, key + title, status badge, and labels.
 */

import {
  Bug,
  Lightbulb,
  Wrench,
  ListTodo,
  Zap,
  BookOpen,
  CircleDot,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface TicketMiniCardProps {
  ticketKey: string;
  title: string;
  status: string;
  type: string;
  priority: string;
  labels?: string[];
  url?: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-500",
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-blue-400",
  none: "bg-muted-foreground/30",
};

const TYPE_ICONS: Record<string, typeof Bug> = {
  bug: Bug,
  feature: Lightbulb,
  improvement: Wrench,
  task: ListTodo,
  epic: Zap,
  story: BookOpen,
  subtask: CircleDot,
};

const STATUS_STYLES: Record<string, string> = {
  backlog: "bg-muted-foreground/10 text-muted-foreground",
  todo: "bg-blue-500/10 text-blue-400",
  in_progress: "bg-primary/10 text-primary",
  in_review: "bg-purple-500/10 text-purple-400",
  done: "bg-green-500/10 text-green-400",
  cancelled: "bg-red-500/10 text-red-400",
};

function formatStatus(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function TicketMiniCard({
  ticketKey,
  title,
  status,
  type,
  priority,
  labels,
  url,
}: TicketMiniCardProps) {
  const TypeIcon = TYPE_ICONS[type] || ListTodo;
  const priorityColor = PRIORITY_COLORS[priority] || PRIORITY_COLORS.none;
  const statusStyle = STATUS_STYLES[status] || STATUS_STYLES.backlog;

  const content = (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-xl recessed-card overflow-hidden relative group/ticket">
      {/* Priority color bar */}
      <div
        className={cn("absolute left-0 top-0 bottom-0 w-1 rounded-l-xl", priorityColor)}
      />

      {/* Type icon */}
      <div className="h-8 w-8 flex items-center justify-center rounded-lg bg-foreground/5 shrink-0 ml-1">
        <TypeIcon className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* Key + Title */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-primary/70 shrink-0">
            {ticketKey}
          </span>
          <span className="text-[13px] font-medium truncate">{title}</span>
        </div>
        {/* Labels */}
        {labels && labels.length > 0 && (
          <div className="flex items-center gap-1 mt-0.5">
            {labels.slice(0, 3).map((label) => (
              <span
                key={label}
                className="text-[9px] px-1.5 py-0.5 rounded-full bg-foreground/5 text-muted-foreground/70 font-medium"
              >
                {label}
              </span>
            ))}
            {labels.length > 3 && (
              <span className="text-[9px] text-muted-foreground/50">
                +{labels.length - 3}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Status badge */}
      <span
        className={cn(
          "text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md shrink-0",
          statusStyle,
        )}
      >
        {formatStatus(status)}
      </span>
    </div>
  );

  if (url) {
    return (
      <a
        href={url}
        className="block hover:opacity-90 transition-opacity"
        target="_blank"
        rel="noopener noreferrer"
      >
        {content}
      </a>
    );
  }

  return content;
}

export default TicketMiniCard;
