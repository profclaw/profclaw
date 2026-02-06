/**
 * Memory API Hooks
 *
 * TanStack Query hooks for memory system operations.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  MemoryStats,
  MemoryFile,
  MemoryChunk,
  SearchResult,
  MemoryConfig,
  SyncResult,
  MemorySession,
  WatcherStatus,
} from '../types';

const API_BASE = '/api/memory';

// Query keys
export const memoryKeys = {
  all: ['memory'] as const,
  stats: () => [...memoryKeys.all, 'stats'] as const,
  files: () => [...memoryKeys.all, 'files'] as const,
  fileChunks: (path: string) => [...memoryKeys.all, 'chunks', path] as const,
  search: (query: string) => [...memoryKeys.all, 'search', query] as const,
  config: () => [...memoryKeys.all, 'config'] as const,
  sessions: () => [...memoryKeys.all, 'sessions'] as const,
  watcherStatus: () => [...memoryKeys.all, 'watcher'] as const,
};

// === Fetchers ===

async function fetchStats(): Promise<MemoryStats> {
  const response = await fetch(`${API_BASE}/stats`);
  if (!response.ok) throw new Error('Failed to fetch memory stats');
  const data = await response.json();
  return data.stats;
}

async function fetchFiles(): Promise<MemoryFile[]> {
  const response = await fetch(`${API_BASE}/files`);
  if (!response.ok) throw new Error('Failed to fetch memory files');
  const data = await response.json();
  return data.files;
}

async function fetchFileChunks(path: string): Promise<MemoryChunk[]> {
  const response = await fetch(`${API_BASE}/files/${encodeURIComponent(path)}/chunks`);
  if (!response.ok) throw new Error('Failed to fetch file chunks');
  const data = await response.json();
  return data.chunks;
}

async function searchMemory(query: string, maxResults = 6): Promise<SearchResult> {
  const response = await fetch(`${API_BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, maxResults }),
  });
  if (!response.ok) throw new Error('Search failed');
  return response.json();
}

async function fetchConfig(): Promise<MemoryConfig> {
  const response = await fetch(`${API_BASE}/config`);
  if (!response.ok) throw new Error('Failed to fetch memory config');
  const data = await response.json();
  return data.config;
}

async function fetchSessions(params?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ sessions: MemorySession[]; total: number }> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));

  const response = await fetch(`${API_BASE}/sessions?${searchParams}`);
  if (!response.ok) throw new Error('Failed to fetch sessions');
  return response.json();
}

async function fetchWatcherStatus(): Promise<WatcherStatus> {
  const response = await fetch(`${API_BASE}/watcher/status`);
  if (!response.ok) throw new Error('Failed to fetch watcher status');
  return response.json();
}

// === Mutations ===

async function syncMemory(basePath?: string): Promise<SyncResult> {
  const response = await fetch(`${API_BASE}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ basePath }),
  });
  if (!response.ok) throw new Error('Sync failed');
  return response.json();
}

async function deleteChunk(chunkId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/chunks/${chunkId}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete chunk');
}

async function deleteFile(path: string): Promise<void> {
  const response = await fetch(`${API_BASE}/files/${encodeURIComponent(path)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete file');
}

async function clearAllMemories(): Promise<void> {
  const response = await fetch(`${API_BASE}/all`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to clear memories');
}

async function initMemory(): Promise<void> {
  const response = await fetch(`${API_BASE}/init`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to initialize memory');
}

// === Query Hooks ===

export function useMemoryStats() {
  return useQuery({
    queryKey: memoryKeys.stats(),
    queryFn: fetchStats,
    staleTime: 30_000, // 30 seconds
  });
}

export function useMemoryFiles() {
  return useQuery({
    queryKey: memoryKeys.files(),
    queryFn: fetchFiles,
    staleTime: 30_000,
  });
}

export function useFileChunks(path: string) {
  return useQuery({
    queryKey: memoryKeys.fileChunks(path),
    queryFn: () => fetchFileChunks(path),
    enabled: !!path,
  });
}

export function useMemorySearch(query: string, maxResults = 6) {
  return useQuery({
    queryKey: memoryKeys.search(query),
    queryFn: () => searchMemory(query, maxResults),
    enabled: query.length > 0,
    staleTime: 60_000, // 1 minute
  });
}

export function useMemoryConfig() {
  return useQuery({
    queryKey: memoryKeys.config(),
    queryFn: fetchConfig,
    staleTime: 300_000, // 5 minutes
  });
}

export function useMemorySessions(params?: { status?: string; limit?: number; offset?: number }) {
  return useQuery({
    queryKey: [...memoryKeys.sessions(), params],
    queryFn: () => fetchSessions(params),
    staleTime: 30_000,
  });
}

export function useWatcherStatus() {
  return useQuery({
    queryKey: memoryKeys.watcherStatus(),
    queryFn: fetchWatcherStatus,
    refetchInterval: 10_000, // Poll every 10 seconds
    staleTime: 5_000,
  });
}

// === Mutation Hooks ===

export function useSyncMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (basePath?: string) => syncMemory(basePath),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.all });
    },
  });
}

export function useDeleteChunk() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteChunk,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.files() });
      queryClient.invalidateQueries({ queryKey: memoryKeys.stats() });
    },
  });
}

export function useDeleteFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteFile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.files() });
      queryClient.invalidateQueries({ queryKey: memoryKeys.stats() });
    },
  });
}

export function useClearAllMemories() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: clearAllMemories,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.all });
    },
  });
}

export function useInitMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: initMemory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.all });
    },
  });
}
