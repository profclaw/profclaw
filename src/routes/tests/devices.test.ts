import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const { mockDeviceDeps } = vi.hoisted(() => ({
  mockDeviceDeps: {
    loadOrCreateDeviceIdentity: vi.fn(),
    getDeviceIdentity: vi.fn(),
    exportPublicIdentity: vi.fn(),
    createDeviceAttestation: vi.fn(),
    verifyDeviceAttestation: vi.fn(),
    requestPairingCode: vi.fn(),
    approvePairingCode: vi.fn(),
    rejectPairingCode: vi.fn(),
    checkPairingStatus: vi.fn(),
    listPendingPairingRequests: vi.fn(),
    cleanupExpiredPairingRequests: vi.fn(),
    validatePairingToken: vi.fn(),
    formatPairingCode: vi.fn(),
    parsePairingCode: vi.fn(),
    initPairingCodesTable: vi.fn(),
    getStorage: vi.fn(),
  },
}));

vi.mock('../../auth/device-identity.js', () => ({
  loadOrCreateDeviceIdentity: mockDeviceDeps.loadOrCreateDeviceIdentity,
  getDeviceIdentity: mockDeviceDeps.getDeviceIdentity,
  exportPublicIdentity: mockDeviceDeps.exportPublicIdentity,
  createDeviceAttestation: mockDeviceDeps.createDeviceAttestation,
  verifyDeviceAttestation: mockDeviceDeps.verifyDeviceAttestation,
}));

vi.mock('../../auth/pairing-codes.js', () => ({
  requestPairingCode: mockDeviceDeps.requestPairingCode,
  approvePairingCode: mockDeviceDeps.approvePairingCode,
  rejectPairingCode: mockDeviceDeps.rejectPairingCode,
  checkPairingStatus: mockDeviceDeps.checkPairingStatus,
  listPendingPairingRequests: mockDeviceDeps.listPendingPairingRequests,
  cleanupExpiredPairingRequests: mockDeviceDeps.cleanupExpiredPairingRequests,
  validatePairingToken: mockDeviceDeps.validatePairingToken,
  formatPairingCode: mockDeviceDeps.formatPairingCode,
  parsePairingCode: mockDeviceDeps.parsePairingCode,
  initPairingCodesTable: mockDeviceDeps.initPairingCodesTable,
}));

vi.mock('../../storage/index.js', () => ({
  getStorage: mockDeviceDeps.getStorage,
}));

import { devicesRoutes } from '../devices.js';

function buildApp(): Hono {
  const app = new Hono();
  app.route('/api/devices', devicesRoutes);
  return app;
}

describe('devicesRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockDeviceDeps.loadOrCreateDeviceIdentity.mockReturnValue({
      deviceId: 'device-1',
      displayName: 'MacBook',
      platform: 'macos',
    });
    mockDeviceDeps.exportPublicIdentity.mockReturnValue({
      deviceId: 'device-1',
      displayName: 'MacBook',
      platform: 'macos',
    });
    mockDeviceDeps.createDeviceAttestation.mockReturnValue('signed-attestation');
    mockDeviceDeps.verifyDeviceAttestation.mockReturnValue({
      valid: true,
      deviceId: 'device-1',
    });
    mockDeviceDeps.requestPairingCode.mockResolvedValue({
      code: 'ABC123',
      expiresAt: new Date('2026-03-12T00:00:00Z'),
      created: true,
    });
    mockDeviceDeps.approvePairingCode.mockResolvedValue({
      request: {
        id: 'req-1',
        code: 'ABC123',
        requesterId: 'device-1',
        meta: { displayName: 'MacBook' },
        status: 'approved',
        resolvedBy: 'admin',
        resolvedAt: new Date('2026-03-12T00:00:00Z'),
      },
      token: 'pairing-token',
    });
    mockDeviceDeps.formatPairingCode.mockImplementation((code: string) => code);
    mockDeviceDeps.parsePairingCode.mockImplementation((code: string) => code);
    mockDeviceDeps.initPairingCodesTable.mockResolvedValue(undefined);
  });

  it('returns 400 for malformed JSON on POST /attest', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/devices/attest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"data":{"foo":"bar"}',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Invalid JSON body',
    });
  });

  it('returns 400 when POST /verify body is not a JSON object', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/devices/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(['signed-attestation']),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Request body must be a JSON object',
    });
  });

  it('creates an attestation successfully', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/devices/attest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { foo: 'bar' } }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      attestation: 'signed-attestation',
    });
  });

  it('returns 400 for malformed JSON on POST /pairing/approve', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/devices/pairing/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"code":"ABC123"',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Invalid JSON body',
    });
  });

  it('approves a pairing code successfully', async () => {
    const app = buildApp();

    const response = await app.fetch(new Request('http://localhost/api/devices/pairing/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ABC123', approvedBy: 'admin' }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      token: 'pairing-token',
      request: {
        id: 'req-1',
        code: 'ABC123',
      },
    });
  });
});
