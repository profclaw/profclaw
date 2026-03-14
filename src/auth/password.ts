/**
 * Password Hashing Utilities
 *
 * Uses Node.js built-in scrypt for secure password hashing.
 * Supports transparent upgrade from legacy SHA256 hashes.
 *
 * Recovery codes use deterministic SHA256 (acceptable since codes are random, high-entropy).
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384; // N
const SCRYPT_BLOCK_SIZE = 8; // r
const SCRYPT_PARALLELIZATION = 1; // p

/**
 * Hash a password using scrypt.
 * Returns format: scrypt:<salt>:<hash>
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
  });
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

/**
 * Verify a password against a stored hash.
 * Supports both scrypt and legacy SHA256 formats.
 *
 * @returns { valid, needsUpgrade } - needsUpgrade is true when using legacy SHA256
 */
export function verifyPassword(
  password: string,
  storedHash: string
): { valid: boolean; needsUpgrade: boolean } {
  // New format: scrypt:salt:hash
  if (storedHash.startsWith('scrypt:')) {
    const parts = storedHash.split(':');
    if (parts.length !== 3) return { valid: false, needsUpgrade: false };
    const [, salt, hash] = parts;
    const derived = scryptSync(password, salt, SCRYPT_KEYLEN, {
      N: SCRYPT_COST,
      r: SCRYPT_BLOCK_SIZE,
      p: SCRYPT_PARALLELIZATION,
    });
    try {
      const valid = timingSafeEqual(Buffer.from(hash, 'hex'), derived);
      return { valid, needsUpgrade: false };
    } catch {
      return { valid: false, needsUpgrade: false };
    }
  }

  // Legacy format: salt:hash (SHA256)
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return { valid: false, needsUpgrade: false };

  const computedHash = createHash('sha256')
    .update(password + salt)
    .digest('hex');

  try {
    const valid = timingSafeEqual(Buffer.from(hash), Buffer.from(computedHash));
    return { valid, needsUpgrade: valid }; // If valid with legacy, needs upgrade
  } catch {
    return { valid: false, needsUpgrade: false };
  }
}

/**
 * Validate password strength.
 * Requires: 8+ chars, at least 1 letter, at least 1 number.
 * Returns null if valid, or an error message string.
 */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (password.length > 128) return 'Password must be at most 128 characters';
  if (!/[a-zA-Z]/.test(password)) return 'Password must contain at least one letter';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number';
  return null;
}

/**
 * Deterministic hash for recovery codes.
 * SHA256 is acceptable here since recovery codes are random, high-entropy strings.
 */
export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.replace(/-/g, '')).digest('hex');
}

/**
 * Generate recovery codes (XXXX-XXXX format).
 */
export function generateRecoveryCodes(count: number = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = randomBytes(4).toString('hex').toUpperCase();
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }
  return codes;
}

/**
 * Hash an array of recovery codes.
 */
export function hashRecoveryCodes(codes: string[]): string[] {
  return codes.map(hashRecoveryCode);
}

// INVITE CODE UTILITIES

/**
 * Generate a human-friendly invite code.
 * Format: PC-XXXX-XXXX-XXXX (12 hex chars)
 */
export function generateInviteCode(): string {
  const hex = randomBytes(6).toString('hex').toUpperCase();
  return `PC-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

/**
 * Hash an invite code for secure storage.
 * Normalizes by removing dashes and uppercasing before hashing.
 */
export function hashInviteCode(code: string): string {
  return createHash('sha256')
    .update(code.replace(/-/g, '').toUpperCase())
    .digest('hex');
}
