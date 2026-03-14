/**
 * Session End (Stop) Hook Handler
 *
 * Processes Stop events from Claude Code hooks when a session ends.
 * Aggregates session data and creates a task record.
 */

import { randomUUID } from 'crypto';
import type { Context } from 'hono';
import { SessionEndPayloadSchema } from './schemas.js';
import type { HookProcessingResult, SessionAggregate } from './types.js';
import { getSessionEvents, clearSessionEvents, getSessionSummary } from './tool-use.js';
import { aggregateInferences } from '../intelligence/rules.js';
import { createContextualLogger } from '../utils/logger.js';

const log = createContextualLogger('SessionEnd');

// Session aggregates storage
const sessionAggregates = new Map<string, SessionAggregate>();

/**
 * Handle Stop (session end) webhook from Claude Code
 */
export async function handleSessionEnd(c: Context): Promise<HookProcessingResult> {
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

    const parsed = SessionEndPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      log.error('Session end validation failed', new Error(parsed.error.message));
      return {
        success: false,
        eventId: '',
        error: `Validation failed: ${parsed.error.message}`,
      };
    }

    const hookPayload = parsed.data;
    const sessionId = hookPayload.session_id || 'unknown';

    // Get all events for this session
    const events = getSessionEvents(sessionId);
    const summary = getSessionSummary(sessionId);

    // Aggregate inferences from all events
    const inferences = events
      .map(e => e.inference)
      .filter((inf): inf is NonNullable<typeof inf> => inf !== undefined);
    const aggregatedInference = aggregateInferences(inferences);

    // Create session aggregate
    const aggregate: SessionAggregate = {
      sessionId,
      startTime: events.length > 0 ? events[0].timestamp : new Date(),
      endTime: hookPayload.timestamp ? new Date(hookPayload.timestamp) : new Date(),
      status: mapReasonToStatus(hookPayload.reason),
      filesModified: summary.filesModified,
      filesCreated: summary.filesCreated,
      filesRead: [], // TODO: Track reads separately
      commandsExecuted: events
        .filter(e => e.data.tool === 'Bash' && e.data.command)
        .map(e => e.data.command!)
        .slice(-20), // Keep last 20 commands
      toolUseCounts: summary.toolUseCounts,
      inferences,
      summary: hookPayload.summary || generateSummary(summary, aggregatedInference),
    };

    // Store aggregate
    sessionAggregates.set(sessionId, aggregate);

    // Log session summary
    log.info('Session ended', {
      sessionId,
      filesModified: aggregate.filesModified.length,
      filesCreated: aggregate.filesCreated.length,
      totalToolUses: Object.values(summary.toolUseCounts).reduce((a, b) => a + b, 0),
    });

    // Clear in-memory events (we have the aggregate now)
    clearSessionEvents(sessionId);

    return {
      success: true,
      eventId: randomUUID(),
      inference: aggregatedInference.confidence > 0 ? aggregatedInference : undefined,
    };
  } catch (error) {
    log.error('Error processing session end', error instanceof Error ? error : new Error(String(error)));
    return {
      success: false,
      eventId: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Map session end reason to status
 */
function mapReasonToStatus(reason?: string): SessionAggregate['status'] {
  switch (reason) {
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'error':
    case 'timeout':
      return 'error';
    default:
      return 'completed';
  }
}

/**
 * Generate a summary from session data
 */
function generateSummary(
  summary: ReturnType<typeof getSessionSummary>,
  inference: ReturnType<typeof aggregateInferences>
): string {
  const parts: string[] = [];

  if (summary.filesCreated.length > 0) {
    parts.push(`Created ${summary.filesCreated.length} file(s)`);
  }

  if (summary.filesModified.length > 0) {
    parts.push(`Modified ${summary.filesModified.length} file(s)`);
  }

  if (inference.taskType) {
    parts.push(`Task type: ${inference.taskType}`);
  }

  if (inference.component) {
    parts.push(`Component: ${inference.component}`);
  }

  if (inference.linkedIssue) {
    parts.push(`Related to #${inference.linkedIssue}`);
  }

  if (inference.commitMessage) {
    parts.push(`Commit: "${inference.commitMessage}"`);
  }

  return parts.join('. ') || 'Session completed';
}

/**
 * Get a session aggregate by ID
 */
export function getSessionAggregate(sessionId: string): SessionAggregate | undefined {
  return sessionAggregates.get(sessionId);
}

/**
 * Get all session aggregates
 */
export function getAllSessionAggregates(): SessionAggregate[] {
  return [...sessionAggregates.values()];
}

/**
 * Get recent session aggregates
 */
export function getRecentSessions(limit = 50): SessionAggregate[] {
  const aggregates = [...sessionAggregates.values()];
  return aggregates
    .sort((a, b) => (b.endTime?.getTime() || 0) - (a.endTime?.getTime() || 0))
    .slice(0, limit);
}
