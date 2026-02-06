/**
 * Collapsible Sidebar Component
 *
 * A reusable collapsible sidebar that slides in/out.
 * Can be positioned on left or right side.
 *
 * @example
 * ```tsx
 * <CollapsibleSidebar
 *   isOpen={sidebarOpen}
 *   onToggle={() => setSidebarOpen(!sidebarOpen)}
 *   title="History"
 *   icon={<History className="h-4 w-4" />}
 *   width={280}
 * >
 *   <YourContent />
 * </CollapsibleSidebar>
 * ```
 */

import { type ReactNode } from 'react';
import { PanelLeftClose, PanelLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CollapsibleSidebarProps {
  /** Whether the sidebar is open */
  isOpen: boolean;
  /** Callback when toggle button is clicked */
  onToggle: () => void;
  /** Sidebar title */
  title?: string;
  /** Optional subtitle/description */
  subtitle?: string;
  /** Icon to display next to title */
  icon?: ReactNode;
  /** Width of the sidebar when open (in pixels) */
  width?: number;
  /** Position of the sidebar */
  position?: 'left' | 'right';
  /** Content to render in the sidebar */
  children: ReactNode;
  /** Optional header actions (buttons, etc.) */
  headerActions?: ReactNode;
  /** Optional footer content */
  footer?: ReactNode;
  /** Additional class names for the container */
  className?: string;
  /** Whether to show the collapsed toggle button when closed */
  showCollapsedToggle?: boolean;
}

export function CollapsibleSidebar({
  isOpen,
  onToggle,
  title,
  subtitle,
  icon,
  width = 280,
  position = 'left',
  children,
  headerActions,
  footer,
  className,
  showCollapsedToggle = true,
}: CollapsibleSidebarProps) {
  const collapsedWidth = showCollapsedToggle ? 48 : 0;

  return (
    <div
      className={cn(
        'relative shrink-0 transition-all duration-300 ease-out h-full',
        className
      )}
      style={{ width: isOpen ? width : collapsedWidth }}
    >
      {/* Collapsed Toggle Button */}
      {!isOpen && showCollapsedToggle && (
        <div className="group h-full flex flex-col items-center py-3 bg-card/60 backdrop-blur-sm hover:bg-card/80 transition-colors">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className="h-10 w-10 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary transition-all group-hover:scale-105"
            title={`Open ${title || 'sidebar'}`}
          >
            {position === 'left' ? (
              <PanelLeft className="h-5 w-5" />
            ) : (
              <PanelLeftClose className="h-5 w-5" />
            )}
          </Button>
          {/* Tooltip on hover */}
          {title && (
            <div className="absolute left-12 top-3 bg-popover/95 backdrop-blur-sm text-popover-foreground px-2.5 py-1.5 rounded-lg text-xs font-medium shadow-lg border border-border/50 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
              {title}
            </div>
          )}
          {/* Vertical indicator */}
          <div className="flex-1 flex items-center justify-center mt-4">
            <div className="w-1 h-16 rounded-full bg-primary/20 group-hover:bg-primary/40 transition-colors" />
          </div>
        </div>
      )}

      {/* Expanded Sidebar */}
      {isOpen && (
        <div
          className={cn(
            'relative flex flex-col h-full overflow-hidden',
            'bg-card/90 backdrop-blur-xl',
            'border-r border-border/20',
            'animate-in slide-in-from-left-2 duration-200',
            position === 'right' && 'border-l border-r-0 slide-in-from-right-2'
          )}
          style={{ width }}
        >
          {/* Header */}
          {(title || headerActions) && (
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/30">
              <div className="flex items-center gap-2 min-w-0">
                {icon && <span className="text-muted-foreground/70 shrink-0">{icon}</span>}
                <div className="min-w-0">
                  {title && (
                    <h3 className="text-[13px] font-semibold truncate">{title}</h3>
                  )}
                  {subtitle && (
                    <p className="text-[9px] text-muted-foreground/60 truncate">{subtitle}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-0.5">
                {headerActions}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onToggle}
                  className="h-6 w-6 rounded hover:bg-muted/60 shrink-0"
                  title="Collapse sidebar"
                >
                  {position === 'left' ? (
                    <PanelLeftClose className="h-3 w-3 text-muted-foreground" />
                  ) : (
                    <PanelLeft className="h-3 w-3 text-muted-foreground" />
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {children}
          </div>

          {/* Footer */}
          {footer && (
            <div className="border-t border-border/30 px-3 py-2.5">
              {footer}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default CollapsibleSidebar;
