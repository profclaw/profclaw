/**
 * Agent Session Manager Implementation
 *
 * Database-backed manager for spawning and managing agent sessions.
 * Supports hierarchical session trees and inter-session messaging.
 */

import { randomUUID } from 'crypto';
import { eq, and, lt, inArray, desc, isNull, sql } from 'drizzle-orm';
import { getDb } from '../../../storage/index.js';
import { agentSessions, sessionMessages } from '../../../storage/schema.js';
import { logger } from '../../../utils/logger.js';
import { getSessionSpawnConfig, getRootSessionLimits } from './config.js';
import type {
  AgentSession,
  AgentSessionManager,
  CleanupParams,
  CompleteSessionParams,
  MessageStatus,
  MessageType,
  ReceiveMessagesParams,
  SendMessageParams,
  SessionMessage,
  SessionStatus,
  SessionStopReason,
  SpawnSessionParams,
  UpdateSessionParams,
} from './types.js';

// Manager Implementation

export class AgentSessionManagerImpl implements AgentSessionManager {
  // Session Lifecycle

  async spawn(params: SpawnSessionParams): Promise<AgentSession> {
    const db = getDb();
    const config = getSessionSpawnConfig();

    // Get parent session to validate depth
    const parent = await this.get(params.parentSessionId);
    if (!parent) {
      throw new Error(`Parent session not found: ${params.parentSessionId}`);
    }

    // Validate spawn depth
    const newDepth = parent.depth + 1;
    if (newDepth > config.maxDepth) {
      throw new Error(
        `Cannot spawn session: max depth ${config.maxDepth} exceeded (current depth: ${parent.depth})`
      );
    }

    // Check max children
    const existingChildren = await this.getChildren(params.parentSessionId);
    if (existingChildren.length >= config.maxChildrenPerSession) {
      throw new Error(
        `Cannot spawn session: max children ${config.maxChildrenPerSession} reached`
      );
    }

    const id = randomUUID();
    const now = new Date();

    const sessionData = {
      id,
      parentSessionId: params.parentSessionId,
      conversationId: parent.conversationId,
      name: params.name,
      description: params.description ?? null,
      goal: params.goal ?? null,
      status: 'pending' as const,
      depth: newDepth,
      currentStep: 0,
      maxSteps: params.maxSteps ?? config.defaultSteps,
      usedBudget: 0,
      maxBudget: params.maxBudget ?? config.defaultBudget,
      allowedTools: params.allowedTools ?? null,
      disallowedTools: params.disallowedTools ?? null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      updatedAt: now,
      finalResult: null,
      stopReason: null,
      metadata: params.metadata ?? {},
    };

    await db.insert(agentSessions).values(sessionData);

    logger.info(`[SessionSpawn] Created child session: ${id}`, {
      parentId: params.parentSessionId,
      name: params.name,
      depth: newDepth,
    });

    return this.mapToAgentSession(sessionData);
  }

  async get(sessionId: string): Promise<AgentSession | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .limit(1);

    return rows[0] ? this.mapToAgentSession(rows[0]) : null;
  }

  async update(
    sessionId: string,
    params: UpdateSessionParams
  ): Promise<AgentSession | null> {
    const db = getDb();

    const updates: Partial<typeof agentSessions.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (params.currentStep !== undefined) updates.currentStep = params.currentStep;
    if (params.usedBudget !== undefined) updates.usedBudget = params.usedBudget;
    if (params.status !== undefined) updates.status = params.status;
    if (params.metadata !== undefined) updates.metadata = params.metadata;

    await db
      .update(agentSessions)
      .set(updates)
      .where(eq(agentSessions.id, sessionId));

    return this.get(sessionId);
  }

  async complete(
    sessionId: string,
    params: CompleteSessionParams
  ): Promise<AgentSession | null> {
    const db = getDb();
    const now = new Date();

    await db
      .update(agentSessions)
      .set({
        status: 'completed',
        finalResult: params.finalResult,
        stopReason: params.stopReason,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(agentSessions.id, sessionId));

    logger.info(`[SessionSpawn] Session completed: ${sessionId}`, {
      stopReason: params.stopReason,
    });

    return this.get(sessionId);
  }

  async cancel(sessionId: string, reason?: string): Promise<AgentSession | null> {
    const db = getDb();
    const now = new Date();

    await db
      .update(agentSessions)
      .set({
        status: 'cancelled',
        stopReason: 'cancelled',
        completedAt: now,
        updatedAt: now,
        metadata: reason ? { cancelReason: reason } : undefined,
      })
      .where(eq(agentSessions.id, sessionId));

    logger.info(`[SessionSpawn] Session cancelled: ${sessionId}`, { reason });

    return this.get(sessionId);
  }

  // Hierarchy Queries

  async getChildren(sessionId: string): Promise<AgentSession[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.parentSessionId, sessionId))
      .orderBy(agentSessions.createdAt);

    return rows.map((r: typeof agentSessions.$inferSelect) => this.mapToAgentSession(r));
  }

  async getSiblings(sessionId: string): Promise<AgentSession[]> {
    const session = await this.get(sessionId);
    if (!session || !session.parentSessionId) {
      return [];
    }

    const db = getDb();
    const rows = await db
      .select()
      .from(agentSessions)
      .where(
        and(
          eq(agentSessions.parentSessionId, session.parentSessionId),
          sql`${agentSessions.id} != ${sessionId}`
        )
      )
      .orderBy(agentSessions.createdAt);

    return rows.map((r: typeof agentSessions.$inferSelect) => this.mapToAgentSession(r));
  }

  async getParent(sessionId: string): Promise<AgentSession | null> {
    const session = await this.get(sessionId);
    if (!session || !session.parentSessionId) {
      return null;
    }

    return this.get(session.parentSessionId);
  }

  async getByConversation(conversationId: string): Promise<AgentSession[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.conversationId, conversationId))
      .orderBy(agentSessions.createdAt);

    return rows.map((r: typeof agentSessions.$inferSelect) => this.mapToAgentSession(r));
  }

  // Messaging

  async send(params: SendMessageParams): Promise<SessionMessage[]> {
    const db = getDb();
    const config = getSessionSpawnConfig();
    const sentMessages: SessionMessage[] = [];

    // Resolve target session IDs
    const targetIds = await this.resolveTargetSessionIds(
      params.fromSessionId,
      params.target
    );

    if (targetIds.length === 0) {
      logger.warn(`[SessionSpawn] No targets found for message`, {
        fromSessionId: params.fromSessionId,
        target: params.target,
      });
      return [];
    }

    const now = new Date();
    const expiresAt = params.ttlMs ? new Date(now.getTime() + params.ttlMs) : null;

    for (const toSessionId of targetIds) {
      const id = randomUUID();

      const messageData = {
        id,
        fromSessionId: params.fromSessionId,
        toSessionId,
        type: params.type,
        subject: params.subject ?? null,
        content: params.content,
        priority: params.priority ?? config.defaultMessagePriority,
        status: 'pending' as const,
        replyToMessageId: params.replyToMessageId ?? null,
        expiresAt,
        createdAt: now,
        deliveredAt: null,
        readAt: null,
      };

      await db.insert(sessionMessages).values(messageData);
      sentMessages.push(this.mapToSessionMessage(messageData));
    }

    logger.debug(`[SessionSpawn] Sent ${sentMessages.length} messages`, {
      fromSessionId: params.fromSessionId,
      target: params.target,
      type: params.type,
    });

    return sentMessages;
  }

  async receive(params: ReceiveMessagesParams): Promise<SessionMessage[]> {
    const db = getDb();
    const now = new Date();

    // Build query conditions
    const conditions = [
      eq(sessionMessages.toSessionId, params.sessionId),
      // Exclude expired messages
      sql`(${sessionMessages.expiresAt} IS NULL OR ${sessionMessages.expiresAt} > ${now})`,
    ];

    if (params.types?.length) {
      conditions.push(inArray(sessionMessages.type, params.types));
    }

    if (params.fromSessionId) {
      conditions.push(eq(sessionMessages.fromSessionId, params.fromSessionId));
    }

    if (params.minPriority) {
      conditions.push(sql`${sessionMessages.priority} >= ${params.minPriority}`);
    }

    // By default, get unread messages
    if (!params.markAsRead) {
      conditions.push(isNull(sessionMessages.readAt));
    }

    const rows = await db
      .select()
      .from(sessionMessages)
      .where(and(...conditions))
      .orderBy(desc(sessionMessages.priority), sessionMessages.createdAt)
      .limit(params.limit ?? 50);

    // Mark as read if requested
    if (params.markAsRead && rows.length > 0) {
      const messageIds = rows.map((r: typeof sessionMessages.$inferSelect) => r.id);
      await db
        .update(sessionMessages)
        .set({
          status: 'read',
          readAt: now,
          deliveredAt: sql`COALESCE(${sessionMessages.deliveredAt}, ${now})`,
        })
        .where(inArray(sessionMessages.id, messageIds));
    }

    return rows.map((r: typeof sessionMessages.$inferSelect) => this.mapToSessionMessage(r));
  }

  async getUnreadCount(sessionId: string): Promise<number> {
    const db = getDb();
    const now = new Date();

    const result = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(sessionMessages)
      .where(
        and(
          eq(sessionMessages.toSessionId, sessionId),
          isNull(sessionMessages.readAt),
          sql`(${sessionMessages.expiresAt} IS NULL OR ${sessionMessages.expiresAt} > ${now})`
        )
      );

    return result[0]?.count ?? 0;
  }

  // Cleanup

  async cleanup(
    params: CleanupParams
  ): Promise<{ sessionsDeleted: number; messagesDeleted: number }> {
    const db = getDb();
    const cutoff = new Date(Date.now() - params.olderThanMs);

    // Delete old completed/failed/cancelled sessions
    const sessionsResult = await db
      .delete(agentSessions)
      .where(
        and(
          inArray(agentSessions.status, ['completed', 'failed', 'cancelled']),
          lt(agentSessions.completedAt, cutoff)
        )
      )
      .returning({ id: agentSessions.id });

    // Delete expired messages
    const now = new Date();
    const messagesResult = await db
      .delete(sessionMessages)
      .where(
        and(
          sql`${sessionMessages.expiresAt} IS NOT NULL`,
          lt(sessionMessages.expiresAt, now)
        )
      )
      .returning({ id: sessionMessages.id });

    const sessionsDeleted = sessionsResult.length;
    const messagesDeleted = messagesResult.length;

    if (sessionsDeleted > 0 || messagesDeleted > 0) {
      logger.info(`[SessionSpawn] Cleanup complete`, {
        sessionsDeleted,
        messagesDeleted,
      });
    }

    return { sessionsDeleted, messagesDeleted };
  }

  // Helper: Create Root Session

  /**
   * Create a root session for a conversation.
   * This is called when starting a new agentic conversation.
   */
  async createRootSession(
    conversationId: string,
    name: string,
    goal?: string
  ): Promise<AgentSession> {
    const db = getDb();
    const rootLimits = getRootSessionLimits();
    const id = randomUUID();
    const now = new Date();

    const sessionData = {
      id,
      parentSessionId: null,
      conversationId,
      name,
      description: null,
      goal: goal ?? null,
      status: 'running' as const,
      depth: 0,
      currentStep: 0,
      maxSteps: rootLimits.maxSteps,
      usedBudget: 0,
      maxBudget: rootLimits.maxBudget,
      createdAt: now,
      startedAt: now,
      completedAt: null,
      updatedAt: now,
      finalResult: null,
      stopReason: null,
      allowedTools: null,
      disallowedTools: null,
      metadata: {},
    };

    await db.insert(agentSessions).values(sessionData);

    logger.info(`[SessionSpawn] Created root session: ${id}`, {
      conversationId,
      name,
    });

    return this.mapToAgentSession(sessionData);
  }

  // Private Helpers

  private async resolveTargetSessionIds(
    fromSessionId: string,
    target: 'parent' | 'children' | 'siblings' | string
  ): Promise<string[]> {
    switch (target) {
      case 'parent': {
        const parent = await this.getParent(fromSessionId);
        return parent ? [parent.id] : [];
      }
      case 'children': {
        const children = await this.getChildren(fromSessionId);
        return children.map((c) => c.id);
      }
      case 'siblings': {
        const siblings = await this.getSiblings(fromSessionId);
        return siblings.map((s) => s.id);
      }
      default:
        // Specific session ID
        return [target];
    }
  }

  private mapToAgentSession(row: typeof agentSessions.$inferSelect): AgentSession {
    return {
      id: row.id,
      parentSessionId: row.parentSessionId,
      conversationId: row.conversationId,
      name: row.name,
      description: row.description ?? undefined,
      goal: row.goal ?? undefined,
      status: row.status as SessionStatus,
      depth: row.depth,
      currentStep: row.currentStep,
      maxSteps: row.maxSteps,
      usedBudget: row.usedBudget,
      maxBudget: row.maxBudget,
      finalResult: row.finalResult ?? undefined,
      stopReason: (row.stopReason as SessionStopReason | null) ?? undefined,
      allowedTools: row.allowedTools ?? undefined,
      disallowedTools: row.disallowedTools ?? undefined,
      createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
      startedAt: row.startedAt
        ? row.startedAt instanceof Date
          ? row.startedAt
          : new Date(row.startedAt)
        : undefined,
      completedAt: row.completedAt
        ? row.completedAt instanceof Date
          ? row.completedAt
          : new Date(row.completedAt)
        : undefined,
      updatedAt:
        row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt),
      metadata: row.metadata ?? undefined,
    };
  }

  private mapToSessionMessage(row: typeof sessionMessages.$inferSelect): SessionMessage {
    return {
      id: row.id,
      fromSessionId: row.fromSessionId,
      toSessionId: row.toSessionId,
      type: row.type as MessageType,
      subject: row.subject ?? undefined,
      content: row.content,
      priority: row.priority,
      status: row.status as MessageStatus,
      replyToMessageId: row.replyToMessageId ?? undefined,
      expiresAt: row.expiresAt
        ? row.expiresAt instanceof Date
          ? row.expiresAt
          : new Date(row.expiresAt)
        : undefined,
      createdAt:
        row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
      deliveredAt: row.deliveredAt
        ? row.deliveredAt instanceof Date
          ? row.deliveredAt
          : new Date(row.deliveredAt)
        : undefined,
      readAt: row.readAt
        ? row.readAt instanceof Date
          ? row.readAt
          : new Date(row.readAt)
        : undefined,
    };
  }
}

// Singleton

let managerInstance: AgentSessionManagerImpl | null = null;

export function getAgentSessionManager(): AgentSessionManagerImpl {
  if (!managerInstance) {
    managerInstance = new AgentSessionManagerImpl();
  }
  return managerInstance;
}
