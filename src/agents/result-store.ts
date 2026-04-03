/**
 * Result Store
 *
 * Manages large tool results by spilling them to disk when they exceed the
 * inline size limit. This prevents context windows from being flooded by
 * large tool outputs (e.g. file reads, API dumps).
 */

import { writeFile, unlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { logger } from "../utils/logger.js";

/** Results <= 50KB stay inline in the context window */
const MAX_INLINE_SIZE = 50_000;

/** Results > 5MB get truncated before saving */
const MAX_TOTAL_SIZE = 5_000_000;

/** Number of chars to include in the inline preview */
const PREVIEW_LENGTH = 500;

export interface StoredResult {
  /** Summary string (or full result if small enough) that goes into context */
  inline: string;
  /** Path to the temp file containing the full result, if spilled */
  fullPath?: string;
  /** Original serialized byte length */
  originalSize: number;
  /** Whether the stored content was truncated */
  truncated: boolean;
}

export class ResultStore {
  private results: Map<string, StoredResult> = new Map();
  private tempDir: string;

  constructor(sessionId: string) {
    this.tempDir = join(tmpdir(), `profclaw-results-${sessionId}`);
  }

  /**
   * Store a tool result. Small results stay inline; large results spill to
   * disk and return a summary pointing to the temp file.
   */
  async store(toolCallId: string, result: unknown): Promise<StoredResult> {
    const serialized = JSON.stringify(result);
    const size = Buffer.byteLength(serialized, "utf8");

    let stored: StoredResult;

    if (size <= MAX_INLINE_SIZE) {
      // Small enough — keep it in context as-is
      stored = {
        inline: serialized,
        originalSize: size,
        truncated: false,
      };
    } else {
      // Needs to spill to disk
      const truncated = size > MAX_TOTAL_SIZE;
      const content = truncated
        ? serialized.slice(0, MAX_TOTAL_SIZE)
        : serialized;

      const filePath = await this.writeTempFile(toolCallId, content);
      const preview = serialized.slice(0, PREVIEW_LENGTH);
      const sizeLabel = truncated
        ? `${MAX_TOTAL_SIZE.toLocaleString()} bytes (truncated from ${size.toLocaleString()} bytes)`
        : `${size.toLocaleString()} bytes`;

      stored = {
        inline: `[Result stored: ${sizeLabel}. Use retrieve_result tool to access full data. Preview: ${preview}...]`,
        fullPath: filePath,
        originalSize: size,
        truncated,
      };

      logger.debug("[ResultStore] Spilled large result to disk", {
        toolCallId,
        size,
        truncated,
        filePath,
      });
    }

    this.results.set(toolCallId, stored);
    return stored;
  }

  /**
   * Retrieve a previously stored result by its tool call ID.
   */
  retrieve(toolCallId: string): StoredResult | undefined {
    return this.results.get(toolCallId);
  }

  /**
   * Delete all temp files created during this session.
   */
  async cleanup(): Promise<void> {
    const deletions: Promise<void>[] = [];

    for (const [id, stored] of this.results.entries()) {
      if (stored.fullPath) {
        deletions.push(
          unlink(stored.fullPath).catch((err: unknown) => {
            logger.warn("[ResultStore] Failed to delete temp file", {
              id,
              path: stored.fullPath,
              error: err instanceof Error ? err.message : String(err),
            });
          }),
        );
      }
    }

    await Promise.all(deletions);
    this.results.clear();

    logger.debug("[ResultStore] Cleaned up temp files", {
      count: deletions.length,
    });
  }

  private async writeTempFile(toolCallId: string, content: string): Promise<string> {
    await mkdir(this.tempDir, { recursive: true });
    const fileName = `${toolCallId}-${randomUUID()}.json`;
    const filePath = join(this.tempDir, fileName);
    await writeFile(filePath, content, "utf8");
    return filePath;
  }
}
