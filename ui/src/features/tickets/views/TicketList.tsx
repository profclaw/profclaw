import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import {
  Loader2,
  Search,
  Filter,
  X,
  Ticket as TicketIcon,
  Clock,
  CheckCircle2,
  AlertCircle,
  Play,
  Circle,
  Inbox,
  Eye,
  Bug,
  Sparkles,
  Layers,
  BookOpen,
  Bot,
  FolderKanban,
  User,
  Tag,
} from 'lucide-react';
import { api, type TicketStatus, type TicketType, type TicketPriority } from '@/core/api/client';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { CreateTicketModal } from '../components/CreateTicketModal';
import { ViewSwitcher } from '../components/ViewSwitcher';
import { EstimateBadge } from '../components/EstimateSelect';

const STATUS_OPTIONS: Array<{ value: TicketStatus | 'all'; label: string; icon: typeof CheckCircle2 }> = [
  { value: 'all', label: 'All Status', icon: TicketIcon },
  { value: 'backlog', label: 'Backlog', icon: Inbox },
  { value: 'todo', label: 'Todo', icon: Circle },
  { value: 'in_progress', label: 'In Progress', icon: Play },
  { value: 'in_review', label: 'In Review', icon: Eye },
  { value: 'done', label: 'Done', icon: CheckCircle2 },
  { value: 'cancelled', label: 'Cancelled', icon: X },
];

const TYPE_OPTIONS: Array<{ value: TicketType | 'all'; label: string; icon: typeof Bug }> = [
  { value: 'all', label: 'All Types', icon: TicketIcon },
  { value: 'task', label: 'Task', icon: CheckCircle2 },
  { value: 'bug', label: 'Bug', icon: Bug },
  { value: 'feature', label: 'Feature', icon: Sparkles },
  { value: 'epic', label: 'Epic', icon: Layers },
  { value: 'story', label: 'Story', icon: BookOpen },
  { value: 'subtask', label: 'Subtask', icon: Circle },
];

const PRIORITY_OPTIONS: Array<{ value: TicketPriority | 'all'; label: string; color: string }> = [
  { value: 'all', label: 'All Priorities', color: 'text-muted-foreground' },
  { value: 'urgent', label: 'Urgent', color: 'text-red-500' },
  { value: 'high', label: 'High', color: 'text-orange-500' },
  { value: 'medium', label: 'Medium', color: 'text-yellow-500' },
  { value: 'low', label: 'Low', color: 'text-blue-500' },
  { value: 'none', label: 'None', color: 'text-gray-500' },
];

const CREATED_BY_OPTIONS: Array<{ value: 'all' | 'human' | 'ai'; label: string; icon: typeof User }> = [
  { value: 'all', label: 'All Authors', icon: User },
  { value: 'human', label: 'Human', icon: User },
  { value: 'ai', label: 'AI', icon: Bot },
];

export function TicketList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Get filters from URL params for shareability
  const statusFilter = (searchParams.get('status') || 'all') as TicketStatus | 'all';
  const typeFilter = (searchParams.get('type') || 'all') as TicketType | 'all';
  const priorityFilter = (searchParams.get('priority') || 'all') as TicketPriority | 'all';
  const projectFilter = searchParams.get('project') || 'all';
  const createdByFilter = (searchParams.get('createdBy') || 'all') as 'all' | 'human' | 'ai';
  const labelFilter = searchParams.get('label') || '';
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [labelSearch, setLabelSearch] = useState('');
  const [page, setPage] = useState(0);
  const limit = 20;

  // Fetch projects for filter dropdown
  const { data: projectsData } = useQuery({
    queryKey: ['projects-list'],
    queryFn: () => api.projects.list({ limit: 100 }),
  });
  const projects = projectsData?.projects ?? [];

  // Fetch labels for filter (use first project or all)
  const { data: labelsData } = useQuery({
    queryKey: ['labels-global'],
    queryFn: async () => {
      // Get labels from first project or default project
      const defaultProject = projects[0];
      if (!defaultProject) return { labels: [], total: 0 };
      return api.labels.list(defaultProject.id, { includeGlobal: true });
    },
    enabled: projects.length > 0,
  });
  const availableLabels = labelsData?.labels ?? [];

  // Update URL when filters change
  const updateFilter = (key: string, value: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (value === 'all' || value === '') {
      newParams.delete(key);
    } else {
      newParams.set(key, value);
    }
    setSearchParams(newParams);
    setPage(0);
  };

  const clearFilters = () => {
    setSearchParams({});
    setSearchQuery('');
    setLabelSearch('');
    setPage(0);
  };

  const hasActiveFilters = statusFilter !== 'all' || typeFilter !== 'all' || priorityFilter !== 'all' || projectFilter !== 'all' || createdByFilter !== 'all' || labelFilter || searchQuery;

  const { data, isLoading, error } = useQuery({
    queryKey: ['tickets', {
      status: statusFilter === 'all' ? undefined : statusFilter,
      type: typeFilter === 'all' ? undefined : typeFilter,
      priority: priorityFilter === 'all' ? undefined : priorityFilter,
      projectId: projectFilter === 'all' ? undefined : projectFilter,
      createdBy: createdByFilter === 'all' ? undefined : createdByFilter,
      label: labelFilter || undefined,
      search: searchQuery || undefined,
      limit,
      offset: page * limit
    }],
    queryFn: () =>
      api.tickets.list({
        status: statusFilter === 'all' ? undefined : statusFilter,
        type: typeFilter === 'all' ? undefined : typeFilter,
        priority: priorityFilter === 'all' ? undefined : priorityFilter,
        projectId: projectFilter === 'all' ? undefined : projectFilter,
        createdBy: createdByFilter === 'all' ? undefined : createdByFilter,
        label: labelFilter || undefined,
        search: searchQuery || undefined,
        limit,
        offset: page * limit,
      }),
  });

  const tickets = data?.tickets ?? [];
  const total = data?.total ?? 0;

  const getStatusBadge = (status: TicketStatus) => {
    const config: Record<TicketStatus, { variant: 'success' | 'destructive' | 'info' | 'secondary' | 'warning'; icon: typeof CheckCircle2 }> = {
      done: { variant: 'success', icon: CheckCircle2 },
      cancelled: { variant: 'destructive', icon: X },
      in_progress: { variant: 'info', icon: Play },
      in_review: { variant: 'warning', icon: Eye },
      todo: { variant: 'secondary', icon: Circle },
      backlog: { variant: 'secondary', icon: Inbox },
    };
    const statusConfig = config[status] || { variant: 'secondary' as const, icon: Clock };
    const { variant, icon: Icon } = statusConfig;
    return (
      <Badge variant={variant} className="gap-1">
        <Icon className="h-3 w-3" />
        {status.replace('_', ' ')}
      </Badge>
    );
  };

  const getTypeBadge = (type: TicketType) => {
    const config: Record<TicketType, { icon: typeof Bug; color: string }> = {
      task: { icon: CheckCircle2, color: 'text-blue-500' },
      bug: { icon: Bug, color: 'text-red-500' },
      feature: { icon: Sparkles, color: 'text-cyan-500' },
      enhancement: { icon: Sparkles, color: 'text-indigo-500' },
      documentation: { icon: BookOpen, color: 'text-cyan-500' },
      epic: { icon: Layers, color: 'text-orange-500' },
      story: { icon: BookOpen, color: 'text-green-500' },
      subtask: { icon: Circle, color: 'text-gray-500' },
    };
    const typeConfig = config[type] || { icon: TicketIcon, color: 'text-gray-500' };
    const { icon: Icon, color } = typeConfig;
    return (
      <span className={`flex items-center gap-1 text-xs ${color}`}>
        <Icon className="h-3 w-3" />
        {type}
      </span>
    );
  };

  const getPriorityIndicator = (priority: TicketPriority) => {
    const colors: Record<TicketPriority, string> = {
      urgent: 'bg-red-500',
      high: 'bg-orange-500',
      medium: 'bg-yellow-500',
      low: 'bg-blue-500',
      none: 'bg-gray-400',
    };
    return <div className={`h-2 w-2 rounded-full ${colors[priority]}`} title={priority} />;
  };

  if (error) {
    return (
      <div className="premium-card rounded-[24px] p-12 text-center">
        <AlertCircle className="h-12 w-12 mx-auto text-red-400 mb-4" />
        <p className="text-lg font-bold text-red-400">Error loading tickets</p>
        <p className="text-sm text-muted-foreground mt-1">{(error as Error).message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Tickets</h2>
          <p className="text-muted-foreground text-sm">
            {total} total tickets • {tickets.length} showing
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ViewSwitcher
            view="list"
            onChange={(view) => {
              if (view === 'board') {
                navigate('/tickets/board');
              }
            }}
          />
          <CreateTicketModal />
        </div>
      </header>

      {/* Filters Bar */}
      <div className="premium-card rounded-[20px] p-4 bg-muted/20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tickets by title or description..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                updateFilter('q', e.target.value);
              }}
              className="pl-10 h-10"
            />
          </div>

          {/* Filter Dropdowns */}
          <div className="flex flex-wrap gap-2">
            <Select value={statusFilter} onValueChange={(v) => updateFilter('status', v)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="glass-heavy rounded-xl border-white/10">
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <span className="flex items-center gap-2">
                      <opt.icon className="h-3.5 w-3.5" />
                      {opt.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={typeFilter} onValueChange={(v) => updateFilter('type', v)}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent className="glass-heavy rounded-xl border-white/10">
                {TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <span className="flex items-center gap-2">
                      <opt.icon className="h-3.5 w-3.5" />
                      {opt.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={priorityFilter} onValueChange={(v) => updateFilter('priority', v)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent className="glass-heavy rounded-xl border-white/10">
                {PRIORITY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <span className={`flex items-center gap-2 ${opt.color}`}>
                      {opt.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Project Filter */}
            <Select value={projectFilter} onValueChange={(v) => updateFilter('project', v)}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Project" />
              </SelectTrigger>
              <SelectContent className="glass-heavy rounded-xl border-white/10">
                <SelectItem value="all">
                  <span className="flex items-center gap-2">
                    <FolderKanban className="h-3.5 w-3.5" />
                    All Projects
                  </span>
                </SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    <span className="flex items-center gap-2">
                      <span>{project.icon}</span>
                      {project.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Created By Filter */}
            <Select value={createdByFilter} onValueChange={(v) => updateFilter('createdBy', v)}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Author" />
              </SelectTrigger>
              <SelectContent className="glass-heavy rounded-xl border-white/10">
                {CREATED_BY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <span className="flex items-center gap-2">
                      <opt.icon className="h-3.5 w-3.5" />
                      {opt.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Label Filter */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={`w-[130px] justify-start ${labelFilter ? 'text-primary' : ''}`}
                >
                  <Tag className="h-3.5 w-3.5 mr-2" />
                  {labelFilter || 'Label'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0 glass-heavy rounded-xl border-white/10" align="start">
                <div className="p-2 border-b border-white/5">
                  <Input
                    placeholder="Search labels..."
                    value={labelSearch}
                    onChange={(e) => setLabelSearch(e.target.value)}
                    className="h-8 bg-transparent border-white/10"
                  />
                </div>
                <div className="max-h-64 overflow-y-auto p-1">
                  <button
                    type="button"
                    onClick={() => {
                      updateFilter('label', '');
                      setLabelSearch('');
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-white/5"
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>Clear label filter</span>
                  </button>
                  {availableLabels
                    .filter((l) => l.name.toLowerCase().includes(labelSearch.toLowerCase()))
                    .map((label) => (
                      <button
                        key={label.id}
                        type="button"
                        onClick={() => {
                          updateFilter('label', label.name);
                          setLabelSearch('');
                        }}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-white/5 ${labelFilter === label.name ? 'bg-primary/10' : ''}`}
                      >
                        <span
                          className="h-3 w-3 rounded-full shrink-0"
                          style={{ backgroundColor: label.color }}
                        />
                        <span className="truncate">{label.name}</span>
                        {labelFilter === label.name && (
                          <CheckCircle2 className="h-3.5 w-3.5 ml-auto text-primary" />
                        )}
                      </button>
                    ))}
                  {availableLabels.length === 0 && (
                    <p className="p-2 text-sm text-muted-foreground text-center">
                      No labels available
                    </p>
                  )}
                </div>
              </PopoverContent>
            </Popover>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="rounded-xl text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Active Filters Pills */}
        {hasActiveFilters && (
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-white/5">
            <Filter className="h-4 w-4 text-muted-foreground" />
            {statusFilter !== 'all' && (
              <span className="px-2 py-0.5 rounded-lg bg-blue-500/10 text-blue-400 text-xs font-medium">
                Status: {statusFilter}
              </span>
            )}
            {typeFilter !== 'all' && (
              <span className="px-2 py-0.5 rounded-lg bg-indigo-500/10 text-indigo-400 text-xs font-medium capitalize">
                Type: {typeFilter}
              </span>
            )}
            {priorityFilter !== 'all' && (
              <span className="px-2 py-0.5 rounded-lg bg-orange-500/10 text-orange-400 text-xs font-medium capitalize">
                Priority: {priorityFilter}
              </span>
            )}
            {projectFilter !== 'all' && (
              <span className="px-2 py-0.5 rounded-lg bg-indigo-500/10 text-indigo-400 text-xs font-medium">
                Project: {projects.find(p => p.id === projectFilter)?.name || projectFilter}
              </span>
            )}
            {createdByFilter !== 'all' && (
              <span className="px-2 py-0.5 rounded-lg bg-cyan-500/10 text-cyan-400 text-xs font-medium capitalize">
                Author: {createdByFilter}
              </span>
            )}
            {labelFilter && (
              <span className="px-2 py-0.5 rounded-lg bg-pink-500/10 text-pink-400 text-xs font-medium">
                Label: {labelFilter}
              </span>
            )}
            {searchQuery && (
              <span className="px-2 py-0.5 rounded-lg bg-green-500/10 text-green-400 text-xs font-medium">
                Search: "{searchQuery}"
              </span>
            )}
          </div>
        )}
      </div>

      {/* Ticket List */}
      {isLoading ? (
        <div className="premium-card rounded-[28px] p-12 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : tickets.length === 0 ? (
        <div className="premium-card rounded-[24px] p-12 text-center">
          <TicketIcon className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
          <p className="text-lg font-bold text-muted-foreground">No tickets found</p>
          <p className="text-sm text-muted-foreground/60 mt-1">
            {hasActiveFilters ? 'Try adjusting your filters' : 'Create a ticket to get started'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {tickets.map((ticket) => (
            <Link
              key={ticket.id}
              to={`/tickets/${ticket.id}`}
              className="block premium-card border-none hover:bg-muted/30 transition-all group"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  {/* Priority Indicator */}
                  <div className="pt-1">
                    {getPriorityIndicator(ticket.priority)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-xs font-mono text-muted-foreground">
                        {ticket.projectKey || 'GLINR'}-{ticket.sequence}
                      </span>
                      {!ticket.projectId && (
                        <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                          No Project
                        </span>
                      )}
                      <h3 className="font-semibold truncate group-hover:text-primary transition-colors">
                        {ticket.title}
                      </h3>
                    </div>
                    {ticket.description && (
                      <p className="text-sm text-muted-foreground line-clamp-1 mb-2">
                        {ticket.description}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      {getTypeBadge(ticket.type)}
                      {getStatusBadge(ticket.status)}
                      {ticket.assigneeAgent && (
                        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-primary/80 px-2 py-0.5 rounded-md bg-primary/10">
                          <Bot className="h-3 w-3" />
                          {ticket.assigneeAgent}
                        </span>
                      )}
                      {ticket.createdBy === 'ai' && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400 px-2 py-0.5 rounded-md bg-blue-500/10">
                          AI Created
                        </span>
                      )}
                      {ticket.labels.slice(0, 3).map((label) => (
                        <Badge key={label} variant="outline" className="text-[10px] px-1.5 py-0">
                          {label}
                        </Badge>
                      ))}
                      {ticket.estimate != null && (
                        <EstimateBadge value={ticket.estimate} />
                      )}
                      <span className="text-[10px] text-muted-foreground/50 ml-auto">
                        {new Date(ticket.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Pagination */}
      {tickets.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page + 1} • Showing {Math.min(tickets.length, limit)} of {total}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page - 1)}
              disabled={page === 0}
              className="rounded-xl border-white/10"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page + 1)}
              disabled={(page + 1) * limit >= total}
              className="rounded-xl border-white/10"
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
