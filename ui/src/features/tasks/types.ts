export interface Task {
  id: string;
  title: string;
  description?: string;
  prompt: string;
  status: 'pending' | 'queued' | 'assigned' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  priority: number;
  source: string;
  sourceId?: string;
  sourceUrl?: string;
  assignedAgent?: string;
  repository?: string;
  branch?: string;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}
