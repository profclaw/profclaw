/**
 * Slider component
 *
 * Minimal range input styled with Tailwind.
 * API mirrors shadcn/ui Slider for drop-in compatibility.
 */

import { cn } from '@/lib/utils';

interface SliderProps {
  value: [number];
  onValueChange: (value: [number]) => void;
  min: number;
  max: number;
  step: number;
  className?: string;
  disabled?: boolean;
}

export function Slider({ value, onValueChange, min, max, step, className, disabled }: SliderProps) {
  const [current] = value;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onValueChange([parseFloat(e.target.value)]);
  };

  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={current}
      onChange={handleChange}
      disabled={disabled}
      className={cn(
        'w-full h-2 rounded-lg appearance-none cursor-pointer',
        'bg-secondary accent-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
    />
  );
}
