/**
 * Autonomy Slider
 *
 * Segmented control for selecting the agent's autonomy level.
 * Maps to existing backend security/approval modes.
 */

import { Shield, ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// =============================================================================
// Types
// =============================================================================

export type AutonomyLevel =
  | 'ask-everything'
  | 'ask-dangerous'
  | 'semi-autonomous'
  | 'full-autonomous';

export interface AutonomySliderProps {
  level: AutonomyLevel;
  onChange: (level: AutonomyLevel) => void;
  disabled?: boolean;
  className?: string;
}

interface LevelDef {
  id: AutonomyLevel;
  label: string;
  description: string;
  Icon: typeof Shield;
  iconClass: string;
  activeClass: string;
  warn?: boolean;
}

// =============================================================================
// Level definitions
// =============================================================================

const LEVELS: LevelDef[] = [
  {
    id: 'ask-everything',
    label: 'Ask Everything',
    description: 'Approve every tool call before execution.',
    Icon: Shield,
    iconClass: 'text-muted-foreground',
    activeClass: 'bg-muted text-foreground border-border',
  },
  {
    id: 'ask-dangerous',
    label: 'Ask Dangerous',
    description: 'Auto-approve safe tools. Prompt before write, delete, or network operations.',
    Icon: ShieldCheck,
    iconClass: 'text-blue-500',
    activeClass: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  },
  {
    id: 'semi-autonomous',
    label: 'Semi-Autonomous',
    description: 'Auto-approve most tools. Only prompt for irreversible or high-impact actions.',
    Icon: ShieldAlert,
    iconClass: 'text-amber-500',
    activeClass: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  },
  {
    id: 'full-autonomous',
    label: 'Full Autonomous',
    description: 'No approval prompts. The agent executes all tools without interruption.',
    Icon: ShieldOff,
    iconClass: 'text-destructive',
    activeClass: 'bg-destructive/10 text-destructive border-destructive/30',
    warn: true,
  },
];

// =============================================================================
// Component
// =============================================================================

export function AutonomySlider({
  level,
  onChange,
  disabled = false,
  className,
}: AutonomySliderProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground select-none">
        <Shield className="h-3.5 w-3.5" />
        <span>Autonomy Level</span>
      </div>

      <div
        role="radiogroup"
        aria-label="Autonomy level"
        className="flex gap-1.5 flex-wrap"
      >
        {LEVELS.map((def) => {
          const isActive = level === def.id;
          const { Icon } = def;

          return (
            <Tooltip key={def.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  disabled={disabled}
                  onClick={() => onChange(def.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium',
                    'border transition-all duration-150 select-none outline-none',
                    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                    isActive
                      ? def.activeClass
                      : 'bg-transparent text-muted-foreground border-border/50 hover:border-border hover:text-foreground'
                  )}
                >
                  <Icon className={cn('h-3.5 w-3.5 shrink-0', isActive ? '' : def.iconClass)} />
                  <span>{def.label}</span>
                  {def.warn && isActive && (
                    <Badge
                      variant="outline"
                      className="ml-0.5 h-4 px-1.5 text-[10px] border-destructive/40 text-destructive bg-destructive/10"
                    >
                      Caution
                    </Badge>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="text-xs max-w-48">{def.description}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
