import { useEffect, useState } from 'react';
import { Keyboard, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string[]; description: string }[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['Cmd', 'K'], description: 'Open command palette' },
      { keys: ['G', 'H'], description: 'Go to Dashboard' },
      { keys: ['G', 'T'], description: 'Go to Tasks' },
      { keys: ['G', 'S'], description: 'Go to Summaries' },
      { keys: ['G', 'A'], description: 'Go to Agents' },
      { keys: ['G', 'C'], description: 'Go to Costs' },
    ],
  },
  {
    title: 'Actions',
    shortcuts: [
      { keys: ['Cmd', 'N'], description: 'Create new task' },
      { keys: ['Cmd', '/'], description: 'Focus search' },
      { keys: ['Cmd', 'Shift', 'T'], description: 'Toggle theme' },
    ],
  },
  {
    title: 'General',
    shortcuts: [
      { keys: ['?'], description: 'Show keyboard shortcuts' },
      { keys: ['Esc'], description: 'Close modal / Cancel' },
      { keys: ['Enter'], description: 'Confirm / Submit' },
    ],
  },
  {
    title: 'Lists & Navigation',
    shortcuts: [
      { keys: ['J'], description: 'Next item' },
      { keys: ['K'], description: 'Previous item' },
      { keys: ['Enter'], description: 'Open selected item' },
    ],
  },
];

export function KeyboardShortcuts() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Open on "?" key (shift + /)
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        // Don't trigger if user is typing in an input
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
        e.preventDefault();
        setIsOpen(true);
      }

      // Close on Escape
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 animate-in fade-in duration-200"
        onClick={() => setIsOpen(false)}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="glass-heavy rounded-[28px] w-full max-w-2xl max-h-[80vh] overflow-hidden border border-white/10 shadow-2xl animate-in zoom-in-95 fade-in duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-white/5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <Keyboard className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold">Keyboard Shortcuts</h2>
                <p className="text-xs text-muted-foreground">Press ? anytime to show this</p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-2 hover:bg-white/5 rounded-xl transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto max-h-[calc(80vh-100px)]">
            <div className="grid gap-6 md:grid-cols-2">
              {SHORTCUT_GROUPS.map((group) => (
                <div key={group.title}>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
                    {group.title}
                  </h3>
                  <div className="space-y-2">
                    {group.shortcuts.map((shortcut, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2 rounded-lg hover:bg-white/5 transition-colors"
                      >
                        <span className="text-sm text-muted-foreground">{shortcut.description}</span>
                        <div className="flex items-center gap-1">
                          {shortcut.keys.map((key, keyIdx) => (
                            <span key={keyIdx}>
                              <kbd
                                className={cn(
                                  "px-2 py-1 text-[11px] font-bold rounded-lg",
                                  "bg-white/5 border border-white/10",
                                  "shadow-[0_2px_0_0_rgba(255,255,255,0.05)]"
                                )}
                              >
                                {key === 'Cmd' ? '\u2318' : key}
                              </kbd>
                              {keyIdx < shortcut.keys.length - 1 && (
                                <span className="text-muted-foreground/40 mx-0.5">+</span>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-white/5 bg-white/[0.02]">
            <p className="text-center text-xs text-muted-foreground">
              Press <kbd className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-white/5 border border-white/10">Esc</kbd> to close
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
