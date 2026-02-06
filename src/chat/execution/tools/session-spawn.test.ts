import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentSession,
  AgentSessionManager,
  SessionMessage,
} from '../session-spawn/types.js';
import type { ToolExecutionContext, ToolSession } from '../types.js';

const { mockSessionSpawnDeps } = vi.hoisted(() => ({
  mockSessionSpawnDeps: {
    manager: {
      createRootSession: vi.fn(),
      spawn: vi.fn(),
      send: vi.fn(),
      receive: vi.fn(),
      getUnreadCount: vi.fn(),
      getChildren: vi.fn(),
      getSiblings: vi.fn(),
      getByConversation: vi.fn(),
    },
    getSessionSpawnConfig: vi.fn(() => ({
      enabled: true,
      maxDepth: 3,
      maxChildrenPerSession: 5,
      defaultBudget: 20_000,
      defaultSteps: 20,
      rootMultiplier: 5,
      defaultMessagePriority: 5,
      maxMessagePriority: 10,
      cleanup: {
        enabled: true,
        intervalMs: 3_600_000,
        maxAgeMs: 86_400_000,
      },
    })),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

vi.mock('../session-spawn/manager.js', () => ({
  getAgentSessionManager: () => mockSessionSpawnDeps.manager,
}));

vi.mock('../session-spawn/config.js', () => ({
  getSessionSpawnConfig: mockSessionSpawnDeps.getSessionSpawnConfig,
}));

vi.mock('../../../utils/logger.js', () => ({
  logger: mockSessionSpawnDeps.logger,
}));

import {
  listSessionsTool,
  receiveMessagesTool,
  sendMessageTool,
  spawnSessionTool,
} from './session-spawn.js';

type TestContext = ToolExecutionContext & { sessionId?: string };

function createContext(sessionId?: string): TestContext {
  return {
    toolCallId: 'tool-call-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    workdir: '/tmp',
    env: {},
    securityPolicy: { mode: 'ask' },
    sessionManager: {
      create(session: Omit<ToolSession, 'id' | 'createdAt'>): ToolSession {
        return {
          ...session,
          id: 'session-1',
          createdAt: Date.now(),
        };
      },
      get() {
        return undefined;
      },
      update() {},
      list() {
        return [];
      },
      async kill() {},
      cleanup() {},
    },
    sessionId,
  };
}

function buildSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'session-1',
    parentSessionId: 'root-1',
    conversationId: 'conv-1',
    name: 'Analyzer',
    description: 'Analyzes routes',
    goal: 'Find issues',
    status: 'running',
    depth: 1,
    currentStep: 2,
    maxSteps: 20,
    usedBudget: 250,
    maxBudget: 20_000,
    createdAt: new Date('2026-03-12T00:00:00Z'),
    updatedAt: new Date('2026-03-12T00:05:00Z'),
    ...overrides,
  };
}

function buildMessage(overrides: Partial<SessionMessage> = {}): SessionMessage {
  return {
    id: 'message-1',
    fromSessionId: 'child-1',
    toSessionId: 'root-1',
    type: 'result',
    subject: 'Done',
    content: { summary: 'Finished analysis' },
    priority: 8,
    status: 'delivered',
    createdAt: new Date('2026-03-12T00:10:00Z'),
    ...overrides,
  };
}

describe('session spawn tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockSessionSpawnDeps.manager.createRootSession.mockResolvedValue(
      buildSession({
        id: 'root-1',
        parentSessionId: null,
        depth: 0,
        status: 'running',
        name: 'Root Session',
      }),
    );
    mockSessionSpawnDeps.manager.spawn.mockResolvedValue(
      buildSession({
        id: 'child-1',
        name: 'Route Analyzer',
        depth: 1,
      }),
    );
    mockSessionSpawnDeps.manager.send.mockResolvedValue([
      buildMessage({ id: 'message-1', toSessionId: 'parent-1', type: 'result' }),
    ]);
    mockSessionSpawnDeps.manager.receive.mockResolvedValue([buildMessage()]);
    mockSessionSpawnDeps.manager.getUnreadCount.mockResolvedValue(2);
    mockSessionSpawnDeps.manager.getChildren.mockResolvedValue([
      buildSession({ id: 'running-1', name: 'Runner', status: 'running' }),
      buildSession({
        id: 'done-1',
        name: 'Completed Child',
        status: 'completed',
        completedAt: new Date('2026-03-12T00:20:00Z'),
        stopReason: 'completed',
      }),
      buildSession({
        id: 'failed-1',
        name: 'Failed Child',
        status: 'failed',
        completedAt: new Date('2026-03-12T00:25:00Z'),
        stopReason: 'error',
      }),
    ]);
    mockSessionSpawnDeps.manager.getSiblings.mockResolvedValue([]);
    mockSessionSpawnDeps.manager.getByConversation.mockResolvedValue([]);
  });

  it('creates a root session when spawn_session runs without an active session', async () => {
    const context = createContext();

    const result = await spawnSessionTool.execute(context, {
      name: 'Route Analyzer',
      goal: 'Audit route handlers for user-facing failures',
      maxSteps: 15,
      maxBudget: 30_000,
      allowedTools: ['read_file'],
    });

    expect(result.success).toBe(true);
    expect(mockSessionSpawnDeps.manager.createRootSession).toHaveBeenCalledWith(
      'conv-1',
      'Root Session',
      'Main conversation session',
    );
    expect(mockSessionSpawnDeps.manager.spawn).toHaveBeenCalledWith({
      parentSessionId: 'root-1',
      name: 'Route Analyzer',
      goal: 'Audit route handlers for user-facing failures',
      description: undefined,
      maxSteps: 15,
      maxBudget: 30_000,
      allowedTools: ['read_file'],
      disallowedTools: undefined,
    });
    expect(context.sessionId).toBe('root-1');
    expect(result.data).toMatchObject({
      sessionId: 'child-1',
      name: 'Route Analyzer',
      depth: 1,
    });
  });

  it('returns NO_SESSION when send_message is used without an active session', async () => {
    const result = await sendMessageTool.execute(createContext(), {
      target: 'parent',
      type: 'message',
      content: { text: 'hello' },
      priority: 5,
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NO_SESSION');
    expect(mockSessionSpawnDeps.manager.send).not.toHaveBeenCalled();
  });

  it('formats received messages and reports remaining unread count', async () => {
    const result = await receiveMessagesTool.execute(createContext('root-1'), {
      types: ['result'],
      markAsRead: true,
      limit: 10,
    });

    expect(result.success).toBe(true);
    expect(mockSessionSpawnDeps.manager.receive).toHaveBeenCalledWith({
      sessionId: 'root-1',
      types: ['result'],
      fromSessionId: undefined,
      minPriority: undefined,
      markAsRead: true,
      limit: 10,
    });
    expect(result.data).toMatchObject({
      unreadCount: 2,
      messages: [
        expect.objectContaining({
          id: 'message-1',
          type: 'result',
          createdAt: '2026-03-12T00:10:00.000Z',
        }),
      ],
    });
    expect(result.output).toContain('Received 1 message(s). 2 unread remaining.');
  });

  it('filters completed and failed sessions when includeCompleted is false', async () => {
    const result = await listSessionsTool.execute(createContext('root-1'), {
      scope: 'children',
      includeCompleted: false,
    });

    expect(result.success).toBe(true);
    expect(mockSessionSpawnDeps.manager.getChildren).toHaveBeenCalledWith('root-1');
    expect(result.data?.sessions).toHaveLength(1);
    expect(result.data?.sessions[0]).toMatchObject({
      id: 'running-1',
      name: 'Runner',
      status: 'running',
    });
    expect(result.data?.summary).toEqual({
      total: 1,
      running: 1,
      completed: 0,
      failed: 0,
    });
  });

  it('surfaces spawn failures as SPAWN_FAILED errors', async () => {
    mockSessionSpawnDeps.manager.spawn.mockRejectedValueOnce(
      new Error('Max spawn depth exceeded'),
    );

    const result = await spawnSessionTool.execute(createContext('root-1'), {
      name: 'Too Deep',
      goal: 'Try one level too far',
      maxSteps: 5,
      maxBudget: 5_000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: 'SPAWN_FAILED',
      message: 'Max spawn depth exceeded',
      retryable: false,
    });
  });
});
