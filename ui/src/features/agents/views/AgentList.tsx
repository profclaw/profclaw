import { Bot, Cpu, Sparkles, Activity, Clock, Settings, ShieldCheck } from 'lucide-react';
import { useAgents, type Agent } from '../api/agents';
import { StatusIndicator } from '@/components/shared/StatusIndicator';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function AgentList() {
  const { data: agents, isLoading, error } = useAgents();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <header>
          <h2 className="text-2xl font-bold tracking-tight">Agent Status</h2>
          <p className="text-muted-foreground text-sm">Monitor your active AI workforce.</p>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 rounded-2xl premium-card animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="premium-card rounded-2xl p-12 text-center">
        <Activity className="h-12 w-12 mx-auto text-red-500 mb-4 opacity-50" />
        <h3 className="text-lg font-semibold">Failed to load agents</h3>
        <p className="text-muted-foreground text-sm">Make sure the backend is running at http://localhost:3000</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Agent Status</h2>
          <p className="text-muted-foreground text-sm">Monitor and manage your autonomous AI agents.</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-full premium-card border-primary/10">
          <Activity className="h-4 w-4 text-primary" />
          <span className="text-xs font-bold uppercase tracking-wider">{agents?.length || 0} Agents Registered</span>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {agents?.map((agent) => (
          <AgentCard key={agent.type} agent={agent} />
        ))}
        
        {/* Placeholder for unconfigured agents if needed */}
        {agents?.length === 0 && (
          <div className="col-span-full glass-heavy rounded-[24px] p-12 text-center border-dashed border-2 border-white/5">
            <Bot className="h-16 w-16 mx-auto text-muted-foreground mb-4 opacity-20" />
            <h3 className="text-xl font-bold">No agents active</h3>
            <p className="text-muted-foreground max-w-md mx-auto mb-6">
              Connect an agent adapter like OpenClaw or Claude Code to start orchestrating tasks.
            </p>
            <Button 
              variant="black"
              className="px-6 h-10 rounded-full"
              onClick={() => {}} // Navigate to settings
            >
              Go to Settings
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  const Icon = agent.type === 'openclaw' ? Sparkles : agent.type === 'claude-code' ? Bot : Cpu;

  return (
    <div className="group relative premium-card rounded-2xl p-6 hover-lift transition-liquid overflow-hidden">
      {/* Background glow decoration */}
      <div className={cn(
        "absolute -top-12 -right-12 w-32 h-32 rounded-full blur-[60px] opacity-20 group-hover:opacity-40 transition-opacity",
        agent.healthy.healthy ? "bg-green-500" : "bg-red-500"
      )} />

      <div className="flex items-start justify-between mb-8">
        <div className="flex gap-4">
          <div className="h-12 w-12 rounded-xl glass-heavy flex items-center justify-center border-primary/10 shadow-lg">
            <Icon className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h3 className="text-base font-bold capitalize">{agent.name}</h3>
            <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-tight">{agent.type}</p>
          </div>
        </div>
        <StatusIndicator status={agent.healthy.healthy ? 'online' : 'error'} size="md" />
      </div>

      <div className="space-y-4 mb-8">
        <div className="grid grid-cols-2 gap-3">
          <StatPill label="Success" value={agent.stats.completed} className="text-green-500/80" />
          <StatPill label="Failed" value={agent.stats.failed} className="text-red-500/80" />
        </div>
        
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span className="text-[11px] font-medium">Avg duration:</span>
          </div>
          <span className="text-[11px] font-bold">{(agent.stats.avgDuration / 1000).toFixed(1)}s</span>
        </div>

        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            <span className="text-[11px] font-medium">Latency:</span>
          </div>
          <span className="text-[11px] font-bold text-blue-400">{agent.healthy.latencyMs}ms</span>
        </div>
      </div>

      <div className="pt-4 border-t border-white/5 flex items-center justify-between">
        <div className="flex flex-col">
          <span className="premium-label">Last Active</span>
          <span className="text-[11px] font-medium leading-relaxed">
            {agent.lastActivity ? new Date(agent.lastActivity).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never'}
          </span>
        </div>
        
        <div className="flex gap-2">
           <Button
             variant="ghost"
             size="icon"
             className="h-8 w-8 rounded-lg"
           >
              <Settings className="h-3.5 w-3.5 text-muted-foreground" />
           </Button>
           <Button
             variant="outline"
             size="sm"
             className="h-8 gap-2 rounded-lg"
           >
              <ShieldCheck className="h-3.5 w-3.5 text-blue-400" />
              <span className="text-[10px] font-bold">CONFIG</span>
           </Button>
        </div>
      </div>
    </div>
  );
}

function StatPill({ label, value, className }: { label: string, value: number, className?: string }) {
  return (
    <div className="flex flex-col px-3 py-2 rounded-xl bg-primary/5 border border-primary/5">
      <span className="premium-label">{label}</span>
      <span className={cn("text-lg font-bold leading-tight", className)}>{value}</span>
    </div>
  );
}
