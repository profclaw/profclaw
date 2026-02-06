/**
 * Memory Watcher
 *
 * Automatic memory sync based on OpenClaw's architecture.
 * Features:
 * - File watching with chokidar for automatic sync
 * - Dirty flag to trigger sync before search
 * - Debounced sync on file changes
 * - Warm session sync on session start
 */

import { watch, type FSWatcher } from 'chokidar';
import { join, basename, extname } from 'node:path';
import { syncMemoryFiles, searchMemory, type MemoryConfig, DEFAULT_MEMORY_CONFIG, type SearchResult } from './memory-service.js';
import { logger } from '../utils/logger.js';

// Types

export interface MemoryWatcherOptions {
  /** Base path to watch for memory files */
  basePath: string;
  /** Memory configuration */
  config?: MemoryConfig;
  /** Callback when sync completes */
  onSyncComplete?: (result: { added: number; updated: number; removed: number }) => void;
  /** Callback when sync starts */
  onSyncStart?: () => void;
  /** Callback on errors */
  onError?: (error: Error) => void;
}

export interface MemoryWatcherState {
  /** Whether files have changed since last sync */
  dirty: boolean;
  /** Whether a sync is currently in progress */
  syncing: boolean;
  /** Timestamp of last successful sync */
  lastSyncAt: number | null;
  /** Number of files being watched */
  watchedFiles: number;
  /** Whether the watcher is active */
  watching: boolean;
}

// Memory Watcher Class

export class MemoryWatcher {
  private watcher: FSWatcher | null = null;
  private basePath: string;
  private config: MemoryConfig;
  private state: MemoryWatcherState = {
    dirty: true, // Start dirty to ensure initial sync
    syncing: false,
    lastSyncAt: null,
    watchedFiles: 0,
    watching: false,
  };
  private debounceTimer: NodeJS.Timeout | null = null;
  private onSyncComplete?: (result: { added: number; updated: number; removed: number }) => void;
  private onSyncStart?: () => void;
  private onError?: (error: Error) => void;

  constructor(options: MemoryWatcherOptions) {
    this.basePath = options.basePath;
    this.config = options.config || DEFAULT_MEMORY_CONFIG;
    this.onSyncComplete = options.onSyncComplete;
    this.onSyncStart = options.onSyncStart;
    this.onError = options.onError;
  }

  /**
   * Get current watcher state
   */
  getState(): MemoryWatcherState {
    return { ...this.state };
  }

  /**
   * Check if files need to be synced
   */
  isDirty(): boolean {
    return this.state.dirty;
  }

  /**
   * Mark as dirty (files changed)
   */
  markDirty(): void {
    this.state.dirty = true;
  }

  /**
   * Start watching memory files
   */
  async start(): Promise<void> {
    if (this.watcher) {
      logger.warn('[MemoryWatcher] Already watching');
      return;
    }

    // Paths to watch
    const memoryFile = join(this.basePath, this.config.paths.memoryFile);
    const memoryDir = join(this.basePath, this.config.paths.memoryDir);
    const altMemoryFile = join(this.basePath, 'memory.md'); // Also watch lowercase

    // Build glob patterns
    const patterns = [
      memoryFile,
      altMemoryFile,
      join(memoryDir, '*.md'),
      join(memoryDir, '*.txt'),
      join(memoryDir, '*.markdown'),
    ];

    logger.info(`[MemoryWatcher] Starting watch on ${this.basePath}`);
    logger.debug(`[MemoryWatcher] Watching patterns: ${patterns.join(', ')}`);

    this.watcher = watch(patterns, {
      ignoreInitial: true, // Don't trigger on initial scan
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    this.watcher.on('add', (path) => this.handleFileChange('add', path));
    this.watcher.on('change', (path) => this.handleFileChange('change', path));
    this.watcher.on('unlink', (path) => this.handleFileChange('unlink', path));

    this.watcher.on('ready', () => {
      const watched = this.watcher?.getWatched() || {};
      this.state.watchedFiles = Object.values(watched).reduce((acc, files) => acc + files.length, 0);
      this.state.watching = true;
      logger.info(`[MemoryWatcher] Ready, watching ${this.state.watchedFiles} files`);
    });

    this.watcher.on('error', (err) => {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('[MemoryWatcher] Error:', error);
      this.onError?.(error);
    });

    // Perform initial sync if configured
    if (this.config.sync.onSessionStart) {
      await this.sync();
    }
  }

  /**
   * Stop watching
   */
  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      this.state.watching = false;
      logger.info('[MemoryWatcher] Stopped');
    }
  }

  /**
   * Handle file change events
   */
  private handleFileChange(event: 'add' | 'change' | 'unlink', path: string): void {
    const filename = basename(path);
    const ext = extname(path).toLowerCase();

    // Only process memory files
    if (!['.md', '.txt', '.markdown'].includes(ext)) {
      return;
    }

    logger.debug(`[MemoryWatcher] File ${event}: ${filename}`);
    this.state.dirty = true;

    // Schedule debounced sync if watch sync is enabled
    if (this.config.sync.watch) {
      this.scheduleSync();
    }
  }

  /**
   * Schedule a debounced sync
   */
  private scheduleSync(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.sync().catch((error) => {
        logger.error('[MemoryWatcher] Scheduled sync failed:', error);
        this.onError?.(error);
      });
    }, this.config.sync.watchDebounceMs);
  }

  /**
   * Perform a sync operation
   */
  async sync(): Promise<{ added: number; updated: number; removed: number }> {
    if (this.state.syncing) {
      logger.debug('[MemoryWatcher] Sync already in progress');
      return { added: 0, updated: 0, removed: 0 };
    }

    this.state.syncing = true;
    this.onSyncStart?.();

    try {
      logger.info('[MemoryWatcher] Syncing memory files...');
      const result = await syncMemoryFiles(this.basePath, this.config);

      this.state.dirty = false;
      this.state.lastSyncAt = Date.now();

      logger.info(
        `[MemoryWatcher] Sync complete: ${result.added} added, ${result.updated} updated, ${result.removed} removed`
      );

      this.onSyncComplete?.(result);
      return result;
    } catch (error) {
      logger.error('[MemoryWatcher] Sync failed:', error as Error);
      this.onError?.(error as Error);
      throw error;
    } finally {
      this.state.syncing = false;
    }
  }

  /**
   * Search with automatic sync if dirty
   * Implements the onSearch auto-sync pattern from OpenClaw
   */
  async search(query: string, maxResults?: number): Promise<SearchResult> {
    // Auto-sync before search if dirty and configured
    if (this.config.sync.onSearch && this.state.dirty && !this.state.syncing) {
      logger.debug('[MemoryWatcher] Auto-syncing before search');
      await this.sync();
    }

    const searchConfig = maxResults
      ? { ...this.config, query: { ...this.config.query, maxResults } }
      : this.config;

    return searchMemory(query, searchConfig);
  }

  /**
   * Warm session - sync on session start
   * Call this when a new chat session starts
   */
  async warmSession(): Promise<void> {
    if (this.config.sync.onSessionStart) {
      logger.info('[MemoryWatcher] Warming session with memory sync');
      await this.sync();
    }
  }
}

// Singleton Instance

let globalWatcher: MemoryWatcher | null = null;

/**
 * Get or create the global memory watcher
 */
export function getMemoryWatcher(): MemoryWatcher | null {
  return globalWatcher;
}

/**
 * Initialize the global memory watcher
 */
export async function initMemoryWatcher(options: MemoryWatcherOptions): Promise<MemoryWatcher> {
  if (globalWatcher) {
    await globalWatcher.stop();
  }

  globalWatcher = new MemoryWatcher(options);
  await globalWatcher.start();

  return globalWatcher;
}

/**
 * Stop the global memory watcher
 */
export async function stopMemoryWatcher(): Promise<void> {
  if (globalWatcher) {
    await globalWatcher.stop();
    globalWatcher = null;
  }
}

export default {
  MemoryWatcher,
  getMemoryWatcher,
  initMemoryWatcher,
  stopMemoryWatcher,
};
