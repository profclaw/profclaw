/**
 * Cron Feature Types
 *
 * Re-exports core types and adds feature-specific types.
 */

export type {
  ScheduledJob,
  JobRunHistory,
  CronStats,
  CreateJobInput,
  UpdateJobInput,
  JobType,
  JobStatus,
} from '@/core/types';

// Feature-specific types
export interface JobCardProps {
  job: import('@/core/types').ScheduledJob;
  onTrigger: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  onViewHistory: (id: string) => void;
  onEdit?: (job: import('@/core/types').ScheduledJob) => void;
  onArchive?: (id: string) => void;
  onRestore?: (id: string) => void;
}

export interface JobHistoryModalProps {
  jobId: string | null;
  jobName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export interface CreateJobModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}
