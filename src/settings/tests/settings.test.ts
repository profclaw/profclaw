import { describe, it, expect, beforeAll, vi } from 'vitest';
import { initStorage } from '../../storage/index.js';
import { 
  getSettings, 
  updateSettings, 
  resetSettings, 
  getSetting,
  isIntegrationConfigured,
  getGitHubOAuthConfig,
  getPluginHealth,
  togglePlugin
} from '../index.js';

// Mock fetch for health checks
global.fetch = vi.fn();

describe('Settings Service', () => {
  beforeAll(async () => {
    process.env.STORAGE_TIER = 'memory';
    await initStorage();
  });

  it('should return default settings initially', async () => {
    const settings = await getSettings();
    expect(settings.appearance.theme).toBe('system');
    expect(settings.notifications.taskComplete).toBe(true);
  });

  it('should update settings and mask secrets', async () => {
    const updates = {
      appearance: { theme: 'dark' as const },
      integrations: { githubToken: 'ghp_secret_token_12345' }
    };
    
    const settings = await updateSettings(updates);
    expect(settings.appearance.theme).toBe('dark');
    // Secret should be masked
    expect(settings.integrations.githubToken).toContain('••••');
  });

  it('should get a specific setting category', async () => {
    const appearance = await getSetting('appearance');
    expect(appearance.theme).toBe('dark');
  });

  it('should check if integration is configured', async () => {
    const isConfigured = await isIntegrationConfigured('githubToken');
    expect(isConfigured).toBe(true);
    
    const notConfigured = await isIntegrationConfigured('openclawApiKey');
    expect(notConfigured).toBe(false);
  });

  it('should return GitHub OAuth config', async () => {
    // Via DB settings
    await updateSettings({
      oauth: {
        github: {
          clientId: 'id123',
          clientSecret: 'secret123',
          redirectUri: 'http://test.com'
        }
      }
    });
    
    const config = await getGitHubOAuthConfig();
    expect(config?.clientId).toBe('id123');
    expect(config?.redirectUri).toBe('http://test.com');
  });

  it('should handle plugin health checks', async () => {
    (global.fetch as any).mockResolvedValue({ ok: true });
    
    await togglePlugin('ollama', true);
    const health = await getPluginHealth();
    
    const ollama = health.find(h => h.id === 'ollama');
    expect(ollama?.enabled).toBe(true);
    expect(ollama?.status).toBe('online');
  });

  it('should toggle a plugin', async () => {
    await togglePlugin('mcp-server', true);
    const settings = await getSettings();
    expect(settings.plugins.mcpServer.enabled).toBe(true);
  });

  it('should reset settings to defaults', async () => {
    await resetSettings();
    const settings = await getSettings();
    expect(settings.appearance.theme).toBe('system');
    expect(settings.integrations.githubToken).toBeUndefined();
  });
});
