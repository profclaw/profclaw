/**
 * Workflow Quick Actions
 *
 * Row of quick-action buttons below the chat input for common workflows.
 * Hidden on mobile (below md breakpoint) to preserve screen space.
 */

import {
  Rocket,
  GitPullRequest,
  Bug,
  Search,
  TestTube,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// =============================================================================
// Types
// =============================================================================

export interface WorkflowQuickActionsProps {
  onWorkflowSelect: (workflowId: string) => void;
  disabled?: boolean;
  className?: string;
}

interface WorkflowDef {
  id: string;
  label: string;
  Icon: typeof Rocket;
}

// =============================================================================
// Workflow definitions
// =============================================================================

const WORKFLOWS: WorkflowDef[] = [
  { id: 'deploy', label: 'Deploy', Icon: Rocket },
  { id: 'review', label: 'Review', Icon: GitPullRequest },
  { id: 'debug', label: 'Debug', Icon: Bug },
  { id: 'research', label: 'Research', Icon: Search },
  { id: 'test', label: 'Test', Icon: TestTube },
  { id: 'refactor', label: 'Refactor', Icon: RefreshCw },
];

// =============================================================================
// Component
// =============================================================================

export function WorkflowQuickActions({
  onWorkflowSelect,
  disabled = false,
  className,
}: WorkflowQuickActionsProps) {
  return (
    <div
      className={cn(
        'hidden md:flex items-center gap-1.5 overflow-x-auto scrollbar-none py-1',
        className
      )}
    >
      {WORKFLOWS.map(({ id, label, Icon }) => (
        <Button
          key={id}
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onWorkflowSelect(id)}
          className={cn(
            'flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-medium shrink-0',
            'text-muted-foreground hover:text-foreground',
            'border-border/50 hover:border-border',
            'transition-colors duration-150'
          )}
        >
          <Icon className="h-3 w-3 shrink-0" />
          <span>{label}</span>
        </Button>
      ))}
    </div>
  );
}
