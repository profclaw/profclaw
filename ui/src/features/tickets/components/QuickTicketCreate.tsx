/**
 * Quick Ticket Create
 *
 * Notion/Plane-style inline ticket creation.
 * Shows a minimal input that expands on focus.
 * "Press Enter to add another work item" pattern.
 *
 * TODO: Future Enhancements:
 * - [ ] Keyboard shortcuts (Cmd+Enter to create and continue)
 * - [ ] Quick type selection with / commands (/bug, /feature)
 * - [ ] AI auto-categorization as you type
 * - [ ] Template support
 */

import { useState, useRef, useEffect } from 'react';
import type { KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Loader2,
  Bug,
  Sparkles,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { api, type TicketType, type TicketPriority, type TicketStatus, type CreateTicketInput } from '@/core/api/client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { toast } from 'sonner';

interface QuickTicketCreateProps {
  projectId?: string;
  defaultStatus?: TicketStatus;
  defaultType?: TicketType;
  defaultPriority?: TicketPriority;
  onCreated?: (ticketId: string) => void;
  placeholder?: string;
  className?: string;
  /** Compact mode - just shows + icon, expands on click */
  compact?: boolean;
}

const TYPE_OPTIONS = [
  { value: 'task', label: 'Task', icon: CheckCircle2, color: 'text-blue-400' },
  { value: 'bug', label: 'Bug', icon: Bug, color: 'text-red-400' },
  { value: 'feature', label: 'Feature', icon: Sparkles, color: 'text-cyan-400' },
] as const;

const PRIORITY_OPTIONS = [
  { value: 'urgent', label: '!!', color: 'text-red-500' },
  { value: 'high', label: '!', color: 'text-orange-500' },
  { value: 'medium', label: '-', color: 'text-yellow-500' },
  { value: 'low', label: '.', color: 'text-blue-500' },
  { value: 'none', label: '', color: 'text-gray-400' },
] as const;

export function QuickTicketCreate({
  projectId,
  defaultStatus = 'todo',
  defaultType = 'task',
  defaultPriority = 'medium',
  onCreated,
  placeholder = 'Work item title',
  className,
  compact = false,
}: QuickTicketCreateProps) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [isExpanded, setIsExpanded] = useState(!compact);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<TicketType>(defaultType);
  const [priority, setPriority] = useState<TicketPriority>(defaultPriority);
  const [showOptions, setShowOptions] = useState(false);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: CreateTicketInput) => api.tickets.create(data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      toast.success(`Created ${result.ticket.projectKey || 'PROFCLAW'}-${result.ticket.sequence}`);
      onCreated?.(result.ticket.id);

      // Reset for next entry
      setTitle('');
      setShowOptions(false);
      // Keep focus for continuous entry
      inputRef.current?.focus();
    },
    onError: (err: Error) => {
      toast.error(`Failed: ${err.message}`);
    },
  });

  // Focus input when expanded
  useEffect(() => {
    if (isExpanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isExpanded]);

  const handleSubmit = () => {
    if (!title.trim()) return;

    createMutation.mutate({
      title: title.trim(),
      type,
      priority,
      status: defaultStatus,
      projectId: projectId || undefined,
      createdBy: 'human',
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      if (compact && !title) {
        setIsExpanded(false);
      }
      setTitle('');
      setShowOptions(false);
    }
    // Show options on any alphanumeric key
    if (!showOptions && title.length > 0) {
      setShowOptions(true);
    }
  };

  const handleBlur = () => {
    // Delay to allow click on options
    setTimeout(() => {
      if (!title && compact) {
        setIsExpanded(false);
      }
      setShowOptions(false);
    }, 200);
  };

  // Compact mode - show + button
  if (compact && !isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className={cn(
          'flex items-center gap-2 w-full px-3 py-2 text-sm text-muted-foreground',
          'hover:bg-muted/50 rounded-lg transition-colors',
          className
        )}
      >
        <Plus className="h-4 w-4" />
        <span>New work item</span>
      </button>
    );
  }

  const currentType = TYPE_OPTIONS.find(t => t.value === type) || TYPE_OPTIONS[0];
  const currentPriority = PRIORITY_OPTIONS.find(p => p.value === priority) || PRIORITY_OPTIONS[2];

  return (
    <div className={cn('group', className)}>
      {/* Main input row */}
      <div className="flex items-center gap-2">
        {/* Type indicator */}
        <button
          onClick={() => setShowOptions(!showOptions)}
          className={cn(
            'flex items-center justify-center w-6 h-6 rounded',
            'hover:bg-muted/50 transition-colors',
            currentType.color
          )}
        >
          <currentType.icon className="h-4 w-4" />
        </button>

        {/* Title input */}
        <Input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowOptions(title.length > 0)}
          onBlur={handleBlur}
          placeholder={placeholder}
          disabled={createMutation.isPending}
          className={cn(
            'flex-1 h-8 border-0 bg-transparent px-0 shadow-none',
            'placeholder:text-muted-foreground/50',
            'focus-visible:ring-0 focus-visible:ring-offset-0'
          )}
        />

        {/* Loading indicator */}
        {createMutation.isPending && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Options row - visible when typing */}
      {showOptions && title.length > 0 && (
        <div className="flex items-center gap-2 mt-2 ml-8">
          {/* Type selector */}
          <Select value={type} onValueChange={(v) => setType(v as TicketType)}>
            <SelectTrigger className="w-auto h-7 text-xs gap-1 px-2 border-dashed">
              <currentType.icon className={cn('h-3.5 w-3.5', currentType.color)} />
              <span>{currentType.label}</span>
            </SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <div className="flex items-center gap-2">
                    <opt.icon className={cn('h-4 w-4', opt.color)} />
                    <span>{opt.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Priority selector */}
          <Select value={priority} onValueChange={(v) => setPriority(v as TicketPriority)}>
            <SelectTrigger className="w-auto h-7 text-xs gap-1 px-2 border-dashed">
              <AlertCircle className={cn('h-3.5 w-3.5', currentPriority.color)} />
              <span>{priority}</span>
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <div className="flex items-center gap-2">
                    <span className={cn('font-bold', opt.color)}>{opt.label || '-'}</span>
                    <span className="capitalize">{opt.value}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Create button */}
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!title.trim() || createMutation.isPending}
            className="h-7 text-xs px-3"
          >
            Create
          </Button>
        </div>
      )}

      {/* Hint text */}
      <p className="text-xs text-muted-foreground/50 mt-1 ml-8">
        Press <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Enter</kbd> to add another work item
      </p>
    </div>
  );
}

/**
 * Minimal variant - just a + button that shows inline input
 */
export function QuickAddButton({
  projectId,
  status,
  className,
}: {
  projectId?: string;
  status?: TicketStatus;
  className?: string;
}) {
  const [isAdding, setIsAdding] = useState(false);

  if (isAdding) {
    return (
      <QuickTicketCreate
        projectId={projectId}
        defaultStatus={status}
        compact={false}
        className={className}
        onCreated={() => setIsAdding(false)}
      />
    );
  }

  return (
    <button
      onClick={() => setIsAdding(true)}
      className={cn(
        'flex items-center gap-2 w-full px-3 py-2 text-sm text-muted-foreground',
        'hover:bg-muted/50 rounded-lg transition-colors',
        className
      )}
    >
      <Plus className="h-4 w-4" />
      <span>Add work item</span>
    </button>
  );
}
