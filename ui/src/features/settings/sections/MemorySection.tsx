/**
 * Memory Section
 *
 * Semantic memory management UI.
 * Shows memory stats, files, search, and sync controls.
 */

import { useState, useEffect } from 'react';
import {
  Brain,
  RefreshCw,
  Trash2,
  Search,
  FileText,
  Database,
  Clock,
  Cpu,
  AlertTriangle,
  ChevronRight,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { SettingsCard } from '../components';

const API_BASE = 'http://localhost:3000';

// Types
interface MemoryStats {
  totalFiles: number;
  totalChunks: number;
  totalTokensEstimate: number;
  lastSyncAt: number | null;
  embeddingModel: string;
  cachedEmbeddings: number;
}

interface MemoryFile {
  path: string;
  source: string;
  hash: string;
  mtime: number;
  size: number;
}

interface MemoryChunk {
  id: string;
  path: string;
  source: string;
  startLine: number;
  endLine: number;
  text: string;
  score?: number;
}

interface SearchResult {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  score: number;
}

interface WatcherStatus {
  enabled: boolean;
  state?: {
    dirty: boolean;
    syncing: boolean;
    lastSyncAt: number | null;
    watchedFiles: string[];
    watching: boolean;
  };
  config?: {
    onSessionStart: boolean;
    onSearch: boolean;
    watch: boolean;
    watchDebounceMs: number;
  };
  message?: string;
}

export function MemorySection() {
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [watcherStatus, setWatcherStatus] = useState<WatcherStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedFile, setSelectedFile] = useState<MemoryFile | null>(null);
  const [fileChunks, setFileChunks] = useState<MemoryChunk[]>([]);
  const [loadingChunks, setLoadingChunks] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch all data
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, filesRes, watcherRes] = await Promise.all([
        fetch(`${API_BASE}/api/memory/stats`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/memory/files`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/memory/watcher/status`, { credentials: 'include' }),
      ]);

      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data.stats);
      }
      if (filesRes.ok) {
        const data = await filesRes.json();
        setFiles(data.files);
      }
      if (watcherRes.ok) {
        const data = await watcherRes.json();
        setWatcherStatus(data);
      }
    } catch (err) {
      setError('Failed to load memory data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Sync memory files
  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${API_BASE}/api/memory/sync`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      setError('Sync failed');
      console.error(err);
    } finally {
      setSyncing(false);
    }
  };

  // Warm session
  const handleWarm = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${API_BASE}/api/memory/warm`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      setError('Warm session failed');
      console.error(err);
    } finally {
      setSyncing(false);
    }
  };

  // Search memory
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const res = await fetch(`${API_BASE}/api/memory/search`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery, maxResults: 10 }),
      });
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.chunks || []);
      }
    } catch (err) {
      setError('Search failed');
      console.error(err);
    } finally {
      setSearching(false);
    }
  };

  // Load file chunks
  const handleViewFile = async (file: MemoryFile) => {
    setSelectedFile(file);
    setLoadingChunks(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/memory/files/${encodeURIComponent(file.path)}/chunks`,
        { credentials: 'include' }
      );
      if (res.ok) {
        const data = await res.json();
        setFileChunks(data.chunks || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingChunks(false);
    }
  };

  // Delete file
  const handleDeleteFile = async (path: string) => {
    try {
      const res = await fetch(
        `${API_BASE}/api/memory/files/${encodeURIComponent(path)}`,
        { method: 'DELETE', credentials: 'include' }
      );
      if (res.ok) {
        setSelectedFile(null);
        setFileChunks([]);
        await fetchData();
      }
    } catch (err) {
      setError('Failed to delete file');
      console.error(err);
    }
  };

  // Clear all memories
  const handleClearAll = async () => {
    setClearing(true);
    try {
      const res = await fetch(`${API_BASE}/api/memory/all`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setShowClearDialog(false);
        await fetchData();
      }
    } catch (err) {
      setError('Failed to clear memories');
      console.error(err);
    } finally {
      setClearing(false);
    }
  };

  // Format bytes
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Format timestamp
  const formatTime = (timestamp: number | null) => {
    if (!timestamp) return 'Never';
    return new Date(timestamp).toLocaleString();
  };

  return (
    <>
      {/* Stats Card */}
      <SettingsCard title="Memory Statistics" description="Semantic memory system status">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : stats ? (
          <div className="space-y-4">
            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <FileText className="h-3.5 w-3.5" />
                  Files
                </div>
                <div className="text-2xl font-semibold">{stats.totalFiles}</div>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <Database className="h-3.5 w-3.5" />
                  Chunks
                </div>
                <div className="text-2xl font-semibold">{stats.totalChunks}</div>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <Brain className="h-3.5 w-3.5" />
                  Est. Tokens
                </div>
                <div className="text-2xl font-semibold">
                  {stats.totalTokensEstimate.toLocaleString()}
                </div>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <Cpu className="h-3.5 w-3.5" />
                  Embeddings
                </div>
                <div className="text-2xl font-semibold">{stats.cachedEmbeddings}</div>
              </div>
            </div>

            {/* Model Info */}
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="h-4 w-4" />
                Last Sync: {formatTime(stats.lastSyncAt)}
              </div>
              <Badge variant="outline">{stats.embeddingModel}</Badge>
            </div>

            {/* Watcher Status */}
            {watcherStatus && (
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    'h-2 w-2 rounded-full',
                    watcherStatus.enabled
                      ? watcherStatus.state?.watching
                        ? 'bg-green-500'
                        : 'bg-yellow-500'
                      : 'bg-gray-400'
                  )}
                />
                <span className="text-xs text-muted-foreground">
                  {watcherStatus.enabled
                    ? watcherStatus.state?.watching
                      ? `Watching ${watcherStatus.state.watchedFiles?.length || 0} files`
                      : 'Watcher enabled but not watching'
                    : 'Watcher disabled'}
                </span>
                {watcherStatus.state?.dirty && (
                  <Badge variant="secondary" className="text-xs">
                    Dirty
                  </Badge>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSync}
                disabled={syncing}
                className="rounded-xl"
              >
                <RefreshCw
                  className={cn('h-4 w-4 mr-2', syncing && 'animate-spin')}
                />
                {syncing ? 'Syncing...' : 'Sync Files'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleWarm}
                disabled={syncing}
                className="rounded-xl"
              >
                <Brain className="h-4 w-4 mr-2" />
                Warm Session
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowClearDialog(true)}
                className="rounded-xl ml-auto"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Clear All
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-4 text-muted-foreground">
            No memory data available
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-destructive/10 text-destructive text-sm rounded-lg flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </div>
        )}
      </SettingsCard>

      {/* Search Card */}
      <SettingsCard title="Search Memory" description="Semantically search indexed memories">
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Search memories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="flex-1"
            />
            <Button
              onClick={handleSearch}
              disabled={searching || !searchQuery.trim()}
              className="rounded-xl"
            >
              <Search className={cn('h-4 w-4', searching && 'animate-pulse')} />
            </Button>
          </div>

          {searchResults.length > 0 && (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {searchResults.map((result) => (
                <div
                  key={result.id}
                  className="p-3 bg-muted/50 rounded-lg space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium truncate">
                      {result.path}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {(result.score * 100).toFixed(0)}%
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Lines {result.startLine}-{result.endLine}
                  </p>
                  <p className="text-xs line-clamp-2">{result.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </SettingsCard>

      {/* Files Card */}
      <SettingsCard title="Memory Files" description="Indexed memory files and their chunks">
        {files.length > 0 ? (
          <div className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Path</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Modified</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((file) => (
                  <TableRow
                    key={file.path}
                    className={cn(
                      'cursor-pointer',
                      selectedFile?.path === file.path && 'bg-muted'
                    )}
                    onClick={() => handleViewFile(file)}
                  >
                    <TableCell className="font-mono text-xs truncate max-w-[200px]">
                      {file.path}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {file.source}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatBytes(file.size)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(file.mtime).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* File Detail Panel */}
            {selectedFile && (
              <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium">{selectedFile.path}</h4>
                    <p className="text-xs text-muted-foreground">
                      {fileChunks.length} chunks
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDeleteFile(selectedFile.path)}
                      className="rounded-xl"
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      Delete
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedFile(null);
                        setFileChunks([]);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {loadingChunks ? (
                  <div className="flex justify-center py-4">
                    <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {fileChunks.map((chunk, chunkIndex) => (
                      <div
                        key={chunk.id}
                        className="p-2 bg-muted/30 rounded text-xs space-y-1"
                      >
                        <div className="flex justify-between text-muted-foreground">
                          <span>
                            Chunk {chunkIndex + 1} (lines {chunk.startLine}-{chunk.endLine})
                          </span>
                          <span>{chunk.text.length} chars</span>
                        </div>
                        <p className="line-clamp-2">{chunk.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No memory files indexed</p>
            <p className="text-xs mt-1">
              Create a MEMORY.md file or memory/ directory to get started
            </p>
          </div>
        )}
      </SettingsCard>

      {/* Clear Confirmation Dialog */}
      <Dialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Clear All Memories
            </DialogTitle>
            <DialogDescription>
              This will permanently delete all indexed memory files, chunks, and
              embedding caches. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowClearDialog(false)}
              disabled={clearing}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleClearAll}
              disabled={clearing}
            >
              {clearing ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Clearing...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear All
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
