import { createCipheriv, createDecipheriv, randomBytes, type CipherGCMTypes } from 'crypto';
import { logger } from './logger.js';

const ALGORITHM: CipherGCMTypes = 'aes-256-gcm';
const IV_LENGTH = 12; // Recommended for GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Get the encryption key from environment variable
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY environment variable is required in production');
    }
    // Fallback for development/testing
    return Buffer.from('default_development_key_32_bytes_long_12345678');
  }
  
  // Key must be 32 bytes for aes-256-gcm
  const bufferedKey = Buffer.from(key, 'hex');
  if (bufferedKey.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be a 32-byte hex string');
  }
  return bufferedKey;
}

/**
 * Encrypt sensitive data
 * @returns Base64 string containing [iv]:[authTag]:[encryptedData]
 */
export function encrypt(text: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypt sensitive data
 */
export function decrypt(encryptedText: string): string {
  try {
    const [ivBase64, authTagBase64, dataBase64] = encryptedText.split(':');
    
    if (!ivBase64 || !authTagBase64 || !dataBase64) {
      throw new Error('Invalid encrypted text format');
    }
    
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');
    const encrypted = Buffer.from(dataBase64, 'base64');
    
    const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    decipher.setAuthTag(authTag);
    
    return decipher.update(encrypted) + decipher.final('utf8');
  } catch (error) {
    logger.error('[Crypto] Decryption failed:', error as Error);
    // If decryption fails, it might be due to a key mismatch or corrupted data.
    // In some cases, we might want to return the original text if it's not encrypted (migration path),
    // but for security it's better to throw.
    throw new Error('Failed to decrypt data');
  }
}
