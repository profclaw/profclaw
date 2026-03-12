import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import {
  Bug,
  Sparkles,
  Layers,
  BookOpen,
  Circle,
  CheckCircle2,
  Bot,
  GripVertical,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TicketType, TicketPriority } from '@/core/api/client';

interface Ticket {
  id: string;
  sequence: number;
  title: string;
  description?: string;
  type: TicketType;
  priority: TicketPriority;
  status: string;
  labels: string[];
  assignee?: string;
  assigneeAgent?: string;
  createdBy: 'human' | 'ai';
  projectKey?: string;
}

interface BoardCardProps {
  ticket: Ticket;
  isDragging?: boolean;
}

const typeConfig: Record<TicketType, { icon: typeof Bug; color: string }> = {
  task: { icon: CheckCircle2, color: 'text-blue-400' },
  bug: { icon: Bug, color: 'text-red-400' },
  feature: { icon: Sparkles, color: 'text-cyan-400' },
  epic: { icon: Layers, color: 'text-orange-400' },
  story: { icon: BookOpen, color: 'text-green-400' },
  subtask: { icon: Circle, color: 'text-gray-400' },
  enhancement: { icon: Sparkles, color: 'text-indigo-400' },
  documentation: { icon: BookOpen, color: 'text-cyan-400' },
};

const priorityColors: Record<TicketPriority, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-500',
  none: 'bg-gray-400',
};

export function BoardCard({ ticket, isDragging: externalIsDragging }: BoardCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    return draggable({
      element: el,
      getInitialData: () => ({ ticketId: ticket.id, status: ticket.status }),
      onDragStart: () => setIsDragging(true),
      onDrop: () => setIsDragging(false),
    });
  }, [ticket.id, ticket.status]);

  const TypeIcon = typeConfig[ticket.type]?.icon || Circle;
  const typeColor = typeConfig[ticket.type]?.color || 'text-gray-400';
  const projectKey = ticket.projectKey || 'PROFCLAW';

  return (
    <div
      ref={ref}
      className={cn(
        'group relative rounded-xl bg-[var(--card)] border border-[var(--border)] p-3 cursor-grab active:cursor-grabbing transition-all duration-200',
        (isDragging || externalIsDragging) && 'opacity-50 scale-95 rotate-2',
        'hover:border-[var(--primary)]/30 hover:shadow-lg hover:shadow-[var(--primary)]/5'
      )}
    >
      {/* Drag Handle */}
      <div className="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-50 transition-opacity">
        <GripVertical className="h-4 w-4 text-[var(--muted-foreground)]" />
      </div>

      {/* Priority Indicator */}
      <div
        className={cn('absolute top-0 left-3 w-6 h-1 rounded-b-full', priorityColors[ticket.priority])}
        title={ticket.priority}
      />

      <Link to={`/tickets/${ticket.id}`} className="block space-y-2">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <span className="text-[10px] font-mono text-[var(--muted-foreground)]">
            {projectKey}-{ticket.sequence}
          </span>
          <TypeIcon className={cn('h-3.5 w-3.5 shrink-0', typeColor)} />
        </div>

        {/* Title */}
        <h4 className="text-sm font-medium leading-tight line-clamp-2 group-hover:text-[var(--primary)] transition-colors">
          {ticket.title}
        </h4>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-1.5">
            {ticket.assigneeAgent && (
              <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-[var(--primary)]/80 px-1.5 py-0.5 rounded bg-[var(--primary)]/10">
                <Bot className="h-2.5 w-2.5" />
                {ticket.assigneeAgent}
              </span>
            )}
            {ticket.labels.slice(0, 1).map((label) => (
              <span
                key={label}
                className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--muted)]/50 text-[var(--muted-foreground)] truncate max-w-[60px]"
              >
                {label}
              </span>
            ))}
          </div>
          {ticket.createdBy === 'ai' && (
            <span className="text-[8px] font-bold uppercase tracking-wider text-blue-400">
              AI
            </span>
          )}
        </div>
      </Link>
    </div>
  );
}
