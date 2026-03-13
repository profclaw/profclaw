/**
 * Memory Module
 *
 * Semantic memory with embeddings and hybrid search.
 */

export {
  // Config
  DEFAULT_MEMORY_CONFIG,
  type MemoryConfig,

  // Types
  type MemoryFile,
  type MemoryChunk,
  type SearchResult,
  type MemoryStats,
  type MemorySession,

  // Init
  initMemoryTables,

  // Sync
  syncMemoryFiles,

  // Search
  searchMemory,
  getMemoryContent,

  // Chunking utilities
  chunkText,
  estimateTokens,
  hashContent,

  // Stats
  getMemoryStats,

  // Management
  listMemoryFiles,
  listFileChunks,
  deleteMemoryChunk,
  deleteMemoryFile,
  clearAllMemories,

  // Sessions
  createMemorySession,
  listMemorySessions,
  updateSessionStats,
  archiveSession,
} from './memory-service.js';

// Memory Watcher (automatic sync)
export {
  MemoryWatcher,
  getMemoryWatcher,
  initMemoryWatcher,
  stopMemoryWatcher,
  type MemoryWatcherOptions,
  type MemoryWatcherState,
} from './memory-watcher.js';
