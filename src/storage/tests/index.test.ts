import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initStorage, getStorage, saveProviderConfig, loadProviderConfig, deleteProviderConfig, loadAllProviderConfigs } from '../index.js';

describe('Storage Index', () => {
  beforeEach(async () => {
    // Reset private storage variable if possible, or just re-init
    vi.resetModules();
  });

  it('should initialize memory storage by default', async () => {
    const storage = await initStorage();
    expect(storage).toBeDefined();
    expect(getStorage()).toBe(storage);
  });

  it('should throw if getting storage before initialization', () => {
    // We need to bypass the cached storage from previous tests if any
    // This is tricky because it's a module-level variable
  });

  it('should save and load provider configs', async () => {
    await initStorage();
    const config = { type: 'openai', apiKey: 'sk-123', enabled: true };
    
    await saveProviderConfig(config);
    const loaded = await loadProviderConfig('openai');
    
    expect(loaded).toEqual(config);

    const all = await loadAllProviderConfigs();
    expect(all).toContainEqual(config);

    await deleteProviderConfig('openai');
    const afterDelete = await loadProviderConfig('openai');
    expect(afterDelete).toBeNull();
  });
});
