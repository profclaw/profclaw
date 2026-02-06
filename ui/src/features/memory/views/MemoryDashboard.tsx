/**
 * Memory Dashboard
 *
 * Manage memories: browse, search, sync, and delete.
 */

import { useState } from 'react';
import {
  Brain,
  Search,
  RefreshCw,
  Trash2,
  FileText,
  Database,
  Clock,
  ChevronRight,
  AlertCircle,
  CheckCircle,
  Loader2,
  FolderOpen,
  Hash,
  Eye,
  EyeOff,
  Zap,
  Activity,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  useMemoryStats,
  useMemoryFiles,
  useMemorySearch,
  useSyncMemory,
  useDeleteFile,
  useClearAllMemories,
  useWatcherStatus,
} from '../hooks/useMemory';
import type { MemoryFile, MemoryChunk } from '../types';

export function MemoryDashboard() {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Queries
  const { data: stats, isLoading: statsLoading } = useMemoryStats();
  const { data: files, isLoading: filesLoading } = useMemoryFiles();
  const { data: searchResults, isLoading: searchLoading } = useMemorySearch(debouncedQuery);
  const { data: watcherStatus } = useWatcherStatus();

  // Mutations
  const syncMutation = useSyncMemory();
  const deleteFileMutation = useDeleteFile();
  const clearAllMutation = useClearAllMemories();

  // Debounced search
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setDebouncedQuery(searchQuery);
  };

  const handleSync = () => {
    syncMutation.mutate(undefined);
  };

  const handleDeleteFile = (path: string) => {
    deleteFileMutation.mutate(path);
  };

  const handleClearAll = () => {
    clearAllMutation.mutate();
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (timestamp: number | null) => {
    if (!timestamp) return 'Never';
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Brain className="h-8 w-8 text-primary" />
            Memory
          </h1>
          <p className="text-muted-foreground mt-1">
            Semantic memory with embeddings and hybrid search
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleSync}
            disabled={syncMutation.isPending}
          >
            {syncMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Sync Memory
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">
                <Trash2 className="h-4 w-4 mr-2" />
                Clear All
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear All Memories?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete all indexed memories, chunks, and cached embeddings.
                  This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleClearAll} className="bg-destructive text-destructive-foreground">
                  Clear All
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Sync Status */}
      {syncMutation.isSuccess && (
        <div className="flex items-center gap-2 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
          <CheckCircle className="h-5 w-5 text-green-500" />
          <span className="text-green-700 dark:text-green-400">
            Sync complete: {syncMutation.data?.added} added, {syncMutation.data?.updated} updated, {syncMutation.data?.removed} removed
          </span>
        </div>
      )}

      {syncMutation.isError && (
        <div className="flex items-center gap-2 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
          <AlertCircle className="h-5 w-5 text-destructive" />
          <span className="text-destructive">Sync failed: {syncMutation.error?.message}</span>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Files Indexed</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statsLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : stats?.totalFiles ?? 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Memory Chunks</CardTitle>
            <Hash className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statsLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : stats?.totalChunks ?? 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Est. Tokens</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statsLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                (stats?.totalTokensEstimate ?? 0).toLocaleString()
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Last Sync</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-sm font-medium">
              {statsLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                formatDate(stats?.lastSyncAt ?? null)
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Auto-Sync Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Auto-Sync Status
          </CardTitle>
          <CardDescription>
            File watcher for automatic memory synchronization
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Watcher Status */}
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
              <div className="flex items-center gap-3">
                {watcherStatus?.enabled ? (
                  <Eye className="h-5 w-5 text-green-500" />
                ) : (
                  <EyeOff className="h-5 w-5 text-muted-foreground" />
                )}
                <div>
                  <p className="font-medium">File Watcher</p>
                  <p className="text-sm text-muted-foreground">
                    {watcherStatus?.enabled
                      ? `Watching ${watcherStatus.state?.watchedFiles ?? 0} files`
                      : 'Disabled - manual sync required'}
                  </p>
                </div>
              </div>
              <Badge variant={watcherStatus?.enabled ? 'default' : 'secondary'}>
                {watcherStatus?.enabled ? 'Active' : 'Disabled'}
              </Badge>
            </div>

            {/* Sync State */}
            {watcherStatus?.enabled && watcherStatus.state && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <Zap className={`h-4 w-4 ${watcherStatus.state.dirty ? 'text-amber-500' : 'text-green-500'}`} />
                    <span className="text-sm font-medium">Dirty State</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {watcherStatus.state.dirty ? 'Files changed - sync pending' : 'Up to date'}
                  </p>
                </div>

                <div className="p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    {watcherStatus.state.syncing ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    )}
                    <span className="text-sm font-medium">Sync Status</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {watcherStatus.state.syncing ? 'Syncing...' : 'Idle'}
                  </p>
                </div>

                <div className="p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Watched Files</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {watcherStatus.state.watchedFiles} files
                  </p>
                </div>

                <div className="p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Last Auto-Sync</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {formatDate(watcherStatus.state.lastSyncAt)}
                  </p>
                </div>
              </div>
            )}

            {/* Auto-Sync Config */}
            {watcherStatus?.config && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-border/20">
                <Badge variant={watcherStatus.config.onSessionStart ? 'default' : 'outline'}>
                  {watcherStatus.config.onSessionStart ? '✓' : '○'} Sync on Session Start
                </Badge>
                <Badge variant={watcherStatus.config.onSearch ? 'default' : 'outline'}>
                  {watcherStatus.config.onSearch ? '✓' : '○'} Sync Before Search
                </Badge>
                <Badge variant={watcherStatus.config.watch ? 'default' : 'outline'}>
                  {watcherStatus.config.watch ? '✓' : '○'} Watch Mode
                </Badge>
                {watcherStatus.config.watch && (
                  <Badge variant="outline">
                    Debounce: {watcherStatus.config.watchDebounceMs}ms
                  </Badge>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Search Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Search Memories
          </CardTitle>
          <CardDescription>
            Semantic search across all indexed memories using hybrid vector + text search
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="flex gap-2">
            <Input
              placeholder="Search for prior work, decisions, preferences..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="flex-1"
            />
            <Button type="submit" disabled={searchLoading || !searchQuery}>
              {searchLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
            </Button>
          </form>

          {/* Search Results */}
          {searchResults && searchResults.chunks.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>
                  Found {searchResults.chunks.length} result(s) using {searchResults.method} search
                </span>
                <Badge variant="outline" className="text-xs">
                  {searchResults.totalCandidates} candidates
                </Badge>
              </div>

              {searchResults.chunks.map((chunk: MemoryChunk) => (
                <div
                  key={chunk.id}
                  className="p-4 bg-muted/40 rounded-lg hover:bg-muted/60 transition-colors"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{chunk.path}</span>
                      <Badge variant="secondary" className="text-xs">
                        Lines {chunk.startLine}-{chunk.endLine}
                      </Badge>
                    </div>
                    {chunk.score !== undefined && (
                      <Badge variant="outline">Score: {chunk.score.toFixed(2)}</Badge>
                    )}
                  </div>
                  <pre className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-4 font-mono">
                    {chunk.text}
                  </pre>
                </div>
              ))}
            </div>
          )}

          {searchResults && searchResults.chunks.length === 0 && debouncedQuery && (
            <div className="mt-4 text-center text-muted-foreground py-8">
              <Brain className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No memories found for "{debouncedQuery}"</p>
              <p className="text-sm mt-1">Try syncing your memory files first</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Files Browser */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            Memory Files
          </CardTitle>
          <CardDescription>
            Browse and manage indexed memory files
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filesLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : files && files.length > 0 ? (
            <div className="space-y-2">
              {files.map((file: MemoryFile) => (
                <div
                  key={file.path}
                  className="flex items-center justify-between p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{file.path}</p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>{formatFileSize(file.size)}</span>
                        <span>-</span>
                        <span>Source: {file.source}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Memory File?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will delete all memory chunks from "{file.path}".
                            The original file will not be affected.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDeleteFile(file.path)}
                            className="bg-destructive text-destructive-foreground"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-8">
              <FolderOpen className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No memory files indexed</p>
              <p className="text-sm mt-1">
                Create a MEMORY.md file or memory/ directory and click "Sync Memory"
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Configuration Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Embedding Model</p>
              <p className="font-medium">{stats?.embeddingModel || 'text-embedding-3-small'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Cached Embeddings</p>
              <p className="font-medium">{stats?.cachedEmbeddings ?? 0}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Search Method</p>
              <p className="font-medium">Hybrid (Vector + FTS)</p>
            </div>
            <div>
              <p className="text-muted-foreground">Memory Sources</p>
              <p className="font-medium">MEMORY.md, memory/*.md</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
