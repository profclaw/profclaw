/**
 * PWA Registration Hook
 *
 * Registers the service worker and manages push notification subscriptions.
 */

import { useEffect, useState, useCallback } from 'react';

interface PWAState {
  isInstalled: boolean;
  isInstallable: boolean;
  isOnline: boolean;
  pushSupported: boolean;
  pushSubscribed: boolean;
  serviceWorkerReady: boolean;
}

export function usePWA() {
  const [state, setState] = useState<PWAState>({
    isInstalled: false,
    isInstallable: false,
    isOnline: navigator.onLine,
    pushSupported: 'PushManager' in window,
    pushSubscribed: false,
    serviceWorkerReady: false,
  });

  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          setState((prev) => ({ ...prev, serviceWorkerReady: true }));

          // Check for updates periodically
          setInterval(() => registration.update(), 60 * 60 * 1000); // Every hour
        })
        .catch((err) => {
          console.error('[PWA] Service worker registration failed:', err);
        });
    }

    // Detect if app is already installed
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

    setState((prev) => ({ ...prev, isInstalled: isStandalone }));

    // Listen for install prompt
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
      setState((prev) => ({ ...prev, isInstallable: true }));
    };

    // Online/offline detection
    const handleOnline = () => setState((prev) => ({ ...prev, isOnline: true }));
    const handleOffline = () => setState((prev) => ({ ...prev, isOnline: false }));

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!installPrompt) return false;

    const result = await installPrompt.prompt();
    const accepted = result.outcome === 'accepted';

    if (accepted) {
      setState((prev) => ({ ...prev, isInstalled: true, isInstallable: false }));
      setInstallPrompt(null);
    }

    return accepted;
  }, [installPrompt]);

  const subscribePush = useCallback(async (): Promise<boolean> => {
    if (!('PushManager' in window) || !('serviceWorker' in navigator)) return false;

    try {
      const registration = await navigator.serviceWorker.ready;

      // Get VAPID key from server
      const response = await fetch('/api/push/vapid-key');
      const { publicKey } = await response.json() as { publicKey: string };

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      });

      // Send subscription to server
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          keys: {
            p256dh: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('p256dh')!))),
            auth: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('auth')!))),
          },
        }),
      });

      setState((prev) => ({ ...prev, pushSubscribed: true }));
      return true;
    } catch (err) {
      console.error('[PWA] Push subscription failed:', err);
      return false;
    }
  }, []);

  return {
    ...state,
    promptInstall,
    subscribePush,
  };
}

// Type for the beforeinstallprompt event
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
