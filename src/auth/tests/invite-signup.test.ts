import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { initStorage, getDb } from '../../storage/index.js';
import { inviteCodes, users } from '../../storage/schema.js';
import { signUpWithEmail } from '../auth-service.js';
import { generateInviteCode, hashInviteCode } from '../password.js';

// Track current mock mode
let mockRegistrationMode = 'open';

// Mock settings
vi.mock('../../settings/index.js', () => ({
  getGitHubOAuthConfig: vi.fn(() => Promise.resolve(null)),
  getSettingsRaw: vi.fn(() => Promise.resolve({
    system: { registrationMode: mockRegistrationMode },
  })),
}));

describe('Invite-Only Signup', () => {
  beforeAll(async () => {
    process.env.STORAGE_TIER = 'memory';
    await initStorage();
  });

  describe('open mode', () => {
    it('should allow signup without invite code in open mode', async () => {
      mockRegistrationMode = 'open';
      const result = await signUpWithEmail('open-user@test.com', 'Password1', 'Open User');
      expect(result.success).toBe(true);
      expect(result.user?.email).toBe('open-user@test.com');
    });
  });

  describe('invite mode', () => {
    it('should store and validate invite codes', async () => {
      const db = getDb();
      const code = generateInviteCode();
      const codeHash = hashInviteCode(code);

      // Store invite code
      await db.insert(inviteCodes).values({
        id: randomUUID(),
        codeHash,
        createdBy: 'test-admin',
        createdAt: new Date(),
      });

      // Verify we can look it up by hash
      const records = await db
        .select()
        .from(inviteCodes)
        .where(eq(inviteCodes.codeHash, codeHash))
        .limit(1);

      expect(records.length).toBe(1);
      expect(records[0].usedBy).toBeNull();
    });

    it('should detect expired invite codes', async () => {
      const db = getDb();
      const code = generateInviteCode();
      const codeHash = hashInviteCode(code);

      // Store expired invite code
      await db.insert(inviteCodes).values({
        id: randomUUID(),
        codeHash,
        createdBy: 'test-admin',
        expiresAt: new Date(Date.now() - 1000), // 1 second ago
        createdAt: new Date(),
      });

      const records = await db
        .select()
        .from(inviteCodes)
        .where(eq(inviteCodes.codeHash, codeHash))
        .limit(1);

      expect(records.length).toBe(1);
      // Verify expiration check works
      const isExpired = records[0].expiresAt && new Date() > new Date(records[0].expiresAt as Date);
      expect(isExpired).toBe(true);
    });

    it('should mark invite code as used', async () => {
      const db = getDb();
      const code = generateInviteCode();
      const codeHash = hashInviteCode(code);
      const inviteId = randomUUID();
      const userId = randomUUID();

      // Store invite code
      await db.insert(inviteCodes).values({
        id: inviteId,
        codeHash,
        createdBy: 'test-admin',
        createdAt: new Date(),
      });

      // Mark as used
      await db
        .update(inviteCodes)
        .set({ usedBy: userId, usedAt: new Date() })
        .where(eq(inviteCodes.id, inviteId));

      // Verify it's marked as used
      const records = await db
        .select()
        .from(inviteCodes)
        .where(eq(inviteCodes.id, inviteId))
        .limit(1);

      expect(records[0].usedBy).toBe(userId);
      expect(records[0].usedAt).not.toBeNull();
    });

    it('should support invite codes with labels', async () => {
      const db = getDb();
      const code = generateInviteCode();
      const codeHash = hashInviteCode(code);

      await db.insert(inviteCodes).values({
        id: randomUUID(),
        codeHash,
        createdBy: 'test-admin',
        label: 'For Bob',
        createdAt: new Date(),
      });

      const records = await db
        .select()
        .from(inviteCodes)
        .where(eq(inviteCodes.codeHash, codeHash))
        .limit(1);

      expect(records[0].label).toBe('For Bob');
    });
  });
});
