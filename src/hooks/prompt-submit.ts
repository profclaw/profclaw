/**
 * UserPromptSubmit Hook Handler
 *
 * Processes UserPromptSubmit events from Claude Code hooks.
 * Captures user prompts for task tracking and context.
 *
 * Usage in ~/.claude/settings.json:
 * {
 *   "hooks": {
 *     "UserPromptSubmit": "curl -s -X POST http://localhost:3000/api/hook/prompt-submit -H 'Content-Type: application/json' -d '$HOOK_PAYLOAD'"
 *   }
 * }
 */

import { randomUUID } from 'crypto';
import type { Context } from 'hono';
import { UserPromptSubmitPayloadSchema } from './schemas.js';
import type { HookProcessingResult } from './types.js';
import { createContextualLogger } from '../utils/logger.js';

const log = createContextualLogger('PromptSubmit');

// In-memory storage for prompt events
const promptEvents = new Map<string, PromptEvent[]>();

interface PromptEvent {
  id: string;
  sessionId: string;
  timestamp: Date;
  prompt: string;
  context?: {
    file?: string;
    selection?: string;
    repository?: string;
    branch?: string;
  };
}

/**
 * Handle UserPromptSubmit webhook from Claude Code
 */
export async function handlePromptSubmit(c: Context): Promise<HookProcessingResult> {
  try {
    const rawBody = await c.req.text();

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      try {
        payload = JSON.parse(JSON.parse(rawBody));
      } catch {
        throw new Error('Invalid JSON payload');
      }
    }

    const parsed = UserPromptSubmitPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      log.error('Prompt submit validation failed', new Error(parsed.error.message));
      return {
        success: false,
        eventId: '',
        error: `Validation failed: ${parsed.error.message}`,
      };
    }

    const hookPayload = parsed.data;
    const sessionId = hookPayload.session_id || 'unknown';

    // Create prompt event
    const event: PromptEvent = {
      id: randomUUID(),
      sessionId,
      timestamp: hookPayload.timestamp ? new Date(hookPayload.timestamp) : new Date(),
      prompt: hookPayload.prompt,
      context: hookPayload.context,
    };

    // Store event
    storePromptEvent(event);

    // Log for debugging
    const promptPreview = event.prompt.slice(0, 50) + (event.prompt.length > 50 ? '...' : '');
    log.info('UserPromptSubmit', { promptPreview, contextFile: event.context?.file });

    return {
      success: true,
      eventId: event.id,
    };
  } catch (error) {
    log.error('Error processing prompt submit', error instanceof Error ? error : new Error(String(error)));
    return {
      success: false,
      eventId: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Store prompt event by session
 */
function storePromptEvent(event: PromptEvent): void {
  let events = promptEvents.get(event.sessionId);
  if (!events) {
    events = [];
    promptEvents.set(event.sessionId, events);
  }

  // Keep last 100 prompts per session
  if (events.length >= 100) {
    events.shift();
  }

  events.push(event);
}

/**
 * Get prompts for a session
 */
export function getSessionPrompts(sessionId: string): PromptEvent[] {
  return promptEvents.get(sessionId) || [];
}

/**
 * Get the initial prompt for a session (first user prompt)
 */
export function getInitialPrompt(sessionId: string): string | undefined {
  const events = promptEvents.get(sessionId);
  return events?.[0]?.prompt;
}

/**
 * Clear prompts for a session
 */
export function clearSessionPrompts(sessionId: string): void {
  promptEvents.delete(sessionId);
}
