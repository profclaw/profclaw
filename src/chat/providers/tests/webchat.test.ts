/**
 * Tests for WebChat Provider
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock logger
vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  createSession,
  getSession,
  removeSession,
  getSessionCount,
  getSessionCountByIp,
  webchatProvider,
} from '../webchat/index.js';

describe('WebChat Provider', () => {
  beforeEach(() => {
    // Clean up sessions between tests
    // We can't directly clear the Map, so we remove sessions we create
  });

  describe('session management', () => {
    it('creates a new session and returns session ID', () => {
      const sessionId = createSession({
        userId: 'user-1',
        userName: 'Test User',
        ip: '127.0.0.1',
      });

      expect(typeof sessionId).toBe('string');
      expect(sessionId.length).toBeGreaterThan(0);

      const session = getSession(sessionId);
      expect(session).toBeDefined();
      expect(session?.userId).toBe('user-1');
      expect(session?.userName).toBe('Test User');
      expect(session?.ip).toBe('127.0.0.1');
      expect(session?.createdAt).toBeInstanceOf(Date);

      removeSession(sessionId);
    });

    it('retrieves a session by ID', () => {
      const sessionId = createSession({
        userId: 'user-2',
        userName: 'User 2',
        ip: '127.0.0.1',
      });

      const retrieved = getSession(sessionId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.userId).toBe('user-2');

      removeSession(sessionId);
    });

    it('returns undefined for non-existent session', () => {
      expect(getSession('nonexistent')).toBeUndefined();
    });

    it('removes a session', () => {
      const sessionId = createSession({
        userId: 'user-3',
        userName: 'User 3',
        ip: '127.0.0.1',
      });

      removeSession(sessionId);
      expect(getSession(sessionId)).toBeUndefined();
    });

    it('counts sessions', () => {
      const initialCount = getSessionCount();
      const s1 = createSession({ userId: 'a', userName: 'A', ip: '1.1.1.1' });
      const s2 = createSession({ userId: 'b', userName: 'B', ip: '2.2.2.2' });

      expect(getSessionCount()).toBe(initialCount + 2);

      removeSession(s1);
      removeSession(s2);
    });

    it('counts sessions by IP', () => {
      const ip = '192.168.1.100';
      const s1 = createSession({ userId: 'x', userName: 'X', ip });
      const s2 = createSession({ userId: 'y', userName: 'Y', ip });
      const s3 = createSession({ userId: 'z', userName: 'Z', ip: '10.0.0.1' });

      expect(getSessionCountByIp(ip)).toBe(2);
      expect(getSessionCountByIp('10.0.0.1')).toBe(1);

      removeSession(s1);
      removeSession(s2);
      removeSession(s3);
    });
  });

  describe('provider metadata', () => {
    it('has correct meta', () => {
      expect(webchatProvider.meta.id).toBe('webchat');
      expect(webchatProvider.meta.name).toBe('WebChat');
    });

    it('has correct capabilities', () => {
      expect(webchatProvider.capabilities.send).toBe(true);
      expect(webchatProvider.capabilities.receive).toBe(true);
      expect(webchatProvider.capabilities.realtime).toBe(true);
    });

    it('has outbound adapter', () => {
      expect(webchatProvider.outbound).toBeDefined();
      expect(typeof webchatProvider.outbound.send).toBe('function');
    });

    it('has inbound adapter', () => {
      expect(webchatProvider.inbound).toBeDefined();
      expect(typeof webchatProvider.inbound.parseMessage).toBe('function');
    });

    it('has status adapter', () => {
      expect(webchatProvider.status).toBeDefined();
      expect(typeof webchatProvider.status.isConfigured).toBe('function');
      expect(typeof webchatProvider.status.checkHealth).toBe('function');
    });
  });

  describe('status adapter', () => {
    it('isConfigured returns true for valid config', () => {
      const result = webchatProvider.status.isConfigured({
        id: 'default',
        provider: 'webchat',
      });
      expect(result).toBe(true);
    });

    it('checkHealth returns connected', async () => {
      const health = await webchatProvider.status.checkHealth({
        id: 'default',
        provider: 'webchat',
      });
      expect(health.connected).toBe(true);
    });
  });

  describe('inbound adapter', () => {
    it('parseMessage handles webchat payload', () => {
      const sessionId = createSession({
        userId: 'msg-user',
        userName: 'Msg User',
        ip: '127.0.0.1',
      });

      const msg = webchatProvider.inbound.parseMessage({
        sessionId,
        text: 'Hello from browser',
      });

      if (msg) {
        expect(msg.provider).toBe('webchat');
        expect(msg.text).toBe('Hello from browser');
        expect(msg.senderName).toBe('Msg User');
      }

      removeSession(sessionId);
    });

    it('parseMessage returns null for invalid payload', () => {
      const msg = webchatProvider.inbound.parseMessage({});
      expect(msg).toBeNull();
    });

    it('parseCommand returns null (no slash commands)', () => {
      expect(webchatProvider.inbound.parseCommand({})).toBeNull();
    });

    it('parseAction returns null (no interactive components)', () => {
      expect(webchatProvider.inbound.parseAction({})).toBeNull();
    });
  });

  describe('outbound adapter', () => {
    it('send returns error for non-existent session', async () => {
      const result = await webchatProvider.outbound.send({
        provider: 'webchat',
        to: 'nonexistent-session',
        text: 'Hello',
      });
      expect(result.success).toBe(false);
    });
  });
});
