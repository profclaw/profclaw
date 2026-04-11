/**
 * Transcript Persistence
 *
 * Saves all conversations to JSONL files for searchable history and session resumption.
 * Files are stored at .profclaw/transcripts/{sessionId}.jsonl
 * Index is stored at .profclaw/transcripts/index.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface TranscriptEntry {
  timestamp: number;
  sessionId: string;
  type: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system' | 'error';
  content: string;
  metadata?: {
    toolName?: string;
    toolCallId?: string;
    model?: string;
    tokensUsed?: number;
    duration?: number;
  };
}

export interface SessionMeta {
  sessionId: string;
  title: string;
  startedAt: number;
  lastActivityAt: number;
  messageCount: number;
  tokensUsed: number;
  model?: string;
}

let _instance: TranscriptStore | null = null;

export class TranscriptStore {
  private transcriptsDir: string;
  private sessionsIndex: Map<string, SessionMeta>;
  private indexDirty = false;
  private indexTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(projectRoot?: string) {
    const root = projectRoot ?? process.cwd();
    this.transcriptsDir = path.join(root, '.profclaw', 'transcripts');
    this.sessionsIndex = new Map();
    this.loadIndex();
  }

  /**
   * Append a single entry to the session's JSONL file.
   */
  append(entry: TranscriptEntry): void {
    this.ensureDir();
    const filePath = this.sessionFilePath(entry.sessionId);
    const line = JSON.stringify(entry) + '\n';

    try {
      fs.appendFileSync(filePath, line, 'utf8');
    } catch (err) {
      console.error('[TranscriptStore] Failed to append entry:', err);
      return;
    }

    // Update session metadata
    const meta = this.getOrCreateMeta(entry.sessionId);
    meta.lastActivityAt = entry.timestamp;
    meta.messageCount += 1;

    if (entry.metadata?.tokensUsed) {
      meta.tokensUsed += entry.metadata.tokensUsed;
    }

    if (entry.metadata?.model && !meta.model) {
      meta.model = entry.metadata.model;
    }

    this.sessionsIndex.set(entry.sessionId, meta);
    this.markIndexDirty();
  }

  /**
   * Read all entries for a session from its JSONL file.
   */
  getSession(sessionId: string): TranscriptEntry[] {
    const filePath = this.sessionFilePath(sessionId);

    if (!fs.existsSync(filePath)) {
      return [];
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const entries: TranscriptEntry[] = [];

      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          entries.push(JSON.parse(trimmed) as TranscriptEntry);
        } catch {
          // Skip malformed lines
        }
      }

      return entries;
    } catch (err) {
      console.error(`[TranscriptStore] Failed to read session ${sessionId}:`, err);
      return [];
    }
  }

  /**
   * List sessions sorted by lastActivityAt descending.
   */
  listSessions(options?: { limit?: number; offset?: number }): SessionMeta[] {
    const all = Array.from(this.sessionsIndex.values()).sort(
      (a, b) => b.lastActivityAt - a.lastActivityAt,
    );

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? all.length;

    return all.slice(offset, offset + limit);
  }

  /**
   * Full-text search across transcript entries.
   * Returns matching entries with their session ID and line number.
   */
  search(
    query: string,
    options?: { sessionId?: string; limit?: number },
  ): Array<{ entry: TranscriptEntry; sessionId: string; lineNumber: number }> {
    const results: Array<{ entry: TranscriptEntry; sessionId: string; lineNumber: number }> = [];
    const lowerQuery = query.toLowerCase();
    const limit = options?.limit ?? 50;

    const sessionIds = options?.sessionId
      ? [options.sessionId]
      : Array.from(this.sessionsIndex.keys());

    for (const sessionId of sessionIds) {
      if (results.length >= limit) break;

      const filePath = this.sessionFilePath(sessionId);
      if (!fs.existsSync(filePath)) continue;

      let raw: string;
      try {
        raw = fs.readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }

      const lines = raw.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (results.length >= limit) break;
        const line = lines[i].trim();
        if (!line) continue;

        if (line.toLowerCase().includes(lowerQuery)) {
          try {
            const entry = JSON.parse(line) as TranscriptEntry;
            results.push({ entry, sessionId, lineNumber: i + 1 });
          } catch {
            // Skip malformed lines
          }
        }
      }
    }

    return results;
  }

  /**
   * Get or create session metadata. Uses firstMessage to auto-generate a title
   * if the session doesn't yet exist.
   */
  getOrCreateMeta(sessionId: string, firstMessage?: string): SessionMeta {
    const existing = this.sessionsIndex.get(sessionId);
    if (existing) return existing;

    const now = Date.now();
    const meta: SessionMeta = {
      sessionId,
      title: firstMessage ? this.generateTitle(firstMessage) : `Session ${sessionId.slice(0, 8)}`,
      startedAt: now,
      lastActivityAt: now,
      messageCount: 0,
      tokensUsed: 0,
    };

    this.sessionsIndex.set(sessionId, meta);
    this.saveIndex();
    return meta;
  }

  /**
   * Merge partial updates into an existing session's metadata.
   */
  updateMeta(sessionId: string, updates: Partial<SessionMeta>): void {
    const existing = this.sessionsIndex.get(sessionId);
    if (!existing) return;

    this.sessionsIndex.set(sessionId, { ...existing, ...updates, sessionId });
    this.saveIndex();
  }

  /**
   * Delete a session's JSONL file and remove it from the index.
   */
  deleteSession(sessionId: string): void {
    const filePath = this.sessionFilePath(sessionId);

    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error(`[TranscriptStore] Failed to delete session file ${sessionId}:`, err);
      }
    }

    this.sessionsIndex.delete(sessionId);
    this.saveIndex();
  }

  flush(): void {
    if (this.indexTimer) {
      clearTimeout(this.indexTimer);
      this.indexTimer = null;
    }
    if (this.indexDirty) {
      this.saveIndex();
      this.indexDirty = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private markIndexDirty(): void {
    this.indexDirty = true;
    if (!this.indexTimer) {
      this.indexTimer = setTimeout(() => {
        this.indexTimer = null;
        if (this.indexDirty) {
          this.saveIndex();
          this.indexDirty = false;
        }
      }, 1000);
    }
  }


  private sessionFilePath(sessionId: string): string {
    return path.join(this.transcriptsDir, `${sessionId}.jsonl`);
  }

  private indexFilePath(): string {
    return path.join(this.transcriptsDir, 'index.json');
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.transcriptsDir)) {
      fs.mkdirSync(this.transcriptsDir, { recursive: true });
    }
  }

  private loadIndex(): void {
    const indexPath = this.indexFilePath();
    if (!fs.existsSync(indexPath)) return;

    try {
      const raw = fs.readFileSync(indexPath, 'utf8');
      const sessions = JSON.parse(raw) as SessionMeta[];
      for (const session of sessions) {
        this.sessionsIndex.set(session.sessionId, session);
      }
    } catch (err) {
      console.error('[TranscriptStore] Failed to load index:', err);
    }
  }

  private saveIndex(): void {
    this.ensureDir();
    const indexPath = this.indexFilePath();
    const sessions = Array.from(this.sessionsIndex.values());

    try {
      fs.writeFileSync(indexPath, JSON.stringify(sessions, null, 2), 'utf8');
    } catch (err) {
      console.error('[TranscriptStore] Failed to save index:', err);
    }
  }

  /**
   * Generate a human-readable title from the first 50 chars of a message.
   * Strips newlines, trims whitespace.
   */
  private generateTitle(message: string): string {
    const cleaned = message.replace(/[\r\n\t]+/g, ' ').trim();
    if (cleaned.length <= 50) return cleaned;
    return cleaned.slice(0, 47) + '...';
  }
}

/**
 * Returns the process-level singleton TranscriptStore, rooted at cwd().
 */
export function getTranscriptStore(): TranscriptStore {
  if (!_instance) {
    _instance = new TranscriptStore();
  }
  return _instance;
}

// Exported for test injection
export function _resetTranscriptStoreSingleton(): void {
  _instance = null;
}

// Re-export os for use in tests (avoids test-only imports from module internals)
export { os };
