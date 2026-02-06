/**
 * Edit Job Modal
 *
 * Modal for editing existing scheduled jobs.
 * Allows updating name, description, schedule, payload, and status.
 */

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Clock,
  Save,
  AlertCircle,
  Loader2,
  Info,
  Play,
  Pause,
  Globe,
  Wrench,
  Terminal,
  MessageSquare,
  Timer,
  Tag,
  X,
  Plus,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { api } from '@/core/api/client';
import type { ScheduledJob, JobType } from '../types';

// Job type configuration
const JOB_TYPES: { value: JobType; label: string; icon: typeof Globe }[] = [
  { value: 'http', label: 'HTTP Request', icon: Globe },
  { value: 'tool', label: 'Tool Execution', icon: Wrench },
  { value: 'script', label: 'Shell Script', icon: Terminal },
  { value: 'message', label: 'Notification', icon: MessageSquare },
];

// Cron presets
const CRON_PRESETS = [
  { label: '1 min', value: '* * * * *' },
  { label: '5 min', value: '*/5 * * * *' },
  { label: '15 min', value: '*/15 * * * *' },
  { label: '30 min', value: '*/30 * * * *' },
  { label: 'Hourly', value: '0 * * * *' },
  { label: 'Daily', value: '0 0 * * *' },
  { label: 'Weekly', value: '0 0 * * 0' },
];

// Helper to humanize cron expressions
function humanizeCron(cron: string): string {
  const presets: Record<string, string> = {
    '* * * * *': 'Every minute',
    '*/5 * * * *': 'Every 5 minutes',
    '*/15 * * * *': 'Every 15 minutes',
    '*/30 * * * *': 'Every 30 minutes',
    '0 * * * *': 'Every hour',
    '0 0 * * *': 'Daily at midnight',
    '0 0 * * 0': 'Weekly on Sunday',
    '0 9 * * 1-5': 'Weekdays at 9 AM',
  };
  return presets[cron] || cron;
}

// Guide box component
function GuideBox({ type, children }: { type: 'info' | 'warning' | 'tip'; children: React.ReactNode }) {
  const config = {
    info: { icon: Info, bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-400' },
    warning: { icon: AlertCircle, bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-400' },
    tip: { icon: Info, bg: 'bg-green-500/10', border: 'border-green-500/20', text: 'text-green-400' },
  };
  const { icon: Icon, bg, border, text } = config[type];

  return (
    <div className={cn('flex items-start gap-2 p-3 rounded-lg border text-xs', bg, border, text)}>
      <Icon className="h-4 w-4 shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  );
}

interface EditJobModalProps {
  job: ScheduledJob | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditJobModal({ job, open, onOpenChange }: EditJobModalProps) {
  const queryClient = useQueryClient();

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scheduleType, setScheduleType] = useState<'cron' | 'interval'>('cron');
  const [cronExpression, setCronExpression] = useState('*/5 * * * *');
  const [intervalSeconds, setIntervalSeconds] = useState(300);
  const [payload, setPayload] = useState('{}');
  const [labels, setLabels] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [status, setStatus] = useState<'active' | 'paused'>('active');

  // Initialize form when job changes
  useEffect(() => {
    if (job) {
      setName(job.name);
      setDescription(job.description || '');
      setScheduleType(job.cronExpression ? 'cron' : 'interval');
      setCronExpression(job.cronExpression || '*/5 * * * *');
      setIntervalSeconds(job.intervalMs ? Math.round(job.intervalMs / 1000) : 300);
      setPayload(JSON.stringify(job.payload || {}, null, 2));
      setLabels(job.labels || []);
      setStatus(job.status === 'paused' ? 'paused' : 'active');
    }
  }, [job]);

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: () => {
      if (!job) throw new Error('No job to update');

      const parsedPayload = JSON.parse(payload);

      return api.cron.update(job.id, {
        name,
        description: description || undefined,
        cronExpression: scheduleType === 'cron' ? cronExpression : undefined,
        intervalMs: scheduleType === 'interval' ? intervalSeconds * 1000 : undefined,
        payload: parsedPayload,
        labels,
        status,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cron-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['cron-stats'] });
      onOpenChange(false);
    },
  });

  // Validation
  const isValid = name.trim().length > 0 && (
    (scheduleType === 'cron' && cronExpression.trim().length > 0) ||
    (scheduleType === 'interval' && intervalSeconds >= 1)
  );

  // Add label
  const handleAddLabel = () => {
    const trimmed = newLabel.trim().toLowerCase();
    if (trimmed && !labels.includes(trimmed)) {
      setLabels([...labels, trimmed]);
      setNewLabel('');
    }
  };

  // Remove label
  const handleRemoveLabel = (label: string) => {
    setLabels(labels.filter(l => l !== label));
  };

  if (!job) return null;

  const TypeIcon = JOB_TYPES.find(t => t.value === job.jobType)?.icon || Wrench;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10">
              <TypeIcon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <span className="block">Edit Scheduled Job</span>
              <span className="text-xs font-normal text-muted-foreground">
                {job.jobType.toUpperCase()} • Created {new Date(job.createdAt).toLocaleDateString()}
              </span>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-6 py-4">
          {/* Basic Info */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Job Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Scheduled Job"
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="description">Description (optional)</Label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this job does..."
                className="mt-1.5"
              />
            </div>
          </div>

          {/* Status */}
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Status</Label>
            <div className="flex gap-2">
              <button
                onClick={() => setStatus('active')}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-xl border transition-all',
                  status === 'active'
                    ? 'border-green-500/50 bg-green-500/10 text-green-500'
                    : 'border-border/50 hover:border-border'
                )}
              >
                <Play className="h-4 w-4" />
                Active
              </button>
              <button
                onClick={() => setStatus('paused')}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-xl border transition-all',
                  status === 'paused'
                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-500'
                    : 'border-border/50 hover:border-border'
                )}
              >
                <Pause className="h-4 w-4" />
                Paused
              </button>
            </div>
          </div>

          {/* Schedule */}
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Schedule</Label>

            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setScheduleType('cron')}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all',
                  scheduleType === 'cron'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted hover:bg-muted/80'
                )}
              >
                <Clock className="h-4 w-4" />
                Cron
              </button>
              <button
                onClick={() => setScheduleType('interval')}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all',
                  scheduleType === 'interval'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted hover:bg-muted/80'
                )}
              >
                <Timer className="h-4 w-4" />
                Interval
              </button>
            </div>

            {scheduleType === 'cron' ? (
              <div className="space-y-3">
                <div>
                  <Input
                    value={cronExpression}
                    onChange={(e) => setCronExpression(e.target.value)}
                    placeholder="*/5 * * * *"
                    className="font-mono"
                  />
                  <div className="mt-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20">
                    <div className="flex items-center gap-2 text-sm text-primary">
                      <Play className="h-4 w-4" />
                      <span className="font-medium">{humanizeCron(cronExpression)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {CRON_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      onClick={() => setCronExpression(preset.value)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                        cronExpression === preset.value
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted hover:bg-muted/80'
                      )}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">Every</span>
                  <Input
                    type="number"
                    min={1}
                    value={intervalSeconds}
                    onChange={(e) => setIntervalSeconds(parseInt(e.target.value) || 60)}
                    className="w-24"
                  />
                  <span className="text-sm text-muted-foreground">seconds</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[30, 60, 300, 600, 1800, 3600].map((secs) => (
                    <button
                      key={secs}
                      onClick={() => setIntervalSeconds(secs)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                        intervalSeconds === secs
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted hover:bg-muted/80'
                      )}
                    >
                      {secs < 60 ? `${secs}s` : secs < 3600 ? `${secs / 60}m` : `${secs / 3600}h`}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Labels */}
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Labels</Label>
            <div className="flex flex-wrap gap-2 mb-2">
              {labels.map((label) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 text-primary text-xs"
                >
                  <Tag className="h-3 w-3" />
                  {label}
                  <button
                    onClick={() => handleRemoveLabel(label)}
                    className="ml-1 hover:text-red-500"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Add label..."
                className="flex-1"
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddLabel())}
              />
              <Button variant="outline" size="sm" onClick={handleAddLabel} disabled={!newLabel.trim()}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Payload */}
          <div>
            <Label htmlFor="payload">Payload (JSON)</Label>
            <textarea
              id="payload"
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              rows={6}
              className="w-full mt-1.5 px-3 py-2 rounded-lg border border-border bg-background font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <GuideBox type="info">
              Payload is specific to job type. HTTP jobs need url/method, tool jobs need tool/params.
            </GuideBox>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => updateMutation.mutate()}
            disabled={!isValid || updateMutation.isPending}
            className="gap-2"
          >
            {updateMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
        </div>

        {updateMutation.isError && (
          <div className="mt-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            <AlertCircle className="h-4 w-4 inline mr-2" />
            {(updateMutation.error as Error).message}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default EditJobModal;
