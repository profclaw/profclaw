/**
 * System Section
 *
 * Configure agent execution, privacy, authentication, and advanced settings.
 */

import { Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { Settings as SettingsType } from '@/core/api/client';
import { SettingsCard } from '../components/SettingsCard';
import { ToggleOption } from '../components/ToggleOption';
import { JsonOverrideEditor } from '../components/JsonOverrideEditor';

interface MutationLike {
  isPending: boolean;
  mutate: () => void;
}

interface UpdateSettingsMutation {
  isPending: boolean;
  mutate: (updates: Partial<SettingsType>) => void;
}

interface SystemSectionProps {
  settings?: SettingsType;
  handleToggle: (
    category: keyof SettingsType,
    key: string,
    currentValue: boolean,
  ) => void;
  updateSettings: UpdateSettingsMutation;
  resetSettings: MutationLike;
}

export function SystemSection({
  settings,
  handleToggle,
  updateSettings,
  resetSettings,
}: SystemSectionProps) {
  return (
    <>
      <SettingsCard
        title="Execution"
        description="Control how agents run tasks"
      >
        <div className="space-y-4">
          <ToggleOption
            label="Autonomous Execution"
            description="Allow agents to run tasks without manual approval"
            checked={settings?.system?.autonomousExecution ?? false}
            onChange={() =>
              handleToggle(
                'system',
                'autonomousExecution',
                settings?.system?.autonomousExecution ?? false,
              )
            }
            disabled={updateSettings.isPending}
          />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Max Concurrent Tasks</p>
              <p className="text-xs text-muted-foreground">
                Limit parallel task execution
              </p>
            </div>
            <select
              value={settings?.system?.maxConcurrentTasks ?? 3}
              onChange={(e) =>
                {
                  const sys = settings?.system ?? {
                    autonomousExecution: false,
                    telemetry: true,
                    debugMode: false,
                    maxConcurrentTasks: 3,
                    registrationMode: 'invite' as const,
                    showForgotPassword: true,
                    authMode: 'local' as const,
                  };
                  updateSettings.mutate({
                    system: { ...sys, maxConcurrentTasks: parseInt(e.target.value) },
                  });
                }
              }
              className="field py-1.5"
            >
              {[1, 2, 3, 5, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Privacy & Telemetry"
        description="Control data collection"
      >
        <div className="space-y-4">
          <ToggleOption
            label="Usage Telemetry"
            description="Help improve profClaw with anonymous usage data"
            checked={settings?.system?.telemetry ?? true}
            onChange={() =>
              handleToggle(
                'system',
                'telemetry',
                settings?.system?.telemetry ?? true,
              )
            }
            disabled={updateSettings.isPending}
          />
          <ToggleOption
            label="Debug Mode"
            description="Enable verbose logging for troubleshooting"
            checked={settings?.system?.debugMode ?? false}
            onChange={() =>
              handleToggle(
                'system',
                'debugMode',
                settings?.system?.debugMode ?? false,
              )
            }
            disabled={updateSettings.isPending}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Authentication"
        description="Login and registration security options"
      >
        <div className="space-y-4">
          <ToggleOption
            label="Show Forgot Password"
            description="Display the 'Forgot password?' link on the login page with CLI reset instructions"
            checked={settings?.system?.showForgotPassword ?? true}
            onChange={() =>
              handleToggle(
                'system',
                'showForgotPassword',
                settings?.system?.showForgotPassword ?? true,
              )
            }
            disabled={updateSettings.isPending}
          />
        </div>
      </SettingsCard>

      {/* Raw JSON Override */}
      <SettingsCard
        title="Advanced Configuration"
        description="Edit settings as raw JSON"
      >
        <JsonOverrideEditor
          settings={settings}
          onSave={(updates) => updateSettings.mutate(updates)}
          isSaving={updateSettings.isPending}
        />
      </SettingsCard>

      <div className="glass rounded-2xl p-6 border border-red-500/20">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-xl bg-red-500/10 flex items-center justify-center">
            <Trash2 className="h-5 w-5 text-red-500" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-red-400">Danger Zone</h3>
            <p className="text-xs text-muted-foreground">
              Permanent actions that cannot be undone
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="rounded-xl border-red-500/20 text-red-400 hover:bg-red-500/10"
            onClick={() => toast.info('This feature is coming soon')}
          >
            Clear Task History
          </Button>
          <Button
            variant="outline"
            className="rounded-xl border-red-500/20 text-red-400 hover:bg-red-500/10"
            onClick={() => resetSettings.mutate()}
            disabled={resetSettings.isPending}
          >
            {resetSettings.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Reset All Settings
          </Button>
        </div>
      </div>
    </>
  );
}
