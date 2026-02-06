/**
 * Memory Service
 *
 * Semantic memory system with embeddings and hybrid search.
 * Based on OpenClaw's memory architecture.
 *
 * Features:
 * - Token-based chunking with overlap
 * - Multiple embedding providers (OpenAI, Ollama)
 * - Hybrid search (vector + FTS5)
 * - File change detection with hash
 * - Embedding cache for efficiency
 */

import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { readFile, stat, readdir } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { getClient } from '../storage/index.js';
import { getEmbeddingService } from '../ai/embedding-service.js';
import { logger } from '../utils/logger.js';

// Configuration

export interface MemoryConfig {
  /** Sources to index */
  sources: ('memory' | 'sessions' | 'custom')[];

  /** Embedding provider */
  provider: 'auto' | 'openai' | 'ollama' | 'local';
  fallback: 'openai' | 'ollama' | 'local' | 'none';
  model: string;

  /** Chunking settings */
  chunking: {
    tokens: number;
    overlap: number;
  };

  /** Query settings */
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

  /** Sync triggers */
  sync: {
    onSessionStart: boolean;
    onSearch: boolean;
    watch: boolean;
    watchDebounceMs: number;
    intervalMinutes: number;
  };

  /** Memory file paths */
  paths: {
    memoryDir: string; // e.g., ~/.profclaw/memory/
    memoryFile: string; // MEMORY.md
  };
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  sources: ['memory'],
  provider: 'auto',
  fallback: 'none',
  model: 'text-embedding-3-small',

  chunking: {
    tokens: 400,
    overlap: 80,
  },

  query: {
    maxResults: 6,
    minScore: 0.35,
    hybrid: {
      enabled: true,
      vectorWeight: 0.7,
      textWeight: 0.3,
      candidateMultiplier: 4,
    },
  },

  sync: {
    onSessionStart: true,
    onSearch: true,
    watch: true,
    watchDebounceMs: 1500,
    intervalMinutes: 0,
  },

  paths: {
    memoryDir: 'memory',
    memoryFile: 'MEMORY.md',
  },
};

// Types

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
  source: string;
  startLine: number;
  endLine: number;
  hash: string;
  text: string;
  model: string;
  score?: number;
}

export interface SearchResult {
  chunks: MemoryChunk[];
  query: string;
  method: 'hybrid' | 'vector' | 'fts';
  totalCandidates: number;
}

export interface MemoryStats {
  totalFiles: number;
  totalChunks: number;
  totalTokensEstimate: number;
  lastSyncAt: number | null;
  embeddingModel: string;
  cachedEmbeddings: number;
}

// Database Initialization

/**
 * Initialize memory tables including FTS5 virtual table
 */
export async function initMemoryTables(): Promise<void> {
  const client = getClient();

  // Memory files table
  await client.execute(`
    CREATE TABLE IF NOT EXISTS memory_files (
      path TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'memory',
      hash TEXT NOT NULL,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      user_id TEXT,
      project_id TEXT,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // Memory chunks table
  await client.execute(`
    CREATE TABLE IF NOT EXISTS memory_chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'memory',
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      hash TEXT NOT NULL,
      text TEXT NOT NULL,
      model TEXT NOT NULL,
      embedding BLOB,
      embedding_dims INTEGER,
      user_id TEXT,
      project_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // Embedding cache table
  await client.execute(`
    CREATE TABLE IF NOT EXISTS embedding_cache (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      provider_key TEXT NOT NULL,
      hash TEXT NOT NULL,
      embedding BLOB NOT NULL,
      dims INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // Memory meta table
  await client.execute(`
    CREATE TABLE IF NOT EXISTS memory_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // Memory sessions table
  await client.execute(`
    CREATE TABLE IF NOT EXISTS memory_sessions (
      id TEXT PRIMARY KEY,
      name TEXT,
      conversation_id TEXT,
      user_id TEXT,
      project_id TEXT,
      memory_enabled INTEGER NOT NULL DEFAULT 1,
      memory_last_sync_at INTEGER,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      total_messages INTEGER NOT NULL DEFAULT 0,
      total_cost INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_active_at INTEGER DEFAULT (unixepoch())
    )
  `);

  // FTS5 virtual table for text search
  try {
    await client.execute(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        text,
        id UNINDEXED,
        path UNINDEXED,
        source UNINDEXED,
        model UNINDEXED,
        start_line UNINDEXED,
        end_line UNINDEXED
      )
    `);
  } catch {
    // FTS5 might not be available in all SQLite builds
    logger.warn('[Memory] FTS5 not available, text search will be slower');
  }

  // Indexes
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_memory_chunks_path ON memory_chunks(path)
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_memory_chunks_hash ON memory_chunks(hash)
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_embedding_cache_hash ON embedding_cache(provider, model, hash)
  `);

  logger.info('[Memory] Tables initialized');
}

// Chunking

/**
 * Estimate token count for a string (rough approximation: 4 chars = 1 token)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split text into chunks with token-based boundaries and overlap
 */
export function chunkText(
  text: string,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG
): Array<{ text: string; startLine: number; endLine: number }> {
  const { tokens: maxTokens, overlap } = config.chunking;
  const lines = text.split('\n');
  const chunks: Array<{ text: string; startLine: number; endLine: number }> = [];

  let currentChunk: string[] = [];
  let currentTokens = 0;
  let startLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineTokens = estimateTokens(line);

    // If adding this line would exceed max tokens, save current chunk
    if (currentTokens + lineTokens > maxTokens && currentChunk.length > 0) {
      chunks.push({
        text: currentChunk.join('\n'),
        startLine,
        endLine: startLine + currentChunk.length - 1,
      });

      // Calculate overlap: keep last N tokens worth of lines
      let overlapTokens = 0;
      const overlapLines: string[] = [];
      for (let j = currentChunk.length - 1; j >= 0 && overlapTokens < overlap; j--) {
        overlapLines.unshift(currentChunk[j]);
        overlapTokens += estimateTokens(currentChunk[j]);
      }

      currentChunk = overlapLines;
      currentTokens = overlapTokens;
      startLine = startLine + currentChunk.length - overlapLines.length;
    }

    currentChunk.push(line);
    currentTokens += lineTokens;
  }

  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    chunks.push({
      text: currentChunk.join('\n'),
      startLine,
      endLine: startLine + currentChunk.length - 1,
    });
  }

  return chunks;
}

// Hashing

/**
 * Generate SHA256 hash of content
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// File Sync

/**
 * Sync memory files from disk to database
 */
export async function syncMemoryFiles(
  basePath: string,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG
): Promise<{ synced: number; added: number; updated: number; removed: number }> {
  const client = getClient();
  const embeddingService = getEmbeddingService();
  const stats = { synced: 0, added: 0, updated: 0, removed: 0 };

  // Get all markdown files in memory directory
  const files = await findMemoryFiles(basePath, config);

  // Get existing files from DB
  const existingResult = await client.execute({
    sql: `SELECT path, hash FROM memory_files WHERE source = 'memory'`,
    args: [],
  });
  const existingFiles = new Map(
    existingResult.rows.map((row: SqlRow) => [String(row.path), String(row.hash)])
  );

  // Process each file
  for (const filePath of files) {
    try {
      const content = await readFile(filePath, 'utf-8');
      const fileStat = await stat(filePath);
      const hash = hashContent(content);
      const relativePath = relative(basePath, filePath);

      const existingHash = existingFiles.get(relativePath);

      if (!existingHash) {
        // New file
        await indexFile(relativePath, content, fileStat, 'memory', config, embeddingService);
        stats.added++;
      } else if (existingHash !== hash) {
        // Updated file
        await reindexFile(relativePath, content, fileStat, 'memory', config, embeddingService);
        stats.updated++;
      }

      existingFiles.delete(relativePath);
      stats.synced++;
    } catch (error) {
      logger.error(`[Memory] Error syncing file ${filePath}:`, error as Error);
    }
  }

  // Remove files that no longer exist
  for (const [removedPath] of existingFiles.entries()) {
    await removeFile(removedPath as string);
    stats.removed++;
  }

  // Update last sync time
  await client.execute({
    sql: `INSERT OR REPLACE INTO memory_meta (key, value, updated_at) VALUES ('last_sync_at', ?, unixepoch())`,
    args: [Date.now().toString()],
  });

  logger.info(`[Memory] Sync complete: ${stats.added} added, ${stats.updated} updated, ${stats.removed} removed`);
  return stats;
}

/**
 * Find all memory files in a directory
 */
async function findMemoryFiles(basePath: string, config: MemoryConfig): Promise<string[]> {
  const files: string[] = [];
  const validExtensions = ['.md', '.txt', '.markdown'];

  try {
    // Check for MEMORY.md in base path
    const memoryFile = join(basePath, config.paths.memoryFile);
    try {
      await stat(memoryFile);
      files.push(memoryFile);
    } catch {
      // MEMORY.md doesn't exist, that's okay
    }

    // Check for memory directory
    const memoryDir = join(basePath, config.paths.memoryDir);
    try {
      const entries = await readdir(memoryDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && validExtensions.includes(extname(entry.name).toLowerCase())) {
          files.push(join(memoryDir, entry.name));
        }
      }
    } catch {
      // Memory directory doesn't exist, that's okay
    }
  } catch (error) {
    logger.error('[Memory] Error finding memory files:', error as Error);
  }

  return files;
}

/**
 * Index a new file
 */
async function indexFile(
  path: string,
  content: string,
  fileStat: { mtimeMs: number; size: number },
  source: string,
  config: MemoryConfig,
  embeddingService: ReturnType<typeof getEmbeddingService>
): Promise<void> {
  const client = getClient();
  const hash = hashContent(content);

  // Insert file record
  await client.execute({
    sql: `INSERT INTO memory_files (path, source, hash, mtime, size) VALUES (?, ?, ?, ?, ?)`,
    args: [path, source, hash, Math.floor(fileStat.mtimeMs), fileStat.size],
  });

  // Chunk and index content
  const chunks = chunkText(content, config);

  for (const chunk of chunks) {
    const chunkId = randomUUID();
    const chunkHash = hashContent(chunk.text);

    // Generate embedding
    let embedding: number[] | null = null;
    try {
      embedding = await embeddingService.generateEmbedding(chunk.text);
    } catch {
      logger.warn(`[Memory] Failed to generate embedding for chunk ${chunkId}`);
    }

    // Insert chunk
    await client.execute({
      sql: `INSERT INTO memory_chunks (id, path, source, start_line, end_line, hash, text, model, embedding, embedding_dims)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        chunkId,
        path,
        source,
        chunk.startLine,
        chunk.endLine,
        chunkHash,
        chunk.text,
        config.model,
        embedding ? new Float32Array(embedding).buffer : null,
        embedding?.length || null,
      ],
    });

    // Insert into FTS
    try {
      await client.execute({
        sql: `INSERT INTO memory_fts (text, id, path, source, model, start_line, end_line)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [chunk.text, chunkId, path, source, config.model, chunk.startLine, chunk.endLine],
      });
    } catch {
      // FTS5 might not be available
    }
  }
}

/**
 * Reindex an updated file
 */
async function reindexFile(
  path: string,
  content: string,
  fileStat: { mtimeMs: number; size: number },
  source: string,
  config: MemoryConfig,
  embeddingService: ReturnType<typeof getEmbeddingService>
): Promise<void> {
  // Remove old chunks
  await removeFileChunks(path);

  // Reindex
  const client = getClient();
  const hash = hashContent(content);

  // Update file record
  await client.execute({
    sql: `UPDATE memory_files SET hash = ?, mtime = ?, size = ?, updated_at = unixepoch() WHERE path = ?`,
    args: [hash, Math.floor(fileStat.mtimeMs), fileStat.size, path],
  });

  // Re-chunk and index
  const chunks = chunkText(content, config);

  for (const chunk of chunks) {
    const chunkId = randomUUID();
    const chunkHash = hashContent(chunk.text);

    let embedding: number[] | null = null;
    try {
      embedding = await embeddingService.generateEmbedding(chunk.text);
    } catch {
      logger.warn(`[Memory] Failed to generate embedding for chunk ${chunkId}`);
    }

    await client.execute({
      sql: `INSERT INTO memory_chunks (id, path, source, start_line, end_line, hash, text, model, embedding, embedding_dims)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        chunkId,
        path,
        source,
        chunk.startLine,
        chunk.endLine,
        chunkHash,
        chunk.text,
        config.model,
        embedding ? new Float32Array(embedding).buffer : null,
        embedding?.length || null,
      ],
    });

    try {
      await client.execute({
        sql: `INSERT INTO memory_fts (text, id, path, source, model, start_line, end_line)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [chunk.text, chunkId, path, source, config.model, chunk.startLine, chunk.endLine],
      });
    } catch {
      // FTS5 might not be available
    }
  }
}

/**
 * Remove file chunks from database
 */
async function removeFileChunks(path: string): Promise<void> {
  const client = getClient();

  // Get chunk IDs for FTS deletion
  const chunks = await client.execute({
    sql: `SELECT id FROM memory_chunks WHERE path = ?`,
    args: [path],
  });

  // Delete from FTS
  for (const chunk of chunks.rows) {
    try {
      await client.execute({
        sql: `DELETE FROM memory_fts WHERE id = ?`,
        args: [chunk.id as string],
      });
    } catch {
      // FTS might not be available
    }
  }

  // Delete chunks
  await client.execute({
    sql: `DELETE FROM memory_chunks WHERE path = ?`,
    args: [path],
  });
}

/**
 * Remove a file and its chunks
 */
async function removeFile(path: string): Promise<void> {
  const client = getClient();

  await removeFileChunks(path);

  await client.execute({
    sql: `DELETE FROM memory_files WHERE path = ?`,
    args: [path],
  });
}

// Search

/**
 * Search memory using hybrid (vector + FTS5) search
 */
export async function searchMemory(
  query: string,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG
): Promise<SearchResult> {
  const embeddingService = getEmbeddingService();
  const { maxResults, minScore, hybrid } = config.query;

  let chunks: MemoryChunk[] = [];
  let method: 'hybrid' | 'vector' | 'fts' = 'hybrid';
  let totalCandidates = 0;

  if (hybrid.enabled) {
    // Hybrid search: combine vector and FTS results
    const candidateLimit = maxResults * hybrid.candidateMultiplier;

    // Vector search
    const queryEmbedding = await embeddingService.generateEmbedding(query);
    const vectorResults = await vectorSearch(queryEmbedding, candidateLimit);

    // FTS search
    const ftsResults = await ftsSearch(query, candidateLimit);

    // Combine and re-rank
    const scoreMap = new Map<string, { chunk: MemoryChunk; vectorScore: number; ftsScore: number }>();

    for (const result of vectorResults) {
      scoreMap.set(result.id, {
        chunk: result,
        vectorScore: result.score || 0,
        ftsScore: 0,
      });
    }

    for (const result of ftsResults) {
      const existing = scoreMap.get(result.id);
      if (existing) {
        existing.ftsScore = result.score || 0;
      } else {
        scoreMap.set(result.id, {
          chunk: result,
          vectorScore: 0,
          ftsScore: result.score || 0,
        });
      }
    }

    // Calculate hybrid scores
    const scoredChunks = Array.from(scoreMap.values())
      .map(({ chunk, vectorScore, ftsScore }) => ({
        ...chunk,
        score: vectorScore * hybrid.vectorWeight + ftsScore * hybrid.textWeight,
      }))
      .filter((c) => c.score >= minScore)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, maxResults);

    chunks = scoredChunks;
    totalCandidates = scoreMap.size;
  } else {
    // Vector-only search
    const queryEmbedding = await embeddingService.generateEmbedding(query);
    chunks = await vectorSearch(queryEmbedding, maxResults);
    chunks = chunks.filter((c) => (c.score || 0) >= minScore);
    method = 'vector';
    totalCandidates = chunks.length;
  }

  return {
    chunks,
    query,
    method,
    totalCandidates,
  };
}

/**
 * Vector similarity search using cosine similarity
 */
async function vectorSearch(queryEmbedding: number[], limit: number): Promise<MemoryChunk[]> {
  const client = getClient();

  // Get all chunks with embeddings
  const result = await client.execute({
    sql: `SELECT id, path, source, start_line, end_line, hash, text, model, embedding
          FROM memory_chunks WHERE embedding IS NOT NULL LIMIT 1000`,
    args: [],
  });

  // Calculate cosine similarity
  const scored: MemoryChunk[] = [];

  for (const row of result.rows) {
    const embedding = row.embedding as ArrayBuffer;
    if (!embedding) continue;

    const chunkEmbedding = Array.from(new Float32Array(embedding));
    const similarity = cosineSimilarity(queryEmbedding, chunkEmbedding);

    scored.push({
      id: row.id as string,
      path: row.path as string,
      source: row.source as string,
      startLine: row.start_line as number,
      endLine: row.end_line as number,
      hash: row.hash as string,
      text: row.text as string,
      model: row.model as string,
      score: similarity,
    });
  }

  return scored.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, limit);
}

/**
 * Full-text search using FTS5
 */
async function ftsSearch(query: string, limit: number): Promise<MemoryChunk[]> {
  const client = getClient();

  try {
    // FTS5 query with ranking
    const result = await client.execute({
      sql: `SELECT id, path, source, start_line, end_line, bm25(memory_fts) as score
            FROM memory_fts WHERE memory_fts MATCH ? ORDER BY score LIMIT ?`,
      args: [query, limit],
    });

    // Fetch full chunk data
    const chunks: MemoryChunk[] = [];

    for (const row of result.rows) {
      const chunkResult = await client.execute({
        sql: `SELECT id, path, source, start_line, end_line, hash, text, model
              FROM memory_chunks WHERE id = ?`,
        args: [row.id as string],
      });

      if (chunkResult.rows.length > 0) {
        const chunk = chunkResult.rows[0];
        // Normalize BM25 score (BM25 returns negative values, lower = better)
        const normalizedScore = 1 / (1 + Math.abs(row.score as number));
        chunks.push({
          id: chunk.id as string,
          path: chunk.path as string,
          source: chunk.source as string,
          startLine: chunk.start_line as number,
          endLine: chunk.end_line as number,
          hash: chunk.hash as string,
          text: chunk.text as string,
          model: chunk.model as string,
          score: normalizedScore,
        });
      }
    }

    return chunks;
  } catch {
    // FTS5 not available, fall back to LIKE search
    const result = await client.execute({
      sql: `SELECT id, path, source, start_line, end_line, hash, text, model
            FROM memory_chunks WHERE text LIKE ? LIMIT ?`,
      args: [`%${query}%`, limit],
    });

    return result.rows.map((row: SqlRow) => rowToMemoryChunk(row, 0.5));
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

// Memory Get (Read specific lines)

/**
 * Get specific content from a memory file
 */
export async function getMemoryContent(
  path: string,
  options?: { fromLine?: number; toLine?: number; lines?: number }
): Promise<{ content: string; fromLine: number; toLine: number; path: string } | null> {
  const client = getClient();

  // Get file info
  const fileResult = await client.execute({
    sql: `SELECT path, hash FROM memory_files WHERE path = ?`,
    args: [path],
  });

  if (fileResult.rows.length === 0) {
    return null;
  }

  // Get relevant chunks
  let sql = `SELECT text, start_line, end_line FROM memory_chunks WHERE path = ?`;
  const args: (string | number)[] = [path];

  if (options?.fromLine) {
    sql += ` AND end_line >= ?`;
    args.push(options.fromLine);
  }

  if (options?.toLine) {
    sql += ` AND start_line <= ?`;
    args.push(options.toLine);
  }

  sql += ` ORDER BY start_line`;

  if (options?.lines) {
    sql += ` LIMIT ?`;
    args.push(Math.ceil(options.lines / 10) + 1); // Approximate chunks needed
  }

  const chunksResult = await client.execute({ sql, args });

  if (chunksResult.rows.length === 0) {
    return null;
  }

  // Combine chunks and extract requested lines
  const allText = chunksResult.rows.map((row: SqlRow) => String(row.text)).join('\n');
  const allLines = allText.split('\n');

  const fromLine = options?.fromLine || 1;
  const toLine = options?.toLine || (options?.lines ? fromLine + options.lines - 1 : allLines.length);

  const selectedLines = allLines.slice(fromLine - 1, toLine);

  return {
    content: selectedLines.join('\n'),
    fromLine,
    toLine: Math.min(toLine, fromLine + selectedLines.length - 1),
    path,
  };
}

// Memory Stats

/**
 * Get memory system statistics
 */
export async function getMemoryStats(): Promise<MemoryStats> {
  const client = getClient();

  const filesResult = await client.execute({
    sql: `SELECT COUNT(*) as count FROM memory_files`,
    args: [],
  });

  const chunksResult = await client.execute({
    sql: `SELECT COUNT(*) as count, SUM(LENGTH(text)) as total_chars FROM memory_chunks`,
    args: [],
  });

  const cacheResult = await client.execute({
    sql: `SELECT COUNT(*) as count FROM embedding_cache`,
    args: [],
  });

  const lastSyncResult = await client.execute({
    sql: `SELECT value FROM memory_meta WHERE key = 'last_sync_at'`,
    args: [],
  });

  return {
    totalFiles: Number(filesResult.rows[0]?.count || 0),
    totalChunks: Number(chunksResult.rows[0]?.count || 0),
    totalTokensEstimate: Math.ceil(Number(chunksResult.rows[0]?.total_chars || 0) / 4),
    lastSyncAt: lastSyncResult.rows[0]?.value ? Number(lastSyncResult.rows[0].value) : null,
    embeddingModel: DEFAULT_MEMORY_CONFIG.model,
    cachedEmbeddings: Number(cacheResult.rows[0]?.count || 0),
  };
}

// Memory Management (CRUD)

/**
 * List all memory files
 */
export async function listMemoryFiles(): Promise<MemoryFile[]> {
  const client = getClient();

  const result = await client.execute({
    sql: `SELECT path, source, hash, mtime, size FROM memory_files ORDER BY path`,
    args: [],
  });

  return result.rows.map((row: SqlRow) => rowToMemoryFile(row));
}

/**
 * List chunks for a specific file
 */
export async function listFileChunks(path: string): Promise<MemoryChunk[]> {
  const client = getClient();

  const result = await client.execute({
    sql: `SELECT id, path, source, start_line, end_line, hash, text, model
          FROM memory_chunks WHERE path = ? ORDER BY start_line`,
    args: [path],
  });

  return result.rows.map((row: SqlRow) => rowToMemoryChunk(row));
}

/**
 * Delete a memory chunk
 */
export async function deleteMemoryChunk(chunkId: string): Promise<boolean> {
  const client = getClient();

  // Delete from FTS
  try {
    await client.execute({
      sql: `DELETE FROM memory_fts WHERE id = ?`,
      args: [chunkId],
    });
  } catch {
    // FTS might not be available
  }

  // Delete from chunks
  const result = await client.execute({
    sql: `DELETE FROM memory_chunks WHERE id = ?`,
    args: [chunkId],
  });

  return (result.rowsAffected || 0) > 0;
}

/**
 * Delete all memories for a file
 */
export async function deleteMemoryFile(path: string): Promise<boolean> {
  const client = getClient();

  await removeFileChunks(path);

  const result = await client.execute({
    sql: `DELETE FROM memory_files WHERE path = ?`,
    args: [path],
  });

  return (result.rowsAffected || 0) > 0;
}

/**
 * Clear all memories
 */
export async function clearAllMemories(): Promise<void> {
  const client = getClient();

  try {
    await client.execute(`DELETE FROM memory_fts`);
  } catch {
    // FTS might not be available
  }

  await client.execute(`DELETE FROM memory_chunks`);
  await client.execute(`DELETE FROM memory_files`);
  await client.execute(`DELETE FROM embedding_cache`);

  logger.info('[Memory] All memories cleared');
}

// Session Management

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

type SqlRow = Record<string, unknown>;

function rowToMemoryChunk(row: SqlRow, score?: number): MemoryChunk {
  return {
    id: String(row.id),
    path: String(row.path),
    source: String(row.source),
    startLine: Number(row.start_line),
    endLine: Number(row.end_line),
    hash: String(row.hash),
    text: String(row.text),
    model: String(row.model),
    score,
  };
}

function rowToMemoryFile(row: SqlRow): MemoryFile {
  return {
    path: String(row.path),
    source: String(row.source),
    hash: String(row.hash),
    mtime: Number(row.mtime),
    size: Number(row.size),
  };
}

function rowToMemorySession(row: SqlRow): MemorySession {
  return {
    id: String(row.id),
    name: row.name ? String(row.name) : undefined,
    conversationId: row.conversation_id ? String(row.conversation_id) : undefined,
    userId: row.user_id ? String(row.user_id) : undefined,
    projectId: row.project_id ? String(row.project_id) : undefined,
    memoryEnabled: Boolean(row.memory_enabled),
    memoryLastSyncAt: row.memory_last_sync_at ? Number(row.memory_last_sync_at) : undefined,
    totalTokens: Number(row.total_tokens),
    totalMessages: Number(row.total_messages),
    totalCost: Number(row.total_cost),
    status: String(row.status) as MemorySession['status'],
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    lastActiveAt: Number(row.last_active_at),
  };
}

/**
 * Create a new memory session
 */
export async function createMemorySession(params: {
  name?: string;
  conversationId?: string;
  userId?: string;
  projectId?: string;
}): Promise<MemorySession> {
  const client = getClient();
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await client.execute({
    sql: `INSERT INTO memory_sessions (id, name, conversation_id, user_id, project_id, created_at, updated_at, last_active_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, params.name || null, params.conversationId || null, params.userId || null, params.projectId || null, now, now, now],
  });

  return {
    id,
    name: params.name,
    conversationId: params.conversationId,
    userId: params.userId,
    projectId: params.projectId,
    memoryEnabled: true,
    totalTokens: 0,
    totalMessages: 0,
    totalCost: 0,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now,
  };
}

/**
 * List memory sessions
 */
export async function listMemorySessions(params?: {
  status?: 'active' | 'archived' | 'deleted';
  limit?: number;
  offset?: number;
}): Promise<{ sessions: MemorySession[]; total: number }> {
  const client = getClient();
  const limit = params?.limit || 20;
  const offset = params?.offset || 0;

  let whereClause = '1=1';
  const args: (string | number)[] = [];

  if (params?.status) {
    whereClause += ' AND status = ?';
    args.push(params.status);
  }

  const countResult = await client.execute({
    sql: `SELECT COUNT(*) as total FROM memory_sessions WHERE ${whereClause}`,
    args,
  });

  const result = await client.execute({
    sql: `SELECT * FROM memory_sessions WHERE ${whereClause} ORDER BY last_active_at DESC LIMIT ? OFFSET ?`,
    args: [...args, limit, offset],
  });

  return {
    sessions: result.rows.map((row: SqlRow) => rowToMemorySession(row)),
    total: Number(countResult.rows[0]?.total || 0),
  };
}

/**
 * Update session stats
 */
export async function updateSessionStats(
  sessionId: string,
  stats: { tokens?: number; messages?: number; cost?: number }
): Promise<void> {
  const client = getClient();
  const now = Math.floor(Date.now() / 1000);

  const updates: string[] = ['updated_at = ?', 'last_active_at = ?'];
  const args: (string | number)[] = [now, now];

  if (stats.tokens !== undefined) {
    updates.push('total_tokens = total_tokens + ?');
    args.push(stats.tokens);
  }
  if (stats.messages !== undefined) {
    updates.push('total_messages = total_messages + ?');
    args.push(stats.messages);
  }
  if (stats.cost !== undefined) {
    updates.push('total_cost = total_cost + ?');
    args.push(stats.cost);
  }

  args.push(sessionId);

  await client.execute({
    sql: `UPDATE memory_sessions SET ${updates.join(', ')} WHERE id = ?`,
    args,
  });
}

/**
 * Archive a session
 */
export async function archiveSession(sessionId: string): Promise<void> {
  const client = getClient();

  await client.execute({
    sql: `UPDATE memory_sessions SET status = 'archived', updated_at = unixepoch() WHERE id = ?`,
    args: [sessionId],
  });
}

// Chat Conversation Indexing

export interface ConversationIndexInput {
  conversationId: string;
  title: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    createdAt?: string;
  }>;
  presetId?: string;
  projectId?: string;
  projectName?: string;
}

/**
 * Index a chat conversation into semantic memory
 * Creates a virtual "file" from conversation messages for searchability
 */
export async function indexConversation(
  input: ConversationIndexInput,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG
): Promise<{ chunksIndexed: number; tokensEstimate: number }> {
  const client = getClient();
  const embeddingService = getEmbeddingService();

  // Create virtual path for the conversation
  const path = `chat://${input.conversationId}`;
  const source = 'chat';

  // Format messages into indexable content
  const contentParts: string[] = [];

  // Add metadata header
  contentParts.push(`# Chat: ${input.title}`);
  if (input.projectName) {
    contentParts.push(`Project: ${input.projectName}`);
  }
  if (input.presetId) {
    contentParts.push(`Preset: ${input.presetId}`);
  }
  contentParts.push('');

  // Add messages
  for (const msg of input.messages) {
    const roleLabel = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
    const timestamp = msg.createdAt ? new Date(msg.createdAt).toLocaleString() : '';
    contentParts.push(`## ${roleLabel}${timestamp ? ` (${timestamp})` : ''}`);
    contentParts.push(msg.content);
    contentParts.push('');
  }

  const content = contentParts.join('\n');
  const hash = hashContent(content);
  const now = Date.now();

  // Check if conversation already exists in memory
  const existing = await client.execute({
    sql: `SELECT hash FROM memory_files WHERE path = ?`,
    args: [path],
  });

  if (existing.rows.length > 0) {
    // Check if content changed
    if (existing.rows[0].hash === hash) {
      // No changes, skip indexing
      return { chunksIndexed: 0, tokensEstimate: 0 };
    }
    // Remove old chunks before reindexing
    await removeFileChunks(path);

    // Update file record
    await client.execute({
      sql: `UPDATE memory_files SET hash = ?, mtime = ?, size = ?, updated_at = unixepoch() WHERE path = ?`,
      args: [hash, now, content.length, path],
    });
  } else {
    // Insert new file record
    await client.execute({
      sql: `INSERT INTO memory_files (path, source, hash, mtime, size, project_id) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [path, source, hash, now, content.length, input.projectId || null],
    });
  }

  // Chunk and index content
  const chunks = chunkText(content, config);
  let tokensEstimate = 0;

  for (const chunk of chunks) {
    const chunkId = randomUUID();
    const chunkHash = hashContent(chunk.text);
    tokensEstimate += estimateTokens(chunk.text);

    // Generate embedding
    let embedding: number[] | null = null;
    try {
      embedding = await embeddingService.generateEmbedding(chunk.text);
    } catch {
      logger.warn(`[Memory] Failed to generate embedding for chat chunk ${chunkId}`);
    }

    // Insert chunk
    await client.execute({
      sql: `INSERT INTO memory_chunks (id, path, source, start_line, end_line, hash, text, model, embedding, embedding_dims)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        chunkId,
        path,
        source,
        chunk.startLine,
        chunk.endLine,
        chunkHash,
        chunk.text,
        config.model,
        embedding ? new Float32Array(embedding).buffer : null,
        embedding?.length || null,
      ],
    });

    // Insert into FTS
    try {
      await client.execute({
        sql: `INSERT INTO memory_fts (text, id, path, source, model, start_line, end_line)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [chunk.text, chunkId, path, source, config.model, chunk.startLine, chunk.endLine],
      });
    } catch {
      // FTS5 might not be available
    }
  }

  logger.info(`[Memory] Indexed conversation ${input.conversationId}: ${chunks.length} chunks, ~${tokensEstimate} tokens`);

  return { chunksIndexed: chunks.length, tokensEstimate };
}

/**
 * Remove a conversation from memory index
 */
export async function removeConversationFromMemory(conversationId: string): Promise<void> {
  const path = `chat://${conversationId}`;
  await removeFileChunks(path);

  const client = getClient();
  await client.execute({
    sql: `DELETE FROM memory_files WHERE path = ?`,
    args: [path],
  });

  logger.info(`[Memory] Removed conversation ${conversationId} from memory`);
}

// Citation Tracking

export interface MemoryCitation {
  id: string;
  memoryId: string;
  chunkId?: string;
  sourceType: 'conversation' | 'document' | 'url' | 'file' | 'manual';
  sourceId: string;
  timestamp: string;
  excerpt?: string;
}

/**
 * Initialize citation tracking table
 */
export async function initCitationTable(): Promise<void> {
  const client = getClient();
  await client.execute({
    sql: `CREATE TABLE IF NOT EXISTS memory_citations (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      chunk_id TEXT,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      excerpt TEXT,
      FOREIGN KEY (memory_id) REFERENCES memory_files(path) ON DELETE CASCADE
    )`,
    args: [],
  });
  await client.execute({
    sql: `CREATE INDEX IF NOT EXISTS idx_citations_memory ON memory_citations(memory_id)`,
    args: [],
  });
  await client.execute({
    sql: `CREATE INDEX IF NOT EXISTS idx_citations_source ON memory_citations(source_type, source_id)`,
    args: [],
  });
}

/**
 * Add a citation to a memory entry
 */
export async function addCitation(citation: Omit<MemoryCitation, 'id'>): Promise<MemoryCitation> {
  const id = randomUUID();
  const client = getClient();
  await client.execute({
    sql: `INSERT INTO memory_citations (id, memory_id, chunk_id, source_type, source_id, timestamp, excerpt)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, citation.memoryId, citation.chunkId ?? null, citation.sourceType, citation.sourceId, citation.timestamp ?? new Date().toISOString(), citation.excerpt ?? null],
  });
  return { id, ...citation };
}

/**
 * Get citations for a memory entry
 */
export async function getCitations(memoryId: string): Promise<MemoryCitation[]> {
  const client = getClient();
  const result = await client.execute({
    sql: `SELECT id, memory_id as memoryId, chunk_id as chunkId, source_type as sourceType,
          source_id as sourceId, timestamp, excerpt
          FROM memory_citations WHERE memory_id = ? ORDER BY timestamp DESC`,
    args: [memoryId],
  });
  return result.rows.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    memoryId: String(row.memoryId),
    chunkId: row.chunkId ? String(row.chunkId) : undefined,
    sourceType: String(row.sourceType) as MemoryCitation['sourceType'],
    sourceId: String(row.sourceId),
    timestamp: String(row.timestamp),
    excerpt: row.excerpt ? String(row.excerpt) : undefined,
  }));
}

/**
 * Get citations by source (e.g., all citations from a conversation)
 */
export async function getCitationsBySource(sourceType: string, sourceId: string): Promise<MemoryCitation[]> {
  const client = getClient();
  const result = await client.execute({
    sql: `SELECT id, memory_id as memoryId, chunk_id as chunkId, source_type as sourceType,
          source_id as sourceId, timestamp, excerpt
          FROM memory_citations WHERE source_type = ? AND source_id = ? ORDER BY timestamp DESC`,
    args: [sourceType, sourceId],
  });
  return result.rows.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    memoryId: String(row.memoryId),
    chunkId: row.chunkId ? String(row.chunkId) : undefined,
    sourceType: String(row.sourceType) as MemoryCitation['sourceType'],
    sourceId: String(row.sourceId),
    timestamp: String(row.timestamp),
    excerpt: row.excerpt ? String(row.excerpt) : undefined,
  }));
}

/**
 * Delete a citation
 */
export async function deleteCitation(citationId: string): Promise<boolean> {
  const client = getClient();
  const result = await client.execute({
    sql: `DELETE FROM memory_citations WHERE id = ?`,
    args: [citationId],
  });
  return (result.rowsAffected ?? 0) > 0;
}

// Multi-Backend Memory (Plugin Slot)

export interface MemoryBackendPlugin {
  name: string;
  type: 'sqlite' | 'lancedb' | 'pgvector' | 'qdrant' | 'custom';
  initialize(): Promise<void>;
  store(key: string, embedding: number[], metadata: Record<string, unknown>): Promise<void>;
  search(query: number[], limit: number, filter?: Record<string, unknown>): Promise<BackendSearchResult[]>;
  delete(key: string): Promise<boolean>;
  stats(): Promise<{ totalEntries: number; sizeBytes: number }>;
}

export interface BackendSearchResult {
  key: string;
  score: number;
  metadata: Record<string, unknown>;
}

// Backend registry
const memoryBackends = new Map<string, MemoryBackendPlugin>();

/**
 * Register a memory backend plugin
 */
export function registerMemoryBackend(backend: MemoryBackendPlugin): void {
  memoryBackends.set(backend.name, backend);
  logger.info(`[Memory] Backend registered: ${backend.name} (${backend.type})`);
}

/**
 * Get a registered memory backend
 */
export function getMemoryBackend(name: string): MemoryBackendPlugin | undefined {
  return memoryBackends.get(name);
}

/**
 * List registered memory backends
 */
export function listMemoryBackends(): string[] {
  return Array.from(memoryBackends.keys());
}

export default {
  // Init
  initMemoryTables,
  initCitationTable,

  // Sync
  syncMemoryFiles,

  // Search
  searchMemory,
  getMemoryContent,

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

  // Chat indexing
  indexConversation,
  removeConversationFromMemory,

  // Citations
  addCitation,
  getCitations,
  getCitationsBySource,
  deleteCitation,

  // Multi-backend
  registerMemoryBackend,
  getMemoryBackend,
  listMemoryBackends,

  // Config
  DEFAULT_MEMORY_CONFIG,
};
