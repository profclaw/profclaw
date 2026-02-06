/**
 * Messaging Page
 *
 * Standalone page for managing messaging provider connections.
 * Wraps the MessagingSection with a page header.
 */

import { MessagingSection } from '@/features/settings/sections/MessagingSection.js';
import { PROVIDER_DEFINITIONS } from '@/features/settings/sections/messaging/providers.js';

export function MessagingPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Messaging Channels</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Connect and manage your messaging providers
          </p>
        </div>
        <span className="text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
          {PROVIDER_DEFINITIONS.length} providers
        </span>
      </div>

      {/* Full messaging grid + config */}
      <MessagingSection />
    </div>
  );
}
