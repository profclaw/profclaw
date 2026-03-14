import type { ComponentType } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Calendar, Hash, ExternalLink,
  Play, Square, RotateCcw, ChevronRight,
  Terminal, History, Activity, Loader2
} from 'lucide-react';
import { StatusIndicator } from '@/components/shared/StatusIndicator';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { api } from '@/core/api/client';
import { useTaskById as useTask } from '../api/tasks';
import { toast } from 'sonner';

export function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: task, isLoading, error } = useTask(id || '');

  const cancelMutation = useMutation({
    mutationFn: () => api.tasks.cancel(id!),
    onSuccess: () => {
      toast.success('Task cancelled');
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to cancel task');
    },
  });

  const retryMutation = useMutation({
    mutationFn: () => api.tasks.retry(id!),
    onSuccess: (data) => {
      toast.success('Task queued for retry');
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      navigate(`/tasks/${data.task.id}`);
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to retry task');
    },
  });

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="h-8 w-32 glass animate-pulse rounded-lg" />
        <div className="h-64 glass animate-pulse rounded-[24px]" />
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="max-w-5xl mx-auto glass rounded-[24px] p-20 text-center">
        <Hash className="h-16 w-16 mx-auto text-red-500 mb-4 opacity-20" />
        <h3 className="text-xl font-bold">Task Not Found</h3>
        <p className="text-muted-foreground mb-6">The task you're looking for doesn't exist or has been archived.</p>
        <Link to="/tasks">
          <Button variant="outline" className="rounded-xl px-6">Back to Tasks</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-8">
      {/* Breadcrumbs & Navigation */}
      <nav className="flex items-center gap-2">
        <Link to="/tasks" className="p-2 hover:bg-white/5 rounded-full transition-colors group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
        </Link>
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          <Link to="/tasks" className="hover:text-foreground transition-colors">Tasks</Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-foreground truncate max-w-[200px]">{task.title}</span>
        </div>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Main Info Column */}
        <div className="lg:col-span-2 space-y-8">
          {/* Main header card */}
          <div className="glass rounded-[32px] p-8 relative overflow-hidden">
             {/* Decorative status glow */}
             <div className={cn(
               "absolute -top-24 -right-24 w-64 h-64 rounded-full blur-[100px] opacity-10",
               task.status === 'completed' ? "bg-green-500" : task.status === 'failed' ? "bg-red-500" : "bg-blue-500"
             )} />

            <div className="flex items-start justify-between mb-6">
              <div className="space-y-1">
                 <div className="flex items-center gap-3 mb-2">
                    <StatusIndicator 
                      status={task.status === 'completed' ? 'online' : task.status === 'failed' ? 'error' : task.status === 'in_progress' ? 'processing' : 'offline'} 
                      label={task.status}
                      size="md"
                    />
                    <span className="text-xs font-mono text-muted-foreground opacity-50">#{task.id.split('-')[0]}</span>
                 </div>
                 <h1 className="text-3xl font-extrabold tracking-tight leading-tight">{task.title}</h1>
              </div>
              <div className="flex gap-2">
                 {(task.status === 'failed' || task.status === 'completed') && (
                   <Button
                     variant="outline"
                     size="icon"
                     onClick={() => retryMutation.mutate()}
                     disabled={retryMutation.isPending}
                     title="Retry task"
                   >
                     {retryMutation.isPending ? (
                       <Loader2 className="h-4 w-4 animate-spin" />
                     ) : (
                       <RotateCcw className="h-4 w-4" />
                     )}
                   </Button>
                 )}
                 {(task.status === 'in_progress' || task.status === 'pending') && (
                   <Button
                     variant="destructive"
                     onClick={() => cancelMutation.mutate()}
                     disabled={cancelMutation.isPending}
                   >
                     {cancelMutation.isPending ? (
                       <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                     ) : (
                       <Square className="mr-2 h-4 w-4 fill-current" />
                     )}
                     Cancel
                   </Button>
                 )}
                 {(task.status === 'failed' || task.status === 'completed') && (
                   <Button
                     onClick={() => retryMutation.mutate()}
                     disabled={retryMutation.isPending}
                   >
                     {retryMutation.isPending ? (
                       <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                     ) : (
                       <Play className="mr-2 h-4 w-4 fill-current" />
                     )}
                     Run Again
                   </Button>
                 )}
              </div>
            </div>

            <p className="text-muted-foreground leading-relaxed mb-6">
              {task.description || "No description provided for this task."}
            </p>

            <div className="flex flex-wrap gap-4 pt-6 border-t border-white/5">
              <TaskMeta label="Source" value={task.source} icon={ExternalLink} {...(task.sourceUrl ? { href: task.sourceUrl } : {})} />
              <TaskMeta label="Priority" value={`P${task.priority}`} icon={Hash} />
              <TaskMeta label="Created" value={new Date(task.createdAt).toLocaleDateString()} icon={Calendar} />
            </div>
          </div>

          {/* Prompt Section */}
          <div className="glass rounded-[24px] overflow-hidden shadow-inner">
             <div className="flex items-center gap-3 px-6 py-4 bg-primary/5">
                <div className="h-8 w-8 rounded-lg glass-heavy flex items-center justify-center shadow-sm">
                  <Terminal className="h-4 w-4 text-primary" />
                </div>
                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-foreground/80">Instruction Prompt</h3>
             </div>
             <div className="p-6 recessed-card font-mono text-xs leading-relaxed text-foreground/80 overflow-x-auto whitespace-pre-wrap selection:bg-primary/20">
               {task.prompt}
             </div>
          </div>
        </div>

        {/* Sidebar Info Column */}
        <div className="space-y-8">
           {/* Timeline Card */}
           <div className="glass rounded-[28px] p-6">
              <div className="flex items-center gap-3 mb-6">
                 <History className="h-4 w-4 text-indigo-400" />
                 <h3 className="text-sm font-bold uppercase tracking-widest">Task Timeline</h3>
              </div>
              
              <div className="relative pl-6 space-y-8 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[2px] before:bg-white/5">
                 <TimelineItem 
                    title="Task Created" 
                    time={new Date(task.createdAt).toLocaleTimeString()}
                    status="completed"
                 />
                 {task.startedAt && (
                   <TimelineItem 
                      title="Optimization Started" 
                      time={new Date(task.startedAt).toLocaleTimeString()}
                      status="completed"
                   />
                 )}
                 <TimelineItem 
                    title={task.status === 'pending' ? 'Queued' : task.status === 'in_progress' ? 'In Progress' : task.status === 'completed' ? 'Success' : 'Failed'} 
                    time={task.completedAt ? new Date(task.completedAt).toLocaleTimeString() : 'Current Step'}
                    status={task.status === 'completed' ? 'completed' : task.status === 'failed' ? 'error' : 'processing'}
                 />
              </div>
           </div>

           {/* Metrics Card */}
           <div className="glass rounded-[28px] p-6">
              <div className="flex items-center gap-3 mb-6">
                 <Activity className="h-4 w-4 text-emerald-400" />
                 <h3 className="text-sm font-bold uppercase tracking-widest">Work Metrics</h3>
              </div>
              <div className="space-y-4">
                 <MetricRow label="Status" value={task.status.toUpperCase()} />
                 <MetricRow label="Duration" value={task.completedAt ? `${((new Date(task.completedAt).getTime() - new Date(task.startedAt || task.createdAt).getTime()) / 1000).toFixed(1)}s` : '--'} />
                 <MetricRow label="Assigned Agent" value={task.assignedAgent ?? 'Unassigned'} />
              </div>
           </div>
        </div>
      </div>
    </div>
  );
}

function TaskMeta({ label, value, icon: Icon, href }: { label: string, value: string, icon: ComponentType<{ className?: string }>, href?: string }) {
  const content = (
    <div className="flex items-center gap-2 group/meta cursor-default">
      <div className="h-8 w-8 rounded-lg glass-heavy flex items-center justify-center border-white/5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground group-hover/meta:text-[var(--primary)] transition-colors" />
      </div>
      <div className="flex flex-col">
        <span className="premium-label">{label}</span>
        <span className="text-[11px] font-bold truncate max-w-[120px]">{value}</span>
      </div>
    </div>
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity">
        {content}
      </a>
    );
  }

  return content;
}

function TimelineItem({ title, time, status }: { title: string, time: string, status: 'completed' | 'processing' | 'error' }) {
  return (
    <div className="relative">
      <div className={cn(
        "absolute -left-[23px] top-1.5 h-3.5 w-3.5 rounded-full border-2 border-background z-10",
        status === 'completed' ? "bg-green-500 shadow-[0_0_8px_oklch(0.6_0.2_150)]" : 
        status === 'error' ? "bg-red-500 shadow-[0_0_8px_oklch(0.6_0.2_20)]" : 
        "bg-blue-500 shadow-[0_0_8px_oklch(0.6_0.2_250)] animate-pulse"
      )} />
      <div className="flex flex-col">
        <span className="text-[13px] font-bold">{title}</span>
        <span className="text-[10px] text-muted-foreground font-medium">{time}</span>
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <span className="text-[11px] font-extrabold uppercase tracking-tight">{value}</span>
    </div>
  );
}
