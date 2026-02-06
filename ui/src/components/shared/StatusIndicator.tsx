import { cn } from '@/lib/utils';

interface StatusIndicatorProps {
  status: 'online' | 'processing' | 'error' | 'offline';
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  pulse?: boolean;
  showLabel?: boolean;
  className?: string;
}

export function StatusIndicator({
  status,
  label,
  size = 'md',
  pulse = true,
  showLabel = true,
  className,
}: StatusIndicatorProps) {
  const configs = {
    online: {
      color: 'bg-green-500',
      shadow: 'shadow-[0_0_10px_oklch(0.6_0.2_150)]',
      defaultLabel: 'Online',
    },
    processing: {
      color: 'bg-blue-500',
      shadow: 'shadow-[0_0_10px_oklch(0.6_0.2_250)]',
      defaultLabel: 'Processing',
    },
    error: {
      color: 'bg-red-500',
      shadow: 'shadow-[0_0_10px_oklch(0.6_0.2_20)]',
      defaultLabel: 'Error',
    },
    offline: {
      color: 'bg-slate-400',
      shadow: 'shadow-none',
      defaultLabel: 'Offline',
    },
  };

  const config = configs[status];
  const sizeClasses = {
    sm: 'h-1.5 w-1.5',
    md: 'h-2 w-2',
    lg: 'h-3 w-3',
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div 
        className={cn(
          sizeClasses[size],
          'rounded-full',
          config.color,
          config.shadow,
          pulse && status !== 'offline' && 'animate-pulse'
        )} 
      />
      {showLabel && (
        <span className={cn(
          'text-[10px] font-bold uppercase tracking-widest',
          status === 'offline' ? 'text-muted-foreground' : 'text-foreground/80'
        )}>
          {label || config.defaultLabel}
        </span>
      )}
    </div>
  );
}
