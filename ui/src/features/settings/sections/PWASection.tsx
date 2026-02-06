/**
 * PWA Settings Section
 *
 * Install app, enable push notifications, manage offline settings.
 */

import { usePWA } from '../../../core/hooks/usePWA.js';

export function PWASection() {
  const {
    isInstalled,
    isInstallable,
    isOnline,
    pushSupported,
    pushSubscribed,
    serviceWorkerReady,
    promptInstall,
    subscribePush,
  } = usePWA();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Progressive Web App</h3>
        <p className="text-sm text-muted-foreground">
          Install profClaw as a native app and enable push notifications.
        </p>
      </div>

      {/* Status indicators */}
      <div className="grid gap-3">
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Service Worker</p>
            <p className="text-xs text-muted-foreground">Enables offline support and caching</p>
          </div>
          <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
            serviceWorkerReady
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
          }`}>
            {serviceWorkerReady ? 'Active' : 'Registering...'}
          </span>
        </div>

        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Connection</p>
            <p className="text-xs text-muted-foreground">Messages queue when offline</p>
          </div>
          <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
            isOnline
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
          }`}>
            {isOnline ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>

      {/* Install button */}
      {!isInstalled && isInstallable && (
        <div className="rounded-lg border border-dashed p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Install profClaw</p>
              <p className="text-xs text-muted-foreground">
                Add to your home screen for a native app experience
              </p>
            </div>
            <button
              onClick={() => promptInstall()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Install
            </button>
          </div>
        </div>
      )}

      {isInstalled && (
        <div className="rounded-lg border bg-muted/50 p-4">
          <p className="text-sm text-muted-foreground">
            profClaw is installed as a native app.
          </p>
        </div>
      )}

      {/* Push notifications */}
      {pushSupported && (
        <div className="rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Push Notifications</p>
              <p className="text-xs text-muted-foreground">
                Get notified about task completions and agent activity
              </p>
            </div>
            {pushSubscribed ? (
              <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                Enabled
              </span>
            ) : (
              <button
                onClick={() => subscribePush()}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                Enable
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
