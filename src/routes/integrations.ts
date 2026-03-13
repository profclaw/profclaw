/**
 * Integrations Route
 *
 * Manage external service integrations (web search, etc.)
 * Provides config management and availability checks.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { getSettingsRaw, updateSettings } from '../settings/index.js';

// Stub for web search availability check until settings supports it
async function checkWebSearchAvailable(): Promise<{ available: boolean; provider?: string; reason?: string }> {
  return { available: false, reason: 'Web search not configured in settings' };
}

// Extended settings type with webSearch (TODO: add to main settings schema)
interface SettingsWithWebSearch {
  webSearch?: {
    enabled: boolean;
    provider: 'brave' | 'serper' | 'searxng' | 'tavily';
    brave?: { apiKey?: string };
    serper?: { apiKey?: string };
    searxng?: { baseUrl?: string; apiKey?: string };
    tavily?: { apiKey?: string };
  };
}
import { setWebSearchConfig, checkWebSearchAvailable as toolCheckAvailable } from '../chat/execution/tools/web-search.js';
import { WebSearchConfigSchema, getDefaultWebSearchConfig } from '../integrations/web-search.js';
import { logger } from '../utils/logger.js';

const integrations = new Hono();

// =============================================================================
// Web Search Integration
// =============================================================================

/**
 * GET /api/integrations/web-search
 * Get web search configuration and status
 */
integrations.get('/web-search', async (c) => {
  try {
    const settings = await getSettingsRaw() as SettingsWithWebSearch;
    const webSearch = settings.webSearch || getDefaultWebSearchConfig();
    const availability = await checkWebSearchAvailable();

    // Mask API keys for display
    const masked = {
      enabled: webSearch.enabled,
      provider: webSearch.provider,
      brave: webSearch.brave ? { apiKey: maskApiKey(webSearch.brave.apiKey) } : undefined,
      serper: webSearch.serper ? { apiKey: maskApiKey(webSearch.serper.apiKey) } : undefined,
      searxng: webSearch.searxng ? {
        baseUrl: webSearch.searxng.baseUrl,
        apiKey: maskApiKey(webSearch.searxng.apiKey),
      } : undefined,
      tavily: webSearch.tavily ? { apiKey: maskApiKey(webSearch.tavily.apiKey) } : undefined,
    };

    return c.json({
      config: masked,
      status: {
        available: availability.available,
        provider: availability.provider,
        reason: availability.reason,
      },
      // List available providers for UI
      providers: [
        { id: 'brave', name: 'Brave Search', description: 'Fast, privacy-focused search', configFields: ['apiKey'] },
        { id: 'serper', name: 'Serper (Google)', description: 'Google Search results via API', configFields: ['apiKey'] },
        { id: 'searxng', name: 'SearXNG', description: 'Self-hosted metasearch engine', configFields: ['baseUrl', 'apiKey'] },
        { id: 'tavily', name: 'Tavily', description: 'AI-optimized search API', configFields: ['apiKey'] },
      ],
    });
  } catch (error) {
    logger.error('[Integrations] Error fetching web search config:', { error });
    return c.json({
      error: 'Failed to fetch web search configuration',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * PATCH /api/integrations/web-search
 * Update web search configuration
 */
integrations.patch('/web-search', async (c) => {
  try {
    const body = await c.req.json();

    // Validate partial update
    const UpdateSchema = z.object({
      enabled: z.boolean().optional(),
      provider: z.enum(['brave', 'serper', 'searxng', 'tavily']).optional(),
      brave: z.object({
        apiKey: z.string().optional(),
      }).optional(),
      serper: z.object({
        apiKey: z.string().optional(),
      }).optional(),
      searxng: z.object({
        baseUrl: z.string().url().optional(),
        apiKey: z.string().optional(),
      }).optional(),
      tavily: z.object({
        apiKey: z.string().optional(),
      }).optional(),
    });

    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({
        error: 'Validation failed',
        details: parsed.error.flatten(),
      }, 400);
    }

    // Get current settings and merge
    const current = await getSettingsRaw() as SettingsWithWebSearch;
    const currentWebSearch = current.webSearch || getDefaultWebSearchConfig();

    // Don't overwrite existing API keys with masked values
    const updatedWebSearch = {
      enabled: parsed.data.enabled ?? currentWebSearch.enabled,
      provider: parsed.data.provider ?? currentWebSearch.provider,
      brave: mergeProviderConfig(currentWebSearch.brave, parsed.data.brave),
      serper: mergeProviderConfig(currentWebSearch.serper, parsed.data.serper),
      searxng: mergeProviderConfigWithUrl(currentWebSearch.searxng, parsed.data.searxng),
      tavily: mergeProviderConfig(currentWebSearch.tavily, parsed.data.tavily),
    };

    // Update settings
    // TODO: Add webSearch to main settings schema
    await updateSettings({ integrations: {} }); // Stub - webSearch not in settings yet

    // Reload the web search tool config
    const fullConfig = WebSearchConfigSchema.parse(updatedWebSearch);
    setWebSearchConfig(fullConfig);

    // Check new availability
    const availability = toolCheckAvailable();

    logger.info(`[Integrations] Web search config updated, provider: ${updatedWebSearch.provider}, enabled: ${updatedWebSearch.enabled}`);

    return c.json({
      message: 'Web search configuration updated',
      status: {
        available: availability.available,
        provider: availability.provider,
        reason: availability.reason,
      },
    });
  } catch (error) {
    logger.error('[Integrations] Error updating web search config:', { error });
    return c.json({
      error: 'Failed to update web search configuration',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * POST /api/integrations/web-search/test
 * Test web search configuration
 */
integrations.post('/web-search/test', async (c) => {
  try {
    const { webSearch } = await import('../integrations/web-search.js');
    const settings = await getSettingsRaw() as SettingsWithWebSearch;
    const config = settings.webSearch || getDefaultWebSearchConfig();

    if (!config.enabled) {
      return c.json({
        success: false,
        error: 'Web search is disabled',
      }, 400);
    }

    // Parse the full config
    const fullConfig = WebSearchConfigSchema.parse(config);

    // Run a test search
    const result = await webSearch('test query', fullConfig, { count: 1 });

    return c.json({
      success: true,
      provider: result.provider,
      resultCount: result.results.length,
      sample: result.results[0] ? {
        title: result.results[0].title,
        url: result.results[0].url,
      } : null,
    });
  } catch (error) {
    logger.error('[Integrations] Web search test failed:', { error });
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// =============================================================================
// Helpers
// =============================================================================

function maskApiKey(key?: string): string | undefined {
  if (!key) return undefined;
  if (key.length < 8) return '••••••••';
  return key.slice(0, 4) + '••••' + key.slice(-4);
}

function mergeProviderConfig(
  current?: { apiKey?: string },
  update?: { apiKey?: string }
): { apiKey?: string } | undefined {
  if (!update) return current;

  // Don't overwrite with masked values
  const newKey = update.apiKey && !update.apiKey.includes('••••')
    ? update.apiKey
    : current?.apiKey;

  return { apiKey: newKey };
}

function mergeProviderConfigWithUrl(
  current?: { baseUrl?: string; apiKey?: string },
  update?: { baseUrl?: string; apiKey?: string }
): { baseUrl?: string; apiKey?: string } | undefined {
  if (!update) return current;

  const newKey = update.apiKey && !update.apiKey.includes('••••')
    ? update.apiKey
    : current?.apiKey;

  return {
    baseUrl: update.baseUrl ?? current?.baseUrl,
    apiKey: newKey,
  };
}

export { integrations as integrationsRoutes };
