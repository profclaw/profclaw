/**
 * Create Sprint Modal
 *
 * Improved modal for creating sprints with:
 * - Date range picker with calendar
 * - Quick presets for common sprint durations
 * - Draft mode (no dates required)
 * - Clean, Linear/Plane-inspired UX
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import {
  Loader2,
  Target,
  Zap,
  FileEdit,
  Calendar,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { api } from '@/core/api/client';

interface CreateSprintModalProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

type CreationMode = 'quick' | 'detailed';

export function CreateSprintModal({
  projectId,
  open,
  onOpenChange,
  onSuccess,
}: CreateSprintModalProps) {
  const queryClient = useQueryClient();

  // Form state
  const [mode, setMode] = useState<CreationMode>('quick');
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [description, setDescription] = useState('');
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [capacity, setCapacity] = useState('');
  const [isDraft, setIsDraft] = useState(false);

  const createSprint = useMutation({
    mutationFn: () => {
      const startDate = dateRange?.from
        ? format(dateRange.from, 'yyyy-MM-dd')
        : undefined;
      const endDate = dateRange?.to
        ? format(dateRange.to, 'yyyy-MM-dd')
        : undefined;

      return api.projects.sprints.create(projectId, {
        name,
        goal: goal || undefined,
        description: mode === 'detailed' && description ? description : undefined,
        startDate: isDraft ? undefined : startDate,
        endDate: isDraft ? undefined : endDate,
        capacity: capacity ? parseInt(capacity) : undefined,
      });
    },
    onSuccess: () => {
      toast.success('Sprint created');
      queryClient.invalidateQueries({ queryKey: ['sprints', projectId] });
      onOpenChange(false);
      resetForm();
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create sprint');
    },
  });

  const resetForm = () => {
    setName('');
    setGoal('');
    setDescription('');
    setDateRange(undefined);
    setCapacity('');
    setIsDraft(false);
    setMode('quick');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Sprint name is required');
      return;
    }
    createSprint.mutate();
  };

  // Calculate sprint duration in days
  const getDuration = () => {
    if (!dateRange?.from || !dateRange?.to) return null;
    const days = Math.ceil(
      (dateRange.to.getTime() - dateRange.from.getTime()) / (1000 * 60 * 60 * 24)
    );
    return days;
  };

  const duration = getDuration();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg overflow-hidden">
        <DialogHeader className="pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10">
              <Target className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-lg">Create Sprint</DialogTitle>
              <DialogDescription className="text-sm">
                Plan a new iteration for your project
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Mode Selector */}
        <div className="flex gap-2 p-1 bg-muted/50 rounded-lg">
          <button
            type="button"
            onClick={() => setMode('quick')}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-all',
              mode === 'quick'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Zap className="h-4 w-4" />
            Quick Create
          </button>
          <button
            type="button"
            onClick={() => setMode('detailed')}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-all',
              mode === 'detailed'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <FileEdit className="h-4 w-4" />
            Detailed
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Sprint Name - Always visible */}
          <div className="space-y-2">
            <Label htmlFor="name" className="text-sm font-medium">
              Sprint Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sprint 1"
              className="h-10"
              autoFocus
            />
          </div>

          {/* Date Range - With Draft Toggle */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                Duration
              </Label>
              <button
                type="button"
                onClick={() => {
                  setIsDraft(!isDraft);
                  if (!isDraft) setDateRange(undefined);
                }}
                className={cn(
                  'text-xs px-2 py-1 rounded-md transition-colors',
                  isDraft
                    ? 'bg-amber-500/10 text-amber-500'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                {isDraft ? '📝 Draft Mode' : 'Save as draft'}
              </button>
            </div>

            {isDraft ? (
              <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  Draft sprints have no dates. You can add dates later when you're ready to start.
                </p>
              </div>
            ) : (
              <DateRangePicker
                value={dateRange}
                onChange={setDateRange}
                placeholder="Select sprint dates"
              />
            )}

            {duration && !isDraft && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-primary" />
                {duration} day{duration !== 1 ? 's' : ''} sprint
              </p>
            )}
          </div>

          {/* Goal - Always visible but simplified in quick mode */}
          <div className="space-y-2">
            <Label htmlFor="goal" className="text-sm font-medium">
              Sprint Goal
            </Label>
            <Textarea
              id="goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="What do you want to achieve?"
              className="resize-none"
              rows={mode === 'quick' ? 2 : 3}
            />
          </div>

          {/* Detailed Mode: Additional Fields */}
          {mode === 'detailed' && (
            <>
              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description" className="text-sm font-medium">
                  Description
                </Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Additional details about this sprint..."
                  className="resize-none"
                  rows={3}
                />
              </div>

              {/* Capacity */}
              <div className="space-y-2">
                <Label htmlFor="capacity" className="text-sm font-medium flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  Capacity (Story Points)
                </Label>
                <Input
                  id="capacity"
                  type="number"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  placeholder="e.g., 20"
                  className="w-32 h-10"
                  min={0}
                />
                <p className="text-xs text-muted-foreground">
                  Total story points planned for this sprint
                </p>
              </div>
            </>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-4 border-t border-border">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || createSprint.isPending}
              className="gap-2 min-w-30"
            >
              {createSprint.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Target className="h-4 w-4" />
                  {isDraft ? 'Save Draft' : 'Create Sprint'}
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
