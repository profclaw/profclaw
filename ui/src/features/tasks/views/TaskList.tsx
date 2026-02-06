import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Search, Filter, X, ListTodo, Clock, CheckCircle2, AlertCircle, Play, MoreHorizontal } from 'lucide-react';
import { api, type Task } from '@/core/api/client';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CreateTaskModal } from '../components/CreateTaskModal';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Status', icon: ListTodo },
  { value: 'pending', label: 'Pending', icon: Clock },
  { value: 'in_progress', label: 'Running', icon: Play },
  { value: 'completed', label: 'Completed', icon: CheckCircle2 },
  { value: 'failed', label: 'Failed', icon: AlertCircle },
];

const SOURCE_OPTIONS = ['all', 'github', 'jira', 'linear', 'manual', 'webhook'];
const AGENT_OPTIONS = ['all', 'openclaw', 'claude-code', 'auto'];

export function TaskList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Get filters from URL params for shareability
  const statusFilter = searchParams.get('status') || 'all';
  const sourceFilter = searchParams.get('source') || 'all';
  const agentFilter = searchParams.get('agent') || 'all';
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [page, setPage] = useState(0);
  const limit = 20;

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
    setPage(0);
  };

  const hasActiveFilters = statusFilter !== 'all' || sourceFilter !== 'all' || agentFilter !== 'all' || searchQuery;

  const { data, isLoading, error } = useQuery({
    queryKey: ['tasks', { status: statusFilter === 'all' ? undefined : statusFilter, limit, offset: page * limit }],
    queryFn: () =>
      api.tasks.list({
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit,
        offset: page * limit,
      }),
  });

  const tasks = data?.tasks ?? [];
  const total = data?.total ?? 0;

  // Client-side filtering for source, agent, and search
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const matchesSearch = !searchQuery ||
        task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        task.description?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesSource = sourceFilter === 'all' || task.source.toLowerCase() === sourceFilter;
      const matchesAgent = agentFilter === 'all' ||
        (task.assignedAgent?.toLowerCase() === agentFilter) ||
        (agentFilter === 'auto' && !task.assignedAgent);
      return matchesSearch && matchesSource && matchesAgent;
    });
  }, [tasks, searchQuery, sourceFilter, agentFilter]);

  const getStatusBadge = (status: Task['status']) => {
    const config: Record<string, { variant: 'success' | 'destructive' | 'info' | 'secondary', icon: typeof CheckCircle2 }> = {
      completed: { variant: 'success', icon: CheckCircle2 },
      failed: { variant: 'destructive', icon: AlertCircle },
      running: { variant: 'info', icon: Play },
      pending: { variant: 'secondary', icon: Clock },
      in_progress: { variant: 'info', icon: Play },
    };
    const statusConfig = config[status] || { variant: 'secondary' as const, icon: Clock };
    const { variant, icon: Icon } = statusConfig;
    return (
      <Badge variant={variant} className="gap-1.5 px-2 py-0.5 font-medium">
        <Icon className="h-3 w-3" />
        <span className="capitalize">{status.replace('_', ' ')}</span>
      </Badge>
    );
  };

  if (error) {
    return (
      <div className="glass rounded-[28px] p-12 text-center">
        <AlertCircle className="h-12 w-12 mx-auto text-red-400 mb-4" />
        <p className="text-lg font-bold text-red-400">Error loading tasks</p>
        <p className="text-sm text-muted-foreground mt-1">{(error as Error).message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Tasks</h2>
          <p className="text-muted-foreground text-sm">
            {total} total tasks • {filteredTasks.length} showing
          </p>
        </div>
        <CreateTaskModal />
      </header>

      {/* Filters Bar */}
      <div className="glass rounded-[20px] p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                updateFilter('q', e.target.value);
              }}
              className="pl-10 bg-white/5 border-white/10 rounded-xl h-10"
            />
          </div>

          {/* Filter Dropdowns */}
          <div className="flex flex-wrap gap-2">
            <Select value={statusFilter} onValueChange={(v) => updateFilter('status', v)}>
              <SelectTrigger className="w-[140px] bg-white/5 border-white/10 rounded-xl">
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

            <Select value={sourceFilter} onValueChange={(v) => updateFilter('source', v)}>
              <SelectTrigger className="w-[130px] bg-white/5 border-white/10 rounded-xl">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent className="glass-heavy rounded-xl border-white/10">
                {SOURCE_OPTIONS.map((src) => (
                  <SelectItem key={src} value={src} className="capitalize">
                    {src === 'all' ? 'All Sources' : src}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={agentFilter} onValueChange={(v) => updateFilter('agent', v)}>
              <SelectTrigger className="w-[140px] bg-white/5 border-white/10 rounded-xl">
                <SelectValue placeholder="Agent" />
              </SelectTrigger>
              <SelectContent className="glass-heavy rounded-xl border-white/10">
                {AGENT_OPTIONS.map((agent) => (
                  <SelectItem key={agent} value={agent} className="capitalize">
                    {agent === 'all' ? 'All Agents' : agent}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

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
            {sourceFilter !== 'all' && (
              <span className="px-2 py-0.5 rounded-lg bg-indigo-500/10 text-indigo-400 text-xs font-medium capitalize">
                Source: {sourceFilter}
              </span>
            )}
            {agentFilter !== 'all' && (
              <span className="px-2 py-0.5 rounded-lg bg-green-500/10 text-green-400 text-xs font-medium capitalize">
                Agent: {agentFilter}
              </span>
            )}
            {searchQuery && (
              <span className="px-2 py-0.5 rounded-lg bg-orange-500/10 text-orange-400 text-xs font-medium">
                Search: "{searchQuery}"
              </span>
            )}
          </div>
        )}
      </div>

      {/* Task Table */}
      <div className="glass-heavy rounded-[24px] overflow-hidden border border-white/10 shadow-float">
        {isLoading ? (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="p-12 text-center">
            <ListTodo className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-lg font-bold text-muted-foreground">No tasks found</p>
            <p className="text-sm text-muted-foreground/60 mt-1">
              {hasActiveFilters ? 'Try adjusting your filters' : 'Create a task to get started'}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow className="hover:bg-transparent border-white/5">
                <TableHead className="w-[400px]">Task</TableHead>
                <TableHead className="w-[140px]">Status</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Created</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTasks.map((task) => (
                <TableRow 
                  key={task.id} 
                  className="group cursor-pointer hover:bg-white/5 border-white/5"
                  onClick={() => navigate(`/tasks/${task.id}`)}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10 text-primary">
                        <ListTodo className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-foreground group-hover:text-primary transition-colors">
                          {task.title}
                        </div>
                        {task.description && (
                          <div className="text-xs text-muted-foreground truncate max-w-[300px]">
                            {task.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {getStatusBadge(task.status)}
                  </TableCell>
                  <TableCell>
                    {task.assignedAgent ? (
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-[10px] uppercase text-white font-bold">
                          {task.assignedAgent[0]}
                        </div>
                        <span className="text-sm capitalize">{task.assignedAgent}</span>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground italic">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize bg-muted/50">
                      {task.source}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground text-sm font-mono">
                    {new Date(task.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => navigate(`/tasks/${task.id}`)}>
                          View Details
                        </DropdownMenuItem>
                        {/* Add more actions here */}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Pagination */}
      {filteredTasks.length > 0 && (
        <div className="flex items-center justify-between border-t border-white/10 pt-4">
          <p className="text-sm text-muted-foreground">
            Page {page + 1} • Showing {Math.min(filteredTasks.length, limit)} of {total}
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
