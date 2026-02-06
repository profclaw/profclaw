/**
 * Plugins Section
 *
 * Manage core plugins, webhook receivers, and CLI/MCP commands.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Terminal,
  Cpu,
  Zap,
  Github,
  Webhook,
  Plug,
  CheckCircle2,
  AlertCircle,
  XCircle,
  RefreshCw,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { api, type PluginHealth } from '@/core/api/client';
import { SettingsCard } from '../components/SettingsCard';
import { CommandLine } from '../components/CommandLine';

export function PluginsSection() {
  const queryClient = useQueryClient();

  const {
    data: healthData,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['plugins', 'health'],
    queryFn: () => api.plugins.health(),
    refetchInterval: 30000,
  });

  const togglePlugin = useMutation({
    mutationFn: ({
      pluginId,
      enabled,
    }: {
      pluginId: string;
      enabled: boolean;
    }) => api.plugins.toggle(pluginId, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Plugin updated');
    },
    onError: (error) => {
      toast.error('Failed to update plugin', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  const plugins = healthData?.plugins || [];

  const getStatusColor = (status: PluginHealth['status']) => {
    switch (status) {
      case 'online':
        return {
          bg: 'bg-green-500/10',
          text: 'text-green-500',
          border: 'border-green-500/20',
        };
      case 'offline':
        return {
          bg: 'bg-yellow-500/10',
          text: 'text-yellow-500',
          border: 'border-yellow-500/20',
        };
      case 'error':
        return {
          bg: 'bg-red-500/10',
          text: 'text-red-500',
          border: 'border-red-500/20',
        };
      case 'disabled':
        return {
          bg: 'bg-muted/50',
          text: 'text-muted-foreground',
          border: 'border-border',
        };
    }
  };

  const getStatusIcon = (status: PluginHealth['status']) => {
    switch (status) {
      case 'online':
        return <CheckCircle2 className="h-4 w-4" />;
      case 'offline':
        return <AlertCircle className="h-4 w-4" />;
      case 'error':
        return <XCircle className="h-4 w-4" />;
      case 'disabled':
        return <XCircle className="h-4 w-4" />;
    }
  };

  const getPluginIcon = (id: string) => {
    if (id.includes('mcp')) return <Terminal className="h-5 w-5" />;
    if (id.includes('cli')) return <Cpu className="h-5 w-5" />;
    if (id.includes('ollama')) return <Zap className="h-5 w-5" />;
    if (id.includes('github')) return <Github className="h-5 w-5" />;
    if (id.includes('webhook')) return <Webhook className="h-5 w-5" />;
    return <Plug className="h-5 w-5" />;
  };

  const corePlugins = plugins.filter((p) =>
    ['mcp-server', 'cli-access', 'ollama'].includes(p.id),
  );
  const webhookPlugins = plugins.filter((p) => p.id.startsWith('webhook-'));

  return (
    <>
      {/* Refresh Button */}
      <div className="flex justify-end mb-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isRefetching}
          className="rounded-xl"
        >
          <RefreshCw
            className={cn('h-4 w-4 mr-2', isRefetching && 'animate-spin')}
          />
          Refresh Status
        </Button>
      </div>

      {/* Core Plugins */}
      <SettingsCard
        title="Core Plugins"
        description="Essential profClaw extensions"
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            {corePlugins.map((plugin) => {
              const colors = getStatusColor(plugin.status);
              return (
                <div
                  key={plugin.id}
                  className={cn(
                    'flex items-center justify-between p-4 rounded-xl border',
                    colors.border,
                    colors.bg,
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        'h-10 w-10 rounded-xl flex items-center justify-center',
                        colors.bg,
                        colors.text,
                      )}
                    >
                      {getPluginIcon(plugin.id)}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{plugin.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span
                          className={cn(
                            'flex items-center gap-1 text-xs',
                            colors.text,
                          )}
                        >
                          {getStatusIcon(plugin.status)}
                          {plugin.status.toUpperCase()}
                        </span>
                        {plugin.message && (
                          <span className="text-xs text-muted-foreground">
                            - {plugin.message}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Switch
                    checked={plugin.enabled}
                    onCheckedChange={(checked) =>
                      togglePlugin.mutate({
                        pluginId: plugin.id,
                        enabled: checked,
                      })
                    }
                    disabled={togglePlugin.isPending}
                  />
                </div>
              );
            })}
          </div>
        )}
      </SettingsCard>

      {/* Webhook Integrations */}
      <SettingsCard
        title="Webhook Receivers"
        description="Receive events from external services"
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {webhookPlugins.map((plugin) => {
              const colors = getStatusColor(plugin.status);
              return (
                <div
                  key={plugin.id}
                  className={cn(
                    'flex items-center justify-between p-3 rounded-xl border',
                    colors.border,
                    colors.bg,
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div className={cn(colors.text)}>
                      {getPluginIcon(plugin.id)}
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {plugin.name.replace(' Webhook', '')}
                      </p>
                      <span className={cn('text-xs', colors.text)}>
                        {plugin.status.toUpperCase()}
                      </span>
                    </div>
                  </div>
                  <Switch
                    checked={plugin.enabled}
                    onCheckedChange={(checked) =>
                      togglePlugin.mutate({
                        pluginId: plugin.id,
                        enabled: checked,
                      })
                    }
                    disabled={togglePlugin.isPending}
                  />
                </div>
              );
            })}
          </div>
        )}
      </SettingsCard>

      {/* CLI Quick Reference */}
      <SettingsCard
        title="CLI & MCP Commands"
        description="Control profClaw from your terminal"
      >
        {/* Terminal Window */}
        <div className="rounded-xl overflow-hidden border border-border">
          {/* Terminal Header */}
          <div className="bg-muted/80 px-4 py-2 flex items-center gap-2 border-b border-border">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
            </div>
            <span className="text-xs text-muted-foreground ml-2 font-mono">
              Terminal
            </span>
          </div>

          {/* Terminal Content */}
          <div className="bg-zinc-950 dark:bg-zinc-900 p-4 space-y-4">
            {/* Task Commands */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
                Task Management
              </p>
              <div className="space-y-1">
                <CommandLine
                  command="profclaw task list"
                  description="List all tasks"
                />
                <CommandLine
                  command="profclaw task create"
                  description="Create a new task"
                />
                <CommandLine
                  command="profclaw task get <id>"
                  description="Get task details"
                />
              </div>
            </div>

            {/* Config Commands */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
                Configuration
              </p>
              <div className="space-y-1">
                <CommandLine
                  command="profclaw config get"
                  description="View settings"
                />
                <CommandLine
                  command="profclaw config set --key value"
                  description="Update settings"
                />
              </div>
            </div>

            {/* Server Commands */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
                Server & MCP
              </p>
              <div className="space-y-1">
                <CommandLine
                  command="profclaw serve --port 3000"
                  description="Start API server"
                />
                <CommandLine
                  command="npx profclaw-mcp"
                  description="Run MCP server for AI agents"
                  highlight
                />
              </div>
            </div>
          </div>
        </div>

        {/* Installation Hint */}
        <div className="mt-4 flex items-center gap-3 p-3 rounded-xl bg-primary/5 border border-primary/20">
          <Terminal className="h-5 w-5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Install CLI Globally</p>
            <p className="text-xs text-muted-foreground">
              npm install -g @profclaw/task-manager
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg text-xs"
            onClick={() =>
              window.open(
                'https://github.com/profclaw/profclaw-task-manager',
                '_blank',
              )
            }
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            Docs
          </Button>
        </div>
      </SettingsCard>
    </>
  );
}
