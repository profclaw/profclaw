/**
 * Marketplace Section - Settings UI
 *
 * Browse and install npm plugins and ClawHub skills.
 * Two tabs: "npm Plugins" and "ClawHub Skills".
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search,
  Package,
  Download,
  Trash2,
  RefreshCw,
  Star,
  ToggleLeft,
  ToggleRight,
  Loader2,
  ExternalLink,
  Store,
  ArrowUpCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { API_BASE } from '../constants';

// ---- Types ----------------------------------------------------------------

interface NpmPlugin {
  name: string;
  description: string;
  author: string;
  version: string;
  installed: boolean;
  enabled?: boolean;
  hasUpdate?: boolean;
}

interface ClawHubSkill {
  name: string;
  description: string;
  author: string;
  repo: string;
  path?: string;
  stars?: number;
  installed: boolean;
}

interface PluginUpdate {
  name: string;
  current: string;
  latest: string;
}

// ---- Sub-components -------------------------------------------------------

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

function PluginCard({
  plugin,
  onInstall,
  onUninstall,
  onToggle,
  onUpdate,
  isPending,
  hasUpdate,
}: {
  plugin: NpmPlugin;
  onInstall: (name: string) => void;
  onUninstall: (name: string) => void;
  onToggle: (name: string) => void;
  onUpdate: (name: string) => void;
  isPending: boolean;
  hasUpdate: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 p-4 rounded-lg border bg-card">
      <div className="flex items-start gap-3 min-w-0">
        <div className="mt-0.5 shrink-0 w-8 h-8 rounded-md bg-muted flex items-center justify-center">
          <Package className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{plugin.name}</span>
            {plugin.version && (
              <span className="text-xs text-muted-foreground">v{plugin.version}</span>
            )}
            {hasUpdate && (
              <span className="text-xs text-amber-500 font-medium">update available</span>
            )}
          </div>
          {plugin.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{plugin.description}</p>
          )}
          {plugin.author && (
            <p className="text-xs text-muted-foreground/70 mt-0.5">by {plugin.author}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {plugin.installed ? (
          <>
            {hasUpdate && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onUpdate(plugin.name)}
                disabled={isPending}
                className="h-7 text-xs gap-1"
              >
                <ArrowUpCircle className="w-3 h-3" />
                Update
              </Button>
            )}
            <button
              onClick={() => onToggle(plugin.name)}
              disabled={isPending}
              className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              title={plugin.enabled ? 'Disable plugin' : 'Enable plugin'}
            >
              {plugin.enabled ? (
                <ToggleRight className="w-5 h-5 text-primary" />
              ) : (
                <ToggleLeft className="w-5 h-5" />
              )}
            </button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onUninstall(plugin.name)}
              disabled={isPending}
              className="h-7 text-xs text-destructive hover:text-destructive gap-1"
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            onClick={() => onInstall(plugin.name)}
            disabled={isPending}
            className="h-7 text-xs gap-1"
          >
            {isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Download className="w-3 h-3" />
            )}
            Install
          </Button>
        )}
      </div>
    </div>
  );
}

function SkillCard({
  skill,
  onInstall,
  onUninstall,
  isPending,
}: {
  skill: ClawHubSkill;
  onInstall: (skill: ClawHubSkill) => void;
  onUninstall: (name: string) => void;
  isPending: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 p-4 rounded-lg border bg-card">
      <div className="flex items-start gap-3 min-w-0">
        <div className="mt-0.5 shrink-0 w-8 h-8 rounded-md bg-muted flex items-center justify-center">
          <Star className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{skill.name}</span>
            {skill.stars !== undefined && (
              <span className="flex items-center gap-0.5 text-xs text-amber-500">
                <Star className="w-3 h-3 fill-current" />
                {skill.stars}
              </span>
            )}
          </div>
          {skill.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{skill.description}</p>
          )}
          <a
            href={`https://github.com/${skill.repo}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground/70 hover:text-foreground mt-0.5 transition-colors"
          >
            <ExternalLink className="w-2.5 h-2.5" />
            {skill.repo}
          </a>
        </div>
      </div>
      <div className="shrink-0">
        {skill.installed ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onUninstall(skill.name)}
            disabled={isPending}
            className="h-7 text-xs text-destructive hover:text-destructive gap-1"
          >
            <Trash2 className="w-3 h-3" />
            Remove
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => onInstall(skill)}
            disabled={isPending}
            className="h-7 text-xs gap-1"
          >
            {isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Download className="w-3 h-3" />
            )}
            Install
          </Button>
        )}
      </div>
    </div>
  );
}

// ---- npm Plugins Tab -------------------------------------------------------

function NpmPluginsTab() {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const qc = useQueryClient();

  // Debounce search
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    const timer = setTimeout(() => setDebouncedQuery(value), 400);
    return () => clearTimeout(timer);
  };

  const { data: installed = [], isLoading: loadingInstalled } = useQuery<NpmPlugin[]>({
    queryKey: ['plugins', 'installed'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/plugins`);
      if (!res.ok) throw new Error('Failed to load plugins');
      return res.json() as Promise<NpmPlugin[]>;
    },
  });

  const { data: searchResults = [], isFetching: searching } = useQuery<NpmPlugin[]>({
    queryKey: ['plugins', 'search', debouncedQuery],
    queryFn: async () => {
      if (!debouncedQuery.trim()) return [];
      const res = await fetch(`${API_BASE}/api/plugins/search?q=${encodeURIComponent(debouncedQuery)}`);
      if (!res.ok) throw new Error('Search failed');
      return res.json() as Promise<NpmPlugin[]>;
    },
    enabled: debouncedQuery.trim().length > 0,
  });

  const { data: updates = [] } = useQuery<PluginUpdate[]>({
    queryKey: ['plugins', 'updates'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/plugins/updates`);
      if (!res.ok) return [];
      return res.json() as Promise<PluginUpdate[]>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const installMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(`${API_BASE}/api/plugins/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error('Install failed');
    },
    onSuccess: (_, name) => {
      toast.success(`Installed ${name}`);
      qc.invalidateQueries({ queryKey: ['plugins'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const uninstallMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(`${API_BASE}/api/plugins/uninstall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error('Uninstall failed');
    },
    onSuccess: (_, name) => {
      toast.success(`Removed ${name}`);
      qc.invalidateQueries({ queryKey: ['plugins'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(`${API_BASE}/api/plugins/${encodeURIComponent(name)}/toggle`, {
        method: 'PATCH',
      });
      if (!res.ok) throw new Error('Toggle failed');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plugins', 'installed'] }),
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(`${API_BASE}/api/plugins/${encodeURIComponent(name)}/update`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Update failed');
    },
    onSuccess: (_, name) => {
      toast.success(`Updated ${name}`);
      qc.invalidateQueries({ queryKey: ['plugins'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const checkUpdatesMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/plugins/updates`);
      if (!res.ok) throw new Error('Check failed');
      return res.json() as Promise<PluginUpdate[]>;
    },
    onSuccess: (data: PluginUpdate[]) => {
      qc.setQueryData(['plugins', 'updates'], data);
      toast.success(data.length > 0 ? `${data.length} update(s) available` : 'All plugins up to date');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateNames = new Set(updates.map((u) => u.name));
  const pendingName =
    installMutation.variables ??
    uninstallMutation.variables ??
    toggleMutation.variables ??
    updateMutation.variables;

  const notInstalled = searchResults.filter(
    (r) => !installed.some((i) => i.name === r.name)
  );

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search npm plugins..."
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="pl-9"
        />
        {searching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Search results */}
      {debouncedQuery.trim() && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Search Results</h3>
          {notInstalled.length === 0 && !searching ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No results found</p>
          ) : (
            <div className="space-y-2">
              {notInstalled.map((plugin) => (
                <PluginCard
                  key={plugin.name}
                  plugin={plugin}
                  onInstall={(name) => installMutation.mutate(name)}
                  onUninstall={(name) => uninstallMutation.mutate(name)}
                  onToggle={(name) => toggleMutation.mutate(name)}
                  onUpdate={(name) => updateMutation.mutate(name)}
                  isPending={pendingName === plugin.name}
                  hasUpdate={updateNames.has(plugin.name)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Installed */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-muted-foreground">
            Installed ({installed.length})
          </h3>
          <Button
            size="sm"
            variant="outline"
            onClick={() => checkUpdatesMutation.mutate()}
            disabled={checkUpdatesMutation.isPending}
            className="h-7 text-xs gap-1"
          >
            {checkUpdatesMutation.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
            Check Updates
          </Button>
        </div>
        {loadingInstalled ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : installed.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No plugins installed yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {installed.map((plugin) => (
              <PluginCard
                key={plugin.name}
                plugin={plugin}
                onInstall={(name) => installMutation.mutate(name)}
                onUninstall={(name) => uninstallMutation.mutate(name)}
                onToggle={(name) => toggleMutation.mutate(name)}
                onUpdate={(name) => updateMutation.mutate(name)}
                isPending={pendingName === plugin.name}
                hasUpdate={updateNames.has(plugin.name)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- ClawHub Skills Tab ----------------------------------------------------

function ClawHubSkillsTab() {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const qc = useQueryClient();

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    const timer = setTimeout(() => setDebouncedQuery(value), 400);
    return () => clearTimeout(timer);
  };

  const { data: featured = [], isLoading: loadingFeatured } = useQuery<ClawHubSkill[]>({
    queryKey: ['clawhub', 'featured'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/clawhub/featured`);
      if (!res.ok) throw new Error('Failed to load featured skills');
      return res.json() as Promise<ClawHubSkill[]>;
    },
  });

  const { data: installed = [], isLoading: loadingInstalled } = useQuery<ClawHubSkill[]>({
    queryKey: ['clawhub', 'installed'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/clawhub/installed`);
      if (!res.ok) throw new Error('Failed to load installed skills');
      return res.json() as Promise<ClawHubSkill[]>;
    },
  });

  const { data: searchResults = [], isFetching: searching } = useQuery<ClawHubSkill[]>({
    queryKey: ['clawhub', 'search', debouncedQuery],
    queryFn: async () => {
      if (!debouncedQuery.trim()) return [];
      const res = await fetch(`${API_BASE}/api/clawhub/search?q=${encodeURIComponent(debouncedQuery)}`);
      if (!res.ok) throw new Error('Search failed');
      return res.json() as Promise<ClawHubSkill[]>;
    },
    enabled: debouncedQuery.trim().length > 0,
  });

  const installMutation = useMutation({
    mutationFn: async (skill: ClawHubSkill) => {
      const res = await fetch(`${API_BASE}/api/clawhub/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: skill.name,
          repo: skill.repo,
          path: skill.path,
          author: skill.author,
        }),
      });
      if (!res.ok) throw new Error('Install failed');
    },
    onSuccess: (_, skill) => {
      toast.success(`Installed ${skill.name}`);
      qc.invalidateQueries({ queryKey: ['clawhub'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const uninstallMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(`${API_BASE}/api/clawhub/uninstall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error('Uninstall failed');
    },
    onSuccess: (_, name) => {
      toast.success(`Removed ${name}`);
      qc.invalidateQueries({ queryKey: ['clawhub'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const installedNames = new Set(installed.map((s) => s.name));
  const pendingInstall = installMutation.variables?.name;
  const pendingUninstall = uninstallMutation.variables;

  const notInstalled = searchResults.filter((r) => !installedNames.has(r.name));
  const notInstalledFeatured = featured.filter((f) => !installedNames.has(f.name));

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search ClawHub skills..."
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="pl-9"
        />
        {searching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Search results */}
      {debouncedQuery.trim() && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Search Results</h3>
          {notInstalled.length === 0 && !searching ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No results found</p>
          ) : (
            <div className="space-y-2">
              {notInstalled.map((skill) => (
                <SkillCard
                  key={skill.name}
                  skill={skill}
                  onInstall={(s) => installMutation.mutate(s)}
                  onUninstall={(name) => uninstallMutation.mutate(name)}
                  isPending={pendingInstall === skill.name || pendingUninstall === skill.name}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Featured */}
      {!debouncedQuery.trim() && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5 text-amber-500" />
            Featured Skills
          </h3>
          {loadingFeatured ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : notInstalledFeatured.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">All featured skills are installed.</p>
          ) : (
            <div className="space-y-2">
              {notInstalledFeatured.map((skill) => (
                <SkillCard
                  key={skill.name}
                  skill={skill}
                  onInstall={(s) => installMutation.mutate(s)}
                  onUninstall={(name) => uninstallMutation.mutate(name)}
                  isPending={pendingInstall === skill.name || pendingUninstall === skill.name}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Installed */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          Installed ({installed.length})
        </h3>
        {loadingInstalled ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : installed.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Star className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No ClawHub skills installed yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {installed.map((skill) => (
              <SkillCard
                key={skill.name}
                skill={{ ...skill, installed: true }}
                onInstall={(s) => installMutation.mutate(s)}
                onUninstall={(name) => uninstallMutation.mutate(name)}
                isPending={pendingInstall === skill.name || pendingUninstall === skill.name}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Main export -----------------------------------------------------------

type MarketplaceTab = 'npm' | 'clawhub';

export function MarketplaceSection() {
  const [activeTab, setActiveTab] = useState<MarketplaceTab>('npm');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Store className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Marketplace</h2>
          <p className="text-sm text-muted-foreground">Browse and install plugins and skills</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b">
        <div className="flex gap-1">
          <TabButton active={activeTab === 'npm'} onClick={() => setActiveTab('npm')}>
            npm Plugins
          </TabButton>
          <TabButton active={activeTab === 'clawhub'} onClick={() => setActiveTab('clawhub')}>
            ClawHub Skills
          </TabButton>
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'npm' ? <NpmPluginsTab /> : <ClawHubSkillsTab />}
    </div>
  );
}
