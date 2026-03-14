/**
 * PostToolUse Hook Handler
 *
 * Processes PostToolUse events from Claude Code hooks.
 * Zero token cost - uses shell command callback.
 *
 * Usage in ~/.claude/settings.json:
 * {
 *   "hooks": {
 *     "PostToolUse": "curl -s -X POST http://localhost:3000/api/hook/tool-use -H 'Content-Type: application/json' -d '$HOOK_PAYLOAD'"
 *   }
 * }
 */

import { randomUUID } from 'crypto';
import type { Context } from 'hono';
import { PostToolUsePayloadSchema, type PostToolUsePayload } from './schemas.js';
import type { HookEvent, HookEventData, HookProcessingResult } from './types.js';
import { inferFromToolUse } from '../intelligence/rules.js';
import { createContextualLogger } from '../utils/logger.js';

const log = createContextualLogger('ToolUse');

// In-memory storage for hook events (will be replaced with DB later)
const hookEvents = new Map<string, HookEvent>();
const sessionEvents = new Map<string, HookEvent[]>();

// Maximum events per session to prevent memory bloat
const MAX_EVENTS_PER_SESSION = 1000;

/**
 * Handle PostToolUse webhook from Claude Code
 */
export async function handlePostToolUse(c: Context): Promise<HookProcessingResult> {
  try {
    const rawBody = await c.req.text();

    // Handle escaped JSON from shell (curl with $HOOK_PAYLOAD)
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      // Try unescaping if double-escaped
      try {
        payload = JSON.parse(JSON.parse(rawBody));
      } catch {
        throw new Error('Invalid JSON payload');
      }
    }

    // Validate payload
    const parsed = PostToolUsePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      log.error('Validation failed', new Error(parsed.error.message));
      return {
        success: false,
        eventId: '',
        error: `Validation failed: ${parsed.error.message}`,
      };
    }

    const hookPayload = parsed.data;

    // Run inference
    const inference = inferFromToolUse(hookPayload);

    // Extract event data
    const eventData = extractEventData(hookPayload);

    // Create hook event
    const event: HookEvent = {
      id: randomUUID(),
      sessionId: hookPayload.session_id || 'unknown',
      event: 'PostToolUse',
      timestamp: hookPayload.timestamp ? new Date(hookPayload.timestamp) : new Date(),
      workingDirectory: hookPayload.working_directory,
      data: eventData,
      inference: inference.confidence > 0 ? inference : undefined,
    };

    // Store event
    storeEvent(event);

    // Log for debugging
    log.info('PostToolUse', {
      tool: hookPayload.tool,
      filePath: eventData.filePath || 'N/A',
      inference: inference.confidence > 0 ? inference : undefined,
    });

    return {
      success: true,
      eventId: event.id,
      inference: event.inference,
    };
  } catch (error) {
    log.error('Error processing PostToolUse', error instanceof Error ? error : new Error(String(error)));
    return {
      success: false,
      eventId: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Extract structured data from hook payload
 */
function extractEventData(payload: PostToolUsePayload): HookEventData {
  const input = payload.input as Record<string, unknown>;
  const output = payload.output as Record<string, unknown> | undefined;

  const data: HookEventData = {
    tool: payload.tool,
  };

  // Extract file path
  if (input.file_path) {
    data.filePath = String(input.file_path);
  } else if (input.path) {
    data.filePath = String(input.path);
  }

  // Determine action
  switch (payload.tool) {
    case 'Edit':
      data.action = 'modify';
      break;
    case 'Write':
      data.action = 'create';
      break;
    case 'Read':
      data.action = 'read';
      break;
    case 'Bash':
      data.action = 'execute';
      data.command = String(input.command || '');
      break;
    case 'Delete':
      data.action = 'delete';
      break;
  }

  // Extract error if present
  if (output?.error) {
    data.error = String(output.error);
  }

  return data;
}

/**
 * Store event in memory and by session
 */
function storeEvent(event: HookEvent): void {
  hookEvents.set(event.id, event);

  // Add to session events
  let events = sessionEvents.get(event.sessionId);
  if (!events) {
    events = [];
    sessionEvents.set(event.sessionId, events);
  }

  // Enforce max events per session
  if (events.length >= MAX_EVENTS_PER_SESSION) {
    events.shift(); // Remove oldest
  }

  events.push(event);
}

/**
 * Get all events for a session
 */
export function getSessionEvents(sessionId: string): HookEvent[] {
  return sessionEvents.get(sessionId) || [];
}

/**
 * Get a specific event by ID
 */
export function getEvent(eventId: string): HookEvent | undefined {
  return hookEvents.get(eventId);
}

/**
 * Get session summary from events
 */
export function getSessionSummary(sessionId: string): {
  eventCount: number;
  filesModified: string[];
  filesCreated: string[];
  toolUseCounts: Record<string, number>;
} {
  const events = getSessionEvents(sessionId);

  const filesModified = new Set<string>();
  const filesCreated = new Set<string>();
  const toolUseCounts: Record<string, number> = {};

  for (const event of events) {
    // Count tool usage
    if (event.data.tool) {
      toolUseCounts[event.data.tool] = (toolUseCounts[event.data.tool] || 0) + 1;
    }

    // Track file changes
    if (event.data.filePath) {
      if (event.data.action === 'create') {
        filesCreated.add(event.data.filePath);
      } else if (event.data.action === 'modify') {
        filesModified.add(event.data.filePath);
      }
    }
  }

  return {
    eventCount: events.length,
    filesModified: [...filesModified],
    filesCreated: [...filesCreated],
    toolUseCounts,
  };
}

/**
 * Clear events for a session (after session ends)
 */
export function clearSessionEvents(sessionId: string): void {
  const events = sessionEvents.get(sessionId);
  if (events) {
    for (const event of events) {
      hookEvents.delete(event.id);
    }
    sessionEvents.delete(sessionId);
  }
}
