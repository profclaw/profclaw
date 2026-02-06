/**
 * Memory Module
 *
 * Semantic memory with embeddings and hybrid search.
 */

// TODO(@copilot): Generate unit tests for this module
// Key functions to test: initMemoryTables, syncMemoryFiles, searchMemory, getMemoryContent, chunkText, estimateTokens, hashContent, getMemoryStats, listMemoryFiles, listFileChunks, deleteMemoryChunk, deleteMemoryFile, clearAllMemories, createMemorySession, listMemorySessions, updateSessionStats, archiveSession, getMemoryWatcher, initMemoryWatcher, stopMemoryWatcher
// Test file location: src/memory/tests/index.test.ts

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
