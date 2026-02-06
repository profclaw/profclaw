/**
 * Sprint Board - Enhanced Kanban View
 *
 * Professional drag-and-drop board with:
 * - Better card design with labels, priority, due dates
 * - Taller columns that fill viewport
 * - Search and filter functionality
 * - Side panel for ticket preview (like Jira/Linear)
 * - Column collapse/expand
 * - WIP limits visualization
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import {
  Loader2,
  Circle,
  Clock,
  PlayCircle,
  Eye,
  CheckCircle2,
  User,
  Search,
  X,
  ChevronRight,
  ChevronDown,
  Calendar,
  MoreHorizontal,
  ExternalLink,
  Bug,
  Sparkles,
  Layers,
  BookOpen,
  ListTodo,
  Zap,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { api } from '@/core/api/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import type { Ticket, TicketStatus, TicketPriority, TicketType } from '@/core/types';

interface SprintBoardProps {
  projectId: string;
  sprintId?: string;
}

// Column configuration with WIP limits
interface ColumnConfig {
  id: TicketStatus;
  label: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  wipLimit?: number;
}

const COLUMNS: ColumnConfig[] = [
  {
    id: 'backlog',
    label: 'Backlog',
    icon: <Circle className="h-4 w-4" />,
    color: 'text-gray-400',
    bgColor: 'bg-gray-500/10',
  },
  {
    id: 'todo',
    label: 'Todo',
    icon: <Clock className="h-4 w-4" />,
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    wipLimit: 10,
  },
  {
    id: 'in_progress',
    label: 'In Progress',
    icon: <PlayCircle className="h-4 w-4" />,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    wipLimit: 5,
  },
  {
    id: 'in_review',
    label: 'In Review',
    icon: <Eye className="h-4 w-4" />,
    color: 'text-indigo-500',
    bgColor: 'bg-indigo-500/10',
    wipLimit: 3,
  },
  {
    id: 'done',
    label: 'Done',
    icon: <CheckCircle2 className="h-4 w-4" />,
    color: 'text-green-500',
    bgColor: 'bg-green-500/10',
  },
];

const PRIORITY_CONFIG: Record<TicketPriority, { color: string; bgColor: string; label: string }> = {
  urgent: { color: 'text-red-500', bgColor: 'bg-red-500', label: 'Urgent' },
  high: { color: 'text-orange-400', bgColor: 'bg-orange-400', label: 'High' },
  medium: { color: 'text-yellow-400', bgColor: 'bg-yellow-400', label: 'Medium' },
  low: { color: 'text-blue-400', bgColor: 'bg-blue-400', label: 'Low' },
  none: { color: 'text-gray-400', bgColor: 'bg-gray-400', label: 'None' },
};

const TYPE_CONFIG: Record<TicketType, { icon: React.ReactNode; color: string }> = {
  task: { icon: <ListTodo className="h-3 w-3" />, color: 'text-blue-400' },
  bug: { icon: <Bug className="h-3 w-3" />, color: 'text-red-400' },
  feature: { icon: <Sparkles className="h-3 w-3" />, color: 'text-green-400' },
  enhancement: { icon: <Zap className="h-3 w-3" />, color: 'text-indigo-400' },
  documentation: { icon: <FileText className="h-3 w-3" />, color: 'text-teal-400' },
  epic: { icon: <Layers className="h-3 w-3" />, color: 'text-amber-400' },
  story: { icon: <BookOpen className="h-3 w-3" />, color: 'text-cyan-400' },
  subtask: { icon: <ListTodo className="h-3 w-3" />, color: 'text-gray-400' },
};

// Enhanced Ticket Card Component
function TicketCard({
  ticket,
  onOpenPreview,
}: {
  ticket: Ticket;
  onOpenPreview: (ticket: Ticket) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [wasDragged, setWasDragged] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    return draggable({
      element,
      getInitialData: () => ({ ticketId: ticket.id, currentStatus: ticket.status }),
      onDragStart: () => {
        setDragging(true);
        setWasDragged(true);
      },
      onDrop: () => setDragging(false),
    });
  }, [ticket.id, ticket.status]);

  const handleClick = (e: React.MouseEvent) => {
    // Don't open preview if we just finished dragging
    if (wasDragged) {
      setWasDragged(false);
      return;
    }
    // Don't open if clicking a link inside the card
    if ((e.target as HTMLElement).closest('a')) {
      return;
    }
    onOpenPreview(ticket);
  };

  const typeConfig = TYPE_CONFIG[ticket.type] || TYPE_CONFIG.task;
  const priorityConfig = PRIORITY_CONFIG[ticket.priority] || PRIORITY_CONFIG.medium;

  return (
    <div
      ref={ref}
      className={cn(
        'group glass rounded-xl p-3 cursor-grab active:cursor-grabbing',
        'hover:shadow-lg hover:shadow-primary/5 transition-all duration-200',
        dragging && 'opacity-40 scale-[1.02] shadow-xl rotate-1'
      )}
      onClick={handleClick}
    >
      {/* Priority indicator bar */}
      <div className={cn('h-1 w-8 rounded-full mb-2', priorityConfig.bgColor)} />

      <div className="flex-1 min-w-0">
          {/* Header: ID + Type + Priority */}
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[11px] font-mono text-muted-foreground font-medium">
              {ticket.projectKey || 'PROFCLAW'}-{ticket.sequence}
            </span>
            <span className={cn('flex items-center gap-1', typeConfig.color)}>
              {typeConfig.icon}
            </span>
            {ticket.priority !== 'none' && ticket.priority !== 'medium' && (
              <span className={cn('text-[10px]', priorityConfig.color)}>
                {priorityConfig.label}
              </span>
            )}
          </div>

          {/* Title */}
          <h4 className="text-sm font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors">
            {ticket.title}
          </h4>

          {/* Labels */}
          {ticket.labels && ticket.labels.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {ticket.labels.slice(0, 3).map((label) => (
                <span
                  key={label}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary"
                >
                  {label}
                </span>
              ))}
              {ticket.labels.length > 3 && (
                <span className="text-[10px] text-muted-foreground">
                  +{ticket.labels.length - 3}
                </span>
              )}
            </div>
          )}

          {/* Footer: Assignee + Due Date + Story Points */}
          <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-border/50">
            <div className="flex items-center gap-2">
              {ticket.assignee ? (
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-primary text-[10px] font-medium">
                    {ticket.assignee.charAt(0).toUpperCase()}
                  </div>
                </div>
              ) : (
                <div className="w-5 h-5 rounded-full border border-dashed border-muted-foreground/30 flex items-center justify-center">
                  <User className="h-3 w-3 text-muted-foreground/50" />
                </div>
              )}

              {ticket.dueDate && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  {format(new Date(ticket.dueDate), 'MMM d')}
                </span>
              )}
            </div>

            {ticket.estimate && (
              <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {ticket.estimate}pt
              </span>
            )}
          </div>
        </div>
    </div>
  );
}

// Column Component with collapse support
function BoardColumn({
  column,
  tickets,
  onDrop,
  onOpenPreview,
  isCollapsed,
  onToggleCollapse,
  onSetWipLimit,
}: {
  column: ColumnConfig;
  tickets: Ticket[];
  onDrop: (ticketId: string, newStatus: TicketStatus) => void;
  onOpenPreview: (ticket: Ticket) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onSetWipLimit?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [isOver, setIsOver] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    return combine(
      dropTargetForElements({
        element,
        getData: () => ({ status: column.id }),
        canDrop: ({ source }) => source.data.currentStatus !== column.id,
        onDragEnter: () => setIsOver(true),
        onDragLeave: () => setIsOver(false),
        onDrop: ({ source }) => {
          setIsOver(false);
          const ticketId = source.data.ticketId as string;
          onDrop(ticketId, column.id);
        },
      })
    );
  }, [column.id, onDrop]);

  const isOverWipLimit = column.wipLimit && tickets.length > column.wipLimit;
  const isAtWipLimit = column.wipLimit && tickets.length === column.wipLimit;

  if (isCollapsed) {
    return (
      <div
        ref={ref}
        className={cn(
          'flex flex-col items-center w-12 rounded-xl p-2 cursor-pointer transition-all',
          column.bgColor,
          isOver && 'ring-2 ring-primary bg-primary/10'
        )}
        onClick={onToggleCollapse}
      >
        <button className="p-1 hover:bg-background/50 rounded mb-2">
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
        <div className="writing-mode-vertical text-sm font-medium text-muted-foreground rotate-180">
          {column.label}
        </div>
        <span className={cn(
          'mt-2 text-xs font-medium px-2 py-1 rounded-full',
          column.bgColor,
          column.color
        )}>
          {tickets.length}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-[280px] sm:w-[300px] md:w-[320px] shrink-0">
      {/* Column Header */}
      <div className={cn(
        'flex items-center justify-between mb-3 px-2 py-2 rounded-lg',
        column.bgColor
      )}>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleCollapse}
            className="p-0.5 hover:bg-background/30 rounded transition-colors"
          >
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </button>
          <span className={column.color}>{column.icon}</span>
          <h3 className="font-semibold text-sm">{column.label}</h3>
          <span className={cn(
            'text-xs font-medium px-2 py-0.5 rounded-full',
            isOverWipLimit ? 'bg-red-500/20 text-red-400' :
            isAtWipLimit ? 'bg-amber-500/20 text-amber-400' :
            'bg-background/50 text-muted-foreground'
          )}>
            {tickets.length}
            {column.wipLimit && `/${column.wipLimit}`}
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onToggleCollapse}>
              Collapse column
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSetWipLimit}>
              Set WIP limit...
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Column Content - Scrollable */}
      <div
        ref={ref}
        className={cn(
          'flex-1 rounded-xl p-2 transition-all duration-200 overflow-y-auto',
          'bg-muted/20 border-2 border-transparent',
          'min-h-[300px] sm:min-h-[400px] md:min-h-[calc(100vh-380px)]',
          'max-h-[400px] sm:max-h-[500px] md:max-h-[calc(100vh-380px)]',
          isOver && 'border-primary/50 bg-primary/5 scale-[1.01]',
          isOverWipLimit && 'border-red-500/30'
        )}
        style={{ scrollbarGutter: 'stable' }}
      >
        <div className="space-y-2">
          {tickets.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              onOpenPreview={onOpenPreview}
            />
          ))}
          {tickets.length === 0 && (
            <div className={cn(
              'flex flex-col items-center justify-center py-12 text-center',
              'border-2 border-dashed border-muted-foreground/20 rounded-lg'
            )}>
              <div className={cn('p-3 rounded-full mb-2', column.bgColor)}>
                {column.icon}
              </div>
              <p className="text-xs text-muted-foreground">
                Drop tickets here
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Ticket Preview Panel (Side Sheet)
function TicketPreview({
  ticket,
  open,
  onClose,
}: {
  ticket: Ticket | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!ticket) return null;

  const typeConfig = TYPE_CONFIG[ticket.type] || TYPE_CONFIG.task;
  const priorityConfig = PRIORITY_CONFIG[ticket.priority] || PRIORITY_CONFIG.medium;

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-[450px] sm:w-[540px] overflow-y-auto">
        <SheetHeader className="pb-4 border-b border-border">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className={cn('flex items-center gap-1', typeConfig.color)}>
              {typeConfig.icon}
              <span className="capitalize">{ticket.type}</span>
            </span>
            <span>•</span>
            <Link
              to={`/tickets/${ticket.id}`}
              className="font-mono hover:text-primary hover:underline transition-colors"
              onClick={onClose}
            >
              {ticket.projectKey || 'PROFCLAW'}-{ticket.sequence}
            </Link>
          </div>
          <SheetTitle className="text-xl">{ticket.title}</SheetTitle>
        </SheetHeader>

        <div className="py-6 space-y-6">
          {/* Status & Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Status
              </label>
              <div className="mt-1 flex items-center gap-2">
                {COLUMNS.find(c => c.id === ticket.status)?.icon}
                <span className="capitalize">{ticket.status.replace('_', ' ')}</span>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Priority
              </label>
              <div className={cn('mt-1 flex items-center gap-2', priorityConfig.color)}>
                <div className={cn('w-2 h-2 rounded-full', priorityConfig.bgColor)} />
                <span className="capitalize">{ticket.priority}</span>
              </div>
            </div>
          </div>

          {/* Assignee */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Assignee
            </label>
            <div className="mt-1 flex items-center gap-2">
              {ticket.assignee ? (
                <>
                  <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-medium">
                    {ticket.assignee.charAt(0).toUpperCase()}
                  </div>
                  <span>{ticket.assignee}</span>
                </>
              ) : (
                <span className="text-muted-foreground">Unassigned</span>
              )}
            </div>
          </div>

          {/* Labels */}
          {ticket.labels && ticket.labels.length > 0 && (
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Labels
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {ticket.labels.map((label) => (
                  <span
                    key={label}
                    className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Description
            </label>
            <div className="mt-2 text-sm text-muted-foreground prose prose-sm dark:prose-invert max-w-none">
              {ticket.description || <span className="italic">No description</span>}
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Created
              </label>
              <p className="mt-1 text-sm">
                {format(new Date(ticket.createdAt), 'MMM d, yyyy')}
              </p>
            </div>
            {ticket.dueDate && (
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Due Date
                </label>
                <p className="mt-1 text-sm">
                  {format(new Date(ticket.dueDate), 'MMM d, yyyy')}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="pt-4 border-t border-border flex items-center gap-2">
          <Link to={`/tickets/${ticket.id}`} className="flex-1">
            <Button variant="outline" className="w-full gap-2">
              <ExternalLink className="h-4 w-4" />
              Open Full View
            </Button>
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Helper to load/save WIP limits from localStorage
const WIP_LIMITS_KEY = 'profclaw-board-wip-limits';

type WipLimitsMap = Partial<Record<TicketStatus, number>>;

function loadWipLimits(): WipLimitsMap {
  try {
    const saved = localStorage.getItem(WIP_LIMITS_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function saveWipLimits(limits: WipLimitsMap) {
  localStorage.setItem(WIP_LIMITS_KEY, JSON.stringify(limits));
}

export function SprintBoard({ projectId, sprintId }: SprintBoardProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [collapsedColumns, setCollapsedColumns] = useState<Set<TicketStatus>>(new Set());
  const [previewTicket, setPreviewTicket] = useState<Ticket | null>(null);
  const [customWipLimits, setCustomWipLimits] = useState<WipLimitsMap>(loadWipLimits);

  // Merge default WIP limits with custom ones
  const getColumnWithWipLimit = useCallback((column: ColumnConfig): ColumnConfig => {
    const customLimit = customWipLimits[column.id];
    return customLimit !== undefined ? { ...column, wipLimit: customLimit } : column;
  }, [customWipLimits]);

  const handleSetWipLimit = useCallback((columnId: TicketStatus) => {
    const currentLimit = customWipLimits[columnId] ?? COLUMNS.find(c => c.id === columnId)?.wipLimit;
    const input = window.prompt(
      `Set WIP limit for "${columnId.replace('_', ' ')}" column:\n(Enter a number, or leave empty to remove limit)`,
      currentLimit?.toString() || ''
    );

    if (input === null) return; // User cancelled

    const newLimits = { ...customWipLimits };
    if (input === '') {
      delete newLimits[columnId];
    } else {
      const limit = parseInt(input, 10);
      if (!isNaN(limit) && limit > 0) {
        newLimits[columnId] = limit;
      } else {
        toast.error('Please enter a valid positive number');
        return;
      }
    }

    setCustomWipLimits(newLimits);
    saveWipLimits(newLimits);
    toast.success(input === '' ? 'WIP limit removed' : `WIP limit set to ${input}`);
  }, [customWipLimits]);

  // Fetch tickets
  const { data, isLoading } = useQuery({
    queryKey: ['tickets', 'board', projectId, sprintId],
    queryFn: () =>
      api.tickets.list({
        projectId,
        sprintId,
        limit: 200,
      }),
  });

  // Update ticket status mutation with optimistic updates
  const updateTicket = useMutation({
    mutationFn: ({ ticketId, status }: { ticketId: string; status: TicketStatus }) =>
      api.tickets.update(ticketId, { status }),
    onMutate: async ({ ticketId, status }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['tickets', 'board', projectId, sprintId] });

      // Snapshot previous value
      const previousData = queryClient.getQueryData(['tickets', 'board', projectId, sprintId]);

      // Optimistically update
      queryClient.setQueryData(['tickets', 'board', projectId, sprintId], (old: { tickets: Ticket[] } | undefined) => {
        if (!old?.tickets) return old;
        return {
          ...old,
          tickets: old.tickets.map((t: Ticket) =>
            t.id === ticketId ? { ...t, status } : t
          ),
        };
      });

      return { previousData };
    },
    onError: (_err, _, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(['tickets', 'board', projectId, sprintId], context.previousData);
      }
      toast.error('Failed to update ticket');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets', 'board', projectId, sprintId] });
    },
  });

  const handleDrop = useCallback((ticketId: string, newStatus: TicketStatus) => {
    updateTicket.mutate({ ticketId, status: newStatus });
    toast.success(`Moved to ${newStatus.replace('_', ' ')}`);
  }, [updateTicket]);

  const toggleColumnCollapse = (columnId: TicketStatus) => {
    setCollapsedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(columnId)) {
        next.delete(columnId);
      } else {
        next.add(columnId);
      }
      return next;
    });
  };

  const tickets = data?.tickets || [];

  // Filter tickets by search
  const filteredTickets = search
    ? tickets.filter(
        (t) =>
          t.title.toLowerCase().includes(search.toLowerCase()) ||
          t.description?.toLowerCase().includes(search.toLowerCase()) ||
          `${t.projectKey || 'PROFCLAW'}-${t.sequence}`.toLowerCase().includes(search.toLowerCase())
      )
    : tickets;

  // Group tickets by status
  const ticketsByStatus = COLUMNS.reduce(
    (acc, column) => {
      acc[column.id] = filteredTickets.filter((t) => t.status === column.id);
      return acc;
    },
    {} as Record<TicketStatus, Ticket[]>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search & Stats Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tickets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-9"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>{filteredTickets.length} tickets</span>
          {search && (
            <span className="text-primary">
              (filtered from {tickets.length})
            </span>
          )}
        </div>
      </div>

      {/* Board - horizontal scroll on mobile */}
      <div className="flex gap-3 sm:gap-4 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
        {COLUMNS.map((column) => (
          <BoardColumn
            key={column.id}
            column={getColumnWithWipLimit(column)}
            tickets={ticketsByStatus[column.id] || []}
            onDrop={handleDrop}
            onOpenPreview={setPreviewTicket}
            isCollapsed={collapsedColumns.has(column.id)}
            onToggleCollapse={() => toggleColumnCollapse(column.id)}
            onSetWipLimit={() => handleSetWipLimit(column.id)}
          />
        ))}
      </div>

      {/* Ticket Preview Panel */}
      <TicketPreview
        ticket={previewTicket}
        open={!!previewTicket}
        onClose={() => setPreviewTicket(null)}
      />
    </div>
  );
}
