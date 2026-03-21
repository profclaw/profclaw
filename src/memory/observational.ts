/**
 * Observational Memory Engine
 *
 * Background agent that compresses conversation history into structured
 * observations. Instead of storing raw messages, it extracts:
 *   - Decisions made and their rationale
 *   - User preferences (language, framework, style, tools)
 *   - Problems solved and solution patterns
 *   - Project facts and context
 *
 * This is the "profClaw never forgets AND learns" story.
 * Based on VentureBeat's observational memory pattern (10x cheaper than RAG).
 */

import { randomUUID } from 'node:crypto';
import { createContextualLogger } from '../utils/logger.js';
import {
  recordExperience,
  trackPreference,
  findSimilarExperiences,
  type ExperienceType,
} from './experience-store.js';

const log = createContextualLogger('ObservationalMemory');

// Types

export type ObservationType =
  | 'decision'
  | 'preference'
  | 'solution'
  | 'fact'
  | 'error_pattern'
  | 'workflow';

export interface Observation {
  id: string;
  type: ObservationType;
  summary: string;
  details: Record<string, unknown>;
  confidence: number;
  source: {
    conversationId: string;
    messageRange: [number, number]; // [startIdx, endIdx]
    timestamp: number;
  };
}

export interface ConversationSnapshot {
  conversationId: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    model?: string;
    toolsUsed?: string[];
  }>;
  metadata?: {
    provider?: string;
    channel?: string;
    userId?: string;
  };
}

export interface ObservationResult {
  observations: Observation[];
  preferencesTracked: number;
  experiencesRecorded: number;
  processingTimeMs: number;
}

// Observation Extractors

interface ObservationExtractor {
  type: ObservationType;
  /** Returns extracted observations from a conversation window */
  extract: (messages: ConversationSnapshot['messages'], context: ExtractContext) => Observation[];
}

interface ExtractContext {
  conversationId: string;
  userId?: string;
  startIdx: number;
}

/**
 * Extract decisions from conversation (user chose X over Y, agreed to approach).
 */
const decisionExtractor: ObservationExtractor = {
  type: 'decision',
  extract: (messages, ctx) => {
    const observations: Observation[] = [];
    const decisionPatterns = [
      /\b(?:let's go with|decided to|choosing|we'll use|going with|picked|selected)\b\s+(.{10,80})/i,
      /\b(?:yes|agreed|correct|that's right|exactly|perfect)\b.*\b(?:use|go with|pick|choose)\b\s+(.{5,60})/i,
      /\b(?:instead of|rather than|not|don't)\b\s+(.{5,60})\b(?:use|go with|pick)\b\s+(.{5,60})/i,
    ];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== 'user' && msg.role !== 'assistant') continue;

      for (const pattern of decisionPatterns) {
        const match = msg.content.match(pattern);
        if (match) {
          observations.push({
            id: randomUUID(),
            type: 'decision',
            summary: `Decision: ${match[0].slice(0, 120)}`,
            details: { matchedText: match[0], role: msg.role },
            confidence: 0.7,
            source: {
              conversationId: ctx.conversationId,
              messageRange: [ctx.startIdx + i, ctx.startIdx + i],
              timestamp: Date.now(),
            },
          });
          break; // one per message
        }
      }
    }
    return observations;
  },
};

/**
 * Extract user preferences (language, framework, tool, style choices).
 */
const preferenceExtractor: ObservationExtractor = {
  type: 'preference',
  extract: (messages, ctx) => {
    const observations: Observation[] = [];
    const prefPatterns: Array<{ pattern: RegExp; category: string }> = [
      { pattern: /\b(?:I (?:use|prefer|like|want|always use|work with))\s+(\w[\w\s.-]{2,30})/i, category: 'tool' },
      { pattern: /\b(?:write (?:it )?in|using|with)\s+(TypeScript|JavaScript|Python|Go|Rust|Java|C\+\+|Ruby|PHP|Swift|Kotlin)/i, category: 'language' },
      { pattern: /\b(?:use|using|with)\s+(React|Vue|Angular|Svelte|Next\.?js|Nuxt|Express|Hono|FastAPI|Django|Spring|Rails)/i, category: 'framework' },
      { pattern: /\b(?:style|format|convention).*\b(camelCase|snake_case|PascalCase|kebab-case)/i, category: 'style' },
      { pattern: /\b(?:don't|never|avoid|skip|no)\s+(\w[\w\s]{2,30})/i, category: 'anti-preference' },
    ];

    for (const msg of messages) {
      if (msg.role !== 'user') continue;
      for (const { pattern, category } of prefPatterns) {
        const match = msg.content.match(pattern);
        if (match && match[1]) {
          observations.push({
            id: randomUUID(),
            type: 'preference',
            summary: `Preference (${category}): ${match[1].trim()}`,
            details: { category, value: match[1].trim(), fullMatch: match[0] },
            confidence: 0.6,
            source: {
              conversationId: ctx.conversationId,
              messageRange: [ctx.startIdx, ctx.startIdx + messages.length - 1],
              timestamp: Date.now(),
            },
          });
        }
      }
    }
    return observations;
  },
};

/**
 * Extract solution patterns (problem -> tool chain -> outcome).
 */
const solutionExtractor: ObservationExtractor = {
  type: 'solution',
  extract: (messages, ctx) => {
    const observations: Observation[] = [];

    // Find messages with tool usage followed by success indicators
    const toolMessages = messages.filter(m => m.toolsUsed && m.toolsUsed.length > 0);
    if (toolMessages.length === 0) return observations;

    // Look for the user's original request
    const firstUserMsg = messages.find(m => m.role === 'user');
    if (!firstUserMsg) return observations;

    // Check if the conversation ended positively
    const lastMessages = messages.slice(-3);
    const endedPositively = lastMessages.some(m =>
      m.role === 'user' && /\b(thanks|perfect|great|works|done|good|nice)\b/i.test(m.content),
    ) || lastMessages.some(m =>
      m.role === 'assistant' && /\b(completed|done|finished|success)\b/i.test(m.content),
    );

    if (endedPositively && toolMessages.length > 0) {
      const allTools = [...new Set(toolMessages.flatMap(m => m.toolsUsed ?? []))];
      observations.push({
        id: randomUUID(),
        type: 'solution',
        summary: `Solved "${firstUserMsg.content.slice(0, 80)}" using ${allTools.join(' -> ')}`,
        details: {
          problem: firstUserMsg.content.slice(0, 200),
          tools: allTools,
          messageCount: messages.length,
        },
        confidence: endedPositively ? 0.85 : 0.5,
        source: {
          conversationId: ctx.conversationId,
          messageRange: [ctx.startIdx, ctx.startIdx + messages.length - 1],
          timestamp: Date.now(),
        },
      });
    }

    return observations;
  },
};

/**
 * Extract project facts (file paths, architecture, naming conventions).
 */
const factExtractor: ObservationExtractor = {
  type: 'fact',
  extract: (messages, ctx) => {
    const observations: Observation[] = [];
    const factPatterns = [
      { pattern: /\b(?:the (?:project|repo|codebase) (?:uses|has|is|runs on))\s+(.{10,100})/i, category: 'architecture' },
      { pattern: /\b(?:deployed (?:on|to|at|via))\s+(\S+)/i, category: 'deployment' },
      { pattern: /\b(?:database|db) (?:is|uses)\s+(\w+)/i, category: 'database' },
      { pattern: /\b(?:CI|CD|pipeline) (?:is|uses|runs on)\s+(\w[\w\s.-]+)/i, category: 'ci' },
    ];

    for (const msg of messages) {
      if (msg.role !== 'user') continue;
      for (const { pattern, category } of factPatterns) {
        const match = msg.content.match(pattern);
        if (match) {
          observations.push({
            id: randomUUID(),
            type: 'fact',
            summary: `Project fact (${category}): ${match[0].slice(0, 100)}`,
            details: { category, fact: match[0], value: match[1] },
            confidence: 0.65,
            source: {
              conversationId: ctx.conversationId,
              messageRange: [ctx.startIdx, ctx.startIdx + messages.length - 1],
              timestamp: Date.now(),
            },
          });
        }
      }
    }
    return observations;
  },
};

/**
 * Extract error recovery patterns (what went wrong, how it was fixed).
 */
const errorPatternExtractor: ObservationExtractor = {
  type: 'error_pattern',
  extract: (messages, ctx) => {
    const observations: Observation[] = [];

    for (let i = 0; i < messages.length - 1; i++) {
      const msg = messages[i];
      const next = messages[i + 1];

      // Look for error followed by fix
      const isError = msg.role === 'assistant' &&
        /\b(error|failed|exception|crash|bug|issue|problem)\b/i.test(msg.content);
      const isFix = next && next.role === 'assistant' &&
        /\b(fix|resolved|solved|workaround|updated|changed)\b/i.test(next.content);

      if (isError && isFix) {
        observations.push({
          id: randomUUID(),
          type: 'error_pattern',
          summary: `Error recovery: ${msg.content.slice(0, 60)} -> ${next.content.slice(0, 60)}`,
          details: {
            error: msg.content.slice(0, 200),
            fix: next.content.slice(0, 200),
            toolsUsed: next.toolsUsed,
          },
          confidence: 0.75,
          source: {
            conversationId: ctx.conversationId,
            messageRange: [ctx.startIdx + i, ctx.startIdx + i + 1],
            timestamp: Date.now(),
          },
        });
      }
    }
    return observations;
  },
};

const ALL_EXTRACTORS: ObservationExtractor[] = [
  decisionExtractor,
  preferenceExtractor,
  solutionExtractor,
  factExtractor,
  errorPatternExtractor,
];

// Core Engine

/**
 * Process a conversation snapshot and extract observations.
 * Call this after a conversation ends or at periodic intervals.
 */
export async function observeConversation(
  snapshot: ConversationSnapshot,
): Promise<ObservationResult> {
  const start = Date.now();
  const allObservations: Observation[] = [];
  let preferencesTracked = 0;
  let experiencesRecorded = 0;

  const ctx: ExtractContext = {
    conversationId: snapshot.conversationId,
    userId: snapshot.metadata?.userId,
    startIdx: 0,
  };

  // Run all extractors
  for (const extractor of ALL_EXTRACTORS) {
    try {
      const observations = extractor.extract(snapshot.messages, ctx);
      allObservations.push(...observations);
    } catch (error) {
      log.warn(`Extractor ${extractor.type} failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Deduplicate by summary similarity
  const seen = new Set<string>();
  const unique = allObservations.filter(obs => {
    const key = obs.summary.toLowerCase().slice(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Check for duplicates against existing experiences
  const deduplicated: Observation[] = [];
  for (const obs of unique) {
    const existing = await findSimilarExperiences(obs.summary, [], 1);
    if (existing.length > 0 && existing[0].successScore >= obs.confidence) {
      continue; // already know this
    }
    deduplicated.push(obs);
  }

  // Persist observations
  for (const obs of deduplicated) {
    try {
      // Map observation type to experience type
      const expType: ExperienceType = obs.type === 'preference' ? 'user_preference'
        : obs.type === 'solution' || obs.type === 'workflow' ? 'task_solution'
        : obs.type === 'error_pattern' ? 'error_recovery'
        : 'task_solution';

      await recordExperience({
        type: expType,
        intent: obs.summary,
        solution: obs.details,
        successScore: obs.confidence,
        tags: [obs.type, ...(obs.details['category'] ? [String(obs.details['category'])] : [])],
        sourceConversationId: obs.source.conversationId,
        userId: ctx.userId,
      });
      experiencesRecorded++;

      // Track preferences specifically
      if (obs.type === 'preference' && ctx.userId && obs.details['category'] && obs.details['value']) {
        await trackPreference(
          ctx.userId,
          String(obs.details['category']),
          String(obs.details['value']),
        );
        preferencesTracked++;
      }
    } catch (error) {
      log.warn('Failed to persist observation', {
        type: obs.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const result: ObservationResult = {
    observations: deduplicated,
    preferencesTracked,
    experiencesRecorded,
    processingTimeMs: Date.now() - start,
  };

  if (deduplicated.length > 0) {
    log.info('Observations extracted', {
      conversationId: snapshot.conversationId,
      total: deduplicated.length,
      byType: countByType(deduplicated),
      preferencesTracked,
      experiencesRecorded,
      processingTimeMs: result.processingTimeMs,
    });
  }

  return result;
}

/**
 * Process a batch of recent messages (sliding window).
 * Use this for periodic observation without waiting for conversation end.
 */
export async function observeWindow(
  conversationId: string,
  messages: ConversationSnapshot['messages'],
  windowSize: number = 20,
  userId?: string,
): Promise<ObservationResult> {
  // Take last N messages
  const window = messages.slice(-windowSize);
  return observeConversation({
    conversationId,
    messages: window,
    metadata: { userId },
  });
}

/**
 * Build a compressed summary of a conversation for long-term storage.
 * Replaces raw message history with a structured digest.
 */
export function compressToDigest(
  messages: ConversationSnapshot['messages'],
  observations: Observation[],
): string {
  const sections: string[] = [];

  // Conversation overview
  const userMessages = messages.filter(m => m.role === 'user');
  const assistantMessages = messages.filter(m => m.role === 'assistant');
  sections.push(`Conversation: ${userMessages.length} user messages, ${assistantMessages.length} assistant responses.`);

  // Group observations by type
  const grouped = new Map<ObservationType, Observation[]>();
  for (const obs of observations) {
    const list = grouped.get(obs.type) ?? [];
    list.push(obs);
    grouped.set(obs.type, list);
  }

  if (grouped.has('decision')) {
    sections.push('Decisions: ' + grouped.get('decision')!.map(o => o.summary).join('; '));
  }
  if (grouped.has('preference')) {
    sections.push('Preferences: ' + grouped.get('preference')!.map(o => o.summary).join('; '));
  }
  if (grouped.has('solution')) {
    sections.push('Solutions: ' + grouped.get('solution')!.map(o => o.summary).join('; '));
  }
  if (grouped.has('fact')) {
    sections.push('Facts: ' + grouped.get('fact')!.map(o => o.summary).join('; '));
  }
  if (grouped.has('error_pattern')) {
    sections.push('Error patterns: ' + grouped.get('error_pattern')!.map(o => o.summary).join('; '));
  }

  // Key topics from user messages
  const topics = extractTopics(userMessages.map(m => m.content));
  if (topics.length > 0) {
    sections.push('Topics: ' + topics.join(', '));
  }

  return sections.join('\n');
}

// Helpers

function countByType(observations: Observation[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const obs of observations) {
    counts[obs.type] = (counts[obs.type] ?? 0) + 1;
  }
  return counts;
}

function extractTopics(texts: string[]): string[] {
  const wordFreq = new Map<string, number>();
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'can', 'shall', 'to', 'of', 'in',
    'on', 'at', 'for', 'with', 'by', 'from', 'up', 'about', 'into',
    'through', 'how', 'what', 'when', 'where', 'why', 'which', 'this',
    'that', 'these', 'those', 'and', 'but', 'or', 'not', 'no', 'so',
    'if', 'then', 'than', 'too', 'very', 'just', 'also', 'its', 'my',
    'your', 'it', 'i', 'me', 'we', 'you', 'he', 'she', 'they', 'them',
    'please', 'thanks', 'thank', 'hi', 'hello', 'hey',
  ]);

  for (const text of texts) {
    const words = text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/);
    for (const word of words) {
      if (word.length < 3 || stopWords.has(word)) continue;
      wordFreq.set(word, (wordFreq.get(word) ?? 0) + 1);
    }
  }

  return [...wordFreq.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);
}
