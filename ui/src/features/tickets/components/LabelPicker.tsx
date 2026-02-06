/**
 * LabelPicker Component
 *
 * A dropdown component for selecting labels on tickets.
 * Supports multi-select with color badges.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, X, Tag, Loader2 } from 'lucide-react';
import { api } from '@/core/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface Label {
  id: string;
  name: string;
  color: string;
  description?: string;
}

const PRESET_COLORS = [
  '#EF4444',
  '#F97316',
  '#EAB308',
  '#22C55E',
  '#06B6D4',
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
];

interface LabelPickerProps {
  ticketId: string;
  projectId: string;
  selectedLabels?: Label[];
  onChange?: (labels: Label[]) => void;
  disabled?: boolean;
  className?: string;
}

export function LabelPicker({
  ticketId,
  projectId,
  selectedLabels = [],
  onChange,
  disabled = false,
  className,
}: LabelPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const queryClient = useQueryClient();

  // Fetch available labels for project
  const { data: labelsData, isLoading } = useQuery({
    queryKey: ['labels', projectId],
    queryFn: () => api.labels.list(projectId, { includeGlobal: true }),
    enabled: !!projectId,
  });

  // Fetch current ticket labels
  const { data: ticketLabelsData } = useQuery({
    queryKey: ['ticket-labels', ticketId],
    queryFn: () => api.labels.getTicketLabels(ticketId),
    enabled: !!ticketId,
  });

  // Set ticket labels mutation
  const setLabelsMutation = useMutation({
    mutationFn: (labelIds: string[]) => api.labels.setTicketLabels(ticketId, labelIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket-labels', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });

  // Create new label mutation
  const createLabelMutation = useMutation({
    mutationFn: () => api.labels.create(projectId, {
      name: newName,
      color: newColor,
    }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['labels', projectId] });
      
      // Auto-select the new label
      const newLabel = result.label;
      const currentLabelIds = currentLabels.map((l: Label) => l.id);
      
      if (onChange) {
        onChange([...currentLabels, newLabel]);
      } else {
        setLabelsMutation.mutate([...currentLabelIds, newLabel.id]);
      }
      
      // Reset state
      setIsCreating(false);
      setSearch('');
      setNewName('');
      setOpen(false);
    },
  });

  const availableLabels = labelsData?.labels ?? [];
  const currentLabels = ticketLabelsData?.labels ?? selectedLabels;
  const selectedIds = new Set(currentLabels.map((l: Label) => l.id));

  const filteredLabels = availableLabels.filter(
    (label) =>
      label.name.toLowerCase().includes(search.toLowerCase()) ||
      label.description?.toLowerCase().includes(search.toLowerCase())
  );

  const handleToggleLabel = (label: Label) => {
    const newSelectedIds = new Set(selectedIds);
    if (newSelectedIds.has(label.id)) {
      newSelectedIds.delete(label.id);
    } else {
      newSelectedIds.add(label.id);
    }

    const newLabels = availableLabels.filter((l) => newSelectedIds.has(l.id));

    if (onChange) {
      onChange(newLabels);
    } else {
      setLabelsMutation.mutate([...newSelectedIds]);
    }
  };

  const handleRemoveLabel = (labelId: string) => {
    const newSelectedIds = new Set(selectedIds);
    newSelectedIds.delete(labelId);

    const newLabels = availableLabels.filter((l) => newSelectedIds.has(l.id));

    if (onChange) {
      onChange(newLabels);
    } else {
      setLabelsMutation.mutate([...newSelectedIds]);
    }
  };

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {/* Selected labels */}
      {currentLabels.map((label: Label) => (
        <Badge
          key={label.id}
          variant="outline"
          className="gap-1 pr-1"
          style={{
            backgroundColor: `${label.color}20`,
            borderColor: label.color,
            color: label.color,
          }}
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: label.color }}
          />
          {label.name}
          {!disabled && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleRemoveLabel(label.id);
              }}
              className="ml-1 rounded-full hover:bg-muted/50"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </Badge>
      ))}

      {/* Add label button */}
      {!disabled && (
        <Popover 
          open={open} 
          onOpenChange={(newOpen) => {
            setOpen(newOpen);
            if (!newOpen) {
              setIsCreating(false);
              setSearch('');
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3 w-3" />
              <Tag className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start">
            {/* Search input */}
            <div className="p-2">
              <Input
                type="text"
                placeholder="Search labels..."
                value={search}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
                className="h-8 text-xs px-2"
              />
            </div>

            {/* Label list */}
            <div className="max-h-64 overflow-y-auto p-1">
              {isLoading ? (
                <div className="p-2 text-center text-sm text-muted-foreground">
                  Loading...
                </div>
              ) : filteredLabels.length === 0 && !search ? (
                <div className="p-2 text-center text-sm text-muted-foreground">
                  No labels found
                </div>
              ) : (
                <>
                  {filteredLabels.map((label) => (
                    <button
                      key={label.id}
                      type="button"
                      onClick={() => handleToggleLabel(label)}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
                    >
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: label.color }}
                      />
                      <span className="flex-1 text-left">{label.name}</span>
                      {selectedIds.has(label.id) && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                    </button>
                  ))}

                  {/* Inline Creation */}
                  {search && (
                    <div className="mt-1 border-t pt-1">
                      {isCreating ? (
                        <div className="p-2 space-y-2">
                          <div className="flex gap-1.5">
                            {PRESET_COLORS.map((c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => setNewColor(c)}
                                className={cn(
                                  "h-4 w-4 rounded-full transition-transform hover:scale-110",
                                  newColor === c && "ring-1 ring-primary ring-offset-1 ring-offset-background"
                                )}
                                style={{ backgroundColor: c }}
                              />
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="h-7 text-[10px] flex-1"
                              onClick={() => createLabelMutation.mutate()}
                              disabled={createLabelMutation.isPending}
                            >
                              {createLabelMutation.isPending ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                "Create"
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-[10px]"
                              onClick={() => {
                                setIsCreating(false);
                                setSearch('');
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setIsCreating(true);
                            setNewName(search);
                          }}
                          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-primary hover:bg-primary/5"
                        >
                          <Plus className="h-3 w-3" />
                          <span>Create "{search}"</span>
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/**
 * Simple label display (read-only)
 */
export function LabelDisplay({ labels }: { labels: Label[] }) {
  if (labels.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {labels.map((label) => (
        <Badge
          key={label.id}
          variant="outline"
          className="gap-1"
          style={{
            backgroundColor: `${label.color}20`,
            borderColor: label.color,
            color: label.color,
          }}
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: label.color }}
          />
          {label.name}
        </Badge>
      ))}
    </div>
  );
}
