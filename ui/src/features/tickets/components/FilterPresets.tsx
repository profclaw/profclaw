/**
 * Filter Presets
 *
 * Quick filter buttons for common ticket filters.
 * Inspired by Plane's filter presets.
 *
 * TODO: Future Enhancements:
 * - [ ] Custom saved filters (per user)
 * - [ ] Filter preset sharing
 * - [ ] Recently used filters
 * - [ ] Filter keyboard shortcuts
 */

import { useState } from 'react';
import {
  User,
  AlertTriangle,
  Clock,
  Calendar,
  Bot,
  CheckCircle2,
  Zap,
  Filter,
  X,
  ChevronDown,
  Save,
} from 'lucide-react';
import type { TicketStatus, TicketPriority, TicketType } from '@/core/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// === Filter Types ===

export interface TicketFilters {
  status?: TicketStatus | TicketStatus[];
  priority?: TicketPriority | TicketPriority[];
  type?: TicketType | TicketType[];
  assignee?: string;
  assigneeAgent?: string;
  createdBy?: 'human' | 'ai';
  labels?: string[];
  projectId?: string;
  search?: string;
  // Date filters
  createdAfter?: string;
  createdBefore?: string;
  dueAfter?: string;
  dueBefore?: string;
}

export interface FilterPreset {
  id: string;
  name: string;
  icon: typeof User;
  description?: string;
  filters: TicketFilters;
  isCustom?: boolean;
}

// === Default Presets ===

const DEFAULT_PRESETS: FilterPreset[] = [
  {
    id: 'my-tickets',
    name: 'My Tickets',
    icon: User,
    description: 'Tickets assigned to you',
    filters: {
      // assignee will be set to current user
      assignee: '__me__',
    },
  },
  {
    id: 'high-priority',
    name: 'High Priority',
    icon: AlertTriangle,
    description: 'Urgent and high priority tickets',
    filters: {
      priority: ['urgent', 'high'] as TicketPriority[],
    },
  },
  {
    id: 'recently-updated',
    name: 'Recently Updated',
    icon: Clock,
    description: 'Updated in the last 24 hours',
    filters: {
      createdAfter: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    },
  },
  {
    id: 'due-soon',
    name: 'Due Soon',
    icon: Calendar,
    description: 'Due within the next 7 days',
    filters: {
      dueAfter: new Date().toISOString(),
      dueBefore: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
  },
  {
    id: 'ai-created',
    name: 'AI Created',
    icon: Bot,
    description: 'Tickets created by AI agents',
    filters: {
      createdBy: 'ai',
    },
  },
  {
    id: 'in-progress',
    name: 'In Progress',
    icon: Zap,
    description: 'Currently being worked on',
    filters: {
      status: 'in_progress' as TicketStatus,
    },
  },
  {
    id: 'completed-today',
    name: 'Completed Today',
    icon: CheckCircle2,
    description: 'Finished today',
    filters: {
      status: 'done' as TicketStatus,
      createdAfter: new Date(new Date().setHours(0, 0, 0, 0)).toISOString(),
    },
  },
];

// === Component Props ===

interface FilterPresetsProps {
  /** Currently active filters */
  activeFilters: TicketFilters;
  /** Callback when filters change */
  onFiltersChange: (filters: TicketFilters) => void;
  /** Current user ID for "My Tickets" preset */
  currentUserId?: string;
  /** Custom saved presets */
  customPresets?: FilterPreset[];
  /** Callback to save a new preset */
  onSavePreset?: (name: string, filters: TicketFilters) => void;
  /** Show as chips or dropdown */
  variant?: 'chips' | 'dropdown';
  /** Additional classes */
  className?: string;
}

export function FilterPresets({
  activeFilters,
  onFiltersChange,
  currentUserId,
  customPresets = [],
  onSavePreset,
  variant = 'chips',
  className,
}: FilterPresetsProps) {
  const [_saveDialogOpen, setSaveDialogOpen] = useState(false);

  // Check if a preset is active
  const isPresetActive = (preset: FilterPreset): boolean => {
    // Simple check - compare filter keys
    const presetFilters = { ...preset.filters };
    if (presetFilters.assignee === '__me__') {
      presetFilters.assignee = currentUserId;
    }

    return Object.entries(presetFilters).every(([key, value]) => {
      const activeValue = activeFilters[key as keyof TicketFilters];
      if (Array.isArray(value) && Array.isArray(activeValue)) {
        return value.every(v => (activeValue as string[]).includes(v as string));
      }
      return activeValue === value;
    });
  };

  // Apply a preset
  const applyPreset = (preset: FilterPreset) => {
    const filters = { ...preset.filters };
    if (filters.assignee === '__me__') {
      filters.assignee = currentUserId;
    }
    onFiltersChange(filters);
  };

  // Clear all filters
  const clearFilters = () => {
    onFiltersChange({});
  };

  // Count active filters
  const activeFilterCount = Object.keys(activeFilters).filter(
    (key) => activeFilters[key as keyof TicketFilters] !== undefined
  ).length;

  // All presets
  const allPresets = [...DEFAULT_PRESETS, ...customPresets];

  // === Chips Variant ===
  if (variant === 'chips') {
    return (
      <div className={cn('flex flex-wrap items-center gap-2', className)}>
        {/* Filter icon with count */}
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Filter className="h-4 w-4" />
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              {activeFilterCount}
            </Badge>
          )}
        </div>

        {/* Preset chips */}
        {allPresets.slice(0, 5).map((preset) => {
          const isActive = isPresetActive(preset);
          const Icon = preset.icon;

          return (
            <button
              key={preset.id}
              onClick={() => isActive ? clearFilters() : applyPreset(preset)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full transition-colors',
                'border',
                isActive
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'bg-muted/50 border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{preset.name}</span>
              {isActive && <X className="h-3 w-3 ml-0.5" />}
            </button>
          );
        })}

        {/* More presets dropdown */}
        {allPresets.length > 5 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 gap-1">
                More
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {allPresets.slice(5).map((preset) => {
                const Icon = preset.icon;
                return (
                  <DropdownMenuItem
                    key={preset.id}
                    onClick={() => applyPreset(preset)}
                  >
                    <Icon className="h-4 w-4 mr-2" />
                    {preset.name}
                  </DropdownMenuItem>
                );
              })}
              {onSavePreset && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setSaveDialogOpen(true)}>
                    <Save className="h-4 w-4 mr-2" />
                    Save current filters
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Clear filters */}
        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-8 text-muted-foreground hover:text-foreground"
          >
            Clear all
          </Button>
        )}
      </div>
    );
  }

  // === Dropdown Variant ===
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn('gap-2', className)}>
          <Filter className="h-4 w-4" />
          Quick Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              {activeFilterCount}
            </Badge>
          )}
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {allPresets.map((preset) => {
          const Icon = preset.icon;
          const isActive = isPresetActive(preset);

          return (
            <DropdownMenuItem
              key={preset.id}
              onClick={() => applyPreset(preset)}
              className={cn(isActive && 'bg-primary/10')}
            >
              <Icon className={cn('h-4 w-4 mr-2', isActive && 'text-primary')} />
              <div className="flex-1">
                <div className={cn(isActive && 'text-primary')}>{preset.name}</div>
                {preset.description && (
                  <div className="text-xs text-muted-foreground">
                    {preset.description}
                  </div>
                )}
              </div>
              {isActive && <CheckCircle2 className="h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          );
        })}

        {activeFilterCount > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={clearFilters}>
              <X className="h-4 w-4 mr-2" />
              Clear all filters
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// === Active Filter Pills ===

interface ActiveFilterPillsProps {
  filters: TicketFilters;
  onRemoveFilter: (key: keyof TicketFilters) => void;
  onClearAll: () => void;
  className?: string;
}

export function ActiveFilterPills({
  filters,
  onRemoveFilter,
  onClearAll,
  className,
}: ActiveFilterPillsProps) {
  const filterEntries = Object.entries(filters).filter(
    ([, value]) => value !== undefined && value !== ''
  );

  if (filterEntries.length === 0) {
    return null;
  }

  const formatFilterValue = (key: string, value: unknown): string => {
    if (Array.isArray(value)) {
      return value.join(', ');
    }
    if (typeof value === 'string') {
      if (key.includes('date') || key.includes('Date')) {
        return new Date(value).toLocaleDateString();
      }
      return value.replace(/_/g, ' ');
    }
    return String(value);
  };

  const formatFilterKey = (key: string): string => {
    const keyMap: Record<string, string> = {
      status: 'Status',
      priority: 'Priority',
      type: 'Type',
      assignee: 'Assignee',
      assigneeAgent: 'AI Agent',
      createdBy: 'Created by',
      labels: 'Labels',
      projectId: 'Project',
      search: 'Search',
      createdAfter: 'Created after',
      createdBefore: 'Created before',
      dueAfter: 'Due after',
      dueBefore: 'Due before',
    };
    return keyMap[key] || key;
  };

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <span className="text-sm text-muted-foreground">Active filters:</span>

      {filterEntries.map(([key, value]) => (
        <Badge
          key={key}
          variant="secondary"
          className="gap-1 pr-1"
        >
          <span className="text-muted-foreground">{formatFilterKey(key)}:</span>
          <span>{formatFilterValue(key, value)}</span>
          <button
            onClick={() => onRemoveFilter(key as keyof TicketFilters)}
            className="ml-1 p-0.5 rounded-full hover:bg-muted-foreground/20"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}

      <Button
        variant="ghost"
        size="sm"
        onClick={onClearAll}
        className="h-6 text-xs text-muted-foreground"
      >
        Clear all
      </Button>
    </div>
  );
}
