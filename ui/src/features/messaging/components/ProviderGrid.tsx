/**
 * Provider Grid
 *
 * Reusable grid of messaging provider cards with search and category filters.
 * Used by both the standalone MessagingPage and as part of settings.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, ChevronRight, Globe } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { getProviderLogo } from '@/components/shared/ProviderLogos';
import { API_BASE } from '@/features/settings/constants.js';
import {
  PROVIDER_DEFINITIONS,
  CATEGORIES,
} from '@/features/settings/sections/messaging/providers.js';
import type { ProviderDefinition } from '@/features/settings/sections/messaging/providers.js';

type CategoryFilter = 'all' | 'popular' | 'enterprise' | 'asian' | 'specialized';

const CATEGORY_FILTERS: Array<{ id: CategoryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'popular', label: 'Popular' },
  { id: 'enterprise', label: 'Enterprise' },
  { id: 'asian', label: 'Asian Markets' },
  { id: 'specialized', label: 'Specialized' },
];

interface ProviderGridProps {
  onSelectProvider: (providerId: string) => void;
}

export function ProviderGrid({ onSelectProvider }: ProviderGridProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');

  const filteredProviders = useMemo(() => {
    let providers = PROVIDER_DEFINITIONS;

    if (categoryFilter !== 'all') {
      const categoryIds = CATEGORIES[categoryFilter]?.ids ?? [];
      providers = providers.filter(p => categoryIds.includes(p.id));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      providers = providers.filter(p =>
        p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
      );
    }

    return providers;
  }, [categoryFilter, searchQuery]);

  return (
    <div className="space-y-4">
      {/* Search + Category Filters */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search providers..."
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORY_FILTERS.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategoryFilter(cat.id)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                categoryFilter === cat.id
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Provider Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredProviders.map((provider) => (
          <ProviderGridCard
            key={provider.id}
            provider={provider}
            onClick={() => onSelectProvider(provider.id)}
          />
        ))}
      </div>

      {filteredProviders.length === 0 && (
        <div className="py-12 text-center text-muted-foreground">
          <Search className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No providers match your search</p>
        </div>
      )}
    </div>
  );
}

export const PROVIDER_COUNT = PROVIDER_DEFINITIONS.length;

function ProviderGridCard({
  provider,
  onClick,
}: {
  provider: ProviderDefinition;
  onClick: () => void;
}) {
  const { data: status } = useQuery<{ configured: boolean; connected: boolean }>({
    queryKey: [`${provider.id}-status`],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/messaging/${provider.id}/status`, { credentials: 'include' });
      if (!res.ok) return { configured: false, connected: false };
      return res.json();
    },
    staleTime: 60000,
  });

  const statusLabel = status?.connected
    ? 'Connected'
    : status?.configured
    ? 'Configured'
    : 'Not set up';

  const statusColor = status?.connected
    ? 'text-green-500'
    : status?.configured
    ? 'text-yellow-500'
    : 'text-muted-foreground';

  const Logo = getProviderLogo(provider.id);

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 p-4 rounded-xl border border-border hover:border-primary/30 hover:bg-muted/30 transition-all text-left group"
    >
      <div
        className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${provider.color}12` }}
      >
        <Logo className="h-5 w-5" style={{ color: provider.color }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-sm truncate group-hover:text-primary transition-colors">
            {provider.name}
          </p>
          <span className={cn('flex items-center gap-1 text-[11px] shrink-0', statusColor)}>
            <span className={cn(
              'h-1.5 w-1.5 rounded-full',
              status?.connected ? 'bg-green-500' : status?.configured ? 'bg-yellow-500' : 'bg-muted-foreground/40'
            )} />
            {statusLabel}
          </span>
        </div>
        {!status?.configured && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {provider.requiresWebhook && (
              <span className="inline-flex items-center gap-0.5" title="Requires public URL">
                <Globe className="h-3 w-3" />
              </span>
            )}
            {provider.prerequisite && (
              <span className="truncate">{provider.prerequisite}</span>
            )}
          </div>
        )}
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0" />
    </button>
  );
}
