/**
 * Settings Card Component
 *
 * Glass-styled card for grouping related settings.
 */

import type { ReactNode } from 'react';

interface SettingsCardProps {
  title: string;
  description: string;
  children: ReactNode;
  icon?: ReactNode;
}

export function SettingsCard({ title, description, children, icon }: SettingsCardProps) {
  return (
    <div className="glass rounded-2xl p-6 lg:p-8">
      <div className="mb-4 flex items-start gap-3">
        {icon ? <div className="mt-0.5 text-muted-foreground">{icon}</div> : null}
        <div>
          <h3 className="text-base font-bold">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}
