/**
 * Device Identity Management
 *
 * Uses ED25519 key pairs for cryptographic device identification.
 * Adapted from OpenClaw reference implementation.
 *
 * Features:
 * - Deterministic device ID derived from public key
 * - Secure signature creation and verification
 * - Persistent storage with secure file permissions
 */

import {
  generateKeyPairSync,
  createSign,
  createVerify,
  createHash,
  randomUUID,
} from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

/**
 * Device identity structure
 */
export interface DeviceIdentity {
  /** SHA256 hash of public key (deterministic, verifiable) */
  deviceId: string;
  /** PEM-encoded public key */
  publicKeyPem: string;
  /** PEM-encoded private key (never share!) */
  privateKeyPem: string;
  /** Human-readable device name */
  displayName?: string;
  /** Platform identifier */
  platform?: string;
  /** Creation timestamp */
  createdAt: string;
}

/**
 * Device identity file structure (what gets persisted)
 */
interface DeviceIdentityFile {
  version: 1;
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
  displayName?: string;
  platform?: string;
  createdAt: string;
}

/**
 * Default identity file path
 */
const DEFAULT_IDENTITY_DIR = join(homedir(), '.profclaw', 'identity');
const DEFAULT_IDENTITY_FILE = 'device.json';

/**
 * Generate a new ED25519 key pair
 */
function generateKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

/**
 * Derive device ID from public key (SHA256 hash)
 */
function deriveDeviceId(publicKeyPem: string): string {
  return createHash('sha256')
    .update(publicKeyPem)
    .digest('hex')
    .slice(0, 32); // First 32 chars for readability
}

/**
 * Get platform identifier
 */
function getPlatform(): string {
  const platformMap: Record<string, string> = {
    darwin: 'macos',
    win32: 'windows',
    linux: 'linux',
    freebsd: 'freebsd',
  };
  return platformMap[process.platform] || process.platform;
}

/**
 * Ensure directory exists with secure permissions
 */
function ensureSecureDirectory(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true, mode: 0o700 }); // rwx------
  }
}

/**
 * Write file with secure permissions
 */
function writeSecureFile(filePath: string, content: string): void {
  writeFileSync(filePath, content, { mode: 0o600 }); // rw-------
  // Ensure permissions are correct even if file existed
  chmodSync(filePath, 0o600);
}

/**
 * Load existing device identity or create new one
 */
export function loadOrCreateDeviceIdentity(
  identityDir: string = DEFAULT_IDENTITY_DIR,
  options?: { displayName?: string }
): DeviceIdentity {
  const filePath = join(identityDir, DEFAULT_IDENTITY_FILE);

  // Try to load existing identity
  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content) as DeviceIdentityFile;

      // Validate version
      if (data.version !== 1) {
        console.warn(`[DeviceIdentity] Unknown version ${data.version}, creating new identity`);
      } else {
        console.log(`[DeviceIdentity] Loaded existing identity: ${data.deviceId.slice(0, 8)}...`);
        return {
          deviceId: data.deviceId,
          publicKeyPem: data.publicKeyPem,
          privateKeyPem: data.privateKeyPem,
          displayName: data.displayName,
          platform: data.platform,
          createdAt: data.createdAt,
        };
      }
    } catch (error) {
      console.warn(`[DeviceIdentity] Failed to load identity, creating new one:`, error);
    }
  }

  // Create new identity
  console.log('[DeviceIdentity] Creating new device identity...');

  const { publicKey, privateKey } = generateKeyPair();
  const deviceId = deriveDeviceId(publicKey);

  const identity: DeviceIdentity = {
    deviceId,
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
    displayName: options?.displayName || `profClaw Device ${deviceId.slice(0, 8)}`,
    platform: getPlatform(),
    createdAt: new Date().toISOString(),
  };

  // Persist to disk
  ensureSecureDirectory(identityDir);
  const fileData: DeviceIdentityFile = {
    version: 1,
    ...identity,
  };
  writeSecureFile(filePath, JSON.stringify(fileData, null, 2));

  console.log(`[DeviceIdentity] Created new identity: ${deviceId.slice(0, 8)}...`);
  return identity;
}

/**
 * Get device identity (read-only, no creation)
 */
export function getDeviceIdentity(
  identityDir: string = DEFAULT_IDENTITY_DIR
): DeviceIdentity | null {
  const filePath = join(identityDir, DEFAULT_IDENTITY_FILE);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content) as DeviceIdentityFile;
    return {
      deviceId: data.deviceId,
      publicKeyPem: data.publicKeyPem,
      privateKeyPem: data.privateKeyPem,
      displayName: data.displayName,
      platform: data.platform,
      createdAt: data.createdAt,
    };
  } catch {
    return null;
  }
}

/**
 * Sign a payload with the device's private key
 * Returns base64url-encoded signature
 */
export function signPayload(privateKeyPem: string, payload: string): string {
  const sign = createSign('SHA256');
  sign.update(payload);
  sign.end();
  const signature = sign.sign(privateKeyPem);
  return signature.toString('base64url');
}

/**
 * Verify a signature against a public key
 */
export function verifySignature(
  publicKeyPem: string,
  payload: string,
  signature: string
): boolean {
  try {
    const verify = createVerify('SHA256');
    verify.update(payload);
    verify.end();
    return verify.verify(publicKeyPem, Buffer.from(signature, 'base64url'));
  } catch {
    return false;
  }
}

/**
 * Create a signed device attestation
 * Useful for proving device identity to a server
 */
export function createDeviceAttestation(
  identity: DeviceIdentity,
  additionalData?: Record<string, unknown>
): {
  deviceId: string;
  publicKey: string;
  attestation: {
    timestamp: string;
    nonce: string;
    data?: Record<string, unknown>;
    signature: string;
  };
} {
  const timestamp = new Date().toISOString();
  const nonce = randomUUID();

  // Build payload to sign
  const payloadObj = {
    deviceId: identity.deviceId,
    timestamp,
    nonce,
    ...(additionalData && { data: additionalData }),
  };
  const payload = JSON.stringify(payloadObj);

  // Sign payload
  const signature = signPayload(identity.privateKeyPem, payload);

  return {
    deviceId: identity.deviceId,
    publicKey: identity.publicKeyPem,
    attestation: {
      timestamp,
      nonce,
      data: additionalData,
      signature,
    },
  };
}

/**
 * Verify a device attestation
 */
export function verifyDeviceAttestation(
  attestation: {
    deviceId: string;
    publicKey: string;
    attestation: {
      timestamp: string;
      nonce: string;
      data?: Record<string, unknown>;
      signature: string;
    };
  },
  options?: {
    /** Maximum age of attestation in milliseconds */
    maxAgeMs?: number;
    /** Expected device ID (if known) */
    expectedDeviceId?: string;
  }
): { valid: boolean; error?: string } {
  // Verify device ID matches public key
  const derivedDeviceId = deriveDeviceId(attestation.publicKey);
  if (derivedDeviceId !== attestation.deviceId) {
    return { valid: false, error: 'Device ID does not match public key' };
  }

  // Check expected device ID if provided
  if (options?.expectedDeviceId && attestation.deviceId !== options.expectedDeviceId) {
    return { valid: false, error: 'Device ID mismatch' };
  }

  // Check timestamp freshness
  if (options?.maxAgeMs) {
    const attestationTime = new Date(attestation.attestation.timestamp).getTime();
    const now = Date.now();
    if (now - attestationTime > options.maxAgeMs) {
      return { valid: false, error: 'Attestation expired' };
    }
  }

  // Rebuild and verify payload
  const payloadObj = {
    deviceId: attestation.deviceId,
    timestamp: attestation.attestation.timestamp,
    nonce: attestation.attestation.nonce,
    ...(attestation.attestation.data && { data: attestation.attestation.data }),
  };
  const payload = JSON.stringify(payloadObj);

  const signatureValid = verifySignature(
    attestation.publicKey,
    payload,
    attestation.attestation.signature
  );

  if (!signatureValid) {
    return { valid: false, error: 'Invalid signature' };
  }

  return { valid: true };
}

/**
 * Export public identity (safe to share)
 */
export function exportPublicIdentity(identity: DeviceIdentity): {
  deviceId: string;
  publicKey: string;
  displayName?: string;
  platform?: string;
} {
  return {
    deviceId: identity.deviceId,
    publicKey: identity.publicKeyPem,
    displayName: identity.displayName,
    platform: identity.platform,
  };
}

/**
 * Verify that a device ID was derived from a public key
 */
export function verifyDeviceIdDerivation(deviceId: string, publicKeyPem: string): boolean {
  const derived = deriveDeviceId(publicKeyPem);
  return derived === deviceId;
}
