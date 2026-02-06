/**
 * Chat Header Component
 *
 * Clean, minimal header with model/preset selection and actions.
 */

import { Link } from 'react-router-dom';
import {
  Sparkles,
  MessageSquarePlus,
  History,
  Key,
  Settings2,
  Trash2,
  Brain,
  Bot,
  Code,
  ClipboardList,
  BarChart2,
  PenTool,
  Plug,
  Maximize2,
  Minimize2,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ChatPreset, MemoryStats, Provider, ModelAlias } from '../types';

// Preset icons mapping
const PRESET_ICONS: Record<string, LucideIcon> = {
  bot: Bot,
  code: Code,
  'clipboard-list': ClipboardList,
  'bar-chart-2': BarChart2,
  'pen-tool': PenTool,
};

function PresetIcon({ icon, className }: { icon: string; className?: string }) {
  const IconComponent = PRESET_ICONS[icon] || Bot;
  return <IconComponent className={className} />;
}

interface ChatHeaderProps {
  // Data
  currentPreset?: ChatPreset;
  presets: ChatPreset[];
  selectedPreset: string;
  selectedModel: string;
  aliases: ModelAlias[];
  providers: Provider[];
  healthyProviders: Provider[];
  memoryStats?: MemoryStats;
  conversationId: string | null;
  enabledPlugins?: number;
  focusedView?: boolean;
  // Actions
  onPresetChange: (preset: string) => void;
  onModelChange: (model: string) => void;
  onNewChat: () => void;
  onOpenHistory: () => void;
  onOpenProviderSetup: () => void;
  onClearChat: () => void;
  onToggleFocusedView?: () => void;
}

export function ChatHeader({
  currentPreset,
  presets,
  selectedPreset,
  selectedModel,
  aliases,
  providers,
  healthyProviders,
  memoryStats,
  conversationId,
  enabledPlugins = 0,
  focusedView = false,
  onPresetChange,
  onModelChange,
  onNewChat,
  onOpenHistory,
  onOpenProviderSetup,
  onClearChat,
  onToggleFocusedView,
}: ChatHeaderProps) {
  const usagePercentage = memoryStats?.stats.usagePercentage ?? 0;

  return (
    <div className="px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        {/* Left: Icon & Title */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="h-9 w-9 rounded-xl glass-heavy flex items-center justify-center shrink-0 border-primary/10 shadow-lg shadow-primary/5">
            <Sparkles className="h-4.5 w-4.5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold truncate">Chat</h1>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {healthyProviders.length > 0 ? (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
                  <span className="truncate">{healthyProviders.length} active</span>
                </>
              ) : (
                <button
                  onClick={onOpenProviderSetup}
                  className="text-amber-500 hover:underline truncate"
                >
                  Configure provider
                </button>
              )}
              {conversationId && memoryStats && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button 
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                        aria-label={`Context usage: ${Math.round(usagePercentage)}%`}
                      >
                        <Brain className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <div className="w-8 h-1 bg-muted rounded-full overflow-hidden" aria-hidden="true">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all duration-300",
                              usagePercentage <= 50 && "bg-green-500",
                              usagePercentage > 50 && usagePercentage <= 70 && "bg-primary",
                              usagePercentage > 70 && usagePercentage <= 90 && "bg-amber-500",
                              usagePercentage > 90 && "bg-red-500"
                            )}
                            style={{ width: `${Math.min(usagePercentage, 100)}%` }}
                          />
                        </div>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <div className="space-y-1.5">
                        <p className="font-medium text-sm">Context Memory</p>
                        <div className="text-xs text-muted-foreground space-y-0.5">
                          <p>{memoryStats.stats.messageCount} messages · ~{memoryStats.stats.estimatedTokens.toLocaleString()} tokens</p>
                          <p>Using {Math.round(usagePercentage)}% of {(memoryStats.stats.contextWindow / 1000).toFixed(0)}k window</p>
                          {memoryStats.stats.needsCompaction && (
                            <p className="text-amber-500">Will compact on next message</p>
                          )}
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Model & Preset Selector */}
          <div className="hidden sm:flex items-center bg-muted/40 rounded-xl p-0.5">
            <Select value={selectedPreset} onValueChange={onPresetChange}>
              <SelectTrigger 
                className="h-7 w-auto border-0 bg-transparent shadow-none text-xs gap-1 px-2 hover:bg-muted/60 rounded-lg"
                aria-label="Select chat preset"
              >
                <PresetIcon icon={currentPreset?.icon || 'bot'} className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="hidden md:inline max-w-[80px] truncate">
                  <SelectValue />
                </span>
              </SelectTrigger>
              <SelectContent className="glass-dropdown">
                {presets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    <div className="flex items-center gap-2">
                      <PresetIcon icon={preset.icon} className="h-4 w-4" />
                      <span>{preset.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="w-px h-4 bg-border/50" />

            <Select value={selectedModel} onValueChange={onModelChange}>
              <SelectTrigger 
                className="h-7 w-auto border-0 bg-transparent shadow-none text-xs gap-1.5 px-2 hover:bg-muted/60 rounded-lg"
                aria-label="Select AI model"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="glass-dropdown min-w-45">
                {/* Only show configured providers */}
                {(() => {
                  // Get configured provider types
                  const configuredProviderTypes = new Set(providers.map(p => p.type));

                  // Filter aliases to only show configured providers, get best alias per provider
                  const providerGroups = aliases
                    .filter(alias => configuredProviderTypes.has(alias.provider))
                    .reduce((acc, alias) => {
                      const key = alias.provider;
                      // Prefer shorter alias names (e.g., "llama" over "local", "gpt" over "gpt-mini")
                      if (!acc[key] || alias.alias.length < acc[key].alias.length) {
                        acc[key] = alias;
                      }
                      return acc;
                    }, {} as Record<string, ModelAlias>);

                  // Sort by health status, then by name
                  const sortedProviders = Object.entries(providerGroups)
                    .sort(([, a], [, b]) => {
                      const aHealthy = providers.find((p) => p.type === a.provider)?.healthy ? 1 : 0;
                      const bHealthy = providers.find((p) => p.type === b.provider)?.healthy ? 1 : 0;
                      return bHealthy - aHealthy || a.provider.localeCompare(b.provider);
                    });

                  return sortedProviders.map(([providerType, alias]) => {
                    const provider = providers.find((p) => p.type === providerType);
                    const isHealthy = provider?.healthy;
                    const isLocal = providerType === 'ollama';
                    return (
                      <SelectItem key={alias.alias} value={alias.alias} className="py-2">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "h-1.5 w-1.5 rounded-full shrink-0",
                            isHealthy ? 'bg-green-500' : 'bg-amber-400'
                          )} />
                          <span className="capitalize font-medium">{alias.alias}</span>
                          <span className="text-xs text-muted-foreground ml-1">
                            {isLocal ? 'Local' : alias.provider}
                          </span>
                        </div>
                      </SelectItem>
                    );
                  });
                })()}

                {/* Manage Providers Link */}
                <div className="border-t border-border/50 mt-1 pt-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onOpenProviderSetup();
                    }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-sm transition-colors"
                  >
                    <Key className="h-3 w-3" />
                    <span>Manage Providers...</span>
                  </button>
                </div>
              </SelectContent>
            </Select>
          </div>

          {/* Action Buttons */}
          {onToggleFocusedView && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onToggleFocusedView}
                  className={cn("h-8 w-8 shrink-0", focusedView && "bg-primary/10 text-primary")}
                  aria-label={focusedView ? 'Exit focused view' : 'Enter focused view'}
                  aria-pressed={focusedView}
                >
                  {focusedView ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{focusedView ? 'Exit focused view' : 'Focused view'}</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={onNewChat} 
                className="h-8 w-8 shrink-0"
                aria-label="New chat"
              >
                <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New chat</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={onOpenHistory} 
                className="h-8 w-8 shrink-0"
                aria-label="View history"
              >
                <History className="h-4 w-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>History</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={onOpenProviderSetup} 
                className="h-8 w-8 shrink-0"
                aria-label="Manage API keys"
              >
                <Key className="h-4 w-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>API Keys</TooltipContent>
          </Tooltip>

          {/* Plugins Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 relative" asChild aria-label={`Plugins and Tools (${enabledPlugins} enabled)`}>
                <Link to="/settings/plugins">
                  <Plug className="h-4 w-4" aria-hidden="true" />
                  {enabledPlugins > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-primary text-[9px] font-medium text-primary-foreground flex items-center justify-center" aria-hidden="true">
                      {enabledPlugins}
                    </span>
                  )}
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Plugins & Tools</TooltipContent>
          </Tooltip>

          {/* Settings Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Chat settings">
                <Settings2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 glass-dropdown">
              <DropdownMenuItem onClick={onNewChat}>
                <MessageSquarePlus className="h-4 w-4 mr-2" />
                New Chat
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onClearChat} className="text-destructive focus:text-destructive">
                <Trash2 className="h-4 w-4 mr-2" />
                Clear Chat
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
