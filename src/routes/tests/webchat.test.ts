import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const { mockWebchat, mockRegistry } = vi.hoisted(() => ({
  mockWebchat: {
    createSession: vi.fn(() => 'session-123'),
    getSession: vi.fn(),
    attachSSE: vi.fn(),
    sendToSession: vi.fn(() => true),
    removeSession: vi.fn(),
    getSessionCount: vi.fn(() => 1),
    getSessionCountByIp: vi.fn(() => 0),
  },
  mockRegistry: {
    get: vi.fn(),
    emit: vi.fn(),
  },
}));

vi.mock('../../chat/providers/webchat/index.js', () => mockWebchat);
vi.mock('../../chat/providers/registry.js', () => ({
  getChatRegistry: vi.fn(() => mockRegistry),
}));
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { webchatRoutes } from '../webchat.js';
import { logger } from '../../utils/logger.js';

function buildApp(): Hono {
  const app = new Hono();
  app.route('/api/chat/webchat', webchatRoutes);
  return app;
}

describe('webchatRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWebchat.getSession.mockReturnValue({
      id: 'session-123',
      userId: 'user-123',
      userName: 'Test User',
    });
    mockRegistry.get.mockReturnValue({
      inbound: {
        parseMessage: vi.fn(() => ({
          id: 'msg-123',
          provider: 'webchat',
          accountId: 'default',
          senderId: 'user-123',
          senderName: 'Test User',
          chatType: 'direct',
          chatId: 'session-123',
          text: 'hello',
          timestamp: new Date('2026-03-11T00:00:00Z'),
        })),
      },
    });
    mockRegistry.emit.mockResolvedValue(undefined);
  });

  it('returns 400 for malformed JSON on POST /', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/chat/webchat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"sessionId":"session-123","text":"hello"',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 when the request body is not a JSON object', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/chat/webchat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(['session-123', 'hello']),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Request body must be a JSON object',
    });
  });

  it('returns 500 when the chat engine emit step fails', async () => {
    const app = buildApp();
    mockRegistry.emit.mockRejectedValue(new Error('engine offline'));

    const response = await app.fetch(new Request('http://localhost/api/chat/webchat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-123', text: 'hello' }),
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to process message' });
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
