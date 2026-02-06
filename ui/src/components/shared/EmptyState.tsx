/**
 * Empty State Component
 *
 * Reusable empty state displays for when there's no data.
 * Provides helpful messages and optional actions.
 *
 * Inspired by Plane's empty state patterns.
 *
 * TODO: Future Enhancements:
 * - [ ] Animated illustrations
 * - [ ] Contextual tips based on user history
 * - [ ] Quick action shortcuts
 */

import {
  Inbox,
  Search,
  Filter,
  FolderOpen,
  Ticket,
  Calendar,
  LayoutGrid,
  Bot,
  Zap,
  Plus,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// === Preset Types ===

type EmptyStatePreset =
  | 'no-tickets'
  | 'no-search-results'
  | 'no-filter-results'
  | 'no-projects'
  | 'no-tasks'
  | 'no-activity'
  | 'empty-board-column'
  | 'no-agents'
  | 'no-integrations'
  | 'error';

// === Preset Configurations ===

const PRESETS: Record<EmptyStatePreset, {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  secondaryLabel?: string;
}> = {
  'no-tickets': {
    icon: Ticket,
    title: 'No tickets yet',
    description: 'Create your first ticket to start tracking work',
    actionLabel: 'Create ticket',
  },
  'no-search-results': {
    icon: Search,
    title: 'No results found',
    description: 'Try adjusting your search terms or filters',
    actionLabel: 'Clear search',
  },
  'no-filter-results': {
    icon: Filter,
    title: 'No matching items',
    description: 'No items match your current filters',
    actionLabel: 'Clear filters',
    secondaryLabel: 'Modify filters',
  },
  'no-projects': {
    icon: FolderOpen,
    title: 'No projects yet',
    description: 'Create a project to organize your tickets',
    actionLabel: 'Create project',
  },
  'no-tasks': {
    icon: Inbox,
    title: 'No tasks in queue',
    description: 'Tasks will appear here when AI agents pick them up',
  },
  'no-activity': {
    icon: Calendar,
    title: 'No recent activity',
    description: 'Activity will show up as changes are made',
  },
  'empty-board-column': {
    icon: LayoutGrid,
    title: 'No items',
    description: 'Drag items here or create new ones',
    actionLabel: 'Add item',
  },
  'no-agents': {
    icon: Bot,
    title: 'No AI agents configured',
    description: 'Connect an AI agent to automate your workflow',
    actionLabel: 'Configure agents',
  },
  'no-integrations': {
    icon: Zap,
    title: 'No integrations',
    description: 'Connect external tools like GitHub, Linear, or Jira',
    actionLabel: 'Add integration',
  },
  'error': {
    icon: Inbox,
    title: 'Something went wrong',
    description: 'We encountered an error loading this content',
    actionLabel: 'Try again',
  },
};

// === Component Props ===

interface EmptyStateProps {
  /** Use a preset configuration */
  preset?: EmptyStatePreset;
  /** Custom icon (overrides preset) */
  icon?: LucideIcon;
  /** Custom title (overrides preset) */
  title?: string;
  /** Custom description (overrides preset) */
  description?: string;
  /** Primary action button label */
  actionLabel?: string;
  /** Primary action callback */
  onAction?: () => void;
  /** Secondary action label */
  secondaryLabel?: string;
  /** Secondary action callback */
  onSecondary?: () => void;
  /** Additional content (e.g., tips, links) */
  children?: React.ReactNode;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Additional classes */
  className?: string;
}

export function EmptyState({
  preset,
  icon: customIcon,
  title: customTitle,
  description: customDescription,
  actionLabel: customActionLabel,
  onAction,
  secondaryLabel: customSecondaryLabel,
  onSecondary,
  children,
  size = 'md',
  className,
}: EmptyStateProps) {
  // Get preset config
  const presetConfig = preset ? PRESETS[preset] : null;

  // Merge with custom props
  const Icon = customIcon || presetConfig?.icon || Inbox;
  const title = customTitle || presetConfig?.title || 'Nothing here';
  const description = customDescription || presetConfig?.description || '';
  const actionLabel = customActionLabel || presetConfig?.actionLabel;
  const secondaryLabel = customSecondaryLabel || presetConfig?.secondaryLabel;

  // Size classes
  const sizeClasses = {
    sm: {
      container: 'py-6 px-4',
      icon: 'h-8 w-8',
      iconWrapper: 'w-12 h-12',
      title: 'text-sm',
      description: 'text-xs',
    },
    md: {
      container: 'py-12 px-6',
      icon: 'h-10 w-10',
      iconWrapper: 'w-16 h-16',
      title: 'text-base',
      description: 'text-sm',
    },
    lg: {
      container: 'py-16 px-8',
      icon: 'h-12 w-12',
      iconWrapper: 'w-20 h-20',
      title: 'text-lg',
      description: 'text-base',
    },
  };

  const sizes = sizeClasses[size];

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        sizes.container,
        className
      )}
    >
      {/* Icon */}
      <div
        className={cn(
          'rounded-full bg-muted/50 flex items-center justify-center mb-4',
          sizes.iconWrapper
        )}
      >
        <Icon className={cn('text-muted-foreground/50', sizes.icon)} />
      </div>

      {/* Title */}
      <h3 className={cn('font-medium text-foreground mb-1', sizes.title)}>
        {title}
      </h3>

      {/* Description */}
      {description && (
        <p className={cn('text-muted-foreground max-w-xs', sizes.description)}>
          {description}
        </p>
      )}

      {/* Actions */}
      {(actionLabel || secondaryLabel) && (
        <div className="flex items-center gap-2 mt-4">
          {actionLabel && onAction && (
            <Button size="sm" onClick={onAction} className="gap-1.5">
              <Plus className="h-4 w-4" />
              {actionLabel}
            </Button>
          )}
          {secondaryLabel && onSecondary && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onSecondary}
              className="gap-1.5"
            >
              {secondaryLabel}
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      {/* Custom content */}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

// === Specialized Variants ===

/** Empty state for board columns */
export function EmptyBoardColumn({
  status,
  onAddItem,
  className,
}: {
  status: string;
  onAddItem?: () => void;
  className?: string;
}) {
  return (
    <EmptyState
      preset="empty-board-column"
      size="sm"
      onAction={onAddItem}
      className={cn('bg-muted/20 rounded-lg border-2 border-dashed border-border/50', className)}
    >
      <p className="text-xs text-muted-foreground/50">
        Drop items to set status to "{status}"
      </p>
    </EmptyState>
  );
}

/** Empty state for search results */
export function EmptySearchResults({
  query,
  onClear,
  className,
}: {
  query: string;
  onClear?: () => void;
  className?: string;
}) {
  return (
    <EmptyState
      preset="no-search-results"
      description={`No results for "${query}"`}
      actionLabel="Clear search"
      onAction={onClear}
      className={className}
    />
  );
}

/** Empty state for filtered results */
export function EmptyFilterResults({
  filterCount,
  onClear,
  className,
}: {
  filterCount: number;
  onClear?: () => void;
  className?: string;
}) {
  return (
    <EmptyState
      preset="no-filter-results"
      description={`No items match your ${filterCount} active filter${filterCount > 1 ? 's' : ''}`}
      actionLabel="Clear all filters"
      onAction={onClear}
      className={className}
    />
  );
}
