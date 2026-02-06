/**
 * Toggle Option Component
 *
 * Switch toggle with label and description.
 */

import { Switch } from '@/components/ui/switch';

interface ToggleOptionProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}

export function ToggleOption({
  label,
  description,
  checked,
  onChange,
  disabled,
}: ToggleOptionProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}
