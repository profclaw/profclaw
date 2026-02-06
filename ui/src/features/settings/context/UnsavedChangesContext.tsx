/**
 * Unsaved Changes Context
 *
 * Tracks pending changes across the settings page for the floating save bar.
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { Settings as SettingsType } from '@/core/api/client';

interface UnsavedChangesContextType {
  pendingChanges: Partial<SettingsType>;
  setPendingChange: (category: string, key: string, value: unknown) => void;
  clearPendingChanges: () => void;
  hasPendingChanges: boolean;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextType | null>(null);

export function useUnsavedChanges() {
  const context = useContext(UnsavedChangesContext);
  if (!context) {
    throw new Error('useUnsavedChanges must be used within UnsavedChangesProvider');
  }
  return context;
}

interface UnsavedChangesProviderProps {
  children: ReactNode;
}

export function UnsavedChangesProvider({ children }: UnsavedChangesProviderProps) {
  const [pendingChanges, setPendingChanges] = useState<Partial<SettingsType>>({});

  const setPendingChange = useCallback((category: string, key: string, value: unknown) => {
    setPendingChanges((prev) => ({
      ...prev,
      [category]: {
        ...(prev[category as keyof SettingsType] as Record<string, unknown>),
        [key]: value,
      },
    }));
  }, []);

  const clearPendingChanges = useCallback(() => {
    setPendingChanges({});
  }, []);

  const hasPendingChanges = Object.keys(pendingChanges).length > 0;

  return (
    <UnsavedChangesContext.Provider
      value={{
        pendingChanges,
        setPendingChange,
        clearPendingChanges,
        hasPendingChanges,
      }}
    >
      {children}
    </UnsavedChangesContext.Provider>
  );
}

export { UnsavedChangesContext };
