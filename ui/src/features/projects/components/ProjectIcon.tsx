/**
 * Project Icon Component
 *
 * Maps icon name strings to Lucide icon components.
 * Used throughout the app to render project icons consistently.
 */

import {
  ClipboardList,
  Rocket,
  Lightbulb,
  Target,
  Smartphone,
  Globe,
  Settings,
  Wrench,
  BarChart3,
  Palette,
  Code,
  Shield,
  FolderKanban,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Map of icon names to Lucide components
const ICON_MAP: Record<string, LucideIcon> = {
  'clipboard-list': ClipboardList,
  rocket: Rocket,
  lightbulb: Lightbulb,
  target: Target,
  smartphone: Smartphone,
  globe: Globe,
  settings: Settings,
  wrench: Wrench,
  'bar-chart-3': BarChart3,
  palette: Palette,
  code: Code,
  shield: Shield,
  // Fallback default
  default: FolderKanban,
};

interface ProjectIconProps {
  icon: string;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  showBackground?: boolean;
}

const sizeClasses = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
};

const containerSizes = {
  sm: 'w-8 h-8',
  md: 'w-10 h-10',
  lg: 'w-12 h-12',
};

export function ProjectIcon({
  icon,
  color = '#6366f1',
  size = 'md',
  className,
  showBackground = true,
}: ProjectIconProps) {
  const IconComponent = ICON_MAP[icon] || ICON_MAP.default;

  if (showBackground) {
    return (
      <div
        className={cn('rounded-lg flex items-center justify-center', containerSizes[size], className)}
        style={{ backgroundColor: `${color}20` }}
      >
        <IconComponent className={sizeClasses[size]} style={{ color }} />
      </div>
    );
  }

  return <IconComponent className={cn(sizeClasses[size], className)} style={{ color }} />;
}

// Export the icon map for use in other components
export { ICON_MAP };
