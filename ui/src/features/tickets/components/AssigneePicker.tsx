import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UserCircle, Bot, X, ChevronDown, Loader2 } from 'lucide-react';
import { api } from '@/core/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface AssigneePickerProps {
  ticketId: string;
  currentAssignee?: string;
  currentAgent?: string;
  compact?: boolean;
}

const AVAILABLE_AGENTS = [
  'profclaw-assistant',
  'code-reviewer',
  'bug-fixer',
  'test-runner',
];

export function AssigneePicker({
  ticketId,
  currentAssignee,
  currentAgent,
  compact = false,
}: AssigneePickerProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const updateAssigneeMutation = useMutation({
    mutationFn: async (assigneeAgent: string | null) => {
      return api.tickets.update(ticketId, {
        assigneeAgent: assigneeAgent ?? undefined,
      } as Record<string, unknown>);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      toast.success('Assignee updated');
      setOpen(false);
    },
    onError: (error) => {
      toast.error(`Failed to update assignee: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });

  const handleSelect = (agent: string | null): void => {
    updateAssigneeMutation.mutate(agent);
  };

  const displayName = currentAgent || currentAssignee || 'Unassigned';
  const isAssigned = Boolean(currentAgent || currentAssignee);
  const isLoading = updateAssigneeMutation.isPending;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            'justify-between gap-2 font-normal',
            compact ? 'h-8 px-2 text-xs' : 'h-9 px-3 text-sm',
            !isAssigned && 'text-zinc-500'
          )}
          disabled={isLoading}
        >
          <div className="flex items-center gap-2">
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : currentAgent ? (
              <Bot className="h-4 w-4 text-indigo-400" />
            ) : currentAssignee ? (
              <UserCircle className="h-4 w-4 text-zinc-400" />
            ) : (
              <UserCircle className="h-4 w-4 text-zinc-500" />
            )}
            <span className={cn(currentAgent && 'text-indigo-400')}>
              {displayName}
            </span>
          </div>
          <ChevronDown className="h-4 w-4 text-zinc-500" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-56 border-zinc-800 bg-zinc-900/50 p-2 backdrop-blur-sm"
        align="start"
      >
        <div className="space-y-1">
          {/* Unassign option */}
          <button
            onClick={() => handleSelect(null)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
              'hover:bg-zinc-800/50',
              !isAssigned && 'bg-zinc-800/30 text-indigo-400'
            )}
            disabled={isLoading}
          >
            <X className="h-4 w-4 text-zinc-500" />
            <span className="text-zinc-300">Unassigned</span>
          </button>

          <div className="my-2 h-px bg-zinc-800" />

          {/* Agent options */}
          <div className="space-y-1">
            <div className="px-3 py-1 text-xs font-medium text-zinc-500">
              Agents
            </div>
            {AVAILABLE_AGENTS.map((agent) => (
              <button
                key={agent}
                onClick={() => handleSelect(agent)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                  'hover:bg-zinc-800/50',
                  currentAgent === agent && 'bg-zinc-800/30 text-indigo-400'
                )}
                disabled={isLoading}
              >
                <Bot
                  className={cn(
                    'h-4 w-4',
                    currentAgent === agent ? 'text-indigo-400' : 'text-zinc-500'
                  )}
                />
                <span className="text-zinc-300">{agent}</span>
                {currentAgent === agent && (
                  <Badge
                    variant="outline"
                    className="ml-auto border-indigo-500/30 bg-indigo-500/10 text-xs text-indigo-400"
                  >
                    Active
                  </Badge>
                )}
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
