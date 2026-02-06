/**
 * Floating Save Bar Component
 *
 * Appears at the bottom of the screen when there are unsaved changes.
 */

import { Loader2, X, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Settings as SettingsType } from '@/core/api/client';

interface FloatingSaveBarProps {
  hasPendingChanges: boolean;
  pendingChanges: Partial<SettingsType>;
  onSave: () => void;
  onDiscard: () => void;
  isSaving: boolean;
}

export function FloatingSaveBar({
  hasPendingChanges,
  pendingChanges,
  onSave,
  onDiscard,
  isSaving,
}: FloatingSaveBarProps) {
  // Count the number of changed fields
  const changeCount = Object.values(pendingChanges).reduce((acc, category) => {
    if (typeof category === 'object' && category !== null) {
      return acc + Object.keys(category).length;
    }
    return acc;
  }, 0);

  return (
    <div
      className={cn(
        'fixed bottom-6 left-1/2 -translate-x-1/2 z-50',
        'transition-all duration-300 ease-out',
        hasPendingChanges
          ? 'translate-y-0 opacity-100'
          : 'translate-y-20 opacity-0 pointer-events-none'
      )}
    >
      <div className="flex items-center gap-4 px-6 py-3 rounded-2xl glass-heavy shadow-float border border-primary/20">
        {/* Status indicator */}
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-sm font-medium">
            {changeCount} unsaved {changeCount === 1 ? 'change' : 'changes'}
          </span>
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-border" />

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onDiscard}
            disabled={isSaving}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4 mr-1" />
            Discard
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            disabled={isSaving}
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}
