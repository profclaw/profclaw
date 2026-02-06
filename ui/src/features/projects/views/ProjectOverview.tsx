import { useState } from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProjectWithRelations, Sprint } from '@/core/types';
import {
  Calendar,
  Target,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  TicketCheck,
  Plus,
  MoreHorizontal,
  Github,
  Ruler,
  Square,
  Plane,
  Link2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { api } from '@/core/api/client';
import { format } from 'date-fns';
import { CreateSprintModal } from '../components/CreateSprintModal';
import { BurndownChart } from '../components/BurndownChart';
import { VelocityChart } from '../components/VelocityChart';

export function ProjectOverview() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { project } = useOutletContext<{ project: ProjectWithRelations }>();
  const [showCreateSprint, setShowCreateSprint] = useState(false);

  const { data: sprintsData } = useQuery({
    queryKey: ['sprints', id],
    queryFn: () => api.projects.sprints.list(id!),
    enabled: !!id,
  });

  const sprints = sprintsData?.sprints || [];

  const startSprint = useMutation({
    mutationFn: (sprintId: string) => api.projects.sprints.start(id!, sprintId),
    onSuccess: () => {
      toast.success('Sprint started');
      queryClient.invalidateQueries({ queryKey: ['sprints', id] });
    },
    onError: (error: Error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to start sprint');
    },
  });

  const completeSprint = useMutation({
    mutationFn: (sprintId: string) => api.projects.sprints.complete(id!, sprintId),
    onSuccess: () => {
      toast.success('Sprint completed');
      queryClient.invalidateQueries({ queryKey: ['sprints', id] });
    },
    onError: (error: Error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to complete sprint');
    },
  });

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
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Tickets', value: project.stats?.totalTickets || 0, icon: TicketCheck, color: 'text-primary', bcolor: 'bg-primary/10' },
          { label: 'Open', value: project.stats?.openTickets || 0, icon: Clock, color: 'text-amber-500', bcolor: 'bg-amber-500/10' },
          { label: 'In Progress', value: project.stats?.inProgressTickets || 0, icon: Play, color: 'text-blue-500', bcolor: 'bg-blue-500/10' },
          { label: 'Done', value: project.stats?.doneTickets || 0, icon: CheckCircle2, color: 'text-green-500', bcolor: 'bg-green-500/10' },
        ].map((stat, i) => (
          <div key={i} className="glass-card p-5 rounded-2xl border border-white/5 flex items-center gap-4 transition-transform hover:scale-[1.02]">
            <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center shadow-inner", stat.bcolor)}>
              <stat.icon className={cn("h-6 w-6", stat.color)} />
            </div>
            <div>
              <p className="text-2xl font-black tracking-tight">{stat.value}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Charts Section */}
      {sprints.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {sprints.find((s: Sprint) => s.status === 'active') && (
            <div className="glass-card p-6 rounded-[28px] border border-white/5 shadow-float">
               <div className="flex items-center gap-2 mb-6">
                <Target className="h-5 w-5 text-primary" />
                <h3 className="text-sm font-bold uppercase tracking-wider">Burndown Chart</h3>
              </div>
              <BurndownChart sprintId={sprints.find((s: Sprint) => s.status === 'active')!.id} />
            </div>
          )}
          <div className="glass-card p-6 rounded-[28px] border border-white/5 shadow-float">
             <div className="flex items-center gap-2 mb-6">
                <Target className="h-5 w-5 text-primary" />
                <h3 className="text-sm font-bold uppercase tracking-wider">Project Velocity</h3>
              </div>
            <VelocityChart projectId={id!} />
          </div>
        </div>
      )}

      {/* Sprints Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            <h2 className="text-sm font-bold uppercase tracking-[0.15em]">Sprint Planning</h2>
          </div>
          <Button size="sm" variant="default" className="btn-primary-filled gap-2 rounded-xl" onClick={() => setShowCreateSprint(true)}>
            <Plus className="h-4 w-4" />
            New Sprint
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {sprints.map((sprint: Sprint) => (
            <div
              key={sprint.id}
              className="glass-card rounded-[22px] border border-white/5 p-5 hover:border-primary/30 transition-all group shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  <div className="mt-1 p-2 rounded-xl bg-white/5 transition-transform group-hover:scale-110">
                    {getSprintStatusIcon(sprint.status)}
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <h3 className="font-bold tracking-tight">{sprint.name}</h3>
                      <span className={cn('text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full border border-white/5 shadow-inner', getSprintStatusColor(sprint.status))}>
                        {sprint.status}
                      </span>
                    </div>
                    {sprint.goal && (
                      <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{sprint.goal}</p>
                    )}
                    <div className="flex items-center gap-4 mt-3 text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest">
                      {sprint.startDate && (
                        <span className="flex items-center gap-1.5 px-2 py-1 bg-white/5 rounded-lg border border-white/5">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(sprint.startDate), 'MMM d')}
                          {sprint.endDate && ` — ${format(new Date(sprint.endDate), 'MMM d')}`}
                        </span>
                      )}
                      {sprint.capacity && (
                        <span className="px-2 py-1 bg-white/5 rounded-lg border border-white/5">{sprint.capacity} Points</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {sprint.status === 'planning' && (
                    <Button
                      size="sm"
                      variant="default"
                      className="btn-primary-filled rounded-xl"
                      onClick={() => startSprint.mutate(sprint.id)}
                      disabled={startSprint.isPending}
                    >
                      Start
                    </Button>
                  )}
                  {sprint.status === 'active' && (
                    <Button
                      size="sm"
                      variant="default"
                      className="btn-primary-filled rounded-xl"
                      onClick={() => completeSprint.mutate(sprint.id)}
                      disabled={completeSprint.isPending}
                    >
                      Complete
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-9 w-9 opacity-0 group-hover:opacity-100 transition-opacity">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}

          {sprints.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 glass-card rounded-[28px] border border-dashed border-white/10">
              <Target className="h-12 w-12 text-muted-foreground/30 mb-4 animate-pulse" />
              <p className="text-sm font-medium text-muted-foreground mb-4">Launch your first sprint effort</p>
              <Button variant="glass" size="sm" className="gap-2 rounded-xl" onClick={() => setShowCreateSprint(true)}>
                <Plus className="h-4 w-4" />
                Create first sprint
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Integrations Section */}
      {project.externalLinks && project.externalLinks.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-[0.15em]">Connected Hubs</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {project.externalLinks.map((link) => (
              <a
                key={link.id}
                href={link.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="glass-card flex items-center gap-4 p-4 rounded-[22px] border border-white/5 hover:border-primary/40 transition-all group overflow-hidden relative"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center shadow-inner group-hover:scale-110 transition-transform">
                  {link.platform === 'github' && <Github className="h-6 w-6" />}
                  {link.platform === 'linear' && <Ruler className="h-6 w-6" />}
                  {link.platform === 'jira' && <Square className="h-6 w-6 text-blue-500" />}
                  {link.platform === 'plane' && <Plane className="h-6 w-6" />}
                  {!['github', 'linear', 'jira', 'plane'].includes(link.platform) && <Link2 className="h-6 w-6" />}
                </div>
                <div className="relative flex-1">
                  <p className="font-bold tracking-tight capitalize">{link.platform}</p>
                  <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest">{link.externalId}</p>
                </div>
                {link.syncEnabled && (
                  <span className="relative text-[9px] font-black uppercase tracking-widest bg-emerald-500/10 text-emerald-500 px-3 py-1 rounded-full border border-emerald-500/20 shadow-sm">
                    Sync Active
                  </span>
                )}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Internal Modals */}
      <CreateSprintModal
        projectId={id!}
        open={showCreateSprint}
        onOpenChange={setShowCreateSprint}
      />
    </div>
  );
}
