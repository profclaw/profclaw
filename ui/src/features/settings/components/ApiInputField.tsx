/**
 * API Input Field Component
 *
 * Specialized input for API keys with show/hide toggle and change tracking.
 */

import { useState, useEffect } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUnsavedChanges } from '../context/UnsavedChangesContext';
import type { Settings as SettingsType } from '@/core/api/client';

interface ApiInputFieldProps {
  label: string;
  placeholder: string;
  value?: string;
  category: string;
  fieldKey: string;
  isSecret?: boolean;
}

export function ApiInputField({
  label,
  placeholder,
  value,
  category,
  fieldKey,
  isSecret = true,
}: ApiInputFieldProps) {
  const { setPendingChange, pendingChanges } = useUnsavedChanges();
  const [showValue, setShowValue] = useState(false);
  const [localValue, setLocalValue] = useState(value || '');

  // Get pending value if exists
  const pendingValue = (
    pendingChanges[category as keyof SettingsType] as Record<string, unknown>
  )?.[fieldKey] as string | undefined;
  const displayValue = pendingValue !== undefined ? pendingValue : localValue;
  const isDirty = displayValue !== (value || '');

  useEffect(() => {
    setLocalValue(value || '');
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);
    // Track change in context for floating save bar
    if (newValue !== (value || '')) {
      setPendingChange(category, fieldKey, newValue);
    }
  };

  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
        {label}
      </label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={isSecret && !showValue ? 'password' : 'text'}
            placeholder={placeholder}
            value={displayValue}
            onChange={handleChange}
            className={cn(
              'w-full bg-muted/40 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30',
              isDirty && 'ring-1 ring-amber-500/50'
            )}
          />
          {isSecret && (
            <button
              type="button"
              onClick={() => setShowValue(!showValue)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showValue ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
        {isDirty && (
          <div className="flex items-center px-2">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
          </div>
        )}
      </div>
    </div>
  );
}
