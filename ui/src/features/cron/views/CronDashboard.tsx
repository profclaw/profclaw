/**
 * Cron Dashboard View
 *
 * Main dashboard for managing scheduled jobs with real-time updates,
 * filtering, and quick actions.
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Clock,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Calendar,
  CheckCircle2,
  XCircle,
  Pause,
  Filter,
  Search,
  Zap,
  TrendingUp,
  Activity,
  BarChart3,
  Globe,
  Wrench,
  Terminal,
  MessageSquare,
  Archive,
} from 'lucide-react';
import { api } from '@/core/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { JobCard } from '../components/JobCard';
import { JobHistoryModal } from '../components/JobHistoryModal';
import { CreateJobModal } from '../components/CreateJobModal';
import { EditJobModal } from '../components/EditJobModal';
import type { JobStatus, JobType, ScheduledJob } from '../types';

// Filter options
const STATUS_OPTIONS: { value: JobStatus | 'all'; label: string; icon: typeof Clock }[] = [
  { value: 'all', label: 'All Status', icon: Clock },
  { value: 'active', label: 'Active', icon: CheckCircle2 },
  { value: 'paused', label: 'Paused', icon: Pause },
  { value: 'completed', label: 'Completed', icon: CheckCircle2 },
  { value: 'failed', label: 'Failed', icon: XCircle },
  { value: 'archived', label: 'Archived', icon: Archive },
];

const TYPE_OPTIONS: { value: JobType | 'all'; label: string; icon: typeof Globe }[] = [
  { value: 'all', label: 'All Types', icon: Calendar },
  { value: 'http', label: 'HTTP', icon: Globe },
  { value: 'tool', label: 'Tool', icon: Wrench },
  { value: 'script', label: 'Script', icon: Terminal },
  { value: 'message', label: 'Message', icon: MessageSquare },
];

export function CronDashboard() {
  const queryClient = useQueryClient();

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<JobStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<JobType | 'all'>('all');

  // Modal state
  const [historyJobId, setHistoryJobId] = useState<string | null>(null);
  const [historyJobName, setHistoryJobName] = useState<string>('');
  const [deleteJobId, setDeleteJobId] = useState<string | null>(null);
  const [editingJob, setEditingJob] = useState<ScheduledJob | null>(null);

  // Fetch jobs
  const { data: jobsData, isLoading, error, refetch } = useQuery({
    queryKey: ['cron-jobs', statusFilter, typeFilter],
    queryFn: () => api.cron.list({
      status: statusFilter !== 'all' ? statusFilter : undefined,
      jobType: typeFilter !== 'all' ? typeFilter : undefined,
      limit: 100,
    }),
    refetchInterval: 10000, // Auto-refresh every 10s
  });

  // Fetch stats
  const { data: statsData } = useQuery({
    queryKey: ['cron-stats'],
    queryFn: () => api.cron.stats(),
    refetchInterval: 30000, // Refresh every 30s
  });

  const jobs = jobsData?.jobs || [];
  const stats = statsData?.stats;

  // Filter jobs by search query
  const filteredJobs = jobs.filter((job) =>
    searchQuery
      ? job.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        job.description?.toLowerCase().includes(searchQuery.toLowerCase())
      : true
  );

  // Mutations
  const triggerMutation = useMutation({
    mutationFn: (id: string) => api.cron.trigger(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cron-jobs'] });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: (id: string) => api.cron.pause(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cron-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['cron-stats'] });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: (id: string) => api.cron.resume(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cron-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['cron-stats'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.cron.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cron-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['cron-stats'] });
      setDeleteJobId(null);
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => api.cron.archive(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cron-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['cron-stats'] });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => api.cron.restore(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cron-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['cron-stats'] });
    },
  });

  // Handlers
  const handleTrigger = useCallback((id: string) => {
    triggerMutation.mutate(id);
  }, [triggerMutation]);

  const handlePause = useCallback((id: string) => {
    pauseMutation.mutate(id);
  }, [pauseMutation]);

  const handleResume = useCallback((id: string) => {
    resumeMutation.mutate(id);
  }, [resumeMutation]);

  const handleViewHistory = useCallback((job: ScheduledJob) => {
    setHistoryJobId(job.id);
    setHistoryJobName(job.name);
  }, []);

  const handleDelete = useCallback((id: string) => {
    setDeleteJobId(id);
  }, []);

  const handleEdit = useCallback((job: ScheduledJob) => {
    setEditingJob(job);
  }, []);

  const handleArchive = useCallback((id: string) => {
    archiveMutation.mutate(id);
  }, [archiveMutation]);

  const handleRestore = useCallback((id: string) => {
    restoreMutation.mutate(id);
  }, [restoreMutation]);

  const confirmDelete = () => {
    if (deleteJobId) {
      deleteMutation.mutate(deleteJobId);
    }
  };

  if (error) {
    return (
      <div className="glass rounded-[28px] p-12 text-center">
        <AlertTriangle className="h-12 w-12 mx-auto text-red-400 mb-4" />
        <p className="text-lg font-bold text-red-400">Error loading scheduled jobs</p>
        <p className="text-sm text-muted-foreground mt-1">{(error as Error).message}</p>
        <Button variant="outline" onClick={() => refetch()} className="mt-4">
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Clock className="h-6 w-6 text-primary" />
            Scheduled Jobs
          </h2>
          <p className="text-muted-foreground text-sm">
            Manage automated tasks with cron schedules or fixed intervals
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={cn('h-4 w-4 mr-2', isLoading && 'animate-spin')} />
            Refresh
          </Button>
          <CreateJobModal />
        </div>
      </header>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div className="glass rounded-2xl p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Calendar className="h-4 w-4" />
              <span className="text-xs">Total Jobs</span>
            </div>
            <div className="text-2xl font-bold">{stats.total}</div>
          </div>
          <div className="glass rounded-2xl p-4">
            <div className="flex items-center gap-2 text-green-500 mb-1">
              <Activity className="h-4 w-4" />
              <span className="text-xs">Active</span>
            </div>
            <div className="text-2xl font-bold text-green-500">{stats.active}</div>
          </div>
          <div className="glass rounded-2xl p-4">
            <div className="flex items-center gap-2 text-amber-500 mb-1">
              <Pause className="h-4 w-4" />
              <span className="text-xs">Paused</span>
            </div>
            <div className="text-2xl font-bold text-amber-500">{stats.paused}</div>
          </div>
          <div className="glass rounded-2xl p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Zap className="h-4 w-4" />
              <span className="text-xs">Total Runs</span>
            </div>
            <div className="text-2xl font-bold">{stats.totalRuns}</div>
          </div>
          <div className="glass rounded-2xl p-4">
            <div className="flex items-center gap-2 text-green-500 mb-1">
              <TrendingUp className="h-4 w-4" />
              <span className="text-xs">Successes</span>
            </div>
            <div className="text-2xl font-bold text-green-500">{stats.totalSuccesses}</div>
          </div>
          <div className="glass rounded-2xl p-4">
            <div className="flex items-center gap-2 text-red-500 mb-1">
              <XCircle className="h-4 w-4" />
              <span className="text-xs">Failures</span>
            </div>
            <div className="text-2xl font-bold text-red-500">{stats.totalFailures}</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search jobs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-white/5 border-white/10 rounded-xl"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Filter className="h-4 w-4" />
              {STATUS_OPTIONS.find(o => o.value === statusFilter)?.label}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {STATUS_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => setStatusFilter(option.value)}
                  className={cn(statusFilter === option.value && 'bg-primary/10')}
                >
                  <Icon className="h-4 w-4 mr-2" />
                  {option.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              {TYPE_OPTIONS.find(o => o.value === typeFilter)?.label}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {TYPE_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => setTypeFilter(option.value)}
                  className={cn(typeFilter === option.value && 'bg-primary/10')}
                >
                  <Icon className="h-4 w-4 mr-2" />
                  {option.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Jobs Grid */}
      {isLoading ? (
        <div className="glass rounded-[28px] p-12 flex flex-col items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
          <p className="text-sm text-muted-foreground">Loading scheduled jobs...</p>
        </div>
      ) : filteredJobs.length === 0 ? (
        <div className="glass rounded-[28px] p-12 text-center">
          <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-1">
            {searchQuery || statusFilter !== 'all' || typeFilter !== 'all'
              ? 'No jobs match your filters'
              : 'No scheduled jobs yet'}
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            {searchQuery || statusFilter !== 'all' || typeFilter !== 'all'
              ? 'Try adjusting your search or filters'
              : 'Create your first scheduled job to automate tasks'}
          </p>
          {!(searchQuery || statusFilter !== 'all' || typeFilter !== 'all') && (
            <CreateJobModal />
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredJobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              onTrigger={handleTrigger}
              onPause={handlePause}
              onResume={handleResume}
              onDelete={handleDelete}
              onViewHistory={() => handleViewHistory(job)}
              onEdit={handleEdit}
              onArchive={handleArchive}
              onRestore={handleRestore}
            />
          ))}
        </div>
      )}

      {/* Job History Modal */}
      <JobHistoryModal
        jobId={historyJobId}
        jobName={historyJobName}
        open={!!historyJobId}
        onOpenChange={(open) => !open && setHistoryJobId(null)}
      />

      {/* Edit Job Modal */}
      <EditJobModal
        job={editingJob}
        open={!!editingJob}
        onOpenChange={(open) => !open && setEditingJob(null)}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteJobId} onOpenChange={(open) => !open && setDeleteJobId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Scheduled Job?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this job and all its run history.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-500 hover:bg-red-600"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete Job'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default CronDashboard;
