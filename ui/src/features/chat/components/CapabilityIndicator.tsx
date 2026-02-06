/**
 * Capability Indicator
 *
 * Compact badge showing the current model's tool tier and capability level.
 * Intended for placement next to the model name in the chat header.
 */

import { Brain, Cpu, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// =============================================================================
// Types
// =============================================================================

export type ToolTier = 'essential' | 'standard' | 'full';
export type CapabilityLevel = 'basic' | 'instruction' | 'reasoning';

export interface CapabilityIndicatorProps {
  modelId: string;
  toolTier: ToolTier;
  capabilityLevel: CapabilityLevel;
  className?: string;
}

// =============================================================================
// Config maps
// =============================================================================

const TOOL_COUNTS: Record<ToolTier, number> = {
  essential: 8,
  standard: 30,
  full: 72,
};

const CAPABILITY_CONFIG: Record<
  CapabilityLevel,
  { label: string; description: string; colorClass: string; Icon: typeof Brain }
> = {
  basic: {
    label: 'Basic',
    description: 'Standard instruction following, suitable for most conversational tasks.',
    colorClass: 'bg-amber-500/15 text-amber-600 border-amber-500/25',
    Icon: Cpu,
  },
  instruction: {
    label: 'Instruction',
    description: 'Advanced instruction following with multi-step reasoning capabilities.',
    colorClass: 'bg-blue-500/15 text-blue-600 border-blue-500/25',
    Icon: Brain,
  },
  reasoning: {
    label: 'Reasoning',
    description: 'Full agentic reasoning with planning, reflection, and complex tool use.',
    colorClass: 'bg-green-500/15 text-green-600 border-green-500/25',
    Icon: Sparkles,
  },
};

// =============================================================================
// Component
// =============================================================================

export function CapabilityIndicator({
  modelId,
  toolTier,
  capabilityLevel,
  className,
}: CapabilityIndicatorProps) {
  const config = CAPABILITY_CONFIG[capabilityLevel];
  const toolCount = TOOL_COUNTS[toolTier];
  const { Icon } = config;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            'flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium cursor-default select-none border',
            config.colorClass,
            className
          )}
        >
          <Icon className="h-3 w-3 shrink-0" />
          <span>{config.label}</span>
          <span className="opacity-60">·</span>
          <span className="opacity-70">{toolCount} tools</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <div className="space-y-1.5 max-w-56">
          <div className="font-semibold text-xs">{modelId}</div>
          <p className="text-xs text-muted-foreground leading-relaxed">{config.description}</p>
          <div className="flex items-center gap-2 pt-0.5 text-xs text-muted-foreground">
            <span className="capitalize">{toolTier} tier</span>
            <span>-</span>
            <span>{toolCount} tools available</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
