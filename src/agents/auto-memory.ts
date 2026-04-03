/**
 * Auto-Memory Extractor
 *
 * Extracts durable insights from conversation turns using local
 * keyword/pattern matching — no LLM calls required.
 *
 * Memories are stored at .profclaw/memory/entries.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemoryType = 'decision' | 'preference' | 'context' | 'pattern' | 'error_fix';

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  content: string;
  source: { sessionId: string; turnIndex: number };
  createdAt: number;
  /** 0-1, decays over time via prune() */
  relevance: number;
}

export interface TurnInput {
  userMessage: string;
  assistantResponse: string;
  toolCalls?: Array<{ name: string; args: unknown; result: unknown }>;
  sessionId: string;
  turnIndex: number;
}

// ---------------------------------------------------------------------------
// Pattern definitions (local keyword extraction — no LLM)
// ---------------------------------------------------------------------------

interface ExtractionRule {
  type: MemoryType;
  /** Patterns matched against userMessage */
  userPatterns?: RegExp[];
  /** Patterns matched against assistantResponse */
  assistantPatterns?: RegExp[];
  /** Both must match (AND logic) if supplied */
  requireBoth?: boolean;
  /** Transform matched text into memory content */
  format: (userMsg: string, assistantMsg: string, match: RegExpMatchArray | null) => string;
}

const EXTRACTION_RULES: ExtractionRule[] = [
  // Decision: "no, use X instead" / "don't do X" / "use X not Y"
  {
    type: 'decision',
    userPatterns: [
      /\bno[,.]?\s+use\s+(.+?)\s+instead\b/i,
      /\bdon['']?t\s+use\s+(.+?)[\.,]/i,
      /\buse\s+(.+?)\s+(?:not|instead of)\s+(.+?)[\.,]/i,
      /\bplease\s+(?:use|switch to)\s+(.+?)\s+instead\b/i,
      /\bthat'?s?\s+(?:wrong|incorrect)[,.]?\s+(?:it\s+should\s+be|use)\s+(.+?)[\.,]/i,
    ],
    format: (userMsg) => `Decision: ${userMsg.trim()}`,
  },
  // Preference: "I prefer X" / "I like X" / "always use X"
  {
    type: 'preference',
    userPatterns: [
      /\bI\s+prefer\s+(.+?)[\.,]/i,
      /\bI\s+(?:always|usually)\s+use\s+(.+?)[\.,]/i,
      /\bI\s+like\s+(?:to\s+use\s+)?(.+?)[\.,]/i,
      /\balways\s+use\s+(.+?)[\.,]/i,
      /\bmy\s+preferred\s+(.+?)\s+is\s+(.+?)[\.,]/i,
    ],
    format: (userMsg) => `Preference: ${userMsg.trim()}`,
  },
  // Context: "this project uses X" / "we use X" / "the stack is X"
  {
    type: 'context',
    userPatterns: [
      /\bthis\s+project\s+uses?\s+(.+?)[\.,]/i,
      /\bwe\s+(?:use|are using)\s+(.+?)[\.,]/i,
      /\bthe\s+stack\s+is\s+(.+?)[\.,]/i,
      /\bour\s+(?:app|service|backend|frontend)\s+(?:uses?|runs?)\s+(.+?)[\.,]/i,
      /\bbuilt\s+(?:with|on|using)\s+(.+?)[\.,]/i,
    ],
    format: (userMsg) => `Context: ${userMsg.trim()}`,
  },
  // Error fix: "the fix was X" / "the issue was X" / "solved by X"
  {
    type: 'error_fix',
    userPatterns: [
      /\bthe\s+(?:fix|solution)\s+(?:was|is)\s+(.+?)[\.,]/i,
      /\bthe\s+(?:issue|problem|bug)\s+(?:was|is)\s+(.+?)[\.,]/i,
      /\bsolved\s+by\s+(.+?)[\.,]/i,
      /\bfixed\s+(?:by|with|using)\s+(.+?)[\.,]/i,
    ],
    assistantPatterns: [
      /\bthe\s+(?:fix|issue|problem)\s+(?:was|is)\s+(.+?)[\.,]/i,
      /\bthis\s+(?:was\s+caused|happened)\s+(?:by|because)\s+(.+?)[\.,]/i,
      /\broot\s+cause[:\s]+(.+?)[\.,]/i,
    ],
    format: (userMsg, assistantMsg, match) => {
      const src = match ? assistantMsg : userMsg;
      return `Error fix: ${src.trim()}`;
    },
  },
  // Context: assistant explains project facts
  {
    type: 'context',
    assistantPatterns: [
      /\bthis\s+project\s+uses?\s+(.+?)[\.,]/i,
      /\byou(?:'re|\s+are)\s+using\s+(.+?)[\.,]/i,
    ],
    format: (_userMsg, assistantMsg) => `Context: ${assistantMsg.trim()}`,
  },
];

// ---------------------------------------------------------------------------
// Pattern memory: detect repeated tool chains
// ---------------------------------------------------------------------------

interface ToolSequenceRecord {
  sequence: string;
  count: number;
  lastTurnIndex: number;
  sessionId: string;
}

const PATTERN_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// AutoMemoryExtractor
// ---------------------------------------------------------------------------

let _instance: AutoMemoryExtractor | null = null;

export class AutoMemoryExtractor {
  private memoryDir: string;
  private entries: MemoryEntry[];
  /** Tool sequence tracking keyed by sequence fingerprint */
  private toolSequences: Map<string, ToolSequenceRecord>;

  constructor(projectRoot?: string) {
    const root = projectRoot ?? process.cwd();
    this.memoryDir = path.join(root, '.profclaw', 'memory');
    this.entries = [];
    this.toolSequences = new Map();
    this.load();
  }

  // -------------------------------------------------------------------------
  // Core: extract memories from a completed turn
  // -------------------------------------------------------------------------

  extractFromTurn(turn: TurnInput): MemoryEntry[] {
    const extracted: MemoryEntry[] = [];
    const { userMessage, assistantResponse, toolCalls, sessionId, turnIndex } = turn;

    // Apply each rule
    for (const rule of EXTRACTION_RULES) {
      let matchedUser: RegExpMatchArray | null = null;
      let matchedAssistant: RegExpMatchArray | null = null;

      if (rule.userPatterns) {
        for (const pat of rule.userPatterns) {
          const m = userMessage.match(pat);
          if (m) { matchedUser = m; break; }
        }
      }

      if (rule.assistantPatterns) {
        for (const pat of rule.assistantPatterns) {
          const m = assistantResponse.match(pat);
          if (m) { matchedAssistant = m; break; }
        }
      }

      // Determine if the rule fires
      let fires = false;
      let matchRef: RegExpMatchArray | null = null;

      if (rule.userPatterns && rule.assistantPatterns) {
        // Both required when both pattern sets are defined and requireBoth is true
        if (rule.requireBoth) {
          fires = matchedUser !== null && matchedAssistant !== null;
          matchRef = matchedAssistant;
        } else {
          fires = matchedUser !== null || matchedAssistant !== null;
          matchRef = matchedAssistant ?? matchedUser;
        }
      } else if (rule.userPatterns) {
        fires = matchedUser !== null;
        matchRef = matchedUser;
      } else if (rule.assistantPatterns) {
        fires = matchedAssistant !== null;
        matchRef = matchedAssistant;
      }

      if (!fires) continue;

      const content = rule.format(userMessage, assistantResponse, matchRef);

      // Avoid duplicate entries with identical content
      if (this.entries.some((e) => e.content === content)) continue;

      const entry: MemoryEntry = {
        id: randomUUID(),
        type: rule.type,
        content,
        source: { sessionId, turnIndex },
        createdAt: Date.now(),
        relevance: 1.0,
      };
      extracted.push(entry);
      this.entries.push(entry);
    }

    // Pattern memory: detect repeated tool sequences
    if (toolCalls && toolCalls.length >= 2) {
      const sequence = toolCalls.map((tc) => tc.name).join(' → ');
      const existing = this.toolSequences.get(sequence);

      if (existing) {
        existing.count += 1;
        existing.lastTurnIndex = turnIndex;

        if (existing.count === PATTERN_THRESHOLD) {
          const content = `Pattern: tool chain "${sequence}" used ${existing.count}+ times`;
          if (!this.entries.some((e) => e.content === content)) {
            const entry: MemoryEntry = {
              id: randomUUID(),
              type: 'pattern',
              content,
              source: { sessionId, turnIndex },
              createdAt: Date.now(),
              relevance: 1.0,
            };
            extracted.push(entry);
            this.entries.push(entry);
          }
        }
      } else {
        this.toolSequences.set(sequence, {
          sequence,
          count: 1,
          lastTurnIndex: turnIndex,
          sessionId,
        });
      }
    }

    if (extracted.length > 0) {
      this.save();
    }

    return extracted;
  }

  // -------------------------------------------------------------------------
  // Search: keyword matching + relevance scoring
  // -------------------------------------------------------------------------

  search(query: string, limit = 10): MemoryEntry[] {
    if (!query.trim()) return this.entries.slice(0, limit);

    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 2);

    const scored = this.entries.map((entry) => {
      const lower = entry.content.toLowerCase();
      const matchCount = words.filter((w) => lower.includes(w)).length;
      const score = (matchCount / Math.max(words.length, 1)) * entry.relevance;
      return { entry, score };
    });

    return scored
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ entry }) => entry);
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  getAll(): MemoryEntry[] {
    return [...this.entries];
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  save(): void {
    try {
      this.ensureDir();
      const filePath = this.entriesFilePath();
      fs.writeFileSync(
        filePath,
        JSON.stringify({ entries: this.entries, sequences: Array.from(this.toolSequences.entries()) }, null, 2),
        'utf8',
      );
    } catch (err) {
      console.error('[AutoMemoryExtractor] Failed to save:', err);
    }
  }

  load(): void {
    const filePath = this.entriesFilePath();
    if (!fs.existsSync(filePath)) return;

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as {
        entries?: MemoryEntry[];
        sequences?: Array<[string, ToolSequenceRecord]>;
      };
      this.entries = Array.isArray(parsed.entries) ? parsed.entries : [];
      if (Array.isArray(parsed.sequences)) {
        this.toolSequences = new Map(parsed.sequences);
      }
    } catch (err) {
      console.error('[AutoMemoryExtractor] Failed to load:', err);
      this.entries = [];
    }
  }

  // -------------------------------------------------------------------------
  // Pruning
  // -------------------------------------------------------------------------

  /**
   * Remove entries that are too old or too low relevance.
   * Also applies time-based decay to remaining entries.
   * Returns the count of pruned entries.
   */
  prune(maxAgeMs = 30 * 24 * 60 * 60 * 1000, minRelevance = 0.1): number {
    const now = Date.now();
    const before = this.entries.length;

    this.entries = this.entries
      .map((e) => {
        // Exponential decay: half-life = maxAgeMs / 2
        const ageFraction = (now - e.createdAt) / maxAgeMs;
        const decayed = e.relevance * Math.exp(-Math.LN2 * ageFraction);
        return { ...e, relevance: Math.max(0, decayed) };
      })
      .filter((e) => {
        const tooOld = now - e.createdAt > maxAgeMs;
        const tooWeak = e.relevance < minRelevance;
        return !tooOld && !tooWeak;
      });

    const pruned = before - this.entries.length;
    if (pruned > 0) this.save();
    return pruned;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private entriesFilePath(): string {
    return path.join(this.memoryDir, 'entries.json');
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true });
    }
  }
}

/**
 * Returns the process-level singleton AutoMemoryExtractor, rooted at cwd().
 */
export function getAutoMemoryExtractor(): AutoMemoryExtractor {
  if (!_instance) {
    _instance = new AutoMemoryExtractor();
  }
  return _instance;
}

/** Exported for test injection. */
export function _resetAutoMemoryExtractorSingleton(): void {
  _instance = null;
}
