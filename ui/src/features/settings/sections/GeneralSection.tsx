/**
 * General Section
 *
 * Theme selection and onboarding options.
 */

import { Sun, Moon, Zap, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SettingsCard } from '../components';

interface GeneralSectionProps {
  theme?: string;
  setTheme: (t: string) => void;
  handleRestartTour: () => void;
}

export function GeneralSection({
  theme,
  setTheme,
  handleRestartTour,
}: GeneralSectionProps) {
  return (
    <>
      <SettingsCard title="Theme" description="Choose your preferred color scheme">
        <div className="flex items-center justify-between">
          <span className="text-sm">Color Mode</span>
          <div className="flex bg-muted rounded-lg p-1">
            <button
              onClick={() => setTheme('light')}
              className={cn(
                'p-2 rounded-md transition-all',
                theme === 'light'
                  ? 'bg-white shadow-sm text-black'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Sun className="h-4 w-4" />
            </button>
            <button
              onClick={() => setTheme('dark')}
              className={cn(
                'p-2 rounded-md transition-all',
                theme === 'dark'
                  ? 'bg-primary text-white'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Moon className="h-4 w-4" />
            </button>
            <button
              onClick={() => setTheme('midnight')}
              className={cn(
                'p-2 rounded-md transition-all',
                theme === 'midnight'
                  ? 'bg-slate-700 text-white'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Zap className="h-4 w-4" />
            </button>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="Onboarding" description="Replay the product tour">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Product Tour</p>
            <p className="text-xs text-muted-foreground">
              Walk through all features
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRestartTour}
            className="rounded-xl"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Restart Tour
          </Button>
        </div>
      </SettingsCard>
    </>
  );
}
