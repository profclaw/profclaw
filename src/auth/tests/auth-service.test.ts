import { describe, it, expect, beforeAll, vi } from 'vitest';
import { initStorage } from '../../storage/index.js';
import { 
  signUpWithEmail, 
  signInWithEmail, 
  validateSession, 
  deleteSession,
  deleteAllUserSessions,
  getUserById,
  updateUser,
  signInWithGitHub,
  getGitHubAuthUrl,
  getUserGitHubToken,
  getUserConnectedAccounts
} from '../auth-service.js';

// Mock settings to avoid DB calls for OAuth config
vi.mock('../../settings/index.js', () => ({
  getGitHubOAuthConfig: vi.fn(() => Promise.resolve({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'http://localhost/callback'
  })),
  getSettingsRaw: vi.fn(() => Promise.resolve({
    system: { registrationMode: 'open' },
  })),
}));

// Mock fetch for GitHub OAuth
global.fetch = vi.fn();

describe('Auth Service', () => {
  beforeAll(async () => {
    process.env.STORAGE_TIER = 'memory';
    await initStorage();
  });

  describe('Email/Password Auth', () => {
    const testEmail = 'test@example.com';
    const testPass = 'Password123!';
    const testName = 'Test User';

    it('should sign up a new user', async () => {
      const result = await signUpWithEmail(testEmail, testPass, testName);
      expect(result.success).toBe(true);
      expect(result.user?.email).toBe(testEmail);
      expect(result.session).toBeDefined();
    });

    it('should not sign up with existing email', async () => {
      const result = await signUpWithEmail(testEmail, testPass, testName);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Email already registered');
    });

    it('should not sign up with short password', async () => {
      const result = await signUpWithEmail('new@example.com', 'short', 'New User');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Password must be at least 8 characters');
    });

    it('should sign in with correct credentials', async () => {
      const result = await signInWithEmail(testEmail, testPass);
      expect(result.success).toBe(true);
      expect(result.session).toBeDefined();
      expect(result.user?.name).toBe(testName);
    });

    it('should not sign in with wrong password', async () => {
      const result = await signInWithEmail(testEmail, 'wrongpass');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid email or password');
    });

    it('should not sign in for non-existent user', async () => {
      const result = await signInWithEmail('ghost@example.com', 'somepass');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid email or password');
    });
  });

  describe('Session Management', () => {
    it('should validate a valid session', async () => {
      const auth = await signInWithEmail('test@example.com', 'Password123!');
      const user = await validateSession(auth.session!.token);
      expect(user).not.toBeNull();
      expect(user?.email).toBe('test@example.com');
    });

    it('should return null for invalid token', async () => {
      const user = await validateSession('invalid-token');
      expect(user).toBeNull();
    });

    it('should delete a session', async () => {
      const auth = await signInWithEmail('test@example.com', 'Password123!');
      await deleteSession(auth.session!.token);
      const user = await validateSession(auth.session!.token);
      expect(user).toBeNull();
    });

    it('should delete all user sessions', async () => {
        const auth = await signInWithEmail('test@example.com', 'Password123!');
        await deleteAllUserSessions(auth.user!.id);
        const user = await validateSession(auth.session!.token);
        expect(user).toBeNull();
    });
  });

  describe('User Operations', () => {
    it('should get user by id', async () => {
      const auth = await signUpWithEmail('ops@example.com', 'Password123!', 'Ops User');
      const user = await getUserById(auth.user!.id);
      expect(user?.id).toBe(auth.user!.id);
      expect(user?.name).toBe('Ops User');
    });

    it('should return null for non-existent id', async () => {
      const user = await getUserById('non-existent-id');
      expect(user).toBeNull();
    });

    it('should update user info', async () => {
      const auth = await signInWithEmail('ops@example.com', 'Password123!');
      const updated = await updateUser(auth.user!.id, { name: 'Updated Name', bio: 'New bio' });
      expect(updated?.name).toBe('Updated Name');
      expect(updated?.bio).toBe('New bio');
    });
  });

  describe('GitHub OAuth', () => {
    it('should generate GitHub auth URL', async () => {
        const url = await getGitHubAuthUrl('test-state');
        expect(url).toContain('client_id=test-client-id');
        expect(url).toContain('state=test-state');
    });

    it('should sign in with GitHub (new user)', async () => {
      // Mock exchangeGitHubCode
      (global.fetch as any)
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ access_token: 'gh_token', scope: 'user' })
        }) // exchangeGitHubCode
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: 9999, login: 'newgh', name: 'New GH', email: 'github-new@example.com', avatar_url: '...' })
        }); // getGitHubUser

      const result = await signInWithGitHub('fake_code');
      expect(result.success).toBe(true);
      expect(result.user?.email).toBe('github-new@example.com');
      
      const user = await getUserById(result.user!.id);
      expect(user?.name).toBe('New GH');
    });

    it('should fetch primary email if not public', async () => {
        (global.fetch as any)
          .mockResolvedValueOnce({
            json: () => Promise.resolve({ access_token: 'gh_token_email', scope: 'user' })
          }) // exchangeGitHubCode
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ id: 1234, login: 'emailgh', email: null })
          }) // getGitHubUser
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve([{ email: 'primary@example.com', primary: true, verified: true }])
          }); // getGitHubPrimaryEmail
  
        const result = await signInWithGitHub('fake_code_email');
        expect(result.user?.email).toBe('primary@example.com');
    });

    it('should retrieve connected accounts and tokens', async () => {
        (global.fetch as any)
          .mockResolvedValueOnce({
            json: () => Promise.resolve({ access_token: 'gh_token_token', scope: 'user' })
          }) // exchangeGitHubCode
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ id: 5678, login: 'tokengh', email: 'token@gh.com' })
          }); // getGitHubUser

        const result = await signInWithGitHub('fake_code_token');
        const userId = result.user!.id;
        
        const token = await getUserGitHubToken(userId);
        expect(token).toBe('gh_token_token');

        const accounts = await getUserConnectedAccounts(userId);
        expect(accounts.length).toBeGreaterThan(0);
        expect(accounts[0].provider).toBe('github');
    });
  });
});
