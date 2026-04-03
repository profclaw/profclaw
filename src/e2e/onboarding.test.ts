import { describe, it, expect, beforeAll, vi } from 'vitest';

// Set environment variables before importing app
process.env.NODE_ENV = 'test';
process.env.STORAGE_TIER = 'memory';
process.env.ENABLE_CRON = 'false';

import { app } from '../server.js';
import { initStorage } from '../storage/index.js';

describe('E2E: Onboarding Flow', () => {
  beforeAll(async () => {
    await initStorage();
  });

  it('should return 200 for health check', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(['ok', 'degraded']).toContain(data.status);
  });

  it('should check initial setup status', async () => {
    const res = await app.request('/api/setup/status');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('isFirstTimeSetup');
    expect(data).toHaveProperty('hasAdmin');
  });

  it('should create initial admin user', async () => {
    const payload = {
      email: 'admin@example.com',
      password: 'StrongPassword123!',
      name: 'Admin User'
    };

    const res = await app.request('/api/setup/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (res.status !== 200) {
       console.log('Admin creation failed:', data);
    }
    
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.user.email).toBe('admin@example.com');
    expect(data.recoveryCodes).toBeDefined();
  });

  it('should prevent creating admin with duplicate email', async () => {
    // Try to create an admin with the same email as the first one
    const payload = {
      email: 'admin@example.com', // Same email as first admin
      password: 'StrongPassword123!',
      name: 'Admin User 2'
    };

    const res = await app.request('/api/setup/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('already registered');
  });
});
