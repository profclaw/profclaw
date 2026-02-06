import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as apiTokens from '../api-tokens.js';
import { getStorage } from '../../storage/index.js';

vi.mock('../../storage/index.js', () => ({
  getStorage: vi.fn(),
}));

describe('API Tokens Service', () => {
  let mockStorage: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage = {
      execute: vi.fn(),
    };
    (getStorage as any).mockReturnValue(mockStorage);
  });

  describe('Token Generation', () => {
    it('should generate a token with prefix', async () => {
      const name = 'Test Token';
      const scopes: any[] = ['tasks:read'];
      
      const result = await apiTokens.createApiToken(name, scopes);
      
      expect(result.plainTextToken).toContain('glinr_');
      expect(result.token.tokenPrefix).toBeDefined();
      expect(mockStorage.execute).toHaveBeenCalled();
    });
  });

  describe('Token Validation', () => {
    it('should validate correctly formatted tokens', async () => {
        const result = await apiTokens.validateToken('invalid');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Invalid token format');
    });
  });

  describe('Token Scopes', () => {
    it('should check scopes correctly', () => {
        const token: any = { scopes: ['tasks:read', 'tasks:write'] };
        
        expect(apiTokens.hasScope(token, 'tasks:read')).toBe(true);
        expect(apiTokens.hasScope(token, 'admin')).toBe(false);
    });
  });
});
