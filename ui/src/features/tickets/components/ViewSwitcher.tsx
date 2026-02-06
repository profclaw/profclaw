import { List, Kanban } from 'lucide-react';
import { cn } from '@/lib/utils';

type ViewType = 'list' | 'board';

interface ViewSwitcherProps {
  view: ViewType;
  onChange: (view: ViewType) => void;
}

export function ViewSwitcher({ view, onChange }: ViewSwitcherProps) {
  return (
    <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--muted)]/30 border border-[var(--border)]">
      <button
        onClick={() => onChange('list')}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
          view === 'list'
            ? 'bg-[var(--background)] text-[var(--foreground)] shadow-sm'
            : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
        )}
      >
        <List className="h-4 w-4" />
        <span className="hidden sm:inline">List</span>
      </button>
      <button
        onClick={() => onChange('board')}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
          view === 'board'
            ? 'bg-[var(--background)] text-[var(--foreground)] shadow-sm'
            : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
        )}
      >
        <Kanban className="h-4 w-4" />
        <span className="hidden sm:inline">Board</span>
      </button>
    </div>
  );
}
