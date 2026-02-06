import { describe, it, expect } from 'vitest';
import {
  generateInviteCode,
  hashInviteCode,
} from '../password.js';

describe('Invite Code Utilities', () => {
  describe('generateInviteCode', () => {
    it('should generate a code in PC-XXXX-XXXX-XXXX format', () => {
      const code = generateInviteCode();
      expect(code).toMatch(/^PC-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);
    });

    it('should generate unique codes', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 100; i++) {
        codes.add(generateInviteCode());
      }
      expect(codes.size).toBe(100);
    });
  });

  describe('hashInviteCode', () => {
    it('should return a hex SHA256 hash', () => {
      const hash = hashInviteCode('PC-ABCD-1234-EF56');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should normalize dashes before hashing', () => {
      const withDashes = hashInviteCode('PC-ABCD-1234-EF56');
      const withoutDashes = hashInviteCode('PCABCD1234EF56');
      expect(withDashes).toBe(withoutDashes);
    });

    it('should normalize case before hashing', () => {
      const upper = hashInviteCode('PC-ABCD-1234-EF56');
      const lower = hashInviteCode('pc-abcd-1234-ef56');
      expect(upper).toBe(lower);
    });

    it('should produce different hashes for different codes', () => {
      const hash1 = hashInviteCode('PC-AAAA-BBBB-CCCC');
      const hash2 = hashInviteCode('PC-DDDD-EEEE-FFFF');
      expect(hash1).not.toBe(hash2);
    });
  });
});
