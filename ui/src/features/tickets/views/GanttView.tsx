/**
 * Gantt Chart View
 *
 * A timeline view for tickets showing start dates, due dates, and progress.
 * Inspired by Plane's gantt-chart implementation.
 */

import { useState, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  Loader2,
  AlertCircle,
  GripVertical,
  FolderOpen,
  ChevronDown,
} from 'lucide-react';
import {
  addDays,
  startOfWeek,
  endOfWeek,
  format,
  differenceInDays,
  isWithinInterval,
  addWeeks,
  subWeeks,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  isToday,
  startOfQuarter,
  endOfQuarter,
  addQuarters,
  subQuarters,
} from 'date-fns';
import { api } from '@/core/api/client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { TicketDetailModal } from '../components/TicketDetailModal';

type ViewMode = 'week' | 'month' | 'quarter';

const STATUS_COLORS: Record<string, string> = {
  backlog: 'bg-gray-400',
  unstarted: 'bg-blue-400',
  started: 'bg-amber-400',
  completed: 'bg-green-400',
  cancelled: 'bg-gray-500',
  todo: 'bg-blue-400',
  in_progress: 'bg-amber-400',
  in_review: 'bg-indigo-400',
  done: 'bg-green-400',
};

const PRIORITY_BORDER: Record<string, string> = {
  urgent: 'border-l-red-500',
  high: 'border-l-orange-500',
  medium: 'border-l-yellow-500',
  low: 'border-l-blue-500',
  none: 'border-l-gray-400',
};

interface GanttTicket {
  id: string;
  sequence: number;
  title: string;
  status: string;
  priority: string;
  type: string;
  assignee?: string;
  dueDate?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  project?: {
    id: string;
    key: string;
    name: string;
  };
}

export function GanttView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  // Project filter
  const projectId = searchParams.get('project') || '';

  // Fetch tickets with dates
  const { data: ticketsData, isLoading, error } = useQuery({
    queryKey: ['tickets', 'gantt', projectId],
    queryFn: () => api.tickets.list({
      limit: 500, // Get more tickets for timeline view
      projectId: projectId || undefined,
    }),
  });

  // Fetch projects for filter
  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.projects.list(),
  });

  const tickets = useMemo(() => {
    if (!ticketsData?.tickets) return [];
    return ticketsData.tickets.filter(
      (t: GanttTicket) => t.dueDate || t.createdAt
    );
  }, [ticketsData]);

  // Calculate date range based on view mode
  // Calculate date range based on view mode
  const dateRange = useMemo(() => {
    let start: Date;
    let end: Date;

    if (viewMode === 'week') {
      start = startOfWeek(currentDate, { weekStartsOn: 1 });
      end = endOfWeek(currentDate, { weekStartsOn: 1 });
    } else if (viewMode === 'month') {
      start = startOfMonth(currentDate);
      end = endOfMonth(currentDate);
    } else {
      // Quarter
      start = startOfQuarter(currentDate);
      end = endOfQuarter(currentDate);
    }

    // specific handling for performance optimization on large ranges
    const days = eachDayOfInterval({ start, end });
    return { start, end, days };
  }, [viewMode, currentDate]);

  // Navigation
  const navigatePrev = () => {
    if (viewMode === 'week') {
      setCurrentDate(subWeeks(currentDate, 1));
    } else if (viewMode === 'month') {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    } else {
      setCurrentDate(subQuarters(currentDate, 1));
    }
  };

  const navigateNext = () => {
    if (viewMode === 'week') {
      setCurrentDate(addWeeks(currentDate, 1));
    } else if (viewMode === 'month') {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    } else {
      setCurrentDate(addQuarters(currentDate, 1));
    }
  };

  const navigateToday = () => {
    setCurrentDate(new Date());
  };

  // Calculate bar position for a ticket
  const getTicketBar = (ticket: GanttTicket) => {
    const startDate = ticket.startedAt ? new Date(ticket.startedAt) : new Date(ticket.createdAt);
    const endDate = ticket.dueDate ? new Date(ticket.dueDate) : addDays(startDate, 3);

    const rangeStart = dateRange.start;
    const rangeEnd = dateRange.end;
    const totalDays = differenceInDays(rangeEnd, rangeStart) + 1;

    // Calculate offset from range start
    let offsetDays = differenceInDays(startDate, rangeStart);
    let durationDays = differenceInDays(endDate, startDate) + 1;

    // Clamp to visible range
    if (offsetDays < 0) {
      durationDays += offsetDays;
      offsetDays = 0;
    }
    if (offsetDays + durationDays > totalDays) {
      durationDays = totalDays - offsetDays;
    }

    // Skip if completely outside range
    if (offsetDays >= totalDays || durationDays <= 0) {
      return null;
    }

    const left = (offsetDays / totalDays) * 100;
    const width = Math.max((durationDays / totalDays) * 100, 2); // Minimum 2% width

    return { left, width, startDate, endDate };
  };

  // Handle project filter change
  const handleProjectChange = (newProjectId: string) => {
    const params = new URLSearchParams(searchParams);
    if (newProjectId) {
      params.set('project', newProjectId);
    } else {
      params.delete('project');
    }
    setSearchParams(params);
  };

  const selectedProject = projectsData?.projects?.find((p: any) => p.id === projectId);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-lg text-muted-foreground">Failed to load tickets</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">Timeline</h1>

          {/* Project Filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <FolderOpen className="h-4 w-4" />
                {selectedProject?.name || 'All Projects'}
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem onClick={() => handleProjectChange('')}>
                All Projects
              </DropdownMenuItem>
              {projectsData?.projects?.map((project: any) => (
                <DropdownMenuItem
                  key={project.id}
                  onClick={() => handleProjectChange(project.id)}
                >
                  <span className="mr-2">{project.icon || '📁'}</span>
                  {project.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/50">
            <Button
              variant={viewMode === 'week' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('week')}
            >
              Week
            </Button>
            <Button
              variant={viewMode === 'month' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('month')}
            >
              Month
            </Button>
            <Button
              variant={viewMode === 'quarter' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('quarter')}
            >
              Quarter
            </Button>
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={navigatePrev}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={navigateToday}>
              Today
            </Button>
            <Button variant="ghost" size="icon" onClick={navigateNext}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Date Header Row */}
      <div className="flex border-b border-border bg-muted/30">
        {/* Ticket Info Column */}
        <div className="w-64 min-w-64 flex-shrink-0 px-4 py-2 border-r border-border font-medium text-sm">
          {viewMode === 'week'
            ? format(dateRange.start, 'MMM d') + ' - ' + format(dateRange.end, 'MMM d, yyyy')
            : format(currentDate, 'MMMM yyyy')}
        </div>

        {/* Date Columns */}
        <div className="flex-1 flex">
          {dateRange.days.map((day) => (
            <div
              key={day.toISOString()}
              className={cn(
                'flex-1 min-w-8 px-1 py-2 text-center text-xs border-r border-border/50 last:border-r-0',
                isToday(day) && 'bg-primary/10',
                getDay(day) === 0 || getDay(day) === 6 ? 'bg-muted/50' : ''
              )}
            >
              <div className="font-medium">{format(day, viewMode === 'week' ? 'EEE' : 'd')}</div>
              {viewMode === 'week' && (
                <div className="text-muted-foreground">{format(day, 'd')}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Gantt Body */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden"
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : tickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <Calendar className="h-12 w-12 text-muted-foreground/50" />
            <p className="text-lg text-muted-foreground">No tickets with dates</p>
            <p className="text-sm text-muted-foreground/70">
              Add due dates to tickets to see them on the timeline
            </p>
          </div>
        ) : (
          tickets.map((ticket: GanttTicket) => {
            const bar = getTicketBar(ticket);

            return (
              <div
                key={ticket.id}
                className="flex border-b border-border/50 hover:bg-muted/30 transition-colors group"
              >
                {/* Ticket Info */}
                {/* TODO: Add right-click context menu for quick actions (edit, delete, change status) */}
                <div
                  className="w-64 min-w-64 flex-shrink-0 px-4 py-3 border-r border-border flex items-center gap-3 cursor-pointer"
                  onClick={() => setSelectedTicketId(ticket.id)}
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground font-mono">
                        {ticket.project?.key || 'PROFCLAW'}-{ticket.sequence}
                      </span>
                      <span
                        className={cn(
                          'w-2 h-2 rounded-full',
                          STATUS_COLORS[ticket.status] || 'bg-gray-400'
                        )}
                      />
                    </div>
                    <div className="text-sm font-medium truncate">{ticket.title}</div>
                  </div>
                </div>

                {/* Timeline */}
                <div className="flex-1 relative min-h-12">
                  {/* Grid lines */}
                  <div className="absolute inset-0 flex">
                    {dateRange.days.map((day) => (
                      <div
                        key={day.toISOString()}
                        className={cn(
                          'flex-1 border-r border-border/30 last:border-r-0',
                          isToday(day) && 'bg-primary/5',
                          getDay(day) === 0 || getDay(day) === 6 ? 'bg-muted/30' : ''
                        )}
                      />
                    ))}
                  </div>

                  {/* Ticket Bar */}
                  {/* TODO: Add resize handles on left/right edges for drag-to-resize */}
                  {/* TODO: Add dependency arrows using SVG lines between related tickets */}
                  {/* TODO: Add progress bar overlay showing completion percentage */}
                  {bar && (
                    <div
                      className={cn(
                        'absolute top-2 bottom-2 rounded-md cursor-pointer',
                        'border-l-4 shadow-sm',
                        STATUS_COLORS[ticket.status] || 'bg-gray-400',
                        PRIORITY_BORDER[ticket.priority] || 'border-l-gray-400',
                        'hover:brightness-110 transition-all',
                        'opacity-90 hover:opacity-100'
                      )}
                      style={{
                        left: `${bar.left}%`,
                        width: `${bar.width}%`,
                        minWidth: '20px',
                      }}
                      onClick={() => setSelectedTicketId(ticket.id)}
                      title={`${ticket.title}\n${format(bar.startDate, 'MMM d')} - ${format(bar.endDate, 'MMM d')}`}
                    >
                      {/* Progress Overlay */}
                      <div
                        className="absolute top-0 bottom-0 left-0 bg-black/10 transition-all"
                        style={{
                          width: `${
                            ticket.status === 'done' || ticket.status === 'completed'
                              ? 100
                              : ticket.status === 'in_progress'
                              ? 50
                              : ticket.status === 'in_review'
                              ? 80
                              : 0
                          }%`,
                        }}
                      />
                      {/* TODO: Add left resize handle: <div className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize" /> */}
                      <div className="relative px-2 py-1 text-xs font-medium text-white truncate z-10">
                        {bar.width > 10 && ticket.title}
                      </div>
                      {/* TODO: Add right resize handle: <div className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize" /> */}
                    </div>
                  )}

                  {/* Today line */}
                  {isWithinInterval(new Date(), { start: dateRange.start, end: dateRange.end }) && (
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
                      style={{
                        left: `${((differenceInDays(new Date(), dateRange.start)) / dateRange.days.length) * 100}%`,
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Ticket Detail Modal */}
      <TicketDetailModal
        ticketId={selectedTicketId}
        open={!!selectedTicketId}
        onOpenChange={(open) => !open && setSelectedTicketId(null)}
      />
    </div>
  );
}
