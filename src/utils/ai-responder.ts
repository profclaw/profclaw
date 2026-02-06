/**
 * AI Comment Responder
 *
 * Generates helpful AI responses to ticket comments using Ollama.
 * Can analyze context, answer questions, and provide suggestions.
 */

import { logger } from './logger.js';
import { quickInference, isAIAvailable } from './ai-inference.js';
import type { Ticket, TicketComment } from '../tickets/types.js';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
const RESPONSE_TIMEOUT = 60000; // 60 seconds for longer responses

export interface AIResponseResult {
  success: boolean;
  response?: string;
  shouldPost: boolean;
  confidence: number;
  responseType: 'answer' | 'clarification' | 'suggestion' | 'acknowledgment' | 'none';
  error?: string;
  durationMs: number;
}

interface OllamaResponse {
  model: string;
  message?: { role: string; content: string };
  done: boolean;
  eval_count?: number;
  prompt_eval_count?: number;
}

/**
 * Analyze a comment to determine if it needs an AI response
 */
export async function analyzeComment(
  comment: string,
  ticket: Pick<Ticket, 'title' | 'description' | 'type' | 'status' | 'labels'>,
  previousComments: TicketComment[] = []
): Promise<{ needsResponse: boolean; reason: string; responseType: AIResponseResult['responseType'] }> {
  const systemPrompt = `You analyze ticket comments to determine if an AI assistant should respond.

Return a JSON object with:
- needsResponse: boolean - true if AI should respond
- reason: brief explanation
- responseType: "answer" | "clarification" | "suggestion" | "acknowledgment" | "none"

Respond TRUE for:
- Direct questions about implementation, approach, or status
- Requests for help or clarification
- Technical questions the AI can help with
- Comments asking for suggestions or alternatives

Respond FALSE for:
- Simple status updates ("working on this", "done", "merged")
- Acknowledgments without questions ("thanks", "got it", "ok")
- Comments that are clearly human-to-human conversation
- Already answered questions (check previous comments)
- Inflammatory or off-topic comments

Return ONLY valid JSON.`;

  const userPrompt = `Ticket: ${ticket.title}
Type: ${ticket.type}
Status: ${ticket.status}
Description: ${ticket.description || 'None'}
Labels: ${ticket.labels.join(', ') || 'None'}

Previous comments (last 3):
${previousComments.slice(-3).map((c) => `- ${c.author.name}: ${c.content}`).join('\n') || 'None'}

New comment to analyze:
"${comment}"`;

  const result = await quickInference(systemPrompt, userPrompt, (text) => {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');
    return JSON.parse(jsonMatch[0]);
  });

  if (!result.success || !result.data) {
    return { needsResponse: false, reason: 'Analysis failed', responseType: 'none' };
  }

  return {
    needsResponse: result.data.needsResponse === true,
    reason: result.data.reason || '',
    responseType: result.data.responseType || 'none',
  };
}

/**
 * Generate an AI response to a comment
 */
export async function generateResponse(
  comment: string,
  ticket: Pick<Ticket, 'title' | 'description' | 'type' | 'status' | 'labels' | 'priority'>,
  previousComments: TicketComment[] = [],
  responseType: AIResponseResult['responseType'] = 'answer'
): Promise<AIResponseResult> {
  const startTime = Date.now();

  try {
    const available = await isAIAvailable();
    if (!available) {
      return {
        success: false,
        shouldPost: false,
        confidence: 0,
        responseType: 'none',
        error: 'AI service not available',
        durationMs: Date.now() - startTime,
      };
    }

    const systemPrompt = buildSystemPrompt(responseType, ticket);
    const userPrompt = buildUserPrompt(comment, ticket, previousComments);

    logger.debug('[AIResponder] Generating response', { ticketType: ticket.type, responseType });

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
          temperature: 0.5,
          num_predict: 1024,
        },
      }),
      signal: AbortSignal.timeout(RESPONSE_TIMEOUT),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[AIResponder] API error', undefined, { status: response.status, error: errorText });
      return {
        success: false,
        shouldPost: false,
        confidence: 0,
        responseType: 'none',
        error: `API error: ${response.status}`,
        durationMs: Date.now() - startTime,
      };
    }

    const result = (await response.json()) as OllamaResponse;
    const content = result.message?.content || '';

    // Parse response to extract confidence and actual response
    const { responseText, confidence, shouldPost } = parseResponse(content, responseType);

    logger.info('[AIResponder] Response generated', {
      responseType,
      confidence,
      shouldPost,
      length: responseText.length,
      durationMs: Date.now() - startTime,
    });

    return {
      success: true,
      response: responseText,
      shouldPost,
      confidence,
      responseType,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    logger.error('[AIResponder] Generation failed', error instanceof Error ? error : undefined);
    return {
      success: false,
      shouldPost: false,
      confidence: 0,
      responseType: 'none',
      error: error instanceof Error ? error.message : 'Unknown error',
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Full pipeline: analyze comment and generate response if needed
 */
export async function processComment(
  comment: string,
  ticket: Pick<Ticket, 'title' | 'description' | 'type' | 'status' | 'labels' | 'priority'>,
  previousComments: TicketComment[] = [],
  options: { autoPost?: boolean; minConfidence?: number } = {}
): Promise<AIResponseResult> {
  const startTime = Date.now();
  const { autoPost = false, minConfidence = 0.6 } = options;

  // First, analyze if response is needed
  const analysis = await analyzeComment(comment, ticket, previousComments);

  if (!analysis.needsResponse) {
    logger.debug('[AIResponder] No response needed', { reason: analysis.reason });
    return {
      success: true,
      shouldPost: false,
      confidence: 0,
      responseType: 'none',
      durationMs: Date.now() - startTime,
    };
  }

  // Generate response
  const result = await generateResponse(comment, ticket, previousComments, analysis.responseType);

  // Override shouldPost based on options
  if (autoPost && result.success && result.confidence >= minConfidence) {
    result.shouldPost = true;
  } else if (!autoPost) {
    result.shouldPost = false;
  }

  return result;
}

// === Helper Functions ===

function buildSystemPrompt(
  responseType: AIResponseResult['responseType'],
  ticket: Pick<Ticket, 'type' | 'status' | 'priority'>
): string {
  const basePrompt = `You are a helpful AI assistant for a software project ticket system.
You're responding to a comment on a ${ticket.type} ticket (status: ${ticket.status}, priority: ${ticket.priority}).

Guidelines:
- Be concise and helpful
- Focus on actionable information
- Use technical language appropriate for developers
- If unsure, ask clarifying questions
- Never make promises about timelines
- Reference relevant documentation or patterns when helpful`;

  switch (responseType) {
    case 'answer':
      return `${basePrompt}

Your task: Provide a direct, helpful answer to the question or request.
Format: Start with the key answer, then add supporting details if needed.`;

    case 'clarification':
      return `${basePrompt}

Your task: Ask clarifying questions to better understand the request.
Format: Acknowledge what you understand, then ask specific questions.`;

    case 'suggestion':
      return `${basePrompt}

Your task: Provide constructive suggestions or alternatives.
Format: Present 2-3 concrete suggestions with brief pros/cons.`;

    case 'acknowledgment':
      return `${basePrompt}

Your task: Acknowledge the comment and offer to help if needed.
Format: Brief acknowledgment with optional follow-up offer.`;

    default:
      return basePrompt;
  }
}

function buildUserPrompt(
  comment: string,
  ticket: Pick<Ticket, 'title' | 'description' | 'type' | 'status' | 'labels'>,
  previousComments: TicketComment[]
): string {
  let prompt = `**Ticket Context:**
Title: ${ticket.title}
Type: ${ticket.type}
Status: ${ticket.status}
Labels: ${ticket.labels.join(', ') || 'None'}
${ticket.description ? `\nDescription:\n${ticket.description}` : ''}`;

  if (previousComments.length > 0) {
    prompt += `\n\n**Recent Comments:**\n`;
    prompt += previousComments.slice(-5).map((c) => {
      const author = c.author.type === 'ai' ? `AI (${c.author.name})` : c.author.name;
      return `- ${author}: ${c.content}`;
    }).join('\n');
  }

  prompt += `\n\n**Comment to respond to:**\n"${comment}"`;
  prompt += `\n\nProvide a helpful response:`;

  return prompt;
}

function parseResponse(
  content: string,
  responseType: AIResponseResult['responseType']
): { responseText: string; confidence: number; shouldPost: boolean } {
  // Clean up the response
  let responseText = content.trim();

  // Remove any markdown code block wrapping
  if (responseText.startsWith('```')) {
    responseText = responseText.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
  }

  // Calculate confidence based on response quality indicators
  let confidence = 0.7; // Base confidence

  // Higher confidence for longer, more detailed responses
  if (responseText.length > 200) confidence += 0.1;
  if (responseText.length > 500) confidence += 0.05;

  // Lower confidence for short responses
  if (responseText.length < 50) confidence -= 0.2;

  // Check for uncertainty markers
  const uncertaintyMarkers = ['i\'m not sure', 'i think', 'maybe', 'possibly', 'unclear'];
  if (uncertaintyMarkers.some((m) => responseText.toLowerCase().includes(m))) {
    confidence -= 0.1;
  }

  // Check for definitive markers
  const definitiveMarkers = ['specifically', 'exactly', 'definitely', 'here\'s how'];
  if (definitiveMarkers.some((m) => responseText.toLowerCase().includes(m))) {
    confidence += 0.1;
  }

  // Clamp confidence
  confidence = Math.min(1, Math.max(0, confidence));

  // Determine if should post based on response type and confidence
  const shouldPost = responseType !== 'none' && confidence >= 0.5 && responseText.length >= 20;

  return { responseText, confidence, shouldPost };
}

/**
 * Get a quick status on AI responder availability
 */
export async function getResponderStatus(): Promise<{
  available: boolean;
  model: string;
  baseUrl: string;
}> {
  const available = await isAIAvailable();
  return {
    available,
    model: OLLAMA_MODEL,
    baseUrl: OLLAMA_BASE_URL,
  };
}
