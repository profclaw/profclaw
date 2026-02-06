/**
 * Tools Section
 *
 * Displays available AI tools, their configuration status, and availability.
 * Tools that require external dependencies (API keys, binaries) show their status.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronDown,
  Wrench,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Globe,
  Database,
  GitBranch,
  MonitorPlay,
  Brain,
  Loader2,
  RefreshCw,
  Search,
  Filter,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { SettingsCard } from '../components';
import { API_BASE } from '../constants';

// Types
interface ToolAvailability {
  available: boolean;
  reason?: string;
}

interface Tool {
  name: string;
  description: string;
  category: string;
  securityLevel: 'safe' | 'moderate' | 'dangerous';
  requiresApproval?: boolean;
  availability: ToolAvailability;
}

interface ToolsResponse {
  tools: Tool[];
  byCategory: Record<string, Tool[]>;
  summary: {
    total: number;
    available: number;
    unavailable: number;
  };
}

// Category metadata for display
const CATEGORY_INFO: Record<string, { icon: typeof Wrench; label: string; description: string }> = {
  execution: {
    icon: Terminal,
    label: 'Execution',
    description: 'Shell commands and scripts',
  },
  filesystem: {
    icon: Database,
    label: 'Filesystem',
    description: 'File read/write operations',
  },
  web: {
    icon: Globe,
    label: 'Web',
    description: 'Web search and fetching',
  },
  git: {
    icon: GitBranch,
    label: 'Git',
    description: 'Version control operations',
  },
  browser: {
    icon: MonitorPlay,
    label: 'Browser',
    description: 'Browser automation (Playwright)',
  },
  glinr: {
    icon: Wrench,
    label: 'GLINR',
    description: 'Ticket and project management',
  },
  memory: {
    icon: Brain,
    label: 'Memory',
    description: 'Semantic memory storage',
  },
  data: {
    icon: Database,
    label: 'Data',
    description: 'Database and API operations',
  },
  system: {
    icon: Terminal,
    label: 'System',
    description: 'System information',
  },
  custom: {
    icon: Wrench,
    label: 'Custom',
    description: 'User-defined tools',
  },
};

// Security level badges
function SecurityBadge({ level }: { level: 'safe' | 'moderate' | 'dangerous' }) {
  const config = {
    safe: {
      icon: ShieldCheck,
      label: 'Safe',
      className: 'text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30',
    },
    moderate: {
      icon: Shield,
      label: 'Moderate',
      className: 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30',
    },
    dangerous: {
      icon: ShieldAlert,
      label: 'Dangerous',
      className: 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30',
    },
  };

  const { icon: Icon, label, className } = config[level];

  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium', className)}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

// Availability status indicator
function AvailabilityIndicator({ availability }: { availability: ToolAvailability }) {
  if (availability.available) {
    return (
      <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span className="text-xs">Available</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
      <AlertCircle className="h-3.5 w-3.5" />
      <span className="text-xs">{availability.reason || 'Not configured'}</span>
    </span>
  );
}

// Tool item component
function ToolItem({ tool }: { tool: Tool }) {
  return (
    <div
      className={cn(
        'rounded-lg p-3 transition-colors',
        tool.availability.available
          ? 'bg-muted/30'
          : 'bg-amber-50/50 dark:bg-amber-900/10'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-sm font-mono font-medium text-foreground">{tool.name}</code>
            <SecurityBadge level={tool.securityLevel} />
            {tool.requiresApproval && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30">
                Requires Approval
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{tool.description}</p>
        </div>
        <div className="flex-shrink-0">
          <AvailabilityIndicator availability={tool.availability} />
        </div>
      </div>

      {/* Expand for more details */}
      {!tool.availability.available && (
        <div className="mt-2 pt-2 border-t border-amber-200/20 dark:border-amber-800/30">
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Configure this tool in the Integrations section to enable it.
          </p>
        </div>
      )}
    </div>
  );
}

// Category group component
function CategoryGroup({
  category,
  tools,
  defaultExpanded = false,
}: {
  category: string;
  tools: Tool[];
  defaultExpanded?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const info = CATEGORY_INFO[category] || CATEGORY_INFO.custom;
  const Icon = info.icon;

  const availableCount = tools.filter((t) => t.availability.available).length;
  const unavailableCount = tools.length - availableCount;

  return (
    <div className="rounded-lg bg-muted/20 overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-background">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="text-left">
            <h3 className="font-medium text-sm">{info.label}</h3>
            <p className="text-xs text-muted-foreground">{info.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs">
            {availableCount > 0 && (
              <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {availableCount}
              </span>
            )}
            {unavailableCount > 0 && (
              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <AlertCircle className="h-3.5 w-3.5" />
                {unavailableCount}
              </span>
            )}
          </div>
          <ChevronDown
            className={cn('h-4 w-4 text-muted-foreground transition-transform', isExpanded && 'rotate-180')}
          />
        </div>
      </button>

      {isExpanded && (
        <div className="p-3 space-y-2 bg-background">
          {tools.map((tool) => (
            <ToolItem key={tool.name} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}

// Main component
export function ToolsSection() {
  const [searchQuery, setSearchQuery] = useState('');
  const [showUnavailableOnly, setShowUnavailableOnly] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = useQuery<ToolsResponse>({
    queryKey: ['tools', 'availability'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/tools/list/availability`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch tools');
      return res.json();
    },
    staleTime: 30000,
  });

  // Filter tools
  const filteredCategories = data?.byCategory
    ? Object.entries(data.byCategory).reduce(
        (acc, [category, tools]) => {
          let filtered = tools;

          // Apply search filter
          if (searchQuery) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(
              (t) =>
                t.name.toLowerCase().includes(query) ||
                t.description.toLowerCase().includes(query)
            );
          }

          // Apply availability filter
          if (showUnavailableOnly) {
            filtered = filtered.filter((t) => !t.availability.available);
          }

          if (filtered.length > 0) {
            acc[category] = filtered;
          }

          return acc;
        },
        {} as Record<string, Tool[]>
      )
    : {};

  if (isLoading) {
    return (
      <SettingsCard
        title="AI Tools"
        description="Tools available for AI agents"
      >
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </SettingsCard>
    );
  }

  if (error) {
    return (
      <SettingsCard
        title="AI Tools"
        description="Tools available for AI agents"
      >
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <XCircle className="h-8 w-8 text-destructive mb-2" />
          <p className="text-sm text-muted-foreground">Failed to load tools</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-4">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </SettingsCard>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <SettingsCard
        title="AI Tools"
        description="Configure tools available to AI agents"
      >
        {/* Refresh button */}
        <div className="flex justify-end mb-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn('h-4 w-4 mr-2', isFetching && 'animate-spin')} />
            Refresh
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="p-4 rounded-lg bg-muted/30 text-center">
            <p className="text-2xl font-bold">{data?.summary.total ?? 0}</p>
            <p className="text-xs text-muted-foreground">Total Tools</p>
          </div>
          <div className="p-4 rounded-lg bg-green-100 dark:bg-green-900/20 text-center">
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">
              {data?.summary.available ?? 0}
            </p>
            <p className="text-xs text-green-700 dark:text-green-300">Available</p>
          </div>
          <div className="p-4 rounded-lg bg-amber-100 dark:bg-amber-900/20 text-center">
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
              {data?.summary.unavailable ?? 0}
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300">Need Config</p>
          </div>
        </div>

        {/* Search and filters */}
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tools..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button
            variant={showUnavailableOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowUnavailableOnly(!showUnavailableOnly)}
          >
            <Filter className="h-4 w-4 mr-2" />
            {showUnavailableOnly ? 'Show All' : 'Needs Setup'}
          </Button>
        </div>

        {/* Info banner for unavailable tools */}
        {data && data.summary.unavailable > 0 && !showUnavailableOnly && (
          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 mb-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div className="text-sm">
                <p className="text-amber-800 dark:text-amber-200">
                  <strong>{data.summary.unavailable} tools</strong> need configuration
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                  Configure API keys or install dependencies in Integrations to enable these tools.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tool categories */}
        <div className="space-y-3">
          {Object.entries(filteredCategories).length > 0 ? (
            Object.entries(filteredCategories).map(([category, tools]) => (
              <CategoryGroup
                key={category}
                category={category}
                tools={tools}
                defaultExpanded={showUnavailableOnly || Object.keys(filteredCategories).length <= 3}
              />
            ))
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Wrench className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No tools match your search</p>
            </div>
          )}
        </div>
      </SettingsCard>
    </div>
  );
}
