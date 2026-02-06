/**
 * Sidebar Customization Dialog
 *
 * Allows users to select a sidebar preset or customize visible items.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { navGroups, allNavItems } from '@/config/navigation.js';
import type { SidebarPreset } from '@/core/hooks/useSidebarConfig.js';
import { getPresetItems } from '@/core/hooks/useSidebarConfig.js';

interface SidebarCustomizeDialogProps {
  preset: SidebarPreset;
  visibleItems?: string[];
  isVisible: (href: string) => boolean;
  isPinned: (href: string) => boolean;
  setPreset: (preset: SidebarPreset) => void;
  toggleItem: (href: string) => void;
  setCustomItems: (items: string[]) => void;
}

const PRESETS: Array<{ id: SidebarPreset; label: string; description: string }> = [
  { id: 'essential', label: 'Essential', description: 'Chat, Agents, Tasks, Settings' },
  { id: 'developer', label: 'Developer', description: 'Core tools + analytics + automation' },
  { id: 'full', label: 'Full', description: 'All navigation items visible' },
];

export function SidebarCustomizeDialog({
  preset,
  isVisible,
  isPinned,
  setPreset,
  toggleItem,
  setCustomItems,
}: SidebarCustomizeDialogProps) {
  const handlePresetSelect = (newPreset: Exclude<SidebarPreset, 'custom'>) => {
    setPreset(newPreset);
  };

  const handleToggle = (href: string) => {
    if (isPinned(href)) return;

    // If switching from a non-custom preset, seed the custom items first
    if (preset !== 'custom') {
      const presetSet = preset === 'full' ? null : getPresetItems(preset);
      const items = allNavItems
        .filter(item => presetSet === null || presetSet.has(item.href))
        .map(item => item.href);
      // Toggle the item
      const idx = items.indexOf(href);
      if (idx >= 0) {
        items.splice(idx, 1);
      } else {
        items.push(href);
      }
      setCustomItems(items);
    } else {
      toggleItem(href);
    }
  };

  const handleReset = () => {
    setPreset('full');
  };

  const isCustom = preset === 'custom';

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-lg text-[var(--muted-foreground)]"
          title="Customize sidebar"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Customize Sidebar</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Preset Selector */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Preset</p>
            <div className="grid grid-cols-3 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handlePresetSelect(p.id as Exclude<SidebarPreset, 'custom'>)}
                  className={cn(
                    'flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg border text-center transition-all',
                    preset === p.id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border hover:border-primary/30 hover:bg-muted/50'
                  )}
                >
                  <span className="text-sm font-medium">{p.label}</span>
                  <span className="text-[10px] text-muted-foreground leading-tight">{p.description}</span>
                </button>
              ))}
            </div>
            {isCustom && (
              <p className="text-[11px] text-muted-foreground">Custom configuration active</p>
            )}
          </div>

          {/* Item List */}
          <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Items</p>
            {navGroups.map((group) => (
              <div key={group.id}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mt-3 mb-1 px-1">
                  {group.label}
                </p>
                {group.items.map((item) => {
                  const pinned = isPinned(item.href);
                  const visible = isVisible(item.href);
                  return (
                    <div
                      key={item.href}
                      className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-2">
                        <item.icon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">{item.name}</span>
                        {pinned && (
                          <span className="text-[9px] text-muted-foreground/60">(always visible)</span>
                        )}
                      </div>
                      <Switch
                        checked={visible}
                        disabled={pinned}
                        onCheckedChange={() => handleToggle(item.href)}
                        className="scale-75"
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Reset Button */}
          {preset !== 'full' && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={handleReset}
            >
              Reset to Default
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
