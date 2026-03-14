import { describe, it, expect, beforeAll } from 'vitest';

// Set environment variables before importing app
process.env.NODE_ENV = 'test';
process.env.STORAGE_TIER = 'memory';
process.env.ENABLE_CRON = 'false';

import { app } from '../server.js';
import { initStorage } from '../storage/index.js';

describe('E2E: Authentication', () => {
  const credentials = {
    email: 'auth-test@example.com',
    password: 'StrongPassword123!',
    name: 'Auth Test User'
  };

  beforeAll(async () => {
    await initStorage();
    // Create the user initially via setup/admin (which is open if no users exist)
    await app.request('/api/setup/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    });
  });

  it('should login successfully', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: credentials.email,
        password: credentials.password
      })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user.email).toBe(credentials.email);
    
    // Check cookie
    const cookie = res.headers.get('Set-Cookie');
    expect(cookie).toContain('profclaw_session');
  });

  it('should fail login with wrong password', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: credentials.email,
        password: 'wrongpassword'
      })
    });

    expect(res.status).toBe(401);
  });

  it('should get current user profile', async () => {
    // First login to get cookie
    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    });
    const cookieHeader = loginRes.headers.get('Set-Cookie') || '';
    // Manual cookie parsing for the test
    const sessionToken = cookieHeader.split(';')[0].split('=')[1];

    const res = await app.request('/api/auth/me', {
      method: 'GET',
      headers: { 
        'Cookie': `profclaw_session=${sessionToken}`
      }
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.authenticated).toBe(true);
    expect(data.user.email).toBe(credentials.email);
  });

  it('should logout correctly', async () => {
     // login
     const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    });
    const cookieHeader = loginRes.headers.get('Set-Cookie') || '';
    const sessionToken = cookieHeader.split(';')[0].split('=')[1];

    // logout
    const logoutRes = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { 
        'Cookie': `profclaw_session=${sessionToken}`
      }
    });
    expect(logoutRes.status).toBe(200);

    // Verify session is gone
    const meRes = await app.request('/api/auth/me', {
      method: 'GET',
      headers: { 
        'Cookie': `profclaw_session=${sessionToken}`
      }
    });
    expect(meRes.status).toBe(401);
  });
});
