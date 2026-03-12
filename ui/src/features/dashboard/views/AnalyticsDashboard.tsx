import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ListTodo,
  CheckCircle2,
  Clock,
  Bot,
  Loader2,
  TrendingUp,
  WifiOff,
  RefreshCw,
  Ticket,
  FolderKanban,
  Zap,
  Sparkles,
  ArrowRight,
  MessageSquare,
  GitBranch,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { formatDistanceToNow } from 'date-fns';
import { api } from '@/core/api/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { VelocityChart } from '../components/VelocityChart';

const POLL_INTERVAL = 5000;

const STATUS_COLORS = {
  pending: '#facc15',
  queued: '#fb923c',
  assigned: '#60a5fa',
  in_progress: '#3b82f6',
  completed: '#22c55e',
  failed: '#ef4444',
  cancelled: '#6b7280',
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'text-red-500',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-blue-400',
  none: 'text-gray-400',
};

// Brand gradient stat card
function GlassStatCard({
  label,
  value,
  icon: Icon,
  trend,
  gradient,
  href,
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  trend?: { value: string; positive: boolean };
  gradient: string;
  href?: string;
}) {
  const content = (
    <div className={cn(
      "group relative overflow-hidden rounded-3xl glass-heavy p-5 transition-all duration-300",
      "hover:shadow-xl hover:scale-[1.02]",
      href && "cursor-pointer"
    )}>
      {/* Gradient background blob */}
      <div className={cn(
        "absolute -top-8 -right-8 h-24 w-24 rounded-full opacity-20 blur-2xl transition-opacity duration-300 group-hover:opacity-30",
        gradient
      )} />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-[11px] font-bold text-muted-foreground/70 uppercase tracking-wider">{label}</p>
          <p className="text-3xl font-black mt-1.5 tracking-tight">{value}</p>
          {trend && (
            <div className="flex items-center gap-1 mt-1.5">
              {trend.positive ? (
                <ArrowUpRight className="h-3 w-3 text-emerald-500" />
              ) : (
                <ArrowDownRight className="h-3 w-3 text-red-400" />
              )}
              <span className={cn(
                "text-[11px] font-semibold",
                trend.positive ? "text-emerald-500" : "text-red-400"
              )}>
                {trend.value}
              </span>
            </div>
          )}
        </div>
        <div className={cn(
          "h-11 w-11 rounded-xl flex items-center justify-center shadow-lg",
          gradient
        )}>
          <Icon className="h-5 w-5 text-white" />
        </div>
      </div>
      {href && (
        <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/20 group-hover:text-muted-foreground/50 transition-colors" />
      )}
    </div>
  );

  if (href) {
    return <Link to={href}>{content}</Link>;
  }
  return content;
}

function MiniDonut({ completed, running, pending, failed }: { completed: number; running: number; pending: number; failed: number }) {
  const data = [
    { name: 'Completed', value: completed, color: STATUS_COLORS.completed },
    { name: 'Running', value: running, color: STATUS_COLORS.in_progress },
    { name: 'Pending', value: pending, color: STATUS_COLORS.pending },
    { name: 'Failed', value: failed, color: STATUS_COLORS.failed },
  ].filter((d) => d.value > 0);

  const total = completed + running + pending + failed;

  if (total === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <div className="text-center">
          <div className="h-12 w-12 rounded-full bg-muted/20 flex items-center justify-center mx-auto mb-2">
            <ListTodo className="h-5 w-5 text-muted-foreground/40" />
          </div>
          <p className="text-xs text-muted-foreground">No tasks</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={35}
            outerRadius={50}
            paddingAngle={2}
            dataKey="value"
            strokeWidth={0}
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const d = payload[0].payload;
                return (
                  <div className="px-2.5 py-1.5 rounded-lg bg-black/90 text-white text-xs border border-white/10">
                    {d.name}: {d.value}
                  </div>
                );
              }
              return null;
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none" aria-hidden="true">
        <span className="text-xl font-bold">{total}</span>
      </div>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, href, linkText }: {
  icon: React.ElementType;
  title: string;
  href?: string;
  linkText?: string;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {href && (
        <Link to={href} className="text-xs text-primary hover:text-primary/80 font-medium flex items-center gap-1">
          {linkText || 'View All'} <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}

function EmptyPlaceholder({ icon: Icon, title, action }: {
  icon: React.ElementType;
  title: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="flex flex-col items-center justify-center py-6 text-center">
      <div className="h-10 w-10 rounded-xl bg-muted/10 flex items-center justify-center mb-2">
        <Icon className="h-5 w-5 text-muted-foreground/40" aria-hidden="true" />
      </div>
      <p className="text-xs text-muted-foreground mb-2">{title}</p>
      {action && (
        <Link to={action.href} className="text-xs text-primary hover:underline font-medium">
          {action.label}
        </Link>
      )}
    </div>
  );
}

function BackendOffline({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="h-20 w-20 rounded-2xl bg-red-500/10 flex items-center justify-center mb-6 border border-red-500/20">
        <WifiOff className="h-10 w-10 text-red-400" />
      </div>
      <h2 className="text-xl font-bold mb-2">Backend Offline</h2>
      <p className="text-muted-foreground text-sm max-w-md mb-6">
        Unable to connect to the API. Make sure the server is running.
      </p>
      <code className="px-4 py-2 rounded-lg bg-black/20 font-mono text-sm text-muted-foreground mb-4">
        pnpm dev
      </code>
      <Button onClick={onRetry} variant="outline" className="rounded-xl gap-2">
        <RefreshCw className="h-4 w-4" />
        Retry
      </Button>
    </div>
  );
}

export function AnalyticsDashboard() {
  const {
    data: tasksData,
    isLoading: tasksLoading,
    error: tasksError,
    refetch: refetchTasks,
  } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => api.tasks.list({ limit: 100 }),
    refetchInterval: (q) => (q.state.error ? false : POLL_INTERVAL),
  });

  const {
    data: statsData,
    isLoading: statsLoading,
    error: statsError,
    refetch: refetchStats,
  } = useQuery({
    queryKey: ['summaries', 'stats'],
    queryFn: () => api.summaries.stats(),
    refetchInterval: (q) => (q.state.error ? false : POLL_INTERVAL * 2),
  });

  const {
    data: dashboardStats,
    isLoading: dashboardLoading,
    error: dashboardError,
    refetch: refetchDashboard,
  } = useQuery({
    queryKey: ['stats', 'dashboard'],
    queryFn: () => api.stats.dashboard(),
    refetchInterval: (q) => (q.state.error ? false : POLL_INTERVAL * 2),
  });

  const { data: ticketsData, refetch: refetchTickets } = useQuery({
    queryKey: ['tickets', 'recent'],
    queryFn: () => api.tickets.list({ limit: 5, sortBy: 'updatedAt', sortOrder: 'desc' }),
    refetchInterval: (q) => (q.state.error ? false : POLL_INTERVAL * 2),
  });

  const { data: agentsData, refetch: refetchAgents } = useQuery({
    queryKey: ['gateway', 'agents'],
    queryFn: () => api.gateway.agents(),
    refetchInterval: (q) => (q.state.error ? false : POLL_INTERVAL * 4),
  });

  const hasError = tasksError || statsError || dashboardError;
  const isLoading = tasksLoading || statsLoading || dashboardLoading;

  const handleRetry = () => {
    refetchTasks();
    refetchStats();
    refetchDashboard();
    refetchTickets();
    refetchAgents();
  };

  if (hasError && !isLoading) {
    return <BackendOffline onRetry={handleRetry} />;
  }

  const tasks = tasksData?.tasks ?? [];
  const pendingCount = tasks.filter((t) => t.status === 'pending').length;
  const runningCount = tasks.filter((t) => t.status === 'in_progress').length;
  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const failedCount = tasks.filter((t) => t.status === 'failed').length;

  const totalTickets = dashboardStats?.tickets.total ?? 0;
  const openTickets = dashboardStats?.tickets.open ?? 0;
  const totalProjects = dashboardStats?.projects.total ?? 0;
  const activeSprints = dashboardStats?.sprints.active ?? 0;

  const tickets = ticketsData?.tickets ?? [];
  const agents = agentsData?.agents ?? [];
  const healthyAgents = agents.filter((a) => a.health?.healthy).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Loading analytics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground">Overview of your AI operations and metrics</p>
        </div>
      </div>

      {/* Glass Stat Cards with Brand Gradients */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <GlassStatCard
          label="Tasks"
          value={tasks.length}
          icon={ListTodo}
          trend={runningCount > 0 ? { value: `${runningCount} running`, positive: true } : undefined}
          gradient="bg-gradient-to-br from-rose-400 to-rose-600"
          href="/tasks"
        />
        <GlassStatCard
          label="Tickets"
          value={totalTickets}
          icon={Ticket}
          trend={openTickets > 0 ? { value: `${openTickets} open`, positive: true } : undefined}
          gradient="bg-gradient-to-br from-rose-500 to-rose-700"
          href="/tickets"
        />
        <GlassStatCard
          label="Projects"
          value={totalProjects}
          icon={FolderKanban}
          trend={activeSprints > 0 ? { value: `${activeSprints} sprints`, positive: true } : undefined}
          gradient="bg-gradient-to-br from-rose-300 to-rose-500"
          href="/projects"
        />
        <GlassStatCard
          label="Completed"
          value={completedCount}
          icon={CheckCircle2}
          gradient="bg-gradient-to-br from-emerald-400 to-emerald-600"
        />
      </div>

      {/* Two Column Layout */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* Left Column */}
        <div className="lg:col-span-3 space-y-6">
          {/* Activity Overview */}
          <Card className="glass overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                Activity Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div className="h-32">
                  <MiniDonut
                    completed={completedCount}
                    running={runningCount}
                    pending={pendingCount}
                    failed={failedCount}
                  />
                  <div className="flex justify-center gap-3 mt-2">
                    {[
                      { color: STATUS_COLORS.completed, label: 'Done' },
                      { color: STATUS_COLORS.in_progress, label: 'Active' },
                      { color: STATUS_COLORS.pending, label: 'Pending' },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center gap-1">
                        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                        <span className="text-[10px] text-muted-foreground">{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="col-span-2 grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-muted/10">
                    <div className="flex items-center gap-2 mb-1">
                      <Zap className="h-3.5 w-3.5 text-amber-400" />
                      <span className="text-xs text-muted-foreground">Sprints</span>
                    </div>
                    <p className="text-lg font-bold">{activeSprints}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-muted/10">
                    <div className="flex items-center gap-2 mb-1">
                      <Sparkles className="h-3.5 w-3.5 text-violet-400" />
                      <span className="text-xs text-muted-foreground">AI Created</span>
                    </div>
                    <p className="text-lg font-bold">{dashboardStats?.tickets.aiCreated ?? 0}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-muted/10">
                    <div className="flex items-center gap-2 mb-1">
                      <GitBranch className="h-3.5 w-3.5 text-cyan-400" />
                      <span className="text-xs text-muted-foreground">Files Changed</span>
                    </div>
                    <p className="text-lg font-bold">{statsData?.filesChangedCount ?? 0}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-muted/10">
                    <div className="flex items-center gap-2 mb-1">
                      <Bot className="h-3.5 w-3.5 text-green-400" />
                      <span className="text-xs text-muted-foreground">Agents</span>
                    </div>
                    <p className="text-lg font-bold">{healthyAgents}/{agents.length}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Velocity Chart with brand colors */}
          {(dashboardStats?.velocity.tasks?.length ?? 0) > 0 && (
            <Card className="glass">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    Velocity (30 days)
                  </CardTitle>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>Avg: <strong className="text-foreground">{dashboardStats?.velocity.weeklyAvg.created ?? 0}</strong>/wk</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="h-48">
                <VelocityChart
                  data={dashboardStats?.velocity.tasks ?? []}
                  showLegend={true}
                  colors={{ created: '#fb7185', completed: '#22c55e' }}
                />
              </CardContent>
            </Card>
          )}

          {/* Recent Tasks */}
          <div>
            <SectionHeader icon={Clock} title="Recent Tasks" href="/tasks" />
            <Card className="glass">
              <CardContent className="p-3">
                {tasks.length > 0 ? (
                  <div className="space-y-1">
                    {tasks.slice(0, 5).map((task) => (
                      <Link
                        key={task.id}
                        to={`/tasks/${task.id}`}
                        className="flex items-center justify-between p-2.5 rounded-xl hover:bg-muted/20 transition-colors group"
                      >
                        <div className="flex-1 min-w-0 mr-3">
                          <p className="truncate text-sm font-medium group-hover:text-primary transition-colors">
                            {task.title}
                          </p>
                          <p className="text-[10px] text-muted-foreground uppercase">{task.source}</p>
                        </div>
                        <Badge
                          variant={
                            task.status === 'completed' ? 'success' :
                            task.status === 'failed' ? 'destructive' :
                            task.status === 'in_progress' ? 'info' : 'secondary'
                          }
                          className={cn("text-[10px]", task.status === 'in_progress' && 'animate-pulse')}
                        >
                          {task.status.replace('_', ' ')}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <EmptyPlaceholder
                    icon={ListTodo}
                    title="No tasks yet"
                    action={{ label: 'Create Task', href: '/tasks?create=true' }}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Right Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Recent Tickets */}
          <div>
            <SectionHeader icon={Ticket} title="Recent Tickets" href="/tickets" />
            <Card className="glass">
              <CardContent className="p-3">
                {tickets.length > 0 ? (
                  <div className="space-y-1">
                    {tickets.slice(0, 5).map((ticket) => (
                      <Link
                        key={ticket.id}
                        to={`/tickets/${ticket.id}`}
                        className="flex items-center gap-2 p-2.5 rounded-xl hover:bg-muted/20 transition-colors group"
                      >
                        <span className={cn("text-[10px] font-mono shrink-0", PRIORITY_COLORS[ticket.priority])}>
                          #{ticket.sequence}
                        </span>
                        <p className="truncate text-sm font-medium group-hover:text-primary transition-colors flex-1">
                          {ticket.title}
                        </p>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <EmptyPlaceholder
                    icon={Ticket}
                    title="No tickets"
                    action={{ label: 'Create Ticket', href: '/tickets?create=true' }}
                  />
                )}
              </CardContent>
            </Card>
          </div>

          {/* AI Agents */}
          {agents.length > 0 && (
            <div>
              <SectionHeader icon={Bot} title="AI Agents" href="/gateway" linkText="Configure" />
              <Card className="glass">
                <CardContent className="p-3">
                  <div className="space-y-1">
                    {agents.slice(0, 4).map((agent) => (
                      <div
                        key={agent.type}
                        className="flex items-center gap-3 p-2.5 rounded-xl bg-muted/5"
                      >
                        <div className={cn(
                          "h-2 w-2 rounded-full shrink-0",
                          agent.health?.healthy ? "bg-green-500" : "bg-gray-500"
                        )} aria-label={agent.health?.healthy ? "Healthy" : "Offline"} />
                        <span className="text-sm font-medium capitalize flex-1">
                          {agent.name || agent.type.replace(/-/g, ' ')}
                        </span>
                        <span className="text-[10px] text-muted-foreground" aria-hidden="true">
                          {agent.health?.healthy ? 'Active' : 'Offline'}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
