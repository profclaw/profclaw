import type { ComponentType } from 'react';
import { Settings, Shield, Zap, Github } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ProjectSettings() {

  return (
    <div className="max-w-4xl space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight">Project Settings</h2>
        <p className="text-muted-foreground">Manage your project configuration, integrations, and access control.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <SettingsCard
          icon={Settings}
          title="General"
          description="Update project name, key, and description."
        />
        <SettingsCard
          icon={Zap}
          title="Workflows"
          description="Configure ticket states and transitions."
        />
        <SettingsCard
          icon={Shield}
          title="Permissions"
          description="Manage team access and roles."
        />
        <SettingsCard
          icon={Github}
          title="Integrations"
          description="Connect with GitHub, Jira, or Linear."
        />
      </div>
    </div>
  );
}

function SettingsCard({ icon: Icon, title, description }: { icon: ComponentType<{ className?: string }>, title: string, description: string }) {
  return (
    <div className="glass-card p-6 rounded-[28px] border border-white/5 hover:border-primary/30 transition-all group flex items-start gap-4">
      <div className="p-3 rounded-2xl bg-white/5 group-hover:scale-110 transition-transform shadow-inner">
        <Icon className="h-6 w-6 text-primary" />
      </div>
      <div className="space-y-1 flex-1">
        <h3 className="font-bold tracking-tight">{title}</h3>
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        <div className="pt-3">
          <Button variant="ghost" size="sm" className="h-8 text-[11px] font-bold uppercase tracking-widest rounded-xl px-0 hover:bg-transparent hover:text-primary transition-colors">
            Configure
          </Button>
        </div>
      </div>
    </div>
  );
}
