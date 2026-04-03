/**
 * Feed Dashboard
 *
 * Browse, manage, and poll RSS/news feeds. Supports bundle installs,
 * feed discovery, article digest, and per-feed controls.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/core/api/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Rss, Plus, RefreshCw, Newspaper, Search, Package,
  ExternalLink, CheckCircle, XCircle, Clock, Loader2,
} from 'lucide-react';

interface Feed {
  id: string;
  name: string;
  url: string;
  category: string;
  articleCount: number;
  enabled: boolean;
}

interface Article {
  id: string;
  title: string;
  url: string;
  summary: string;
  publishedAt: string;
}

const BUNDLES = [
  { id: 'ai-news', label: 'AI News', icon: '🤖' },
  { id: 'dev-news', label: 'Dev News', icon: '💻' },
  { id: 'security', label: 'Security', icon: '🔒' },
] as const;

export function FeedDashboard() {
  const queryClient = useQueryClient();

  // Add feed form state
  const [addName, setAddName] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const [addCategory, setAddCategory] = useState('');

  // Discovery state
  const [discoverUrl, setDiscoverUrl] = useState('');
  const [discoveredFeed, setDiscoveredFeed] = useState<string | null>(null);

  // Digest state
  const [showDigest, setShowDigest] = useState(false);

  const { data: feedsData, isLoading: feedsLoading } = useQuery({
    queryKey: ['feeds', 'list'],
    queryFn: () => api.feeds.list(),
  });

  const { data: digestData, isLoading: digestLoading } = useQuery({
    queryKey: ['feeds', 'digest'],
    queryFn: () => api.feeds.digest(24),
    enabled: showDigest,
  });

  const installBundleMutation = useMutation({
    mutationFn: (bundle: string) => api.feeds.installBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feeds'] });
    },
  });

  const addFeedMutation = useMutation({
    mutationFn: () => api.feeds.add(addName, addUrl, addCategory || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feeds'] });
      setAddName('');
      setAddUrl('');
      setAddCategory('');
    },
  });

  const pollMutation = useMutation({
    mutationFn: () => api.feeds.poll(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feeds'] });
    },
  });

  const discoverMutation = useMutation({
    mutationFn: (url: string) => api.feeds.discover(url),
    onSuccess: (data) => {
      setDiscoveredFeed(data.data?.feedUrl ?? null);
    },
  });

  const feeds: Feed[] = feedsData?.data ?? [];
  const articles: Article[] = digestData?.data ?? [];

  const handleAddFeed = () => {
    if (!addName.trim() || !addUrl.trim()) return;
    addFeedMutation.mutate();
  };

  const handleDiscover = () => {
    if (!discoverUrl.trim()) return;
    discoverMutation.mutate(discoverUrl.trim());
  };

  const handleUseDiscovered = () => {
    if (discoveredFeed) {
      setAddUrl(discoveredFeed);
      setDiscoveredFeed(null);
      setDiscoverUrl('');
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Rss className="h-6 w-6 text-orange-500" />
            News Feeds
          </h1>
          <p className="text-muted-foreground mt-1">
            {feedsLoading ? 'Loading...' : `${feeds.length} feed${feeds.length !== 1 ? 's' : ''} configured`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => pollMutation.mutate()}
            disabled={pollMutation.isPending}
            className="gap-2"
          >
            {pollMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Poll All
          </Button>
          <Button
            variant={showDigest ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowDigest(!showDigest)}
            className="gap-2"
          >
            <Newspaper className="h-4 w-4" />
            Get Digest
          </Button>
        </div>
      </div>

      {/* Bundle Install */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4" />
            Quick Install Bundles
          </CardTitle>
          <CardDescription>Install curated sets of feeds in one click</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {BUNDLES.map((bundle) => (
              <Button
                key={bundle.id}
                variant="outline"
                onClick={() => installBundleMutation.mutate(bundle.id)}
                disabled={installBundleMutation.isPending}
                className="gap-2"
              >
                <span>{bundle.icon}</span>
                {bundle.label}
                {installBundleMutation.isPending && installBundleMutation.variables === bundle.id && (
                  <Loader2 className="h-3 w-3 animate-spin ml-1" />
                )}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Digest Panel */}
      {showDigest && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Newspaper className="h-4 w-4" />
              Latest Articles
              {digestLoading && <Loader2 className="h-4 w-4 animate-spin ml-1" />}
            </CardTitle>
            <CardDescription>Articles from the last 24 hours</CardDescription>
          </CardHeader>
          <CardContent>
            {digestLoading ? (
              <div className="text-muted-foreground text-sm">Fetching articles...</div>
            ) : articles.length === 0 ? (
              <div className="text-muted-foreground text-sm">No recent articles found. Try polling your feeds first.</div>
            ) : (
              <div className="space-y-3">
                {articles.slice(0, 10).map((article) => (
                  <div key={article.id} className="flex items-start gap-3 rounded-lg border border-border/50 p-3 hover:bg-muted/30 transition-colors">
                    <div className="flex-1 min-w-0">
                      <a
                        href={article.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium hover:text-primary transition-colors line-clamp-2 flex items-start gap-1"
                      >
                        {article.title}
                        <ExternalLink className="h-3 w-3 mt-0.5 shrink-0 opacity-60" />
                      </a>
                      {article.summary && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{article.summary}</p>
                      )}
                      <p className="text-xs text-muted-foreground/60 mt-1 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDate(article.publishedAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add Feed + Discovery */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Add Feed Form */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Plus className="h-4 w-4" />
              Add Feed
            </CardTitle>
            <CardDescription>Manually add an RSS or Atom feed</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="feed-name">Name</Label>
              <Input
                id="feed-name"
                placeholder="The Hacker News"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="feed-url">RSS URL</Label>
              <Input
                id="feed-url"
                placeholder="https://news.ycombinator.com/rss"
                value={addUrl}
                onChange={(e) => setAddUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="feed-category">Category (optional)</Label>
              <Input
                id="feed-category"
                placeholder="tech"
                value={addCategory}
                onChange={(e) => setAddCategory(e.target.value)}
              />
            </div>
            <Button
              onClick={handleAddFeed}
              disabled={!addName.trim() || !addUrl.trim() || addFeedMutation.isPending}
              className="w-full gap-2"
            >
              {addFeedMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Add Feed
            </Button>
          </CardContent>
        </Card>

        {/* Feed Discovery */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="h-4 w-4" />
              Discover Feed
            </CardTitle>
            <CardDescription>Paste any URL to auto-detect its RSS feed</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="discover-url">Website URL</Label>
              <Input
                id="discover-url"
                placeholder="https://blog.example.com"
                value={discoverUrl}
                onChange={(e) => setDiscoverUrl(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              onClick={handleDiscover}
              disabled={!discoverUrl.trim() || discoverMutation.isPending}
              className="w-full gap-2"
            >
              {discoverMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Detect RSS Feed
            </Button>

            {discoveredFeed && (
              <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400 font-medium">
                  <CheckCircle className="h-4 w-4 shrink-0" />
                  Feed detected
                </div>
                <p className="text-xs font-mono text-muted-foreground break-all">{discoveredFeed}</p>
                <Button size="sm" onClick={handleUseDiscovered} className="w-full gap-1">
                  <Plus className="h-3 w-3" />
                  Use this URL
                </Button>
              </div>
            )}

            {discoverMutation.isError && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 flex items-center gap-2 text-sm text-destructive">
                <XCircle className="h-4 w-4 shrink-0" />
                No RSS feed found at that URL
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Feed List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Rss className="h-4 w-4" />
            All Feeds
          </CardTitle>
          <CardDescription>
            {feeds.length === 0 ? 'No feeds yet' : `${feeds.filter(f => f.enabled).length} of ${feeds.length} enabled`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {feedsLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading feeds...
            </div>
          ) : feeds.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Rss className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No feeds configured yet.</p>
              <p className="text-xs mt-1">Install a bundle or add a feed manually above.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {feeds.map((feed) => (
                <div
                  key={feed.id}
                  className="flex items-center gap-3 rounded-lg border border-border/50 p-3 hover:bg-muted/30 transition-colors"
                >
                  {feed.enabled ? (
                    <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{feed.name}</span>
                      {feed.category && (
                        <Badge variant="outline" className="text-xs">{feed.category}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{feed.url}</p>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-sm font-medium tabular-nums">{feed.articleCount}</div>
                    <div className="text-xs text-muted-foreground">articles</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
