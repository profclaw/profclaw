import { describe, it, expect, beforeAll, vi } from 'vitest';

// Set environment variables before importing app
process.env.NODE_ENV = 'test';
process.env.STORAGE_TIER = 'memory';
process.env.ENABLE_CRON = 'false';

import { app } from '../server.js';
import { initStorage } from '../storage/index.js';

describe('E2E: Ticket Lifecycle', () => {
  let sessionToken: string;
  let projectId: string;
  let ticketId: string;

  beforeAll(async () => {
    await initStorage();
    
    // 1. Create admin to get a session
    const payload = {
      email: 'ticket-admin@example.com',
      password: 'StrongPassword123!',
      name: 'Ticket Admin'
    };

    const res = await app.request('/api/setup/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    sessionToken = data.session.token;
  });

  it('should create a new project', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Cookie': `glinr_session=${sessionToken}`
      },
      body: JSON.stringify({ 
        name: 'Test Project',
        description: 'A project for E2E testing',
        key: 'TEST'
      })
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    projectId = data.id || data.project.id;
    expect(projectId).toBeDefined();
  });

  it('should create a ticket for the project', async () => {
    const res = await app.request('/api/tickets', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Cookie': `glinr_session=${sessionToken}`
      },
      body: JSON.stringify({ 
        projectId,
        title: 'Fix issue in E2E test',
        description: 'The test needs to be stable',
        type: 'bug',
        status: 'todo',
        priority: 'high'
      })
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    ticketId = data.ticket.id;
    expect(ticketId).toBeDefined();
    expect(data.ticket.title).toBe('Fix issue in E2E test');
  });

  it('should update ticket status', async () => {
    const res = await app.request(`/api/tickets/${ticketId}`, {
      method: 'PATCH',
      headers: { 
        'Content-Type': 'application/json',
        'Cookie': `glinr_session=${sessionToken}`
      },
      body: JSON.stringify({ status: 'done' })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ticket.status).toBe('done');
  });

  it('should add a comment to the ticket', async () => {
    const res = await app.request(`/api/tickets/${ticketId}/comments`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Cookie': `glinr_session=${sessionToken}`
      },
      body: JSON.stringify({ 
        content: 'Verified and closed.'
      })
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.comment.content).toBe('Verified and closed.');
  });

  it('should list tickets in the project', async () => {
    const res = await app.request(`/api/tickets?projectId=${projectId}`, {
      method: 'GET',
      headers: { 
        'Cookie': `glinr_session=${sessionToken}`
      }
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tickets).toHaveLength(1);
    expect(data.tickets[0].id).toBe(ticketId);
  });
});
