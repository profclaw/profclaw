/**
 * Text Chunking Utility
 *
 * Splits long text into chunks that fit within per-platform message limits.
 * Handles two splitting strategies:
 * - length: split at word boundaries up to the character limit
 * - newline: split at paragraph/newline boundaries
 *
 * Code blocks (```) are always kept intact - never split mid-block.
 */

import type { ChatProviderId } from '../providers/types.js';

// Types

/** How to determine split points when chunking */
export type ChunkMode = 'length' | 'newline';

export interface ChunkOptions {
  /** Splitting strategy. Defaults to 'length'. */
  mode?: ChunkMode;
  /**
   * Override the platform character limit.
   * Use 0 for unlimited (returns single-element array).
   */
  limit?: number;
}

export interface ChunkResult {
  /** The split text chunks, each within the platform limit. */
  chunks: string[];
  /** Character limit that was applied (0 = unlimited). */
  limit: number;
  /** Total characters in the original text. */
  totalLength: number;
}

// Platform limits

/**
 * Per-platform character limits for outgoing messages.
 * 0 means unlimited - the text is returned as a single chunk.
 */
export const PLATFORM_LIMITS: Readonly<Record<ChatProviderId | 'default', number>> = {
  telegram: 4096,
  discord: 2000,
  slack: 4000,
  whatsapp: 4096,
  matrix: 65536,
  msteams: 28000,
  googlechat: 4096,
  irc: 512,
  mattermost: 16383,
  line: 5000,
  webchat: 0,
  // Remaining platforms default to 4000 (conservative safe value)
  signal: 4000,
  dingtalk: 4000,
  wecom: 4000,
  feishu: 4000,
  qq: 4000,
  nostr: 4000,
  twitch: 4000,
  zalo: 4000,
  nextcloud: 4000,
  imessage: 4000,
  synology: 4000,
  tlon: 4000,
  'zalo-personal': 4000,
  custom: 4000,
  default: 4000,
};

/**
 * Get the character limit for a platform.
 * Returns 0 for unlimited platforms.
 */
export function getPlatformLimit(platform: ChatProviderId | string): number {
  const key = platform as ChatProviderId;
  if (key in PLATFORM_LIMITS) {
    return PLATFORM_LIMITS[key];
  }
  return PLATFORM_LIMITS.default;
}

// Code block utilities

interface TextSegment {
  text: string;
  isCodeBlock: boolean;
}

/**
 * Split text into alternating prose and code-block segments.
 * Code blocks (delimited by ```) are marked so they are never split.
 */
function splitIntoSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  // Match fenced code blocks: ```optional-lang\n...\n```
  const codeBlockPattern = /```[\s\S]*?```/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockPattern.exec(text)) !== null) {
    // Prose before this code block
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), isCodeBlock: false });
    }
    // The code block itself
    segments.push({ text: match[0], isCodeBlock: true });
    lastIndex = match.index + match[0].length;
  }

  // Remaining prose after the last code block
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), isCodeBlock: false });
  }

  return segments;
}

// Splitting strategies

/**
 * Split prose text by length, respecting word boundaries.
 * Never cuts in the middle of a word.
 */
function splitByLength(text: string, limit: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    // Find the last whitespace at or before the limit
    let splitAt = limit;
    const candidateSlice = remaining.slice(0, limit + 1);
    const lastSpace = candidateSlice.lastIndexOf(' ');
    const lastNewline = candidateSlice.lastIndexOf('\n');
    const lastBreak = Math.max(lastSpace, lastNewline);

    if (lastBreak > 0) {
      splitAt = lastBreak;
    }
    // If no whitespace found, hard-split at limit (e.g. extremely long word)

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

/**
 * Split text at paragraph/newline boundaries.
 * Accumulates paragraphs into a chunk until the limit would be exceeded,
 * then starts a new chunk.
 *
 * If a single paragraph exceeds the limit, it is further split by length.
 */
function splitByNewline(text: string, limit: number): string[] {
  // Split on double-newlines (paragraphs) first, then single newlines
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    if (!trimmedPara) continue;

    const separator = current ? '\n\n' : '';
    const candidate = current + separator + trimmedPara;

    if (candidate.length <= limit) {
      current = candidate;
    } else {
      // Flush the current chunk
      if (current) {
        chunks.push(current);
        current = '';
      }

      // Paragraph itself fits in a new chunk
      if (trimmedPara.length <= limit) {
        current = trimmedPara;
      } else {
        // Paragraph is too large - fall back to length splitting
        const subChunks = splitByLength(trimmedPara, limit);
        const last = subChunks.pop();
        chunks.push(...subChunks);
        current = last ?? '';
      }
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

// Core chunking logic

/**
 * Chunk a text string so every chunk fits within `limit` characters.
 * Code blocks are preserved - they may occupy their own chunk if large,
 * but are never split mid-block.
 */
function chunkWithLimit(text: string, limit: number, mode: ChunkMode): string[] {
  const segments = splitIntoSegments(text);
  const resultChunks: string[] = [];
  let currentChunk = '';

  for (const segment of segments) {
    if (segment.isCodeBlock) {
      // If the code block alone exceeds the limit we still emit it intact
      // (truncation is not acceptable for code blocks).
      if (currentChunk) {
        resultChunks.push(currentChunk.trimEnd());
        currentChunk = '';
      }

      if (segment.text.length <= limit || limit === 0) {
        resultChunks.push(segment.text);
      } else {
        // Code block exceeds limit - emit as-is, callers must handle
        resultChunks.push(segment.text);
      }
    } else {
      // Prose: split according to mode
      const proseChunks =
        mode === 'newline'
          ? splitByNewline(segment.text, limit)
          : splitByLength(segment.text, limit);

      for (let i = 0; i < proseChunks.length; i++) {
        const prose = proseChunks[i];

        if (i === 0 && currentChunk) {
          // Try to append the first prose chunk to whatever we have buffered
          const separator = currentChunk.endsWith('\n') ? '' : '\n\n';
          const candidate = currentChunk + separator + prose;
          if (candidate.length <= limit) {
            currentChunk = candidate;
            continue;
          }
          // Doesn't fit - flush the buffer first
          resultChunks.push(currentChunk.trimEnd());
          currentChunk = prose;
        } else if (currentChunk) {
          // Middle/last chunk from this segment: flush previous and start fresh
          resultChunks.push(currentChunk.trimEnd());
          currentChunk = prose;
        } else {
          currentChunk = prose;
        }
      }
    }
  }

  if (currentChunk.trim()) {
    resultChunks.push(currentChunk.trimEnd());
  }

  return resultChunks.filter(c => c.trim().length > 0);
}

// Public API

/**
 * Chunk text for a specific platform.
 *
 * @param text     - The text to chunk
 * @param platform - Target platform ID (used to look up character limit)
 * @param options  - Optional overrides for mode and limit
 * @returns        A ChunkResult with the chunks array and metadata
 *
 * @example
 * const { chunks } = chunkForPlatform(longText, 'discord');
 * for (const chunk of chunks) await sendMessage(chunk);
 */
export function chunkForPlatform(
  text: string,
  platform: ChatProviderId | string,
  options: ChunkOptions = {}
): ChunkResult {
  const { mode = 'length' } = options;
  const limit = options.limit !== undefined ? options.limit : getPlatformLimit(platform);

  // Edge cases
  if (!text) {
    return { chunks: [], limit, totalLength: 0 };
  }

  // Unlimited or text fits in one chunk
  if (limit === 0 || text.length <= limit) {
    return { chunks: [text], limit, totalLength: text.length };
  }

  const chunks = chunkWithLimit(text, limit, mode);

  return {
    chunks,
    limit,
    totalLength: text.length,
  };
}

/**
 * Simple helper: returns just the chunks array.
 * Useful when you don't need the metadata.
 */
export function chunkText(
  text: string,
  platform: ChatProviderId | string,
  options?: ChunkOptions
): string[] {
  return chunkForPlatform(text, platform, options).chunks;
}
