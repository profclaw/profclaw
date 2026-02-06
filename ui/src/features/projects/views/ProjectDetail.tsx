/**
 * Project Detail View
 *
 * Shows project details with multiple views:
 * - Overview: Stats, charts, sprints
 * - Board: Kanban drag-drop view
 * - Backlog: Unassigned tickets table
 * - Table: All tickets with filters
 */

import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Settings2,
  Plus,
  MoreHorizontal,
  Calendar,
  Target,
  Loader2,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  TicketCheck,
  LayoutDashboard,
  Columns3,
  Inbox,
  Table,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { api } from '@/core/api/client';
import { format } from 'date-fns';
import { ProjectIcon } from '../components/ProjectIcon';
import { CreateSprintModal } from '../components/CreateSprintModal';
import { BurndownChart } from '../components/BurndownChart';
import { VelocityChart } from '../components/VelocityChart';
import { SprintBoard } from '../components/SprintBoard';
import { BacklogTable } from '../components/BacklogTable';

type ViewTab = 'overview' | 'board' | 'backlog' | 'table';

const VIEW_TABS: { id: ViewTab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="h-4 w-4" /> },
  { id: 'board', label: 'Board', icon: <Columns3 className="h-4 w-4" /> },
  { id: 'backlog', label: 'Backlog', icon: <Inbox className="h-4 w-4" /> },
  { id: 'table', label: 'Table', icon: <Table className="h-4 w-4" /> },
];

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreateSprint, setShowCreateSprint] = useState(false);
  const [activeView, setActiveView] = useState<ViewTab>('overview');
  const [selectedSprintId, setSelectedSprintId] = useState<string | undefined>();

  const { data: projectData, isLoading: projectLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.projects.get(id!, 'all'),
    enabled: !!id,
  });

  const { data: sprintsData, isLoading: sprintsLoading } = useQuery({
    queryKey: ['sprints', id],
    queryFn: () => api.projects.sprints.list(id!),
    enabled: !!id,
  });

  // projectData is already the Project (API unwraps it)
  const project = projectData;

  const startSprint = useMutation({
    mutationFn: (sprintId: string) => api.projects.sprints.start(id!, sprintId),
    onSuccess: () => {
      toast.success('Sprint started');
      queryClient.invalidateQueries({ queryKey: ['sprints', id] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to start sprint');
    },
  });

  const completeSprint = useMutation({
    mutationFn: (sprintId: string) => api.projects.sprints.complete(id!, sprintId),
    onSuccess: () => {
      toast.success('Sprint completed');
      queryClient.invalidateQueries({ queryKey: ['sprints', id] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to complete sprint');
    },
  });

  const sprints = sprintsData?.sprints || [];
  const isLoading = projectLoading || sprintsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-muted-foreground">Project not found</p>
        <Button variant="outline" onClick={() => navigate('/projects')}>
          Back to Projects
        </Button>
      </div>
    );
  }

  const getSprintStatusIcon = (status: string) => {
    switch (status) {
      case 'planning':
        return <Clock className="h-4 w-4 text-muted-foreground" />;
      case 'active':
        return <Play className="h-4 w-4 text-blue-500" />;
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'cancelled':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return null;
    }
  };

  const getSprintStatusColor = (status: string) => {
    switch (status) {
      case 'planning':
        return 'bg-muted text-muted-foreground';
      case 'active':
        return 'bg-blue-500/10 text-blue-500';
      case 'completed':
        return 'bg-green-500/10 text-green-500';
      case 'cancelled':
        return 'bg-red-500/10 text-red-500';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/projects')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-4">
            <ProjectIcon icon={project.icon} color={project.color} size="lg" />
            <div>
              <div className="flex items-center gap-2">
                <span
                  className="text-xs font-mono font-bold px-2 py-0.5 rounded"
                  style={{ backgroundColor: `${project.color}20`, color: project.color }}
                >
                  {project.key}
                </span>
                {project.status === 'archived' && (
                  <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded">Archived</span>
                )}
              </div>
              <h1 className="text-2xl font-bold mt-1">{project.name}</h1>
              {project.description && (
                <p className="text-muted-foreground mt-1">{project.description}</p>
              )}
            </div>
          </div>
        </div>
        <Button variant="outline" size="icon">
          <Settings2 className="h-4 w-4" />
        </Button>
      </div>

      {/* View Tabs */}
      <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg w-fit">
        {VIEW_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveView(tab.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all',
              activeView === tab.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview View */}
      {activeView === 'overview' && (
        <>
          {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <TicketCheck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{project.stats?.totalTickets || 0}</p>
              <p className="text-xs text-muted-foreground">Total Tickets</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Clock className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{project.stats?.openTickets || 0}</p>
              <p className="text-xs text-muted-foreground">Open</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Play className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{project.stats?.inProgressTickets || 0}</p>
              <p className="text-xs text-muted-foreground">In Progress</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{project.stats?.doneTickets || 0}</p>
              <p className="text-xs text-muted-foreground">Done</p>
            </div>
          </div>
        </div>
      </div>

      {/* Charts Section */}
      {sprints.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Active Sprint Burndown */}
          {sprints.find((s) => s.status === 'active') && (
            <div className="bg-card rounded-xl border border-border p-4">
              <BurndownChart sprintId={sprints.find((s) => s.status === 'active')!.id} />
            </div>
          )}
          {/* Velocity Chart */}
          <div className="bg-card rounded-xl border border-border p-4">
            <VelocityChart projectId={id!} />
          </div>
        </div>
      )}

      {/* Sprints Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Sprints</h2>
          <Button size="sm" className="gap-2" onClick={() => setShowCreateSprint(true)}>
            <Plus className="h-4 w-4" />
            New Sprint
          </Button>
        </div>

        {sprints.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 bg-muted/30 rounded-xl border border-dashed border-border">
            <Target className="h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground mb-3">No sprints yet</p>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowCreateSprint(true)}>
              <Plus className="h-4 w-4" />
              Create first sprint
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {sprints.map((sprint) => (
              <div
                key={sprint.id}
                className="bg-card rounded-xl border border-border p-4 hover:border-primary/30 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">{getSprintStatusIcon(sprint.status)}</div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium">{sprint.name}</h3>
                        <span className={cn('text-xs px-2 py-0.5 rounded-full capitalize', getSprintStatusColor(sprint.status))}>
                          {sprint.status}
                        </span>
                      </div>
                      {sprint.goal && (
                        <p className="text-sm text-muted-foreground mt-1">{sprint.goal}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        {sprint.startDate && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {format(new Date(sprint.startDate), 'MMM d')}
                            {sprint.endDate && ` - ${format(new Date(sprint.endDate), 'MMM d')}`}
                          </span>
                        )}
                        {sprint.capacity && (
                          <span>{sprint.capacity} points</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {sprint.status === 'planning' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => startSprint.mutate(sprint.id)}
                        disabled={startSprint.isPending}
                      >
                        Start Sprint
                      </Button>
                    )}
                    {sprint.status === 'active' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => completeSprint.mutate(sprint.id)}
                        disabled={completeSprint.isPending}
                      >
                        Complete
                      </Button>
                    )}
                    <Button variant="ghost" size="icon">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* External Links Section */}
      {project.externalLinks && project.externalLinks.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Connected Integrations</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {project.externalLinks.map((link) => (
              <a
                key={link.id}
                href={link.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 bg-card rounded-lg border border-border hover:border-primary/30 transition-colors"
              >
                <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                  {link.platform === 'github' && '🐙'}
                  {link.platform === 'linear' && '📐'}
                  {link.platform === 'jira' && '🔷'}
                  {link.platform === 'plane' && '✈️'}
                </div>
                <div className="flex-1">
                  <p className="font-medium capitalize">{link.platform}</p>
                  <p className="text-xs text-muted-foreground">{link.externalId}</p>
                </div>
                {link.syncEnabled && (
                  <span className="text-xs bg-green-500/10 text-green-500 px-2 py-0.5 rounded-full">
                    Sync Active
                  </span>
                )}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex items-center gap-3 pt-4 border-t border-border">
        <Link to={`/tickets?projectId=${id}`}>
          <Button variant="outline" className="gap-2">
            <TicketCheck className="h-4 w-4" />
            View Tickets
          </Button>
        </Link>
      </div>
        </>
      )}

      {/* Board View - Kanban */}
      {activeView === 'board' && (
        <div className="space-y-4">
          {/* Sprint Selector */}
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-muted-foreground">Sprint:</label>
            <select
              value={selectedSprintId || ''}
              onChange={(e) => setSelectedSprintId(e.target.value || undefined)}
              className="field"
            >
              <option value="">All Tickets</option>
              {sprints.map((sprint) => (
                <option key={sprint.id} value={sprint.id}>
                  {sprint.name} {sprint.status === 'active' ? '(Active)' : ''}
                </option>
              ))}
            </select>
          </div>
          <SprintBoard projectId={id!} sprintId={selectedSprintId} />
        </div>
      )}

      {/* Backlog View */}
      {activeView === 'backlog' && (
        <BacklogTable
          projectId={id!}
          sprints={sprints}
          onCreateTicket={() => navigate(`/tickets?projectId=${id}&create=true`)}
        />
      )}

      {/* Table View - All Tickets */}
      {activeView === 'table' && (
        <BacklogTable
          projectId={id!}
          sprints={sprints}
          showAllTickets={true}
          onCreateTicket={() => navigate(`/tickets?projectId=${id}&create=true`)}
        />
      )}

      {/* Create Sprint Modal */}
      <CreateSprintModal
        projectId={id!}
        open={showCreateSprint}
        onOpenChange={setShowCreateSprint}
      />
    </div>
  );
}
