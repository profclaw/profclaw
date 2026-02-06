import { Suspense, useState, useEffect } from 'react';
import { useParams, useNavigate, Outlet, NavLink, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Columns3,
  Inbox,
  Table,
  Settings2,
  Search,
  Plus,
  Filter,
  Loader2,
  Sparkles,
  Bot,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/core/api/client';
import { ProjectIcon } from '../components/ProjectIcon';
import { useSearchParams } from 'react-router-dom';

const PROJECT_NAV = [
  { id: 'board', label: 'Board', icon: Columns3, path: 'board' },
  { id: 'backlog', label: 'Backlog', icon: Inbox, path: 'backlog' },
  { id: 'table', label: 'Table', icon: Table, path: 'table' },
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, path: 'overview' },
];

export function ProjectLayout() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');

  const { data: projectData, isLoading: projectLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.projects.get(id!, 'all'),
    enabled: !!id,
  });

  const { data: agentsData } = useQuery({
    queryKey: ['gateway-agents'],
    queryFn: () => api.gateway.agents(),
    enabled: !!id,
  });

  const project = projectData;

  // Sync search query to URL
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (searchQuery) {
        searchParams.set('q', searchQuery);
      } else {
        searchParams.delete('q');
      }
      setSearchParams(searchParams, { replace: true });
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery, searchParams, setSearchParams]);

  if (projectLoading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <Sparkles className="h-4 w-4 text-primary absolute -top-1 -right-1 animate-pulse" />
          </div>
          <p className="text-sm font-medium animate-pulse text-muted-foreground">Loading project context...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh] gap-4">
        <p className="text-muted-foreground">Project context not found</p>
        <Button variant="outline" onClick={() => navigate('/projects')}>
          Back to Projects List
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full space-y-4 min-w-0">
      {/* Compact Project Header */}
      <div className="flex items-center justify-between pb-2 border-b border-black/5 dark:border-white/5">
        <div className="flex items-center gap-3">
          <div className="relative group shrink-0">
            <div className="absolute -inset-1 bg-gradient-to-br from-primary/20 to-indigo-500/20 rounded-xl blur-sm opacity-0 group-hover:opacity-100 transition-opacity" />
            <ProjectIcon icon={project.icon} color={project.color} size="sm" className="relative h-10 w-10 rounded-xl shadow-sm border border-white/10" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight">{project.name}</h1>
              <span
                className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-md border border-primary/20 bg-primary/5 uppercase tracking-wider"
                style={{ color: project.color }}
              >
                {project.key}
              </span>
              {project.status === 'archived' && (
                <span className="text-[9px] font-bold uppercase tracking-wider bg-muted text-muted-foreground px-1.5 py-0.5 rounded-md border border-border/30">
                  Archived
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 mt-0.5">
               <nav className="flex items-center gap-1.5 p-1 bg-black/[0.03] dark:bg-white/[0.03] rounded-2xl border border-black/5 dark:border-white/5 backdrop-blur-xl">
                {PROJECT_NAV.map((item) => (
                  <NavLink
                    key={item.id}
                    to={`/projects/${id}/${item.path}`}
                    className={({ isActive }) => cn(
                      'flex items-center gap-2 px-4 py-1.5 rounded-xl text-[11px] font-bold uppercase tracking-widest transition-all relative group',
                      isActive
                        ? 'bg-primary/10 text-primary shadow-[0_0_20px_rgba(var(--primary-rgb),0.15)] border border-primary/20'
                        : 'text-muted-foreground/70 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5'
                    )}
                  >
                    <item.icon className={cn("h-3.5 w-3.5 transition-transform duration-300 group-hover:scale-110")} />
                    {item.label}
                    {/* Perspective Highlight for active tab */}
                    <div className="absolute inset-0 rounded-xl bg-gradient-to-tr from-primary/5 to-transparent opacity-0 group-data-[active=true]:opacity-100 transition-opacity pointer-events-none" />
                  </NavLink>
                ))}
              </nav>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Global Search integrated in header for compactness */}
          <div className="relative hidden md:block group w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground transition-colors group-focus-within:text-primary" aria-hidden="true" />
            <Input
              placeholder="Search in project..."
              aria-label="Search in project"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9"
            />
          </div>

          <div className="w-px h-6 bg-white/10 mx-1" />

          <div className="flex items-center gap-2">
            <Button variant="black" size="sm" className="h-9 gap-2 rounded-xl">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline text-xs font-bold uppercase tracking-wider">Issue</span>
            </Button>
            <Link to={`/projects/${id}/settings`} aria-label="Project settings">
              <Button variant="glass" size="icon" className="h-9 w-9 rounded-xl border-white/5" aria-label="Project settings">
                <Settings2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Filter & Secondary Nav Bar - Now much slimmer */}
      <div className="flex items-center justify-between gap-4 py-1">
        <div className="flex items-center gap-3">
          {/* Quick Filters (Avatars) */}
          <div className="flex items-center -space-x-3">
            {agentsData?.agents.slice(0, 5).map((agent) => (
              <button
                key={agent.type}
                className={cn(
                  "h-9 w-9 rounded-full border-2 border-background bg-card-solid shadow-soft flex items-center justify-center transition-all hover:scale-110 hover:-translate-y-1 hover:z-20 relative ring-offset-2",
                  searchParams.get('assigneeAgent') === agent.type && "ring-2 ring-primary scale-110 z-20"
                )}
                title={agent.name}
                aria-label={`Filter by ${agent.name}`}
                aria-pressed={searchParams.get('assigneeAgent') === agent.type}
                onClick={() => {
                  if (searchParams.get('assigneeAgent') === agent.type) {
                    searchParams.delete('assigneeAgent');
                  } else {
                    searchParams.set('assigneeAgent', agent.type);
                  }
                  setSearchParams(searchParams);
                }}
              >
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/20 to-indigo-500/20 opacity-40" aria-hidden="true" />
                <Bot className="h-4 w-4 text-primary relative z-10" aria-hidden="true" />
              </button>
            ))}
            {agentsData?.count && agentsData.count > 5 && (
              <div className="h-9 w-9 rounded-full border-2 border-background bg-muted/30 backdrop-blur-md flex items-center justify-center text-[10px] font-bold text-muted-foreground relative z-0">
                +{agentsData.count - 5}
              </div>
            )}
            {/* Current User Filter */}
            <button
               className={cn(
                 "h-9 w-9 rounded-full border-2 border-background bg-primary text-white shadow-soft flex items-center justify-center transition-all hover:scale-110 hover:-translate-y-1 hover:z-20 relative ring-offset-2 ml-2",
                 searchParams.get('assignee') === 'me' && "ring-2 ring-primary scale-110 z-20"
               )}
               aria-label="Filter by my assignments"
               aria-pressed={searchParams.get('assignee') === 'me'}
               onClick={() => {
                 if (searchParams.get('assignee') === 'me') {
                   searchParams.delete('assignee');
                 } else {
                   searchParams.set('assignee', 'me');
                 }
                 setSearchParams(searchParams);
               }}
            >
               <User className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <Button variant="ghost" size="sm" className="h-8 text-[11px] font-bold uppercase tracking-widest text-muted-foreground hover:text-primary">
            <Filter className="h-3 w-3 mr-2" />
            Filters
          </Button>
        </div>
        
        <div className="flex items-center gap-2">
           {/* Add any secondary actions here */}
        </div>
      </div>

      {/* View Content with Liquid Scroll */}
      <div className="flex-1 overflow-y-auto min-h-0 min-w-0 scrollbar-none liquid-fade-y pb-20">
        <Suspense fallback={
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
          </div>
        }>
          <Outlet context={{ project }} />
        </Suspense>
      </div>
    </div>
  );
}
