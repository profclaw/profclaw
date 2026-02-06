import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import {
  Loader2,
  Search,
  Inbox,
  Circle,
  Play,
  Eye,
  CheckCircle2,
  Plus,
  AlertCircle,
  FolderOpen,
  ChevronDown,
} from 'lucide-react';
import { api, type TicketStatus } from '@/core/api/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { BoardCard } from '../components/BoardCard';
import { CreateTicketModal } from '../components/CreateTicketModal';
import { ViewSwitcher } from '../components/ViewSwitcher';

// Column configuration
const COLUMNS: Array<{
  status: TicketStatus;
  label: string;
  icon: typeof Inbox;
  color: string;
  bgColor: string;
}> = [
  { status: 'backlog', label: 'Backlog', icon: Inbox, color: 'text-gray-400', bgColor: 'bg-gray-500/10' },
  { status: 'todo', label: 'Todo', icon: Circle, color: 'text-blue-400', bgColor: 'bg-blue-500/10' },
  { status: 'in_progress', label: 'In Progress', icon: Play, color: 'text-amber-400', bgColor: 'bg-amber-500/10' },
  { status: 'in_review', label: 'In Review', icon: Eye, color: 'text-indigo-400', bgColor: 'bg-indigo-500/10' },
  { status: 'done', label: 'Done', icon: CheckCircle2, color: 'text-green-400', bgColor: 'bg-green-500/10' },
];

interface ColumnProps {
  status: TicketStatus;
  label: string;
  icon: typeof Inbox;
  color: string;
  bgColor: string;
  tickets: Array<{
    id: string;
    sequence: number;
    title: string;
    description?: string;
    type: any;
    priority: any;
    status: string;
    labels: string[];
    assignee?: string;
    assigneeAgent?: string;
    createdBy: 'human' | 'ai';
    projectKey?: string;
  }>;
  onDrop: (ticketId: string, newStatus: TicketStatus) => void;
}

function BoardColumn({ status, label, icon: Icon, color, bgColor, tickets, onDrop }: ColumnProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isDraggedOver, setIsDraggedOver] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    return dropTargetForElements({
      element: el,
      getData: () => ({ status }),
      canDrop: ({ source }) => {
        // Don't allow drop on same column
        return source.data.status !== status;
      },
      onDragEnter: () => setIsDraggedOver(true),
      onDragLeave: () => setIsDraggedOver(false),
      onDrop: ({ source }) => {
        setIsDraggedOver(false);
        const ticketId = source.data.ticketId as string;
        if (ticketId) {
          onDrop(ticketId, status);
        }
      },
    });
  }, [status, onDrop]);

  return (
    <div
      ref={ref}
      className={cn(
        'flex flex-col min-w-[280px] max-w-[320px] rounded-2xl border transition-all duration-200',
        isDraggedOver
          ? 'border-[var(--primary)] bg-[var(--primary)]/5 scale-[1.02]'
          : 'border-[var(--border)] bg-[var(--card)]/50'
      )}
    >
      {/* Column Header */}
      <div className={cn('flex items-center justify-between px-4 py-3 rounded-t-2xl', bgColor)}>
        <div className="flex items-center gap-2">
          <Icon className={cn('h-4 w-4', color)} />
          <span className="text-sm font-semibold">{label}</span>
          <span className="flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-[var(--background)]/50 text-[10px] font-bold">
            {tickets.length}
          </span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg opacity-0 group-hover:opacity-100">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Cards */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-280px)] scrollbar-thin">
        {tickets.length === 0 ? (
          <div
            className={cn(
              'flex flex-col items-center justify-center py-8 px-4 rounded-xl border-2 border-dashed transition-colors',
              isDraggedOver
                ? 'border-[var(--primary)] bg-[var(--primary)]/5'
                : 'border-[var(--border)]/50'
            )}
          >
            <Icon className={cn('h-8 w-8 mb-2 opacity-30', color)} />
            <span className="text-xs text-[var(--muted-foreground)]">
              {isDraggedOver ? 'Drop here' : 'No tickets'}
            </span>
          </div>
        ) : (
          tickets.map((ticket) => <BoardCard key={ticket.id} ticket={ticket} />)
        )}
      </div>
    </div>
  );
}

export function TicketBoard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [projectId, setProjectId] = useState<string | undefined>(searchParams.get('projectId') || undefined);

  // Fetch projects for filtering
  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.projects.list({ limit: 50 }),
  });

  const projects = projectsData?.projects || [];
  const selectedProject = projects.find(p => p.id === projectId);

  // Handle project filter change
  const handleProjectChange = (newProjectId: string | undefined) => {
    setProjectId(newProjectId);
    const params = new URLSearchParams(searchParams);
    if (newProjectId) {
      params.set('projectId', newProjectId);
    } else {
      params.delete('projectId');
    }
    setSearchParams(params);
  };

  // Fetch all tickets for the board (no pagination, grouped by status)
  const { data, isLoading, error } = useQuery({
    queryKey: ['tickets', 'board', { search: searchQuery || undefined, projectId }],
    queryFn: () =>
      api.tickets.list({
        search: searchQuery || undefined,
        projectId: projectId || undefined,
        limit: 200, // Get more tickets for board view
      }),
  });

  // Update ticket status mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TicketStatus }) =>
      api.tickets.update(id, { status }),
    onMutate: async ({ id, status }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['tickets', 'board'] });

      // Snapshot previous value
      const previousData = queryClient.getQueryData(['tickets', 'board', { search: searchQuery || undefined, projectId }]);

      // Optimistically update
      queryClient.setQueryData(
        ['tickets', 'board', { search: searchQuery || undefined, projectId }],
        (old: typeof data) => {
          if (!old?.tickets) return old;
          return {
            ...old,
            tickets: old.tickets.map((t: { id: string }) =>
              t.id === id ? { ...t, status } : t
            ),
          };
        }
      );

      return { previousData };
    },
    onError: (_err, _vars, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(
          ['tickets', 'board', { search: searchQuery || undefined, projectId }],
          context.previousData
        );
      }
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });

  const handleDrop = useCallback(
    (ticketId: string, newStatus: TicketStatus) => {
      updateMutation.mutate({ id: ticketId, status: newStatus });
    },
    [updateMutation]
  );

  // Group tickets by status
  const tickets = data?.tickets ?? [];
  const ticketsByStatus = COLUMNS.reduce(
    (acc, col) => {
      acc[col.status] = tickets.filter(
        (t) => t.status === col.status
      ).map((t) => ({
        ...t,
        createdBy: t.createdBy ?? 'human' as const,
      }));
      return acc;
    },
    {} as Record<TicketStatus, Array<{
      id: string;
      sequence: number;
      title: string;
      description?: string;
      type: any;
      priority: any;
      status: string;
      labels: string[];
      assignee?: string;
      assigneeAgent?: string;
      createdBy: 'human' | 'ai';
      projectKey?: string;
    }>>
  );

  if (error) {
    return (
      <div className="premium-card rounded-[28px] p-12 text-center">
        <AlertCircle className="h-12 w-12 mx-auto text-red-400 mb-4" />
        <p className="text-lg font-bold text-red-400">Error loading board</p>
        <p className="text-sm text-muted-foreground mt-1">{(error as Error).message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 h-full">
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Ticket Board</h2>
          <p className="text-muted-foreground text-sm">
            {projectId ? `Showing ${selectedProject?.name || 'Project'} tickets` : 'Showing all tickets across projects'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Project Filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 h-9">
                <FolderOpen className="h-4 w-4" />
                {selectedProject ? (
                  <span className="flex items-center gap-1.5">
                    <span>{selectedProject.icon}</span>
                    <span className="max-w-[120px] truncate">{selectedProject.name}</span>
                  </span>
                ) : (
                  'All Projects'
                )}
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => handleProjectChange(undefined)}>
                <span className="flex items-center gap-2">
                  <FolderOpen className="h-4 w-4" />
                  All Projects
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {projects.map((project) => (
                <DropdownMenuItem
                  key={project.id}
                  onClick={() => handleProjectChange(project.id)}
                >
                  <span className="mr-2">{project.icon}</span>
                  <span className="truncate">{project.name}</span>
                  {project.id === projectId && (
                    <CheckCircle2 className="h-4 w-4 ml-auto text-primary" />
                  )}
                </DropdownMenuItem>
              ))}
              {projects.length > 0 && selectedProject && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate(`/projects/${projectId}`)}>
                    <span className="text-primary">Go to Project Board →</span>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Search */}
          <div className="relative w-48 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tickets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-9"
            />
          </div>
          <ViewSwitcher
            view="board"
            onChange={(view) => {
              if (view === 'list') {
                const params = projectId ? `?projectId=${projectId}` : '';
                navigate(`/tickets${params}`);
              }
            }}
          />
          <CreateTicketModal />
        </div>
      </header>

      {/* Board */}
      {isLoading ? (
        <div className="premium-card rounded-[28px] p-12 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 scrollbar-thin">
          {COLUMNS.map((col) => (
            <BoardColumn
              key={col.status}
              {...col}
              tickets={ticketsByStatus[col.status] ?? []}
              onDrop={handleDrop}
            />
          ))}
        </div>
      )}

      {/* Mutation status indicator */}
      {updateMutation.isPending && (
        <div className="fixed bottom-4 right-4 flex items-center gap-2 px-4 py-2 rounded-xl glass-heavy text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Updating...
        </div>
      )}
    </div>
  );
}
