/**
 * Memory Feature Types
 */

export interface MemoryFile {
  path: string;
  source: string;
  hash: string;
  mtime: number;
  size: number;
}

export interface MemoryChunk {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  score?: number;
}

export interface SearchResult {
  query: string;
  method: 'hybrid' | 'vector' | 'fts';
  totalCandidates: number;
  chunks: MemoryChunk[];
}

export interface MemoryStats {
  totalFiles: number;
  totalChunks: number;
  totalTokensEstimate: number;
  lastSyncAt: number | null;
  embeddingModel: string;
  cachedEmbeddings: number;
}

export interface MemorySession {
  id: string;
  name?: string;
  conversationId?: string;
  userId?: string;
  projectId?: string;
  memoryEnabled: boolean;
  memoryLastSyncAt?: number;
  totalTokens: number;
  totalMessages: number;
  totalCost: number;
  status: 'active' | 'archived' | 'deleted';
  createdAt: number;
  updatedAt: number;
  lastActiveAt: number;
}

export interface MemoryConfig {
  sources: string[];
  provider: string;
  model: string;
  chunking: {
    tokens: number;
    overlap: number;
  };
  query: {
    maxResults: number;
    minScore: number;
    hybrid: {
      enabled: boolean;
      vectorWeight: number;
      textWeight: number;
      candidateMultiplier: number;
    };
  };
  sync: {
    onSessionStart: boolean;
    onSearch: boolean;
    watch: boolean;
    watchDebounceMs: number;
    intervalMinutes: number;
  };
  paths: {
    memoryDir: string;
    memoryFile: string;
  };
}

export interface SyncResult {
  message: string;
  synced: number;
  added: number;
  updated: number;
  removed: number;
}

export interface WatcherStatus {
  enabled: boolean;
  message?: string;
  state?: {
    dirty: boolean;
    syncing: boolean;
    lastSyncAt: number | null;
    watchedFiles: number;
    watching: boolean;
  };
  config?: {
    onSessionStart: boolean;
    onSearch: boolean;
    watch: boolean;
    watchDebounceMs: number;
  };
}
