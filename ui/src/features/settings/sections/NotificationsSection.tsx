/**
 * Notifications Section
 *
 * Configure notification preferences.
 */

import { toast } from 'sonner';
import type { Settings as SettingsType } from '@/core/api/client';
import { SettingsCard, ToggleOption } from '../components';

interface NotificationsSectionProps {
  settings?: SettingsType;
  handleToggle: (c: keyof SettingsType, k: string, v: boolean) => void;
  isPending: boolean;
}

export function NotificationsSection({
  settings,
  handleToggle,
  isPending,
}: NotificationsSectionProps) {
  const handleBrowserNotificationsToggle = async () => {
    const current = settings?.notifications?.browserNotifications ?? false;

    if (current) {
      // Turning off — just toggle
      handleToggle('notifications', 'browserNotifications', true);
      return;
    }

    // Turning on — request permission first
    if (!('Notification' in window)) {
      toast.error('Browser notifications are not supported in this browser');
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      handleToggle('notifications', 'browserNotifications', false);
    } else {
      toast.error('Browser notification permission denied. Enable it in your browser settings.');
    }
  };

  return (
    <SettingsCard
      title="Notification Preferences"
      description="Control which notifications you receive"
    >
      <div className="space-y-4">
        <ToggleOption
          label="Task Complete"
          description="Notify when a task finishes successfully"
          checked={settings?.notifications?.taskComplete ?? true}
          onChange={() =>
            handleToggle(
              'notifications',
              'taskComplete',
              settings?.notifications?.taskComplete ?? true
            )
          }
          disabled={isPending}
        />
        <ToggleOption
          label="Task Failed"
          description="Notify when a task fails or errors"
          checked={settings?.notifications?.taskFailed ?? true}
          onChange={() =>
            handleToggle(
              'notifications',
              'taskFailed',
              settings?.notifications?.taskFailed ?? true
            )
          }
          disabled={isPending}
        />
        <ToggleOption
          label="Budget Alerts"
          description="Notify at 50%, 80%, and 100% budget usage"
          checked={settings?.notifications?.budgetAlerts ?? true}
          onChange={() =>
            handleToggle(
              'notifications',
              'budgetAlerts',
              settings?.notifications?.budgetAlerts ?? true
            )
          }
          disabled={isPending}
        />
        <ToggleOption
          label="Daily Digest"
          description="Receive a daily summary of activity"
          checked={settings?.notifications?.dailyDigest ?? false}
          onChange={() =>
            handleToggle(
              'notifications',
              'dailyDigest',
              settings?.notifications?.dailyDigest ?? false
            )
          }
          disabled={isPending}
        />
        <ToggleOption
          label="Browser Notifications"
          description="Show native browser notifications for task events"
          checked={settings?.notifications?.browserNotifications ?? false}
          onChange={handleBrowserNotificationsToggle}
          disabled={isPending}
        />
      </div>
    </SettingsCard>
  );
}
