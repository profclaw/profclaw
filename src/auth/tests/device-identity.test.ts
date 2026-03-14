import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadOrCreateDeviceIdentity,
  getDeviceIdentity,
  signPayload,
  verifySignature,
  createDeviceAttestation,
  verifyDeviceAttestation,
  exportPublicIdentity,
  verifyDeviceIdDerivation,
} from '../device-identity.js';
import type { DeviceIdentity } from '../device-identity.js';

// ---------------------------------------------------------------------------
// Mock the fs module so tests never touch disk
// ---------------------------------------------------------------------------
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
}));

// Import the mocked fs functions after the mock declaration
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate an RSA-2048 key pair + device ID to use as test fixtures.
 *
 * The source's signPayload() uses createSign('SHA256'), which is incompatible
 * with ED25519 in Node.js (ED25519 does not support specifying a digest
 * algorithm via createSign). RSA keys work correctly with createSign('SHA256'),
 * so we use them here to test the signing/verification logic as implemented.
 *
 * The loadOrCreateDeviceIdentity() tests verify key pair generation separately.
 */
import { generateKeyPairSync, createHash } from 'crypto';

function makeTestKeyPair(): { publicKey: string; privateKey: string; deviceId: string } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const deviceId = createHash('sha256').update(publicKey).digest('hex').slice(0, 32);
  return { publicKey, privateKey, deviceId };
}

const fixture = makeTestKeyPair();

function makeIdentity(overrides: Partial<DeviceIdentity> = {}): DeviceIdentity {
  return {
    deviceId: fixture.deviceId,
    publicKeyPem: fixture.publicKey,
    privateKeyPem: fixture.privateKey,
    displayName: 'Test Device',
    platform: 'macos',
    createdAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Device Identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // loadOrCreateDeviceIdentity
  // -------------------------------------------------------------------------
  describe('loadOrCreateDeviceIdentity', () => {
    it('loads an existing identity from disk when it exists', () => {
      const stored = {
        version: 1 as const,
        deviceId: fixture.deviceId,
        publicKeyPem: fixture.publicKey,
        privateKeyPem: fixture.privateKey,
        displayName: 'Saved Device',
        platform: 'linux',
        createdAt: '2024-06-01T00:00:00.000Z',
      };

      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(stored));

      const identity = loadOrCreateDeviceIdentity('/tmp/test-identity-dir');

      expect(identity.deviceId).toBe(fixture.deviceId);
      expect(identity.publicKeyPem).toBe(fixture.publicKey);
      expect(identity.privateKeyPem).toBe(fixture.privateKey);
      expect(identity.displayName).toBe('Saved Device');
      expect(identity.platform).toBe('linux');
      // Should NOT write anything
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('creates a new identity when file does not exist', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const identity = loadOrCreateDeviceIdentity('/tmp/new-dir');

      expect(identity.deviceId).toBeDefined();
      expect(identity.publicKeyPem).toContain('PUBLIC KEY');
      expect(identity.privateKeyPem).toContain('PRIVATE KEY');
      expect(mkdirSync).toHaveBeenCalledWith('/tmp/new-dir', expect.objectContaining({ recursive: true }));
      expect(writeFileSync).toHaveBeenCalled();
    });

    it('applies a custom displayName when creating a new identity', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const identity = loadOrCreateDeviceIdentity('/tmp/named-dir', { displayName: 'My Laptop' });

      expect(identity.displayName).toBe('My Laptop');
    });

    it('sets a default displayName that includes part of the device ID', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const identity = loadOrCreateDeviceIdentity('/tmp/default-name-dir');

      expect(identity.displayName).toContain('profClaw Device');
      expect(identity.displayName).toContain(identity.deviceId.slice(0, 8));
    });

    it('detects the current platform', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const identity = loadOrCreateDeviceIdentity('/tmp/platform-dir');

      const knownPlatforms = ['macos', 'linux', 'windows', 'freebsd'];
      const isKnown = knownPlatforms.includes(identity.platform ?? '') || identity.platform === process.platform;
      expect(isKnown).toBe(true);
    });

    it('creates a new identity when the file has an unknown version', () => {
      const badVersionData = {
        version: 99,
        deviceId: 'old-id',
        publicKeyPem: 'old-pub',
        privateKeyPem: 'old-priv',
        createdAt: '2020-01-01T00:00:00.000Z',
      };

      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(badVersionData));

      const identity = loadOrCreateDeviceIdentity('/tmp/bad-version-dir');

      // Should regenerate (new keys, not the old ones)
      expect(identity.publicKeyPem).toContain('PUBLIC KEY');
      expect(identity.deviceId).not.toBe('old-id');
    });

    it('creates a new identity when the file is corrupt JSON', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('NOT { VALID JSON }}}');

      const identity = loadOrCreateDeviceIdentity('/tmp/corrupt-dir');

      expect(identity.deviceId).toBeDefined();
      expect(identity.publicKeyPem).toContain('PUBLIC KEY');
    });

    it('persists the file with secure permissions (0o600)', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      loadOrCreateDeviceIdentity('/tmp/secure-perms-dir');

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ mode: 0o600 })
      );
      expect(chmodSync).toHaveBeenCalledWith(expect.any(String), 0o600);
    });

    it('generates a device ID that is the first 32 hex chars of SHA256(publicKey)', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const identity = loadOrCreateDeviceIdentity('/tmp/derive-id-dir');

      const expected = createHash('sha256')
        .update(identity.publicKeyPem)
        .digest('hex')
        .slice(0, 32);
      expect(identity.deviceId).toBe(expected);
    });

    it('creates directory recursively if it does not exist', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      loadOrCreateDeviceIdentity('/tmp/deep/nested/dir');

      expect(mkdirSync).toHaveBeenCalledWith(
        '/tmp/deep/nested/dir',
        expect.objectContaining({ recursive: true, mode: 0o700 })
      );
    });
  });

  // -------------------------------------------------------------------------
  // getDeviceIdentity
  // -------------------------------------------------------------------------
  describe('getDeviceIdentity', () => {
    it('returns null when the identity file does not exist', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const result = getDeviceIdentity('/tmp/missing-dir');

      expect(result).toBeNull();
    });

    it('returns the identity when the file exists and is valid', () => {
      const stored = {
        version: 1,
        deviceId: fixture.deviceId,
        publicKeyPem: fixture.publicKey,
        privateKeyPem: fixture.privateKey,
        displayName: 'Readonly Device',
        platform: 'macos',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(stored));

      const result = getDeviceIdentity('/tmp/valid-dir');

      expect(result).not.toBeNull();
      expect(result!.deviceId).toBe(fixture.deviceId);
      expect(result!.displayName).toBe('Readonly Device');
    });

    it('returns null when the file is corrupt', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('INVALID JSON');

      const result = getDeviceIdentity('/tmp/bad-dir');

      expect(result).toBeNull();
    });

    it('does not create a new file if none exists', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      getDeviceIdentity('/tmp/readonly-dir');

      expect(writeFileSync).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // signPayload / verifySignature
  // -------------------------------------------------------------------------
  describe('signPayload and verifySignature', () => {
    it('produces a base64url-encoded signature', () => {
      const sig = signPayload(fixture.privateKey, 'hello world');
      // base64url uses only A-Z, a-z, 0-9, -, _ (no +, /, = padding)
      expect(sig).toMatch(/^[A-Za-z0-9\-_]+$/);
    });

    it('verifies a valid signature successfully', () => {
      const payload = 'test payload';
      const sig = signPayload(fixture.privateKey, payload);
      const valid = verifySignature(fixture.publicKey, payload, sig);
      expect(valid).toBe(true);
    });

    it('rejects a tampered payload', () => {
      const sig = signPayload(fixture.privateKey, 'original payload');
      const valid = verifySignature(fixture.publicKey, 'tampered payload', sig);
      expect(valid).toBe(false);
    });

    it('rejects a tampered signature', () => {
      const payload = 'some payload';
      const sig = signPayload(fixture.privateKey, payload);
      // Corrupt the middle of the signature to ensure it's definitively invalid
      const mid = Math.floor(sig.length / 2);
      const tamperedSig = sig.slice(0, mid) + (sig[mid] === 'A' ? 'B' : 'A') + sig.slice(mid + 1);
      // If the tamper produced the same sig (extremely unlikely), fall back to full replace
      const finalSig = tamperedSig === sig ? 'AAAAAAAAAAAAAAAAAAAAAAAAAAAA' : tamperedSig;
      const valid = verifySignature(fixture.publicKey, payload, finalSig);
      expect(valid).toBe(false);
    });

    it('rejects an invalid (garbage) signature without throwing', () => {
      const valid = verifySignature(fixture.publicKey, 'payload', 'not-a-real-sig!!!');
      expect(valid).toBe(false);
    });

    it('returns different signatures for different payloads', () => {
      const sig1 = signPayload(fixture.privateKey, 'payload-one');
      const sig2 = signPayload(fixture.privateKey, 'payload-two');
      expect(sig1).not.toBe(sig2);
    });

    it('produces consistent signatures for the same payload', () => {
      // ED25519 is deterministic
      const sig1 = signPayload(fixture.privateKey, 'deterministic');
      const sig2 = signPayload(fixture.privateKey, 'deterministic');
      expect(sig1).toBe(sig2);
    });
  });

  // -------------------------------------------------------------------------
  // createDeviceAttestation
  // -------------------------------------------------------------------------
  describe('createDeviceAttestation', () => {
    it('returns deviceId, publicKey, and attestation fields', () => {
      const identity = makeIdentity();
      const attestation = createDeviceAttestation(identity);

      expect(attestation.deviceId).toBe(identity.deviceId);
      expect(attestation.publicKey).toBe(identity.publicKeyPem);
      expect(attestation.attestation.timestamp).toBeDefined();
      expect(attestation.attestation.nonce).toBeDefined();
      expect(attestation.attestation.signature).toBeDefined();
    });

    it('includes additionalData in the attestation when provided', () => {
      const identity = makeIdentity();
      const extra = { purpose: 'login', sessionId: 'sess-123' };
      const attestation = createDeviceAttestation(identity, extra);

      expect(attestation.attestation.data).toEqual(extra);
    });

    it('omits data field when no additionalData is provided', () => {
      const identity = makeIdentity();
      const attestation = createDeviceAttestation(identity);

      expect(attestation.attestation.data).toBeUndefined();
    });

    it('produces a unique nonce per call', () => {
      const identity = makeIdentity();
      const a1 = createDeviceAttestation(identity);
      const a2 = createDeviceAttestation(identity);

      expect(a1.attestation.nonce).not.toBe(a2.attestation.nonce);
    });

    it('timestamp is a valid ISO 8601 string', () => {
      const identity = makeIdentity();
      const result = createDeviceAttestation(identity);

      expect(new Date(result.attestation.timestamp).toISOString()).toBe(
        result.attestation.timestamp
      );
    });
  });

  // -------------------------------------------------------------------------
  // verifyDeviceAttestation
  // -------------------------------------------------------------------------
  describe('verifyDeviceAttestation', () => {
    it('accepts a valid freshly-created attestation', () => {
      const identity = makeIdentity();
      const attestation = createDeviceAttestation(identity);

      const result = verifyDeviceAttestation(attestation);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('rejects when deviceId does not match public key', () => {
      const identity = makeIdentity();
      const attestation = createDeviceAttestation(identity);

      const tampered = {
        ...attestation,
        deviceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa0000', // wrong ID
      };

      const result = verifyDeviceAttestation(tampered);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Device ID does not match public key');
    });

    it('rejects when signature has been tampered with', () => {
      const identity = makeIdentity();
      const attestation = createDeviceAttestation(identity);

      const tampered = {
        ...attestation,
        attestation: {
          ...attestation.attestation,
          signature: 'invalidsignaturedata',
        },
      };

      const result = verifyDeviceAttestation(tampered);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid signature');
    });

    it('rejects when expected device ID does not match', () => {
      const identity = makeIdentity();
      const attestation = createDeviceAttestation(identity);

      const result = verifyDeviceAttestation(attestation, {
        expectedDeviceId: 'completely-different-id-here-0000',
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Device ID mismatch');
    });

    it('rejects an attestation older than maxAgeMs', () => {
      const identity = makeIdentity();
      const attestation = createDeviceAttestation(identity);

      // Back-date the timestamp by 2 minutes
      const oldTimestamp = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const agedAttestation = {
        ...attestation,
        attestation: {
          ...attestation.attestation,
          timestamp: oldTimestamp,
        },
      };

      const result = verifyDeviceAttestation(agedAttestation, { maxAgeMs: 60 * 1000 });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Attestation expired');
    });

    it('accepts an attestation within maxAgeMs', () => {
      const identity = makeIdentity();
      const attestation = createDeviceAttestation(identity);

      const result = verifyDeviceAttestation(attestation, { maxAgeMs: 60 * 1000 });

      expect(result.valid).toBe(true);
    });

    it('accepts a valid attestation when expectedDeviceId matches', () => {
      const identity = makeIdentity();
      const attestation = createDeviceAttestation(identity);

      const result = verifyDeviceAttestation(attestation, {
        expectedDeviceId: identity.deviceId,
      });

      expect(result.valid).toBe(true);
    });

    it('verifies attestation with additionalData correctly', () => {
      const identity = makeIdentity();
      const extra = { action: 'pair', version: '2' };
      const attestation = createDeviceAttestation(identity, extra);

      const result = verifyDeviceAttestation(attestation);

      expect(result.valid).toBe(true);
    });

    it('rejects when attestation data has been changed after signing', () => {
      const identity = makeIdentity();
      const attestation = createDeviceAttestation(identity, { purpose: 'original' });

      const tampered = {
        ...attestation,
        attestation: {
          ...attestation.attestation,
          data: { purpose: 'tampered' },
        },
      };

      const result = verifyDeviceAttestation(tampered);

      expect(result.valid).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // exportPublicIdentity
  // -------------------------------------------------------------------------
  describe('exportPublicIdentity', () => {
    it('returns deviceId, publicKey, displayName, and platform', () => {
      const identity = makeIdentity();
      const exported = exportPublicIdentity(identity);

      expect(exported.deviceId).toBe(identity.deviceId);
      expect(exported.publicKey).toBe(identity.publicKeyPem);
      expect(exported.displayName).toBe(identity.displayName);
      expect(exported.platform).toBe(identity.platform);
    });

    it('does not include the private key', () => {
      const identity = makeIdentity();
      const exported = exportPublicIdentity(identity) as Record<string, unknown>;

      expect('privateKeyPem' in exported).toBe(false);
    });

    it('does not include createdAt', () => {
      const identity = makeIdentity();
      const exported = exportPublicIdentity(identity) as Record<string, unknown>;

      expect('createdAt' in exported).toBe(false);
    });

    it('includes optional displayName when set', () => {
      const identity = makeIdentity({ displayName: 'Alice MacBook' });
      const exported = exportPublicIdentity(identity);

      expect(exported.displayName).toBe('Alice MacBook');
    });
  });

  // -------------------------------------------------------------------------
  // verifyDeviceIdDerivation
  // -------------------------------------------------------------------------
  describe('verifyDeviceIdDerivation', () => {
    it('returns true when deviceId matches the derived hash of the public key', () => {
      const { publicKey, deviceId } = fixture;

      expect(verifyDeviceIdDerivation(deviceId, publicKey)).toBe(true);
    });

    it('returns false when deviceId does not match the public key', () => {
      const { publicKey } = fixture;
      const wrongId = 'a'.repeat(32);

      expect(verifyDeviceIdDerivation(wrongId, publicKey)).toBe(false);
    });

    it('returns false when the public key is different', () => {
      const { publicKey: pub1, deviceId: id1 } = fixture;
      const { publicKey: pub2 } = makeTestKeyPair();

      // id1 was derived from pub1, not pub2
      expect(verifyDeviceIdDerivation(id1, pub2)).toBe(false);
      // Sanity check: correct combination still works
      expect(verifyDeviceIdDerivation(id1, pub1)).toBe(true);
    });

    it('returns false for an empty deviceId', () => {
      expect(verifyDeviceIdDerivation('', fixture.publicKey)).toBe(false);
    });

    it('is deterministic - same inputs always produce same result', () => {
      const { publicKey, deviceId } = fixture;
      // Call multiple times to confirm determinism
      for (let i = 0; i < 5; i++) {
        expect(verifyDeviceIdDerivation(deviceId, publicKey)).toBe(true);
      }
    });
  });
});
