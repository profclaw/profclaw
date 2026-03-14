import { describe, it, expect, beforeAll, vi } from 'vitest';

// Set environment variables before importing app
process.env.NODE_ENV = 'test';
process.env.STORAGE_TIER = 'memory';
process.env.ENABLE_CRON = 'false';

import { app } from '../server.js';
import { initStorage } from '../storage/index.js';
import { aiProvider } from '../providers/index.js';

describe('E2E: Chat Flow', () => {
  let sessionToken: string;

  beforeAll(async () => {
    await initStorage();
    
    // Initialize conversation tables
    const { initConversationTables } = await import('../chat/conversations.js');
    await initConversationTables();
    
    // 1. Create admin to get a session
    const payload = {
      email: 'chat-admin@example.com',
      password: 'StrongPassword123!',
      name: 'Chat Admin'
    };

    const res = await app.request('/api/setup/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    sessionToken = data.session.token;
  });

  it('should create a new conversation', async () => {
    const res = await app.request('/api/chat/conversations', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Cookie': `profclaw_session=${sessionToken}`
      },
      body: JSON.stringify({ title: 'Test Conversation' })
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.conversation.id).toBeDefined();
    expect(data.conversation.title).toBe('Test Conversation');
  });

  it('should send a message and get a streaming response', async () => {
    // Mock AI provider stream
    vi.spyOn(aiProvider, 'chatStream').mockImplementation(async (req, onChunk) => {
      onChunk('Hello');
      onChunk(' world!');
      return {
        id: 'res-1',
        provider: 'ollama',
        model: 'llama3.2',
        content: 'Hello world!',
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3, cost: 0 },
        duration: 10
      };
    });

    const res = await app.request('/api/chat/completions', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Cookie': `profclaw_session=${sessionToken}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true
      })
    });

    expect(res.status).toBe(200);
    // Hono's streamText defaults to text/plain
    expect(res.headers.get('Content-Type')).toMatch(/text\/plain|text\/event-stream/);
    
    const body = await res.text();
    expect(body).toContain('data: {"content":"Hello"}');
    expect(body).toContain('data: {"content":" world!"}');
    expect(body).toContain('"done":true');
  });
});
