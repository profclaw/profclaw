/**
 * Backlog Table Component
 *
 * Shows all tickets not assigned to any sprint (backlog).
 * Supports filtering, sorting, and bulk actions.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Loader2,
  Search,
  Filter,
  Flag,
  User,
  Plus,
  ChevronDown,
  Inbox,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { api } from '@/core/api/client';
import { toast } from 'sonner';
import type { TicketStatus, TicketPriority, TicketType, Sprint } from '@/core/types';

interface BacklogTableProps {
  projectId: string;
  sprints: Sprint[];
  onCreateTicket?: () => void;
  /** When true, shows all tickets instead of just backlog */
  showAllTickets?: boolean;
  /** Title to display (defaults to "Backlog" or "All Tickets") */
  title?: string;
}

const STATUS_COLORS: Record<TicketStatus, string> = {
  backlog: 'bg-gray-400/10 text-gray-400',
  todo: 'bg-amber-400/10 text-amber-400',
  in_progress: 'bg-blue-500/10 text-blue-500',
  in_review: 'bg-indigo-500/10 text-indigo-500',
  done: 'bg-green-500/10 text-green-500',
  cancelled: 'bg-red-500/10 text-red-500',
};

const PRIORITY_COLORS: Record<TicketPriority, string> = {
  urgent: 'text-red-500',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-blue-400',
  none: 'text-gray-400',
};

const TYPE_COLORS: Record<TicketType, string> = {
  task: 'bg-blue-500/10 text-blue-500',
  bug: 'bg-red-500/10 text-red-500',
  feature: 'bg-green-500/10 text-green-500',
  enhancement: 'bg-indigo-500/10 text-indigo-500',
  documentation: 'bg-teal-500/10 text-teal-500',
  epic: 'bg-amber-500/10 text-amber-500',
  story: 'bg-cyan-500/10 text-cyan-500',
  subtask: 'bg-gray-500/10 text-gray-500',
};

export function BacklogTable({ projectId, sprints, onCreateTicket, showAllTickets = false, title: _title }: BacklogTableProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<TicketPriority | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<TicketType | 'all'>('all');

  // Fetch tickets (backlog only or all)
  const { data, isLoading } = useQuery({
    queryKey: ['tickets', showAllTickets ? 'all' : 'backlog', projectId, search, statusFilter, priorityFilter, typeFilter],
    queryFn: () =>
      api.tickets.list({
        projectId,
        inBacklog: showAllTickets ? undefined : true,
        search: search || undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        priority: priorityFilter !== 'all' ? priorityFilter : undefined,
        type: typeFilter !== 'all' ? typeFilter : undefined,
        limit: 100,
      }),
  });

  // Add ticket to sprint mutation
  const addToSprint = useMutation({
    mutationFn: ({ ticketId, sprintId }: { ticketId: string; sprintId: string }) =>
      api.projects.sprints.addTickets(projectId, sprintId, [ticketId]),
    onSuccess: () => {
      toast.success('Ticket added to sprint');
      queryClient.invalidateQueries({ queryKey: ['tickets', 'backlog', projectId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to add ticket to sprint');
    },
  });

  const tickets = data?.tickets || [];
  const activeSprints = sprints.filter((s) => s.status === 'active' || s.status === 'planning');

  const handleAddToSprint = (ticketId: string, sprintId: string) => {
    addToSprint.mutate({ ticketId, sprintId });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-[300px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tickets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Filter className="h-4 w-4" />
              Status
              {statusFilter !== 'all' && (
                <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded capitalize">
                  {statusFilter.replace('_', ' ')}
                </span>
              )}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => setStatusFilter('all')}>All</DropdownMenuItem>
            <DropdownMenuSeparator />
            {Object.keys(STATUS_COLORS).map((status) => (
              <DropdownMenuItem
                key={status}
                onClick={() => setStatusFilter(status as TicketStatus)}
              >
                <span className="capitalize">{status.replace('_', ' ')}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Flag className="h-4 w-4" />
              Priority
              {priorityFilter !== 'all' && (
                <span className={cn('text-xs capitalize', PRIORITY_COLORS[priorityFilter])}>
                  {priorityFilter}
                </span>
              )}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => setPriorityFilter('all')}>All</DropdownMenuItem>
            <DropdownMenuSeparator />
            {Object.keys(PRIORITY_COLORS).map((priority) => (
              <DropdownMenuItem
                key={priority}
                onClick={() => setPriorityFilter(priority as TicketPriority)}
              >
                <span className={cn('capitalize', PRIORITY_COLORS[priority as TicketPriority])}>
                  {priority}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              Type
              {typeFilter !== 'all' && (
                <span className={cn('text-xs px-1.5 py-0.5 rounded capitalize', TYPE_COLORS[typeFilter])}>
                  {typeFilter}
                </span>
              )}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => setTypeFilter('all')}>All</DropdownMenuItem>
            <DropdownMenuSeparator />
            {Object.keys(TYPE_COLORS).map((type) => (
              <DropdownMenuItem
                key={type}
                onClick={() => setTypeFilter(type as TicketType)}
              >
                <span className={cn('capitalize px-1.5 py-0.5 rounded', TYPE_COLORS[type as TicketType])}>
                  {type}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex-1" />

        {onCreateTicket && (
          <Button size="sm" className="gap-2" onClick={onCreateTicket}>
            <Plus className="h-4 w-4" />
            New Ticket
          </Button>
        )}
      </div>

      {/* Table */}
      {tickets.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 bg-muted/30 rounded-xl border border-dashed border-border">
          <Inbox className="h-10 w-10 text-muted-foreground/50 mb-3" />
          <p className="text-muted-foreground mb-1">
            {showAllTickets ? 'No tickets found' : 'No tickets in backlog'}
          </p>
          <p className="text-xs text-muted-foreground">
            {search || statusFilter !== 'all' || priorityFilter !== 'all' || typeFilter !== 'all'
              ? 'Try adjusting your filters'
              : 'Create a ticket to get started'}
          </p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">
                  Ticket
                </th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 w-[100px]">
                  Status
                </th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 w-[100px]">
                  Priority
                </th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 w-[100px]">
                  Type
                </th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 w-[120px]">
                  Assignee
                </th>
                <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3 w-[140px]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr
                  key={ticket.id}
                  className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      <span className="text-xs font-mono text-muted-foreground shrink-0">
                        {ticket.projectKey || 'GLINR'}-{ticket.sequence}
                      </span>
                      <Link
                        to={`/tickets/${ticket.id}`}
                        className="text-sm font-medium hover:text-primary line-clamp-1"
                      >
                        {ticket.title}
                      </Link>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'text-xs px-2 py-1 rounded-full capitalize',
                        STATUS_COLORS[ticket.status]
                      )}
                    >
                      {ticket.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('text-xs capitalize', PRIORITY_COLORS[ticket.priority])}>
                      {ticket.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn('text-xs px-2 py-1 rounded capitalize', TYPE_COLORS[ticket.type])}
                    >
                      {ticket.type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {ticket.assignee ? (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <User className="h-3 w-3" />
                        <span className="truncate max-w-[80px]">{ticket.assignee}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Unassigned</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {activeSprints.length > 0 && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                            <Plus className="h-3 w-3" />
                            Add to Sprint
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Select Sprint</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {activeSprints.map((sprint) => (
                            <DropdownMenuItem
                              key={sprint.id}
                              onClick={() => handleAddToSprint(ticket.id, sprint.id)}
                            >
                              <span className="flex items-center gap-2">
                                {sprint.name}
                                <span
                                  className={cn(
                                    'text-[10px] px-1.5 py-0.5 rounded-full capitalize',
                                    sprint.status === 'active'
                                      ? 'bg-blue-500/10 text-blue-500'
                                      : 'bg-muted text-muted-foreground'
                                  )}
                                >
                                  {sprint.status}
                                </span>
                              </span>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {tickets.length} ticket{tickets.length !== 1 ? 's' : ''}{' '}
          {showAllTickets ? 'total' : 'in backlog'}
        </span>
      </div>
    </div>
  );
}
