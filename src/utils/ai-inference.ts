/**
 * AI Inference Utility
 *
 * Lightweight AI inference for quick tasks like:
 * - Ticket categorization (type, priority, labels)
 * - Text summarization
 * - Similarity matching
 * - Smart suggestions
 *
 * Uses Ollama for local inference, falls back gracefully.
 */

import { logger } from './logger.js';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
const INFERENCE_TIMEOUT = 30000; // 30 seconds for quick tasks

interface InferenceResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  durationMs?: number;
}

interface OllamaResponse {
  model: string;
  message?: { role: string; content: string };
  done: boolean;
  eval_count?: number;
  prompt_eval_count?: number;
}

/**
 * Check if AI inference is available
 */
export async function isAIAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Run a quick AI inference with structured output
 */
export async function quickInference<T>(
  systemPrompt: string,
  userPrompt: string,
  parseResponse: (text: string) => T
): Promise<InferenceResult<T>> {
  const startTime = Date.now();

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        stream: false,
        options: {
          temperature: 0.3, // Lower temperature for more consistent results
          num_predict: 512, // Short responses for quick tasks
        },
      }),
      signal: AbortSignal.timeout(INFERENCE_TIMEOUT),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Ollama API error: ${response.status}`,
        durationMs: Date.now() - startTime,
      };
    }

    const result = (await response.json()) as OllamaResponse;
    const content = result.message?.content || '';

    try {
      const parsed = parseResponse(content);
      return {
        success: true,
        data: parsed,
        durationMs: Date.now() - startTime,
      };
    } catch (parseError) {
      logger.warn('[AI] Failed to parse response', { content, parseError });
      return {
        success: false,
        error: 'Failed to parse AI response',
        durationMs: Date.now() - startTime,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Inference failed',
      durationMs: Date.now() - startTime,
    };
  }
}

// === Ticket-Specific AI Functions ===

export interface TicketCategorization {
  type: 'task' | 'bug' | 'feature' | 'epic' | 'story' | 'subtask';
  priority: 'critical' | 'high' | 'medium' | 'low' | 'none';
  labels: string[];
  confidence: number;
}

/**
 * Auto-categorize a ticket based on title and description
 */
export async function categorizeTicket(
  title: string,
  description?: string
): Promise<InferenceResult<TicketCategorization>> {
  const systemPrompt = `You are a ticket categorization system. Analyze the ticket and return a JSON object with:
- type: one of "task", "bug", "feature", "epic", "story", "subtask"
- priority: one of "critical", "high", "medium", "low", "none"
- labels: array of 1-5 relevant labels (lowercase, hyphen-separated)
- confidence: number 0-1 representing your confidence

Rules:
- "bug" = something broken, error, crash, not working
- "feature" = new functionality request
- "task" = work item, general task
- "epic" = large initiative with multiple stories
- "story" = user-facing requirement
- "subtask" = small piece of larger work

For priority:
- "critical" = security issue, data loss, system down
- "high" = important, affects many users
- "medium" = standard priority
- "low" = nice to have
- "none" = informational

Return ONLY valid JSON, no explanation.`;

  const userPrompt = `Title: ${title}
${description ? `Description: ${description}` : ''}`;

  return quickInference(systemPrompt, userPrompt, (text) => {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and normalize
    const validTypes = ['task', 'bug', 'feature', 'epic', 'story', 'subtask'];
    const validPriorities = ['critical', 'high', 'medium', 'low', 'none'];

    return {
      type: validTypes.includes(parsed.type) ? parsed.type : 'task',
      priority: validPriorities.includes(parsed.priority) ? parsed.priority : 'medium',
      labels: Array.isArray(parsed.labels) ? parsed.labels.slice(0, 5) : [],
      confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
    };
  });
}

export interface TicketSuggestion {
  title?: string;
  description?: string;
  acceptanceCriteria?: string[];
  suggestedLabels?: string[];
  estimatedEffort?: 'small' | 'medium' | 'large';
}

/**
 * Get AI suggestions to improve a ticket
 */
export async function suggestTicketImprovements(
  title: string,
  description?: string,
  type?: string
): Promise<InferenceResult<TicketSuggestion>> {
  const systemPrompt = `You are a ticket improvement assistant. Analyze the ticket and suggest improvements as JSON:
- title: improved title (only if current is unclear, otherwise null)
- description: improved description with more detail (only if needed, otherwise null)
- acceptanceCriteria: array of 2-4 acceptance criteria (clear, testable statements)
- suggestedLabels: array of 2-4 relevant labels
- estimatedEffort: "small" (< 1 day), "medium" (1-3 days), "large" (> 3 days)

Keep suggestions practical and actionable. Return ONLY valid JSON.`;

  const userPrompt = `Type: ${type || 'task'}
Title: ${title}
${description ? `Description: ${description}` : 'No description provided'}`;

  return quickInference(systemPrompt, userPrompt, (text) => {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      title: parsed.title || undefined,
      description: parsed.description || undefined,
      acceptanceCriteria: Array.isArray(parsed.acceptanceCriteria) ? parsed.acceptanceCriteria : undefined,
      suggestedLabels: Array.isArray(parsed.suggestedLabels) ? parsed.suggestedLabels : undefined,
      estimatedEffort: ['small', 'medium', 'large'].includes(parsed.estimatedEffort)
        ? parsed.estimatedEffort
        : undefined,
    };
  });
}

/**
 * Generate a summary from ticket content
 */
export async function summarizeTicket(
  title: string,
  description?: string,
  comments?: string[]
): Promise<InferenceResult<string>> {
  const systemPrompt = `Summarize the ticket in 1-2 sentences. Be concise and focus on the main objective.`;

  const userPrompt = `Title: ${title}
${description ? `Description: ${description}` : ''}
${comments && comments.length > 0 ? `\nComments:\n${comments.join('\n')}` : ''}`;

  return quickInference(systemPrompt, userPrompt, (text) => text.trim());
}

/**
 * Calculate text similarity score (simple word overlap for now)
 * Returns 0-1 where 1 is identical
 */
export function calculateSimilarity(text1: string, text2: string): number {
  const normalize = (s: string) =>
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2);

  const words1 = new Set(normalize(text1));
  const words2 = new Set(normalize(text2));

  if (words1.size === 0 || words2.size === 0) return 0;

  const intersection = [...words1].filter(w => words2.has(w)).length;
  const union = new Set([...words1, ...words2]).size;

  return intersection / union; // Jaccard similarity
}
