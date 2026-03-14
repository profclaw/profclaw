/**
 * Sidebar configuration hook
 *
 * Manages sidebar preset system with localStorage persistence.
 * Presets: essential, developer, full (default), custom
 */

import { useState, useCallback, useMemo } from 'react';
import type { NavGroup } from '@/config/navigation.js';

export type SidebarPreset = 'essential' | 'developer' | 'full' | 'custom';

interface SidebarConfig {
  preset: SidebarPreset;
  visibleItems?: string[];
  version: 1;
}

const STORAGE_KEY = 'sidebar-config';

/** Items that cannot be hidden */
const PINNED_HREFS = new Set(['/', '/settings']);

const PRESET_ITEMS: Record<Exclude<SidebarPreset, 'custom'>, Set<string>> = {
  essential: new Set([
    '/', '/agents', '/tasks', '/settings',
  ]),
  developer: new Set([
    '/', '/agents', '/gateway', '/tasks', '/failed',
    '/analytics', '/costs', '/cron', '/webhooks', '/settings',
  ]),
  full: new Set(), // empty = show all
};

function loadConfig(): SidebarConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SidebarConfig;
      if (parsed.version === 1) return parsed;
    }
  } catch {
    // ignore
  }
  return { preset: 'full', version: 1 };
}

function saveConfig(config: SidebarConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function useSidebarConfig() {
  const [config, setConfig] = useState<SidebarConfig>(loadConfig);

  const visibleSet = useMemo(() => {
    if (config.preset === 'full') return null; // null = show everything
    if (config.preset === 'custom') {
      const set = new Set(config.visibleItems ?? []);
      // Always include pinned
      for (const href of PINNED_HREFS) set.add(href);
      return set;
    }
    // Preset mode
    const set = new Set(PRESET_ITEMS[config.preset]);
    for (const href of PINNED_HREFS) set.add(href);
    return set;
  }, [config]);

  const isVisible = useCallback(
    (href: string): boolean => {
      if (visibleSet === null) return true;
      return visibleSet.has(href);
    },
    [visibleSet],
  );

  const isPinned = useCallback(
    (href: string): boolean => PINNED_HREFS.has(href),
    [],
  );

  const getVisibleGroups = useCallback(
    (groups: NavGroup[]): NavGroup[] => {
      if (visibleSet === null) return groups;
      return groups
        .map(group => ({
          ...group,
          items: group.items.filter(item => visibleSet.has(item.href)),
        }))
        .filter(group => group.items.length > 0);
    },
    [visibleSet],
  );

  const setPreset = useCallback((preset: SidebarPreset) => {
    const next: SidebarConfig = { preset, version: 1 };
    setConfig(next);
    saveConfig(next);
  }, []);

  const toggleItem = useCallback(
    (href: string) => {
      if (PINNED_HREFS.has(href)) return; // cannot toggle pinned

      setConfig(prev => {
        // Resolve current visible items from preset if needed
        let currentItems: string[];
        if (prev.preset === 'custom' && prev.visibleItems) {
          currentItems = [...prev.visibleItems];
        } else if (prev.preset === 'full') {
          // Can't get all hrefs here, so we leave it to the dialog
          // The dialog should pass all items when switching to custom
          currentItems = [];
        } else {
          const presetKey = prev.preset as Exclude<SidebarPreset, 'custom'>;
          currentItems = [...PRESET_ITEMS[presetKey]];
        }

        const idx = currentItems.indexOf(href);
        if (idx >= 0) {
          currentItems.splice(idx, 1);
        } else {
          currentItems.push(href);
        }

        // Ensure pinned items are always included
        for (const pinned of PINNED_HREFS) {
          if (!currentItems.includes(pinned)) currentItems.push(pinned);
        }

        const next: SidebarConfig = {
          preset: 'custom',
          visibleItems: currentItems,
          version: 1,
        };
        saveConfig(next);
        return next;
      });
    },
    [],
  );

  const setCustomItems = useCallback((items: string[]) => {
    const withPinned = [...items];
    for (const pinned of PINNED_HREFS) {
      if (!withPinned.includes(pinned)) withPinned.push(pinned);
    }
    const next: SidebarConfig = {
      preset: 'custom',
      visibleItems: withPinned,
      version: 1,
    };
    setConfig(next);
    saveConfig(next);
  }, []);

  return {
    preset: config.preset,
    visibleItems: config.visibleItems,
    isVisible,
    isPinned,
    getVisibleGroups,
    setPreset,
    toggleItem,
    setCustomItems,
  };
}

/** Get items visible for a given preset (for dialog display) */
export function getPresetItems(preset: Exclude<SidebarPreset, 'custom'>): Set<string> | null {
  if (preset === 'full') return null;
  return PRESET_ITEMS[preset];
}
