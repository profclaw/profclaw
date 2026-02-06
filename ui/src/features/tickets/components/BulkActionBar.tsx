import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Trash2, ArrowRight, Tag, Loader2 } from 'lucide-react';
import { api } from '@/core/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { TicketStatus, TicketPriority } from '@/core/types';

interface BulkActionBarProps {
  selectedIds: string[];
  onClear: () => void;
  onComplete?: () => void;
}

export function BulkActionBar({ selectedIds, onClear, onComplete }: BulkActionBarProps) {
  const queryClient = useQueryClient();

  const updateStatusMutation = useMutation({
    mutationFn: async (status: TicketStatus) => {
      const results = await Promise.allSettled(
        selectedIds.map((id) => api.tickets.update(id, { status } as Record<string, unknown>))
      );

      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        throw new Error(`${failed} ticket(s) failed to update`);
      }

      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      toast.success(`Updated status for ${selectedIds.length} ticket(s)`);
      onComplete?.();
      onClear();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update status');
    },
  });

  const updatePriorityMutation = useMutation({
    mutationFn: async (priority: TicketPriority) => {
      const results = await Promise.allSettled(
        selectedIds.map((id) => api.tickets.update(id, { priority } as Record<string, unknown>))
      );

      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        throw new Error(`${failed} ticket(s) failed to update`);
      }

      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      toast.success(`Updated priority for ${selectedIds.length} ticket(s)`);
      onComplete?.();
      onClear();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update priority');
    },
  });

  const handleDelete = () => {
    console.log('[BulkActionBar] Delete action triggered for IDs:', selectedIds);
    toast.info(`Delete action logged for ${selectedIds.length} ticket(s)`);
  };

  const isLoading = updateStatusMutation.isPending || updatePriorityMutation.isPending;

  if (selectedIds.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'fixed bottom-6 left-1/2 -translate-x-1/2 z-50',
        'transition-all duration-300',
        selectedIds.length > 0 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
      )}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl backdrop-blur-xl px-4 py-3 flex items-center gap-3">
        {/* Clear selection button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          disabled={isLoading}
          className="h-8 w-8 p-0 text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800"
        >
          <X className="h-4 w-4" />
        </Button>

        {/* Selected count badge */}
        <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30">
          {selectedIds.length} selected
        </Badge>

        <div className="h-6 w-px bg-zinc-700" />

        {/* Change Status */}
        <div className="flex items-center gap-2">
          <ArrowRight className="h-4 w-4 text-zinc-500" />
          <Select
            disabled={isLoading}
            onValueChange={(value) => updateStatusMutation.mutate(value as TicketStatus)}
          >
            <SelectTrigger className="h-8 w-[140px] bg-zinc-800 border-zinc-700 text-sm">
              <SelectValue placeholder="Change status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="backlog">Backlog</SelectItem>
              <SelectItem value="todo">Todo</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="in_review">In Review</SelectItem>
              <SelectItem value="done">Done</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Change Priority */}
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-zinc-500" />
          <Select
            disabled={isLoading}
            onValueChange={(value) => updatePriorityMutation.mutate(value as TicketPriority)}
          >
            <SelectTrigger className="h-8 w-[140px] bg-zinc-800 border-zinc-700 text-sm">
              <SelectValue placeholder="Change priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="urgent">Urgent</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="none">None</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="h-6 w-px bg-zinc-700" />

        {/* Delete button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDelete}
          disabled={isLoading}
          className="h-8 px-3 text-red-400 hover:text-red-300 hover:bg-red-500/10"
        >
          <Trash2 className="h-4 w-4 mr-1.5" />
          Delete
        </Button>

        {/* Loading indicator */}
        {isLoading && (
          <>
            <div className="h-6 w-px bg-zinc-700" />
            <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
          </>
        )}
      </div>
    </div>
  );
}
