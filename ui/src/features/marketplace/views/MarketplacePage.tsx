/**
 * Marketplace Page
 *
 * Browse, search, and install skills and plugins.
 * Shows categories, featured skills, effectiveness stats, and install flow.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/core/api/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Store, Search, Download, Star, Zap, Package, Layers,
  CheckCircle, XCircle, Loader2, Filter,
  BarChart3, Sparkles, Grid3x3,
} from 'lucide-react';

export function MarketplacePage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'skills' | 'browse' | 'stats'>('skills');
  const queryClient = useQueryClient();

  const { data: skillsData, isLoading: skillsLoading } = useQuery({
    queryKey: ['skills', 'list'],
    queryFn: api.skills.list,
  });

  const { data: categories } = useQuery({
    queryKey: ['skills', 'categories'],
    queryFn: api.skills.categories,
  });

  const { data: overview } = useQuery({
    queryKey: ['skills', 'overview'],
    queryFn: api.skills.overview,
  });

  const { data: searchResults, isLoading: searchLoading } = useQuery({
    queryKey: ['skills', 'marketplace', searchQuery, selectedCategory],
    queryFn: () => api.skills.marketplaceSearch(searchQuery || undefined, selectedCategory || undefined),
    enabled: activeTab === 'browse',
  });

  const installMutation = useMutation({
    mutationFn: (source: string) => api.skills.install(source),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      api.skills.toggle(name, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });

  const skills = skillsData?.skills ?? [];
  const stats = overview?.data;
  const cats = categories?.data ?? [];

  // Filter skills
  const filteredSkills = skills.filter(s => {
    if (searchQuery && !s.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !s.description.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (selectedCategory && !s.toolCategories.includes(selectedCategory)) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Store className="h-6 w-6 text-primary" />
            Marketplace
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {stats ? `${stats.total} skills installed, ${stats.enabled} active` : 'Browse and install skills'}
          </p>
        </div>
      </div>

      {/* Stats Row */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Total Skills', value: stats.total, icon: Package },
            { label: 'Active', value: stats.enabled, icon: CheckCircle },
            { label: 'User Commands', value: stats.userInvocable, icon: Zap },
            { label: 'AI Callable', value: stats.modelInvocable, icon: Sparkles },
            { label: 'MCP Servers', value: stats.mcpServers, icon: Layers },
          ].map(({ label, value, icon: Icon }) => (
            <Card key={label} className="p-3 text-center">
              <Icon className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
              <div className="text-lg font-bold">{value}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </Card>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-muted/50 w-fit">
        {(['skills', 'browse', 'stats'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors capitalize ${
              activeTab === tab
                ? 'bg-background shadow-sm font-medium'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab === 'skills' ? 'Installed' : tab === 'browse' ? 'Browse Registry' : 'Stats'}
          </button>
        ))}
      </div>

      {/* Search + Category Filter */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={activeTab === 'browse' ? 'Search marketplace...' : 'Filter installed skills...'}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        {selectedCategory && (
          <button
            onClick={() => setSelectedCategory(null)}
            className="px-3 py-2 text-sm rounded-lg bg-primary/10 text-primary flex items-center gap-1.5"
          >
            <Filter className="h-3.5 w-3.5" />
            {selectedCategory}
            <XCircle className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Categories */}
      {cats.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {cats.map(cat => (
            <button
              key={cat.name}
              onClick={() => setSelectedCategory(selectedCategory === cat.name ? null : cat.name)}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                selectedCategory === cat.name
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {cat.name} ({cat.count})
            </button>
          ))}
        </div>
      )}

      {/* Installed Skills Tab */}
      {activeTab === 'skills' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {skillsLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="p-4 animate-pulse">
                <div className="h-5 w-32 bg-muted rounded mb-2" />
                <div className="h-4 w-48 bg-muted rounded" />
              </Card>
            ))
          ) : (
            filteredSkills.map(skill => (
              <Card key={skill.name} className="p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{skill.emoji ?? '🔧'}</span>
                    <div>
                      <h4 className="font-medium text-sm">{skill.name}</h4>
                      <p className="text-xs text-muted-foreground line-clamp-1">{skill.description}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleMutation.mutate({ name: skill.name, enabled: !skill.enabled })}
                    className={`p-1 rounded ${skill.enabled ? 'text-emerald-500' : 'text-muted-foreground'}`}
                  >
                    {skill.enabled ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Badge variant="outline" className="text-xs">{skill.source}</Badge>
                  {skill.userInvocable && <Badge variant="secondary" className="text-xs">User</Badge>}
                  {skill.modelInvocable && <Badge variant="secondary" className="text-xs">AI</Badge>}
                  {skill.toolCategories.slice(0, 2).map(cat => (
                    <Badge key={cat} variant="outline" className="text-xs">{cat}</Badge>
                  ))}
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Browse Registry Tab */}
      {activeTab === 'browse' && (
        <div>
          {searchLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(searchResults?.data ?? []).map((skill: Record<string, unknown>, i: number) => (
                <Card key={i} className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-medium text-sm">{String(skill['name'] ?? 'Unknown')}</h4>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {String(skill['description'] ?? '')}
                      </p>
                    </div>
                    <button
                      onClick={() => installMutation.mutate(String(skill['source'] ?? skill['name']))}
                      disabled={installMutation.isPending}
                      className="px-2.5 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
                    >
                      {installMutation.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Download className="h-3 w-3" />
                      )}
                      Install
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                    {typeof skill['author'] === 'string' && <span>by {skill['author']}</span>}
                    {typeof skill['installs'] === 'number' && (
                      <span className="flex items-center gap-0.5">
                        <Download className="h-3 w-3" /> {skill['installs']}
                      </span>
                    )}
                    {typeof skill['rating'] === 'number' && (
                      <span className="flex items-center gap-0.5">
                        <Star className="h-3 w-3 text-amber-500" /> {skill['rating']}
                      </span>
                    )}
                  </div>
                </Card>
              ))}
              {(searchResults?.data ?? []).length === 0 && (
                <div className="col-span-2 text-center py-12 text-muted-foreground">
                  <Store className="h-8 w-8 mx-auto mb-3 opacity-50" />
                  <p>No skills found. Try a different search or check back later.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Stats Tab */}
      {activeTab === 'stats' && stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* By Source */}
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Grid3x3 className="h-4 w-4 text-blue-500" />
              <h4 className="font-medium text-sm">By Source</h4>
            </div>
            <div className="space-y-2">
              {Object.entries(stats.bySource).map(([source, count]) => (
                <div key={source} className="flex items-center justify-between p-2 rounded bg-muted/30">
                  <span className="text-sm capitalize">{source}</span>
                  <span className="font-semibold">{count}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* By Category */}
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="h-4 w-4 text-violet-500" />
              <h4 className="font-medium text-sm">By Category</h4>
            </div>
            <div className="space-y-2">
              {Object.entries(stats.byCategory)
                .sort(([, a], [, b]) => Number(b) - Number(a))
                .map(([cat, count]) => (
                  <div key={cat} className="flex items-center justify-between p-2 rounded bg-muted/30">
                    <span className="text-sm capitalize">{cat}</span>
                    <span className="font-semibold">{String(count)}</span>
                  </div>
                ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
