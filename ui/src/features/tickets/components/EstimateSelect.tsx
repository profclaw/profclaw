import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Hash } from 'lucide-react';

/**
 * Fibonacci sequence for story point estimation
 * Standard values used in agile/scrum
 */
export const ESTIMATE_OPTIONS = [0, 1, 2, 3, 5, 8, 13, 21] as const;
export type EstimatePoints = (typeof ESTIMATE_OPTIONS)[number] | null;

interface EstimateSelectProps {
  value?: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  className?: string;
  /** Show compact version (icon only trigger) */
  compact?: boolean;
  /** Placeholder text */
  placeholder?: string;
}

/**
 * Story points estimation selector using Fibonacci sequence
 *
 * Usage:
 * ```tsx
 * <EstimateSelect
 *   value={estimate}
 *   onChange={setEstimate}
 * />
 * ```
 */
export function EstimateSelect({
  value,
  onChange,
  disabled = false,
  className,
  compact = false,
  placeholder = 'Estimate',
}: EstimateSelectProps) {
  const handleChange = (val: string) => {
    if (val === '__none__') {
      onChange(null);
    } else {
      onChange(parseInt(val, 10));
    }
  };

  const getLabel = (points: number) => {
    if (points === 0) return '0 pts (trivial)';
    if (points === 1) return '1 pt (tiny)';
    if (points === 2) return '2 pts (small)';
    if (points === 3) return '3 pts (medium)';
    if (points === 5) return '5 pts (large)';
    if (points === 8) return '8 pts (x-large)';
    if (points === 13) return '13 pts (huge)';
    if (points === 21) return '21 pts (epic)';
    return `${points} pts`;
  };

  const getShortLabel = (points: number | null | undefined) => {
    if (points === null || points === undefined) return null;
    return `${points} pts`;
  };

  return (
    <Select
      value={value !== null && value !== undefined ? String(value) : '__none__'}
      onValueChange={handleChange}
      disabled={disabled}
    >
      <SelectTrigger
        className={cn(
          'bg-white/5 border-white/10 rounded-xl',
          compact && 'w-[100px]',
          className
        )}
      >
        <SelectValue placeholder={placeholder}>
          {value !== null && value !== undefined ? (
            <span className="flex items-center gap-1.5">
              <Hash className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{getShortLabel(value)}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Hash className="h-3.5 w-3.5" />
              <span>{placeholder}</span>
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="glass-heavy rounded-xl border-white/10">
        <SelectItem value="__none__">
          <span className="text-muted-foreground">No estimate</span>
        </SelectItem>
        {ESTIMATE_OPTIONS.map((points) => (
          <SelectItem key={points} value={String(points)}>
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  'w-5 h-5 rounded-md flex items-center justify-center text-xs font-medium',
                  points === 0 && 'bg-zinc-500/20 text-zinc-400',
                  points === 1 && 'bg-green-500/20 text-green-400',
                  points === 2 && 'bg-emerald-500/20 text-emerald-400',
                  points === 3 && 'bg-blue-500/20 text-blue-400',
                  points === 5 && 'bg-yellow-500/20 text-yellow-400',
                  points === 8 && 'bg-orange-500/20 text-orange-400',
                  points === 13 && 'bg-red-500/20 text-red-400',
                  points === 21 && 'bg-purple-500/20 text-purple-400'
                )}
              >
                {points}
              </span>
              <span>{getLabel(points)}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Inline estimate badge for display (non-editable)
 */
export function EstimateBadge({
  value,
  className,
}: {
  value?: number | null;
  className?: string;
}) {
  if (value === null || value === undefined) return null;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-medium',
        value === 0 && 'bg-zinc-500/20 text-zinc-400',
        value === 1 && 'bg-green-500/20 text-green-400',
        value === 2 && 'bg-emerald-500/20 text-emerald-400',
        value === 3 && 'bg-blue-500/20 text-blue-400',
        value === 5 && 'bg-yellow-500/20 text-yellow-400',
        value === 8 && 'bg-orange-500/20 text-orange-400',
        value === 13 && 'bg-red-500/20 text-red-400',
        value >= 21 && 'bg-purple-500/20 text-purple-400',
        className
      )}
    >
      <Hash className="h-3 w-3" />
      {value}
    </span>
  );
}
